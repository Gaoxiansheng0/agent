// Example report, one per family member. Same people and products as the rest of the page.
// Scores follow the app's bands (none 85+, mild 65 to 84, moderate 40 to 64, marked below 40); overall is their average.
// Shelf effects follow the real rules: sensitive = said so or sensitivity under 65; acne prone = said so, breakouts
// under 65 or blackheads under 55; age and pregnancy notes apply whatever the photo shows. Ava (11) gets no skin test.
import { bottle } from './bottles.mjs'
import { avatar, portrait } from './portrait.mjs'

const NAMES = { sensitivity: 'Sensitivity', blackheads: 'Blackheads', pores: 'Pores', oil: 'Oil and shine', circles: 'Dark circles', lines: 'Fine lines', acne: 'Breakouts', spots: 'Dark spots', bags: 'Eye bags' }
const level = s => s >= 85 ? 'None' : s >= 65 ? 'Mild' : s >= 40 ? 'Moderate' : 'Marked'
const VERDICT = { good: ['good', 'check-circle', 'No concerns found'], care: ['care', 'warning', 'Use with care'], no: ['no', 'prohibit', 'Not for now'], doc: ['doc', 'stethoscope', 'Ask your doctor'] }
const chip = v => { const [cls, icon, text] = VERDICT[v]; return `<span class="verdict ${cls}"><svg class="ic sm"><use href="#i-${icon}"/></svg>${text}</span>` }
const AAD_FRAGRANCE = '<a href="https://www.aad.org/public/diseases/eczema/types/contact-dermatitis/causes">American Academy of Dermatology</a>'

const PEOPLE = [
  { w: 'mia', face: 'you', name: 'Mia', detail: '34, sensitive skin', her: 'her', type: 'Combination', confidence: 'High', taken: 'photo taken in daylight, no makeup',
    scores: { sensitivity: 58, pores: 70, blackheads: 70, oil: 72, circles: 76, lines: 78, acne: 80, spots: 82, bags: 86 },
    focus: [
      { m: 'sensitivity', photo: 'Redness around the nose and cheeks.', profile: 'She marked “Sensitive skin”.',
        shelf: { b: 'cream', name: 'Rich night cream', v: 'care', note: 'It contains fragrance, and her skin is sensitive.' },
        how: `Skin counts as sensitive when the person says so, or when a photo's sensitivity score is under 65. Either one is enough. Products with fragrance or essential oils then get a “use with care” note. Fragrance is a common cause of allergic skin reactions, according to the ${AAD_FRAGRANCE}.` },
      { m: 'lines', photo: 'Fine lines at the outer corners of the eyes.',
        shelf: { b: 'serum', name: 'Retinol night serum', v: 'good', note: "Retinol is often used for fine lines. It's already on her shelf." },
        how: 'Fine lines don\'t change any product note. The report suggests ingredients worth looking for, and her routine uses what she owns. On retinol, see the <a href="https://www.aad.org/public/everyday-care/skin-care-secrets/anti-aging/retinoid-retinol">American Academy of Dermatology</a>.' },
      { m: 'oil', photo: 'Shine on the forehead and down the nose.',
        missing: { name: 'Missing: niacinamide', note: 'None of her products has it. PearlKin names ingredients, not brands.' },
        how: "Mild shine doesn't change any product note. Her routine lists what's missing for her skin, as ingredient names to look for." },
    ] },
  { w: 'leo', face: 'teen', name: 'Leo', detail: '15, breakouts', her: 'his', type: 'Oily', confidence: 'High', taken: 'photo taken in daylight, no makeup',
    scores: { oil: 44, acne: 50, blackheads: 60, pores: 64, circles: 80, sensitivity: 82, spots: 86, bags: 90, lines: 94 },
    focus: [
      { m: 'acne', photo: 'A few active breakouts on the cheeks and chin.', profile: 'He marked “Acne prone”.',
        shelf: { b: 'cream', name: 'Coconut face balm', v: 'care', note: 'It contains coconut oil, which is more likely to clog pores.' },
        how: 'Skin counts as acne prone when the person says so, or when a photo shows breakouts under 65 or blackheads under 55. Ingredients more likely to clog pores then get a “use with care” note.' },
      { m: 'oil', photo: 'Shine across the forehead and nose.',
        missing: { name: 'Missing: niacinamide', note: 'None of his products has it. PearlKin names ingredients, not brands.' },
        how: "Shine doesn't change any product note. His routine lists what's missing for his skin, as ingredient names to look for." },
      { m: 'sensitivity', photo: 'Very little redness.',
        shelf: { b: 'cream', name: 'Rich night cream', v: 'care', note: "It contains fragrance. At 15, that gets a note even though his skin isn't sensitive." },
        how: `The photo adds no fragrance note here. His age does: under 18, products with fragrance get a “use with care” note. Fragrance is a common cause of allergic skin reactions, according to the ${AAD_FRAGRANCE}.` },
    ] },
  { w: 'ava', face: 'child', name: 'Ava', detail: '11', her: 'her' },
  { w: 'nora', face: 'partner', name: 'Nora', detail: '31, pregnant', her: 'her', type: 'Normal', confidence: 'Medium', taken: 'photo taken in indoor light',
    scores: { spots: 56, circles: 62, pores: 74, bags: 78, oil: 80, blackheads: 82, sensitivity: 84, lines: 84, acne: 86 },
    focus: [
      { m: 'spots', photo: 'Darker patches on the cheeks and forehead.', profile: 'She marked “Pregnant”.',
        shelf: { b: 'serum', name: 'Retinol night serum', v: 'doc', note: 'Retinol is often used for dark spots, but retinoids are generally avoided during pregnancy.' },
        how: 'Dark spots don\'t change any product note. Pregnancy does: products with retinoids get “ask your doctor”, whatever the photo shows. See <a href="https://www.acog.org/womens-health/faqs/skin-conditions-during-pregnancy">ACOG on skin conditions during pregnancy</a>.' },
      { m: 'circles', photo: 'Shadows under both eyes.',
        nothing: 'Nothing on her shelf changes. This photo was taken in indoor light, so confidence is medium: shadows can look darker than they are.',
        how: 'Dark circles don\'t change any product note. A daylight photo without makeup compares better next time.' },
      { m: 'pores', photo: 'Visible pores along the nose.',
        missing: { name: 'Missing: niacinamide', note: 'None of her products has it. PearlKin names ingredients, not brands.' },
        how: "Mild pores don't change any product note. Her routine lists what's missing for her skin, as ingredient names to look for." },
    ] },
]

const means = (p, f) => {
  let body
  if (f.shelf) body = `<div class="ex">${bottle(f.shelf.b)}<div><div class="r-row"><p class="t-title">${f.shelf.name}</p>${chip(f.shelf.v)}</div><p class="t-small sub">${f.shelf.note}</p></div></div>`
  else if (f.missing) body = `<div class="ex"><span class="gap"><svg class="ic"><use href="#i-plus"/></svg></span><div><p class="t-title">${f.missing.name}</p><p class="t-small sub">${f.missing.note}</p></div></div>`
  else body = `<p class="t-small" style="margin-top:8px">${f.nothing}</p>`
  return `<div class="means"><p class="src-h"><svg class="ic sm"><use href="#i-arrow-down"/></svg>On ${p.her} shelf</p>${body}</div>`
}

function card(p) {
  const head = (stats, sub) => `<div class="rep-head">
          <div class="rep-who"><span class="avatar">${avatar(p.face)}</span><div><b>${p.name}, ${p.detail.split(',')[0]} <span class="tag" style="margin-left:4px">Example</span></b><span>${sub}</span></div></div>
          ${stats}
        </div>`
  if (!p.scores) return `<div class="card rep">
        ${head('', 'Age 11 · products only')}
        <div class="rep-body solo">
          <div class="detail">
            <div class="src"><span class="thumb"><svg class="ic"><use href="#i-camera-slash"/></svg></span><div><p class="src-h">No skin test under 13</p><p>PearlKin never analyzes photos of children under 13. Her products are still checked, with notes written for her age.</p></div></div>
            <div class="means"><p class="src-h"><svg class="ic sm"><use href="#i-arrow-down"/></svg>On her shelf</p>
              <div class="ex">${bottle('serum')}<div><div class="r-row"><p class="t-title">Retinol night serum</p>${chip('no')}</div><p class="t-small sub">Made for adult concerns like aging. Young skin rarely needs it.</p></div></div>
              <div class="ex">${bottle('cleanser')}<div><div class="r-row"><p class="t-title">Gentle gel cleanser</p>${chip('good')}</div><p class="t-small sub">Nothing in it is noted for her age.</p></div></div>
            </div>
          </div>
        </div>
        <div class="all-wrap"><p class="t-small sub" style="padding:12px 0 4px">Children under 13 have no skin measures.</p></div>
      </div>`
  const vals = Object.values(p.scores), overall = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)
  const stats = `<dl class="rep-stats">
            <div class="stat"><dt>Overall</dt><dd class="num">${overall}<small>/ 100, an estimate</small></dd></div>
            <div class="stat"><dt>Confidence</dt><dd>${p.confidence}</dd>
              <details><summary class="sum">What's this?</summary><p class="why-text">How clearly the photo shows the skin: light, makeup, focus and angle. It isn't a measure of medical accuracy.</p></details></div>
          </dl>`
  const focus = p.focus.map((f, i) => `<button class="fo" role="radio" aria-checked="${i === 0}" data-f="${f.m}"${i ? ' tabindex="-1"' : ''}><span class="dot"></span><span class="t-title">${NAMES[f.m]}</span><span class="lvl">${level(p.scores[f.m])}</span><span class="num">${p.scores[f.m]}</span></button>`).join('\n            ')
  const details = p.focus.map((f, i) => `<div data-f="${f.m}"${i ? '' : ' class="on"'}>
              <div class="src"><span class="thumb">${portrait(p.face, { region: f.m, viewBox: '90 110 220 220' })}</span><div><p class="src-h">From ${p.her} photo</p><p>${f.photo}</p></div></div>
              <div class="src"><span class="thumb"><svg class="ic"><use href="#i-user-circle"/></svg></span><div><p class="src-h">From ${p.her} profile</p>${f.profile ? `<p>${f.profile}</p>` : `<p class="none">Nothing ${p.her === 'his' ? 'he' : 'she'} entered relates to this.</p>`}</div></div>
              ${means(p, f)}
              <details><summary class="sum">How PearlKin decides this<svg class="ic"><use href="#i-caret-down"/></svg></summary><p class="why-text">${f.how}</p></details>
            </div>`).join('\n            ')
  const all = Object.entries(p.scores).sort((a, b) => a[1] - b[1]).map(([m, s]) => `<li><span>${NAMES[m]}</span><span>${level(s)}</span><span>${s}</span></li>`).join('')
  return `<div class="card rep">
        ${head(stats, `${p.type} skin · ${p.taken}`)}
        <div class="rep-body">
          <div class="focus" role="radiogroup" aria-labelledby="focus-h-${p.w}">
            <p class="focus-h" id="focus-h-${p.w}">What stood out</p>
            ${focus}
          </div>
          <div class="detail stack" aria-live="polite">
            ${details}
          </div>
        </div>
        <details class="all-wrap">
          <summary class="sum">All 9 measures for ${p.name}<svg class="ic"><use href="#i-caret-down"/></svg></summary>
          <ul class="all">${all}</ul>
          <p class="t-small sub">Each score runs from 0 to 100, higher meaning fewer visible signs. Levels: none, mild, moderate, marked.</p>
        </details>
      </div>`
}

export function report() {
  const tabs = PEOPLE.map((p, i) => `<button class="person" role="tab" id="r-${p.w}" data-w="${p.w}" aria-selected="${i === 0}" aria-controls="report"${i ? ' tabindex="-1"' : ''}><span class="avatar">${avatar(p.face)}</span><span><b>${p.name}</b><span>${p.detail}</span></span></button>`).join('\n        ')
  return `<div class="people who" role="tablist" aria-label="Whose report">
        ${tabs}
      </div>
      <div class="stack reports" id="report" role="tabpanel" aria-labelledby="r-mia">
        ${PEOPLE.map((p, i) => `<div data-w="${p.w}"${i ? '' : ' class="on"'}>${card(p)}</div>`).join('\n        ')}
      </div>
`
}
