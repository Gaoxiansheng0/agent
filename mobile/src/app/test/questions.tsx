import { Redirect, router } from 'expo-router'
import { useState } from 'react'
import { ScrollView, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { loc, useI18n } from '../../lib/i18n'
import { skinTest } from '../../lib/skinTest'
import { useStore } from '../../lib/store'
import { Button, C, Option, s } from '../../lib/ui'

// Step 3: the questionnaire (edited in the admin panel), one question per screen.
export default function Questions() {
  const { t, lang } = useI18n()
  const { questions } = useStore()
  const insets = useSafeAreaInsets()
  const session = skinTest.get()
  const [i, setI] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string | string[]>>(session?.answers ?? {})
  if (!session?.image || !questions.length) return <Redirect href="/" />

  const q = questions[i]
  const value = answers[q.id]
  const picked = (id: string) => (Array.isArray(value) ? value.includes(id) : value === id)
  const pick = (id: string) => {
    if (q.type === 'single') return setAnswers({ ...answers, [q.id]: id })
    const cur = Array.isArray(value) ? value : []
    setAnswers({ ...answers, [q.id]: cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id] })
  }
  const next = () => {
    skinTest.set({ answers })
    if (i < questions.length - 1) setI(i + 1)
    else router.replace('/test/analyzing')
  }
  const last = i === questions.length - 1

  return (
    <ScrollView style={s.screen} contentContainerStyle={{ paddingTop: insets.top + 56, paddingHorizontal: 22, paddingBottom: 40, gap: 14 }}>
      <View style={{ height: 4, borderRadius: 2, backgroundColor: C.fill, overflow: 'hidden' }}>
        <View style={{ width: `${((i + 1) / questions.length) * 100}%`, height: '100%', backgroundColor: C.ink }} />
      </View>
      <Text style={s.label}>{t('test.qTitle', { i: i + 1, n: questions.length })}</Text>
      <Text style={s.h2}>{loc(q.title, lang)}</Text>
      {q.options.map(o => <Option key={o.id} title={loc(o.label, lang)} on={picked(o.id)} onPress={() => pick(o.id)} />)}
      <Button title={last ? t('test.analyze') : t('common.continue')} onPress={next} kind={last ? 'pearl' : 'primary'} style={{ marginTop: 8 }}
        icon={last ? '✦' : undefined} disabled={!value || (Array.isArray(value) && !value.length)} />
      <Button kind="ghost" title={t('common.skip')} onPress={next} />
    </ScrollView>
  )
}
