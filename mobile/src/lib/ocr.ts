// Label photo -> ingredient list via our OCR proxy (server/server.ts). Only the photo is sent, never member data.
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import * as ImagePicker from 'expo-image-picker'

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3001'
// Ships inside the app bundle, so it only stops casual abuse; the real gate is the subscription check (plan 7.1).
const APP_TOKEN = process.env.EXPO_PUBLIC_APP_TOKEN ?? ''

export type LabelText = { found: boolean; product_name: string; ingredients: string[]; unreadable: boolean }

export async function pickLabelPhoto(source: 'camera' | 'library'): Promise<string | null> {
  if (source === 'camera' && !(await ImagePicker.requestCameraPermissionsAsync()).granted)
    throw new Error('Allow camera access in Settings to photograph the label.')
  const pick = source === 'camera' ? ImagePicker.launchCameraAsync : ImagePicker.launchImageLibraryAsync
  const r = await pick({ mediaTypes: ['images'], quality: 1 })
  if (r.canceled) return null
  // Fine print needs resolution: 2000 px stays legible and under the model's 2576 px limit, ~1 MB as JPEG.
  const image = await ImageManipulator.manipulate(r.assets[0].uri, { maxWidth: 2000, maxHeight: 2000 }).renderAsync()
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.8, base64: true })
  return saved.base64 ?? null
}

export async function readLabel(base64: string): Promise<LabelText> {
  const res = await fetch(`${API_URL}/api/ocr`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-app-token': APP_TOKEN },
    body: JSON.stringify({ image: base64, media_type: 'image/jpeg' }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error ?? "Couldn't read the label. Check your connection and try again.")
  return body
}
