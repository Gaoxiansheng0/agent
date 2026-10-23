import { LinearGradient } from 'expo-linear-gradient'
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { getMe, SITE_URL, track } from '../lib/api'
import { useI18n, type Key } from '../lib/i18n'
import { buyPlan, getPlans, redeemCode, restorePurchases, storeAvailable, type Plan } from '../lib/purchases'
import { useStore } from '../lib/store'
import { AiBadge, Button, C, PEARL, s } from '../lib/ui'

const BENEFITS: [string, Key][] = [['◎', 'pw.b1'], ['↗', 'pw.b2'], ['♡', 'pw.b3'], ['✦', 'pw.b4']]

export default function Paywall() {
  const { report, trigger = 'direct' } = useLocalSearchParams<{ report?: string; trigger?: string }>()
  const { pro, setPro, config, refresh } = useStore()
  const { t } = useI18n()
  const insets = useSafeAreaInsets()
  const [plans, setPlans] = useState<Plan[] | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    track('paywall_view', { trigger })
    if (!storeAvailable) return setPlans([])
    getPlans()
      .then(p => { setPlans(p); setPicked(p[0]?.id ?? null) })
      .catch(() => { setPlans([]); setError(t('pw.loadFailed')) })
  }, [trigger])

  const leave = () => (report ? router.replace(`/report/${report}`) : router.canGoBack() ? router.back() : router.replace('/'))
  const unlocked = async () => {
    setPro(true)
    await getMe(true).catch(() => {}) // tells the server to re-check the subscription now
    await refresh().catch(() => {})
    leave()
  }
  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try { await fn() } catch (e) {
      setError(t((e as { code?: string }).code === 'plan-unavailable' ? 'pw.unavailable' : 'err.generic'))
    } finally { setBusy(false) }
  }
  const buy = () => run(async () => {
    if (!picked) return
    track('purchase', { result: 'started', plan: picked, trigger })
    try {
      const r = await buyPlan(picked)
      track('purchase', { result: r, plan: picked, trigger })
      if (r === 'success') await unlocked()
    } catch (e) {
      track('purchase', { result: 'error', plan: picked, trigger })
      throw e
    }
  })
  const restore = () => run(async () => {
    if (await restorePurchases()) { track('purchase', { result: 'restored' }); await unlocked() } else setError(t('pw.noSub'))
  })

  if (pro) return (
    <View style={[s.screen, s.pad, { paddingTop: insets.top + 48 }]}>
      <Text style={s.h1}>{t('pw.haveIt')}</Text>
      <Text style={s.body}>{t('pw.haveItBody')}</Text>
      <Button title={t('common.done')} onPress={leave} />
    </View>
  )

  const periodLabel = (p: Plan) => t(p.period === 'year' ? 'pw.year' : p.period === 'month' ? 'pw.month' : 'pw.period')
  const trialLabel = (p: Plan) => (p.trial ? t(`pw.trial.${p.trial.unit}`, { n: p.trial.n }) : '')
  const plan = plans?.find(p => p.id === picked)
  const account = t(Platform.OS === 'ios' ? 'pw.account.ios' : 'pw.account.other')

  return (
    <ScrollView style={s.screen} contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}>
      <View style={{ paddingTop: insets.top + 36, paddingHorizontal: 24, paddingBottom: 28, gap: 12 }}>
        <LinearGradient colors={PEARL} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        <Pressable onPress={leave} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('pw.notNow')} style={{ alignSelf: 'flex-end' }}>
          <Text style={{ fontSize: 26, color: C.ink }}>×</Text>
        </Pressable>
        <AiBadge label="PRO" />
        <Text style={s.hero}>{t('pw.title')}</Text>
        <Text style={s.body}>{t('pw.sub')}</Text>
      </View>

      <View style={{ paddingHorizontal: 24, gap: 14, marginTop: 20 }}>
        {BENEFITS.map(([icon, k]) => (
          <View key={k} style={[s.row, { flexWrap: 'nowrap', gap: 14 }]}>
            <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' }}><Text>{icon}</Text></View>
            <Text style={[s.body, { flex: 1, fontWeight: '500' }]}>{t(k)}</Text>
          </View>
        ))}

        {!storeAvailable ? (
          <View style={[s.card, { marginTop: 8 }]}>
            <Text style={s.body}>{t('pw.webOnly')}</Text>
            {config.appStoreUrl ? <Button title={t('pw.getApp')} onPress={() => Linking.openURL(config.appStoreUrl!)} /> : <Text style={s.small}>{t('pw.soon')}</Text>}
          </View>
        ) : plans === null ? <ActivityIndicator style={{ marginTop: 20 }} /> : (
          <View style={{ gap: 12, marginTop: 8 }}>
            {plans.map(p => (
              <Pressable key={p.id} onPress={() => setPicked(p.id)} accessibilityRole="radio" accessibilityState={{ selected: picked === p.id }}
                style={[s.card, { borderWidth: 2, borderColor: picked === p.id ? C.ink : 'transparent' }]}>
                <View style={[s.row, { justifyContent: 'space-between' }]}>
                  <View style={[s.row, { gap: 8 }]}>
                    <Text style={[s.body, { fontWeight: '700' }]}>{p.period === 'year' ? t('pw.yearly') : p.period === 'month' ? t('pw.monthly') : p.title}</Text>
                    {p.period === 'year' && <View style={{ backgroundColor: C.ink, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}><Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>{t('pw.best')}</Text></View>}
                  </View>
                  <Text style={[s.body, { fontWeight: '700' }]}>{t('pw.priceper', { price: p.price, period: periodLabel(p) })}</Text>
                </View>
                {p.trial ? <Text style={s.small}>{t('pw.trialThen', { trial: trialLabel(p), price: p.price, period: periodLabel(p) })}</Text> : null}
              </Pressable>
            ))}
            {plans.length > 0 && <Button title={plan?.trial ? t('pw.start') : t('pw.subscribe')} onPress={buy} busy={busy} />}
          </View>
        )}

        {error ? <Text style={[s.body, { color: C.danger }]}>{error}</Text> : null}
        {storeAvailable && (
          <View style={[s.row, { justifyContent: 'center', gap: 20 }]}>
            <Text style={[s.small, { color: C.ink }]} onPress={restore}>{t('pw.restore')}</Text>
            {Platform.OS === 'ios' && <Text style={[s.small, { color: C.ink }]} onPress={() => run(redeemCode)}>{t('pw.redeem')}</Text>}
          </View>
        )}
        {/* App Store guideline 3.1.2: price, renewal terms and links next to the buy button. */}
        {storeAvailable && (
          <Text style={[s.small, { fontSize: 11, color: C.faint }]}>
            {plan?.trial ? t('pw.legalTrial', { price: plan.price, period: periodLabel(plan), account }) : ''}{t('pw.legal', { account })}
          </Text>
        )}
        <Text style={[s.small, { fontSize: 12, color: C.sub }]}>{t('pw.cancelHow')}</Text>
        <View style={[s.row, { justifyContent: 'center', gap: 20 }]}>
          <Text style={[s.small, { color: C.faint }]} onPress={() => Linking.openURL(`${SITE_URL}/terms`)}>{t('pw.terms')}</Text>
          <Text style={[s.small, { color: C.faint }]} onPress={() => Linking.openURL(`${SITE_URL}/privacy`)}>{t('pw.privacy')}</Text>
        </View>
        <Button kind="ghost" title={t('pw.notNow')} onPress={leave} />
      </View>
    </ScrollView>
  )
}
