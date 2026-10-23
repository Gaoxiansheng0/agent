// The skin test in progress, shared by the camera -> conditions -> questions -> analyzing screens.
// Lives in memory only: the photo is never written to the device's storage by us.
import type { Conditions } from './api'

export type SkinTest = {
  memberId: string
  image: string | null // base64 JPEG sent for analysis
  preview: string | null // local URI shown on screen
  conditions: Conditions
  answers: Record<string, string | string[]>
}

let current: SkinTest | null = null

export const skinTest = {
  start(memberId: string) {
    current = { memberId, image: null, preview: null, conditions: { makeup: 'none', light: 'daylight' }, answers: {} }
    return current
  },
  get: () => current,
  set(patch: Partial<SkinTest>) { if (current) current = { ...current, ...patch } },
  clear() { current = null },
}
