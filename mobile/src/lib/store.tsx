// App state: the signed-in account, its family, shelf and skin reports. The server is the source of truth;
// a snapshot is cached on the device so the app opens instantly and works offline for reading.
import AsyncStorage from '@react-native-async-storage/async-storage'
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { compareVersions, validatePack, type Member as EngineMember, type Pack } from '../../../engine/engine'
import packJson from '../../../engine/rule-pack.json'
import * as api from './api'
import { getInstallId, track, type Me, type MemberDto, type ProductDto, type Question, type RemoteConfig, type ReportSummary } from './api'
import { initPurchases } from './purchases'
import { loadToken, saveToken } from './token'

const bundledPack = packJson as Pack

export type Member = MemberDto
export type Product = ProductDto

const DEFAULT_CONFIG: RemoteConfig = {
  paywallEnabled: false, free: { scansPerMonth: 5, members: 2, showReasons: false, routine: false }, contactEmail: 'hello@pearlwren.com', rulePackVersion: bundledPack.version,
}

type Cache = { me: Me | null; members: Member[]; products: Product[]; reports: ReportSummary[]; questions: Question[]; config: RemoteConfig }
type Store = Cache & {
  status: 'loading' | 'signedOut' | 'ready'
  pack: Pack
  pro: boolean
  signIn: (token: string, me: Me) => Promise<void>
  signOut: () => Promise<void>
  deleteAccount: () => Promise<void>
  refresh: () => Promise<void>
  saveMember: (m: Member) => Promise<void>
  deleteMember: (id: string) => Promise<void>
  saveProduct: (p: Omit<Product, 'added_at'>) => Promise<void>
  deleteProduct: (id: string) => Promise<void>
  addReport: (r: ReportSummary) => void
  setPro: (v: boolean) => void
}

const CACHE_KEY = 'pearlkin:cache'
const PACK_KEY = 'pearlkin:rule-pack'
const EMPTY: Cache = { me: null, members: [], products: [], reports: [], questions: [], config: DEFAULT_CONFIG }
const Ctx = createContext<Store | null>(null)

export const newId = (prefix = 'x') => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

export function useStore() {
  const s = useContext(Ctx)
  if (!s) throw new Error('useStore outside StoreProvider')
  return s
}

/** Age in years from a birth year (birth year only: can be off by one, fine for age bands). */
export const ageOf = (m: Pick<Member, 'birth_year'>) => (m.birth_year ? new Date().getFullYear() - m.birth_year : null)
export const canSkinTest = (m: Member) => { const a = ageOf(m); return a !== null && a >= 13 } // the server refuses people without a birth year

/** The person as the rule engine sees them: entered concerns plus what their latest skin test showed. */
export function engineMember(m: Member, latest?: ReportSummary): EngineMember {
  const concerns = new Set(m.concerns)
  if (latest?.scores) {
    if (latest.scores.sensitivity < 65) concerns.add('sensitive')
    if (latest.scores.acne < 65 || latest.scores.blackheads < 55) concerns.add('acne_prone')
  }
  return { id: m.id, nickname: m.name, birthYear: m.birth_year ?? undefined, lifeStage: (m.life_stage || undefined) as EngineMember['lifeStage'], concerns: [...concerns] }
}

export const latestFor = (reports: ReportSummary[], memberId: string) => reports.find(r => r.member_id === memberId)

function usablePack(p: unknown): Pack | null {
  const pack = p as Pack
  return pack && typeof pack.version === 'string' && compareVersions(pack.version, bundledPack.version) > 0 && !validatePack(pack).length ? pack : null
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Store['status']>('loading')
  const [data, setData] = useState<Cache>(EMPTY)
  const [pack, setPack] = useState<Pack>(bundledPack)
  const [pro, setProState] = useState(false)
  const dataRef = useRef(data)
  dataRef.current = data

  const patch = (p: Partial<Cache>) => setData(d => {
    const next = { ...d, ...p }
    AsyncStorage.setItem(CACHE_KEY, JSON.stringify(next)).catch(() => {})
    return next
  })

  const signedOut = async () => {
    api.setAuth(null)
    await saveToken(null)
    await AsyncStorage.removeItem(CACHE_KEY).catch(() => {})
    setData(d => ({ ...EMPTY, questions: d.questions, config: d.config }))
    setProState(false)
    setStatus('signedOut')
  }

  async function refresh() {
    const [me, members, products, reports, questions] = await Promise.all([api.getMe(), api.listMembers(), api.listShelf(), api.listReports(), api.getQuestions()])
    patch({ me, members, products, reports, questions })
    setProState(me.pro)
  }

  useEffect(() => {
    track('app_open')
    api.getConfig().then(c => patch({ config: { ...DEFAULT_CONFIG, ...c } })).catch(() => {})
    api.getQuestions().then(q => patch({ questions: q })).catch(() => {})
    api.getRulePack().then(r => {
      const p = usablePack(r.pack)
      if (!p) return
      setPack(cur => (compareVersions(p.version, cur.version) > 0 ? p : cur))
      AsyncStorage.setItem(PACK_KEY, JSON.stringify(p)).catch(() => {})
    }).catch(() => {})

    ;(async () => {
      const [[, cached], [, cachedPack]] = await AsyncStorage.multiGet([CACHE_KEY, PACK_KEY]).catch(() => [[CACHE_KEY, null], [PACK_KEY, null]] as [string, string | null][])
      try { const p = usablePack(JSON.parse(cachedPack ?? 'null')); if (p) setPack(p) } catch { /* ignore */ }
      const token = await loadToken()
      if (!token) return setStatus('signedOut')
      api.setAuth(token, () => void signedOut())
      try { const c = JSON.parse(cached ?? 'null') as Cache | null; if (c?.me) { setData({ ...EMPTY, ...c }); setProState(c.me.pro) } } catch { /* ignore */ }
      setStatus('ready')
      refresh().catch(() => { /* offline: keep the cached snapshot */ })
    })()
  }, [])

  // RevenueCat identifies the buyer by our account id, so the server can check the same subscription.
  useEffect(() => {
    const id = data.me?.user.id
    if (!id) return
    initPurchases(id, v => { if (v) setProState(true) }).then(v => { if (v) setProState(true) }).catch(() => {})
  }, [data.me?.user.id])

  const store: Store = {
    ...data, status, pack, pro,
    async signIn(token, me) {
      await saveToken(token)
      api.setAuth(token, () => void signedOut())
      patch({ me })
      setProState(me.pro)
      setStatus('ready')
      track('signed_in')
      await refresh().catch(() => {})
    },
    async signOut() { await api.signOutRemote().catch(() => {}); await signedOut() },
    async deleteAccount() { await api.deleteAccount(); await signedOut() },
    refresh,
    async saveMember(m) {
      const members = dataRef.current.members
      patch({ members: members.some(x => x.id === m.id) ? members.map(x => (x.id === m.id ? m : x)) : [...members, m] })
      await api.putMember(m)
    },
    async deleteMember(id) {
      const d = dataRef.current
      patch({
        members: d.members.filter(m => m.id !== id), reports: d.reports.filter(r => r.member_id !== id),
        products: d.products.map(p => ({ ...p, used_by: p.used_by.filter(x => x !== id) })),
      })
      await api.removeMember(id)
    },
    async saveProduct(p) {
      const products = dataRef.current.products
      const existing = products.find(x => x.id === p.id)
      const full = { ...p, added_at: existing?.added_at ?? Date.now() }
      patch({ products: existing ? products.map(x => (x.id === p.id ? full : x)) : [full, ...products] })
      await api.putProduct(p)
    },
    async deleteProduct(id) {
      patch({ products: dataRef.current.products.filter(p => p.id !== id) })
      await api.removeProduct(id)
    },
    addReport: r => patch({ reports: [r, ...dataRef.current.reports.filter(x => x.id !== r.id)] }),
    setPro: v => setProState(v),
  }

  if (status === 'loading') return null
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>
}

export { getInstallId }
