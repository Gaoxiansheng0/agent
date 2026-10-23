// PearlKin server: accounts, AI skin analysis, family/shelf sync, AI routine advice, label OCR, anonymous usage
// stats, problem reports, product library, rule-pack updates, waitlist and the admin panel at /admin.
// Face photos are analyzed in memory and never stored.
import { createHash, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { getConnInfo } from '@hono/node-server/conninfo'
import { Hono, type Context } from 'hono'
import { secureHeaders } from 'hono/secure-headers'
import type { Pack } from '../engine/engine.ts'
import { accountRoutes, fetchAppleKeys, resendMailer, type AppleKeys, type Mailer } from './accounts.ts'
import { adminRoutes } from './admin.ts'
import { openDb, type Db } from './db.ts'
import { deepseekClient, MODEL, type ChatClient } from './ocr.ts'
import { errorHandler, publicRoutes } from './public.ts'
import { skinRoutes } from './skin.ts'

export { MODEL }

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url))
const ADMIN_FILES: Record<string, string> = {
  '/admin': 'admin/index.html', '/admin/': 'admin/index.html',
  '/admin/app.js': 'admin/app.js', '/admin/style.css': 'admin/style.css',
}
const TYPES: Record<string, string> = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8' }

// Behind Caddy the client IP is in X-Forwarded-For; only trust it from a local proxy.
function clientIp(c: Context) {
  let remote = ''
  try { remote = getConnInfo(c).remote.address ?? '' } catch { /* app.request() in tests has no socket */ }
  const local = !remote || remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1'
  const fwd = c.req.header('x-forwarded-for')
  return local && fwd ? fwd.split(',')[0].trim() : remote || 'local'
}

export function createApp(opts: {
  db: Db
  client: ChatClient
  appToken?: string
  adminPasswordHash?: string
  sessionSecret?: string
  stripeWebhookSecret?: string
  deepseekKeySet?: boolean
  mailer?: Mailer
  appleKeys?: AppleKeys
  appleAudience?: string[]
  revenueCatSecret?: string
  now?: () => number
}) {
  const now = opts.now ?? Date.now
  const sessionSecret = opts.sessionSecret || randomBytes(32).toString('hex')
  // Hashed with a server secret so the admin can spot one heavy user without storing raw IPs.
  const ipHash = (ip: string) => createHash('sha256').update(sessionSecret + ip).digest('hex').slice(0, 12)
  const app = new Hono()

  app.use('/admin/*', secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"], frameAncestors: ["'none'"], objectSrc: ["'none'"], baseUri: ["'self'"],
    },
    referrerPolicy: 'no-referrer',
  }))
  for (const [path, file] of Object.entries(ADMIN_FILES)) {
    app.get(path, c => {
      c.header('content-type', TYPES[file.split('.').pop()!])
      c.header('cache-control', 'no-cache')
      return c.body(readFileSync(here(file), 'utf8'))
    })
  }

  const { appOnly } = publicRoutes(app, { db: opts.db, ocr: opts.client, appToken: opts.appToken, stripeWebhookSecret: opts.stripeWebhookSecret, now, clientIp, ipHash })
  const accounts = accountRoutes(app, {
    db: opts.db, now, clientIp, secret: sessionSecret, mailer: opts.mailer, appleKeys: opts.appleKeys ?? fetchAppleKeys,
    appleAudience: opts.appleAudience ?? ['com.pearlwren.pearlkin'], revenueCatSecret: opts.revenueCatSecret,
  })
  skinRoutes(app, { db: opts.db, ai: opts.client, now, appOnly, ipHash, clientIp, ...accounts })
  errorHandler(app)
  adminRoutes(app, {
    db: opts.db, ai: opts.client, passwordHash: opts.adminPasswordHash, sessionSecret, now, clientIp,
    status: { deepseekKey: opts.deepseekKeySet ?? false, stripeWebhook: !!opts.stripeWebhookSecret, appToken: !!opts.appToken,
      email: !!opts.mailer, revenueCat: !!opts.revenueCatSecret },
  })
  app.notFound(c => c.json({ error: 'Not found' }, 404))
  return app
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const env = process.env
  const port = Number(env.PORT ?? 3001)
  const hostname = env.HOST ?? '127.0.0.1' // HOST=0.0.0.0 to reach it from a phone on the same WiFi
  const bundled = JSON.parse(readFileSync(here('../engine/rule-pack.json'), 'utf8')) as Pack
  const db = openDb(env.DB_FILE ?? here('../data/pearlkin.db'), bundled)
  if (!env.APP_TOKEN) console.warn('APP_TOKEN not set: anyone who finds this URL can spend your API credit.')
  if (!env.DEEPSEEK_API_KEY) console.warn('DEEPSEEK_API_KEY not set: photo reading will fail.')
  if (!env.SESSION_SECRET) console.warn('SESSION_SECRET not set: admin logins reset on every restart.')
  const app = createApp({
    db, client: deepseekClient(), appToken: env.APP_TOKEN, adminPasswordHash: env.ADMIN_PASSWORD_HASH,
    sessionSecret: env.SESSION_SECRET, stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET, deepseekKeySet: !!env.DEEPSEEK_API_KEY,
    mailer: env.RESEND_API_KEY ? resendMailer(env.RESEND_API_KEY, env.EMAIL_FROM ?? 'PearlKin <hello@pearlwren.com>') : undefined,
    appleAudience: (env.APPLE_AUDIENCE ?? 'com.pearlwren.pearlkin').split(','), revenueCatSecret: env.REVENUECAT_SECRET_KEY,
  })
  db.prune()
  setInterval(() => db.prune(), 24 * 3600_000).unref()
  serve({ fetch: app.fetch, port, hostname }, () => console.log(`Family Shelf server on http://${hostname}:${port} (${MODEL})`))
}
