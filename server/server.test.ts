import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { Pack } from '../engine/engine.ts'
import { hashPassword } from './auth.ts'
import { openDb } from './db.ts'
import { UpstreamError } from './ocr.ts'
import { createApp, MODEL } from './server.ts'

const bundled: Pack = JSON.parse(readFileSync(new URL('../engine/rule-pack.json', import.meta.url), 'utf8'))

// Fake DeepSeek client: records the request, returns a canned response. No network, no cost.
function fakeClient(reply: object | (() => never)) {
  const calls: any[] = []
  return { calls, client: { chat: async (p: any) => (calls.push(p), typeof reply === 'function' ? reply() : reply) } as any }
}
const reply = (finish_reason: string, content: string) => ({ choices: [{ finish_reason, message: { content } }], usage: { prompt_tokens: 1000, completion_tokens: 200 } })
const ok = (json: object) => reply('stop', JSON.stringify(json))
const LABEL = { found: true, product_name: 'Glow Serum', ingredients: [' Aqua (Water)', 'Retinol', ''], unreadable: false }
const INSTALL = 'install-0001'

function setup(opts: Partial<Parameters<typeof createApp>[0]> = {}) {
  const db = openDb(':memory:', bundled)
  const fake = fakeClient(ok(LABEL))
  const app = createApp({ db, client: fake.client, ...opts })
  const req = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
    app.request(path, { method, headers: { 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4', ...headers }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) })
  return { db, app, req, calls: fake.calls }
}

async function adminSession(s: ReturnType<typeof setup>) {
  const res = await s.req('POST', '/admin/api/login', { password: 'correct horse' })
  assert.equal(res.status, 200)
  const cookie = res.headers.get('set-cookie')!.split(';')[0]
  return (method: string, path: string, body?: unknown) => s.req(method, path, body, { cookie })
}
const withAdmin = () => setup({ adminPasswordHash: hashPassword('correct horse'), sessionSecret: 'test-secret' })

test('OCR: transcribes a label, sends only the photo, logs usage and cost', async () => {
  const s = setup()
  const res = await s.req('POST', '/api/ocr', { image: 'data:image/jpeg;base64,AAAA', media_type: 'image/jpeg' })
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { found: true, product_name: 'Glow Serum', ingredients: ['Aqua (Water)', 'Retinol'], unreadable: false })
  const p = s.calls[0]
  assert.equal(p.model, MODEL)
  assert.equal(p.response_format.type, 'json_object')
  assert.deepEqual(p.messages[1].content[0], { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } })
  const log = s.db.get<any>('SELECT * FROM ocr_logs')!
  assert.equal(log.status, 200)
  assert.equal(log.ingredients, 2)
  assert.equal(log.cost, (1000 * 0.3 + 200 * 1.2) / 1e6)
  assert.notEqual(log.ip_hash, '1.2.3.4')
})

test('OCR: bad input is rejected before the model is called', async () => {
  const s = setup()
  assert.equal((await s.req('POST', '/api/ocr', { image: 'not base64!' })).status, 400)
  assert.equal((await s.req('POST', '/api/ocr', { image: 'AAAA', media_type: 'image/gif' })).status, 400)
  assert.equal((await s.req('POST', '/api/ocr', JSON.stringify({ image: 'A'.repeat(9 * 1024 * 1024) }))).status, 413)
  assert.equal((await s.req('GET', '/nope')).status, 404)
  assert.equal(s.calls.length, 0)
})

test('OCR: app token, per-IP rate limit and daily cap', async () => {
  let t = 1_800_000_000_000
  const s = setup({ appToken: 'secret-token', now: () => t })
  assert.equal((await s.req('POST', '/api/ocr', { image: 'AAAA' })).status, 401)
  assert.equal((await s.req('POST', '/api/ocr', { image: 'AAAA' }, { 'x-app-token': 'wrong' })).status, 401)
  const h = { 'x-app-token': 'secret-token' }
  for (let i = 0; i < 30; i++) assert.equal((await s.req('POST', '/api/ocr', { image: 'AAAA' }, h)).status, 200)
  assert.equal((await s.req('POST', '/api/ocr', { image: 'AAAA' }, h)).status, 429)
  t += 3600_000
  assert.equal((await s.req('POST', '/api/ocr', { image: 'AAAA' }, h)).status, 200)

  s.db.saveSettings({ ...s.db.settings(), ocrDailyCap: 31 })
  assert.equal((await s.req('POST', '/api/ocr', { image: 'AAAA' }, { ...h, 'x-forwarded-for': '5.5.5.5' })).status, 503)
})

test('OCR: filtered, truncated, malformed and upstream errors become clean errors', async () => {
  for (const [r, status] of [[reply('content_filter', ''), 422], [reply('length', '{"found":'), 502], [reply('stop', '{"found":true}'), 502]] as const) {
    const db = openDb(':memory:', bundled)
    const res = await createApp({ db, client: fakeClient(r).client }).request('/api/ocr', { method: 'POST', body: JSON.stringify({ image: 'AAAA' }) })
    assert.equal(res.status, status)
    assert.equal(db.get<any>('SELECT status, input_tokens FROM ocr_logs')!.input_tokens, 1000) // tokens spent are still counted
  }
  for (const [upstream, status] of [[429, 503], [500, 503], [401, 502]]) {
    const app = createApp({ db: openDb(':memory:', bundled), client: { chat: async () => { throw new UpstreamError(upstream, 'x') } } })
    assert.equal((await app.request('/api/ocr', { method: 'POST', body: JSON.stringify({ image: 'AAAA' }) })).status, status)
  }
})

test('events: anonymous, sanitized, bounded', async () => {
  const s = setup()
  const res = await s.req('POST', '/api/events', {
    source: 'app', install_id: INSTALL, platform: 'ios', app_version: '1.0.0',
    events: [
      { name: 'product_saved', props: { method: 'barcode', unknown_count: 2, nested: { x: 1 }, 'Bad-Key': 'x' } },
      { name: 'DROP TABLE', props: {} },
      { name: 'app_open', ts: Date.now() + 10 * 86400_000 },
    ],
  })
  assert.deepEqual(await res.json(), { ok: true, accepted: 2 })
  const rows = s.db.all<any>('SELECT name, props FROM events ORDER BY id')
  assert.deepEqual(rows.map(r => r.name), ['product_saved', 'app_open'])
  assert.deepEqual(JSON.parse(rows[0].props), { method: 'barcode', unknown_count: 2 })
  assert.equal((await s.req('POST', '/api/events', { install_id: 'x', events: [] })).status, 400)
})

test('reports, submissions, unknowns and product lookup', async () => {
  const s = setup()
  assert.equal((await s.req('POST', '/api/reports', { install_id: INSTALL, kind: 'other', product_name: 'X', message: '' })).status, 400)
  assert.equal((await s.req('POST', '/api/reports', { install_id: INSTALL, kind: 'ingredients', product_name: 'Glow', message: 'missing retinol', contact: 'not-an-email', barcode: '12-34' })).status, 200)
  const r = s.db.get<any>('SELECT * FROM reports')!
  assert.equal(r.contact, '')
  assert.equal(r.barcode, '1234')

  assert.equal((await s.req('GET', '/api/products/0123456789012')).status, 404)
  assert.equal((await s.req('POST', '/api/submissions', { install_id: INSTALL, barcode: '0123456789012', name: 'Glow', raw: 'Aqua, Retinol' })).status, 200)

  await s.req('POST', '/api/unknowns', { install_id: INSTALL, tokens: ['Glitter Dust', 'glitter dust', 'x'] })
  await s.req('POST', '/api/unknowns', { install_id: INSTALL, tokens: ['glitter dust'] })
  await s.req('POST', '/api/unknowns', { install_id: 'install-0002', tokens: ['glitter dust'] })
  assert.deepEqual(s.db.get<any>('SELECT token, count, installs FROM unknowns'), { token: 'glitter dust', count: 3, installs: 2 })
})

test('waitlist and Stripe presale webhook', async () => {
  const s = setup({ stripeWebhookSecret: 'whsec_test' })
  assert.equal((await s.req('POST', '/api/waitlist', { email: 'nope' })).status, 400)
  assert.equal((await s.req('POST', '/api/waitlist', { email: 'Parent@Example.com', hook: 'b' })).status, 200)
  assert.deepEqual(s.db.get<any>('SELECT email, hook FROM waitlist'), { email: 'parent@example.com', hook: 'b' })

  const event = JSON.stringify({ type: 'checkout.session.completed', created: Math.floor(Date.now() / 1000), data: { object: {
    id: 'cs_1', payment_status: 'paid', client_reference_id: 'hook-a', amount_total: 1999, currency: 'usd', payment_intent: 'pi_1', customer_details: { email: 'mom@example.com' } } } })
  const t = Math.floor(Date.now() / 1000)
  const sig = createHmac('sha256', 'whsec_test').update(`${t}.${event}`).digest('hex')
  assert.equal((await s.req('POST', '/api/stripe/webhook', event, { 'stripe-signature': `t=${t},v1=deadbeef` })).status, 400)
  assert.equal((await s.req('POST', '/api/stripe/webhook', event, { 'stripe-signature': `t=${t},v1=${sig}` })).status, 200)
  assert.deepEqual(s.db.get<any>('SELECT email, amount, hook, status FROM presales'), { email: 'mom@example.com', amount: 1999, hook: 'a', status: 'paid' })

  const refund = JSON.stringify({ type: 'charge.refunded', created: t, data: { object: { payment_intent: 'pi_1' } } })
  const sig2 = createHmac('sha256', 'whsec_test').update(`${t}.${refund}`).digest('hex')
  await s.req('POST', '/api/stripe/webhook', refund, { 'stripe-signature': `t=${t},v1=${sig2}` })
  assert.equal(s.db.get<any>('SELECT status FROM presales')!.status, 'refunded')
})

test('survey: whitelisted answers, one per visitor, summarized in admin', async () => {
  const s = withAdmin()
  const admin = await adminSession(s)
  assert.equal((await s.req('POST', '/api/survey', { visitor_id: 'w-visitor-01', kids: ['nope'] })).status, 400)
  await s.req('POST', '/api/survey', { visitor_id: 'w-visitor-01', hook: 'a', kids: ['8-12', '8-12', 'x'], checks: 'google', price: 'fair', email: 'a@b.co' })
  await s.req('POST', '/api/survey', { visitor_id: 'w-visitor-01', hook: 'a', kids: ['8-12', '13-17'], checks: 'label', price: 'easy' })
  await s.req('POST', '/api/survey', { visitor_id: 'w-visitor-02', kids: ['13-17'], price: 'too_much' })
  const r = await (await admin('GET', '/admin/api/survey')).json()
  assert.equal(r.total, 2)
  assert.deepEqual(r.kids.find((k: any) => k.k === '8-12'), { k: '8-12', n: 1 })
  assert.deepEqual(r.tweenPrice.find((k: any) => k.k === 'easy'), { k: 'easy', n: 1 })
  assert.equal(r.recent.find((x: any) => x.checks === 'label').email, '')
})

test('admin: login required, wrong password locks out', async () => {
  const s = withAdmin()
  assert.equal((await s.req('GET', '/admin/api/overview')).status, 401)
  for (let i = 0; i < 5; i++) assert.equal((await s.req('POST', '/admin/api/login', { password: 'wrong' })).status, 401)
  const locked = await s.req('POST', '/admin/api/login', { password: 'correct horse' })
  assert.match((await locked.json()).error, /15 分钟/)
  assert.equal((await withAdmin().req('GET', '/admin')).status, 200) // the page itself loads; its API is what's gated
})

test('admin: dashboards answer with seeded data', async () => {
  const s = withAdmin()
  const admin = await adminSession(s)
  await s.req('POST', '/api/events', { source: 'web', install_id: 'web-visitor-1', events: [{ name: 'page_view', props: { hook: 'a', utm_source: 'tiktok' } }, { name: 'cta_click', props: { hook: 'a' } }] })
  await s.req('POST', '/api/events', { source: 'app', install_id: INSTALL, events: [{ name: 'app_open' }, { name: 'onboarding_done' }, { name: 'product_saved', props: { method: 'photo' } }] })
  await s.req('POST', '/api/ocr', { image: 'AAAA' })
  const o = await (await admin('GET', '/admin/api/overview?days=7')).json()
  assert.equal(o.landing.visitors, 1)
  assert.equal(o.landing.clicks, 1)
  assert.equal(o.app.newInstalls, 1)
  assert.equal(o.ocr.calls, 1)
  const l = await (await admin('GET', '/admin/api/landing')).json()
  assert.deepEqual(l.hooks[0], { hook: 'a', visitors: 1, clicks: 1, waitlist: 0, presales: 0 })
  assert.equal(l.sources[0].source, 'tiktok')
  const u = await (await admin('GET', '/admin/api/usage')).json()
  assert.deepEqual(u.funnel.slice(0, 3).map((f: any) => f.n), [1, 1, 1])
  assert.equal((await admin('GET', '/admin/api/ocr')).status, 200)
})

test('admin: unknown ingredient -> alias in draft -> publish -> app downloads new pack', async () => {
  const s = withAdmin()
  const admin = await adminSession(s)
  await s.req('POST', '/api/unknowns', { install_id: INSTALL, tokens: ['eau thermale', 'vitamin b5'] })
  let u = await (await admin('GET', '/admin/api/unknowns')).json()
  assert.deepEqual(u.rows.map((r: any) => r.token).sort(), ['eau thermale', 'vitamin b5'])

  assert.equal((await admin('POST', '/admin/api/unknowns/vitamin%20b5/map', { inci: 'nonexistent' })).status, 400)
  assert.equal((await admin('POST', '/admin/api/unknowns/vitamin%20b5/map', { inci: 'panthenol' })).status, 200)
  assert.equal((await admin('POST', `/admin/api/unknowns/${encodeURIComponent('eau thermale')}/add`, { group: 'base' })).status, 200)
  u = await (await admin('GET', '/admin/api/unknowns')).json()
  assert.equal(u.rows.length, 0)

  const before = await (await admin('GET', '/admin/api/rule-pack')).json()
  assert.equal(before.changed, true)
  const next = bundled.version.replace(/\d+$/, n => String(Number(n) + 1))
  assert.equal(before.nextVersion, next)
  const pub = await (await admin('POST', '/admin/api/rule-pack/publish', { note: 'add b5' })).json()
  assert.equal(pub.version, next)
  const live = await (await s.req('GET', '/api/rule-pack')).json()
  assert.equal(live.version, next)
  assert.equal(live.pack.aliases['vitamin b5'], 'panthenol')
  assert.equal((await admin('POST', '/admin/api/rule-pack/publish', {})).status, 400) // nothing changed
})

test('admin: a broken draft cannot be published; preview compares draft and live', async () => {
  const s = withAdmin()
  const admin = await adminSession(s)
  const broken = structuredClone(bundled)
  broken.rules[0].group = 'nope'
  const saved = await (await admin('PUT', '/admin/api/rule-pack/draft', { pack: broken })).json()
  assert.equal(saved.errors.length, 1)
  const res = await admin('POST', '/admin/api/rule-pack/publish', {})
  assert.equal(res.status, 400)
  assert.equal((await res.json()).errors.length, 1)

  const fixed = structuredClone(bundled)
  fixed.rules.find(r => r.id === 'R-FRA-AGE-01')!.severity = 'not_recommended'
  await admin('PUT', '/admin/api/rule-pack/draft', { pack: fixed })
  const p = await (await admin('POST', '/admin/api/preview', { raw: 'Aqua, Parfum', member: { ageBand: '8-12' } })).json()
  assert.equal(p.draft.verdicts[0].severity, 'not_recommended')
  assert.equal(p.published.verdicts[0].severity, 'care')
})

test('admin: submissions become library products the app finds by barcode', async () => {
  const s = withAdmin()
  const admin = await adminSession(s)
  await s.req('POST', '/api/submissions', { install_id: INSTALL, barcode: '0123456789012', name: 'Glow', raw: 'Aqua, Retinol' })
  const [sub] = await (await admin('GET', '/admin/api/submissions')).json()
  assert.equal((await admin('POST', `/admin/api/submissions/${sub.id}/accept`, { name: 'Glow Serum' })).status, 200)
  const p = await (await s.req('GET', '/api/products/0123456789012')).json()
  assert.equal(p.name, 'Glow Serum')
  assert.equal(p.raw, 'Aqua, Retinol')
  assert.equal((await admin('PUT', '/admin/api/products/abc', { name: 'x', raw: 'y' })).status, 400)
})

test('a newer bundled pack is published on startup; an untouched draft follows it', () => {
  const file = `${process.env.TEMP ?? '/tmp'}/pearlkin-test-${process.pid}.db`
  const old = { ...structuredClone(bundled), version: '0.0.9' }
  openDb(file, old).close()
  const db = openDb(file, bundled)
  assert.equal(db.published().version, bundled.version)
  assert.equal(db.draft().version, bundled.version)
  db.close()
})

test('retention: old events and logs are pruned', () => {
  const db = openDb(':memory:', bundled)
  const old = Date.now() - 800 * 86400_000
  db.run("INSERT INTO events (ts, source, install_id, name) VALUES (?, 'app', 'install-0001', 'app_open')", old)
  db.run("INSERT INTO events (ts, source, install_id, name) VALUES (?, 'app', 'install-0001', 'app_open')", Date.now())
  db.prune()
  assert.equal(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM events')!.n, 1)
})

test('admin: settings validate and flow into the public config', async () => {
  const s = withAdmin()
  const admin = await adminSession(s)
  assert.equal((await admin('PUT', '/admin/api/settings', { checkoutUrl: 'https://evil.example.com/pay' })).status, 400)
  await admin('PUT', '/admin/api/settings', { checkoutUrl: 'https://buy.stripe.com/test_123', paywallEnabled: true, free: { scansPerMonth: 3, members: 9 } })
  const cfg = await (await s.req('GET', '/api/config')).json()
  assert.equal(cfg.checkoutUrl, 'https://buy.stripe.com/test_123')
  assert.equal(cfg.paywallEnabled, true)
  assert.deepEqual(cfg.free, { scansPerMonth: 3, members: 6, showReasons: false, routine: false })
  assert.equal(cfg.rulePackVersion, bundled.version)
  const csv = await (await admin('GET', '/admin/api/export/waitlist.csv')).text()
  assert.equal(csv, '')
})
