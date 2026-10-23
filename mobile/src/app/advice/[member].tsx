import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { ActivityIndicator, ScrollView, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { getAdvice, type Advice, type ApiError } from '../../lib/api'
import { useI18n } from '../../lib/i18n'
import { latestFor, useStore } from '../../lib/store'
import { AiBadge, Button, C, Card, DISCLAIMER_STYLE, s, Section } from '../../lib/ui'

// The AI routine: morning / evening order, what to pause, conflicts and gaps, from products the person already uses.
export default function AdviceScreen() {
  const { member: memberId } = useLocalSearchParams<{ member: string }>()
  const { members, products, reports } = useStore()
  const { t, lang } = useI18n()
  const insets = useSafeAreaInsets()
  const member = members.find(m => m.id === memberId)
  const [advice, setAdvice] = useState<Advice | null>(null)
  const [error, setError] = useState<{ text: string; paywall?: boolean; empty?: boolean } | null>(null)
  const used = products.filter(p => p.used_by.includes(memberId))
  const name = member ? (member.is_self ? t('fam.you') : member.name) : ''

  useEffect(() => {
    if (!member) return
    if (!used.length) return setError({ text: t('adv.empty', { name }), empty: true })
    getAdvice(member.id, lang).then(setAdvice).catch((e: ApiError) => {
      if (e.code === 'paywall') setError({ text: t('pw.b4'), paywall: true })
      else if (e.code === 'no_products') setError({ text: t('adv.empty', { name }), empty: true })
      else setError({ text: e.code === 'offline' ? t('err.offline') : e.status === 429 ? t('err.tooMany') : t('err.generic') })
    })
  }, [memberId, lang, used.length])

  if (!member) return null
  const pname = (id: string) => products.find(p => p.id === id)?.name ?? ''

  const Steps = ({ title, items }: { title: string; items: { id: string; why: string }[] }) => items.length ? (
    <Section title={title}>
      <Card style={{ gap: 0, paddingVertical: 6 }}>
        {items.map((x, i) => (
          <View key={x.id + i} style={[s.row, { flexWrap: 'nowrap', alignItems: 'flex-start', gap: 12, paddingVertical: 12, borderTopWidth: i ? 1 : 0, borderTopColor: C.line }]}>
            <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>{i + 1}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[s.body, { fontWeight: '600' }]}>{pname(x.id)}</Text>
              {x.why ? <Text style={s.small}>{x.why}</Text> : null}
            </View>
          </View>
        ))}
      </Card>
    </Section>
  ) : null

  return (
    <ScrollView style={s.screen} contentContainerStyle={{ paddingTop: insets.top + 56, paddingHorizontal: 20, paddingBottom: 48, gap: 14 }}>
      <View style={{ gap: 6 }}>
        <AiBadge />
        <Text style={s.h1}>{t('adv.title')}</Text>
        <Text style={s.small}>{t('adv.for', { name })}</Text>
      </View>

      {error ? (
        <Card>
          <Text style={s.body}>{error.text}</Text>
          {error.paywall && <Button kind="pearl" title={t('me.upgrade')} onPress={() => router.push('/paywall?trigger=advice')} />}
          {error.empty && <Button kind="secondary" title={t('tab.shelf')} onPress={() => router.back()} />}
        </Card>
      ) : !advice ? (
        <Card style={{ alignItems: 'center', paddingVertical: 32 }}><ActivityIndicator /><Text style={s.small}>{t('adv.loading')}</Text></Card>
      ) : (
        <>
          {advice.summary ? <Card><Text style={[s.body, { fontSize: 17, lineHeight: 25 }]}>{advice.summary}</Text></Card> : null}
          {!latestFor(reports, member.id) && <Text style={[s.small, { color: C.care }]}>{t('adv.noReport', { name })}</Text>}
          <Steps title={`☀︎  ${t('adv.am')}`} items={advice.am} />
          <Steps title={`☾  ${t('adv.pm')}`} items={advice.pm} />
          {advice.pause.length > 0 && (
            <Section title={t('adv.pause')}>
              <Card>{advice.pause.map(x => <View key={x.id} style={{ gap: 2 }}><Text style={[s.body, { fontWeight: '600', color: C.bad }]}>{pname(x.id)}</Text><Text style={s.small}>{x.why}</Text></View>)}</Card>
            </Section>
          )}
          {advice.conflicts.length > 0 && (
            <Section title={t('adv.conflicts')}>
              <Card>{advice.conflicts.map((c, i) => <View key={i} style={{ gap: 2 }}><Text style={[s.body, { fontWeight: '600' }]}>{c.ids.map(pname).join(' + ')}</Text><Text style={s.small}>{c.why}</Text></View>)}</Card>
            </Section>
          )}
          {advice.gaps.length > 0 && (
            <Section title={t('adv.gaps')}>
              <Card>{advice.gaps.map((g, i) => (
                <View key={i} style={{ gap: 2 }}>
                  <Text style={[s.body, { fontWeight: '600' }]}>{g.need}</Text>
                  {g.why ? <Text style={s.small}>{g.why}</Text> : null}
                  {g.look_for.length > 0 && <Text style={[s.small, { color: C.good }]}>{t('adv.lookFor', { list: g.look_for.join(', ') })}</Text>}
                </View>
              ))}</Card>
            </Section>
          )}
        </>
      )}
      <Text style={DISCLAIMER_STYLE}>{t('disclaimer')}</Text>
    </ScrollView>
  )
}
