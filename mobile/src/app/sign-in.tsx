import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { Linking, ScrollView, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { appleSignIn, emailStart, emailVerify, SITE_URL, type ApiError } from '../lib/api'
import { AppleButton, appleAvailable, appleIdentityToken } from '../lib/appleAuth'
import { useI18n } from '../lib/i18n'
import { useStore } from '../lib/store'
import { Button, C, Field, s } from '../lib/ui'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export default function SignIn() {
  const { t } = useI18n()
  const { signIn } = useStore()
  const insets = useSafeAreaInsets()
  const [apple, setApple] = useState(false)
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { appleAvailable().then(setApple).catch(() => {}) }, [])

  const fail = (e: unknown) => {
    const err = e as ApiError
    setError(err.code === 'offline' ? t('err.offline') : err.status === 429 ? t('err.tooMany') : err.message || t('err.generic'))
  }
  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try { await fn() } catch (e) { fail(e) } finally { setBusy(false) }
  }

  const sendCode = () => run(async () => {
    if (!EMAIL.test(email.trim())) return setError(t('si.badEmail'))
    await emailStart(email.trim())
    setStep('code')
  })
  const verify = (value = code) => run(async () => {
    const r = await emailVerify(email.trim(), value)
    await signIn(r.token, r)
    router.replace('/')
  })
  const withApple = () => run(async () => {
    const token = await appleIdentityToken()
    if (!token) return
    const r = await appleSignIn(token)
    await signIn(r.token, r)
    router.replace('/')
  })

  return (
    <ScrollView style={s.screen} contentContainerStyle={{ paddingTop: insets.top + 64, paddingHorizontal: 24, paddingBottom: 40, gap: 18 }} keyboardShouldPersistTaps="handled">
      {step === 'email' ? (
        <>
          <View style={{ gap: 8 }}>
            <Text style={s.h1}>{t('si.title')}</Text>
            <Text style={[s.body, { color: C.sub }]}>{t('si.sub')}</Text>
          </View>
          {apple && (
            <>
              <AppleButton onPress={withApple} />
              <View style={[s.row, { justifyContent: 'center' }]}><Text style={s.small}>{t('si.or')}</Text></View>
            </>
          )}
          <Field label={t('si.email')} placeholder={t('si.emailPh')} value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email"
            keyboardType="email-address" textContentType="emailAddress" returnKeyType="send" onSubmitEditing={sendCode} />
          <Button title={t('si.sendCode')} onPress={sendCode} busy={busy} kind={apple ? 'secondary' : 'primary'} />
        </>
      ) : (
        <>
          <View style={{ gap: 8 }}>
            <Text style={s.h1}>{t('si.codeTitle')}</Text>
            <Text style={[s.body, { color: C.sub }]}>{t('si.codeSub', { email: email.trim() })}</Text>
          </View>
          <Field placeholder={t('si.code')} value={code} keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="one-time-code" maxLength={6} autoFocus
            style={{ fontSize: 28, letterSpacing: 10, textAlign: 'center', fontWeight: '600' }}
            onChangeText={v => { const d = v.replace(/\D/g, ''); setCode(d); if (d.length === 6) verify(d) }} />
          <Button title={t('common.continue')} onPress={() => verify()} busy={busy} disabled={code.length !== 6} />
          <View style={[s.row, { justifyContent: 'space-between' }]}>
            <Button kind="ghost" title={t('si.changeEmail')} onPress={() => { setStep('email'); setCode(''); setError('') }} />
            <Button kind="ghost" title={t('si.resend')} onPress={sendCode} />
          </View>
        </>
      )}
      {error ? <Text style={[s.body, { color: C.danger }]}>{error}</Text> : null}
      <Text style={[s.small, { textAlign: 'center', color: C.faint }]} onPress={() => Linking.openURL(`${SITE_URL}/terms`)}>{t('si.terms')}</Text>
    </ScrollView>
  )
}
