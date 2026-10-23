import * as Haptics from 'expo-haptics'
import { LinearGradient } from 'expo-linear-gradient'
import { Redirect, router } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { Animated, Easing, Image, Platform, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { analyzeSkin, DIMENSIONS, track, type ApiError } from '../../lib/api'
import { useI18n, type Key } from '../../lib/i18n'
import { skinTest } from '../../lib/skinTest'
import { useStore } from '../../lib/store'
import { AiBadge, Button, C, PEARL, s } from '../../lib/ui'

const STEPS: Key[] = ['test.step.face', 'test.step.texture', 'test.step.tone', 'test.step.oil', 'test.step.eyes', 'test.step.report']

// Step 4: the photo goes to the AI while a scan animation plays over it. The photo is dropped after this screen.
export default function Analyzing() {
  const { t, lang } = useI18n()
  const { addReport } = useStore()
  const insets = useSafeAreaInsets()
  const session = useRef(skinTest.get()).current
  const [step, setStep] = useState(0)
  const [error, setError] = useState('')
  const scan = useRef(new Animated.Value(0)).current
  const pulse = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (!session?.image) return
    Animated.loop(Animated.timing(scan, { toValue: 1, duration: 2200, easing: Easing.inOut(Easing.cubic), useNativeDriver: true })).start()
    Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 900, useNativeDriver: true }),
    ])).start()
    const timer = setInterval(() => setStep(n => Math.min(STEPS.length - 1, n + 1)), 2600)
    const started = Date.now()
    track('skin_test_started')
    analyzeSkin({ member_id: session.memberId, image: session.image, conditions: session.conditions, answers: session.answers, lang })
      .then(async r => {
        // Let the animation finish its story even when the AI is fast.
        await new Promise(res => setTimeout(res, Math.max(0, 5200 - (Date.now() - started))))
        addReport({ id: r.id, member_id: r.member_id, ts: r.ts, locked: r.locked, overall: r.report?.overall ?? null,
          scores: r.report ? Object.fromEntries(DIMENSIONS.map(k => [k, r.report!.dimensions[k].score])) as never : null })
        skinTest.clear()
        if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
        track('skin_test_done', { locked: r.locked })
        router.replace(r.locked ? `/paywall?report=${r.id}&trigger=report` : `/report/${r.id}`)
      })
      .catch((e: ApiError) => {
        track('skin_test_failed', { status: e.status ?? 0 })
        setError(e.code === 'offline' ? t('err.offline') : e.status === 429 ? t('err.tooMany') : e.message || t('err.generic'))
      })
      .finally(() => clearInterval(timer))
    return () => clearInterval(timer)
  }, [])

  if (!session?.image) return <Redirect href="/" />

  return (
    <View style={[s.screen, { paddingTop: insets.top + 40, paddingHorizontal: 24, paddingBottom: insets.bottom + 24, gap: 24, alignItems: 'center' }]}>
      <View style={{ width: 230, height: 300, borderRadius: 140, overflow: 'hidden', backgroundColor: '#000' }}>
        {session.preview ? <Image source={{ uri: session.preview }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
        {!error && (
          <>
            <Animated.View style={[StyleSheet.absoluteFill, { opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.05, 0.22] }) }]}>
              <LinearGradient colors={PEARL} style={StyleSheet.absoluteFill} />
            </Animated.View>
            <Animated.View style={{ position: 'absolute', left: 0, right: 0, height: 70,
              transform: [{ translateY: scan.interpolate({ inputRange: [0, 0.5, 1], outputRange: [-70, 300, -70] }) }] }}>
              <LinearGradient colors={['transparent', 'rgba(195,230,242,0.55)', 'rgba(255,255,255,0.95)']} style={{ flex: 1 }} />
            </Animated.View>
          </>
        )}
      </View>

      {error ? (
        <View style={{ gap: 14, width: '100%' }}>
          <Text style={[s.h2, { textAlign: 'center' }]}>{t('test.failed')}</Text>
          <Text style={[s.body, { textAlign: 'center', color: C.sub }]}>{error}</Text>
          <Button title={t('test.tryAgain')} onPress={() => { skinTest.set({ image: null, preview: null }); router.replace('/test/camera') }} />
          <Button kind="ghost" title={t('common.cancel')} onPress={() => { skinTest.clear(); router.replace('/') }} />
        </View>
      ) : (
        <View style={{ gap: 18, alignItems: 'center', width: '100%' }}>
          <AiBadge />
          <Text style={s.h2}>{t('test.analyzing')}</Text>
          <View style={{ gap: 10, alignSelf: 'stretch' }}>
            {STEPS.map((k, i) => (
              <View key={k} style={[s.row, { opacity: i <= step ? 1 : 0.3 }]}>
                <Text style={{ width: 20, color: i < step ? C.good : C.ink, fontWeight: '700' }}>{i < step ? '✓' : i === step ? '•' : '·'}</Text>
                <Text style={[s.body, i === step && { fontWeight: '600' }]}>{t(k)}</Text>
              </View>
            ))}
          </View>
        </View>
      )}
    </View>
  )
}
