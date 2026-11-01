// Endpoints the app and the landing page call. Everything here is product-level or anonymous:
// an install id is a random string made on the device, never tied to a name, email or family member.
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { Context, Hono, MiddlewareHandler } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { Db } from './db.ts'
import { extractIngredients, HttpError, MEDIA_TYPES, MODEL, UpstreamError, type ChatClient, type MediaType, type Usage } from './ocr.ts'
import { sameToken } from './auth.ts'

export type Deps = {
  db: Db
  ocr: ChatClient
  appToken?: string
  stripeWebhookSecret?: string
  now: () => number
  clientIp: (c: Context) => string
  ipHash: (ip: string) => string
}

const DAY = 24 * 3600_000
const INSTALL_ID = /^[A-Za-z0-9-]{8,64}$/
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/

// ponytail: in-memory windows, single process, reset on restart. Enough for one small server.
export function limiter(max: number, windowMs: number, now: () => number) {
  const hits = new Map<string, number[]>()
  return (key: string) => {
    const t = now()
    const recent = (hits.get(key) ?? []).filter(x => t - x < windowMs)
    if (recent.length >= max) return false
    recent.push(t)
    hits.set(key, recent)
    if (hits.size > 50_000) hits.clear()
    return true
  }
}

// Answer codes for the landing-page survey; labels live in landing/index.html (English) and admin/app.js (Chinese).
export const SURVEY = {
  kids: ['under8', '8-12', '13-17', 'none'],
  checks: ['google', 'label', 'doctor', 'parents', 'social', 'dont'],
  price: ['easy', 'fair', 'bit_much', 'too_much'],
} as const satisfies Record<string, readonly string[]>

export const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

function cleanProps(v: unknown) {
  const out: Record<string, string | number | boolean> = {}
  if (!v || typeof v !== 'object') return out
  for (const [k, x] of Object.entries(v).slice(0, 12)) {
    if (!/^[a-z_]{1,32}$/.test(k)) continue
    if (typeof x === 'string') out[k] = x.slice(0, 200)
    else if ((typeof x === 'number' && Number.isFinite(x)) || typeof x === 'boolean') out[k] = x
  }
  return out
}

export const ocrCost = (u: Usage, s: { priceInputPerM: number; priceOutputPerM: number }) =>
  (u.input * s.priceInputPerM + u.output * s.priceOutputPerM) / 1e6

export function stripeSignatureOk(payload: string, header: string, secret: string, nowMs: number) {
  const parts = Object.fromEntries(header.split(',').map(p => p.split('=') as [string, string]))
  const t = Number(parts.t)
  if (!t || Math.abs(nowMs / 1000 - t) > 300) return false
  const want = createHmac('sha256', secret).update(`${t}.${payload}`).digest()
  return header.split(',').filter(p => p.startsWith('v1=')).some(p => {
    const got = Buffer.from(p.slice(3), 'hex')
    return got.length === want.length && timingSafeEqual(got, want)
  })
}

export function publicRoutes(app: Hono, d: Deps) {
  const { db } = d
  const limit = (name: string, max: number, windowMs: number): MiddlewareHandler => {
    const allow = limiter(max, windowMs, d.now)
    return async (c, next) => {
      if (!allow(`${name}:${d.clientIp(c)}`)) return c.json({ error: 'Too many requests. Try again later.' }, 429)
      await next()
    }
  }
  // Ships inside the app bundle, so it only stops casual abuse.
  const appOnly: MiddlewareHandler = async (c, next) => {
    if (d.appToken && !sameToken(c.req.header('x-app-token'), d.appToken)) return c.json({ error: 'Unauthorized' }, 401)
    await next()
  }
  const json = async (c: Context) => {
    const body = await c.req.json().catch(() => null)
    if (!body || typeof body !== 'object') throw new HttpError(400, 'Body must be JSON.')
    return body as Record<string, unknown>
  }

  app.use('/api/*', async (c, next) => {
    c.header('access-control-allow-origin', '*') // no cookies on these routes; the token gates the costly ones
    c.header('access-control-allow-headers', 'content-type, x-app-token, authorization')
    c.header('access-control-allow-methods', 'GET, POST, PUT, DELETE, OPTIONS')
    if (c.req.method === 'OPTIONS') return c.body(null, 204)
    await next()
  })

  app.get('/api/health', c => c.json({ ok: true, model: MODEL }))

  app.get('/api/config', c => {
    const s = db.settings()
    c.header('cache-control', 'no-cache') // admin changes (paywall switch, limits) apply on the next app open
    return c.json({
      paywallEnabled: s.paywallEnabled, free: s.free, contactEmail: s.contactEmail, appStoreUrl: s.appStoreUrl,
      checkoutUrl: s.checkoutUrl, rulePackVersion: db.published().version,
    })
  })

  app.get('/api/rule-pack', c => {
    const { version, pack } = db.published()
    c.header('cache-control', 'public, max-age=300')
    return c.json({ version, pack })
  })

  // Label photo -> ingredient list. Logged without the photo: time, hashed IP, tokens, cost, outcome.
  app.post('/api/ocr', bodyLimit({ maxSize: 8 * 1024 * 1024, onError: c => c.json({ error: 'Photo is too large.' }, 413) }),
    appOnly, limit('ocr', 30, 3600_000), async c => {
      const started = d.now()
      const s = db.settings()
      const log = (status: number, usage: Usage, ingredients: number, error: string) => db.run(
        'INSERT INTO ocr_logs (ts, ip_hash, status, ms, input_tokens, output_tokens, cost, ingredients, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        started, d.ipHash(d.clientIp(c)), status, d.now() - started, usage.input, usage.output, ocrCost(usage, s), ingredients, error.slice(0, 300))
      const none = { input: 0, output: 0 }

      const today = db.get<{ n: number }>("SELECT COUNT(*) AS n FROM ocr_logs WHERE kind = 'ocr' AND ts >= ? AND status = 200", started - (started % DAY))!.n
      if (today >= s.ocrDailyCap) {
        log(503, none, 0, 'daily cap reached')
        return c.json({ error: 'Photo reading is busy right now. Type the ingredients or try again tomorrow.' }, 503)
      }
      try {
        const body = await json(c)
        const mediaType = (body.media_type ?? 'image/jpeg') as MediaType
        const image = typeof body.image === 'string' ? body.image.replace(/^data:[^,]*,/, '') : ''
        if (!MEDIA_TYPES.includes(mediaType) || !image || !/^[A-Za-z0-9+/]+=*$/.test(image))
          throw new HttpError(400, 'Send a base64 JPEG, PNG or WebP image.')
        const { result, usage } = await extractIngredients(d.ocr, image, mediaType)
        log(200, usage, result.ingredients.length, result.found ? '' : 'no ingredient list')
        return c.json(result)
      } catch (e) {
        if (e instanceof HttpError) {
          log(e.status, (e as HttpError & { usage?: Usage }).usage ?? none, 0, e.message)
          return c.json({ error: e.message }, e.status as 400)
        }
        if (e instanceof UpstreamError && (e.status === 429 || e.status >= 500)) {
          log(503, none, 0, `deepseek ${e.status}: ${e.message}`)
          return c.json({ error: 'The reader is busy. Try again in a minute.' }, 503)
        }
        const msg = e instanceof UpstreamError ? `deepseek ${e.status}: ${e.message}` : e instanceof Error ? `${e.name}: ${e.message}` : String(e)
        console.error('ocr', msg)
        log(502, none, 0, msg)
        return c.json({ error: 'The reader is unavailable right now.' }, 502)
      }
    })

  // Anonymous usage events from the app and the landing page. Props are flat and short; no free text from users.
  app.post('/api/events', bodyLimit({ maxSize: 64 * 1024 }), limit('events', 120, 60_000), async c => {
    const body = await json(c)
    const installId = str(body.install_id, 64)
    const source = body.source === 'web' ? 'web' : 'app'
    if (!INSTALL_ID.test(installId) || !Array.isArray(body.events)) return c.json({ error: 'Bad events.' }, 400)
    const now = d.now()
    const platform = str(body.platform, 20), version = str(body.app_version, 20)
    let n = 0
    db.tx(() => {
      for (const e of (body.events as { name?: unknown; ts?: unknown; props?: unknown }[]).slice(0, 50)) {
        const name = str(e?.name, 40)
        if (!/^[a-z_]{2,40}$/.test(name)) continue
        // Device clocks drift and queued events arrive late; accept up to 3 days back, never in the future.
        const ts = typeof e.ts === 'number' && e.ts <= now && e.ts > now - 3 * DAY ? e.ts : now
        db.run('INSERT INTO events (ts, source, install_id, name, props, platform, app_version) VALUES (?, ?, ?, ?, ?, ?, ?)',
          ts, source, installId, name, JSON.stringify(cleanProps(e.props)), platform, version)
        n++
      }
    })
    return c.json({ ok: true, accepted: n })
  })

  app.get('/api/products/:barcode', appOnly, limit('products', 300, 3600_000), c => {
    const barcode = c.req.param('barcode').replace(/\D/g, '').slice(0, 20)
    const p = db.get('SELECT barcode, name, brand, raw, updated_at FROM products WHERE barcode = ?', barcode)
    return p ? c.json(p) : c.json({ error: 'Not found' }, 404)
  })

  // Barcode the databases didn't know + the ingredient list the user typed or photographed: goes to the admin review queue.
  app.post('/api/submissions', appOnly, bodyLimit({ maxSize: 32 * 1024 }), limit('submissions', 20, 3600_000), async c => {
    const b = await json(c)
    const barcode = str(b.barcode, 20).replace(/\D/g, ''), raw = str(b.raw, 5000), installId = str(b.install_id, 64)
    if (!barcode || raw.length < 3 || !INSTALL_ID.test(installId)) return c.json({ error: 'Bad submission.' }, 400)
    db.run('INSERT INTO submissions (ts, install_id, barcode, name, brand, raw, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      d.now(), installId, barcode, str(b.name, 200) || `Product ${barcode}`, str(b.brand, 120), raw, d.now())
    return c.json({ ok: true })
  })

  // Ingredient names the rule pack doesn't know yet (plan 4.5 review queue).
  app.post('/api/unknowns', appOnly, bodyLimit({ maxSize: 16 * 1024 }), limit('unknowns', 60, 3600_000), async c => {
    const b = await json(c)
    const installId = str(b.install_id, 64)
    if (!INSTALL_ID.test(installId) || !Array.isArray(b.tokens)) return c.json({ error: 'Bad request.' }, 400)
    const now = d.now()
    const tokens = [...new Set((b.tokens as unknown[]).map(t => str(t, 80).toLowerCase()).filter(t => t.length >= 2))].slice(0, 50)
    db.tx(() => {
      for (const t of tokens) {
        const fresh = db.run('INSERT OR IGNORE INTO unknown_seen (token, install_id) VALUES (?, ?)', t, installId).changes > 0
        db.run(`INSERT INTO unknowns (token, count, installs, first_ts, last_ts) VALUES (?, 1, 1, ?, ?)
          ON CONFLICT(token) DO UPDATE SET count = count + 1, installs = installs + ?, last_ts = excluded.last_ts`, t, now, now, fresh ? 1 : 0)
      }
    })
    return c.json({ ok: true })
  })

  app.post('/api/reports', appOnly, bodyLimit({ maxSize: 32 * 1024 }), limit('reports', 10, 3600_000), async c => {
    const b = await json(c)
    const installId = str(b.install_id, 64), message = str(b.message, 2000), productName = str(b.product_name, 200)
    const kind = ['ingredients', 'verdict', 'product', 'other'].includes(b.kind as string) ? (b.kind as string) : 'other'
    if (!INSTALL_ID.test(installId) || !productName || (!message && kind === 'other')) return c.json({ error: 'Tell us what looks wrong.' }, 400)
    const contact = str(b.contact, 200)
    db.run(`INSERT INTO reports (ts, install_id, kind, message, contact, product_name, brand, barcode, raw, pack_version, platform, app_version, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      d.now(), installId, kind, message, EMAIL.test(contact) ? contact : '', productName, str(b.brand, 120),
      str(b.barcode, 20).replace(/\D/g, ''), str(b.raw, 5000), str(b.pack_version, 20), str(b.platform, 20), str(b.app_version, 20), d.now())
    return c.json({ ok: true })
  })

  app.post('/api/waitlist', bodyLimit({ maxSize: 4 * 1024 }), limit('waitlist', 5, 3600_000), async c => {
    const b = await json(c)
    const email = str(b.email, 254).toLowerCase()
    if (!EMAIL.test(email)) return c.json({ error: 'Enter a valid email address.' }, 400)
    db.run('INSERT OR IGNORE INTO waitlist (email, hook, ts) VALUES (?, ?, ?)', email, str(b.hook, 8), d.now())
    return c.json({ ok: true })
  })

  // Three-question survey after joining the waitlist. One answer set per browser; answering again replaces it.
  app.post('/api/survey', bodyLimit({ maxSize: 4 * 1024 }), limit('survey', 10, 3600_000), async c => {
    const b = await json(c)
    const visitor = str(b.visitor_id, 64)
    if (!INSTALL_ID.test(visitor)) return c.json({ error: 'Bad request.' }, 400)
    const pick = (v: unknown, allowed: readonly string[]) => (typeof v === 'string' && allowed.includes(v) ? v : '')
    const kids = (Array.isArray(b.kids) ? b.kids : []).filter((k: unknown): k is string => typeof k === 'string' && (SURVEY.kids as readonly string[]).includes(k))
    const row = { kids: [...new Set(kids)].join(','), checks: pick(b.checks, SURVEY.checks), price: pick(b.price, SURVEY.price) }
    if (!row.kids && !row.checks && !row.price) return c.json({ error: 'Pick at least one answer.' }, 400)
    const email = str(b.email, 254).toLowerCase()
    db.run(`INSERT INTO surveys (visitor_id, ts, hook, email, kids, checks, price) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(visitor_id) DO UPDATE SET ts = excluded.ts, hook = excluded.hook, email = excluded.email, kids = excluded.kids, checks = excluded.checks, price = excluded.price`,
      visitor, d.now(), str(b.hook, 8), EMAIL.test(email) ? email : '', row.kids, row.checks, row.price)
    return c.json({ ok: true })
  })

  // Founding-member presale via a Stripe Payment Link. client_reference_id carries the ad hook ("hook-a").
  app.post('/api/stripe/webhook', bodyLimit({ maxSize: 512 * 1024 }), async c => {
    if (!d.stripeWebhookSecret) return c.json({ error: 'Stripe webhook not configured' }, 503)
    const payload = await c.req.text()
    if (!stripeSignatureOk(payload, c.req.header('stripe-signature') ?? '', d.stripeWebhookSecret, d.now()))
      return c.json({ error: 'Bad signature' }, 400)
    const event = JSON.parse(payload) as { type: string; created: number; data: { object: Record<string, any> } }
    const o = event.data.object
    if (event.type === 'checkout.session.completed' && o.payment_status === 'paid') {
      const hook = /^hook-([a-z])$/.exec(o.client_reference_id ?? '')?.[1] ?? ''
      db.run(`INSERT INTO presales (session_id, ts, email, amount, currency, hook, payment_intent) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id) DO NOTHING`,
        o.id, event.created * 1000, o.customer_details?.email ?? '', o.amount_total ?? 0, o.currency ?? '', hook, o.payment_intent ?? '')
    }
    if (event.type === 'charge.refunded' && o.payment_intent)
      db.run("UPDATE presales SET status = 'refunded' WHERE payment_intent = ?", o.payment_intent)
    return c.json({ received: true })
  })

  return { appOnly }
}

export function errorHandler(app: Hono) {
  app.onError((e, c) => {
    if (e instanceof HttpError) return c.json({ error: e.message }, e.status as 400)
    console.error(e)
    return c.json({ error: 'Something went wrong.' }, 500)
  })
}
