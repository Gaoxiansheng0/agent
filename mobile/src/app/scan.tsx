import { CameraView, useCameraPermissions } from 'expo-camera'
import { router } from 'expo-router'
import { useRef, useState } from 'react'
import { ActivityIndicator, Platform, ScrollView, Text, TextInput, View } from 'react-native'
import { pickLabelPhoto, readLabel } from '../lib/ocr'
import { newId, useStore, type Product } from '../lib/store'
import { Button, s, Toggle } from '../lib/ui'

// Only the barcode leaves the phone; no member data is sent (plan 5.2).
// ponytail: calls Open Beauty Facts directly; move behind our own product DB once it exists (plan 5.3).
async function lookup(code: string) {
  const res = await fetch(`https://world.openbeautyfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=product_name,brands,ingredients_text_en,ingredients_text`)
  const j = await res.json()
  const raw = j.status === 1 ? j.product.ingredients_text_en || j.product.ingredients_text : ''
  return raw ? { name: j.product.product_name || `Product ${code}`, brand: j.product.brands, raw } : null
}

const SAMPLE = { name: 'Overnight Glow Serum (sample)', raw: 'Aqua, Glycerin, Retinol, Glycolic Acid, Parfum, Sodium Hyaluronate' }

export default function Scan() {
  const { products, update } = useStore()
  const [mode, setMode] = useState<'barcode' | 'label'>('barcode')
  const [permission, requestPermission] = useCameraPermissions()
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [raw, setRaw] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const scanning = useRef(false)

  const save = (p: Omit<Product, 'id' | 'usedBy' | 'addedAt'>) => {
    const product = { ...p, id: newId(), usedBy: [], addedAt: Date.now() }
    update({ products: [...products, product] })
    router.replace(`/product/${product.id}`)
  }

  const find = async (barcode: string) => {
    if (scanning.current || !barcode.trim()) return
    scanning.current = true
    setBusy(true)
    setNote('')
    try {
      const hit = await lookup(barcode.trim())
      if (hit) return save({ ...hit, barcode: barcode.trim() })
      setCode(barcode.trim())
      setMode('label') // plan 2.1: barcode miss -> ingredient list
      setNote("We don't have this product yet. Add its ingredient list below and we'll check it.")
    } catch {
      setNote("Couldn't reach the product database. Check your connection, or add the ingredient list below.")
      setMode('label')
    } finally {
      setBusy(false)
      scanning.current = false
    }
  }

  // Plan R5: the photo only fills the text box; the user checks it against the label before saving.
  const photo = async (source: 'camera' | 'library') => {
    setNote('')
    try {
      const image = await pickLabelPhoto(source)
      if (!image) return
      setBusy(true)
      const label = await readLabel(image)
      if (!label.found || !label.ingredients.length) return setNote('No ingredient list found in this photo. Try a closer, well-lit shot of the label.')
      setRaw(label.ingredients.join(', '))
      if (!name.trim() && label.product_name) setName(label.product_name)
      setNote(label.unreadable
        ? 'Part of the label was hard to read. Compare the list with the bottle and fix anything missing before checking.'
        : 'Compare the list with the label and fix anything misread, then tap "Check this product".')
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Couldn't read the label.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad} keyboardShouldPersistTaps="handled">
      <View style={s.row}>
        <Toggle label="Barcode" on={mode === 'barcode'} onPress={() => setMode('barcode')} />
        <Toggle label="Ingredient list" on={mode === 'label'} onPress={() => setMode('label')} />
      </View>

      {note ? <Text style={[s.body, { fontWeight: '500' }]}>{note}</Text> : null}

      {mode === 'barcode' ? (
        <>
          {permission?.granted ? (
            <View style={{ height: 260, borderRadius: 14, overflow: 'hidden', backgroundColor: '#000' }}>
              <CameraView style={{ flex: 1 }} facing="back"
                barcodeScannerSettings={{ barcodeTypes: ['ean13', 'upc_a', 'upc_e', 'ean8'] }}
                onBarcodeScanned={busy ? undefined : r => find(r.data)} />
            </View>
          ) : (
            <View style={[s.card, { alignItems: 'center' }]}>
              <Text style={s.muted}>Point your camera at the barcode on the bottle or box.</Text>
              <Button title="Allow camera" onPress={requestPermission} />
            </View>
          )}
          {busy && <ActivityIndicator />}
          <Text style={s.muted}>Or type the barcode number:</Text>
          <View style={[s.row, { flexWrap: 'nowrap' }]}>
            <TextInput style={[s.input, { flex: 1 }]} placeholder="e.g. 3337875597197" keyboardType="number-pad"
              value={code} onChangeText={setCode} onSubmitEditing={() => find(code)} />
            <Button title="Look up" onPress={() => find(code)} />
          </View>
        </>
      ) : (
        <>
          <View style={[s.row, { flexWrap: 'nowrap' }]}>
            <Button title="📷 Photo of label" style={{ flex: 1 }} onPress={() => photo('camera')} />
            <Button title="Choose photo" kind="secondary" style={{ flex: 1 }} onPress={() => photo('library')} />
          </View>
          {busy && <View style={[s.row, { justifyContent: 'center' }]}><ActivityIndicator /><Text style={s.muted}>Reading the label…</Text></View>}
          <TextInput style={s.input} placeholder="Product name" value={name} onChangeText={setName} />
          <TextInput style={[s.input, { minHeight: 160, textAlignVertical: 'top' }]} multiline
            placeholder="Ingredients: Aqua, Glycerin, ..." value={raw} onChangeText={setRaw} />
          {Platform.OS === 'ios' && (
            <Text style={s.muted}>Tip: tap the box above, then tap "Scan Text" to read the label with your camera.</Text>
          )}
          <Button title="Check this product" onPress={() => raw.trim() && save({ name: name.trim() || 'Untitled product', raw, barcode: code || undefined })} />
        </>
      )}

      <Button title="Try a sample product" kind="secondary" onPress={() => save(SAMPLE)} />
    </ScrollView>
  )
}
