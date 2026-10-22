import { router } from 'expo-router'
import { useState } from 'react'
import { ScrollView, Text, View } from 'react-native'
import { checkRoutine, DISCLAIMER, evaluate, normalize } from '../../../engine/engine'
import { pack, useStore } from '../lib/store'
import { Button, Chip, DISCLAIMER_STYLE, s, Toggle } from '../lib/ui'

export default function Routine() {
  const { members, products, routines, update } = useStore()
  const [memberId, setMemberId] = useState(members[0]?.id)
  const [time, setTime] = useState<'am' | 'pm'>('am')
  const member = members.find(m => m.id === memberId) ?? members[0]
  if (!member) return <Text style={[s.body, s.pad]}>Add your family first.</Text>

  const r = routines[member.id] ?? { am: [], pm: [] }
  const picked = r[time]
  const toggle = (pid: string) => update({
    routines: { ...routines, [member.id]: { ...r, [time]: picked.includes(pid) ? picked.filter(x => x !== pid) : [...picked, pid] } },
  })
  // Products this member uses come first; anything on the shelf can be added.
  const shelf = [...products].sort((a, b) => Number(b.usedBy.includes(member.id)) - Number(a.usedBy.includes(member.id)))
  const steps = picked.map(id => products.find(p => p.id === id)).filter(p => !!p).map(p => ({ name: p.name, inci: normalize(p.raw, pack).inci }))
  const issues = steps.length ? checkRoutine(steps, time, pack) : []

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad}>
      <View style={s.row}>
        {members.map(m => <Toggle key={m.id} label={m.nickname} on={m.id === member.id} onPress={() => setMemberId(m.id)} />)}
      </View>
      <View style={s.row}>
        <Toggle label="☀️ Morning" on={time === 'am'} onPress={() => setTime('am')} />
        <Toggle label="🌙 Evening" on={time === 'pm'} onPress={() => setTime('pm')} />
      </View>

      <Text style={s.h2}>Result</Text>
      {!steps.length ? (
        <Text style={s.muted}>Pick the products {member.nickname} uses in the {time === 'am' ? 'morning' : 'evening'}.</Text>
      ) : !issues.length ? (
        <View style={s.card}><Chip severity="good" /><Text style={s.body}>No duplicate actives, conflicts or missing steps found.</Text></View>
      ) : issues.map(i => (
        <View key={i.ruleId} style={s.card}>
          <Chip severity={i.severity} />
          <Text style={s.body}>{i.message}</Text>
          {i.products.length > 0 && <Text style={s.muted}>{i.products.join(' · ')}</Text>}
        </View>
      ))}

      <Text style={s.h2}>Steps ({picked.length})</Text>
      {!products.length && <Button title="Scan your first product" onPress={() => router.push('/scan')} />}
      {shelf.map(p => (
        <View key={p.id} style={[s.card, s.row, { justifyContent: 'space-between' }]}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={s.body}>{p.name}</Text>
            <Chip short severity={evaluate(normalize(p.raw, pack).inci, member, pack).severity} />
          </View>
          <Toggle label={picked.includes(p.id) ? 'In routine ✓' : 'Add'} on={picked.includes(p.id)} onPress={() => toggle(p.id)} />
        </View>
      ))}
      <Text style={DISCLAIMER_STYLE}>{DISCLAIMER}</Text>
    </ScrollView>
  )
}
