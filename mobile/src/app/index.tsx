import { Redirect, router } from 'expo-router'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { DISCLAIMER, evaluate, normalize } from '../../../engine/engine'
import { pack, useStore } from '../lib/store'
import { Button, C, Chip, DISCLAIMER_STYLE, s } from '../lib/ui'

export default function Home() {
  const { members, products } = useStore()
  if (!members.length) return <Redirect href="/family" />

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad}>
      <Pressable onPress={() => router.push('/family')} style={s.row} accessibilityRole="button">
        {members.map(m => <Text key={m.id} style={[s.chip, { backgroundColor: C.line, color: C.ink }]}>{m.nickname}</Text>)}
        <Text style={[s.muted, { color: C.brand }]}>Edit family</Text>
      </Pressable>

      <Button title="Scan a product" onPress={() => router.push('/scan')} />
      <Button title="Routine check" kind="secondary" onPress={() => router.push('/routine')} />

      <Text style={s.h2}>Family shelf · {products.length}</Text>
      {!products.length && <Text style={s.muted}>Nothing here yet. Scan the products in your bathroom to build your family shelf report.</Text>}
      {[...products].sort((a, b) => b.addedAt - a.addedAt).map(p => {
        const { inci } = normalize(p.raw, pack)
        return (
          <Pressable key={p.id} style={s.card} onPress={() => router.push(`/product/${p.id}`)} accessibilityRole="button">
            <Text style={[s.body, { fontWeight: '600' }]}>{p.name}</Text>
            {p.brand ? <Text style={s.muted}>{p.brand}</Text> : null}
            <View style={s.row}>
              {members.map(m => (
                <View key={m.id} style={[s.row, { gap: 4 }]}>
                  <Text style={s.muted}>{m.nickname}</Text>
                  <Chip short severity={evaluate(inci, m, pack).severity} />
                </View>
              ))}
            </View>
          </Pressable>
        )
      })}
      <Text style={DISCLAIMER_STYLE}>{DISCLAIMER}</Text>
    </ScrollView>
  )
}
