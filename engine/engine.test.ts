import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { normalize, checkProduct, checkRoutine, SEVERITY_ORDER, type Pack, type Member } from './engine.ts'

const pack: Pack = JSON.parse(readFileSync(new URL('./rule-pack.json', import.meta.url), 'utf8'))
const YEAR = 2026
const family: Member[] = [
  { id: 'maya', nickname: 'Maya', birthYear: 2015 },                  // 11
  { id: 'leo', nickname: 'Leo', birthYear: 2011 },                    // 15
  { id: 'mom', nickname: 'Mom', birthYear: 1988, lifeStage: 'pregnancy' },
  { id: 'dad', nickname: 'Dad', birthYear: 1986 },
  { id: 'baby', nickname: 'Bean', birthYear: 2024 },
]

test('rule pack integrity', () => {
  const groups = new Set(pack.groups.map(g => g.id))
  const inci = new Set(pack.groups.flatMap(g => g.members))
  for (const r of pack.rules) {
    assert.ok(groups.has(r.group), `${r.id}: unknown group ${r.group}`)
    assert.ok(pack.messages[r.message_key], `${r.id}: missing message ${r.message_key}`)
    assert.ok(SEVERITY_ORDER.includes(r.severity), `${r.id}: bad severity`)
    assert.ok(r.sources.length, `${r.id}: every warning needs a source (plan 1.3)`)
  }
  for (const r of pack.routine_rules) {
    assert.ok(pack.messages[r.message_key], `${r.id}: missing message`)
    for (const g of [...(r.groups ?? []), ...(r.with ?? [])]) assert.ok(groups.has(g), `${r.id}: unknown group ${g}`)
  }
  for (const [a, t] of Object.entries(pack.aliases)) assert.ok(inci.has(t), `alias ${a} -> unknown INCI ${t}`)
  assert.ok(!/\b(toxic|safe|dangerous)\b/i.test(Object.values(pack.messages).join(' ')), 'no scare words (plan 1.3)')
})

test('normalize cleans real-world label text', () => {
  const r = normalize('Ingredients: Aqua/Water/Eau, Glycerin, Retinol 0.3%, Caprylic/Capric Triglyceride, 1,2-Hexanediol, Fragrance (Parfum), Titanium Dioxide (CI 77891). May contain: CI 77491, Glitter Dust*', pack)
  assert.deepEqual(r.inci.sort(), ['1,2-hexanediol', 'aqua', 'caprylic/capric triglyceride', 'ci 77491', 'glycerin', 'parfum', 'retinol', 'titanium dioxide'])
  assert.deepEqual(r.unknown, ['glitter dust'])
  // Mid-name parentheses, as Open Beauty Facts and OCR return them
  assert.deepEqual(normalize('Lavandula Angustifolia (Lavender) Oil, LAVENDER (LAVANDULA ANGUSTIFOLIA) OIL/EXTRACT', pack).inci, ['lavandula angustifolia oil'])
})

test('one product, a different verdict per family member (the landing-page sample)', () => {
  const { verdicts } = checkProduct('Aqua, Glycerin, Retinol, Glycolic Acid, Parfum, Mystery Extract', family, pack, YEAR)
  const by = Object.fromEntries(verdicts.map(v => [v.memberId, v.severity]))
  assert.deepEqual(by, { maya: 'not_recommended', leo: 'care', mom: 'ask_doctor', dad: 'good', baby: 'unsupported' })
  const maya = verdicts[0]
  assert.equal(maya.reasons[0].severity, 'not_recommended') // most severe reason first
  assert.ok(maya.reasons.some(r => r.ingredients.includes('parfum')))
})

test('nothing recognized is never a good fit', () => {
  const { unknown, verdicts } = checkProduct('Foo, Bar', [family[3]], pack, YEAR)
  assert.deepEqual(unknown, ['foo', 'bar'])
  assert.equal(verdicts[0].severity, 'care')
})

test('concerns only fire when the member has them', () => {
  const raw = 'Aqua, Isopropyl Myristate, Lavender Oil'
  const plain = checkProduct(raw, [{ id: 'a', nickname: 'A', ageBand: '18+' }], pack).verdicts[0]
  const flagged = checkProduct(raw, [{ id: 'b', nickname: 'B', ageBand: '18+', concerns: ['acne_prone', 'sensitive'] }], pack).verdicts[0]
  assert.equal(plain.severity, 'good')
  assert.deepEqual(flagged.reasons.map(r => r.ruleId).sort(), ['R-COM-ACNE-01', 'R-EO-SENS-01'])
})

test('routine check: duplicate acids, retinoid + acid, missing SPF, too many steps', () => {
  const p = (name: string, raw: string) => ({ name, inci: normalize(raw, pack).inci })
  const am = [p('Toner', 'Aqua, Glycolic Acid'), p('Cleanser', 'Aqua, Salicylic Acid'), p('Serum', 'Aqua, Niacinamide')]
  assert.deepEqual(checkRoutine(am, 'am', pack).map(i => i.ruleId), ['RT-DUP-EXF', 'RT-NO-SPF'])

  const pm = [p('Toner', 'Glycolic Acid'), p('Night', 'Retinol'), p('A', 'Aqua'), p('B', 'Aqua'), p('C', 'Aqua'), p('D', 'Aqua')]
  assert.deepEqual(checkRoutine(pm, 'pm', pack).map(i => i.ruleId), ['RT-RET-ACID', 'RT-TOO-MANY'])

  assert.deepEqual(checkRoutine([p('SPF', 'Zinc Oxide 20%')], 'am', pack), [])
})
