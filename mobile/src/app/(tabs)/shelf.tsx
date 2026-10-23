import { router } from 'expo-router'
import { useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { evaluate, normalize } from '../../../../engine/engine'
import { useI18n } from '../../lib/i18n'
import { engineMember, latestFor, useStore } from '../../lib/store'
import { AiBadge, Avatar, Button, C, Card, Chip, s } from '../../lib/ui'

export default function Shelf() {
  const { t } = useI18n()
  const { members, products, reports, pack } = useStore()
  const insets = useSafeAreaInsets()
  const self = members.find(m => m.is_self) ?? members[0]
  const [selected, setSelected] = useState(self?.id)
  const member = members.find(m => m.id === selected) ?? self
  if (!member) return null
  const em = engineMember(member, latestFor(reports, member.id))
  const names = (ids: string[]) => members.filter(m => ids.includes(m.id)).map(m => (m.is_self ? t('fam.you') : m.name)).join(', ')

  return (
    <ScrollView style={s.screen} contentContainerStyle={{ paddingTop: insets.top + 16, paddingHorizontal: 20, paddingBottom: 40, gap: 16 }}>
      <View style={{ gap: 4 }}>
        <Text style={s.h1}>{t('shelf.title')}</Text>
        <Text style={s.muted}>{t('shelf.sub')}</Text>
      </View>

      <View style={{ gap: 8 }}>
        <Text style={s.label}>{t('shelf.fitFor')}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
          {members.map(m => (
            <Pressable key={m.id} onPress={() => setSelected(m.id)} accessibilityRole="tab" accessibilityState={{ selected: m.id === member.id }}
              style={[s.row, { gap: 8, paddingRight: 14, paddingLeft: 4, paddingVertical: 4, borderRadius: 999, backgroundColor: m.id === member.id ? C.ink : C.surface }]}>
              <Avatar name={m.name} size={30} dark={m.id !== member.id} />
              <Text style={{ fontWeight: '600', color: m.id === member.id ? '#fff' : C.ink }}>{m.is_self ? t('fam.you') : m.name}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {products.length > 0 && (
        <Card onPress={() => router.push(`/advice/${member.id}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ flex: 1, gap: 6 }}>
            <AiBadge />
            <Text style={s.h3}>{t('shelf.plan', { name: member.is_self ? t('fam.you') : member.name })}</Text>
            <Text style={s.small}>{t('shelf.planSub')}</Text>
          </View>
          <Text style={{ fontSize: 22, color: C.faint }}>›</Text>
        </Card>
      )}

      <Button title={t('shelf.add')} onPress={() => router.push('/add-product')} icon="+" />

      {!products.length && <Card><Text style={s.muted}>{t('shelf.empty')}</Text></Card>}
      {products.map(p => {
        const v = evaluate(normalize(p.raw, pack).inci, em, pack)
        return (
          <Card key={p.id} onPress={() => router.push(`/product/${p.id}`)} style={{ gap: 8 }}>
            <View style={[s.row, { justifyContent: 'space-between', flexWrap: 'nowrap' }]}>
              <View style={{ flex: 1 }}>
                <Text style={[s.body, { fontWeight: '600' }]} numberOfLines={1}>{p.name}</Text>
                {p.brand ? <Text style={s.small} numberOfLines={1}>{p.brand}</Text> : null}
              </View>
              <Chip severity={v.severity} />
            </View>
            <Text style={[s.small, { color: C.faint }]}>{p.used_by.length ? t('shelf.usedBy', { names: names(p.used_by) }) : t('shelf.nobody')}</Text>
          </Card>
        )
      })}
    </ScrollView>
  )
}
