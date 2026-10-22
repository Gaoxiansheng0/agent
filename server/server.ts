// Family Shelf OCR proxy (plan 5.1/5.2): label photo in, ingredient list out.
// Receives only the product photo - never member data - and stores nothing.
// The model only transcribes; every safety verdict is made on the phone by engine/engine.ts (plan 4.1).
import Anthropic from '@anthropic-ai/sdk'
import { timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'

export const MODEL = 'claude-opus-5-5'
const MAX_BODY_BYTES = 8 * 1024 * 1024 // app sends ~1 MB JPEGs; Anthropic caps base64 images at 5 MB
const RATE_LIMIT = { max: 30, windowMs: 60 * 60 * 1000 } // per IP
const MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
type MediaType = (typeof MEDIA_TYPES)[number]

export type OcrResult = { found: boolean; product_name: string; ingredients: string[]; unreadable: boolean }

const SYSTEM = `You transcribe the ingredient list from photos of cosmetic and skincare product labels.

Copy each ingredient exactly as printed, in label order, one entry per ingredient. Keep the printed spelling, including parentheses such as "Aqua (Water)" and percentages. If the label has separate "Active Ingredients" and "Inactive Ingredients" sections (US OTC drug labels such as sunscreens), list the actives first, then the inactives, without the section headings or the "Purpose" column. Include ingredients printed after "May contain" or "+/-".

Do not translate, correct, complete, reorder or explain ingredients, and do not judge safety. If part of the list is cut off, blurred or covered, transcribe what you can read and set "unreadable" to true; never guess missing words.

Set "found" to false and return an empty list when the photo has no ingredient list. Fill "product_name" with the brand and product name if printed on the visible part of the label, otherwise an empty string.`

const SCHEMA = {
  type: 'object',
  properties: {
    found: { type: 'boolean' },
    product_name: { type: 'string' },
    ingredients: { type: 'array', items: { type: 'string' } },
    unreadable: { type: 'boolean' },
  },
  required: ['found', 'product_name', 'ingredients', 'unreadable'],
  additionalProperties: false,
}

export class HttpError extends Error {
  status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}

export async function extractIngredients(client: Pick<Anthropic, 'beta'>, image: string, mediaType: MediaType): Promise<OcrResult> {
  const res = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    // ponytail: effort fixed at medium; tune with the 100-label accuracy test (plan 9, phase 1).
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    system: SYSTEM,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
        { type: 'text', text: 'Transcribe the ingredient list on this label.' },
      ],
    }],
  })
  if (res.stop_reason === 'refusal') throw new HttpError(422, "We couldn't read this photo. Try another one or type the ingredients.")
  if (res.stop_reason === 'max_tokens') throw new HttpError(502, 'The ingredient list was too long to read. Try a closer photo.')
  const text = res.content.find(b => b.type === 'text')
  let out: OcrResult
  try { out = JSON.parse(text?.type === 'text' ? text.text : '') } catch { throw new HttpError(502, 'Unexpected response from the reader.') }
  if (typeof out.found !== 'boolean' || !Array.isArray(out.ingredients) || !out.ingredients.every(i => typeof i === 'string'))
    throw new HttpError(502, 'Unexpected response from the reader.')
  return { found: out.found, product_name: String(out.product_name ?? ''), ingredients: out.ingredients.map(i => i.trim()).filter(Boolean), unreadable: !!out.unreadable }
}

// ponytail: in-memory per-IP window, single process, resets on restart; move to Redis or the paywall's
// entitlement check (RevenueCat) once scans are tied to subscriptions (plan 7.1).
function rateLimiter(now: () => number) {
  const hits = new Map<string, number[]>()
  return (ip: string) => {
    const t = now()
    const recent = (hits.get(ip) ?? []).filter(x => t - x < RATE_LIMIT.windowMs)
    if (recent.length >= RATE_LIMIT.max) return false
    recent.push(t)
    hits.set(ip, recent)
    return true
  }
}

async function readJson(req: IncomingMessage) {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'Photo is too large.')
    chunks.push(chunk)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new HttpError(400, 'Body must be JSON.') }
}

const send = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

// Behind Caddy the client IP is in X-Forwarded-For; only trust it from a local proxy.
const clientIp = (req: IncomingMessage) => {
  const remote = req.socket.remoteAddress ?? ''
  const local = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1'
  const fwd = req.headers['x-forwarded-for']
  return local && typeof fwd === 'string' ? fwd.split(',')[0].trim() : remote
}

const tokenOk = (got: unknown, want: string) =>
  typeof got === 'string' && got.length === want.length && timingSafeEqual(Buffer.from(got), Buffer.from(want))

export function createApp(opts: { client: Pick<Anthropic, 'beta'>; appToken?: string; now?: () => number }) {
  const allow = rateLimiter(opts.now ?? Date.now)
  return createServer(async (req, res) => {
    res.setHeader('access-control-allow-origin', '*') // app requests carry no cookies; the token gates access
    res.setHeader('access-control-allow-headers', 'content-type, x-app-token')
    try {
      if (req.method === 'OPTIONS') return res.writeHead(204).end()
      if (req.method === 'GET' && req.url === '/api/health') return send(res, 200, { ok: true, model: MODEL })
      if (req.method !== 'POST' || req.url !== '/api/ocr') return send(res, 404, { error: 'Not found' })
      if (opts.appToken && !tokenOk(req.headers['x-app-token'], opts.appToken)) return send(res, 401, { error: 'Unauthorized' })
      if (!allow(clientIp(req))) return send(res, 429, { error: 'Too many photos in a short time. Try again later.' })

      const body = await readJson(req)
      const mediaType = body?.media_type ?? 'image/jpeg'
      const image = typeof body?.image === 'string' ? body.image.replace(/^data:[^,]*,/, '') : ''
      if (!MEDIA_TYPES.includes(mediaType) || !image || !/^[A-Za-z0-9+/]+=*$/.test(image))
        throw new HttpError(400, 'Send a base64 JPEG, PNG or WebP image.')
      send(res, 200, await extractIngredients(opts.client, image, mediaType))
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.message })
      if (e instanceof Anthropic.RateLimitError || e instanceof Anthropic.InternalServerError)
        return send(res, 503, { error: 'The reader is busy. Try again in a minute.' })
      if (e instanceof Anthropic.APIError) {
        console.error('anthropic', e.status, e.message)
        return send(res, 502, { error: 'The reader is unavailable right now.' })
      }
      console.error(e)
      send(res, 500, { error: 'Something went wrong.' })
    }
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 3001)
  const host = process.env.HOST ?? '127.0.0.1' // HOST=0.0.0.0 to reach it from a phone on the same WiFi
  if (!process.env.APP_TOKEN) console.warn('APP_TOKEN not set: anyone who finds this URL can spend your API credit.')
  createApp({ client: new Anthropic(), appToken: process.env.APP_TOKEN }).listen(port, host, () =>
    console.log(`Family Shelf OCR proxy on http://${host}:${port} (${MODEL})`))
}
