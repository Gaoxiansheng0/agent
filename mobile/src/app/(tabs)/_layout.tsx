import Ionicons from '@expo/vector-icons/Ionicons'
import { Tabs } from 'expo-router'
import type { ColorValue } from 'react-native'
import { useI18n } from '../../lib/i18n'
import { C } from '../../lib/ui'

type Icon = keyof typeof Ionicons.glyphMap
const icon = (name: Icon) => ({ color, focused }: { color: ColorValue; focused: boolean }) =>
  <Ionicons name={(focused ? name : `${name}-outline`) as Icon} size={23} color={color as string} />

export default function TabsLayout() {
  const { t } = useI18n()
  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarActiveTintColor: C.ink,
      tabBarInactiveTintColor: C.faint,
      tabBarStyle: { backgroundColor: C.surface, borderTopColor: C.line },
      tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      sceneStyle: { backgroundColor: C.bg },
    }}>
      <Tabs.Screen name="index" options={{ title: t('tab.skin'), tabBarIcon: icon('sparkles') }} />
      <Tabs.Screen name="shelf" options={{ title: t('tab.shelf'), tabBarIcon: icon('file-tray-stacked') }} />
      <Tabs.Screen name="family" options={{ title: t('tab.family'), tabBarIcon: icon('people') }} />
      <Tabs.Screen name="me" options={{ title: t('tab.me'), tabBarIcon: icon('person-circle') }} />
    </Tabs>
  )
}
