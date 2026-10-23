import { router, useLocalSearchParams } from 'expo-router'
import { ScrollView, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { evaluate, normalize, type Pack } from '../../../../engine/engine'
import { fnLabel, msg, useI18n } from '../../lib/i18n'
import { engineMember, latestFor, useStore } from '../../lib/store'
import { Avatar, Button, C, Card, Chip, DISCLAIMER_STYLE, s, Section, Toggle } from '../../lib/ui'

const groupsOf = (pack: Pack, inci: string) => pack.groups.filter(g => g.id !== 'base' && g.members.includes(inci))
const join = (lang: string, items: string[]) => items.join(lang.startsWith('zh') ? '、' : ', ')
// Chinese UI: show the standard Chinese name from the rule pack's aliases next to the INCI name.
const zhNames = new WeakMap<Pack, Map<string, string>>()
function zhName(pack: Pack, inci: string) {
  let m = zhNames.get(pack)
  if (!m) {
    m = new Map()
    for (const [name, target] of Object.entries(pack.aliases)) if (/[一-鿿]/.test(name) && !m.has(target)) m.set(target, name)
    zhNames.set(pack, m)
  }
  return m.get(inci)
}

export default function ProductDetail() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { products, members, reports, pack, pro, config, saveProduct, deleteProduct } = useStore()
  const { t, lang } = useI18n()
  const insets = useSafeAreaInsets()
  const p = products.find(x => x.id === id)
  if (!p) return <View style={[s.screen, s.pad, { paddingTop: insets.top + 80 }]}><Text style={s.body}>{t('prod.removed')}</Text></View>

  const { inci, unknown } = normalize(p.raw, pack)
  const showReasons = pro || !config.paywallEnabled
  const toggleUser = (mid: string) => void saveProduct({ ...p, used_by: p.used_by.includes(mid) ? p.used_by.filter(x => x !== mid) : [...p.used_by, mid] }).catch(() => {})
  const remove = async () => { router.back(); await deleteProduct(p.id).catch(() => {}) }

  return (
    <ScrollView style={s.screen} contentContainerStyle={{ paddingTop: insets.top + 56, paddingHorizontal: 20, paddingBottom: 48, gap: 14 }}>
      <View style={{ gap: 4 }}>
        <Text style={s.h1}>{p.name}</Text>
        <Text style={s.small}>{[p.brand, p.barcode ? t('prod.barcode', { code: p.barcode }) : null].filter(Boolean).join(' · ')}</Text>
      </View>

      <Section title={t('prod.fit')}>
        {members.map(m => {
          const v = evaluate(inci, engineMember(m, latestFor(reports, m.id)), pack)
          const uses = p.used_by.includes(m.id)
          return (
            <Card key={m.id}>
              <View style={[s.row, { justifyContent: 'space-between', flexWrap: 'nowrap' }]}>
                <View style={[s.row, { gap: 10, flex: 1 }]}>
                  <Avatar name={m.name} size={34} dark={m.is_self} />
                  <Text style={[s.body, { fontWeight: '700' }]}>{m.is_self ? t('fam.you') : m.name}</Text>
                </View>
                <Toggle label={uses ? `${t('prod.uses')} ✓` : t('prod.uses')} on={uses} onPress={() => toggleUser(m.id)} />
              </View>
              <Chip severity={v.severity} />
              {v.severity === 'unsupported' && <Text style={s.small}>{t('prod.under8')}</Text>}
              {v.severity === 'good' && <Text style={s.small}>{t('prod.goodFor', { name: m.is_self ? t('fam.you') : m.name })}</Text>}
              {!showReasons && v.reasons.length > 0 ? (
                <Text style={[s.small, { color: C.ink, fontWeight: '600' }]} onPress={() => router.push('/paywall?trigger=reasons')} accessibilityRole="button">
                  🔒 {t('prod.seeWhy', { n: v.reasons.length })} ›
                </Text>
              ) : v.reasons.map(r => (
                <View key={r.ruleId} style={{ gap: 3, borderTopWidth: 1, borderTopColor: C.line, paddingTop: 10 }}>
                  <Text style={s.body}>{msg(pack, lang, r.messageKey)}</Text>
                  {r.ingredients.length > 0 && <Text style={s.small}>{t('prod.because', { list: join(lang, r.ingredients) })}</Text>}
                  {r.sources.map(src => <Text key={src.org + src.ref} style={[s.small, { fontSize: 11, color: C.faint }]}>{t('prod.source', { org: src.org })}</Text>)}
                </View>
              ))}
            </Card>
          )
        })}
      </Section>

      <Section title={t('prod.ingredients', { n: inci.length })}>
        <Card style={{ gap: 6 }}>
          {inci.map(i => {
            const gs = groupsOf(pack, i)
            return (
              <Text key={i} style={s.body}>
                {lang.startsWith('zh') && zhName(pack, i) ? `${zhName(pack, i)} · ` : ''}{i}{gs.length ? <Text style={s.small}>  ·  {join(lang, gs.flatMap(g => g.functions ?? []).map(f => fnLabel(t, f)))}</Text> : null}
              </Text>
            )
          })}
          {unknown.length > 0 && <Text style={[s.small, { color: C.faint }]}>{t('prod.unknown', { list: join(lang, unknown) })}</Text>}
        </Card>
      </Section>

      <Button kind="secondary" title={t('prod.report')} onPress={() => router.push(`/feedback/${p.id}`)} />
      <Button kind="danger" title={t('prod.remove')} onPress={remove} />
      <Text style={DISCLAIMER_STYLE}>{t('disclaimer')} {t('prod.packVersion', { v: pack.version })}</Text>
    </ScrollView>
  )
}
