// node test/a11y.mjs <url> <outDir>: contrast of every visible text node, keyboard focus order, 320px reflow.
import { spawn, spawnSync } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'

const [, , url, outDir] = process.argv
mkdirSync(outDir, { recursive: true })
const port = 9500 + Math.floor(Math.random() * 400)
const edge = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${process.env.TEMP}/pk-a11y-${port}`, 'about:blank'])
const wait = ms => new Promise(r => setTimeout(r, ms))
let targets
for (let i = 0; i < 40; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break } catch { await wait(250) } }
const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl)
await new Promise(r => ws.addEventListener('open', r))
let id = 0; const pending = new Map()
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result.exceptionDetails ? 'EXC ' + JSON.stringify(r.result.exceptionDetails).slice(0, 300) : r.result.result.value }
const shot = async name => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${outDir}/${name}.png`, Buffer.from(r.result.data, 'base64')) }

await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 820, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url }); await wait(1500)
const out = {}

// Contrast: text color against the first opaque background behind it (alpha blended), all stacked variants shown.
out.contrast = await ev(`(() => {
  document.querySelectorAll('.stack > *').forEach(e => e.classList.add('on'))
  document.querySelectorAll('details').forEach(d => d.open = true)
  const parse = c => { const m = c.match(/[\\d.]+/g).map(Number); return { r: m[0], g: m[1], b: m[2], a: m[3] ?? 1 } }
  const lum = ({ r, g, b }) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
  const blend = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 })
  function bg(el) {
    const layers = []
    for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c.a > 0) { layers.push(c); if (c.a === 1) break } }
    let res = { r: 255, g: 255, b: 255, a: 1 }
    for (const l of layers.reverse()) res = blend(l, res)
    return res
  }
  const bad = [], seen = new Set()
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    const t = walker.currentNode, el = t.parentElement
    if (!t.textContent.trim() || !el.offsetParent || el.closest('svg, .skip, [aria-hidden=true]:not(.family-shelf):not(.stage)')) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || +cs.opacity === 0) continue
    const fg = blend(parse(cs.color), bg(el)), b = bg(el)
    const [l1, l2] = [lum(fg), lum(b)].sort((x, y) => y - x)
    const ratio = (l1 + 0.05) / (l2 + 0.05), size = parseFloat(cs.fontSize), large = size >= 24 || (size >= 18.66 && +cs.fontWeight >= 700)
    const key = cs.color + '|' + JSON.stringify(b) + '|' + size
    if (ratio < (large ? 3 : 4.5) && !seen.has(key)) { seen.add(key); bad.push(ratio.toFixed(2) + ' ' + size + 'px "' + t.textContent.trim().slice(0, 40) + '" ' + cs.color) }
  }
  return bad
})()`)

// Keyboard: tab through the page, every stop must show a visible focus ring.
await send('Page.navigate', { url }); await wait(1200)
const stops = []
for (let i = 0; i < 70; i++) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
  await wait(40)
  stops.push(await ev(`(() => { const a = document.activeElement, cs = getComputedStyle(a); return (a.textContent.trim().slice(0, 22) || a.getAttribute('aria-label') || a.tagName) + (cs.outlineStyle === 'none' || cs.outlineWidth === '0px' ? ' [NO RING]' : '') })()`))
  if (i === 6) await shot('focus-hero')
}
out.focusStops = stops.length
out.noRing = stops.filter(s => s.includes('NO RING'))
out.order = stops.slice(0, 26)

// Reflow at 320px.
await send('Emulation.setDeviceMetricsOverride', { width: 320, height: 640, deviceScaleFactor: 1, mobile: true })
await send('Page.navigate', { url }); await wait(1500)
out.reflow320 = await ev('document.documentElement.scrollWidth + "/" + innerWidth')
out.wide320 = await ev(`[...document.querySelectorAll('body *')].filter(e => e.offsetParent && e.getBoundingClientRect().right > innerWidth + 1).map(e => e.className || e.tagName).slice(0, 8)`)
await shot('w320-hero')
await ev(`document.getElementById('fit').scrollIntoView()`); await wait(400); await shot('w320-fit')
await ev(`document.getElementById('pricing').scrollIntoView()`); await wait(400); await shot('w320-pricing')
console.log(JSON.stringify(out, null, 1))
ws.close(); spawnSync('taskkill', ['/T', '/F', '/PID', String(edge.pid)])
