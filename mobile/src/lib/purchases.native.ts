// App Store / Google Play subscriptions through RevenueCat (plan 7.1). RevenueCat validates receipts,
// handles renewals, refunds and Family Sharing, and its dashboard is where revenue and churn live.
// In Expo Go the SDK runs in "Preview API mode" (no real purchases); a development build is needed for sandbox tests.
import { Linking, Platform } from 'react-native'
import Purchases, { PACKAGE_TYPE, type CustomerInfo, type PurchasesPackage } from 'react-native-purchases'
import type { Plan } from './purchases'

export type { Plan }
export const ENTITLEMENT = 'pro'

const API_KEY = Platform.OS === 'ios' ? process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY : process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY
export const storeAvailable = !!API_KEY

let packages: PurchasesPackage[] = []
const isPro = (info: CustomerInfo) => info.entitlements.active[ENTITLEMENT] !== undefined

/** Configures RevenueCat with our anonymous install id and reports Pro status now and on every change. */
export async function initPurchases(appUserId: string, onChange: (isPro: boolean) => void): Promise<boolean> {
  if (!API_KEY) return false
  if (!(await Purchases.isConfigured())) {
    Purchases.configure({ apiKey: API_KEY, appUserID: appUserId })
    Purchases.addCustomerInfoUpdateListener(info => onChange(isPro(info)))
  }
  return isPro(await Purchases.getCustomerInfo())
}

function trialOf(p: PurchasesPackage): Plan['trial'] {
  const intro = p.product.introPrice
  if (!intro || intro.price !== 0) return null
  const unit = intro.periodUnit.toLowerCase().replace(/s$/, '')
  return unit === 'day' || unit === 'week' || unit === 'month' ? { n: intro.periodNumberOfUnits, unit } : null
}

export async function getPlans(): Promise<Plan[]> {
  if (!API_KEY) return []
  const offerings = await Purchases.getOfferings()
  packages = offerings.current?.availablePackages ?? []
  // Annual first: it's the plan we lead with (plan 7.1).
  const order = (p: PurchasesPackage) => (p.packageType === PACKAGE_TYPE.ANNUAL ? 0 : p.packageType === PACKAGE_TYPE.MONTHLY ? 1 : 2)
  return [...packages].sort((a, b) => order(a) - order(b)).map(p => ({
    id: p.identifier,
    title: p.packageType === PACKAGE_TYPE.ANNUAL ? 'Yearly' : p.packageType === PACKAGE_TYPE.MONTHLY ? 'Monthly' : p.product.title,
    price: p.product.priceString,
    period: p.packageType === PACKAGE_TYPE.ANNUAL ? 'year' : p.packageType === PACKAGE_TYPE.MONTHLY ? 'month' : 'other',
    trial: trialOf(p),
  }))
}

export async function buyPlan(id: string): Promise<'success' | 'cancel'> {
  const pkg = packages.find(p => p.identifier === id)
  if (!pkg) throw Object.assign(new Error('plan-unavailable'), { code: 'plan-unavailable' })
  try {
    const { customerInfo } = await Purchases.purchasePackage(pkg)
    return isPro(customerInfo) ? 'success' : 'cancel'
  } catch (e) {
    if ((e as { userCancelled?: boolean }).userCancelled) return 'cancel'
    throw e
  }
}

export async function restorePurchases(): Promise<boolean> {
  if (!API_KEY) return false
  return isPro(await Purchases.restorePurchases())
}

/** App Store offer codes: how founding members get their prepaid year (plan 7.1 presale). */
export async function redeemCode() {
  if (Platform.OS === 'ios' && API_KEY) await Purchases.presentCodeRedemptionSheet()
}

export async function manageSubscription() {
  await Linking.openURL(Platform.OS === 'ios' ? 'https://apps.apple.com/account/subscriptions' : 'https://play.google.com/store/account/subscriptions')
}
