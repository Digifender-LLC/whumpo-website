package com.whumpo.android.session

import com.whumpo.core.api.SessionProvider

/**
 * Placeholder until WP5 (native sign-in) lands: there is no bearer token, so every authenticated call fails with the
 * contract's "sign in" error and the screens show it honestly. WP5 replaces this with the Keystore-backed session.
 */
object ShellSessionProvider : SessionProvider {
    override suspend fun bearerToken(): String? = null

    override suspend fun onSessionRejected() = Unit
}
