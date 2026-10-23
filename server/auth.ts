// Admin login: one password (stored as an scrypt hash), a signed session cookie, lockout after repeated failures.
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type { Context, MiddlewareHandler } from 'hono'
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie'

const COOKIE = 'pk_admin'
const SESSION_MS = 7 * 24 * 3600_000
const MAX_FAILURES = 5
const LOCK_MS = 15 * 60_000

/** "scrypt$<salt hex>$<hash hex>" — what deploy/tools/pearlkin-admin-password writes to the env file. */
export function hashPassword(password: string, salt = randomBytes(16).toString('hex')) {
  return `scrypt$${salt}$${scryptSync(password, salt, 32).toString('hex')}`
}

export function verifyPassword(password: string, stored: string) {
  const [kind, salt, hash] = stored.split('$')
  if (kind !== 'scrypt' || !salt || !hash) return false
  const want = Buffer.from(hash, 'hex')
  const got = scryptSync(password, salt, want.length)
  return got.length === want.length && timingSafeEqual(got, want)
}

export const sameToken = (got: unknown, want: string) => {
  if (typeof got !== 'string') return false
  const a = createHash('sha256').update(got).digest(), b = createHash('sha256').update(want).digest()
  return timingSafeEqual(a, b)
}

export function adminAuth(opts: { passwordHash?: string; secret: string; now: () => number; clientIp: (c: Context) => string }) {
  const failures = new Map<string, { count: number; until: number }>()

  const requireAdmin: MiddlewareHandler = async (c, next) => {
    const value = await getSignedCookie(c, opts.secret, COOKIE)
    if (!value || Number(value) < opts.now()) return c.json({ error: '请先登录' }, 401)
    await next()
  }

  async function login(c: Context, password: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const ip = opts.clientIp(c)
    const f = failures.get(ip)
    if (f && f.count >= MAX_FAILURES && f.until > opts.now()) return { ok: false, error: '尝试次数过多，请 15 分钟后再试' }
    if (!opts.passwordHash) return { ok: false, error: '服务器还没设置后台密码（运行 pearlkin-admin-password）' }
    if (!verifyPassword(password, opts.passwordHash)) {
      failures.set(ip, { count: (f && f.until > opts.now() ? f.count : 0) + 1, until: opts.now() + LOCK_MS })
      return { ok: false, error: '密码错误' }
    }
    failures.delete(ip)
    const secure = new URL(c.req.url).protocol === 'https:' || c.req.header('x-forwarded-proto') === 'https'
    await setSignedCookie(c, COOKIE, String(opts.now() + SESSION_MS), opts.secret, {
      httpOnly: true, sameSite: 'Strict', secure, path: '/', maxAge: SESSION_MS / 1000,
    })
    return { ok: true }
  }

  const logout = (c: Context) => deleteCookie(c, COOKIE, { path: '/' })
  return { requireAdmin, login, logout }
}
