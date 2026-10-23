// Everything the app sends to our server. Signed-in calls carry a bearer token; face photos are sent for analysis
// and never stored. Anonymous usage events use a random install id, not the account.
import AsyncStorage from '@react-native-async-storage/async-storage'
import Constants from 'expo-constants'
import { AppState, Platform } from 'react-native'

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3001'
export const SITE_URL = process.env.EXPO_PUBLIC_SITE_URL ?? 'https://pearlkin.pearlwren.com'
// Ships inside the app bundle, so it only stops casual abuse; the real gate is the subscription.
const APP_TOKEN = process.env.EXPO_PUBLIC_APP_TOKEN ?? ''
export const APP_VERSION = Constants.expoConfig?.version ?? '0.0.0'

const INSTALL_KEY = 'family-shelf:install-id'
let installId = ''

/** Random per-install id: lets us count devices and weekly use without knowing who anyone is. */
export async function getInstallId() {
  if (installId) return installId
  installId = (await AsyncStorage.getItem(INSTALL_KEY)) ?? ''
  if (!installId) {
    installId = Array.from({ length: 4 }, () => Math.random().toString(36).slice(2, 8)).join('-')
    await AsyncStorage.setItem(INSTALL_KEY, installId)
  }
  return installId
}

let authToken: string | null = null
let onSignedOut: () => void = () => {}
export const setAuth = (token: string | null, signedOut?: () => void) => { authToken = token; if (signedOut) onSignedOut = signedOut }

export type ApiError = Error & { status?: number; code?: string }

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-app-token': APP_TOKEN, ...(authToken ? { authorization: `Bearer ${authToken}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw Object.assign(new Error('offline'), { status: 0, code: 'offline' }) as ApiError
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    if (res.status === 401 && data.code === 'signin') onSignedOut()
    throw Object.assign(new Error(data.error ?? 'Something went wrong.'), { status: res.status, code: data.code }) as ApiError
  }
  return data as T
}

// ---------- usage events: queued, sent in batches, dropped quietly when offline ----------

type Props = Record<string, string | number | boolean>
let queue: { name: string; ts: number; props?: Props }[] = []
let timer: ReturnType<typeof setTimeout> | null = null

export function track(name: string, props?: Props) {
  queue.push({ name, ts: Date.now(), props })
  if (queue.length >= 20) void flush()
  else if (!timer) timer = setTimeout(flush, 5000)
}

export async function flush() {
  if (timer) { clearTimeout(timer); timer = null }
  if (!queue.length) return
  const events = queue.splice(0, 50)
  try {
    await call('POST', '/api/events', { source: 'app', install_id: await getInstallId(), platform: Platform.OS, app_version: APP_VERSION, events })
  } catch {
    // Analytics must never get in the way of using the app.
  }
}

AppState.addEventListener('change', s => { if (s !== 'active') void flush() })

// ---------- remote config and rule pack ----------

// ---------- account ----------

export type Me = { user: { id: string; email: string | null; created_at: number }; pro: boolean }
export const emailStart = (email: string) => call('POST', '/api/auth/email/start', { email })
export const emailVerify = (email: string, code: string) => call<Me & { token: string }>('POST', '/api/auth/email/verify', { email, code })
export const appleSignIn = (identityToken: string) => call<Me & { token: string }>('POST', '/api/auth/apple', { identityToken })
/** fresh: ask the server to re-check the subscription with RevenueCat now (right after a purchase). */
export const getMe = (fresh = false) => call<Me>('GET', `/api/me${fresh ? '?fresh=1' : ''}`)
export const signOutRemote = () => call('POST', '/api/auth/logout')
export const deleteAccount = () => call('DELETE', '/api/me')

// ---------- family, shelf, skin ----------

export type MemberDto = { id: string; name: string; birth_year: number | null; life_stage: string; concerns: string[]; is_self: boolean }
export type ProductDto = { id: string; name: string; brand: string; barcode: string; raw: string; used_by: string[]; added_at: number }
export const listMembers = () => call<MemberDto[]>('GET', '/api/members')
export const putMember = (m: MemberDto) => call('PUT', `/api/members/${m.id}`, m)
export const removeMember = (id: string) => call('DELETE', `/api/members/${id}`)
export const listShelf = () => call<ProductDto[]>('GET', '/api/shelf')
export const putProduct = (p: Omit<ProductDto, 'added_at'>) => call('PUT', `/api/shelf/${p.id}`, p)
export const removeProduct = (id: string) => call('DELETE', `/api/shelf/${id}`)

export type Localized = { en: string; 'zh-Hans'?: string; 'zh-Hant'?: string; es?: string }
export type Question = { id: string; type: 'single' | 'multi'; title: Localized; options: { id: string; label: Localized }[] }
export const getQuestions = () => call<Question[]>('GET', '/api/questions')

export const DIMENSIONS = ['dark_circles', 'sensitivity', 'acne', 'pigmentation', 'wrinkles', 'blackheads', 'oiliness', 'eye_bags', 'pores'] as const
export type Dimension = (typeof DIMENSIONS)[number]
export type SkinReport = {
  skin_type: 'dry' | 'normal' | 'combination' | 'oily' | 'sensitive'; skin_age: number | null; overall: number; confidence: 'high' | 'medium' | 'low'
  summary: string; dimensions: Record<Dimension, { level: 'none' | 'mild' | 'moderate' | 'marked'; score: number; note: string }>
  priorities: Dimension[]; look_for: string[]; avoid: string[]; tips: string[]
}
export type ReportSummary = { id: string; member_id: string; ts: number; locked: boolean; overall: number | null; scores: Record<Dimension, number> | null }
export type ReportFull = { id: string; member_id: string; ts: number; locked: boolean; report: SkinReport | null; conditions?: { makeup: string; light: string } }
export type Conditions = { makeup: 'none' | 'light' | 'full'; light: 'daylight' | 'indoor' | 'dim' }
export const analyzeSkin = (b: { member_id: string; image: string; conditions: Conditions; answers: Record<string, string | string[]>; lang: string }) =>
  call<ReportFull>('POST', '/api/skin/analyze', b)
export const listReports = () => call<ReportSummary[]>('GET', '/api/skin/reports')
export const getReport = (id: string) => call<ReportFull>('GET', `/api/skin/reports/${id}`)

export type Advice = {
  summary: string; am: { id: string; why: string }[]; pm: { id: string; why: string }[]; pause: { id: string; why: string }[]
  conflicts: { ids: string[]; why: string }[]; gaps: { need: string; look_for: string[]; why: string }[]; ts: number
}
export const getAdvice = (member_id: string, lang: string) => call<Advice>('POST', '/api/advice', { member_id, lang })

export type RemoteConfig = {
  paywallEnabled: boolean
  free: { scansPerMonth: number; members: number; showReasons: boolean; routine: boolean }
  contactEmail: string
  appStoreUrl?: string
  rulePackVersion: string
}

export const getConfig = () => call<RemoteConfig>('GET', '/api/config')
export const getRulePack = () => call<{ version: string; pack: unknown }>('GET', '/api/rule-pack')

// ---------- products, reports, review queues ----------

export type LibraryProduct = { barcode: string; name: string; brand: string; raw: string }

/** Our own curated product library; null when the barcode isn't in it. */
export async function lookupOurProduct(barcode: string): Promise<LibraryProduct | null> {
  try {
    return await call<LibraryProduct>('GET', `/api/products/${encodeURIComponent(barcode)}`)
  } catch (e) {
    if ((e as { status?: number }).status === 404) return null
    throw e
  }
}

export async function submitProduct(p: { barcode: string; name: string; brand?: string; raw: string }) {
  try { await call('POST', '/api/submissions', { ...p, install_id: await getInstallId() }) } catch { /* best effort */ }
}

export async function sendUnknowns(tokens: string[]) {
  if (!tokens.length) return
  try { await call('POST', '/api/unknowns', { tokens: tokens.slice(0, 50), install_id: await getInstallId() }) } catch { /* best effort */ }
}

export type ReportKind = 'ingredients' | 'verdict' | 'product' | 'other'
export async function sendReport(r: {
  kind: ReportKind; message: string; contact: string; product_name: string; brand?: string; barcode?: string; raw: string; pack_version: string
}) {
  await call('POST', '/api/reports', { ...r, install_id: await getInstallId(), platform: Platform.OS, app_version: APP_VERSION })
}

export type LabelText = { found: boolean; product_name: string; ingredients: string[]; unreadable: boolean }
export const readLabelRemote = (base64: string) => call<LabelText>('POST', '/api/ocr', { image: base64, media_type: 'image/jpeg' })
