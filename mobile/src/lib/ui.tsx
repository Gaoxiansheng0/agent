import { Pressable, StyleSheet, Text, type ViewStyle } from 'react-native'
import { type Severity } from '../../../engine/engine'

export const C = {
  bg: '#faf6ef', card: '#fffdf9', ink: '#1f2a24', muted: '#5e6a63', line: '#e6dfd2', brand: '#2f5d4a', danger: '#a33',
}

// Plan 1.3: four verdicts only, no "toxic / safe / dangerous".
export const VERDICT: Record<Severity | 'unsupported', { label: string; emoji: string; color: string }> = {
  good: { label: 'Good fit', emoji: '✅', color: '#2f7a4f' },
  care: { label: 'Use with care', emoji: '🟡', color: '#a8740a' },
  not_recommended: { label: 'Not recommended for this age/stage', emoji: '🟠', color: '#b4531f' },
  ask_doctor: { label: 'Ask your doctor', emoji: '🔵', color: '#2f5f9e' },
  unsupported: { label: 'Coming soon for this age', emoji: '⏳', color: '#8a8f8c' },
}

export function Chip({ severity, short }: { severity: keyof typeof VERDICT; short?: boolean }) {
  const v = VERDICT[severity]
  return (
    <Text style={[s.chip, { backgroundColor: v.color }]} accessibilityLabel={v.label}>
      {short ? v.emoji : `${v.emoji} ${v.label}`}
    </Text>
  )
}

export function Button({ title, onPress, kind = 'primary', style }: { title: string; onPress: () => void; kind?: 'primary' | 'secondary' | 'danger'; style?: ViewStyle }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress}
      style={({ pressed }) => [s.btn, kind !== 'primary' && s.btnSecondary, { opacity: pressed ? 0.7 : 1 }, style]}>
      <Text style={[s.btnText, kind === 'secondary' && { color: C.brand }, kind === 'danger' && { color: C.danger }]}>{title}</Text>
    </Pressable>
  )
}

export function Toggle({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{ checked: on }} onPress={onPress}
      style={[s.toggle, on && { backgroundColor: C.brand, borderColor: C.brand }]}>
      <Text style={{ color: on ? '#fff' : C.ink, fontWeight: '500' }}>{label}</Text>
    </Pressable>
  )
}

export const DISCLAIMER_STYLE = { fontSize: 12, color: C.muted, textAlign: 'center', marginVertical: 16 } as const

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  pad: { padding: 16, gap: 12 },
  card: { backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 14, padding: 14, gap: 8 },
  h1: { fontSize: 26, fontWeight: '700', color: C.ink },
  h2: { fontSize: 18, fontWeight: '700', color: C.ink, marginTop: 8 },
  body: { fontSize: 15, color: C.ink, lineHeight: 21 },
  muted: { fontSize: 13, color: C.muted, lineHeight: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 12, fontSize: 16, color: C.ink },
  chip: { color: '#fff', fontSize: 13, fontWeight: '600', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, overflow: 'hidden', alignSelf: 'flex-start' },
  btn: { backgroundColor: C.brand, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 18, alignItems: 'center' },
  btnSecondary: { backgroundColor: 'transparent', borderWidth: 1, borderColor: C.line },
  btnText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  toggle: { borderWidth: 1, borderColor: C.line, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: '#fff' },
})
