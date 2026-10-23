import { LinearGradient } from 'expo-linear-gradient'
import { router } from 'expo-router'
import { useEffect, useRef } from 'react'
import { Animated, Easing, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useI18n } from '../lib/i18n'
import { AiBadge, Button, C, PEARL, s } from '../lib/ui'

// The first screen: what PearlKin does, in one glance, with the "AI scan" as the hook.
export default function Welcome() {
  const { t } = useI18n()
  const insets = useSafeAreaInsets()
  const scan = useRef(new Animated.Value(0)).current
  useEffect(() => {
    Animated.loop(Animated.sequence([
      Animated.timing(scan, { toValue: 1, duration: 1800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(scan, { toValue: 0, duration: 1800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ])).start()
  }, [scan])

  const points: [string, string, string][] = [['◎', t('wel.p1'), t('wel.p1d')], ['✓', t('wel.p2'), t('wel.p2d')], ['♡', t('wel.p3'), t('wel.p3d')]]
  return (
    <ScrollView style={s.screen} contentContainerStyle={{ paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24, paddingHorizontal: 24, gap: 22 }}>
      <View style={{ height: 260, borderRadius: 32, overflow: 'hidden', justifyContent: 'center', alignItems: 'center' }}>
        <LinearGradient colors={PEARL} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        {/* A stylised face outline with a scanning line: the product's promise in one image. */}
        <View style={{ width: 150, height: 196, borderRadius: 90, borderWidth: 2, borderColor: 'rgba(18,18,18,0.35)', overflow: 'hidden' }}>
          <Animated.View style={{ position: 'absolute', left: 0, right: 0, height: 2, backgroundColor: '#fff',
            shadowColor: '#fff', shadowOpacity: 1, shadowRadius: 8, transform: [{ translateY: scan.interpolate({ inputRange: [0, 1], outputRange: [8, 186] }) }] }} />
        </View>
        {[['18%', '12%', '◉ 78'], ['64%', '6%', t('dim.pores')], ['70%', '62%', t('dim.oiliness')], ['20%', '64%', t('dim.pigmentation')]].map(([top, left, label]) => (
          <View key={label} style={{ position: 'absolute', top: top as `${number}%`, left: left as `${number}%`, backgroundColor: 'rgba(255,255,255,0.85)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
            <Text style={{ fontSize: 12, fontWeight: '700', color: C.ink }}>{label}</Text>
          </View>
        ))}
      </View>

      <View style={{ gap: 10 }}>
        <AiBadge label={t('wel.kicker')} />
        <Text style={s.hero}>{t('wel.title')}</Text>
        <Text style={[s.body, { color: C.sub }]}>{t('wel.sub')}</Text>
      </View>

      <View style={{ gap: 14 }}>
        {points.map(([icon, title, detail]) => (
          <View key={title} style={{ flexDirection: 'row', gap: 14, alignItems: 'flex-start' }}>
            <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 16 }}>{icon}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[s.body, { fontWeight: '700' }]}>{title}</Text>
              <Text style={s.small}>{detail}</Text>
            </View>
          </View>
        ))}
      </View>

      <Button title={t('wel.start')} onPress={() => router.push('/sign-in')} />
      <Text style={[s.small, { textAlign: 'center' }]}>🔒 {t('wel.privacy')}</Text>
    </ScrollView>
  )
}
