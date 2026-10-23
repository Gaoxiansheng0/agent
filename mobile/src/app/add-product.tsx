import { CameraView, useCameraPermissions } from 'expo-camera'
import { router } from 'expo-router'
import { useRef, useState } from 'react'
import { ActivityIndicator, Platform, ScrollView, Text, View } from 'react-native'
import { normalize } from '../../../engine/engine'
import { lookupOurProduct, sendUnknowns, submitProduct, track } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { pickLabelPhoto, readLabel } from '../lib/ocr'
import { newId, useStore } from '../lib/store'
import { AiBadge, Button, C, Card, Field, s, Toggle } from '../lib/ui'

type Method = 'barcode' | 'photo' | 'manual'

// Our curated library first (admin-reviewed, includes user corrections), then Open Beauty Facts.
async function lookup(code: string) {
  const ours = await lookupOurProduct(code).catch(() => null)
  if (ours) return { hit: { name: ours.name, brand: ours.brand, raw: ours.raw }, source: 'ours' as const }
  const res = await fetch(`https://world.openbeautyfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=product_name,brands,ingredients_text_en,ingredients_text`)
  const j = await res.json()
  const raw = j.status === 1 ? j.product.ingredients_text_en || j.product.ingredients_text : ''
  return raw ? { hit: { name: j.product.product_name || `Product ${code}`, brand: j.product.brands ?? '', raw }, source: 'obf' as const } : { hit: null, source: 'miss' as const }
}

export default function AddProduct() {
  const { t } = useI18n()
  const { members, saveProduct, pack } = useStore()
  const self = members.find(m => m.is_self)
  const [mode, setMode] = useState<'barcode' | 'label'>('barcode')
  const [permission, requestPermission] = useCameraPermissions()
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [brand, setBrand] = useState('')
  const [raw, setRaw] = useState('')
  const [usedBy, setUsedBy] = useState<string[]>(self ? [self.id] : [])
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [fromPhoto, setFromPhoto] = useState(false)
  const scanning = useRef(false)

  const save = async (p: { name: string; brand: string; raw: string; barcode: string }, method: Method, missedBarcode = false) => {
    const id = newId('p')
    setBusy(true)
    try {
      await saveProduct({ id, ...p, used_by: usedBy })
    } catch {
      setBusy(false)
      return setNote(t('err.generic'))
    }
    const { inci, unknown } = normalize(p.raw, pack)
    track('product_saved', { method, inci_count: inci.length, unknown_count: unknown.length })
    void sendUnknowns(unknown)
    // A barcode no database knew + the list the user just checked: goes to our review queue for everyone else.
    if (missedBarcode && p.barcode) void submitProduct(p)
    router.replace(`/product/${id}`)
  }

  const find = async (barcode: string) => {
    if (scanning.current || !barcode.trim()) return
    scanning.current = true
    setBusy(true)
    setNote('')
    try {
      const { hit, source } = await lookup(barcode.trim())
      track('scan_barcode', { result: source })
      if (hit) return void save({ ...hit, barcode: barcode.trim() }, 'barcode')
      setCode(barcode.trim())
      setMode('label')
      setNote(t('scan.notFound'))
    } catch {
      track('scan_barcode', { result: 'error' })
      setNote(t('scan.dbError'))
      setMode('label')
    } finally {
      setBusy(false)
      scanning.current = false
    }
  }

  // The photo only fills the text box; the user checks it against the label before saving.
  const photo = async (source: 'camera' | 'library') => {
    setNote('')
    try {
      const image = await pickLabelPhoto(source)
      if (!image) return
      setBusy(true)
      const label = await readLabel(image)
      if (!label.found || !label.ingredients.length) { track('label_photo', { result: 'empty' }); return setNote(t('scan.noList')) }
      track('label_photo', { result: 'ok' })
      setFromPhoto(true)
      setRaw(label.ingredients.join(', '))
      if (!name.trim() && label.product_name) setName(label.product_name)
      setNote(label.unreadable ? t('scan.partial') : t('scan.compare'))
    } catch (e) {
      track('label_photo', { result: 'error' })
      const err = e as { code?: string; status?: number }
      setNote(t(err.code === 'camera-denied' ? 'scan.cameraDenied' : err.status === 413 ? 'scan.tooLarge' : err.status === 429 ? 'err.tooMany' : err.status === 503 ? 'err.busy' : 'scan.readFailed'))
    } finally {
      setBusy(false)
    }
  }

  const whoUses = (
    <View style={{ gap: 8 }}>
      <Text style={s.label}>{t('scan.whoUses')}</Text>
      <View style={s.row}>{members.map(m => {
        const on = usedBy.includes(m.id)
        return <Toggle key={m.id} label={m.is_self ? t('fam.you') : m.name} on={on} onPress={() => setUsedBy(on ? usedBy.filter(x => x !== m.id) : [...usedBy, m.id])} />
      })}</View>
    </View>
  )

  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.pad, { paddingBottom: 48 }]} keyboardShouldPersistTaps="handled">
      <View style={s.row}>
        <Toggle label={t('scan.barcode')} on={mode === 'barcode'} onPress={() => setMode('barcode')} />
        <Toggle label={t('scan.ingredients')} on={mode === 'label'} onPress={() => setMode('label')} />
      </View>
      {note ? <Card><Text style={[s.body, { fontWeight: '500' }]}>{note}</Text></Card> : null}
      {whoUses}

      {mode === 'barcode' ? (
        <>
          {permission?.granted ? (
            <View style={{ height: 240, borderRadius: 22, overflow: 'hidden', backgroundColor: '#000' }}>
              <CameraView style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ['ean13', 'upc_a', 'upc_e', 'ean8'] }}
                onBarcodeScanned={busy ? undefined : r => find(r.data)} />
            </View>
          ) : (
            <Card style={{ alignItems: 'center' }}>
              <Text style={s.muted}>{t('scan.pointCamera')}</Text>
              <Button title={t('scan.allowCamera')} onPress={requestPermission} style={{ alignSelf: 'stretch' }} />
            </Card>
          )}
          {busy && <ActivityIndicator />}
          <Text style={s.small}>{t('scan.typeBarcode')}</Text>
          <View style={[s.row, { flexWrap: 'nowrap' }]}>
            <View style={{ flex: 1 }}><Field placeholder={t('scan.barcodePh')} keyboardType="number-pad" value={code} onChangeText={setCode} onSubmitEditing={() => find(code)} /></View>
            <Button title={t('scan.lookUp')} onPress={() => find(code)} />
          </View>
        </>
      ) : (
        <>
          <View style={[s.row, { flexWrap: 'nowrap' }]}>
            <Button title={t('scan.photo')} icon="✦" style={{ flex: 1 }} onPress={() => photo('camera')} />
            <Button title={t('scan.choose')} kind="secondary" style={{ flex: 1 }} onPress={() => photo('library')} />
          </View>
          {busy && <View style={[s.row, { justifyContent: 'center' }]}><AiBadge /><ActivityIndicator /><Text style={s.small}>{t('scan.reading')}</Text></View>}
          <Field placeholder={t('scan.namePh')} value={name} onChangeText={setName} />
          <Field placeholder={t('scan.brandPh')} value={brand} onChangeText={setBrand} />
          <Field multiline placeholder={t('scan.rawPh')} value={raw} onChangeText={setRaw} />
          {Platform.OS === 'ios' && <Text style={s.small}>{t('scan.tip')}</Text>}
          <Button title={t('scan.check')} busy={busy} disabled={!raw.trim()} onPress={() => save(
            { name: name.trim() || t('scan.untitled'), brand: brand.trim(), raw, barcode: code.trim() }, fromPhoto ? 'photo' : 'manual', !!code.trim())} />
        </>
      )}
      <Text style={[s.small, { color: C.faint, textAlign: 'center' }]}>{t('disclaimer')}</Text>
    </ScrollView>
  )
}
