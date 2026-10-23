import { router } from 'expo-router'
import { ScrollView, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useI18n } from '../../lib/i18n'
import { skinTest } from '../../lib/skinTest'
import { ageOf, canSkinTest, latestFor, useStore } from '../../lib/store'
import { Avatar, Button, C, Card, s, scoreColor } from '../../lib/ui'

export default function Family() {
  const { t } = useI18n()
  const { members, reports } = useStore()
  const insets = useSafeAreaInsets()

  return (
    <ScrollView style={s.screen} contentContainerStyle={{ paddingTop: insets.top + 16, paddingHorizontal: 20, paddingBottom: 40, gap: 16 }}>
      <View style={{ gap: 4 }}>
        <Text style={s.h1}>{t('fam.title')}</Text>
        <Text style={s.muted}>{t('fam.sub')}</Text>
      </View>

      {members.map(m => {
        const latest = latestFor(reports, m.id)
        const age = ageOf(m)
        const detail = [age !== null ? t('fam.age', { n: age }) : null, m.life_stage ? t(`stage.${m.life_stage as 'pregnancy'}`) : null,
          ...m.concerns.map(c => t(`concern.${c as 'sensitive'}`))].filter(Boolean).join(' · ')
        return (
          <Card key={m.id} onPress={() => router.push(`/member/${m.id}`)} style={{ gap: 12 }}>
            <View style={[s.row, { flexWrap: 'nowrap', gap: 12 }]}>
              <Avatar name={m.name} size={48} dark={m.is_self} />
              <View style={{ flex: 1 }}>
                <Text style={[s.body, { fontWeight: '700' }]}>{m.name}{m.is_self ? ` · ${t('fam.you')}` : ''}</Text>
                <Text style={s.small}>{detail}</Text>
              </View>
              {latest ? (
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ fontSize: 24, fontWeight: '700', color: latest.overall != null ? scoreColor(latest.overall) : C.faint }}>{latest.locked ? '🔒' : latest.overall}</Text>
                  <Text style={[s.small, { fontSize: 11 }]}>{t('rep.overall')}</Text>
                </View>
              ) : <Text style={[s.small, { color: C.faint }]}>{canSkinTest(m) ? t('fam.noTest') : ''}</Text>}
            </View>
            {canSkinTest(m) && (
              <View style={[s.row, { flexWrap: 'nowrap' }]}>
                <Button kind="secondary" title={t('fam.test')} icon="✦" style={{ flex: 1, minHeight: 44, paddingVertical: 10 }}
                  onPress={() => { skinTest.start(m.id); router.push('/test/camera') }} />
                {latest && <Button kind="secondary" title={t('home.view')} style={{ flex: 1, minHeight: 44, paddingVertical: 10 }} onPress={() => router.push(`/report/${latest.id}`)} />}
              </View>
            )}
          </Card>
        )
      })}

      {members.length < 6
        ? <Button title={t('fam.add')} icon="+" onPress={() => router.push('/member/new')} />
        : <Text style={[s.small, { textAlign: 'center' }]}>{t('fam.limit')}</Text>}
    </ScrollView>
  )
}
