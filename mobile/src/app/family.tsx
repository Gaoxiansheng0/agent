import { router } from 'expo-router'
import { useState } from 'react'
import { Alert, Platform, ScrollView, Text, TextInput, View } from 'react-native'
import { ageBandOf, SUPPORTED_BANDS, type LifeStage, type Member } from '../../../engine/engine'
import { newId, useStore } from '../lib/store'
import { Button, s, Toggle } from '../lib/ui'

const MAX_MEMBERS = 6
const CONCERNS = [{ id: 'sensitive', label: 'Sensitive skin' }, { id: 'acne_prone', label: 'Acne-prone' }]
const STAGES: { id: LifeStage; label: string }[] = [{ id: 'pregnancy', label: 'Pregnant' }, { id: 'breastfeeding', label: 'Breastfeeding' }]
const blank = (): Member => ({ id: newId(), nickname: '', concerns: [] })

const confirm = (msg: string, ok: () => void) =>
  Platform.OS === 'web' ? (window.confirm(msg) && ok()) : Alert.alert(msg, undefined, [{ text: 'Cancel' }, { text: 'Delete', style: 'destructive', onPress: ok }])

export default function Family() {
  const { members, routines, products, update } = useStore()
  const [draft, setDraft] = useState<Member | null>(members.length ? null : blank())
  const thisYear = new Date().getFullYear()

  const save = () => {
    if (!draft) return
    const year = Number(draft.birthYear)
    if (!draft.nickname.trim() || !year || year < 1900 || year > thisYear) return Alert.alert('Add a nickname and a birth year.')
    const m = { ...draft, nickname: draft.nickname.trim(), birthYear: year }
    update({ members: members.some(x => x.id === m.id) ? members.map(x => (x.id === m.id ? m : x)) : [...members, m] })
    setDraft(null)
  }

  const remove = (m: Member) => confirm(`Remove ${m.nickname}?`, () => {
    const { [m.id]: _, ...rest } = routines
    update({
      members: members.filter(x => x.id !== m.id),
      routines: rest,
      products: products.map(p => ({ ...p, usedBy: p.usedBy.filter(id => id !== m.id) })),
    })
    setDraft(null)
  })

  const band = draft?.birthYear ? ageBandOf({ ...draft, birthYear: Number(draft.birthYear) }) : null

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad} keyboardShouldPersistTaps="handled">
      {!members.length && (
        <View style={{ gap: 6 }}>
          <Text style={s.h1}>One scan, every person in your family.</Text>
          <Text style={s.body}>Add the people who share your bathroom shelf. Use a nickname. Everything you enter stays on this phone.</Text>
        </View>
      )}

      {members.map(m => (
        <View key={m.id} style={[s.card, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}>
          <View style={{ flex: 1 }}>
            <Text style={[s.body, { fontWeight: '600' }]}>{m.nickname}</Text>
            <Text style={s.muted}>
              {[ageBandOf(m), m.lifeStage, ...(m.concerns ?? []).map(c => c.replace('_', '-'))].filter(Boolean).join(' · ')}
            </Text>
          </View>
          <Button title="Edit" kind="secondary" onPress={() => setDraft({ ...m })} />
        </View>
      ))}

      {draft ? (
        <View style={s.card}>
          <Text style={s.h2}>{members.some(x => x.id === draft.id) ? 'Edit member' : 'Add a family member'}</Text>
          <TextInput style={s.input} placeholder="Nickname (e.g. Maya, Me)" value={draft.nickname} maxLength={20}
            onChangeText={nickname => setDraft({ ...draft, nickname })} />
          <TextInput style={s.input} placeholder="Birth year (e.g. 2015)" keyboardType="number-pad" maxLength={4}
            value={draft.birthYear ? String(draft.birthYear) : ''} onChangeText={t => setDraft({ ...draft, birthYear: t ? Number(t) : undefined })} />
          {band && !SUPPORTED_BANDS.includes(band) && (
            <Text style={s.muted}>Ages 0–7 are coming soon. You can add them now and they'll get results once supported.</Text>
          )}
          <Text style={s.muted}>Life stage (optional)</Text>
          <View style={s.row}>
            {STAGES.map(st => (
              <Toggle key={st.id} label={st.label} on={draft.lifeStage === st.id}
                onPress={() => setDraft({ ...draft, lifeStage: draft.lifeStage === st.id ? undefined : st.id })} />
            ))}
          </View>
          <Text style={s.muted}>Skin concerns (optional)</Text>
          <View style={s.row}>
            {CONCERNS.map(c => {
              const on = !!draft.concerns?.includes(c.id)
              return <Toggle key={c.id} label={c.label} on={on}
                onPress={() => setDraft({ ...draft, concerns: on ? draft.concerns!.filter(x => x !== c.id) : [...(draft.concerns ?? []), c.id] })} />
            })}
          </View>
          <Button title="Save" onPress={save} />
          {members.some(x => x.id === draft.id) && <Button title="Remove member" kind="danger" onPress={() => remove(draft)} />}
          {members.length > 0 && <Button title="Cancel" kind="secondary" onPress={() => setDraft(null)} />}
        </View>
      ) : (
        <>
          {members.length < MAX_MEMBERS && <Button title="+ Add family member" kind="secondary" onPress={() => setDraft(blank())} />}
          <Button title={members.length ? 'Done' : 'Continue'} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
        </>
      )}
    </ScrollView>
  )
}
