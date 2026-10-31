// node report-test.mjs <url> <width> <height> <outDir>: the example report switches people, each with their own measures.
import { spawn, spawnSync } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
const [, , url, W, H, out] = process.argv
mkdirSync(out, { recursive: true })
const port = 9900 + Math.floor(Math.random() * 90)
const edge = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${process.env.TEMP}/pk-rep-${port}`, 'about:blank'])
const wait = ms => new Promise(r => setTimeout(r, ms))
let t; for (let i = 0; i < 40; i++) { try { t = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break } catch { await wait(250) } }
const ws = new WebSocket(t.find(x => x.type === 'page').webSocketDebuggerUrl); await new Promise(r => ws.addEventListener('open', r))
let id = 0; const p = new Map(); ws.addEventListener('message', e => { const m = JSON.parse(e.data); p.get(m.id)?.(m) })
const send = (method, params = {}) => new Promise(r => { const i = ++id; p.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true }); return r.result.exceptionDetails ? 'EXC ' + r.result.exceptionDetails.exception?.description?.slice(0, 200) : r.result.result.value }
const shot = async n => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${out}/${W}-${n}.png`, Buffer.from(r.result.data, 'base64')) }
await send('Emulation.setDeviceMetricsOverride', { width: +W, height: +H, deviceScaleFactor: 1, mobile: +W < 768 })
await send('Runtime.enable')
const errors = []; ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description?.slice(0, 200)) })
await send('Page.navigate', { url }); await wait(1500)
await ev(`scrollTo({ top: document.querySelector('.who').getBoundingClientRect().top + scrollY - 80, behavior: 'instant' })`); await wait(300)
const h0 = await ev(`document.getElementById('report').offsetHeight`)
const state = `(() => { const c = document.querySelector('#report > .on'); return [c.dataset.w, c.querySelector('.rep-who b').textContent.trim(), c.querySelector('.stat .num')?.firstChild.textContent ?? '-', [...c.querySelectorAll('.all li span:last-child')].map(x => x.textContent).join(','), c.querySelector('.fo[aria-checked=true] .t-title')?.textContent ?? '-', (c.querySelector('.detail .on .means .t-title') || c.querySelector('.detail .means .t-title'))?.textContent ?? '-'].join(' | ') })()`
const r = { mia: await ev(state) }
await shot('rep-mia')
for (const w of ['leo', 'ava', 'nora']) {
  await ev(`document.getElementById('r-${w}').click()`); await wait(300)
  r[w] = await ev(state)
  await shot('rep-' + w)
}
await ev(`document.getElementById('r-leo').click()`); await wait(200)
await ev(`document.querySelector('#report > .on .fo[data-f=sensitivity]').click()`); await wait(300)
r.leoSens = await ev(state)
r.sameHeight = await ev(`document.getElementById('report').offsetHeight === ${h0}`)
await ev(`document.getElementById('p-nora').click()`); await wait(200)
r.familyStillWorks = await ev(`[document.querySelector('#fit-panel .on').dataset.p, document.querySelector('#report > .on').dataset.w].join(' | ')`)
r.overflow = await ev('document.documentElement.scrollWidth + "/" + innerWidth')
r.errors = errors
console.log(JSON.stringify(r, null, 1))
ws.close(); spawnSync('taskkill', ['/T', '/F', '/PID', String(edge.pid)])
