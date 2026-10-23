// Prepares a face photo for analysis: resized to 1024 px (enough detail for pores and fine lines, ~200 KB as JPEG).
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import * as ImagePicker from 'expo-image-picker'

export async function prepareFace(uri: string): Promise<{ base64: string; uri: string }> {
  const image = await ImageManipulator.manipulate(uri).resize({ width: 1024 }).renderAsync()
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.85, base64: true })
  return { base64: saved.base64 ?? '', uri: saved.uri }
}

export async function pickFaceFromLibrary() {
  const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 })
  return r.canceled ? null : prepareFace(r.assets[0].uri)
}
