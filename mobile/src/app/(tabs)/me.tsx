import { router } from 'expo-router'
import { useState } from 'react'
import { Alert, Linking, Platform, ScrollView, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { APP_VERSION, SITE_URL } from '../../lib/api'
import { deviceLang, LANGS, useI18n } from '../../lib/i18n'
import { manageSubscription, redeemCode, restorePurchases, storeAvailable } from '../../lib/purchases'
import { useStore } from '../../lib/store'
import { Button, C, Card, s, Section, Toggle } from '../../lib/ui'

export default function Me() {
  const { t, setting, setSetting } = useI18n()
  const { me, pro, setPro, config, pack, signOut, deleteAccount } = useStore()
  const insets = useSafeAreaInsets()
  const [note, setNote] = useState('')

  const confirm = (msg: string, action: string, ok: () => void) => Platform.OS === 'web'
    ? (window.confirm(msg) && ok())
    : Alert.alert(msg, undefined, [{ text: t('common.cancel'), style: 'cancel' }, { text: action, style: 'destructive', onPress: ok }])
  const restore = async () => {
    setNote('')
    try { const ok = await restorePurchases(); if (ok) setPro(true); setNote(t(ok ? 'me.restored' : 'me.noSub')) } catch { setNote(t('err.generic')) }
  }
  const Link = ({ title, onPress, color = C.ink }: { title: string; onPress: () => void; color?: string }) => (
    <Text style={[s.body, { color, paddingVertical: 10 }]} onPress={onPress} accessibilityRole="link">{title}</Text>
  )
  const phoneLang = LANGS.find(l => l.id === deviceLang())?.label

  return (
    <ScrollView style={s.screen} contentContainerStyle={{ paddingTop: insets.top + 16, paddingHorizontal: 20, paddingBottom: 40, gap: 6 }}>
      <Text style={s.h1}>{t('me.title')}</Text>

      <Section title={t('me.plan')}>
        <Card>
          <Text style={s.h3}>{pro && config.paywallEnabled ? t('me.pro') : config.paywallEnabled ? t('me.free') : t('me.freeEarly')}</Text>
          {!pro && config.paywallEnabled && <Button kind="pearl" title={t('me.upgrade')} onPress={() => router.push('/paywall?trigger=settings')} />}
          {storeAvailable && (
            <View>
              {pro && <Link title={t('me.manage')} onPress={manageSubscription} />}
              <Link title={t('pw.restore')} onPress={restore} />
              {Platform.OS === 'ios' && <Link title={t('pw.redeem')} onPress={() => redeemCode().catch(() => {})} />}
            </View>
          )}
          {note ? <Text style={s.small}>{note}</Text> : null}
          {config.paywallEnabled && <Text style={[s.small, { color: C.faint }]}>{t('pw.cancelHow')}</Text>}
        </Card>
      </Section>

      <Section title={t('me.language')}>
        <Card style={[s.row, { gap: 8 }]}>
          <Toggle label={`${t('me.system')} · ${phoneLang}`} on={setting === 'system'} onPress={() => setSetting('system')} />
          {LANGS.map(l => <Toggle key={l.id} label={l.label} on={setting === l.id} onPress={() => setSetting(l.id)} />)}
        </Card>
      </Section>

      <Section title={t('me.privacy')}>
        <Card><Text style={s.muted}>{t('me.privacyBody')}</Text></Card>
      </Section>

      <Section title={t('me.account')}>
        <Card style={{ gap: 0 }}>
          <Text style={[s.small, { paddingBottom: 4 }]}>{me?.user.email ?? t('me.appleUser')}</Text>
          <Link title={t('me.signOut')} onPress={() => void signOut()} />
          <Link title={t('me.delete')} color={C.danger} onPress={() => confirm(t('me.deleteConfirm'), t('me.delete'), () => void deleteAccount())} />
        </Card>
      </Section>

      <Section title={t('me.about')}>
        <Card style={{ gap: 0 }}>
          <Link title={t('pw.privacy')} onPress={() => Linking.openURL(`${SITE_URL}/privacy`)} />
          <Link title={t('pw.terms')} onPress={() => Linking.openURL(`${SITE_URL}/terms`)} />
          <Link title={t('me.contact')} onPress={() => Linking.openURL(`mailto:${config.contactEmail}?subject=PearlKin`)} />
          <Text style={[s.small, { paddingTop: 8 }]}>{t('me.version', { v: APP_VERSION, p: pack.version })}</Text>
          <Text style={[s.small, { color: C.faint }]}>{t('disclaimer')}</Text>
        </Card>
      </Section>
    </ScrollView>
  )
}
