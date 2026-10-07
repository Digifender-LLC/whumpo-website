package com.whumpo.android

import androidx.test.core.app.ApplicationProvider
import com.whumpo.android.security.KeystoreSecretBox
import com.whumpo.core.account.AccountScope
import com.whumpo.core.account.AccountStateStore
import com.whumpo.core.identity.BrowserPurpose
import com.whumpo.core.identity.NativeIdentityApi
import com.whumpo.core.identity.NativeSession
import com.whumpo.core.identity.PasskeyChallenge
import com.whumpo.core.identity.PasskeyPrompt
import com.whumpo.core.identity.PendingIdentityStore
import com.whumpo.core.identity.StartedHandoff
import com.whumpo.core.identity.VerifiedAccount
import com.whumpo.core.workspace.*
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import java.io.File
import java.time.Instant

/** Synthetic identity adapter in the test APK only; it exercises the real authenticated account gate. */
object Fixtures {
    private const val OWNER_A = "11111111-1111-4111-8111-111111111111"
    private const val OWNER_B = "22222222-2222-4222-8222-222222222222"
    val ownerA: AccountScope = AccountScope.of(OWNER_A)
    val ownerB: AccountScope = AccountScope.of(OWNER_B)
    val app: WhumpoApplication get() = ApplicationProvider.getApplicationContext()
    val container: AppContainer get() = app.container
    private var api = FixtureIdentityApi()
    private var workspaceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    /** Leaves the device signed out with no account state, pending browser flow or key. */
    fun reset() = runBlocking {
        workspaceScope.cancel()
        container.identity.signOut()
        api = FixtureIdentityApi()
        val replacement = AppContainer(container.environment,
            AccountStateStore(WhumpoApplication.accountStateDirectory(app), KeystoreSecretBox(WhumpoApplication.ACCOUNT_STATE_KEY_ALIAS)),
            Dispatchers.IO,
            PendingIdentityStore(File(app.noBackupFilesDir, "native-pending"), KeystoreSecretBox("whumpo.native-pending.v1")), api, FixtureWorkspaceApi())
        replacement.identity.initialize()
        // Application replacement is confined to instrumentation; production has no bypass or fixture flag.
        WhumpoApplication::class.java.getDeclaredField("container").apply { isAccessible = true }.set(app, replacement)
        workspaceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        workspaceScope.launch { replacement.workspace.observeAccounts() }
    }

    fun signIn(owner: AccountScope = ownerA) = runBlocking {
        api.owner = when (owner) { ownerA -> OWNER_A; ownerB -> OWNER_B; else -> error("Unknown fixture") }
        container.identity.passkey(PasskeyPrompt { "{}" })
        check(container.identity.activeAccount.value == owner)
    }

    private class FixtureWorkspaceApi : NativeWorkspaceApi {
        override suspend fun bootstrap(token: String) = WorkspaceBootstrap(true, 0, "guided", 0, 0)
        override suspend fun chat(token: String, cursor: String?, query: String) = NativeChatPage(0, "guided", emptyList(), null)
        override suspend fun turn(token: String, requestId: String): NativeTurn = error("Not used by shell fixtures")
        override suspend fun send(token: String, request: PendingChat): ChatAcceptance = error("Not used by shell fixtures")
        override suspend fun projects(token: String, cursor: String?) = NativePage<NativeProject>(emptyList(), null)
        override suspend fun activity(token: String, cursor: String?) = NativePage<NativeActivity>(emptyList(), null)
    }

    private class FixtureIdentityApi : NativeIdentityApi {
        var owner = OWNER_A
        private val expiry = Instant.now().plusSeconds(3_600)
        private val fresh = Instant.now().plusSeconds(300)
        override suspend fun checkConfiguration() = Unit
        override suspend fun challenge(token: String?) = PasskeyChallenge(OWNER_A, Instant.now().plusSeconds(60), "{}")
        override suspend fun verify(challengeId: String, credentialJson: String, token: String?) = NativeSession(token ?: "a".repeat(64), expiry, fresh)
        override suspend fun session(token: String) = VerifiedAccount(owner, "fixture@example.invalid", expiry, fresh)
        override suspend fun logout(token: String) = Unit
        override suspend fun start(purpose: BrowserPurpose, state: String, challenge: String): StartedHandoff = error("Not used by shell fixtures")
        override suspend fun exchange(handoffId: String, code: String, state: String, verifier: String): NativeSession = error("Not used by shell fixtures")
    }
}
