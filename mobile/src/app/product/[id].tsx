import { router, useLocalSearchParams } from 'expo-router'
import { Linking, ScrollView, Text, View } from 'react-native'
import { DISCLAIMER, evaluate, normalize } from '../../../../engine/engine'
import { pack, useStore } from '../../lib/store'
import { Button, C, Chip, DISCLAIMER_STYLE, s, Toggle } from '../../lib/ui'

const groupsOf = (inci: string) => pack.groups.filter(g => g.id !== 'base' && g.members.includes(inci))

export default function ProductResult() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { products, members, routines, update } = useStore()
  const p = products.find(x => x.id === id)
  if (!p) return <View style={s.screen}><Text style={[s.body, s.pad]}>This product was removed.</Text></View>

  const { inci, unknown } = normalize(p.raw, pack)
  const setUsedBy = (memberId: string) => update({
    products: products.map(x => x.id !== p.id ? x : { ...x, usedBy: x.usedBy.includes(memberId) ? x.usedBy.filter(m => m !== memberId) : [...x.usedBy, memberId] }),
  })
  const remove = () => {
    router.back()
    update({
      products: products.filter(x => x.id !== p.id),
      routines: Object.fromEntries(Object.entries(routines).map(([m, r]) => [m, { am: r.am.filter(x => x !== p.id), pm: r.pm.filter(x => x !== p.id) }])),
    })
  }
  const report = () => Linking.openURL(`mailto:hello@pearlwren.com?subject=${encodeURIComponent(`Report: ${p.name}`)}&body=${encodeURIComponent(
    `Product: ${p.name}\nBarcode: ${p.barcode ?? '-'}\nRule pack: ${pack.version}\n\nWhat looks wrong?\n`)}`)

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad}>
      <View>
        <Text style={s.h1}>{p.name}</Text>
        <Text style={s.muted}>{[p.brand, p.barcode ? `Barcode ${p.barcode}` : null].filter(Boolean).join(' · ')}</Text>
      </View>

      {members.map(m => {
        const v = evaluate(inci, m, pack)
        return (
          <View key={m.id} style={s.card}>
            <View style={[s.row, { justifyContent: 'space-between' }]}>
              <Text style={[s.body, { fontWeight: '700' }]}>{m.nickname}</Text>
              <Toggle label={p.usedBy.includes(m.id) ? 'Uses this ✓' : 'Uses this?'} on={p.usedBy.includes(m.id)} onPress={() => setUsedBy(m.id)} />
            </View>
            <Chip severity={v.severity} />
            {v.severity === 'unsupported' && <Text style={s.muted}>Rules for ages 0–7 are coming soon.</Text>}
            {v.severity === 'good' && <Text style={s.muted}>Nothing in our current rules flags this product for {m.nickname}.</Text>}
            {v.reasons.map(r => (
              <View key={r.ruleId} style={{ gap: 2, borderTopWidth: 1, borderTopColor: C.line, paddingTop: 8 }}>
                <Text style={s.body}>{r.message}</Text>
                {r.ingredients.length > 0 && <Text style={s.muted}>Because of: {r.ingredients.join(', ')}</Text>}
                {r.sources.map(src => <Text key={src.org + src.ref} style={[s.muted, { fontSize: 11 }]}>Source: {src.org}</Text>)}
              </View>
            ))}
          </View>
        )
      })}

      <Text style={s.h2}>Ingredients ({inci.length})</Text>
      <View style={s.card}>
        {inci.map(i => {
          const gs = groupsOf(i)
          return (
            <Text key={i} style={s.body}>
              {i}{gs.length ? <Text style={s.muted}>  ·  {gs.flatMap(g => g.functions ?? []).join(', ')}</Text> : null}
            </Text>
          )
        })}
        {unknown.length > 0 && (
          <Text style={s.muted}>Not recognized yet (doesn't change the result): {unknown.join(', ')}</Text>
        )}
      </View>

      <Button title="Report a problem" kind="secondary" onPress={report} />
      <Button title="Remove from shelf" kind="danger" onPress={remove} />
      <Text style={DISCLAIMER_STYLE}>{DISCLAIMER} Rule pack v{pack.version}.</Text>
    </ScrollView>
  )
}
