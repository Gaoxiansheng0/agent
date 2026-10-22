// All family data lives only on this device (plan 6: health flags never leave the phone).
// ponytail: AsyncStorage JSON blobs; move to expo-sqlite when the shelf needs queries or grows past a few hundred items.
import AsyncStorage from '@react-native-async-storage/async-storage'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { type Member, type Pack } from '../../../engine/engine'
import packJson from '../../../engine/rule-pack.json'

export const pack = packJson as Pack

export type Product = { id: string; name: string; brand?: string; barcode?: string; raw: string; usedBy: string[]; addedAt: number }
export type Routines = Record<string, { am: string[]; pm: string[] }> // memberId -> product ids
type Data = { members: Member[]; products: Product[]; routines: Routines }
type Store = Data & { update: (patch: Partial<Data>) => void }

const KEY = 'family-shelf:v1'
const Ctx = createContext<Store | null>(null)

export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

export function useStore() {
  const s = useContext(Ctx)
  if (!s) throw new Error('useStore outside StoreProvider')
  return s
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [data, setData] = useState<Data>({ members: [], products: [], routines: {} })

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then(v => v && setData(d => ({ ...d, ...JSON.parse(v) })))
      .finally(() => setReady(true))
  }, [])

  const update = (patch: Partial<Data>) => setData(d => {
    const next = { ...d, ...patch }
    AsyncStorage.setItem(KEY, JSON.stringify(next))
    return next
  })

  // Screens seed local state from the store on mount, so don't mount them before data has loaded.
  if (!ready) return null
  return <Ctx.Provider value={{ ...data, update }}>{children}</Ctx.Provider>
}
