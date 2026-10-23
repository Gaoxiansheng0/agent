// PearlKin design system: calm neutrals, black primary actions, a pearl gradient reserved for AI moments.
import { LinearGradient } from 'expo-linear-gradient'
import type { ReactNode } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native'
import Svg, { Circle, Defs, Stop, LinearGradient as SvgGradient } from 'react-native-svg'
import { type Severity } from '../../../engine/engine'
import { useI18n } from './i18n'

export const C = {
  bg: '#F6F4F0', surface: '#FFFFFF', ink: '#121212', sub: '#6E6C68', faint: '#A19E98', line: '#E9E5DE', fill: '#EFEBE5',
  good: '#2E9B6B', care: '#D2911B', bad: '#E0623F', doctor: '#4A74D6', danger: '#C8442F',
  // Kept for screens written against the earlier palette.
  card: '#FFFFFF', muted: '#6E6C68', brand: '#121212',
}
export const PEARL = ['#D8CCFF', '#C3E6F2', '#F7E3D2'] as const // lavender -> aqua -> peach

export const fmtDate = (ts: number, lang: string) => new Date(ts).toLocaleDateString(lang, { month: 'short', day: 'numeric', year: 'numeric' })

/** Score 0-100 (higher = healthier skin) -> color. */
export const scoreColor = (n: number) => (n >= 85 ? C.good : n >= 65 ? '#7FA33A' : n >= 40 ? C.care : C.bad)

// Plan 1.3: four verdicts only, no "toxic / safe / dangerous". Labels are in i18n.tsx ("v.good" ...).
export const VERDICT: Record<Severity | 'unsupported', { emoji: string; color: string }> = {
  good: { emoji: '✓', color: C.good },
  care: { emoji: '!', color: C.care },
  not_recommended: { emoji: '✕', color: C.bad },
  ask_doctor: { emoji: '?', color: C.doctor },
  unsupported: { emoji: '…', color: C.faint },
}

export function Chip({ severity, short }: { severity: keyof typeof VERDICT; short?: boolean }) {
  const { t } = useI18n()
  const v = VERDICT[severity]
  const label = t(`v.${severity}`)
  return (
    <View accessibilityLabel={label} style={[s.chip, { backgroundColor: v.color + '1A' }]}>
      <Text style={[s.chipText, { color: v.color }]}>{short ? v.emoji : `${v.emoji}  ${label}`}</Text>
    </View>
  )
}

export function Screen({ children, scroll = true, style }: { children: ReactNode; scroll?: boolean; style?: ViewStyle }) {
  if (!scroll) return <View style={[s.screen, s.pad, style]}>{children}</View>
  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.pad, { paddingBottom: 48 }, style]} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  )
}

export function Button({ title, onPress, kind = 'primary', style, busy, disabled, icon }: {
  title: string; onPress: () => void; kind?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'pearl'; style?: ViewStyle; busy?: boolean; disabled?: boolean; icon?: string
}) {
  const inner = busy ? <ActivityIndicator color={kind === 'primary' ? '#fff' : C.ink} /> : (
    <Text style={[s.btnText, kind !== 'primary' && { color: C.ink }, kind === 'danger' && { color: C.danger }]}>{icon ? `${icon}  ` : ''}{title}</Text>
  )
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={busy || disabled ? undefined : onPress}
      style={({ pressed }) => [s.btn, kind === 'secondary' && s.btnSecondary, (kind === 'ghost' || kind === 'danger') && s.btnGhost,
        kind === 'pearl' && { backgroundColor: 'transparent', overflow: 'hidden' }, { opacity: disabled ? 0.4 : pressed ? 0.82 : 1 }, style]}>
      {kind === 'pearl' && <LinearGradient colors={PEARL} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />}
      {inner}
    </Pressable>
  )
}

export function Toggle({ label, on, onPress, style }: { label: string; on: boolean; onPress: () => void; style?: ViewStyle }) {
  return (
    <Pressable accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{ checked: on }} onPress={onPress}
      style={[s.toggle, on && { backgroundColor: C.ink, borderColor: C.ink }, style]}>
      <Text style={{ color: on ? '#fff' : C.ink, fontWeight: '500', fontSize: 14 }}>{label}</Text>
    </Pressable>
  )
}

/** Large selectable row, used for questionnaire answers and photo conditions. */
export function Option({ title, detail, on, onPress }: { title: string; detail?: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={onPress}
      style={[s.option, on && { borderColor: C.ink, backgroundColor: C.surface }]}>
      <View style={{ flex: 1 }}>
        <Text style={[s.body, { fontWeight: '600' }]}>{title}</Text>
        {detail ? <Text style={s.small}>{detail}</Text> : null}
      </View>
      <View style={[s.radio, on && { borderColor: C.ink }]}>{on && <View style={s.radioDot} />}</View>
    </Pressable>
  )
}

export function Field(props: TextInputProps & { label?: string }) {
  return (
    <View style={{ gap: 6 }}>
      {props.label ? <Text style={s.label}>{props.label}</Text> : null}
      <TextInput placeholderTextColor={C.faint} {...props} style={[s.input, props.multiline && { minHeight: 120, textAlignVertical: 'top' }, props.style]} />
    </View>
  )
}

export function Card({ children, style, onPress }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void }) {
  if (onPress) return <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [s.card, { opacity: pressed ? 0.9 : 1 }, style]}>{children}</Pressable>
  return <View style={[s.card, style]}>{children}</View>
}

/** The "AI" mark: a small pearl-gradient pill. */
export function AiBadge({ label = 'AI' }: { label?: string }) {
  return (
    <View style={{ alignSelf: 'flex-start', borderRadius: 999, overflow: 'hidden' }}>
      <LinearGradient colors={PEARL} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ paddingHorizontal: 10, paddingVertical: 4 }}>
        <Text style={{ fontSize: 11, fontWeight: '700', letterSpacing: 0.6, color: C.ink }}>✦ {label}</Text>
      </LinearGradient>
    </View>
  )
}

export function ScoreRing({ score, size = 132, stroke = 10, label }: { score: number | null; size?: number; stroke?: number; label?: string }) {
  const r = (size - stroke) / 2, circ = 2 * Math.PI * r
  const pct = score == null ? 0 : Math.max(0, Math.min(100, score)) / 100
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Defs>
          <SvgGradient id="pearl" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#9C86F2" /><Stop offset="0.5" stopColor="#6FC2DB" /><Stop offset="1" stopColor="#E8A27E" />
          </SvgGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={C.fill} strokeWidth={stroke} fill="none" />
        <Circle cx={size / 2} cy={size / 2} r={r} stroke="url(#pearl)" strokeWidth={stroke} fill="none" strokeLinecap="round"
          strokeDasharray={`${circ} ${circ}`} strokeDashoffset={circ * (1 - pct)} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </Svg>
      <Text style={{ fontSize: size * 0.3, fontWeight: '700', color: C.ink, letterSpacing: -1 }}>{score ?? '–'}</Text>
      {label ? <Text style={[s.small, { marginTop: -2 }]}>{label}</Text> : null}
    </View>
  )
}

export function Bar({ value, color }: { value: number; color?: string }) {
  return (
    <View style={{ height: 6, borderRadius: 3, backgroundColor: C.fill, overflow: 'hidden' }}>
      <View style={{ width: `${Math.max(3, Math.min(100, value))}%`, height: '100%', borderRadius: 3, backgroundColor: color ?? scoreColor(value) }} />
    </View>
  )
}

export function Avatar({ name, size = 40, dark }: { name: string; size?: number; dark?: boolean }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: dark ? C.ink : C.fill, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontWeight: '700', fontSize: size * 0.42, color: dark ? '#fff' : C.ink }}>{(name.trim()[0] ?? '?').toUpperCase()}</Text>
    </View>
  )
}

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <View style={{ gap: 10, marginTop: 12 }}>
      <View style={[s.row, { justifyContent: 'space-between' }]}><Text style={s.h3}>{title}</Text>{action}</View>
      {children}
    </View>
  )
}

export const DISCLAIMER_STYLE = { fontSize: 12, color: C.faint, textAlign: 'center', marginVertical: 16 } as const

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  pad: { padding: 20, gap: 14 },
  card: { backgroundColor: C.surface, borderRadius: 20, padding: 18, gap: 10, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  hero: { fontSize: 34, fontWeight: '700', color: C.ink, letterSpacing: -1, lineHeight: 40 },
  h1: { fontSize: 28, fontWeight: '700', color: C.ink, letterSpacing: -0.6 },
  h2: { fontSize: 20, fontWeight: '700', color: C.ink, letterSpacing: -0.3 },
  h3: { fontSize: 17, fontWeight: '700', color: C.ink },
  body: { fontSize: 16, color: C.ink, lineHeight: 23 },
  muted: { fontSize: 14, color: C.sub, lineHeight: 20 },
  small: { fontSize: 13, color: C.sub, lineHeight: 18 },
  label: { fontSize: 12, color: C.sub, fontWeight: '600', letterSpacing: 0.8, textTransform: 'uppercase' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  input: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 13, fontSize: 16, color: C.ink },
  chip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' },
  chipText: { fontSize: 13, fontWeight: '700' },
  btn: { backgroundColor: C.ink, borderRadius: 999, paddingVertical: 16, paddingHorizontal: 22, alignItems: 'center', justifyContent: 'center', minHeight: 54 },
  btnSecondary: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.line },
  btnGhost: { backgroundColor: 'transparent', minHeight: 44, paddingVertical: 10 },
  btnText: { color: '#fff', fontWeight: '600', fontSize: 16, letterSpacing: 0.2 },
  toggle: { borderWidth: 1, borderColor: C.line, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: C.surface },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1.5, borderColor: C.line, borderRadius: 18, padding: 16, backgroundColor: C.bg },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.ink },
})
