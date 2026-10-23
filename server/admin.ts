// Admin API behind /admin/api. Every route except login requires the signed session cookie.
import type { Context, Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { checkProduct, compareVersions, normalize, validatePack, type Member, type Pack } from '../engine/engine.ts'
import { adminAuth } from './auth.ts'
import { DEFAULT_SETTINGS, type Db, type Question, type Settings } from './db.ts'
import { MODEL, type ChatClient } from './ocr.ts'
import { str, SURVEY } from './public.ts'

const DAY = 24 * 3600_000
// Daily buckets in China time: the person running this reads the charts in Beijing.
const DAY_SQL = (col: string) => `date(${col} / 1000 + 8 * 3600, 'unixepoch')`

export type AdminDeps = {
  db: Db
  ai: ChatClient
  passwordHash?: string
  sessionSecret: string
  status: { deepseekKey: boolean; stripeWebhook: boolean; appToken: boolean; email: boolean; revenueCat: boolean }
  now: () => number
  clientIp: (c: Context) => string
}

const days = (c: Context, fallback = 7) => Math.min(365, Math.max(1, Number(c.req.query('days')) || fallback))

function bumpPatch(v: string) {
  const [a, b, c] = v.split('.').map(Number)
  return `${a}.${b}.${c + 1}`
}

const sameContent = (a: Pack, b: Pack) => JSON.stringify({ ...a, version: '' }) === JSON.stringify({ ...b, version: '' })

const csv = (rows: Record<string, unknown>[]) => {
  if (!rows.length) return ''
  const cols = Object.keys(rows[0])
  const cell = (v: unknown) => {
    const s = v == null ? '' : String(v)
    // Leading = + - @ would run as a formula in Excel.
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
  }
  return '﻿' + [cols.join(','), ...rows.map(r => cols.map(k => cell(r[k])).join(','))].join('\n')
}

export function adminRoutes(app: Hono, d: AdminDeps) {
  const { db } = d
  const auth = adminAuth({ passwordHash: d.passwordHash, secret: d.sessionSecret, now: d.now, clientIp: d.clientIp })

  app.use('/admin/api/*', bodyLimit({ maxSize: 2 * 1024 * 1024 }))
  app.post('/admin/api/login', async c => {
    const b = await c.req.json().catch(() => ({}))
    const r = await auth.login(c, str(b.password, 200))
    return r.ok ? c.json({ ok: true }) : c.json({ error: r.error }, 401)
  })
  app.post('/admin/api/logout', c => { auth.logout(c); return c.json({ ok: true }) })
  app.use('/admin/api/*', auth.requireAdmin)
  app.get('/admin/api/me', c => c.json({ ok: true }))

  // ---------- dashboards ----------

  app.get('/admin/api/overview', c => {
    const n = days(c), since = d.now() - n * DAY
    const one = <T = number>(sql: string, ...a: (string | number)[]) => (Object.values(db.get(sql, ...a) ?? { v: 0 })[0] ?? 0) as T
    const s = db.settings()
    const draft = db.draft(), pub = db.published()
    return c.json({
      days: n,
      landing: {
        visitors: one("SELECT COUNT(DISTINCT install_id) FROM events WHERE source = 'web' AND name = 'page_view' AND ts >= ?", since),
        clicks: one("SELECT COUNT(DISTINCT install_id) FROM events WHERE source = 'web' AND name = 'cta_click' AND ts >= ?", since),
        waitlist: one('SELECT COUNT(*) FROM waitlist WHERE ts >= ?', since),
        presales: one("SELECT COUNT(*) FROM presales WHERE status = 'paid'"),
        presaleTarget: s.presaleTarget,
      },
      app: {
        newInstalls: one("SELECT COUNT(*) FROM (SELECT install_id FROM events WHERE source = 'app' GROUP BY install_id HAVING MIN(ts) >= ?)", since),
        active: one("SELECT COUNT(DISTINCT install_id) FROM events WHERE source = 'app' AND ts >= ?", since),
        products: one("SELECT COUNT(*) FROM events WHERE name = 'product_saved' AND ts >= ?", since),
        purchases: one("SELECT COUNT(*) FROM events WHERE name = 'purchase' AND json_extract(props, '$.result') = 'success' AND ts >= ?", since),
      },
      ocr: db.get('SELECT COUNT(*) AS calls, SUM(status != 200) AS failed, ROUND(COALESCE(SUM(cost), 0), 4) AS cost FROM ocr_logs WHERE ts >= ?', since),
      queue: {
        reports: one("SELECT COUNT(*) FROM reports WHERE status != 'done'"),
        submissions: one("SELECT COUNT(*) FROM submissions WHERE status = 'new'"),
        unknowns: unknownRows(db, draft, 'new', 1000).length,
      },
      rulePack: {
        published: pub.version, draftChanged: !sameContent(draft, pub.pack),
        unreviewed: draft.rules.filter(r => !r.reviewed_by).length, rules: draft.rules.length,
        todoSources: draft.rules.filter(r => r.sources.some(x => /TODO/i.test(x.ref))).length,
      },
      daily: db.all(`
        SELECT day, SUM(web) AS visitors, SUM(app) AS active, SUM(ocr) AS ocr FROM (
          SELECT ${DAY_SQL('ts')} AS day, COUNT(DISTINCT CASE WHEN source = 'web' AND name = 'page_view' THEN install_id END) AS web,
                 COUNT(DISTINCT CASE WHEN source = 'app' THEN install_id END) AS app, 0 AS ocr
            FROM events WHERE ts >= ? GROUP BY day
          UNION ALL
          SELECT ${DAY_SQL('ts')} AS day, 0, 0, COUNT(*) FROM ocr_logs WHERE ts >= ? GROUP BY day
        ) GROUP BY day ORDER BY day`, since, since),
    })
  })

  app.get('/admin/api/landing', c => {
    const n = days(c, 30), since = d.now() - n * DAY
    const hook = "COALESCE(json_extract(props, '$.hook'), '')"
    const byHook = db.all(`
      SELECT ${hook} AS hook,
        COUNT(DISTINCT CASE WHEN name = 'page_view' THEN install_id END) AS visitors,
        COUNT(DISTINCT CASE WHEN name = 'cta_click' THEN install_id END) AS clicks
      FROM events WHERE source = 'web' AND ts >= ? GROUP BY hook ORDER BY hook`, since) as { hook: string; visitors: number; clicks: number }[]
    const waitlist = Object.fromEntries(db.all<{ hook: string; n: number }>('SELECT hook, COUNT(*) AS n FROM waitlist WHERE ts >= ? GROUP BY hook', since).map(r => [r.hook, r.n]))
    const presales = Object.fromEntries(db.all<{ hook: string; n: number }>("SELECT hook, COUNT(*) AS n FROM presales WHERE status = 'paid' GROUP BY hook").map(r => [r.hook, r.n]))
    const hooks = [...new Set([...byHook.map(r => r.hook), ...Object.keys(waitlist), ...Object.keys(presales)])].sort()
    return c.json({
      days: n,
      hooks: hooks.map(h => {
        const r = byHook.find(x => x.hook === h) ?? { visitors: 0, clicks: 0 }
        return { hook: h || '(无)', visitors: r.visitors, clicks: r.clicks, waitlist: waitlist[h] ?? 0, presales: presales[h] ?? 0 }
      }),
      sources: db.all(`
        SELECT COALESCE(NULLIF(json_extract(props, '$.utm_source'), ''), NULLIF(json_extract(props, '$.ref'), ''), '直接访问') AS source,
          COUNT(DISTINCT install_id) AS visitors
        FROM events WHERE source = 'web' AND name = 'page_view' AND ts >= ? GROUP BY source ORDER BY visitors DESC LIMIT 20`, since),
      daily: db.all(`
        SELECT ${DAY_SQL('ts')} AS day,
          COUNT(DISTINCT CASE WHEN name = 'page_view' THEN install_id END) AS visitors,
          COUNT(DISTINCT CASE WHEN name = 'cta_click' THEN install_id END) AS clicks
        FROM events WHERE source = 'web' AND ts >= ? GROUP BY day ORDER BY day`, since),
    })
  })

  app.get('/admin/api/usage', c => {
    const n = days(c, 30), since = d.now() - n * DAY
    const count = (name: string, extra = '') => (db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM events WHERE name = ? AND ts >= ? ${extra}`, name, since)!.n)
    const breakdown = (name: string, prop: string) => db.all(
      `SELECT COALESCE(json_extract(props, '$.${prop}'), '') AS k, COUNT(*) AS n FROM events WHERE name = ? AND ts >= ? GROUP BY k ORDER BY n DESC`, name, since)
    // Funnel over installs first seen in the window.
    const reached = (name: string, extra = '') => db.get<{ n: number }>(`
      SELECT COUNT(DISTINCT e.install_id) AS n FROM events e
      JOIN (SELECT install_id FROM events WHERE source = 'app' GROUP BY install_id HAVING MIN(ts) >= ?) f ON f.install_id = e.install_id
      WHERE e.name = ? ${extra}`, since, name)!.n
    const newInstalls = db.get<{ n: number }>("SELECT COUNT(*) AS n FROM (SELECT install_id FROM events WHERE source = 'app' GROUP BY install_id HAVING MIN(ts) >= ?)", since)!.n
    const twoProducts = db.get<{ n: number }>(`
      SELECT COUNT(*) AS n FROM (SELECT e.install_id FROM events e
        JOIN (SELECT install_id FROM events WHERE source = 'app' GROUP BY install_id HAVING MIN(ts) >= ?) f ON f.install_id = e.install_id
        WHERE e.name = 'product_saved' GROUP BY e.install_id HAVING COUNT(*) >= 2)`, since)!.n
    const active = db.get<{ n: number }>("SELECT COUNT(DISTINCT install_id) AS n FROM events WHERE source = 'app' AND ts >= ?", since)!.n
    const products = count('product_saved')
    return c.json({
      days: n,
      active,
      funnel: [
        { step: '新安装', n: newInstalls },
        { step: '添加完家人', n: reached('onboarding_done') },
        { step: '查了第 1 个产品', n: reached('product_saved') },
        { step: '查了 2 个以上产品', n: twoProducts },
        { step: '看到付费墙', n: reached('paywall_view') },
        { step: '付费成功', n: reached('purchase', "AND json_extract(e.props, '$.result') = 'success'") },
      ],
      // Stop-loss G3: average products checked per active install per week should be >= 1.
      perWeek: active ? Math.round((products / active / Math.max(1, n / 7)) * 100) / 100 : 0,
      products,
      reports: db.get<{ n: number }>('SELECT COUNT(*) AS n FROM reports WHERE ts >= ?', since)!.n,
      barcode: breakdown('scan_barcode', 'result'),
      methods: breakdown('product_saved', 'method'),
      photo: breakdown('label_photo', 'result'),
      paywall: breakdown('paywall_view', 'trigger'),
      purchases: breakdown('purchase', 'result'),
      limits: breakdown('limit_hit', 'kind'),
      platforms: db.all("SELECT platform AS k, COUNT(DISTINCT install_id) AS n FROM events WHERE source = 'app' AND ts >= ? GROUP BY platform ORDER BY n DESC", since),
      versions: db.all("SELECT app_version AS k, COUNT(DISTINCT install_id) AS n FROM events WHERE source = 'app' AND ts >= ? GROUP BY app_version ORDER BY n DESC LIMIT 10", since),
      daily: db.all(`SELECT ${DAY_SQL('ts')} AS day, COUNT(DISTINCT install_id) AS active,
          SUM(name = 'product_saved') AS products FROM events WHERE source = 'app' AND ts >= ? GROUP BY day ORDER BY day`, since),
      errors: db.all(`SELECT ts, platform, app_version, json_extract(props, '$.message') AS message, json_extract(props, '$.screen') AS screen
        FROM events WHERE name = 'error' ORDER BY ts DESC LIMIT 30`),
    })
  })

  app.get('/admin/api/ocr', c => {
    const n = days(c, 30), since = d.now() - n * DAY, now = d.now()
    const s = db.settings()
    return c.json({
      days: n,
      cap: s.ocrDailyCap,
      today: db.get<{ n: number }>('SELECT COUNT(*) AS n FROM ocr_logs WHERE ts >= ? AND status = 200', now - (now % DAY))!.n,
      totals: db.get(`SELECT COUNT(*) AS calls, SUM(status != 200) AS failed, ROUND(AVG(ms)) AS avg_ms,
        ROUND(COALESCE(SUM(cost), 0), 4) AS cost, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens,
        COUNT(DISTINCT ip_hash) AS people FROM ocr_logs WHERE ts >= ?`, since),
      daily: db.all(`SELECT ${DAY_SQL('ts')} AS day, COUNT(*) AS calls, SUM(status != 200) AS failed, ROUND(SUM(cost), 4) AS cost
        FROM ocr_logs WHERE ts >= ? GROUP BY day ORDER BY day`, since),
      errors: db.all(`SELECT error, COUNT(*) AS n FROM ocr_logs WHERE ts >= ? AND error != '' GROUP BY error ORDER BY n DESC LIMIT 10`, since),
      topIps: db.all(`SELECT ip_hash, COUNT(*) AS n FROM ocr_logs WHERE ts >= ? GROUP BY ip_hash ORDER BY n DESC LIMIT 5`, now - DAY),
      recent: db.all('SELECT ts, ip_hash, status, ms, input_tokens, output_tokens, cost, ingredients, error FROM ocr_logs ORDER BY ts DESC LIMIT 50'),
    })
  })

  // ---------- reports ----------

  app.get('/admin/api/reports', c => {
    const status = c.req.query('status')
    return c.json(status
      ? db.all('SELECT * FROM reports WHERE status = ? ORDER BY ts DESC LIMIT 200', status)
      : db.all("SELECT * FROM reports ORDER BY status = 'done', ts DESC LIMIT 200"))
  })
  app.patch('/admin/api/reports/:id', async c => {
    const b = await c.req.json()
    const status = ['new', 'doing', 'done'].includes(b.status) ? b.status : null
    db.run('UPDATE reports SET status = COALESCE(?, status), note = COALESCE(?, note), updated_at = ? WHERE id = ?',
      status, typeof b.note === 'string' ? b.note.slice(0, 2000) : null, d.now(), Number(c.req.param('id')))
    return c.json({ ok: true })
  })

  // ---------- product library ----------

  app.get('/admin/api/products', c => {
    const q = `%${str(c.req.query('q'), 100)}%`
    return c.json(db.all('SELECT * FROM products WHERE barcode LIKE ? OR name LIKE ? OR brand LIKE ? ORDER BY updated_at DESC LIMIT 200', q, q, q))
  })
  const saveProduct = (barcode: string, b: Record<string, unknown>, source: string) => {
    const name = str(b.name, 200), raw = str(b.raw, 5000)
    if (!/^\d{6,20}$/.test(barcode) || !name || !raw) return '条形码（6–20 位数字）、名称、成分表都要填'
    db.run(`INSERT INTO products (barcode, name, brand, raw, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(barcode) DO UPDATE SET name = excluded.name, brand = excluded.brand, raw = excluded.raw, source = excluded.source, updated_at = excluded.updated_at`,
      barcode, name, str(b.brand, 120), raw, source, d.now(), d.now())
    return null
  }
  app.put('/admin/api/products/:barcode', async c => {
    const err = saveProduct(c.req.param('barcode'), await c.req.json(), 'admin')
    return err ? c.json({ error: err }, 400) : c.json({ ok: true })
  })
  app.delete('/admin/api/products/:barcode', c => {
    db.run('DELETE FROM products WHERE barcode = ?', c.req.param('barcode'))
    return c.json({ ok: true })
  })

  app.get('/admin/api/submissions', c => c.json(db.all(`
    SELECT s.*, (SELECT COUNT(*) FROM submissions x WHERE x.barcode = s.barcode) AS same_barcode,
      EXISTS(SELECT 1 FROM products p WHERE p.barcode = s.barcode) AS in_library
    FROM submissions s WHERE s.status = ? ORDER BY s.ts DESC LIMIT 200`, c.req.query('status') ?? 'new')))
  app.post('/admin/api/submissions/:id/accept', async c => {
    const sub = db.get<{ barcode: string; name: string; brand: string; raw: string }>('SELECT * FROM submissions WHERE id = ?', Number(c.req.param('id')))
    if (!sub) return c.json({ error: '找不到这条补录' }, 404)
    const b = await c.req.json().catch(() => ({}))
    const err = saveProduct(sub.barcode, { name: b.name ?? sub.name, brand: b.brand ?? sub.brand, raw: b.raw ?? sub.raw }, 'user')
    if (err) return c.json({ error: err }, 400)
    // Accepting one closes every pending submission for the same barcode.
    db.run("UPDATE submissions SET status = 'accepted', updated_at = ? WHERE barcode = ? AND status = 'new'", d.now(), sub.barcode)
    return c.json({ ok: true })
  })
  app.post('/admin/api/submissions/:id/reject', c => {
    db.run("UPDATE submissions SET status = 'rejected', updated_at = ? WHERE id = ?", d.now(), Number(c.req.param('id')))
    return c.json({ ok: true })
  })

  // ---------- unknown ingredients -> draft rule pack ----------

  app.get('/admin/api/unknowns', c => c.json({
    rows: unknownRows(db, db.draft(), c.req.query('status') ?? 'new', 300),
    inci: [...new Set(db.draft().groups.flatMap(g => g.members))].sort(),
    groups: db.draft().groups.map(g => g.id),
  }))
  // AI suggestion for unknown names (often Chinese or brand-specific): standard INCI and which group it belongs in.
  // Only a suggestion: nothing changes until the admin clicks map / add.
  app.post('/admin/api/unknowns/suggest', async c => {
    const b = await c.req.json().catch(() => ({}))
    const tokens = (Array.isArray(b.tokens) ? b.tokens : []).map((x: unknown) => str(x, 80)).filter(Boolean).slice(0, 40)
    if (!tokens.length) return c.json([])
    const draft = db.draft()
    const groups = draft.groups.map(g => `${g.id}: ${(g.functions ?? []).join(', ')}; e.g. ${g.members.slice(0, 4).join(', ')}`).join('\n')
    try {
      const res = await d.ai.chat({
        model: MODEL, max_tokens: 4000, temperature: 0, thinking: { type: 'disabled' }, response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: `You map cosmetic ingredient names, as printed on labels in any language, to their standard INCI name in lowercase English.
For each name give: "inci" (standard INCI, lowercase; "" if it is not a real ingredient, e.g. a typo, marketing text or a brand complex), "group" (one of the group ids below if the ingredient clearly belongs to it, "base" for ordinary ingredients with no safety rule, or "" if unsure), and "note" (under 12 words, in Chinese).
Groups:\n${groups}
Reply with JSON only: {"items": [{"name": "", "inci": "", "group": "", "note": ""}]}` },
          { role: 'user', content: JSON.stringify(tokens) },
        ],
      })
      const out = JSON.parse(res.choices?.[0]?.message?.content ?? '{}')
      const known = new Set(draft.groups.flatMap(g => g.members)), ids = new Set(draft.groups.map(g => g.id))
      return c.json((Array.isArray(out.items) ? out.items : []).filter((x: any) => tokens.includes(x?.name)).map((x: any) => {
        const inci = str(x.inci, 120).toLowerCase()
        return { token: x.name, inci, exists: known.has(inci), group: ids.has(x.group) ? x.group : '', note: str(x.note, 80) }
      }))
    } catch (e) {
      console.error('suggest', e instanceof Error ? e.message : e)
      return c.json({ error: 'AI 建议暂时不可用，稍后再试' }, 502)
    }
  })

  app.post('/admin/api/unknowns/:token/:action', async c => {
    const token = c.req.param('token'), action = c.req.param('action')
    const b = await c.req.json().catch(() => ({}))
    const draft = db.draft()
    if (action === 'map') {
      const inci = str(b.inci, 120).toLowerCase()
      if (!draft.groups.some(g => g.members.includes(inci))) return c.json({ error: `规则包里没有成分 "${inci}"` }, 400)
      draft.aliases[token] = inci
      db.saveDraft(draft)
      db.run("UPDATE unknowns SET status = 'mapped', mapped_to = ? WHERE token = ?", inci, token)
    } else if (action === 'add') {
      const g = draft.groups.find(x => x.id === b.group)
      if (!g) return c.json({ error: '请选择成分组' }, 400)
      const inci = str(b.inci, 120).toLowerCase() || token
      if (!g.members.includes(inci)) g.members.push(inci)
      if (inci !== token) draft.aliases[token] = inci
      db.saveDraft(draft)
      db.run("UPDATE unknowns SET status = 'mapped', mapped_to = ? WHERE token = ?", `${inci} (${g.id})`, token)
    } else if (action === 'ignore' || action === 'reopen') {
      db.run('UPDATE unknowns SET status = ? WHERE token = ?', action === 'ignore' ? 'ignored' : 'new', token)
    } else return c.json({ error: 'unknown action' }, 400)
    return c.json({ ok: true })
  })

  // ---------- rule pack ----------

  app.get('/admin/api/rule-pack', c => {
    const draft = db.draft(), pub = db.published()
    return c.json({
      draft, errors: validatePack(draft), changed: !sameContent(draft, pub.pack),
      published: { version: pub.version, note: pub.note, published_at: pub.published_at },
      nextVersion: compareVersions(draft.version, pub.version) > 0 ? draft.version : bumpPatch(pub.version),
      history: db.all('SELECT version, note, published_at FROM rule_packs ORDER BY published_at DESC LIMIT 50'),
    })
  })
  app.put('/admin/api/rule-pack/draft', async c => {
    const b = await c.req.json().catch(() => null)
    if (!b?.pack || typeof b.pack !== 'object') return c.json({ error: '规则包格式不对' }, 400)
    db.saveDraft(b.pack)
    return c.json({ ok: true, errors: validatePack(b.pack) })
  })
  app.post('/admin/api/rule-pack/publish', async c => {
    const b = await c.req.json().catch(() => ({}))
    const draft = db.draft(), pub = db.published()
    if (sameContent(draft, pub.pack)) return c.json({ error: '草稿和线上版本一样，没有要发布的改动' }, 400)
    const version = compareVersions(draft.version, pub.version) > 0 ? draft.version : bumpPatch(pub.version)
    const pack = { ...draft, version }
    const errors = validatePack(pack)
    if (errors.length) return c.json({ error: '规则包有错误，不能发布', errors }, 400)
    db.publish(pack, str(b.note, 500))
    return c.json({ ok: true, version })
  })
  app.post('/admin/api/rule-pack/load', async c => {
    const b = await c.req.json().catch(() => ({}))
    const row = db.get<{ json: string }>('SELECT json FROM rule_packs WHERE version = ?', str(b.version, 20))
    if (!row) return c.json({ error: '找不到这个版本' }, 404)
    // Loaded into the draft only; it ships after "publish" under a new version number.
    db.saveDraft({ ...JSON.parse(row.json), version: db.published().version })
    return c.json({ ok: true })
  })
  app.post('/admin/api/preview', async c => {
    const b = await c.req.json().catch(() => ({}))
    const m = b.member ?? {}
    const member: Member = {
      id: 'preview', nickname: 'Preview', ageBand: ['8-12', '13-17', '18+', '0-3', '4-7'].includes(m.ageBand) ? m.ageBand : '18+',
      lifeStage: ['pregnancy', 'breastfeeding'].includes(m.lifeStage) ? m.lifeStage : undefined,
      concerns: Array.isArray(m.concerns) ? m.concerns.filter((x: unknown) => typeof x === 'string') : [],
    }
    const raw = str(b.raw, 5000)
    const draft = db.draft()
    const errors = validatePack(draft)
    return c.json({
      draft: errors.length ? { errors } : checkProduct(raw, [member], draft),
      published: checkProduct(raw, [member], db.published().pack),
      normalized: errors.length ? null : normalize(raw, draft),
    })
  })

  // ---------- presale and waitlist ----------

  app.get('/admin/api/survey', c => {
    const rows = db.all<{ ts: number; hook: string; email: string; kids: string; checks: string; price: string }>('SELECT * FROM surveys ORDER BY ts DESC')
    const count = (field: 'kids' | 'checks' | 'price', codes: readonly string[]) => codes.map(k => ({
      k, n: rows.filter(r => r[field].split(',').includes(k)).length,
    }))
    const tweens = rows.filter(r => r.kids.split(',').includes('8-12'))
    return c.json({
      total: rows.length,
      kids: count('kids', SURVEY.kids),
      checks: count('checks', SURVEY.checks),
      price: count('price', SURVEY.price),
      // The core audience: parents of 8-12 year olds. Their price answers matter most.
      tweenPrice: SURVEY.price.map(k => ({ k, n: tweens.filter(r => r.price === k).length })),
      recent: rows.slice(0, 50),
    })
  })

  app.get('/admin/api/presales', c => c.json({
    rows: db.all('SELECT * FROM presales ORDER BY ts DESC'),
    waitlist: db.all('SELECT * FROM waitlist ORDER BY ts DESC LIMIT 1000'),
    target: db.settings().presaleTarget,
  }))
  app.patch('/admin/api/presales/:id', async c => {
    const b = await c.req.json()
    const id = c.req.param('id')
    db.run('UPDATE presales SET offer_code = COALESCE(?, offer_code), note = COALESCE(?, note) WHERE session_id = ?',
      typeof b.offer_code === 'string' ? b.offer_code.trim().slice(0, 64) : null,
      typeof b.note === 'string' ? b.note.slice(0, 1000) : null, id)
    if (typeof b.code_sent === 'boolean') db.run('UPDATE presales SET code_sent_at = ? WHERE session_id = ?', b.code_sent ? d.now() : null, id)
    return c.json({ ok: true })
  })

  app.get('/admin/api/export/:name', c => {
    const name = c.req.param('name')
    const sql: Record<string, string> = {
      'waitlist.csv': "SELECT email, hook, datetime(ts / 1000, 'unixepoch') AS joined_utc FROM waitlist ORDER BY ts",
      'presales.csv': "SELECT email, amount / 100.0 AS amount, currency, hook, status, offer_code, datetime(ts / 1000, 'unixepoch') AS paid_utc FROM presales ORDER BY ts",
      'reports.csv': "SELECT id, datetime(ts / 1000, 'unixepoch') AS ts_utc, kind, status, product_name, brand, barcode, message, contact, note FROM reports ORDER BY ts",
      'unknowns.csv': 'SELECT token, count, installs, status, mapped_to FROM unknowns ORDER BY installs DESC',
      'survey.csv': "SELECT datetime(ts / 1000, 'unixepoch') AS answered_utc, hook, email, kids, checks, price FROM surveys ORDER BY ts",
    }
    if (!sql[name]) return c.json({ error: 'Not found' }, 404)
    c.header('content-type', 'text/csv; charset=utf-8')
    c.header('content-disposition', `attachment; filename="${name}"`)
    return c.body(csv(db.all(sql[name])))
  })

  // ---------- users, skin tests, questionnaire ----------

  app.get('/admin/api/users', c => {
    const q = `%${str(c.req.query('q'), 100)}%`
    return c.json(db.all(`
      SELECT u.id, u.email, u.apple_sub IS NOT NULL AS apple, u.created_at, u.last_seen, u.pro_until, u.note,
        (SELECT COUNT(*) FROM members m WHERE m.user_id = u.id) AS members,
        (SELECT COUNT(*) FROM user_products p WHERE p.user_id = u.id) AS products,
        (SELECT COUNT(*) FROM skin_reports r WHERE r.user_id = u.id) AS reports
      FROM users u WHERE COALESCE(u.email, '') LIKE ? OR u.id LIKE ? ORDER BY u.created_at DESC LIMIT 300`, q, q))
  })
  app.patch('/admin/api/users/:id', async c => {
    const b = await c.req.json().catch(() => ({}))
    if (typeof b.pro_days === 'number') {
      const days = Math.max(0, Math.min(3650, Math.round(b.pro_days)))
      db.run('UPDATE users SET pro_until = ? WHERE id = ?', days ? d.now() + days * DAY : null, c.req.param('id'))
    }
    if (typeof b.note === 'string') db.run('UPDATE users SET note = ? WHERE id = ?', b.note.slice(0, 500), c.req.param('id'))
    return c.json({ ok: true })
  })
  // Dev mode only (no email service configured): codes are shown here instead of being emailed.
  app.get('/admin/api/dev-codes', c => c.json(db.all(
    "SELECT email, dev_code, expires FROM auth_codes WHERE dev_code != '' AND expires > ? ORDER BY created_at DESC LIMIT 20", d.now())))

  app.get('/admin/api/skin', c => {
    const n = days(c, 30), since = d.now() - n * DAY
    const rows = db.all<{ result: string; user_id: string; ts: number }>('SELECT result, user_id, ts FROM skin_reports WHERE ts >= ?', since)
    const reports = rows.map(r => JSON.parse(r.result) as { skin_type: string; overall: number; dimensions: Record<string, { score: number }> })
    const dims = reports.length ? Object.keys(reports[0].dimensions) : []
    const types: Record<string, number> = {}
    for (const r of reports) types[r.skin_type] = (types[r.skin_type] ?? 0) + 1
    return c.json({
      days: n,
      tests: reports.length,
      testers: new Set(rows.map(r => r.user_id)).size,
      users: db.get<{ n: number }>('SELECT COUNT(*) AS n FROM users')!.n,
      newUsers: db.get<{ n: number }>('SELECT COUNT(*) AS n FROM users WHERE created_at >= ?', since)!.n,
      pro: db.get<{ n: number }>('SELECT COUNT(*) AS n FROM users WHERE pro_until > ?', d.now())!.n,
      avgOverall: reports.length ? Math.round(reports.reduce((s, r) => s + r.overall, 0) / reports.length) : null,
      types: Object.entries(types).map(([k, n]) => ({ k, n })).sort((a, b) => b.n - a.n),
      dims: dims.map(k => ({ k, avg: Math.round(reports.reduce((s, r) => s + r.dimensions[k].score, 0) / reports.length) })).sort((a, b) => a.avg - b.avg),
      ai: db.all(`SELECT kind, COUNT(*) AS calls, SUM(status != 200) AS failed, ROUND(COALESCE(SUM(cost), 0), 4) AS cost, ROUND(AVG(ms)) AS avg_ms
        FROM ocr_logs WHERE ts >= ? GROUP BY kind ORDER BY calls DESC`, since),
      errors: db.all(`SELECT error, COUNT(*) AS n FROM ocr_logs WHERE kind = 'skin' AND status != 200 AND ts >= ? GROUP BY error ORDER BY n DESC LIMIT 10`, since),
      daily: db.all(`SELECT ${DAY_SQL('ts')} AS day, COUNT(*) AS tests FROM skin_reports WHERE ts >= ? GROUP BY day ORDER BY day`, since),
    })
  })

  app.get('/admin/api/questions', c => c.json(db.questions()))
  app.put('/admin/api/questions', async c => {
    const b = await c.req.json().catch(() => null)
    const langs = ['en', 'zh-Hans', 'zh-Hant', 'es'] as const
    const loc = (v: any) => Object.fromEntries(langs.map(l => [l, str(v?.[l], 200)]).filter(([, x]) => x)) as Question['title']
    if (!Array.isArray(b?.questions)) return c.json({ error: '格式不对' }, 400)
    const ids = new Set<string>()
    const questions: Question[] = []
    for (const q of b.questions.slice(0, 12)) {
      const id = str(q?.id, 40)
      const title = loc(q?.title)
      const options = (Array.isArray(q?.options) ? q.options : []).slice(0, 10)
        .map((o: any) => ({ id: str(o?.id, 40), label: loc(o?.label) })).filter((o: any) => /^[a-z0-9_]+$/.test(o.id) && o.label.en)
      if (!/^[a-z0-9_]+$/.test(id) || ids.has(id)) return c.json({ error: `题目编号「${id}」要是唯一的小写字母、数字或下划线` }, 400)
      if (!title.en) return c.json({ error: `题目「${id}」缺少英文标题` }, 400)
      if (options.length < 2) return c.json({ error: `题目「${id}」至少要 2 个选项，每个选项都要有英文` }, 400)
      ids.add(id)
      questions.push({ id, type: q.type === 'multi' ? 'multi' : 'single', title, options })
    }
    db.saveQuestions(questions)
    return c.json({ ok: true, questions })
  })

  // ---------- settings ----------

  app.get('/admin/api/settings', c => c.json({ settings: db.settings(), status: { ...d.status, password: !!d.passwordHash } }))
  app.put('/admin/api/settings', async c => {
    const b = (await c.req.json()) as Partial<Settings>
    const cur = db.settings()
    const num = (v: unknown, fb: number, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fb)
    const url = str(b.checkoutUrl, 500)
    if (url && !/^https:\/\/(buy\.stripe\.com|checkout\.stripe\.com)\//.test(url)) return c.json({ error: '预售链接要是 https://buy.stripe.com/ 开头的 Stripe Payment Link' }, 400)
    const store = str(b.appStoreUrl, 300)
    if (store && !/^https:\/\/apps\.apple\.com\//.test(store)) return c.json({ error: 'App Store 链接要是 https://apps.apple.com/ 开头' }, 400)
    const free = { ...cur.free, ...(b.free ?? {}) }
    const next: Settings = {
      checkoutUrl: url,
      contactEmail: str(b.contactEmail, 200) || DEFAULT_SETTINGS.contactEmail,
      appStoreUrl: store,
      presaleTarget: num(b.presaleTarget, cur.presaleTarget, 1, 100_000),
      paywallEnabled: typeof b.paywallEnabled === 'boolean' ? b.paywallEnabled : cur.paywallEnabled,
      free: {
        scansPerMonth: num(free.scansPerMonth, cur.free.scansPerMonth, 0, 1000),
        members: num(free.members, cur.free.members, 1, 6),
        showReasons: !!free.showReasons,
        routine: !!free.routine,
      },
      ocrDailyCap: num(b.ocrDailyCap, cur.ocrDailyCap, 0, 100_000),
      priceInputPerM: num(b.priceInputPerM, cur.priceInputPerM, 0, 100),
      priceOutputPerM: num(b.priceOutputPerM, cur.priceOutputPerM, 0, 100),
    }
    db.saveSettings(next)
    return c.json({ ok: true, settings: next })
  })
}

// Unknown tokens, minus anything the draft pack already recognizes (e.g. mapped since it was reported).
function unknownRows(db: Db, draft: Pack, status: string, limit: number) {
  const rows = db.all<{ token: string; count: number; installs: number; last_ts: number; status: string; mapped_to: string }>(
    'SELECT token, count, installs, last_ts, status, mapped_to FROM unknowns WHERE status = ? ORDER BY installs DESC, count DESC LIMIT ?', status, limit * 2)
  return (status === 'new' ? rows.filter(r => !normalize(r.token, draft).inci.length) : rows).slice(0, limit)
}
