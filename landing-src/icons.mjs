// Builds the site icons into ../landing: favicon.svg, favicon.ico (16/32/48 PNG inside an ICO) and apple-touch-icon.png (180).
// Run from landing-src/: node icons.mjs. Renders with headless Edge through test/shot.mjs.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const out = '../landing'
// Same mark the page used as an inline data: icon.
const mark = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="#302937"/><circle cx="16" cy="16" r="7" fill="#EEEAF4"/><circle cx="13.5" cy="13.5" r="2.2" fill="#fff"/></svg>`
writeFileSync(`${out}/favicon.svg`, mark + '\n')

const tmp = mkdtempSync(join(tmpdir(), 'pk-icons-'))
function render(size, bg) {
  // Apple touch icons are shown as rounded squares, so that one gets a full porcelain background.
  const page = `${tmp}/icon-${size}.html`, png = `${tmp}/icon-${size}.png`
  writeFileSync(page, `<!doctype html><style>html,body{margin:0;background:${bg}}svg{display:block;width:${size}px;height:${size}px}</style>${bg === 'transparent' ? mark : mark.replace('viewBox="0 0 32 32"', 'viewBox="-4 -4 40 40"')}`)
  const r = spawnSync('node', ['test/shot.mjs', `file:///${page.replace(/\\/g, '/')}`, png, String(size), String(size), '300', '', '', 'transparent'], { stdio: 'inherit' })
  if (r.status !== 0) throw new Error(`render ${size} failed`)
  return readFileSync(png)
}
writeFileSync(`${out}/apple-touch-icon.png`, render(180, '#FAFAF7'))

// ICO with embedded PNGs (supported by every current browser and by Google's favicon crawler).
const pngs = [16, 32, 48].map(s => [s, render(s, 'transparent')])
const head = Buffer.alloc(6 + 16 * pngs.length)
head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4)
let offset = head.length
pngs.forEach(([s, data], i) => {
  const e = 6 + 16 * i
  head.writeUInt8(s, e); head.writeUInt8(s, e + 1); head.writeUInt8(0, e + 2); head.writeUInt8(0, e + 3)
  head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6); head.writeUInt32LE(data.length, e + 8); head.writeUInt32LE(offset, e + 12)
  offset += data.length
})
writeFileSync(`${out}/favicon.ico`, Buffer.concat([head, ...pngs.map(([, d]) => d)]))
console.log('favicon.svg, favicon.ico (16/32/48), apple-touch-icon.png (180) written to', out)
