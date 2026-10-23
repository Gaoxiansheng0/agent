// AI skin analysis, the skin-test questionnaire, the user's family and shelf (synced across devices),
// and AI routine advice. The face photo is sent to the model and dropped: it is never written to disk or the database.
import { createHash } from 'node:crypto'
import type { Context, Hono, MiddlewareHandler } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { ageBandOf, evaluate, normalize, type Member } from '../engine/engine.ts'
import type { User } from './accounts.ts'
import { newId } from './accounts.ts'
import type { Db, Question } from './db.ts'
import { HttpError, MODEL, UpstreamError, type ChatClient, type Usage } from './ocr.ts'
import { limiter, ocrCost, str } from './public.ts'

export const DIMENSIONS = ['dark_circles', 'sensitivity', 'acne', 'pigmentation', 'wrinkles', 'blackheads', 'oiliness', 'eye_bags', 'pores'] as const
export type Dimension = (typeof DIMENSIONS)[number]
const LEVELS = { none: [85, 100], mild: [65, 84], moderate: [40, 64], marked: [0, 39] } as const
type Level = keyof typeof LEVELS
const SKIN_TYPES = ['dry', 'normal', 'combination', 'oily', 'sensitive'] as const
const LANG_NAMES: Record<string, string> = { en: 'English', 'zh-Hans': 'Simplified Chinese', 'zh-Hant': 'Traditional Chinese', es: 'Spanish' }
const MAKEUP = ['none', 'light', 'full'], LIGHT = ['daylight', 'indoor', 'dim']
const MIN_FACE_AGE = 13 // COPPA: no face analysis for children under 13

export type SkinReport = {
  skin_type: (typeof SKIN_TYPES)[number]
  skin_age: number | null
  overall: number
  confidence: 'high' | 'medium' | 'low'
  summary: string
  dimensions: Record<Dimension, { level: Level; score: number; note: string }>
  priorities: Dimension[]
  look_for: string[]
  avoid: string[]
  tips: string[]
}

export type SkinDeps = {
  db: Db
  ai: ChatClient
  now: () => number
  requireUser: MiddlewareHandler
  currentUser: (c: Context) => User
  isPro: (u: User) => Promise<boolean>
  appOnly: MiddlewareHandler
  ipHash: (ip: string) => string
  clientIp: (c: Context) => string
}

const SKIN_SYSTEM = `You are a cosmetic skin analyst inside a consumer skincare app. You look at one face photo and describe visible skin condition for cosmetic purposes. You never diagnose diseases or name medical conditions, and you never comment on attractiveness, identity, ethnicity or anything other than visible skin.

Rate these nine dimensions by how visible they are in the photo: dark_circles, sensitivity (visible redness or irritation), acne (active blemishes), pigmentation (spots, uneven tone), wrinkles (fine lines and wrinkles), blackheads, oiliness (shine), eye_bags, pores (visible enlarged pores).
For each give a level: "none", "mild", "moderate" or "marked", a score where higher means healthier skin (none 85-100, mild 65-84, moderate 40-64, marked 0-39), and a one-sentence note on where and what you see.

Also give: skin_type (dry, normal, combination, oily or sensitive; use the questionnaire answers together with the photo), skin_age (your estimate of how old the skin looks, integer, or null if you can't tell), overall (0-100, a weighted view of the nine scores), confidence ("high", "medium" or "low"; lower it for makeup, dim light, blur or an angled face), summary (two warm, specific sentences), priorities (the 1-3 dimensions that matter most for this person), look_for (3-5 cosmetic ingredient names that suit these priorities), avoid (0-4 ingredient names to avoid given the skin and the person's situation, e.g. retinoids in pregnancy), tips (3 short, practical routine tips).

Write summary, notes and tips in {LANG}. Ingredient names stay in English INCI form. Be honest but kind; describe, don't judge.
If there is no clearly visible human face, or it is too dark or blurry to assess, set "face_found" to false and explain in "problem" (in {LANG}).

Reply with JSON only:
{"face_found": true, "problem": "", "skin_type": "combination", "skin_age": 29, "overall": 74, "confidence": "high", "summary": "...", "dimensions": {"dark_circles": {"level": "mild", "score": 72, "note": "..."}, "...": {}}, "priorities": ["acne", "oiliness"], "look_for": ["niacinamide"], "avoid": [], "tips": ["..."]}`

const clampText = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

/** Coerces model output into a well-formed report; the level decides the score range so trends stay comparable. */
export function cleanReport(raw: Record<string, any>): SkinReport {
  const dims = {} as SkinReport['dimensions']
  for (const k of DIMENSIONS) {
    const d = raw.dimensions?.[k] ?? {}
    const level: Level = d.level in LEVELS ? d.level : 'mild'
    const [lo, hi] = LEVELS[level]
    const n = Number(d.score)
    dims[k] = { level, score: Math.round(Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : (lo + hi) / 2), note: clampText(d.note, 300) }
  }
  const avg = Math.round(DIMENSIONS.reduce((s, k) => s + dims[k].score, 0) / DIMENSIONS.length)
  const overall = Number(raw.overall)
  const list = (v: unknown, n: number, len = 80) => (Array.isArray(v) ? v.map(x => clampText(x, len)).filter(Boolean).slice(0, n) : [])
  const age = Number(raw.skin_age)
  return {
    skin_type: SKIN_TYPES.includes(raw.skin_type) ? raw.skin_type : 'normal',
    skin_age: Number.isInteger(age) && age >= 10 && age <= 90 ? age : null,
    // Keep the headline score close to the dimensions it summarizes.
    overall: Number.isFinite(overall) ? Math.round(Math.min(avg + 8, Math.max(avg - 8, overall))) : avg,
    confidence: ['high', 'medium', 'low'].includes(raw.confidence) ? raw.confidence : 'medium',
    summary: clampText(raw.summary, 500),
    dimensions: dims,
    priorities: list(raw.priorities, 3).filter((p): p is Dimension => (DIMENSIONS as readonly string[]).includes(p)),
    look_for: list(raw.look_for, 5),
    avoid: list(raw.avoid, 4),
    tips: list(raw.tips, 3, 240),
  }
}

type MemberRow = { id: string; user_id: string; name: string; birth_year: number | null; life_stage: string; concerns: string; is_self: number }
const toMember = (r: MemberRow): Member => ({
  id: r.id, nickname: r.name, birthYear: r.birth_year ?? undefined,
  lifeStage: (r.life_stage || undefined) as Member['lifeStage'], concerns: JSON.parse(r.concerns),
})

/** Skin concerns the latest report shows, added to what the person entered (used for product suitability). */
export function concernsFromReport(r: SkinReport | null): string[] {
  if (!r) return []
  const out: string[] = []
  if (r.dimensions.sensitivity.score < 65 || r.skin_type === 'sensitive') out.push('sensitive')
  if (r.dimensions.acne.score < 65 || r.dimensions.blackheads.score < 55) out.push('acne_prone')
  return out
}

export function skinRoutes(app: Hono, d: SkinDeps) {
  const { db } = d
  const perUser = limiter(20, 24 * 3600_000, d.now)
  const adviceLimit = limiter(30, 24 * 3600_000, d.now)
  const body = async (c: Context) => (await c.req.json().catch(() => ({}))) as Record<string, any>
  const logAi = (c: Context, kind: string, user: User, started: number, status: number, usage: Usage, error = '') => db.run(
    'INSERT INTO ocr_logs (ts, ip_hash, status, ms, input_tokens, output_tokens, cost, ingredients, error, kind, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)',
    started, d.ipHash(d.clientIp(c)), status, d.now() - started, usage.input, usage.output, ocrCost(usage, db.settings()), error.slice(0, 300), kind, user.id)
  const memberOf = (user: User, id: string) => db.get<MemberRow>('SELECT * FROM members WHERE id = ? AND user_id = ?', id, user.id)
  const latestReport = (user: User, memberId: string) => {
    const r = db.get<{ result: string }>('SELECT result FROM skin_reports WHERE user_id = ? AND member_id = ? ORDER BY ts DESC LIMIT 1', user.id, memberId)
    return r ? (JSON.parse(r.result) as SkinReport) : null
  }
  const failAi = (e: unknown) => {
    if (e instanceof HttpError) return { status: e.status, msg: e.message }
    if (e instanceof UpstreamError && (e.status === 429 || e.status >= 500)) return { status: 503, msg: 'Our AI is busy. Try again in a minute.' }
    console.error('ai', e instanceof Error ? e.message : e)
    return { status: 502, msg: 'Our AI is unavailable right now. Try again later.' }
  }

  app.get('/api/questions', c => {
    c.header('cache-control', 'no-cache')
    return c.json(db.questions())
  })

  // ---------- family ----------
  app.get('/api/members', d.requireUser, c => {
    const rows = db.all<MemberRow>('SELECT * FROM members WHERE user_id = ? ORDER BY is_self DESC, created_at', d.currentUser(c).id)
    return c.json(rows.map(r => ({ id: r.id, name: r.name, birth_year: r.birth_year, life_stage: r.life_stage, concerns: JSON.parse(r.concerns), is_self: !!r.is_self })))
  })
  app.put('/api/members/:id', d.requireUser, bodyLimit({ maxSize: 4096 }), async c => {
    const user = d.currentUser(c), id = c.req.param('id'), b = await body(c)
    if (!/^[A-Za-z0-9_-]{6,40}$/.test(id)) return c.json({ error: 'Bad id.' }, 400)
    const name = str(b.name, 30), year = Number(b.birth_year)
    if (!name) return c.json({ error: 'Add a name.' }, 400)
    const exists = db.get('SELECT 1 FROM members WHERE id = ? AND user_id = ?', id, user.id)
    if (!exists && db.get<{ n: number }>('SELECT COUNT(*) AS n FROM members WHERE user_id = ?', user.id)!.n >= 6)
      return c.json({ error: 'You can add up to 6 people.' }, 400)
    if (!exists && db.get('SELECT 1 FROM members WHERE id = ?', id)) return c.json({ error: 'Bad id.' }, 400)
    const stage = ['pregnancy', 'breastfeeding'].includes(b.life_stage) ? b.life_stage : ''
    const concerns = (Array.isArray(b.concerns) ? b.concerns : []).filter((x: unknown) => x === 'sensitive' || x === 'acne_prone')
    const birth = Number.isInteger(year) && year >= 1900 && year <= new Date(d.now()).getFullYear() ? year : null
    db.run(`INSERT INTO members (id, user_id, name, birth_year, life_stage, concerns, is_self, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, birth_year = excluded.birth_year, life_stage = excluded.life_stage,
      concerns = excluded.concerns, is_self = excluded.is_self, updated_at = excluded.updated_at`,
      id, user.id, name, birth, stage, JSON.stringify(concerns), b.is_self ? 1 : 0, d.now(), d.now())
    return c.json({ ok: true })
  })
  app.delete('/api/members/:id', d.requireUser, c => {
    const user = d.currentUser(c), id = c.req.param('id')
    db.tx(() => {
      db.run('DELETE FROM members WHERE id = ? AND user_id = ?', id, user.id)
      db.run('DELETE FROM skin_reports WHERE member_id = ? AND user_id = ?', id, user.id)
      db.run('DELETE FROM advice WHERE member_id = ? AND user_id = ?', id, user.id)
      for (const p of db.all<{ id: string; used_by: string }>('SELECT id, used_by FROM user_products WHERE user_id = ?', user.id))
        db.run('UPDATE user_products SET used_by = ? WHERE id = ?', JSON.stringify((JSON.parse(p.used_by) as string[]).filter(x => x !== id)), p.id)
    })
    return c.json({ ok: true })
  })

  // ---------- shelf ----------
  app.get('/api/shelf', d.requireUser, c => c.json(
    db.all<{ used_by: string }>('SELECT id, name, brand, barcode, raw, used_by, added_at FROM user_products WHERE user_id = ? ORDER BY added_at DESC', d.currentUser(c).id)
      .map(p => ({ ...p, used_by: JSON.parse(p.used_by) }))))
  app.put('/api/shelf/:id', d.requireUser, bodyLimit({ maxSize: 16 * 1024 }), async c => {
    const user = d.currentUser(c), id = c.req.param('id'), b = await body(c)
    if (!/^[A-Za-z0-9_-]{6,40}$/.test(id)) return c.json({ error: 'Bad id.' }, 400)
    const name = str(b.name, 200), raw = str(b.raw, 5000)
    if (!name || !raw) return c.json({ error: 'Add a name and the ingredient list.' }, 400)
    const exists = db.get('SELECT 1 FROM user_products WHERE id = ? AND user_id = ?', id, user.id)
    if (!exists && db.get('SELECT 1 FROM user_products WHERE id = ?', id)) return c.json({ error: 'Bad id.' }, 400)
    if (!exists && db.get<{ n: number }>('SELECT COUNT(*) AS n FROM user_products WHERE user_id = ?', user.id)!.n >= 300)
      return c.json({ error: 'Your shelf is full.' }, 400)
    const mine = new Set(db.all<{ id: string }>('SELECT id FROM members WHERE user_id = ?', user.id).map(m => m.id))
    const usedBy = (Array.isArray(b.used_by) ? b.used_by : []).filter((x: unknown) => typeof x === 'string' && mine.has(x))
    db.run(`INSERT INTO user_products (id, user_id, name, brand, barcode, raw, used_by, added_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, brand = excluded.brand, barcode = excluded.barcode, raw = excluded.raw,
      used_by = excluded.used_by, updated_at = excluded.updated_at`,
      id, user.id, name, str(b.brand, 120), str(b.barcode, 20).replace(/\D/g, ''), raw, JSON.stringify(usedBy), d.now(), d.now())
    return c.json({ ok: true })
  })
  app.delete('/api/shelf/:id', d.requireUser, c => {
    db.run('DELETE FROM user_products WHERE id = ? AND user_id = ?', c.req.param('id'), d.currentUser(c).id)
    return c.json({ ok: true })
  })

  // ---------- skin analysis ----------
  app.post('/api/skin/analyze', bodyLimit({ maxSize: 8 * 1024 * 1024, onError: c => c.json({ error: 'Photo is too large.' }, 413) }),
    d.appOnly, d.requireUser, async c => {
      const user = d.currentUser(c), started = d.now(), b = await body(c)
      const member = memberOf(user, str(b.member_id, 40))
      if (!member) return c.json({ error: 'Choose who this skin test is for.' }, 400)
      const age = member.birth_year ? new Date(d.now()).getFullYear() - member.birth_year : null
      if (age !== null && age < MIN_FACE_AGE) return c.json({ error: 'Skin tests are for ages 13 and up.', code: 'under13' }, 400)
      const image = typeof b.image === 'string' ? b.image.replace(/^data:[^,]*,/, '') : ''
      if (!image || !/^[A-Za-z0-9+/]+=*$/.test(image)) return c.json({ error: 'Take a photo first.' }, 400)
      if (!perUser(user.id)) return c.json({ error: "You've run a lot of skin tests today. Try again tomorrow." }, 429)
      const s = db.settings()
      const today = db.get<{ n: number }>("SELECT COUNT(*) AS n FROM ocr_logs WHERE kind = 'skin' AND status = 200 AND ts >= ?", started - (started % 86400_000))!.n
      if (today >= s.ocrDailyCap) return c.json({ error: 'Skin tests are busy right now. Try again later.' }, 503)

      const lang = LANG_NAMES[b.lang] ? b.lang : 'en'
      const conditions = { makeup: MAKEUP.includes(b.conditions?.makeup) ? b.conditions.makeup : 'none', light: LIGHT.includes(b.conditions?.light) ? b.conditions.light : 'daylight' }
      const qs = db.questions()
      const answers: Record<string, string | string[]> = {}
      const answerLines: string[] = []
      for (const q of qs) {
        const a = b.answers?.[q.id]
        const ids = (Array.isArray(a) ? a : [a]).filter((x: unknown) => typeof x === 'string' && q.options.some(o => o.id === x)) as string[]
        if (!ids.length) continue
        answers[q.id] = q.type === 'multi' ? ids : ids[0]
        answerLines.push(`${q.title.en} ${ids.map(id => q.options.find(o => o.id === id)!.label.en).join(', ')}`)
      }
      const context = [
        age !== null ? `Age: about ${age}.` : '',
        member.life_stage ? `Situation: ${member.life_stage}.` : '',
        `Photo conditions: makeup ${conditions.makeup}, light ${conditions.light}.`,
        ...answerLines.map(l => `Questionnaire: ${l}`),
      ].filter(Boolean).join('\n')

      let usage: Usage = { input: 0, output: 0 }
      try {
        const res = await d.ai.chat({
          model: MODEL, max_tokens: 4000, temperature: 0, thinking: { type: 'disabled' }, response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: SKIN_SYSTEM.replaceAll('{LANG}', LANG_NAMES[lang]) },
            { role: 'user', content: [
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${image}` } },
              { type: 'text', text: `Analyze this face photo.\n${context}` },
            ] },
          ],
        })
        usage = { input: res.usage?.prompt_tokens ?? 0, output: res.usage?.completion_tokens ?? 0 }
        const choice = res.choices?.[0]
        if (choice?.finish_reason === 'content_filter') throw new HttpError(422, "We couldn't analyze this photo. Try another one.")
        let out: Record<string, any>
        try { out = JSON.parse(choice?.message?.content ?? '') } catch { throw new HttpError(502, 'Something went wrong reading your skin. Try again.') }
        if (out.face_found === false)
          throw new HttpError(422, clampText(out.problem, 200) || 'We need a clear, front-facing photo of your face in good light.')
        const report = cleanReport(out)
        const id = newId('r')
        db.run('INSERT INTO skin_reports (id, user_id, member_id, ts, conditions, answers, result, lang) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          id, user.id, member.id, started, JSON.stringify(conditions), JSON.stringify(answers), JSON.stringify(report), lang)
        db.run('DELETE FROM advice WHERE user_id = ? AND member_id = ?', user.id, member.id) // new skin, new advice
        logAi(c, 'skin', user, started, 200, usage)
        const pro = await d.isPro(user)
        return c.json({ id, ts: started, member_id: member.id, locked: !pro, report: pro ? report : null })
      } catch (e) {
        const f = failAi(e)
        logAi(c, 'skin', user, started, f.status, usage, f.msg)
        return c.json({ error: f.msg }, f.status as 400)
      }
    })

  app.get('/api/skin/reports', d.requireUser, async c => {
    const user = d.currentUser(c), pro = await d.isPro(user)
    const rows = db.all<{ id: string; member_id: string; ts: number; result: string }>(
      'SELECT id, member_id, ts, result FROM skin_reports WHERE user_id = ? ORDER BY ts DESC LIMIT 200', user.id)
    return c.json(rows.map(r => {
      const rep = JSON.parse(r.result) as SkinReport
      return { id: r.id, member_id: r.member_id, ts: r.ts, locked: !pro, overall: pro ? rep.overall : null,
        scores: pro ? Object.fromEntries(DIMENSIONS.map(k => [k, rep.dimensions[k].score])) : null }
    }))
  })

  app.get('/api/skin/reports/:id', d.requireUser, async c => {
    const user = d.currentUser(c)
    const r = db.get<{ id: string; member_id: string; ts: number; result: string; conditions: string }>(
      'SELECT id, member_id, ts, result, conditions FROM skin_reports WHERE id = ? AND user_id = ?', c.req.param('id'), user.id)
    if (!r) return c.json({ error: 'Not found' }, 404)
    const pro = await d.isPro(user)
    return c.json({ id: r.id, member_id: r.member_id, ts: r.ts, conditions: JSON.parse(r.conditions), locked: !pro, report: pro ? JSON.parse(r.result) : null })
  })

  // ---------- AI routine advice ----------
  app.post('/api/advice', d.appOnly, d.requireUser, bodyLimit({ maxSize: 4096 }), async c => {
    const user = d.currentUser(c), started = d.now(), b = await body(c)
    if (!(await d.isPro(user))) return c.json({ error: 'Routine advice is part of PearlKin Pro.', code: 'paywall' }, 402)
    const row = memberOf(user, str(b.member_id, 40))
    if (!row) return c.json({ error: 'Choose a person.' }, 400)
    const lang = LANG_NAMES[b.lang] ? b.lang : 'en'
    const pack = db.published().pack
    const report = latestReport(user, row.id)
    const member = toMember(row)
    member.concerns = [...new Set([...(member.concerns ?? []), ...concernsFromReport(report)])]
    const products = db.all<{ id: string; name: string; brand: string; raw: string; used_by: string }>(
      'SELECT id, name, brand, raw, used_by FROM user_products WHERE user_id = ?', user.id)
      .filter(p => (JSON.parse(p.used_by) as string[]).includes(row.id))
    if (!products.length) return c.json({ error: 'Mark the products this person uses first.', code: 'no_products' }, 400)

    const items = products.map(p => {
      const { inci } = normalize(p.raw, pack)
      const v = evaluate(inci, member, pack)
      return { id: p.id, name: [p.brand, p.name].filter(Boolean).join(' '), ingredients: inci.slice(0, 40), verdict: v.severity, flags: v.reasons.map(r => r.message) }
    })
    const input = JSON.stringify({ lang, age_band: ageBandOf(member), life_stage: member.lifeStage ?? null, concerns: member.concerns, skin: report && {
      skin_type: report.skin_type, priorities: report.priorities, look_for: report.look_for, avoid: report.avoid }, items })
    const hash = createHash('sha256').update(input).digest('hex')
    const cached = db.get<{ input_hash: string; result: string }>('SELECT input_hash, result FROM advice WHERE user_id = ? AND member_id = ?', user.id, row.id)
    if (cached?.input_hash === hash) return c.json(JSON.parse(cached.result))
    if (!adviceLimit(user.id)) return c.json({ error: 'Try again tomorrow.' }, 429)

    let usage: Usage = { input: 0, output: 0 }
    try {
      const res = await d.ai.chat({
        model: MODEL, max_tokens: 3000, temperature: 0, thinking: { type: 'disabled' }, response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: `You build skincare routines from products a person already owns. Each product comes with a verdict from a reviewed rule engine ("good", "care", "not_recommended", "ask_doctor", "unsupported") and its reasons. Never contradict those verdicts: products marked "not_recommended" or "ask_doctor" go in "pause", not in the routine. Use only the given product ids. Order steps the usual way (cleanse, treat, moisturize, then sunscreen in the morning). Point out real conflicts only (e.g. two exfoliants, retinoid with acids on the same night). Fill "gaps" with what is missing for this person's skin priorities, as ingredient names, not brands. Write all text in ${LANG_NAMES[lang]}; keep each "why" under 20 words. Not medical advice.
Reply with JSON only: {"summary": "", "am": [{"id": "", "why": ""}], "pm": [{"id": "", "why": ""}], "pause": [{"id": "", "why": ""}], "conflicts": [{"ids": [""], "why": ""}], "gaps": [{"need": "", "look_for": [""], "why": ""}]}` },
          { role: 'user', content: input },
        ],
      })
      usage = { input: res.usage?.prompt_tokens ?? 0, output: res.usage?.completion_tokens ?? 0 }
      let out: Record<string, any>
      try { out = JSON.parse(res.choices?.[0]?.message?.content ?? '') } catch { throw new HttpError(502, 'Something went wrong. Try again.') }
      const ids = new Set(items.map(i => i.id))
      const steps = (v: unknown) => (Array.isArray(v) ? v : []).filter((s: any) => ids.has(s?.id)).map((s: any) => ({ id: s.id, why: clampText(s.why, 200) })).slice(0, 10)
      const advice = {
        summary: clampText(out.summary, 400), am: steps(out.am), pm: steps(out.pm), pause: steps(out.pause),
        conflicts: (Array.isArray(out.conflicts) ? out.conflicts : []).map((x: any) => ({ ids: (Array.isArray(x?.ids) ? x.ids : []).filter((i: string) => ids.has(i)), why: clampText(x?.why, 200) })).filter((x: any) => x.ids.length).slice(0, 5),
        gaps: (Array.isArray(out.gaps) ? out.gaps : []).map((x: any) => ({ need: clampText(x?.need, 80), look_for: (Array.isArray(x?.look_for) ? x.look_for : []).map((i: unknown) => clampText(i, 60)).filter(Boolean).slice(0, 4), why: clampText(x?.why, 200) })).filter((x: any) => x.need).slice(0, 4),
        ts: started,
      }
      db.run(`INSERT INTO advice (user_id, member_id, input_hash, result, ts) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(user_id, member_id) DO UPDATE SET input_hash = excluded.input_hash, result = excluded.result, ts = excluded.ts`,
        user.id, row.id, hash, JSON.stringify(advice), started)
      logAi(c, 'advice', user, started, 200, usage)
      return c.json(advice)
    } catch (e) {
      const f = failAi(e)
      logAi(c, 'advice', user, started, f.status, usage, f.msg)
      return c.json({ error: f.msg }, f.status as 400)
    }
  })
}
