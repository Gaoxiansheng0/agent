// Mia's products, drawn once and reused everywhere (hero, report, routine, scene, family, 404, share image).
// One light source for all of them: a window up and to the left. Matte and frosted materials, paper labels,
// a soft contact shadow pushed slightly right. No text inside the drawings.
let n = 0
const stops = c => c.map(([o, s, a = 1]) => `<stop offset="${o}" stop-color="${s}"${a < 1 ? ` stop-opacity="${a}"` : ''}/>`).join('')
const across = (id, c) => `<linearGradient id="${id}" x1="0" x2="1" y1="0" y2="0">${stops(c)}</linearGradient>`
const down = (id, c) => `<linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1">${stops(c)}</linearGradient>`
const shadow = (p, cx, rx) => `<radialGradient id="${p}s"><stop offset="0" stop-color="#302937" stop-opacity=".22"/><stop offset="1" stop-color="#302937" stop-opacity="0"/></radialGradient><ellipse cx="${cx + 6}" cy="257" rx="${rx}" ry="6" fill="url(#${p}s)"/>`
// A paper label: warm off white, a hairline edge, a small pearl mark and two lines of "type".
const label = (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="#F6F1E9" stroke="#E4D9CA" stroke-width="1"/><circle cx="${x + w / 2}" cy="${y + 14}" r="4" fill="none" stroke="#B9A6C9" stroke-width="1.5"/><rect x="${x + w * .2}" y="${y + 26}" width="${w * .6}" height="3.5" rx="1.75" fill="#302937" opacity=".55"/><rect x="${x + w * .3}" y="${y + 34}" width="${w * .4}" height="2.5" rx="1.25" fill="#302937" opacity=".25"/>`
// Light from the left: bright left third, a soft core shadow near the right edge, a slight bounce on the rim.
const lit = (base, light, core, rim) => [[0, light], [.3, base], [.78, core], [1, rim]]

const KINDS = {
  cleanser: { vb: [0, 36, 128, 228], draw: p => `
    ${shadow(p, 60, 48)}
    <rect x="22" y="96" width="76" height="160" rx="16" fill="url(#${p}a)"/>
    ${label(32, 148, 56, 62)}
    <rect x="44" y="78" width="32" height="20" rx="4" fill="url(#${p}m)"/>
    <path d="M44 84H76M44 89H76" stroke="#302937" stroke-opacity=".12"/>
    <rect x="56" y="60" width="8" height="20" fill="url(#${p}c)"/>
    <rect x="38" y="46" width="44" height="16" rx="5" fill="url(#${p}c)"/>
    <path d="M80 50H104a3 3 0 0 1 0 6H80Z" fill="url(#${p}c)"/>`,
    defs: p => across(p + 'a', lit('#F3F0F5', '#FBFAFC', '#E2DCE7', '#ECE8F0')) + across(p + 'c', lit('#E3DEE8', '#F4F2F6', '#CFC7D8', '#DCD6E2')) + across(p + 'm', lit('#D5C6B1', '#E9DFD0', '#BBA88E', '#CCBBA3')) },
  serum: { vb: [0, 26, 128, 238], draw: p => `
    ${shadow(p, 60, 38)}
    <rect x="28" y="128" width="64" height="128" rx="12" fill="url(#${p}a)"/>
    <rect x="31" y="176" width="58" height="77" rx="9" fill="#6E5BA6" opacity=".22"/>
    <path d="M31 178H89" stroke="#FFFFFF" stroke-opacity=".35"/>
    <rect x="58" y="118" width="4" height="118" rx="2" fill="#FFFFFF" opacity=".35"/>
    ${label(37, 146, 46, 50)}
    <rect x="46" y="112" width="28" height="18" rx="3" fill="url(#${p}a)"/>
    <rect x="40" y="90" width="40" height="24" rx="4" fill="url(#${p}m)"/>
    <path d="M40 96H80M40 108H80" stroke="#302937" stroke-opacity=".1"/>
    <rect x="46" y="34" width="28" height="60" rx="13" fill="url(#${p}r)"/>`,
    defs: p => across(p + 'a', lit('#CFC6E3', '#E4DEF0', '#AFA2CC', '#C2B8DA')) + across(p + 'm', lit('#D5C6B1', '#E9DFD0', '#BBA88E', '#CCBBA3')) + across(p + 'r', lit('#433A4C', '#5E5468', '#2E2735', '#3A3242')) },
  cream: { vb: [0, 126, 176, 138], draw: p => `
    ${shadow(p, 85, 74)}
    <rect x="20" y="172" width="130" height="84" rx="18" fill="url(#${p}a)"/>
    ${label(55, 192, 60, 46)}
    <rect x="14" y="136" width="142" height="40" rx="10" fill="url(#${p}c)"/>
    <path d="M14 146H156M14 166H156" stroke="#302937" stroke-opacity=".06"/>
    <rect x="18" y="174" width="134" height="3" fill="#302937" opacity=".07"/>`,
    defs: p => across(p + 'a', lit('#EED3C2', '#F6E4D8', '#D9B6A0', '#E4C5B1')) + across(p + 'c', lit('#F1EEF3', '#FAF9FB', '#DAD4E0', '#E7E3EB')) },
  spf: { vb: [0, 18, 128, 246], draw: p => `
    ${shadow(p, 60, 40)}
    <path d="M27 40H93Q90 130 85 214H35Q30 130 27 40Z" fill="url(#${p}a)"/>
    <rect x="23" y="28" width="74" height="14" rx="2" fill="url(#${p}a)"/>
    <path d="M25 32H95M25 36H95" stroke="#302937" stroke-opacity=".1"/>
    ${label(40, 96, 40, 52)}
    <rect x="35" y="212" width="50" height="44" rx="8" fill="url(#${p}c)"/>
    <path d="M35 222H85" stroke="#FFFFFF" stroke-opacity=".25"/>`,
    defs: p => across(p + 'a', lit('#E6ECE7', '#F3F6F3', '#CBD6CE', '#DCE4DE')) + across(p + 'c', lit('#93AA9E', '#AFC2B7', '#748C80', '#86A092')) },
  toner: { vb: [0, 48, 118, 216], draw: p => `
    ${shadow(p, 55, 38)}
    <rect x="24" y="84" width="62" height="172" rx="9" fill="url(#${p}a)"/>
    <rect x="27" y="116" width="56" height="137" rx="7" fill="#F1C9B4" opacity=".35"/>
    ${label(33, 148, 44, 54)}
    <rect x="32" y="58" width="46" height="28" rx="4" fill="url(#${p}c)"/>`,
    defs: p => across(p + 'a', lit('#E2E9EE', '#F2F6F8', '#C6D2DB', '#D6DFE6')) + across(p + 'c', lit('#6B6471', '#857D8C', '#4E4855', '#5B5462')) },
}

export function bottle(kind, cls = '') {
  const k = KINDS[kind], p = `b${++n}`
  return `<svg class="bottle ${cls}" viewBox="${k.vb.join(' ')}" style="--h:${k.vb[3]}" aria-hidden="true" focusable="false"><defs>${k.defs(p)}</defs>${k.draw(p)}</svg>`
}

// The bathroom shelf in morning light: the visual pause before the routine.
export function scene() {
  const p = `sc${++n}`, place = (kind, x, s) => { const k = KINDS[kind]; return `<g transform="translate(${x} ${300 - k.vb[3] * s}) scale(${s})"><g transform="translate(0 ${-k.vb[1]})">${k.draw(p + kind)}</g></g>` }
  return `<svg class="scene" viewBox="0 0 1200 380" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
  <defs>
    <filter id="${p}blur" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="18"/></filter>
    ${down(p + 'wall', [[0, '#F1EDF5'], [1, '#E9E4F0']])}
    ${down(p + 'wood', [[0, '#EADCCB'], [1, '#DCC9B4']])}
    ${Object.keys(KINDS).map(k => KINDS[k].defs(p + k)).join('')}
  </defs>
  <rect width="1200" height="380" fill="url(#${p}wall)"/>
  <g filter="url(#${p}blur)" fill="#FFFFFF">
    <path d="M120 -40H330L560 300H350Z" opacity=".55"/><path d="M380 -40H470L700 300H610Z" opacity=".4"/>
    <circle cx="80" cy="40" r="140" fill="#F7E3D6" opacity=".7"/>
  </g>
  <rect x="0" y="300" width="1200" height="18" fill="url(#${p}wood)"/>
  <rect x="0" y="318" width="1200" height="62" fill="#E2DBEA"/>
  <rect x="0" y="318" width="1200" height="6" fill="#302937" opacity=".06"/>
  <g transform="translate(250 0)">
    <path d="M30 300C30 262 40 246 60 246C80 246 90 262 90 300Z" fill="#F2EEE8"/>
    <path d="M60 246C50 214 34 200 18 196M60 246C62 210 74 190 92 182M60 246C68 222 90 214 108 216M60 246C46 228 30 228 16 236" fill="none" stroke="#7E9A8C" stroke-width="5" stroke-linecap="round"/>
    <ellipse cx="18" cy="194" rx="14" ry="7" fill="#8FAA9C" transform="rotate(-20 18 194)"/><ellipse cx="94" cy="180" rx="14" ry="7" fill="#8FAA9C" transform="rotate(-30 94 180)"/><ellipse cx="110" cy="216" rx="13" ry="6" fill="#9DB6A9"/><ellipse cx="14" cy="236" rx="12" ry="6" fill="#9DB6A9" transform="rotate(20 14 236)"/>
  </g>
  ${place('cleanser', 420, 1.05)}${place('serum', 548, 1)}${place('cream', 672, 1)}${place('spf', 858, 1.02)}
  <g transform="translate(940 252)">
    <rect width="150" height="48" rx="8" fill="#F6F1E9"/><rect y="16" width="150" height="4" fill="#E4D9CA"/><rect y="30" width="150" height="4" fill="#E4D9CA"/>
  </g>
</svg>`
}
