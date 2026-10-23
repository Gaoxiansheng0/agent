import { router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { Alert, Platform, ScrollView, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useI18n } from '../../lib/i18n'
import { newId, useStore } from '../../lib/store'
import { Button, C, Field, s, Toggle } from '../../lib/ui'

const STAGES = ['pregnancy', 'breastfeeding'] as const
const CONCERNS = ['sensitive', 'acne_prone'] as const

export default function MemberEdit() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { t } = useI18n()
  const { members, saveMember, deleteMember } = useStore()
  const insets = useSafeAreaInsets()
  const existing = members.find(m => m.id === id)
  const [name, setName] = useState(existing?.name ?? '')
  const [year, setYear] = useState(existing?.birth_year ? String(existing.birth_year) : '')
  const [stage, setStage] = useState(existing?.life_stage ?? '')
  const [concerns, setConcerns] = useState<string[]>(existing?.concerns ?? [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const thisYear = new Date().getFullYear()
  const age = Number(year) ? thisYear - Number(year) : null

  const save = async () => {
    const y = Number(year)
    if (!name.trim() || !y || y < 1900 || y > thisYear) return setError(t('mem.need'))
    setBusy(true)
    try {
      await saveMember({ id: existing?.id ?? newId('m'), name: name.trim(), birth_year: y, life_stage: stage, concerns, is_self: existing?.is_self ?? false })
      router.back()
    } catch (e) {
      setError((e as Error).message || t('err.generic'))
      setBusy(false)
    }
  }
  const remove = () => {
    if (!existing) return
    const go = async () => { await deleteMember(existing.id).catch(() => {}); router.back() }
    const msg = t('mem.confirmRemove', { name: existing.name })
    if (Platform.OS === 'web') { if (window.confirm(msg)) void go() }
    else Alert.alert(msg, undefined, [{ text: t('common.cancel'), style: 'cancel' }, { text: t('common.delete'), style: 'destructive', onPress: () => void go() }])
  }

  return (
    <ScrollView style={s.screen} contentContainerStyle={{ paddingTop: insets.top + 56, paddingHorizontal: 22, paddingBottom: 40, gap: 16 }} keyboardShouldPersistTaps="handled">
      <Text style={s.h1}>{existing ? t('mem.edit') : t('mem.new')}</Text>
      <Field label={t('mem.name')} value={name} onChangeText={setName} maxLength={30} />
      <Field label={t('mem.year')} value={year} onChangeText={v => setYear(v.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={4} placeholder="2012" />
      {age !== null && age < 13 && <Text style={[s.small, { color: C.sub }]}>{t('mem.under13')}</Text>}
      {(age === null || age >= 16) && (
        <View style={{ gap: 8 }}>
          <Text style={s.label}>{t('mem.stage')}</Text>
          <View style={s.row}>{STAGES.map(st => <Toggle key={st} label={t(`stage.${st}`)} on={stage === st} onPress={() => setStage(stage === st ? '' : st)} />)}</View>
        </View>
      )}
      <View style={{ gap: 8 }}>
        <Text style={s.label}>{t('mem.concerns')}</Text>
        <View style={s.row}>{CONCERNS.map(c => {
          const on = concerns.includes(c)
          return <Toggle key={c} label={t(`concern.${c}`)} on={on} onPress={() => setConcerns(on ? concerns.filter(x => x !== c) : [...concerns, c])} />
        })}</View>
      </View>
      {error ? <Text style={[s.body, { color: C.danger }]}>{error}</Text> : null}
      <Button title={t('common.save')} onPress={save} busy={busy} />
      {existing && !existing.is_self && <Button kind="danger" title={t('mem.remove', { name: existing.name })} onPress={remove} />}
    </ScrollView>
  )
}
