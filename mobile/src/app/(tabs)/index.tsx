import { LinearGradient } from 'expo-linear-gradient'
import { router } from 'expo-router'
import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { DIMENSIONS } from '../../lib/api'
import { useI18n } from '../../lib/i18n'
import { skinTest } from '../../lib/skinTest'
import { canSkinTest, useStore } from '../../lib/store'
import { AiBadge, Avatar, Bar, Button, C, Card, fmtDate, PEARL, s, ScoreRing, Section } from '../../lib/ui'

export default function SkinHome() {
  const { t, lang } = useI18n()
  const { members, reports } = useStore()
  const insets = useSafeAreaInsets()
  const self = members.find(m => m.is_self) ?? members[0]
  const [selected, setSelected] = useState(self?.id)
  const member = members.find(m => m.id === selected) ?? self
  if (!member) return null

  const mine = reports.filter(r => r.member_id === member.id)
  const latest = mine[0], previous = mine[1]
  const delta = latest?.overall != null && previous?.overall != null ? latest.overall - previous.overall : null
  const start = () => { skinTest.start(member.id); router.push('/test/camera') }
  const weakest = latest?.scores ? DIMENSIONS.map(k => [k, latest.scores![k]] as const).sort((a, b) => a[1] - b[1]).slice(0, 3) : []

  return (
    <ScrollView style={s.screen} contentContainerStyle={{ paddingTop: insets.top + 16, paddingHorizontal: 20, paddingBottom: 40, gap: 16 }}>
      <View style={{ gap: 4 }}>
        <Text style={s.small}>{new Date().toLocaleDateString(lang, { weekday: 'long', month: 'long', day: 'numeric' })}</Text>
        <Text style={s.h1}>{t('home.hello', { name: member.name })}</Text>
      </View>

      {members.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
          {members.map(m => (
            <Pressable key={m.id} onPress={() => setSelected(m.id)} accessibilityRole="tab" accessibilityState={{ selected: m.id === member.id }}
              style={{ alignItems: 'center', gap: 4, opacity: m.id === member.id ? 1 : 0.55 }}>
              <Avatar name={m.name} size={44} dark={m.id === member.id} />
              <Text style={[s.small, { fontWeight: '600', color: C.ink }]}>{m.is_self ? t('fam.you') : m.name}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      {!canSkinTest(member) ? (
        <Card><Text style={s.body}>{t('home.under13', { name: member.name })}</Text>
          <Button kind="secondary" title={t('tab.shelf')} onPress={() => router.push('/shelf')} /></Card>
      ) : !latest ? (
        <View style={{ borderRadius: 28, overflow: 'hidden', padding: 24, gap: 14 }}>
          <LinearGradient colors={PEARL} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
          <AiBadge />
          <Text style={s.h1}>{t('home.emptyTitle')}</Text>
          <Text style={s.body}>{t('home.emptySub')}</Text>
          <Button title={t('home.start')} onPress={start} />
        </View>
      ) : (
        <Card style={{ padding: 22, gap: 16 }}>
          <View style={[s.row, { justifyContent: 'space-between' }]}>
            <Text style={s.label}>{t('home.latest')}</Text>
            <Text style={s.small}>{fmtDate(latest.ts, lang)}</Text>
          </View>
          <View style={[s.row, { gap: 20, flexWrap: 'nowrap' }]}>
            <ScoreRing score={latest.locked ? null : latest.overall} label={t('rep.overall')} />
            <View style={{ flex: 1, gap: 10 }}>
              {latest.locked ? <Text style={s.body}>{t('home.locked')}</Text> : (
                <>
                  {delta !== null && <Text style={[s.small, { color: delta >= 0 ? C.good : C.bad, fontWeight: '700' }]}>
                    {t('home.trend', { delta: `${delta >= 0 ? '+' : ''}${delta}` })}</Text>}
                  {weakest.map(([k, v]) => (
                    <View key={k} style={{ gap: 4 }}>
                      <View style={[s.row, { justifyContent: 'space-between' }]}><Text style={s.small}>{t(`dim.${k}`)}</Text><Text style={[s.small, { fontWeight: '700', color: C.ink }]}>{v}</Text></View>
                      <Bar value={v} />
                    </View>
                  ))}
                </>
              )}
            </View>
          </View>
          {latest.locked
            ? <Button kind="pearl" title={t('rep.unlock')} onPress={() => router.push(`/paywall?report=${latest.id}&trigger=home`)} />
            : <Button kind="secondary" title={t('home.view')} onPress={() => router.push(`/report/${latest.id}`)} />}
        </Card>
      )}

      {latest && canSkinTest(member) && <Button title={t('home.retest')} onPress={start} icon="✦" />}

      {latest && (
        <Card onPress={() => router.push('/shelf')} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ flex: 1, gap: 4 }}><AiBadge /><Text style={[s.body, { fontWeight: '600' }]}>{t('home.shelfCta')}</Text></View>
          <Text style={{ fontSize: 22, color: C.faint }}>›</Text>
        </Card>
      )}

      {mine.length > 1 && (
        <Section title={t('home.history')}>
          <Card style={{ gap: 0, paddingVertical: 6 }}>
            {mine.map((r, i) => (
              <Pressable key={r.id} onPress={() => router.push(`/report/${r.id}`)} style={[s.row, { justifyContent: 'space-between', paddingVertical: 12, borderTopWidth: i ? 1 : 0, borderTopColor: C.line }]}>
                <Text style={s.body}>{fmtDate(r.ts, lang)}</Text>
                <Text style={[s.body, { fontWeight: '700' }]}>{r.locked ? '🔒' : r.overall} ›</Text>
              </Pressable>
            ))}
          </Card>
        </Section>
      )}

      {canSkinTest(member) && <Text style={[s.small, { textAlign: 'center', color: C.faint }]}>{t('home.tip')}</Text>}
    </ScrollView>
  )
}
