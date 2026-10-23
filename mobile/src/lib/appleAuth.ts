// Web build: Sign in with Apple isn't offered on the web app (it needs a separate Services ID); email codes are.
export const appleAvailable = async () => false
export async function appleIdentityToken(): Promise<string | null> { return null }
export function AppleButton(_: { onPress: () => void }) { return null }
