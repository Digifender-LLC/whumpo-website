package com.whumpo.android

import androidx.test.core.app.ApplicationProvider
import com.whumpo.core.account.AccountScope
import com.whumpo.core.auth.SessionManager
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking

/** Synthetic, secret-free fixture accounts. Never real account identifiers or tokens. */
object Fixtures {
    val ownerA: AccountScope = AccountScope.of("acct_fixture_instrumented_a")
    val ownerB: AccountScope = AccountScope.of("acct_fixture_instrumented_b")

    val app: WhumpoApplication get() = ApplicationProvider.getApplicationContext()

    val container: AppContainer get() = app.container

    /** Leaves the device signed out with no account state and no key. */
    fun reset() {
        // Start-up restores the stored session asynchronously; let it finish so it cannot race the fixture.
        runBlocking { container.sessions.state.first { it !is SessionManager.State.Restoring } }
        container.accountState.signOut()
    }
}
