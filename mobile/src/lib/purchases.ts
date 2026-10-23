// Web build: App Store subscriptions can't be bought in a browser, so the web app has no store.
// The native implementation lives in purchases.native.ts (Metro picks it on iOS/Android).

export type Plan = { id: string; title: string; price: string; period: 'year' | 'month' | 'other'; trial: { n: number; unit: 'day' | 'week' | 'month' } | null }

export const ENTITLEMENT = 'pro'
export const storeAvailable = false

export async function initPurchases(_appUserId: string, _onChange: (isPro: boolean) => void): Promise<boolean> { return false }
export async function getPlans(): Promise<Plan[]> { return [] }
export async function buyPlan(_id: string): Promise<'success' | 'cancel'> { throw Object.assign(new Error('plan-unavailable'), { code: 'plan-unavailable' }) }
export async function restorePurchases(): Promise<boolean> { return false }
export async function redeemCode(): Promise<void> {}
export async function manageSubscription(): Promise<void> {}
