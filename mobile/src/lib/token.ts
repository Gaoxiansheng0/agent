// Web build: the sign-in token lives in localStorage (expo-secure-store has no web implementation).
const KEY = 'pearlkin:token'
export async function loadToken() { try { return localStorage.getItem(KEY) } catch { return null } }
export async function saveToken(t: string | null) { try { t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY) } catch { /* private mode */ } }
