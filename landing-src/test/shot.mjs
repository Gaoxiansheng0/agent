// node shot.mjs <url> <out.png> <width> <height> <waitMs> [js to run before waiting] [mobile] [transparent]
import { spawn, spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
const [, , url, out, w, h, waitMs, js, mobile, background] = process.argv
const port = 9400 + Math.floor(Math.random() * 500)
const edge = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${process.env.TEMP}/pk-shot-${port}`, 'about:blank'])
const wait = ms => new Promise(r => setTimeout(r, ms))
let t; for (let i = 0; i < 40; i++) { try { t = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break } catch { await wait(250) } }
const ws = new WebSocket(t.find(x => x.type === 'page').webSocketDebuggerUrl); await new Promise(r => ws.addEventListener('open', r))
let id = 0; const p = new Map(); ws.addEventListener('message', e => { const m = JSON.parse(e.data); p.get(m.id)?.(m) })
const send = (method, params = {}) => new Promise(r => { const i = ++id; p.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
await send('Emulation.setDeviceMetricsOverride', { width: +w, height: +h, deviceScaleFactor: 1, mobile: mobile === 'mobile' })
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })
if (background === 'transparent') await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } })
await send('Page.navigate', { url }); await wait(1200)
if (js) { const r = await send('Runtime.evaluate', { expression: js, awaitPromise: true, returnByValue: true }); if (r.result?.result?.value !== undefined) console.log(JSON.stringify(r.result.result.value)); if (r.result?.exceptionDetails) console.log('EXC', JSON.stringify(r.result.exceptionDetails).slice(0, 400)) }
await wait(+waitMs)
const s = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(out, Buffer.from(s.result.data, 'base64'))
ws.close(); spawnSync('taskkill', ['/T', '/F', '/PID', String(edge.pid)])
