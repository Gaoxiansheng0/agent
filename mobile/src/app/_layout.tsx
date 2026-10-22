import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { StoreProvider } from '../lib/store'
import { C } from '../lib/ui'

export default function Layout() {
  return (
    <StoreProvider>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerStyle: { backgroundColor: C.bg }, headerTintColor: C.brand, headerShadowVisible: false, contentStyle: { backgroundColor: C.bg } }}>
        <Stack.Screen name="index" options={{ title: 'Family Shelf' }} />
        <Stack.Screen name="family" options={{ title: 'Your family' }} />
        <Stack.Screen name="scan" options={{ title: 'Scan a product' }} />
        <Stack.Screen name="product/[id]" options={{ title: 'Result' }} />
        <Stack.Screen name="routine" options={{ title: 'Routine check' }} />
      </Stack>
    </StoreProvider>
  )
}
