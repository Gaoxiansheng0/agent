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
}
export type Reason = { ruleId: string; severity: Severity; message: string; ingredients: string[]; sources: Source[] }
export type Verdict = { memberId: string; severity: Severity | 'unsupported'; reasons: Reason[] }
export type RoutineIssue = { ruleId: string; severity: Severity; message: string; products: string[] }

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
  for (const [name, inci] of Object.entries(pack.aliases)) idx.alias.set(name, inci)
  cache.set(pack, idx)
  return idx
}

// Raw label text (OCR or database) -> INCI names. Unmapped tokens go to `unknown` for the review
// queue and do not affect verdicts (plan 4.5). "May contain" items are kept: conservative.
export function normalize(raw: string, pack: Pack): { inci: string[]; unknown: string[] } {
  const { alias } = index(pack)
  const text = raw.toLowerCase()
    .replace(/(in)?active ingredients?\s*:|ingredients?\s*:|may contain\s*:?|\[\+\/-\]|\+\/-/g, ',')
    .replace(/\(?\s*\d+(\.\d+)?\s*%\s*\)?/g, '')
  const inci = new Set<string>(), unknown = new Set<string>()
  for (const part of text.split(/[;\n•·]|,(?!\d)/)) { // ",(?!\d)" keeps "1,2-hexanediol" whole
    const token = part.replace(/^[\s\-*.]+|[\s*.]+$/g, '').replace(/\s+/g, ' ')
    if (!token) continue
    const bare = token.replace(/\s*\(.*?\)\s*/g, ' ').trim() // "lavandula angustifolia (lavender) oil" -> "lavandula angustifolia oil"
    const inner = [...token.matchAll(/\((.*?)\)/g)].map(m => m[1].trim())
    const hit = [token, bare, ...inner, ...bare.split('/').map(s => s.trim())].map(c => alias.get(c)).find(Boolean)
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
    reasons: [{ ruleId: 'R-NO-DATA', severity: 'care', message: pack.messages.no_ingredients, ingredients: [], sources: [] }],
  }
  const { groupsOf } = index(pack)
  const reasons = pack.rules.filter(r => applies(r.applies_to, member, band)).flatMap(r => {
    const hits = inci.filter(i => groupsOf.get(i)?.includes(r.group))
    return hits.length ? [{ ruleId: r.id, severity: r.severity, message: pack.messages[r.message_key], ingredients: hits, sources: r.sources }] : []
  }).sort((a, b) => rank(b.severity) - rank(a.severity))
  return { memberId: member.id, severity: reasons[0]?.severity ?? 'good', reasons }
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
    return hit ? [{ ruleId: r.id, severity: r.severity, message: pack.messages[r.message_key], products: hit }] : []
  })
}
