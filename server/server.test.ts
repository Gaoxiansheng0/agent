import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { createApp, MODEL } from './server.ts'

// Fake Anthropic client: records the request, returns a canned response. No network, no cost.
function fakeClient(reply: object) {
  const calls: any[] = []
  return { calls, client: { beta: { messages: { create: async (p: any) => (calls.push(p), reply) } } } as any }
}
const ok = (json: object) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(json) }] })
const LABEL = { found: true, product_name: 'Glow Serum', ingredients: [' Aqua (Water)', 'Retinol', ''], unreadable: false }

async function serve(opts: Parameters<typeof createApp>[0]) {
  const server = createApp(opts).listen(0)
  await new Promise(r => server.once('listening', r))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${url}/api/ocr`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
  return { url, post, close: () => server.close() }
}

test('transcribes a label and sends only the photo to the model', async () => {
  const { calls, client } = fakeClient(ok(LABEL))
  const s = await serve({ client })
  const res = await s.post({ image: 'data:image/jpeg;base64,AAAA', media_type: 'image/jpeg' })
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { found: true, product_name: 'Glow Serum', ingredients: ['Aqua (Water)', 'Retinol'], unreadable: false })
  const p = calls[0]
  assert.equal(p.model, MODEL)
  assert.equal(p.fallbacks, 'default')
  assert.equal(p.output_config.format.type, 'json_schema')
  assert.deepEqual(p.messages[0].content[0].source, { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' })
  s.close()
})

test('rejects bad input before calling the model', async () => {
  const { calls, client } = fakeClient(ok(LABEL))
  const s = await serve({ client })
  assert.equal((await s.post({ image: 'not base64!' })).status, 400)
  assert.equal((await s.post({ image: 'AAAA', media_type: 'image/gif' })).status, 400)
  assert.equal((await fetch(`${s.url}/api/ocr`, { method: 'POST', body: 'x'.repeat(9 * 1024 * 1024) }).catch(() => ({ status: 413 }))).status, 413)
  assert.equal((await fetch(`${s.url}/nope`)).status, 404)
  assert.equal(calls.length, 0)
  s.close()
})

test('app token is enforced when configured', async () => {
  const s = await serve({ client: fakeClient(ok(LABEL)).client, appToken: 'secret-token' })
  assert.equal((await s.post({ image: 'AAAA' })).status, 401)
  assert.equal((await s.post({ image: 'AAAA' }, { 'x-app-token': 'wrong-token!' })).status, 401)
  assert.equal((await s.post({ image: 'AAAA' }, { 'x-app-token': 'secret-token' })).status, 200)
  s.close()
})

test('rate limit per IP, window slides', async () => {
  let t = 0
  const s = await serve({ client: fakeClient(ok(LABEL)).client, now: () => t })
  for (let i = 0; i < 30; i++) assert.equal((await s.post({ image: 'AAAA' })).status, 200)
  assert.equal((await s.post({ image: 'AAAA' })).status, 429)
  t += 60 * 60 * 1000
  assert.equal((await s.post({ image: 'AAAA' })).status, 200)
  s.close()
})

test('refusal and malformed model output become clean errors', async () => {
  const refused = await serve({ client: fakeClient({ stop_reason: 'refusal', content: [] }).client })
  assert.equal((await refused.post({ image: 'AAAA' })).status, 422)
  refused.close()
  const garbled = await serve({ client: fakeClient({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"found":true}' }] }).client })
  assert.equal((await garbled.post({ image: 'AAAA' })).status, 502)
  garbled.close()
})
