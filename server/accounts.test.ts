import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { Pack } from '../engine/engine.ts'
import { openDb } from './db.ts'
import { createApp } from './server.ts'
import { cleanReport, concernsFromReport, DIMENSIONS } from './skin.ts'

const bundled: Pack = JSON.parse(readFileSync(new URL('../engine/rule-pack.json', import.meta.url), 'utf8'))
const YEAR = new Date().getFullYear()

const skinReply = (over: object = {}) => ({
  choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
    face_found: true, skin_type: 'combination', skin_age: 31, overall: 70, confidence: 'high', summary: 'Mostly balanced skin.',
    dimensions: Object.fromEntries(DIMENSIONS.map(k => [k, { level: k === 'acne' ? 'moderate' : 'mild', score: k === 'acne' ? 90 : 75, note: 'ok' }])),
    priorities: ['acne', 'not-a-dimension'], look_for: ['niacinamide'], avoid: [], tips: ['Wear SPF'], ...over,
  }) } }],
  usage: { prompt_tokens: 1500, completion_tokens: 600 },
})
const adviceReply = { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
  summary: 'Simple routine.', am: [{ id: 'p_cleanser1', why: 'gentle' }, { id: 'p_unknown', why: 'x' }], pm: [], pause: [], conflicts: [], gaps: [{ need: 'Sunscreen', look_for: ['zinc oxide'], why: 'daily' }],
}) } }], usage: { prompt_tokens: 800, completion_tokens: 200 } }

function setup(opts: { reply?: () => object } = {}) {
  const db = openDb(':memory:', bundled)
  const calls: any[] = []
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1' } as any
  const app = createApp({
    db, sessionSecret: 'test', appleKeys: async () => [jwk], appleAudience: ['com.pearlwren.pearlkin'],
    client: { chat: async (p: any) => (calls.push(p), (opts.reply ?? (() => (p.messages[1].content[0]?.type === 'image_url' ? skinReply() : adviceReply)))()) } as any,
  })
  const req = (method: string, path: string, body?: unknown, token?: string) => app.request(path, {
    method, headers: { 'content-type': 'application/json', 'x-forwarded-for': '9.9.9.9', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const appleToken = (claims: object) => {
    const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
    const head = enc({ alg: 'RS256', kid: 'k1' }), body = enc({ iss: 'https://appleid.apple.com', aud: 'com.pearlwren.pearlkin', exp: Math.floor(Date.now() / 1000) + 600, ...claims })
    return `${head}.${body}.${sign('RSA-SHA256', Buffer.from(`${head}.${body}`), privateKey).toString('base64url')}`
  }
  const login = async (email: string) => {
    await req('POST', '/api/auth/email/start', { email })
    const code = db.get<{ dev_code: string }>('SELECT dev_code FROM auth_codes WHERE email = ?', email)!.dev_code
    return (await (await req('POST', '/api/auth/email/verify', { email, code })).json()).token as string
  }
  return { db, req, calls, appleToken, login }
}

test('email code sign-in: dev mode code, wrong code counts, token works', async () => {
  const s = setup()
  assert.equal((await s.req('POST', '/api/auth/email/start', { email: 'nope' })).status, 400)
  assert.equal((await s.req('POST', '/api/auth/email/start', { email: 'Mom@Example.com' })).status, 200)
  const { dev_code } = s.db.get<{ dev_code: string }>('SELECT dev_code FROM auth_codes WHERE email = ?', 'mom@example.com')!
  assert.match(dev_code, /^\d{6}$/)
  const wrong = dev_code === '000000' ? '111111' : '000000'
  assert.equal((await s.req('POST', '/api/auth/email/verify', { email: 'mom@example.com', code: wrong })).status, 400)
  const ok = await (await s.req('POST', '/api/auth/email/verify', { email: 'mom@example.com', code: dev_code })).json()
  assert.ok(ok.token)
  assert.equal(ok.user.email, 'mom@example.com')
  assert.equal((await s.req('POST', '/api/auth/email/verify', { email: 'mom@example.com', code: dev_code })).status, 400) // single use
  assert.equal((await s.req('GET', '/api/me', undefined, ok.token)).status, 200)
  assert.equal((await s.req('GET', '/api/me', undefined, 'garbage')).status, 401)
})

test('Sign in with Apple: verified token creates or links the account', async () => {
  const s = setup()
  const emailToken = await s.login('dad@example.com')
  const res = await (await s.req('POST', '/api/auth/apple', { identityToken: s.appleToken({ sub: 'apple-1', email: 'dad@example.com' }) })).json()
  assert.ok(res.token)
  const meEmail = await (await s.req('GET', '/api/me', undefined, emailToken)).json()
  assert.equal(res.user.id, meEmail.user.id) // linked, not duplicated
  assert.equal((await s.req('POST', '/api/auth/apple', { identityToken: s.appleToken({ sub: 'x', aud: 'com.evil.app' }) })).status, 401)
  assert.equal((await s.req('POST', '/api/auth/apple', { identityToken: s.appleToken({ sub: 'x' }).slice(0, -4) + 'AAAA' })).status, 401)
})

test('family and shelf are private to each account', async () => {
  const s = setup()
  const a = await s.login('a@example.com'), b = await s.login('b@example.com')
  assert.equal((await s.req('PUT', '/api/members/m_me12345', { name: 'Me', birth_year: 1990, is_self: true }, a)).status, 200)
  assert.equal((await s.req('PUT', '/api/shelf/p_cleanser1', { name: 'Cleanser', raw: 'Aqua, Glycerin', used_by: ['m_me12345', 'm_other'] }, a)).status, 200)
  const shelf = await (await s.req('GET', '/api/shelf', undefined, a)).json()
  assert.deepEqual(shelf[0].used_by, ['m_me12345'])
  assert.deepEqual(await (await s.req('GET', '/api/members', undefined, b)).json(), [])
  assert.equal((await s.req('PUT', '/api/members/m_me12345', { name: 'Hijack' }, b)).status, 400) // id taken by another account
  await s.req('DELETE', '/api/members/m_me12345', undefined, a)
  assert.deepEqual((await (await s.req('GET', '/api/shelf', undefined, a)).json())[0].used_by, [])
})

test('skin test: report saved, gated by subscription when the paywall is on, never for under-13s', async () => {
  const s = setup()
  const t = await s.login('me@example.com')
  await s.req('PUT', '/api/members/m_me12345', { name: 'Me', birth_year: 1995, is_self: true }, t)
  await s.req('PUT', '/api/members/m_kid1234', { name: 'Kid', birth_year: YEAR - 10 }, t)
  const kid = await s.req('POST', '/api/skin/analyze', { member_id: 'm_kid1234', image: 'AAAA' }, t)
  assert.equal(kid.status, 400)
  assert.equal((await kid.json()).code, 'under13')

  const r = await (await s.req('POST', '/api/skin/analyze', { member_id: 'm_me12345', image: 'AAAA', lang: 'zh-Hans',
    conditions: { makeup: 'light', light: 'indoor' }, answers: { after_wash: 'tzone', bogus: 'x' } }, t)).json()
  assert.equal(r.locked, false) // paywall off by default
  assert.equal(r.report.dimensions.acne.score, 64) // clamped into the "moderate" range
  assert.deepEqual(r.report.priorities, ['acne'])
  const sys = s.calls[0].messages[0].content as string
  assert.match(sys, /Simplified Chinese/)
  assert.match(s.calls[0].messages[1].content[1].text, /Shiny on the forehead and nose/)
  assert.match(s.calls[0].messages[1].content[1].text, /makeup light, light indoor/)
  assert.equal(s.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM ocr_logs WHERE kind = 'skin'")!.n, 1)

  s.db.saveSettings({ ...s.db.settings(), paywallEnabled: true })
  const locked = await (await s.req('GET', `/api/skin/reports/${r.id}`, undefined, t)).json()
  assert.equal(locked.locked, true)
  assert.equal(locked.report, null)
  s.db.run('UPDATE users SET pro_until = ?', Date.now() + 86400_000)
  assert.equal((await (await s.req('GET', `/api/skin/reports/${r.id}`, undefined, t)).json()).report.skin_age, 31)
})

test('skin test: no face is a clear error, not a report', async () => {
  const s = setup({ reply: () => skinReply({ face_found: false, problem: 'Too dark.' }) })
  const t = await s.login('me@example.com')
  await s.req('PUT', '/api/members/m_me12345', { name: 'Me', birth_year: 1995 }, t)
  const res = await s.req('POST', '/api/skin/analyze', { member_id: 'm_me12345', image: 'AAAA' }, t)
  assert.equal(res.status, 422)
  assert.equal((await res.json()).error, 'Too dark.')
  assert.equal(s.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM skin_reports')!.n, 0)
})

test('advice: only owned product ids, cached until inputs change, needs Pro when the paywall is on', async () => {
  const s = setup()
  const t = await s.login('me@example.com')
  await s.req('PUT', '/api/members/m_me12345', { name: 'Me', birth_year: 1995 }, t)
  assert.equal((await s.req('POST', '/api/advice', { member_id: 'm_me12345' }, t)).status, 400) // no products yet
  await s.req('PUT', '/api/shelf/p_cleanser1', { name: 'Cleanser', raw: 'Aqua, Glycerin', used_by: ['m_me12345'] }, t)
  const a = await (await s.req('POST', '/api/advice', { member_id: 'm_me12345' }, t)).json()
  assert.deepEqual(a.am.map((x: any) => x.id), ['p_cleanser1'])
  await s.req('POST', '/api/advice', { member_id: 'm_me12345' }, t)
  assert.equal(s.calls.length, 1) // second call served from cache
  s.db.saveSettings({ ...s.db.settings(), paywallEnabled: true })
  assert.equal((await s.req('POST', '/api/advice', { member_id: 'm_me12345' }, t)).status, 402)
})

test('account deletion removes everything', async () => {
  const s = setup()
  const t = await s.login('bye@example.com')
  await s.req('PUT', '/api/members/m_me12345', { name: 'Me', birth_year: 1995 }, t)
  await s.req('POST', '/api/skin/analyze', { member_id: 'm_me12345', image: 'AAAA' }, t)
  assert.equal((await s.req('DELETE', '/api/me', undefined, t)).status, 200)
  for (const table of ['users', 'members', 'skin_reports', 'sessions']) assert.equal(s.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)!.n, 0, table)
})

test('report cleaning and derived concerns', () => {
  const r = cleanReport({ dimensions: { sensitivity: { level: 'marked', score: 99 } }, skin_type: 'weird', skin_age: 200 })
  assert.equal(r.dimensions.sensitivity.score, 39)
  assert.equal(r.skin_type, 'normal')
  assert.equal(r.skin_age, null)
  assert.deepEqual(concernsFromReport(r), ['sensitive'])
})
