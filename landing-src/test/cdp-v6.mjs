// node cdp-v6.mjs <url> <outDir> <width> <height>: real rendering in headless Edge, checks plus screenshots per section.
import { spawn, spawnSync } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'

const [, , url, outDir, W, H] = process.argv
const w = +W, h = +H, mobile = w < 768, tag = String(w)
mkdirSync(outDir, { recursive: true })
const port = 9500 + Math.floor(Math.random() * 400)
const edge = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${process.env.TEMP}/pk-v6-${port}`, 'about:blank'])
const wait = ms => new Promise(r => setTimeout(r, ms))
let targets
for (let i = 0; i < 40; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break } catch { await wait(250) } }
const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl)
await new Promise(r => ws.addEventListener('open', r))
let id = 0; const pending = new Map()
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result.exceptionDetails ? 'EXC ' + JSON.stringify(r.result.exceptionDetails).slice(0, 300) : r.result.result.value }
const shot = async name => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${outDir}/${tag}-${name}.png`, Buffer.from(r.result.data, 'base64')) }
const q = s => `document.querySelector('${s}')`
const to = async (sel, off = 72) => { await ev(`(() => { const el = ${q(sel)}; scrollTo({ top: el.getBoundingClientRect().top + scrollY - ${off}, behavior: 'instant' }) })()`); await wait(400) }

await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile })
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })
await send('Runtime.enable')
const errors = []
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description?.slice(0, 200)) })
await send('Page.navigate', { url }); await wait(1500)
await shot('hero')
const r = {}
r.overflow = await ev('document.documentElement.scrollWidth + "/" + innerWidth')
r.firstScreen = await ev(`'cta ' + Math.round(${q('.hero .btn')}.getBoundingClientRect().bottom) + ', result text ' + Math.round(${q('#result .on .t-body')}.getBoundingClientRect().bottom) + ' of ' + innerHeight`)
const h0 = await ev(`${q('#result')}.offsetHeight`)
await ev(`${q('.prod[data-k=serum]')}.click()`); await wait(300)
r.hero = await ev(`[${q('#result .on')}.dataset.k, ${q('.prod[data-k=serum]')}.getAttribute('aria-checked'), ${q('.prod[data-k=serum]')}.getAttribute('role'), ${q('#result')}.offsetHeight === ${h0}].join(' | ')`)
await ev(`${q('.prod[data-k=cream]')}.click()`); await wait(300)

await to('#example'); await shot('example')
await ev(`${q('.fo[data-f=lines]')}.click()`); await wait(400)
r.report = await ev(`[${q('.detail .on')}.dataset.f, ${q('.detail .on .means .t-title')}.textContent, Math.round(${q('.detail .on .means')}.getBoundingClientRect().top - ${q('.fo[data-f=lines]')}.getBoundingClientRect().bottom)].join(' | ')`)
await to('.rep-body'); await shot('example-lines')

await to('#routine'); await shot('routine')
for (const t of ['nospf', 'acid', 'many']) {
  await ev(`${q(`.chip[data-t=${t}]`)}.click()`); await wait(300)
  r['try-' + t] = await ev(`[${q('#routine-steps')}.dataset.try, ${q('.try .on')}.textContent.trim().slice(0, 40), [...document.querySelectorAll('.pm .step')].filter(s => getComputedStyle(s).display !== 'none').length].join(' | ')`)
}
await to('.routine'); await shot('routine-many')
await ev(`${q('.chip[data-t=none]')}.click()`)

await to('#family'); await shot('family')
const f0 = await ev(`${q('#fit-panel')}.offsetHeight`)
for (const p of ['leo', 'ava', 'nora']) {
  await ev(`${q('#p-' + p)}.click()`); await wait(300)
  r['fit-' + p] = await ev(`[${q('#fit-panel .on .verdict')}.textContent.trim(), ${q('#fit-panel .on a')}?.href.split('/')[2] || '-', ${q('#fit-panel')}.offsetHeight === ${f0}].join(' | ')`)
}
await to('.fit'); await shot('family-nora')
for (const sel of ['#trust', '#pricing', '#faq', '.final']) { await to(sel); await shot(sel.replace(/[#.]/g, '')) }

// Notify form: empty, malformed, then a real submit against this server (the local preview has no API, so it must fail visibly).
await to('#pricing')
await ev(`${q('#notify button')}.click()`); await wait(200)
r.formEmpty = await ev(`${q('#notify-msg')}.textContent`)
await ev(`${q('#notify input')}.value = 'a@b'; ${q('#notify button')}.click()`); await wait(200)
r.formBad = await ev(`${q('#notify-msg')}.textContent`)
await ev(`${q('#notify input')}.value = 'test@example.com'; ${q('#notify button')}.click()`); await wait(1500)
r.formSubmit = await ev(`[${q('#notify-msg')}.className, ${q('#notify-msg')}.textContent, ${q('#notify button')}.textContent].join(' | ')`)
await shot('form')

r.faqSchema = await ev('JSON.parse(document.querySelector("script[type=\"application/ld+json\"]").textContent).mainEntity.length')
r.small = await ev(`[...document.querySelectorAll('main a, main button, main summary')].filter(e => e.offsetParent && !e.closest('.photo-note, .why-text, .facts3, .study p, .sec-head, .stat')).map(e => [e, e.getBoundingClientRect()]).filter(([, b]) => b.height < 44 || b.width < 44).map(([e, b]) => (e.className || e.tagName) + ':' + Math.round(b.width) + 'x' + Math.round(b.height)).slice(0, 10)`)
r.errors = errors
console.log(JSON.stringify(r, null, 1))
ws.close(); spawnSync('taskkill', ['/T', '/F', '/PID', String(edge.pid)])
