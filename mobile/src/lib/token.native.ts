// iOS / Android: the sign-in token lives in the Keychain / Keystore.
import * as SecureStore from 'expo-secure-store'
const KEY = 'pearlkin.token'
export const loadToken = () => SecureStore.getItemAsync(KEY)
export async function saveToken(t: string | null) { t ? await SecureStore.setItemAsync(KEY, t) : await SecureStore.deleteItemAsync(KEY) }
