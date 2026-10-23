import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { normalize, checkProduct, checkRoutine, compareVersions, validatePack, type Pack, type Member } from './engine.ts'

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
  assert.deepEqual(validatePack(pack), [])
  const broken = structuredClone(pack)
  broken.rules[0].group = 'nope'
  broken.aliases['Water'] = 'aqua'
  broken.messages.no_ingredients = 'This is toxic.'
  assert.deepEqual(validatePack(broken), [
    `${pack.rules[0].id}: unknown group nope`,
    'alias "Water" must be lowercase',
    'no scare words: toxic / safe / dangerous (plan 1.3)',
  ])
})

test('version compare', () => {
  assert.equal(compareVersions('0.1.10', '0.1.9'), 1)
  assert.equal(compareVersions('0.2.0', '0.2.0'), 0)
  assert.equal(compareVersions('0.1.0', '1.0.0'), -1)
})

test('normalize cleans real-world label text', () => {
  const r = normalize('Ingredients: Aqua/Water/Eau, Glycerin, Retinol 0.3%, Caprylic/Capric Triglyceride, 1,2-Hexanediol, Fragrance (Parfum), Titanium Dioxide (CI 77891). May contain: CI 77491, Glitter Dust*', pack)
  assert.deepEqual(r.inci.sort(), ['1,2-hexanediol', 'aqua', 'caprylic/capric triglyceride', 'ci 77491', 'glycerin', 'parfum', 'retinol', 'titanium dioxide'])
  assert.deepEqual(r.unknown, ['glitter dust'])
  // Mid-name parentheses, as Open Beauty Facts and OCR return them
  assert.deepEqual(normalize('Lavandula Angustifolia (Lavender) Oil, LAVENDER (LAVANDULA ANGUSTIFOLIA) OIL/EXTRACT', pack).inci, ['lavandula angustifolia oil'])
})

test('normalize reads Chinese labels: full-width punctuation, headings, Latin in parentheses', () => {
  const r = normalize('全成分：水（AQUA）、甘油、PEG-100 硬脂酸酯、1,2-己二醇，椰子（COCOS NUCIFERA）油；视黄醇、某某专利成分。可能含有：CI 77891', pack)
  assert.deepEqual(r.inci, ['aqua', 'glycerin', 'peg-100 stearate', '1,2-hexanediol', 'cocos nucifera oil', 'retinol', 'ci 77891'])
  assert.deepEqual(r.unknown, ['某某专利成分'])
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
