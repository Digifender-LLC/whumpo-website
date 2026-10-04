package com.whumpo.android

import androidx.test.core.app.ApplicationProvider
import com.whumpo.core.account.AccountScope

/** Synthetic, secret-free fixture accounts. Never real account identifiers or tokens. */
object Fixtures {
    val ownerA: AccountScope = AccountScope.of("acct_fixture_instrumented_a")
    val ownerB: AccountScope = AccountScope.of("acct_fixture_instrumented_b")

    val app: WhumpoApplication get() = ApplicationProvider.getApplicationContext()

    val container: AppContainer get() = app.container

    /** Leaves the device signed out with no account state and no key. */
    fun reset() {
        container.accountState.signOut()
    }
}
