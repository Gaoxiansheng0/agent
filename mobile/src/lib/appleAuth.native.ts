// Sign in with Apple (iOS). Required by App Store guideline 4.8 when other sign-in options exist.
import * as AppleAuthentication from 'expo-apple-authentication'
import { createElement } from 'react'

export const appleAvailable = () => AppleAuthentication.isAvailableAsync()

/** Returns the identity token for the server to verify, or null if the user cancelled. */
export async function appleIdentityToken(): Promise<string | null> {
  try {
    const cred = await AppleAuthentication.signInAsync({
      requestedScopes: [AppleAuthentication.AppleAuthenticationScope.EMAIL],
    })
    return cred.identityToken
  } catch (e) {
    if ((e as { code?: string }).code === 'ERR_REQUEST_CANCELED') return null
    throw e
  }
}

export function AppleButton({ onPress }: { onPress: () => void }) {
  return createElement(AppleAuthentication.AppleAuthenticationButton, {
    buttonType: AppleAuthentication.AppleAuthenticationButtonType.CONTINUE,
    buttonStyle: AppleAuthentication.AppleAuthenticationButtonStyle.BLACK,
    cornerRadius: 999,
    style: { height: 54, width: '100%' },
    onPress,
  })
}
