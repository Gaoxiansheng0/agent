// Label photo -> ingredient list via our OCR proxy (server/ocr.ts). Only the photo is sent, never member data.
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import * as ImagePicker from 'expo-image-picker'
import { readLabelRemote, type LabelText } from './api'

export type { LabelText }

export async function pickLabelPhoto(source: 'camera' | 'library'): Promise<string | null> {
  if (source === 'camera' && !(await ImagePicker.requestCameraPermissionsAsync()).granted)
    throw Object.assign(new Error('camera-denied'), { code: 'camera-denied' })
  const pick = source === 'camera' ? ImagePicker.launchCameraAsync : ImagePicker.launchImageLibraryAsync
  const r = await pick({ mediaTypes: ['images'], quality: 1 })
  if (r.canceled) return null
  // Fine print needs resolution: 2000 px stays legible and under the model's 2576 px limit, ~1 MB as JPEG.
  const image = await ImageManipulator.manipulate(r.assets[0].uri, { maxWidth: 2000, maxHeight: 2000 }).renderAsync()
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.8, base64: true })
  return saved.base64 ?? null
}

export const readLabel = readLabelRemote
