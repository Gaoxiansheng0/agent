// User accounts: sign in with Apple or a 6-digit email code, bearer-token sessions, subscription status, account deletion.
// Face photos never reach the database; accounts hold profiles, products and report scores only.
import { createHash, createPublicKey, randomBytes, randomInt, verify as verifySig, type JsonWebKeyInput } from 'node:crypto'

type JsonWebKey = JsonWebKeyInput['key']
import type { Context, Hono, MiddlewareHandler } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { Db } from './db.ts'
import { limiter, str } from './public.ts'

const DAY = 24 * 3600_000
const SESSION_DAYS = 180
const CODE_MINUTES = 10
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/

export type User = { id: string; email: string | null; apple_sub: string | null; created_at: number; pro_until: number | null }
export type Mailer = (to: string, subject: string, html: string) => Promise<void>
export type AppleKeys = () => Promise<(JsonWebKey & { kid: string })[]>

export type AccountDeps = {
  db: Db
  now: () => number
  clientIp: (c: Context) => string
  secret: string
  mailer?: Mailer // unset = dev mode: codes are shown in the admin panel instead of emailed
  appleKeys: AppleKeys
  appleAudience: string[] // the iOS bundle id (and a web Services ID, if one is added later)
  revenueCatSecret?: string
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex')
export const newId = (prefix: string) => `${prefix}_${randomBytes(9).toString('base64url')}`

/** Resend (https://resend.com) — the only email we send is the sign-in code. */
export function resendMailer(apiKey: string, from: string): Mailer {
  return async (to, subject, html) => {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from, to, subject, html }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) throw new Error(`resend ${res.status}: ${(await res.text()).slice(0, 200)}`)
  }
}

let appleCache: { at: number; keys: (JsonWebKey & { kid: string })[] } | null = null
export const fetchAppleKeys: AppleKeys = async () => {
  if (appleCache && Date.now() - appleCache.at < DAY) return appleCache.keys
  const res = await fetch('https://appleid.apple.com/auth/keys', { signal: AbortSignal.timeout(10_000) })
  const keys = ((await res.json()) as { keys: (JsonWebKey & { kid: string })[] }).keys
  appleCache = { at: Date.now(), keys }
  return keys
}

/** Verifies an Apple identity token (RS256 JWT) and returns its subject and email. */
export async function verifyAppleToken(token: string, keys: AppleKeys, audience: string[], now: number) {
  const [h, p, sig] = token.split('.')
  if (!h || !p || !sig) throw new Error('malformed token')
  const header = JSON.parse(Buffer.from(h, 'base64url').toString())
  const payload = JSON.parse(Buffer.from(p, 'base64url').toString())
  const jwk = (await keys()).find(k => k.kid === header.kid)
  if (header.alg !== 'RS256' || !jwk) throw new Error('unknown signing key')
  const ok = verifySig('RSA-SHA256', Buffer.from(`${h}.${p}`), createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(sig, 'base64url'))
  if (!ok) throw new Error('bad signature')
  if (payload.iss !== 'https://appleid.apple.com') throw new Error('bad issuer')
  if (!audience.includes(payload.aud)) throw new Error('bad audience')
  if (typeof payload.exp !== 'number' || payload.exp * 1000 < now) throw new Error('expired')
  return { sub: String(payload.sub), email: typeof payload.email === 'string' ? payload.email.toLowerCase() : null }
}

export function accountRoutes(app: Hono, d: AccountDeps) {
  const { db } = d
  const ipLimit = limiter(10, 3600_000, d.now)
  const emailLimit = limiter(5, 3600_000, d.now)

  const startSession = (userId: string) => {
    const token = randomBytes(32).toString('base64url')
    db.run('INSERT INTO sessions (token_hash, user_id, created_at, last_used) VALUES (?, ?, ?, ?)', sha(token), userId, d.now(), d.now())
    return token
  }
  const userById = (id: string) => db.get<User>('SELECT id, email, apple_sub, created_at, pro_until FROM users WHERE id = ?', id)
  const createUser = (fields: { email?: string | null; apple_sub?: string | null }) => {
    const id = newId('u')
    db.run('INSERT INTO users (id, email, apple_sub, created_at, last_seen) VALUES (?, ?, ?, ?, ?)',
      id, fields.email ?? null, fields.apple_sub ?? null, d.now(), d.now())
    return userById(id)!
  }

  // ---------- entitlement ----------
  const rcCache = new Map<string, { at: number; until: number | null; active: boolean }>()
  async function isPro(user: User): Promise<boolean> {
    if (!db.settings().paywallEnabled) return true // paywall off = everything open (testing, early access)
    if (user.pro_until && user.pro_until > d.now()) return true // granted in the admin panel
    if (!d.revenueCatSecret) return false
    const hit = rcCache.get(user.id)
    if (hit && d.now() - hit.at < 5 * 60_000) return hit.active
    try {
      const res = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(user.id)}`, {
        headers: { authorization: `Bearer ${d.revenueCatSecret}` }, signal: AbortSignal.timeout(8000),
      })
      const body = (await res.json()) as { subscriber?: { entitlements?: Record<string, { expires_date: string | null }> } }
      const pro = body.subscriber?.entitlements?.pro
      const until = pro ? (pro.expires_date ? Date.parse(pro.expires_date) : Infinity) : 0
      const active = until > d.now()
      rcCache.set(user.id, { at: d.now(), until: Number.isFinite(until) ? until : null, active })
      return active
    } catch {
      return hit?.active ?? false // RevenueCat unreachable: keep the last known answer
    }
  }

  const requireUser: MiddlewareHandler = async (c, next) => {
    const token = c.req.header('authorization')?.replace(/^Bearer\s+/i, '') ?? ''
    const s = token ? db.get<{ user_id: string; last_used: number }>('SELECT user_id, last_used FROM sessions WHERE token_hash = ?', sha(token)) : undefined
    if (!s || s.last_used < d.now() - SESSION_DAYS * DAY) return c.json({ error: 'Please sign in again.', code: 'signin' }, 401)
    const user = userById(s.user_id)
    if (!user) return c.json({ error: 'Please sign in again.', code: 'signin' }, 401)
    if (d.now() - s.last_used > 3600_000) {
      db.run('UPDATE sessions SET last_used = ? WHERE token_hash = ?', d.now(), sha(token))
      db.run('UPDATE users SET last_seen = ? WHERE id = ?', d.now(), user.id)
    }
    c.set('user' as never, user as never)
    await next()
  }
  const currentUser = (c: Context) => c.get('user' as never) as User

  const me = async (user: User) => ({ user: { id: user.id, email: user.email, created_at: user.created_at }, pro: await isPro(user) })

  // ---------- email code ----------
  app.post('/api/auth/email/start', bodyLimit({ maxSize: 2048 }), async c => {
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
    const email = str(b.email, 254).toLowerCase()
    if (!EMAIL.test(email)) return c.json({ error: 'Enter a valid email address.' }, 400)
    if (!ipLimit(d.clientIp(c)) || !emailLimit(email)) return c.json({ error: 'Too many codes requested. Try again later.' }, 429)
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
    db.run(`INSERT INTO auth_codes (email, code_hash, expires, attempts, created_at, dev_code) VALUES (?, ?, ?, 0, ?, ?)
      ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash, expires = excluded.expires, attempts = 0, created_at = excluded.created_at, dev_code = excluded.dev_code`,
      email, sha(`${d.secret}:${email}:${code}`), d.now() + CODE_MINUTES * 60_000, d.now(), d.mailer ? '' : code)
    if (d.mailer) {
      try {
        await d.mailer(email, `${code} is your PearlKin code`,
          `<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:16px;color:#1d1d1f">
            <p>Your PearlKin sign-in code:</p><p style="font-size:32px;font-weight:600;letter-spacing:6px">${code}</p>
            <p style="color:#6e6e73">It expires in ${CODE_MINUTES} minutes. If you didn't ask for it, you can ignore this email.</p></div>`)
      } catch (e) {
        console.error('mail', e instanceof Error ? e.message : e)
        return c.json({ error: "We couldn't send the email. Try again in a minute." }, 502)
      }
    }
    return c.json({ ok: true })
  })

  app.post('/api/auth/email/verify', bodyLimit({ maxSize: 2048 }), async c => {
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
    const email = str(b.email, 254).toLowerCase(), code = str(b.code, 6)
    const row = db.get<{ code_hash: string; expires: number; attempts: number }>('SELECT code_hash, expires, attempts FROM auth_codes WHERE email = ?', email)
    if (!row || row.expires < d.now() || row.attempts >= 5) return c.json({ error: 'This code has expired. Request a new one.' }, 400)
    if (sha(`${d.secret}:${email}:${code}`) !== row.code_hash) {
      db.run('UPDATE auth_codes SET attempts = attempts + 1 WHERE email = ?', email)
      return c.json({ error: "That code isn't right. Check the email and try again." }, 400)
    }
    db.run('DELETE FROM auth_codes WHERE email = ?', email)
    const user = db.get<User>('SELECT id, email, apple_sub, created_at, pro_until FROM users WHERE email = ?', email) ?? createUser({ email })
    return c.json({ token: startSession(user.id), ...(await me(user)) })
  })

  // ---------- Sign in with Apple (iOS) ----------
  app.post('/api/auth/apple', bodyLimit({ maxSize: 8192 }), async c => {
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
    if (!ipLimit(d.clientIp(c))) return c.json({ error: 'Too many attempts. Try again later.' }, 429)
    let claims: { sub: string; email: string | null }
    try {
      claims = await verifyAppleToken(str(b.identityToken, 4096), d.appleKeys, d.appleAudience, d.now())
    } catch (e) {
      console.error('apple', e instanceof Error ? e.message : e)
      return c.json({ error: "Apple sign-in didn't go through. Try again." }, 401)
    }
    let user = db.get<User>('SELECT id, email, apple_sub, created_at, pro_until FROM users WHERE apple_sub = ?', claims.sub)
    if (!user && claims.email) {
      // Same person signed in with an email code before: link the Apple ID to that account.
      user = db.get<User>('SELECT id, email, apple_sub, created_at, pro_until FROM users WHERE email = ? AND apple_sub IS NULL', claims.email)
      if (user) db.run('UPDATE users SET apple_sub = ? WHERE id = ?', claims.sub, user.id)
    }
    user ??= createUser({ email: claims.email, apple_sub: claims.sub })
    return c.json({ token: startSession(user.id), ...(await me(user)) })
  })

  app.get('/api/me', requireUser, async c => {
    if (c.req.query('fresh')) rcCache.delete(currentUser(c).id) // right after a purchase in the app
    return c.json(await me(currentUser(c)))
  })

  app.post('/api/auth/logout', requireUser, c => {
    const token = c.req.header('authorization')!.replace(/^Bearer\s+/i, '')
    db.run('DELETE FROM sessions WHERE token_hash = ?', sha(token))
    return c.json({ ok: true })
  })

  // App Store guideline 5.1.1(v): accounts must be deletable in the app.
  app.delete('/api/me', requireUser, c => {
    const id = currentUser(c).id
    db.tx(() => {
      for (const t of ['sessions', 'members', 'user_products', 'skin_reports', 'advice']) db.run(`DELETE FROM ${t} WHERE user_id = ?`, id)
      db.run('DELETE FROM users WHERE id = ?', id)
    })
    return c.json({ ok: true })
  })

  return { requireUser, currentUser, isPro }
}
