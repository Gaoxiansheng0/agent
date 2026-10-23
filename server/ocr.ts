// Label photo -> ingredient list via DeepSeek (plan 5.1/5.2). Receives only the product photo, never member data.
// The model only transcribes; every safety verdict is made on the phone by engine/engine.ts (plan 4.1).
export const MODEL = process.env.DEEPSEEK_MODEL ?? 'deepseek-flash' // vision-capable Flash model
const BASE_URL = (process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com').replace(/\/$/, '')
export const MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export type MediaType = (typeof MEDIA_TYPES)[number]

export type OcrResult = { found: boolean; product_name: string; ingredients: string[]; unreadable: boolean }

const SYSTEM = `You transcribe the ingredient list from photos of cosmetic and skincare product labels.

Copy each ingredient exactly as printed, in label order, one entry per ingredient. Keep the printed spelling, including parentheses such as "Aqua (Water)" and percentages. If the label has separate "Active Ingredients" and "Inactive Ingredients" sections (US OTC drug labels such as sunscreens), list the actives first, then the inactives, without the section headings or the "Purpose" column. Include ingredients printed after "May contain" or "+/-".

Do not translate, correct, complete, reorder or explain ingredients, and do not judge safety. If part of the list is cut off, blurred or covered, transcribe what you can read and set "unreadable" to true; never guess missing words.

Set "found" to false and return an empty list when the photo has no ingredient list. Fill "product_name" with the brand and product name if printed on the visible part of the label, otherwise an empty string.

Reply with JSON only, in exactly this shape:
{"found": true, "product_name": "Brand Product", "ingredients": ["Aqua (Water)", "Glycerin"], "unreadable": false}`

export class HttpError extends Error {
  status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}

/** Non-2xx reply from DeepSeek. */
export class UpstreamError extends Error {
  status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}

export type ChatResponse = {
  choices?: { finish_reason?: string; message?: { content?: string | null } }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}
export type ChatClient = { chat: (body: object) => Promise<ChatResponse> }

export function deepseekClient(apiKey = process.env.DEEPSEEK_API_KEY ?? ''): ChatClient {
  return {
    async chat(body) {
      if (!apiKey) throw new UpstreamError(401, 'DEEPSEEK_API_KEY is not configured')
      const res = await fetch(`${BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(90_000),
      })
      if (!res.ok) throw new UpstreamError(res.status, (await res.text()).slice(0, 300))
      return res.json() as Promise<ChatResponse>
    },
  }
}


export type Usage = { input: number; output: number }

/** Throws HttpError (with the usage spent so far) when the model answered but the answer is unusable. */
export async function extractIngredients(client: ChatClient, image: string, mediaType: MediaType): Promise<{ result: OcrResult; usage: Usage }> {
  const res = await client.chat({
    model: MODEL,
    max_tokens: 8000,
    temperature: 0,
    // Transcription only: thinking adds cost and latency without improving a copy task.
    thinking: { type: 'disabled' },
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${mediaType};base64,${image}` } },
          { type: 'text', text: 'Transcribe the ingredient list on this label.' },
        ],
      },
    ],
  })
  const usage = { input: res.usage?.prompt_tokens ?? 0, output: res.usage?.completion_tokens ?? 0 }
  const fail = (status: number, message: string) => Object.assign(new HttpError(status, message), { usage })
  const choice = res.choices?.[0]
  if (choice?.finish_reason === 'content_filter') throw fail(422, "We couldn't read this photo. Try another one or type the ingredients.")
  if (choice?.finish_reason === 'length') throw fail(502, 'The ingredient list was too long to read. Try a closer photo.')
  let out: OcrResult
  try { out = JSON.parse(choice?.message?.content ?? '') } catch { throw fail(502, 'Unexpected response from the reader.') }
  if (typeof out.found !== 'boolean' || !Array.isArray(out.ingredients) || !out.ingredients.every(i => typeof i === 'string'))
    throw fail(502, 'Unexpected response from the reader.')
  return {
    result: { found: out.found, product_name: String(out.product_name ?? ''), ingredients: out.ingredients.map(i => i.trim()).filter(Boolean), unreadable: !!out.unreadable },
    usage,
  }
}
