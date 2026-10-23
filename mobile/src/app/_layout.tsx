import { Stack, type ErrorBoundaryProps } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useEffect } from 'react'
import { ScrollView, Text } from 'react-native'
import { flush, track } from '../lib/api'
import { I18nProvider, useI18n } from '../lib/i18n'
import { StoreProvider, useStore } from '../lib/store'
import { Button, C, s } from '../lib/ui'

function Screens() {
  const { t } = useI18n()
  const { status, members } = useStore()
  const signedIn = status === 'ready'
  const hasSelf = members.some(m => m.is_self)
  const back = { headerShown: true, title: '', headerBackTitle: '', headerTransparent: true, headerTintColor: C.ink }
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg } }}>
      {/* Signed out -> welcome; signed in without a profile -> setup; otherwise the app. */}
      <Stack.Protected guard={!signedIn} redirectTo="/">
        <Stack.Screen name="welcome" />
        <Stack.Screen name="sign-in" options={back} />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && !hasSelf} redirectTo={signedIn ? '/' : '/welcome'}>
        <Stack.Screen name="setup" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && hasSelf} redirectTo={signedIn ? '/setup' : '/welcome'}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="test/camera" options={{ presentation: 'fullScreenModal' }} />
        <Stack.Screen name="test/conditions" options={back} />
        <Stack.Screen name="test/questions" options={back} />
        <Stack.Screen name="test/analyzing" options={{ gestureEnabled: false }} />
        <Stack.Screen name="report/[id]" options={back} />
        <Stack.Screen name="paywall" options={{ presentation: 'modal' }} />
        <Stack.Screen name="member/[id]" options={{ ...back, presentation: 'modal' }} />
        <Stack.Screen name="add-product" options={{ ...back, title: t('shelf.add'), headerTransparent: false, headerStyle: { backgroundColor: C.bg }, headerShadowVisible: false }} />
        <Stack.Screen name="product/[id]" options={back} />
        <Stack.Screen name="feedback/[id]" options={{ ...back, presentation: 'modal' }} />
        <Stack.Screen name="advice/[member]" options={back} />
      </Stack.Protected>
    </Stack>
  )
}

export default function Layout() {
  return (
    <I18nProvider>
      <StoreProvider>
        <StatusBar style="dark" />
        <Screens />
      </StoreProvider>
    </I18nProvider>
  )
}

// Crashes are reported as anonymous events (message only) so they show up in the admin panel.
// Rendered outside the providers, so it can't use translations; kept short in English and Chinese.
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => {
    track('error', { message: `${error.name}: ${error.message}`.slice(0, 200), screen: 'app' })
    void flush()
  }, [error])
  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.pad, { paddingTop: 96 }]}>
      <Text style={s.h1}>Something went wrong · 出了点问题</Text>
      <Text style={s.body}>Your reports and family are saved to your account. · 你的报告和家人都保存在账号里。</Text>
      <Button title="Try again · 重试" onPress={retry} />
    </ScrollView>
  )
}
