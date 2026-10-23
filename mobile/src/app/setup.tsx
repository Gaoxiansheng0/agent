import { router } from 'expo-router'
import { useState } from 'react'
import { ScrollView, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useI18n } from '../lib/i18n'
import { skinTest } from '../lib/skinTest'
import { newId, useStore } from '../lib/store'
import { Button, C, Field, s, Toggle } from '../lib/ui'

// After sign-up: the account holder's own profile, then straight into the first skin test.
export default function Setup() {
  const { t } = useI18n()
  const { saveMember } = useStore()
  const insets = useSafeAreaInsets()
  const [name, setName] = useState('')
  const [year, setYear] = useState('')
  const [stage, setStage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const thisYear = new Date().getFullYear()

  const save = async () => {
    const y = Number(year)
    if (!name.trim() || !y || y < 1900 || y > thisYear - 13) return setError(t('setup.need'))
    setBusy(true)
    try {
      const id = newId('m')
      await saveMember({ id, name: name.trim(), birth_year: y, life_stage: stage, concerns: [], is_self: true })
      skinTest.start(id)
      router.replace('/test/camera')
    } catch {
      setError(t('err.generic'))
      setBusy(false)
    }
  }

  return (
    <ScrollView style={s.screen} contentContainerStyle={{ paddingTop: insets.top + 48, paddingHorizontal: 24, paddingBottom: 40, gap: 18 }} keyboardShouldPersistTaps="handled">
      <View style={{ gap: 8 }}>
        <Text style={s.h1}>{t('setup.title')}</Text>
        <Text style={[s.body, { color: C.sub }]}>{t('setup.sub')}</Text>
      </View>
      <Field label={t('setup.name')} value={name} onChangeText={setName} maxLength={30} autoComplete="given-name" />
      <Field label={t('setup.year')} value={year} onChangeText={v => setYear(v.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={4} placeholder="1994" />
      <View style={{ gap: 8 }}>
        <Text style={s.label}>{t('setup.stage')}</Text>
        <View style={s.row}>
          {(['pregnancy', 'breastfeeding'] as const).map(st => (
            <Toggle key={st} label={t(`stage.${st}`)} on={stage === st} onPress={() => setStage(stage === st ? '' : st)} />
          ))}
        </View>
      </View>
      {error ? <Text style={[s.body, { color: C.danger }]}>{error}</Text> : null}
      <Button title={t('setup.start')} onPress={save} busy={busy} />
    </ScrollView>
  )
}
