// Build pearlkin/landing-v6: index.html and 404.html from the v6 templates, plus og.out.html for the share image.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { bottle, scene } from './v6/bottles.mjs'
import { avatar, portrait } from './v6/portrait.mjs'
import { report } from './v6/report.mjs'

const [, , scratch, out] = process.argv
const src = f => readFileSync(`${scratch}/v6/${f}`, 'utf8')
const b64 = f => readFileSync(`${scratch}/${f}`).toString('base64')
const parts = Object.fromEntries([...src('parts.html').matchAll(/<!--([A-Z_]+)-->\n([\s\S]*?)(?=\n<!--)/g)].map(m => [m[1], m[2]]))
const css = src('common.css').replace('__MANROPE__', () => b64('font/package/files/manrope-latin-wght-normal.woff2'))
  .replace('__SOURCE_SANS__', () => b64('ssans/package/files/source-sans-3-latin-wght-normal.woff2'))

function icons(html) {
  const names = [...new Set([...html.matchAll(/#i-([a-z-]+)/g)].map(m => m[1]))]
  return '<svg width="0" height="0" style="position:absolute" aria-hidden="true">\n<!-- Phosphor Icons (MIT), regular weight -->\n' + names.map(n => {
    const svg = readFileSync(`${scratch}/ph/package/assets/regular/${n}.svg`, 'utf8')
    return `<symbol id="i-${n}" viewBox="0 0 256 256">${svg.replace(/^.*?<svg[^>]*>/s, '').replace(/<\/svg>\s*$/, '')}</symbol>`
  }).join('\n') + '\n</svg>'
}
function build(file) {
  let html = src(file)
    .replace('__HEAD_COMMON__', () => parts.HEAD_COMMON).replace('__CSS_COMMON__', () => css).replace('__FOOTER__', () => parts.FOOTER)
    .replace('__MENU_JS__', () => parts.MENU_JS).replace('__REPORT__', () => report()).replace('{{scene}}', () => scene()).replace(/{{avatar:([a-z]+)}}/g, (_, w) => avatar(w)).replace(/{{face:([a-z]+):([a-z]+)}}/g, (_, w, r) => portrait(w, { region: r, viewBox: '90 110 220 220' })).replace(/\{\{bottle:([a-z]+)\}\}/g, (_, k) => bottle(k))
  const strip = s => s.replace(/<[^>]+>/g, '').trim()
  // Only the FAQ list goes into the schema, not the other details on the page.
  const faqHtml = html.match(/<div class="faq">[\s\S]*?\n      <\/div>/)?.[0] ?? ''
  const faq = [...faqHtml.matchAll(/<details><summary[^>]*>(.*?)<svg.*?<\/summary><p[^>]*>(.*?)<\/p><\/details>/g)]
    .map(([, q, a]) => ({ '@type': 'Question', name: strip(q), acceptedAnswer: { '@type': 'Answer', text: strip(a) } }))
  html = html.replace('__FAQ_SCHEMA__', () => JSON.stringify({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq }))
  return html.replace('__ICONS__', () => icons(html))
}

mkdirSync(out, { recursive: true })
for (const f of ['index.html', '404.html']) { const h = build(f); writeFileSync(`${out}/${f}`, h); console.log(f, h.length) }
writeFileSync(`${scratch}/v6/og.out.html`, build('og.html'))
