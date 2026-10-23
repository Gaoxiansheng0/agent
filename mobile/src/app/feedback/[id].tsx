import { router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { ScrollView, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { sendReport, track, type ApiError, type ReportKind } from '../../lib/api'
import { useI18n } from '../../lib/i18n'
import { useStore } from '../../lib/store'
import { Button, C, Field, s, Toggle } from '../../lib/ui'

const KINDS: ReportKind[] = ['ingredients', 'verdict', 'product', 'other']

// "Report a problem" on a product: sends the product and the user's note, never the family or their results.
export default function Feedback() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { products, pack } = useStore()
  const { t } = useI18n()
  const insets = useSafeAreaInsets()
  const p = products.find(x => x.id === id)
  const [kind, setKind] = useState<ReportKind>('ingredients')
  const [message, setMessage] = useState('')
  const [contact, setContact] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  if (!p) return <Text style={[s.body, s.pad]}>{t('prod.removed')}</Text>

  const send = async () => {
    if (kind === 'other' && !message.trim()) return setError(t('fb.needMsg'))
    setBusy(true)
    setError('')
    try {
      await sendReport({ kind, message: message.trim(), contact: contact.trim(), product_name: p.name, brand: p.brand, barcode: p.barcode, raw: p.raw, pack_version: pack.version })
      track('report_sent', { kind })
      setSent(true)
    } catch (e) {
      setError(t((e as ApiError).status === 429 ? 'err.tooMany' : 'err.generic'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ScrollView style={s.screen} contentContainerStyle={{ paddingTop: insets.top + 56, paddingHorizontal: 22, paddingBottom: 40, gap: 14 }} keyboardShouldPersistTaps="handled">
      {sent ? (
        <>
          <Text style={s.h1}>{t('fb.thanks')}</Text>
          <Text style={s.body}>{t('fb.thanksBody')}</Text>
          <Button title={t('common.done')} onPress={() => router.back()} />
        </>
      ) : (
        <>
          <Text style={s.h1}>{t('fb.title')}</Text>
          <Text style={s.small}>{p.name}</Text>
          <View style={s.row}>{KINDS.map(k => <Toggle key={k} label={t(`fb.kind.${k}`)} on={kind === k} onPress={() => setKind(k)} />)}</View>
          <Field multiline maxLength={2000} placeholder={t('fb.what')} value={message} onChangeText={setMessage} />
          <Field placeholder={t('fb.email')} keyboardType="email-address" autoCapitalize="none" autoComplete="email" maxLength={200} value={contact} onChangeText={setContact} />
          <Text style={s.small}>{t('fb.privacy')}</Text>
          {error ? <Text style={[s.body, { color: C.danger }]}>{error}</Text> : null}
          <Button title={t('fb.send')} onPress={send} busy={busy} />
        </>
      )}
    </ScrollView>
  )
}
