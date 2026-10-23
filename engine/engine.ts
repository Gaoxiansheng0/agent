// Family Shelf rule engine. Pure functions, no I/O: runs as-is in Node (tests, SEO page generation)
// and later inside the Expo app, so member data never has to leave the phone (plan 5.1).
// Safety verdicts come only from rule-pack.json; an LLM may rephrase `message`, never decide `severity`.

export type Severity = 'good' | 'care' | 'not_recommended' | 'ask_doctor'
export type AgeBand = '0-3' | '4-7' | '8-12' | '13-17' | '18+'
export type LifeStage = 'pregnancy' | 'breastfeeding'
export type Member = { id: string; nickname: string; birthYear?: number; ageBand?: AgeBand; lifeStage?: LifeStage; concerns?: string[] }
export type Source = { org: string; ref: string }
export type Rule = {
  id: string; group: string; severity: Severity; message_key: string; sources: Source[]
  applies_to: { age_band?: AgeBand[]; life_stage?: LifeStage[]; concern?: string[] }
  reviewed_by: string | null; reviewed_at: string | null
}
export type RoutineRule = {
  id: string; type: 'duplicate' | 'combo' | 'missing' | 'max_steps'; severity: Severity; message_key: string
  groups?: string[]; with?: string[]; threshold_products?: number; max?: number; time?: 'am' | 'pm'
}
export type Pack = {
  version: string; status: string; aliases: Record<string, string>; messages: Record<string, string>
  groups: { id: string; members: string[]; functions?: string[] }[]; rules: Rule[]; routine_rules: RoutineRule[]
  // language -> message_key -> text. English in `messages` is the reviewed source; a missing translation falls back to it.
  translations?: Record<string, Record<string, string>>
}
export type Reason = { ruleId: string; severity: Severity; messageKey: string; message: string; ingredients: string[]; sources: Source[] }
export type Verdict = { memberId: string; severity: Severity | 'unsupported'; reasons: Reason[] }
export type RoutineIssue = { ruleId: string; severity: Severity; messageKey: string; message: string; products: string[] }

export const DISCLAIMER = 'Informational only. Not medical advice.'
// Plan 4.2 lists severities in this order; later = shown first. ask_doctor outranks not_recommended.
export const SEVERITY_ORDER: Severity[] = ['good', 'care', 'not_recommended', 'ask_doctor']
export const SUPPORTED_BANDS: AgeBand[] = ['8-12', '13-17', '18+'] // v1: 0-7 shows "coming soon"

const cache = new WeakMap<Pack, { alias: Map<string, string>; groupsOf: Map<string, string[]> }>()
function index(pack: Pack) {
  let idx = cache.get(pack)
  if (idx) return idx
  idx = { alias: new Map(), groupsOf: new Map() }
  for (const g of pack.groups) for (const inci of g.members) {
    idx.alias.set(inci, inci)
    idx.groupsOf.set(inci, [...(idx.groupsOf.get(inci) ?? []), g.id])
  }
  for (const [name, inci] of Object.entries(pack.aliases)) idx.alias.set(compact(name), inci)
  cache.set(pack, idx)
  return idx
}

const CJK = /[㐀-鿿豈-﫿]/
// Chinese names are written with or without spaces ("PEG-100 硬脂酸酯" / "PEG-100硬脂酸酯"); compare them without.
const compact = (s: string) => (CJK.test(s) ? s.replace(/\s+/g, '') : s)

// Raw label text (OCR or database) -> INCI names. Unmapped tokens go to `unknown` for the review
// queue and do not affect verdicts (plan 4.5). "May contain" items are kept: conservative.
export function normalize(raw: string, pack: Pack): { inci: string[]; unknown: string[] } {
  const { alias } = index(pack)
  const text = raw.toLowerCase()
    // Chinese labels: full-width punctuation and parentheses, "成分/全成分/配料" headings, "可能含有" for "may contain".
    .replace(/（/g, '(').replace(/）/g, ')').replace(/[，、；。]/g, ';').replace(/：/g, ':')
    .replace(/(in)?active ingredients?\s*:|ingredients?\s*:|may contain\s*:?|\[\+\/-\]|\+\/-/g, ',')
    .replace(/(全)?成分(表)?\s*:|配料(表)?\s*:|可能含有\s*:?/g, ',')
    .replace(/\(?\s*\d+(\.\d+)?\s*%\s*\)?/g, '')
  const inci = new Set<string>(), unknown = new Set<string>()
  for (const part of text.split(/[;\n•·]|,(?!\d)/)) { // ",(?!\d)" keeps "1,2-hexanediol" whole
    const token = part.replace(/^[\s\-*.]+|[\s*.]+$/g, '').replace(/\s+/g, ' ')
    if (!token) continue
    const bare = token.replace(/\s*\(.*?\)\s*/g, ' ').trim() // "lavandula angustifolia (lavender) oil" -> "lavandula angustifolia oil"
    const inner = [...token.matchAll(/\((.*?)\)/g)].map(m => m[1].trim())
    const hit = [token, bare, ...inner, ...bare.split('/').map(s => s.trim())].map(c => alias.get(compact(c))).find(Boolean)
    if (hit) inci.add(hit)
    else unknown.add(token)
  }
  return { inci: [...inci], unknown: [...unknown] }
}

export function ageBandOf(m: Member, year = new Date().getFullYear()): AgeBand | null {
  if (m.ageBand) return m.ageBand
  if (m.birthYear == null) return null
  const age = year - m.birthYear // ponytail: birth year only, can be off by one; enough for 5-year bands
  return age <= 3 ? '0-3' : age <= 7 ? '4-7' : age <= 12 ? '8-12' : age <= 17 ? '13-17' : '18+'
}

const applies = (a: Rule['applies_to'], m: Member, band: AgeBand) =>
  (!a.age_band || a.age_band.includes(band)) &&
  (!a.life_stage || (!!m.lifeStage && a.life_stage.includes(m.lifeStage))) &&
  (!a.concern || a.concern.some(c => m.concerns?.includes(c)))

const rank = (s: Severity) => SEVERITY_ORDER.indexOf(s)

export function evaluate(inci: string[], member: Member, pack: Pack, year?: number): Verdict {
  const band = ageBandOf(member, year)
  if (!band || !SUPPORTED_BANDS.includes(band)) return { memberId: member.id, severity: 'unsupported', reasons: [] }
  // Plan 4.1: no evidence is never a good fit.
  if (!inci.length) return {
    memberId: member.id, severity: 'care',
    reasons: [{ ruleId: 'R-NO-DATA', severity: 'care', messageKey: 'no_ingredients', message: pack.messages.no_ingredients, ingredients: [], sources: [] }],
  }
  const { groupsOf } = index(pack)
  const reasons = pack.rules.filter(r => applies(r.applies_to, member, band)).flatMap(r => {
    const hits = inci.filter(i => groupsOf.get(i)?.includes(r.group))
    return hits.length ? [{ ruleId: r.id, severity: r.severity, messageKey: r.message_key, message: pack.messages[r.message_key], ingredients: hits, sources: r.sources }] : []
  }).sort((a, b) => rank(b.severity) - rank(a.severity))
  return { memberId: member.id, severity: reasons[0]?.severity ?? 'good', reasons }
}

// "0.1.10" > "0.1.9". Used to decide whether a downloaded rule pack is newer than the bundled one.
export function compareVersions(a: string, b: string) {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return Math.sign(d)
  }
  return 0
}

// Structural checks a pack must pass before it ships (tests) or is published from the admin panel.
export function validatePack(pack: Pack): string[] {
  const errors: string[] = []
  if (!pack || typeof pack !== 'object') return ['rule pack must be an object']
  if (!/^\d+\.\d+\.\d+$/.test(pack.version ?? '')) errors.push(`version "${pack.version}" must look like 1.2.3`)
  for (const k of ['groups', 'rules', 'routine_rules'] as const) if (!Array.isArray(pack[k])) errors.push(`${k} must be a list`)
  for (const k of ['aliases', 'messages'] as const) if (!pack[k] || typeof pack[k] !== 'object') errors.push(`${k} must be an object`)
  if (errors.length) return errors
  const groups = new Set<string>(), inci = new Set<string>(), ruleIds = new Set<string>()
  for (const g of pack.groups) {
    if (!g.id || !Array.isArray(g.members)) { errors.push(`group ${g.id ?? '?'}: needs id and members`); continue }
    if (groups.has(g.id)) errors.push(`group ${g.id}: duplicate id`)
    groups.add(g.id)
    for (const m of g.members) {
      if (m !== m.trim().toLowerCase() || !m) errors.push(`group ${g.id}: "${m}" must be lowercase without outer spaces`)
      inci.add(m)
    }
  }
  for (const r of pack.rules) {
    if (ruleIds.has(r.id)) errors.push(`${r.id}: duplicate rule id`)
    ruleIds.add(r.id)
    if (!groups.has(r.group)) errors.push(`${r.id}: unknown group ${r.group}`)
    if (!pack.messages[r.message_key]) errors.push(`${r.id}: missing message ${r.message_key}`)
    if (!SEVERITY_ORDER.includes(r.severity)) errors.push(`${r.id}: bad severity ${r.severity}`)
    if (!r.sources?.length) errors.push(`${r.id}: every warning needs a source (plan 1.3)`)
    if (!r.applies_to || typeof r.applies_to !== 'object') errors.push(`${r.id}: applies_to must be an object`)
  }
  for (const r of pack.routine_rules) {
    if (ruleIds.has(r.id)) errors.push(`${r.id}: duplicate rule id`)
    ruleIds.add(r.id)
    if (!pack.messages[r.message_key]) errors.push(`${r.id}: missing message ${r.message_key}`)
    if (!SEVERITY_ORDER.includes(r.severity)) errors.push(`${r.id}: bad severity ${r.severity}`)
    for (const g of [...(r.groups ?? []), ...(r.with ?? [])]) if (!groups.has(g)) errors.push(`${r.id}: unknown group ${g}`)
  }
  for (const [a, t] of Object.entries(pack.aliases)) {
    if (a !== a.trim().toLowerCase()) errors.push(`alias "${a}" must be lowercase`)
    if (!inci.has(t)) errors.push(`alias ${a} -> unknown INCI ${t}`)
  }
  if (!pack.messages.no_ingredients) errors.push('messages.no_ingredients is required')
  for (const [lang, msgs] of Object.entries(pack.translations ?? {})) {
    if (!msgs || typeof msgs !== 'object') { errors.push(`translations.${lang} must be an object`); continue }
    for (const k of Object.keys(msgs)) if (!pack.messages[k]) errors.push(`translations.${lang}.${k}: no English message with this key`)
  }
  if (/\b(toxic|safe|dangerous)\b/i.test(Object.values(pack.messages).join(' '))) errors.push('no scare words: toxic / safe / dangerous (plan 1.3)')
  return errors
}

// One scan, a verdict for every family member: the core feature.
export function checkProduct(raw: string, members: Member[], pack: Pack, year?: number) {
  const { inci, unknown } = normalize(raw, pack)
  return { inci, unknown, verdicts: members.map(m => evaluate(inci, m, pack, year)) }
}

export function checkRoutine(products: { name: string; inci: string[] }[], time: 'am' | 'pm', pack: Pack): RoutineIssue[] {
  const { groupsOf } = index(pack)
  const having = (groups: string[]) =>
    products.filter(p => p.inci.some(i => groupsOf.get(i)?.some(g => groups.includes(g)))).map(p => p.name)
  return pack.routine_rules.flatMap(r => {
    if (r.time && r.time !== time) return []
    let hit: string[] | null = null
    if (r.type === 'duplicate') { const p = having(r.groups!); hit = p.length >= r.threshold_products! ? p : null }
    if (r.type === 'combo') { const a = having(r.groups!), b = having(r.with!); hit = a.length && b.length ? [...new Set([...a, ...b])] : null }
    if (r.type === 'missing') hit = having(r.groups!).length ? null : []
    if (r.type === 'max_steps') hit = products.length > r.max! ? products.map(p => p.name) : null
    return hit ? [{ ruleId: r.id, severity: r.severity, messageKey: r.message_key, message: pack.messages[r.message_key], products: hit }] : []
  })
}
