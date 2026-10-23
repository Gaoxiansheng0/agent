import { CameraView, useCameraPermissions } from 'expo-camera'
import { Redirect, router } from 'expo-router'
import { useRef, useState } from 'react'
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useI18n } from '../../lib/i18n'
import { pickFaceFromLibrary, prepareFace } from '../../lib/photo'
import { skinTest } from '../../lib/skinTest'
import { useStore } from '../../lib/store'
import { Button, C, s } from '../../lib/ui'

// Step 1: the selfie. A face-shaped guide keeps photos consistent from test to test.
export default function Camera() {
  const { t } = useI18n()
  const { members } = useStore()
  const insets = useSafeAreaInsets()
  const [permission, requestPermission] = useCameraPermissions()
  const camera = useRef<CameraView>(null)
  const [photo, setPhoto] = useState<{ base64: string; uri: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const session = skinTest.get()
  const member = members.find(m => m.id === session?.memberId)
  if (!session || !member) return <Redirect href="/" />

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'))
  const snap = async () => {
    if (!camera.current || busy) return
    setBusy(true)
    try {
      const shot = await camera.current.takePictureAsync({ quality: 0.92 })
      if (shot?.uri) setPhoto(await prepareFace(shot.uri))
    } finally { setBusy(false) }
  }
  const library = async () => {
    setBusy(true)
    try { const p = await pickFaceFromLibrary(); if (p) setPhoto(p) } finally { setBusy(false) }
  }
  const use = () => {
    if (!photo) return
    skinTest.set({ image: photo.base64, preview: photo.uri })
    router.push('/test/conditions')
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      {photo ? (
        <Image source={{ uri: photo.uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : permission?.granted ? (
        <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="front" mirror />
      ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: C.bg, padding: 32, justifyContent: 'center', gap: 16 }]}>
          <Text style={s.h2}>{t('test.cameraTitle')}</Text>
          <Text style={s.body}>{t('test.cameraNeed')}</Text>
          <Button title={t('test.allow')} onPress={requestPermission} />
          <Button kind="secondary" title={t('test.library')} onPress={library} busy={busy} />
        </View>
      )}

      {(permission?.granted || photo) && (
        <>
          {/* Face guide: an oval cut-out over a dimmed frame. */}
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
            <View style={{ width: '72%', aspectRatio: 0.76, borderRadius: 999, borderWidth: 2.5, borderColor: photo ? '#C3E6F2' : 'rgba(255,255,255,0.85)' }} />
          </View>
          <View style={{ position: 'absolute', top: insets.top + 12, left: 20, right: 20, gap: 6, alignItems: 'center' }}>
            <Text style={{ color: '#fff', fontSize: 13, opacity: 0.8 }}>{t('test.for', { name: member.name })}</Text>
            <Text style={{ color: '#fff', fontSize: 22, fontWeight: '700' }}>{t('test.cameraTitle')}</Text>
            <Text style={{ color: '#fff', fontSize: 14, opacity: 0.85 }}>{t('test.cameraTips')}</Text>
          </View>
          <Pressable onPress={close} accessibilityRole="button" accessibilityLabel={t('common.cancel')} hitSlop={12}
            style={{ position: 'absolute', top: insets.top + 12, right: 20 }}>
            <Text style={{ color: '#fff', fontSize: 26 }}>×</Text>
          </Pressable>

          <View style={{ position: 'absolute', bottom: insets.bottom + 28, left: 24, right: 24, gap: 14 }}>
            {photo ? (
              <View style={[s.row, { flexWrap: 'nowrap' }]}>
                <Button kind="secondary" title={t('test.retake')} onPress={() => setPhoto(null)} style={{ flex: 1 }} />
                <Button title={t('test.usePhoto')} onPress={use} style={{ flex: 1.4 }} />
              </View>
            ) : (
              <View style={{ alignItems: 'center', gap: 18 }}>
                <Pressable onPress={snap} accessibilityRole="button" accessibilityLabel={t('test.snap')}
                  style={({ pressed }) => ({ width: 78, height: 78, borderRadius: 39, borderWidth: 4, borderColor: '#fff', alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.7 : 1 })}>
                  {busy ? <ActivityIndicator color="#fff" /> : <View style={{ width: 62, height: 62, borderRadius: 31, backgroundColor: '#fff' }} />}
                </Pressable>
                <Text style={{ color: '#fff', fontWeight: '600' }} onPress={library}>{t('test.library')}</Text>
              </View>
            )}
          </View>
        </>
      )}
    </View>
  )
}
