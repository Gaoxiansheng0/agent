import { Redirect, router } from 'expo-router'
import { useState } from 'react'
import { Image, ScrollView, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { Conditions } from '../../lib/api'
import { useI18n } from '../../lib/i18n'
import { skinTest } from '../../lib/skinTest'
import { useStore } from '../../lib/store'
import { Button, C, Option, s } from '../../lib/ui'

// Step 2: how the photo was taken. Makeup and light change how much the AI can see.
export default function ConditionsScreen() {
  const { t } = useI18n()
  const { questions } = useStore()
  const insets = useSafeAreaInsets()
  const session = skinTest.get()
  const [c, setC] = useState<Conditions>(session?.conditions ?? { makeup: 'none', light: 'daylight' })
  if (!session?.image) return <Redirect href="/" />

  const next = () => {
    skinTest.set({ conditions: c })
    router.push(questions.length ? '/test/questions' : '/test/analyzing')
  }

  return (
    <ScrollView style={s.screen} contentContainerStyle={{ paddingTop: insets.top + 56, paddingHorizontal: 22, paddingBottom: 40, gap: 16 }}>
      <View style={[s.row, { flexWrap: 'nowrap', gap: 14 }]}>
        {session.preview ? <Image source={{ uri: session.preview }} style={{ width: 64, height: 64, borderRadius: 32 }} /> : null}
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={s.h2}>{t('test.condTitle')}</Text>
          <Text style={s.small}>{t('test.condSub')}</Text>
        </View>
      </View>

      <Text style={s.label}>{t('test.makeup')}</Text>
      {(['none', 'light', 'full'] as const).map(m => <Option key={m} title={t(`mk.${m}`)} on={c.makeup === m} onPress={() => setC({ ...c, makeup: m })} />)}
      {c.makeup !== 'none' && <Text style={[s.small, { color: C.care }]}>{t('test.makeupWarn')}</Text>}

      <Text style={[s.label, { marginTop: 8 }]}>{t('test.light')}</Text>
      {(['daylight', 'indoor', 'dim'] as const).map(l => <Option key={l} title={t(`lt.${l}`)} on={c.light === l} onPress={() => setC({ ...c, light: l })} />)}

      <Button title={t('common.continue')} onPress={next} style={{ marginTop: 8 }} />
    </ScrollView>
  )
}
