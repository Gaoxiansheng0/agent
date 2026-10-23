import { LinearGradient } from 'expo-linear-gradient'
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { useCallback, useState } from 'react'
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { DIMENSIONS, getReport, type Dimension, type ReportFull } from '../../lib/api'
import { useI18n } from '../../lib/i18n'
import { useStore } from '../../lib/store'
import { AiBadge, Bar, Button, C, Card, DISCLAIMER_STYLE, fmtDate, PEARL, s, ScoreRing, scoreColor, Section } from '../../lib/ui'

export default function Report() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { t, lang } = useI18n()
  const { members, reports, pro } = useStore()
  const insets = useSafeAreaInsets()
  const [data, setData] = useState<ReportFull | null>(null)
  const [error, setError] = useState('')

  // Reload on focus: coming back from the paywall after subscribing unlocks the report.
  useFocusEffect(useCallback(() => {
    getReport(id).then(setData).catch(() => setError(t('err.generic')))
  }, [id, pro]))

  if (error) return <View style={[s.screen, s.pad, { paddingTop: insets.top + 80 }]}><Text style={s.body}>{error}</Text></View>
  if (!data) return <View style={[s.screen, { justifyContent: 'center' }]}><ActivityIndicator /></View>

  const member = members.find(m => m.id === data.member_id)
  const r = data.report
  const prev = reports.filter(x => x.member_id === data.member_id && x.ts < data.ts)[0]
  const delta = r && prev?.overall != null ? r.overall - prev.overall : null

  return (
    <ScrollView style={s.screen} contentContainerStyle={{ paddingTop: insets.top + 56, paddingHorizontal: 20, paddingBottom: 48, gap: 16 }}>
      <View style={{ gap: 2 }}>
        <Text style={s.small}>{[member?.name, fmtDate(data.ts, lang)].filter(Boolean).join(' · ')}</Text>
        <Text style={s.h1}>{t('rep.title')}</Text>
      </View>

      {/* Hero: overall score, skin age, skin type. */}
      <View style={{ borderRadius: 28, overflow: 'hidden', padding: 22 }}>
        <LinearGradient colors={PEARL} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, { opacity: 0.55 }]} />
        <View style={[s.row, { flexWrap: 'nowrap', gap: 18 }]}>
          <ScoreRing score={r ? r.overall : null} size={150} label={t('rep.overall')} />
          <View style={{ flex: 1, gap: 14 }}>
            <View><Text style={s.label}>{t('rep.skinAge')}</Text><Text style={{ fontSize: 30, fontWeight: '700', color: C.ink }}>{r ? r.skin_age ?? '–' : '··'}</Text></View>
            <View><Text style={s.label}>{t('rep.type')}</Text><Text style={[s.h3, { fontSize: 18 }]}>{r ? t(`type.${r.skin_type}`) : '··'}</Text></View>
            {delta !== null && <Text style={[s.small, { fontWeight: '700', color: delta >= 0 ? C.good : C.bad }]}>{t('home.trend', { delta: `${delta >= 0 ? '+' : ''}${delta}` })}</Text>}
          </View>
        </View>
      </View>

      {!r ? (
        <Card style={{ gap: 14 }}>
          <Text style={s.h2}>{t('rep.lockedTitle')}</Text>
          <Text style={s.muted}>{t('rep.lockedSub')}</Text>
          {DIMENSIONS.map(k => (
            <View key={k} style={{ gap: 6 }}>
              <View style={[s.row, { justifyContent: 'space-between' }]}><Text style={s.body}>{t(`dim.${k}`)}</Text><Text style={s.body}>🔒</Text></View>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: C.fill }} />
            </View>
          ))}
          <Button kind="pearl" title={t('rep.unlock')} onPress={() => router.push(`/paywall?report=${data.id}&trigger=report`)} />
        </Card>
      ) : (
        <>
          <Card>
            <AiBadge />
            <Text style={[s.body, { fontSize: 17, lineHeight: 25 }]}>{r.summary}</Text>
            {r.confidence === 'low' && <Text style={[s.small, { color: C.care }]}>{t('rep.confLow')}</Text>}
          </Card>

          {r.priorities.length > 0 && (
            <Section title={t('rep.focus')}>
              <View style={[s.row, { gap: 10 }]}>
                {r.priorities.map(k => (
                  <View key={k} style={{ backgroundColor: C.surface, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10, gap: 2 }}>
                    <Text style={[s.small, { fontWeight: '600' }]}>{t(`dim.${k}`)}</Text>
                    <Text style={{ fontSize: 22, fontWeight: '700', color: scoreColor(r.dimensions[k].score) }}>{r.dimensions[k].score}</Text>
                  </View>
                ))}
              </View>
            </Section>
          )}

          <Section title={t('rep.details')}>
            <Card style={{ gap: 0, paddingVertical: 6 }}>
              {(DIMENSIONS as readonly Dimension[]).map((k, i) => {
                const d = r.dimensions[k]
                return (
                  <View key={k} style={{ paddingVertical: 14, gap: 8, borderTopWidth: i ? 1 : 0, borderTopColor: C.line }}>
                    <View style={[s.row, { justifyContent: 'space-between' }]}>
                      <Text style={[s.body, { fontWeight: '600' }]}>{t(`dim.${k}`)}</Text>
                      <Text style={[s.small, { fontWeight: '700', color: scoreColor(d.score) }]}>{t(`lvl.${d.level}`)} · {d.score}</Text>
                    </View>
                    <Bar value={d.score} />
                    {d.note ? <Text style={s.small}>{d.note}</Text> : null}
                  </View>
                )
              })}
            </Card>
          </Section>

          {(r.look_for.length > 0 || r.avoid.length > 0) && (
            <Card>
              {r.look_for.length > 0 && <>
                <Text style={s.label}>{t('rep.lookFor')}</Text>
                <View style={s.row}>{r.look_for.map(x => <Pill key={x} text={x} color={C.good} />)}</View>
              </>}
              {r.avoid.length > 0 && <>
                <Text style={[s.label, { marginTop: 6 }]}>{t('rep.avoid')}</Text>
                <View style={s.row}>{r.avoid.map(x => <Pill key={x} text={x} color={C.bad} />)}</View>
              </>}
            </Card>
          )}

          {r.tips.length > 0 && (
            <Section title={t('rep.tips')}>
              <Card>
                {r.tips.map((tip, i) => (
                  <View key={i} style={[s.row, { flexWrap: 'nowrap', alignItems: 'flex-start', gap: 12 }]}>
                    <Text style={{ fontWeight: '700', color: C.faint, width: 18 }}>{i + 1}</Text>
                    <Text style={[s.body, { flex: 1 }]}>{tip}</Text>
                  </View>
                ))}
              </Card>
            </Section>
          )}

          <Button title={t('rep.checkShelf')} onPress={() => router.push('/shelf')} icon="✦" />
        </>
      )}
      <Text style={DISCLAIMER_STYLE}>{t('disclaimer')}</Text>
    </ScrollView>
  )
}

function Pill({ text, color }: { text: string; color: string }) {
  return <View style={{ borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: color + '18' }}><Text style={{ color, fontWeight: '600', fontSize: 13 }}>{text}</Text></View>
}
