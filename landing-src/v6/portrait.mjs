// Illustrated example people: Mia (you), Leo (teen), Nora (partner), Ava (child). One face shape for everyone, so the measured regions line up;
// skin tone, hair and clothes change per person. Eyes closed, no real photo involved.
const PEOPLE = {
  you: { skin: '#FBDCCB', shade: '#F6CDB8', ear: '#F6CBB5', neck: '#F0BFA6', blush: '#FF8FA3', brow: '#8A5A6C', line: '#4E2F40', nose: '#E29A82', lips: '#E66A86', lipLine: '#C9506F',
    hair: '#6B3F57', front: '#7A4864', shine: '#93607C', top: '#B8A6FF', topLine: '#9C86F2', style: 'long', earring: true, freckles: '#E3A08A' },
  teen: { skin: '#EBBE9A', shade: '#E0AE88', ear: '#E4B18D', neck: '#D69F7B', blush: '#E98B7E', brow: '#3A2A2E', line: '#3A2A2E', nose: '#C98B6A', lips: '#CF7A72', lipLine: '#B0605A',
    hair: '#2F2530', front: '#3A2E3C', shine: '#5A4A5C', top: '#A9C7B8', topLine: '#8DB09F', style: 'short' },
  partner: { skin: '#B47D58', shade: '#A46D4A', ear: '#A8714E', neck: '#9A6441', blush: '#C9655F', brow: '#2A1E22', line: '#2A1E22', nose: '#8A5636', lips: '#9C4E50', lipLine: '#7E3A3E',
    hair: '#231C24', front: '#2C232E', shine: '#4A3E4C', top: '#F1BFA4', topLine: '#E3A585', style: 'bun', earring: true, dot: '#EFEAFF' },
}
// Where each measure sits on the face (viewBox 400 x 440); the ring is drawn here.
export const ANCHOR = { oil: [200, 140], pores: [227, 226], circles: [166, 208], lines: [261, 189], acne: [146, 268], blackheads: [200, 229], spots: [253, 214], sensitivity: [160, 246], bags: [234, 216] }

const HAIR = {
  long: p => ({
    back: `<path d="M200 58C126 58 86 112 88 196C90 252 82 300 74 336C68 362 76 384 98 384L302 384C324 384 332 362 326 336C318 300 310 252 312 196C314 112 274 58 200 58Z" fill="${p.hair}"/>`,
    sides: `<path d="M104 236C98 290 92 336 98 372C102 396 124 404 140 392C128 364 128 320 136 276Z" fill="${p.hair}"/><path d="M296 236C302 290 308 336 302 372C298 396 276 404 260 392C272 364 272 320 264 276Z" fill="${p.hair}"/>`,
    front: `<path d="M200 70C138 70 98 112 102 196C108 152 126 124 156 110C186 98 228 100 256 116C278 130 290 160 296 196C302 116 264 70 200 70Z" fill="${p.front}"/><path d="M176 78C150 104 150 134 186 152C168 128 176 102 214 90C204 82 190 78 176 78Z" fill="${p.front}"/><path d="M168 92C200 82 240 88 262 106" fill="none" stroke="${p.shine}" stroke-width="3" stroke-linecap="round" opacity=".7"/>` }),
  short: p => ({
    back: `<path d="M200 62C134 62 96 108 98 186L112 196C116 142 146 108 200 104C254 108 284 142 288 196L302 186C304 108 266 62 200 62Z" fill="${p.hair}"/>`,
    sides: '',
    front: `<path d="M110 168C112 108 152 74 204 74C254 74 292 104 292 160C276 130 250 114 222 112C230 122 232 132 228 140C210 120 176 114 150 124C132 132 118 148 110 168Z" fill="${p.front}"/><path d="M176 88C206 80 246 88 268 110" fill="none" stroke="${p.shine}" stroke-width="3" stroke-linecap="round" opacity=".7"/>` }),
  bun: p => ({
    back: `<circle cx="200" cy="52" r="34" fill="${p.hair}"/><path d="M200 66C132 66 94 112 98 192C100 214 104 230 110 240L122 236C116 160 146 110 200 106C254 110 284 160 278 236L290 240C296 230 300 214 302 192C306 112 268 66 200 66Z" fill="${p.hair}"/>`,
    sides: '',
    front: `<path d="M200 80C152 80 112 108 104 172C124 128 156 104 196 102C188 96 192 88 200 80Z" fill="${p.front}"/><path d="M200 80C248 80 288 108 296 172C276 128 244 104 204 102C212 96 208 88 200 80Z" fill="${p.front}"/><ellipse cx="200" cy="90" rx="12" ry="9" fill="${p.front}"/><path d="M188 40C200 34 216 36 226 46" fill="none" stroke="${p.shine}" stroke-width="3" stroke-linecap="round" opacity=".7"/>` }),
}
// The child, Ava: a bob with straight bangs.
PEOPLE.child = { skin: '#F5D3B8', shade: '#EDC4A6', ear: '#EEC6A9', neck: '#E6B898', blush: '#F58E8E', brow: '#6E4A3A', line: '#4A3228', nose: '#D99A7C', lips: '#E07C82', lipLine: '#C2626A',
  hair: '#8A5A3E', front: '#966548', shine: '#B58463', top: '#F6E2B8', topLine: '#E8CC92', style: 'bob' }
HAIR.bob = p => ({
  back: `<path d="M200 62C130 62 92 110 94 190C95 230 98 262 104 290L296 290C302 262 305 230 306 190C308 110 270 62 200 62Z" fill="${p.hair}"/>`,
  sides: '',
  front: `<path d="M112 168C108 110 146 76 200 76C254 76 292 110 288 168C282 154 276 150 270 150L130 150C124 150 118 154 112 168Z" fill="${p.front}"/><path d="M160 92C190 84 230 88 254 102" fill="none" stroke="${p.shine}" stroke-width="3" stroke-linecap="round" opacity=".7"/>` })

let count = 0
// o.region: highlight one measured area, with a ring on it. o.plain: just the person (avatars). o.viewBox: crop.
export function portrait(who, o = {}) {
  const p = PEOPLE[who], h = HAIR[p.style](p), k = ++count, id = s => `pk${k}-${s}`
  const [rx, ry] = o.region ? ANCHOR[o.region] : [-40, -40]
  const regions = {
    oil: '<path d="M160 128H240V160H160ZM191 160H209V226H191Z"/>',
    pores: '<ellipse cx="173" cy="226" rx="17" ry="12"/><ellipse cx="227" cy="226" rx="17" ry="12"/>',
    circles: '<ellipse cx="166" cy="208" rx="21" ry="7"/><ellipse cx="234" cy="208" rx="21" ry="7"/>',
    lines: '<circle cx="139" cy="189" r="11"/><circle cx="261" cy="189" r="11"/>',
    acne: '<circle cx="146" cy="268" r="17"/><circle cx="246" cy="262" r="13"/><ellipse cx="200" cy="292" rx="15" ry="8"/>',
    blackheads: '<circle cx="200" cy="229" r="10"/><ellipse cx="200" cy="292" rx="19" ry="9"/>',
    spots: '<circle cx="253" cy="214" r="17"/><circle cx="150" cy="218" r="13"/><ellipse cx="200" cy="138" rx="22" ry="9"/>',
    sensitivity: '<ellipse cx="160" cy="246" rx="17" ry="13"/><ellipse cx="240" cy="246" rx="17" ry="13"/>',
    bags: '<ellipse cx="166" cy="216" rx="18" ry="6"/><ellipse cx="234" cy="216" rx="18" ry="6"/>',
  }
  const overlay = o.plain ? '' : `<g clip-path="url(#${id('face')})"><g fill="url(#${id('dots')})">${o.region ? regions[o.region] : ''}</g></g>`
  const ring = o.region ? `<circle r="18" fill="none" stroke="#FFFFFF" stroke-width="6" opacity=".9" cx="${rx}" cy="${ry}"/><circle r="18" fill="none" stroke="#302937" stroke-width="2.5" cx="${rx}" cy="${ry}"/>` : ''
  return `<svg class="portrait ${o.cls || ''}" viewBox="${o.viewBox || '0 0 400 440'}" aria-hidden="true" focusable="false">
  <defs>
    <pattern id="${id('dots')}" width="7" height="7" patternUnits="userSpaceOnUse"><circle cx="3.5" cy="3.5" r="1.5" fill="${p.dot || '#5B47B8'}"/></pattern>
    <clipPath id="${id('face')}"><path d="M200 92C255 92 290 135 290 195C290 255 250 305 200 305C150 305 110 255 110 195C110 135 145 92 200 92Z"/></clipPath>
  </defs>
  ${h.back}
  <path d="M36 480L44 440C54 384 118 352 200 352C282 352 346 384 356 440L364 480Z" fill="${p.top}"/>
  <path d="M150 364C168 384 232 384 250 364" fill="none" stroke="${p.topLine}" stroke-width="4" stroke-linecap="round"/>
  ${h.sides}
  <path d="M172 276L172 350C184 364 216 364 228 350L228 276Z" fill="${p.neck}"/>
  <ellipse cx="111" cy="204" rx="13" ry="19" fill="${p.ear}"/>
  <ellipse cx="289" cy="204" rx="13" ry="19" fill="${p.neck}"/>
  <path d="M200 92C255 92 290 135 290 195C290 255 250 305 200 305C150 305 110 255 110 195C110 135 145 92 200 92Z" fill="${p.skin}"/>
  <path d="M290 195C290 255 250 305 200 305C238 292 268 252 272 196C275 152 262 122 246 106C274 120 290 152 290 195Z" fill="${p.shade}"/>
  <circle cx="150" cy="238" r="21" fill="${p.blush}" opacity=".26"/>
  <circle cx="250" cy="238" r="21" fill="${p.blush}" opacity=".26"/>
  ${p.freckles ? `<g fill="${p.freckles}"><circle cx="246" cy="212" r="1.6"/><circle cx="255" cy="218" r="1.4"/><circle cx="262" cy="210" r="1.3"/><circle cx="240" cy="220" r="1.2"/></g>` : ''}
  <g fill="none" stroke-linecap="round">
    <path d="M150 168Q166 159 183 165" stroke="${p.brow}" stroke-width="${p.style === 'short' ? 5 : 4}"/>
    <path d="M217 165Q234 159 250 168" stroke="${p.brow}" stroke-width="${p.style === 'short' ? 5 : 4}"/>
    <path d="M150 193Q166 204 182 193M218 193Q234 204 250 193" stroke="${p.line}" stroke-width="3.5"/>
    ${p.style === 'short' ? '' : `<path d="M150 193L144 189M155 197L150 202M245 197L250 202M250 193L256 189" stroke="${p.line}" stroke-width="2.5"/>`}
    <path d="M203 206Q211 226 201 233Q196 234 192 231" stroke="${p.nose}" stroke-width="2.5"/>
  </g>
  <path d="M181 262Q191 255 200 259Q209 255 219 262Q201 280 181 262Z" fill="${p.lips}"/>
  <path d="M181 262Q200 266 219 262" fill="none" stroke="${p.lipLine}" stroke-width="1.5" stroke-linecap="round"/>
  ${overlay}
  ${h.front}
  ${p.earring ? `<circle cx="112" cy="234" r="7.5" fill="#FFFDF8" stroke="#EADCEB" stroke-width="1.5"/><circle cx="109.5" cy="231.5" r="2.2" fill="#FFFFFF"/>` : ''}
  ${ring}
</svg>`
}
export const avatar = who => portrait(who, { plain: true, viewBox: '80 30 240 240', cls: 'av' })
