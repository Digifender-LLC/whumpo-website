package com.whumpo.core.identity

import com.whumpo.core.account.AccountScope
import com.whumpo.core.account.AccountStateStore
import com.whumpo.core.account.FakeSecretBox
import com.whumpo.core.account.StateSlot
import com.whumpo.core.environment.WhumpoEnvironment
import com.whumpo.core.workspace.*
import com.whumpo.core.account.SecretBox
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.time.Instant

@OptIn(ExperimentalCoroutinesApi::class)
class NativeIdentityTest {
    @get:Rule val temp = TemporaryFolder()
    private val clock = Instant.parse("2026-10-07T12:00:00Z")
    private val a = "00000000-0000-4000-8000-000000000001"
    private val b = "00000000-0000-4000-8000-000000000002"
    private val handoff = "00000000-0000-4000-8000-000000000003"
    private val token = "a".repeat(64)
    private val code = "b".repeat(64)
    private val session = NativeSession(token, clock.plusSeconds(86400), clock.plusSeconds(600))
    private val accountBox = FakeSecretBox()
    private val pendingBox = FakeSecretBox()
    private val root get() = File(temp.root, "account")
    private val pendingRoot get() = File(temp.root, "pending")
    private val store get() = AccountStateStore(root, accountBox)
    private val pending get() = PendingIdentityStore(pendingRoot, pendingBox)
    private val environment = WhumpoEnvironment.from("test", "https://whumpo.com")

    private inner class Api : NativeIdentityApi {
        var account = a
        var revoked = false
        var offline = false
        var staleBuild = false
        var verifyCalls = 0
        var exchanges = 0
        var logoutCalls = 0
        var starts = 0
        var lastState = ""
        var lastChallenge = ""
        var waitForVerify: CompletableDeferred<Unit>? = null
        var expiryExtension = false
        var exchangeFailure = false
        override suspend fun checkConfiguration() { if (staleBuild) throw IdentityFailure("client_update_required") }
        override suspend fun challenge(token: String?) = PasskeyChallenge(handoff, clock.plusSeconds(180), "fixture-options")
        override suspend fun verify(challengeId: String, credentialJson: String, token: String?): NativeSession {
            verifyCalls++
            waitForVerify?.await()
            return if (expiryExtension) NativeSession(this@NativeIdentityTest.token, session.expiresAt.plusSeconds(300), session.freshUntil) else session
        }
        override suspend fun session(token: String): VerifiedAccount {
            if (offline) throw IdentityFailure("network")
            if (revoked) throw IdentityFailure("proof_required")
            return VerifiedAccount(account, "a***@example.test", session.expiresAt, session.freshUntil)
        }
        override suspend fun logout(token: String) { logoutCalls++; if (offline) throw IdentityFailure("network") }
        override suspend fun start(purpose: BrowserPurpose, state: String, challenge: String): StartedHandoff {
            starts++; lastState = state; lastChallenge = challenge
            return StartedHandoff(handoff, "/workspace/native/" + "c".repeat(64), clock.plusSeconds(300))
        }
        override suspend fun exchange(handoffId: String, code: String, state: String, verifier: String): NativeSession {
            exchanges++
            assertEquals(handoff, handoffId)
            assertEquals(lastState, state)
            assertEquals(lastChallenge, IdentityProtocol.challenge(verifier))
            if (exchangeFailure) throw IdentityFailure("network")
            return session
        }
    }

    @Test fun exactReturnRefusesForeignEncodedExtraAndRepeatedParameters() {
        val valid = "${IdentityProtocol.RETURN_URI}?handoffId=$handoff&code=$code"
        assertEquals(handoff, IdentityProtocol.parseReturn(valid).handoffId)
        for (value in listOf(valid.replace("whumpo.com", "whumpo.com.evil.test"), valid + "#fragment", valid + "&code=$code",
            valid.replace("handoffId", "handoff%49d"), valid.replace("https://", "http://"), valid.replace("whumpo.com/", "whumpo.com:443/"),
            valid.replace("/app/return?", "/app/return/?"), valid.replace("code=$code", "code=%62${code.drop(1)}"))) {
            assertThrows(IdentityFailure::class.java) { IdentityProtocol.parseReturn(value) }
        }
        assertEquals("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", IdentityProtocol.challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"))
    }

    @Test fun loginUsesServerUuidAndAccountSwitchErasesOldDraftEvenWhenLabelsMatch() = runTest {
        val io = StandardTestDispatcher(testScheduler); val api = Api(); val stateStore = store
        val controller = NativeIdentityController(api, stateStore, pending, environment, io) { clock }
        controller.initialize(); controller.passkey(PasskeyPrompt { "fixture-credential" })
        assertEquals(AccountScope.of(a), controller.activeAccount.value)
        assertTrue(stateStore.write(AccountScope.of(a), StateSlot.CHAT_DRAFT, "private draft A"))
        api.account = b
        controller.passkey(PasskeyPrompt { "fixture-credential" })
        assertEquals(AccountScope.of(b), controller.activeAccount.value)
        assertNull(stateStore.read(AccountScope.of(b), StateSlot.CHAT_DRAFT))
        assertFalse(File(root, AccountScope.of(a).storageKey).exists())
        val bytes = root.walkTopDown().filter { it.isFile }.joinToString { String(it.readBytes(), Charsets.ISO_8859_1) }
        assertFalse(bytes.contains(token)); assertFalse(bytes.contains(a)); assertFalse(bytes.contains(b))
    }

    @Test fun browserCustodySurvivesProcessDeathAndNeedsExplicitSingleExchange() = runTest {
        val io = StandardTestDispatcher(testScheduler); val api = Api()
        val first = NativeIdentityController(api, store, pending, environment, io) { clock }
        first.initialize()
        assertEquals("https://whumpo.com/workspace/native/" + "c".repeat(64), first.beginBrowser(BrowserPurpose.SIGN_IN))
        val saved = pending.read(clock)!!
        val bytes = pendingRoot.walkTopDown().filter { it.isFile }.joinToString { String(it.readBytes(), Charsets.ISO_8859_1) }
        assertFalse(bytes.contains(saved.state)); assertFalse(bytes.contains(saved.verifier))
        val second = NativeIdentityController(api, store, pending, environment, io) { clock }
        second.initialize()
        assertTrue(second.state.value.browserPending); assertEquals(0, api.exchanges)
        second.receiveReturn("${IdentityProtocol.RETURN_URI}?handoffId=$b&code=$code")
        assertFalse(second.state.value.returnReady)
        second.receiveReturn("${IdentityProtocol.RETURN_URI}?handoffId=$handoff&code=$code")
        assertTrue(second.state.value.returnReady); assertEquals(0, api.exchanges)
        second.receiveReturn("${IdentityProtocol.RETURN_URI}?handoffId=$handoff&code=${"d".repeat(64)}")
        assertEquals(code, pending.read(clock)!!.code)
        second.completeBrowser()
        assertEquals(1, api.exchanges); assertTrue(second.state.value.signedIn); assertNull(pending.read(clock))
        second.receiveReturn("${IdentityProtocol.RETURN_URI}?handoffId=$handoff&code=$code")
        assertFalse(second.state.value.returnReady); assertEquals(1, api.exchanges)
    }

    @Test fun unknownExchangeIsNeverReplayedAfterRestart() = runTest {
        val io = StandardTestDispatcher(testScheduler); val api = Api()
        val first = NativeIdentityController(api, store, pending, environment, io) { clock }
        first.initialize(); first.beginBrowser(BrowserPurpose.RECOVERY)
        first.receiveReturn("${IdentityProtocol.RETURN_URI}?handoffId=$handoff&code=$code")
        api.exchangeFailure = true; first.completeBrowser()
        assertEquals(PendingPhase.EXCHANGING, pending.read(clock)!!.phase)
        val second = NativeIdentityController(api, store, pending, environment, io) { clock }
        second.initialize(); assertEquals(1, api.exchanges); assertFalse(second.state.value.returnReady)
        second.completeBrowser(); assertEquals(1, api.exchanges)
        second.cancel(); assertNull(pending.read(clock))
    }

    @Test fun signOutFencesACommittedLateLoginAndRevokesTheOrphan() = runTest {
        val io = StandardTestDispatcher(testScheduler); val api = Api(); val stateStore = store
        val controller = NativeIdentityController(api, stateStore, pending, environment, io) { clock }
        controller.initialize(); api.waitForVerify = CompletableDeferred()
        val job = launch { controller.passkey(PasskeyPrompt { "fixture-credential" }) }; runCurrent()
        assertEquals(1, api.verifyCalls)
        controller.signOut()
        api.waitForVerify!!.complete(Unit); job.join()
        assertNull(controller.activeAccount.value); assertNull(stateStore.activeAccount.value)
        assertEquals(1, api.logoutCalls); assertFalse(root.exists())
    }

    @Test fun reauthenticationKeepsBearerAndAbsoluteExpiryAndRevocationPurgesTheDevice() = runTest {
        val io = StandardTestDispatcher(testScheduler); val api = Api(); val stateStore = store
        val controller = NativeIdentityController(api, stateStore, pending, environment, io) { clock }
        controller.initialize(); controller.passkey(PasskeyPrompt { "fixture-credential" })
        val initial = stateStore.read(AccountScope.of(a), NativeIdentityController.SESSION_SLOT)
        controller.passkey(PasskeyPrompt { "fixture-credential" }, true)
        assertEquals(initial, stateStore.read(AccountScope.of(a), NativeIdentityController.SESSION_SLOT))
        api.expiryExtension = true
        controller.passkey(PasskeyPrompt { "fixture-credential" }, true)
        assertEquals(initial, stateStore.read(AccountScope.of(a), NativeIdentityController.SESSION_SLOT))
        api.revoked = true; controller.checkSession()
        assertNull(controller.activeAccount.value); assertNull(stateStore.activeAccount.value); assertFalse(root.exists())
    }

    @Test fun workspaceAuthorizationDropsLatePrivateResultsAndPurgesOnRevocation() = runTest {
        val io = StandardTestDispatcher(testScheduler); val api = Api(); val stateStore = store
        val controller = NativeIdentityController(api, stateStore, pending, environment, io) { clock }
        controller.initialize(); controller.passkey(PasskeyPrompt { "fixture-credential" })
        val gate = CompletableDeferred<Unit>(); var delivered = false
        val request = launch { controller.authorized(AccountScope.of(a)) { gate.await(); "private reply" }; delivered = true }
        runCurrent(); controller.signOut(); gate.complete(Unit); request.join()
        assertFalse(delivered)
        controller.passkey(PasskeyPrompt { "fixture-credential" })
        try { controller.authorized(AccountScope.of(a)) { throw IdentityFailure("proof_required") } }
        catch (_: IdentityFailure) { /* Expected current-session revocation. */ }
        assertNull(controller.activeAccount.value); assertNull(stateStore.activeAccount.value); assertFalse(root.exists())
    }

    @Test fun staleBuildRefusesCeremoniesAndRetainsActionableUpdateGuidance() = runTest {
        val io = StandardTestDispatcher(testScheduler); val api = Api()
        val controller = NativeIdentityController(api, store, pending, environment, io) { clock }
        controller.initialize(); api.staleBuild = true
        controller.passkey(PasskeyPrompt { error("A stale build must not prompt for credentials") })
        assertTrue(controller.state.value.updateRequired)
        assertTrue(controller.state.value.message.startsWith("Update Whumpo"))
        assertNull(controller.beginBrowser(BrowserPurpose.SIGN_IN))
        assertEquals(0, api.starts); assertEquals(0, api.verifyCalls); assertNull(pending.read(clock))
        assertTrue(controller.state.value.message.startsWith("Update Whumpo"))
    }

    @Test fun offlineRestartRetainsNoActiveAuthorityAndCanEraseTheSavedSessionImmediately() = runTest {
        val io = StandardTestDispatcher(testScheduler); val api = Api(); val stateStore = store
        val first = NativeIdentityController(api, stateStore, pending, environment, io) { clock }
        first.initialize(); first.passkey(PasskeyPrompt { "fixture-credential" })
        stateStore.write(AccountScope.of(a), StateSlot.CHAT_DRAFT, "erase offline")
        api.offline = true
        val restartedStore = store
        val second = NativeIdentityController(api, restartedStore, pending, environment, io) { clock }
        second.initialize()
        assertTrue(second.state.value.savedSession); assertFalse(second.state.value.signedIn)
        assertNull(second.activeAccount.value); assertTrue(root.exists())
        second.signOut()
        assertFalse(second.state.value.savedSession); assertNull(restartedStore.activeAccount.value)
        assertFalse(root.exists()); assertEquals(1, api.logoutCalls)
        assertTrue(second.state.value.message.contains("not confirmed"))
    }

    @Test fun freshPasskeyRefusalRetainsSessionButClosureErasesPrivateWorkAndSurvivesRestartFrozen() = runTest {
        val io = StandardTestDispatcher(testScheduler); val api = Api(); val stateStore = store; val owner = AccountScope.of(a)
        val first = NativeIdentityController(api, stateStore, pending, environment, io) { clock }
        first.initialize(); first.passkey(PasskeyPrompt { "fixture-credential" })
        val saved = stateStore.read(owner, NativeIdentityController.SESSION_SLOT)
        try { first.authorized(owner) { throw IdentityFailure("fresh_passkey_required") } } catch (_: IdentityFailure) {}
        assertTrue(first.state.value.signedIn); assertEquals(saved, stateStore.read(owner, NativeIdentityController.SESSION_SLOT))
        stateStore.write(owner, StateSlot.CHAT_DRAFT, "draft")
        val slots = listOf(com.whumpo.core.workspace.NativeWorkspaceController.PENDING_SLOT, com.whumpo.core.workspace.NativeWorkspaceController.APPROVAL_SLOT)
        slots.forEach { stateStore.write(owner, it, "private pending") }
        try { first.authorized(owner) { throw IdentityFailure("account_closing") } } catch (_: IdentityFailure) {}
        assertNull(first.activeAccount.value); assertTrue(first.state.value.accountClosing); assertTrue(first.state.value.savedSession)
        assertEquals(saved, stateStore.read(owner, NativeIdentityController.SESSION_SLOT))
        assertNull(stateStore.read(owner, StateSlot.CHAT_DRAFT)); slots.forEach { assertNull(stateStore.read(owner, it)) }
        assertFalse(stateStore.write(owner, StateSlot.CHAT_DRAFT, "late draft"))
        first.cancel(); first.checkSession(); first.passkey(PasskeyPrompt { error("Closure must not prompt") }, true)
        assertEquals(1, api.verifyCalls); assertNull(first.activeAccount.value)
        val secondStore = store
        val second = NativeIdentityController(api, secondStore, pending, environment, io) { clock }
        second.initialize(); assertTrue(second.state.value.accountClosing); assertNull(second.activeAccount.value)
        assertFalse(secondStore.write(owner, StateSlot.CHAT_DRAFT, "late restarted draft"))
        assertNull(second.beginBrowser(BrowserPurpose.SIGN_IN)); assertEquals(0, api.starts)
        second.signOut(); assertFalse(root.exists()); assertEquals(1, api.logoutCalls)
    }

    @Test fun closingDuringApprovalRecoveryClearsScreenAndPendingAndNeverReplays() = runTest {
        val io = StandardTestDispatcher(testScheduler); val api = Api(); val stateStore = store
        val identity = NativeIdentityController(api, stateStore, pending, environment, io) { clock }
        identity.initialize(); identity.passkey(PasskeyPrompt { "fixture-credential" })
        var writes = 0; var reads = 0
        val review = NativeReview(ReviewKind.RESTORE, handoff, a, "Project", "pending", clock.plusSeconds(100), true,
            ReviewControl(ReviewKind.RESTORE, handoff, a), true, "Replace saved documents", listOf("Later changes will be lost."), null, null, null, null)
        val workspaceApi = object : NativeWorkspaceApi {
            override suspend fun reviews(token: String) = listOf(review)
            override suspend fun approve(token: String, request: PendingApproval): ChatAcceptance { writes++; throw IdentityFailure("network") }
            override suspend fun bootstrap(token: String) = WorkspaceBootstrap(true, 0, "guided", 1, 1)
            override suspend fun chat(token: String, cursor: String?, query: String) = NativeChatPage(0, "guided", emptyList(), null)
            override suspend fun turn(token: String, requestId: String): NativeTurn { reads++; throw IdentityFailure("account_closing") }
            override suspend fun send(token: String, request: PendingChat): ChatAcceptance = error("No Chat send allowed")
            override suspend fun projects(token: String, cursor: String?) = NativePage<NativeProject>(emptyList(), null)
            override suspend fun activity(token: String, cursor: String?) = NativePage<NativeActivity>(emptyList(), null)
        }
        val workspace = NativeWorkspaceController(identity, stateStore, workspaceApi, io) { clock }
        backgroundScope.launch { workspace.observeAccounts() }; runCurrent()
        workspace.approveReview(review.id, review.fingerprint(), true, "RESTORE")
        assertNotNull(workspace.state.value.pendingApproval); assertEquals(1, writes)
        workspace.checkPendingApproval(); runCurrent()
        assertTrue(identity.state.value.accountClosing); assertNull(workspace.state.value.owner)
        assertNull(workspace.state.value.pendingApproval); assertTrue(workspace.state.value.reviews.isEmpty())
        workspace.checkPendingApproval(); workspace.approveReview(review.id, review.fingerprint(), true, "RESTORE")
        assertEquals(1, writes); assertEquals(1, reads)
    }

    @Test fun cleanupFailureFreezesLocallyAndDoesNotClaimAnAccountClosureOrSuccessfulErasure() = runTest {
        val io = StandardTestDispatcher(testScheduler); val api = Api()
        val failing = object : SecretBox {
            val delegate = FakeSecretBox()
            override fun seal(plaintext: ByteArray, associatedData: ByteArray) = delegate.seal(plaintext, associatedData)
            override fun open(ciphertext: ByteArray, associatedData: ByteArray) = delegate.open(ciphertext, associatedData)
            override fun destroyKey() { delegate.destroyKey(); throw java.io.IOException("Synthetic key-service failure") }
        }
        val stateStore = AccountStateStore(root, failing)
        val controller = NativeIdentityController(api, stateStore, pending, environment, io) { clock }
        controller.initialize(); controller.passkey(PasskeyPrompt { "fixture-credential" })
        api.offline = true; controller.signOut()
        assertNull(controller.activeAccount.value); assertTrue(controller.state.value.localCleanupFailed)
        assertFalse(controller.state.value.accountClosing); assertTrue(controller.state.value.message.contains("could not be confirmed"))
        assertFalse(controller.state.value.message.startsWith("Signed out"))
        controller.passkey(PasskeyPrompt { error("Frozen local storage must not prompt") }); assertEquals(1, api.verifyCalls)
    }

    @Test fun lateClosureFromThePreviousAccountCannotFreezeTheNewAccount() = runTest {
        val io = StandardTestDispatcher(testScheduler); val api = Api(); val stateStore = store
        val controller = NativeIdentityController(api, stateStore, pending, environment, io) { clock }
        controller.initialize(); controller.passkey(PasskeyPrompt { "fixture-credential" })
        val gate = CompletableDeferred<Unit>()
        val job = launch { try { controller.authorized(AccountScope.of(a)) { gate.await(); throw IdentityFailure("account_closing") } } catch (_: IdentityFailure) {} }
        runCurrent(); api.account = b; controller.passkey(PasskeyPrompt { "fixture-credential" })
        stateStore.write(AccountScope.of(b), StateSlot.CHAT_DRAFT, "new owner draft")
        gate.complete(Unit); job.join()
        assertEquals(AccountScope.of(b), controller.activeAccount.value); assertFalse(controller.state.value.accountClosing)
        assertEquals("new owner draft", stateStore.read(AccountScope.of(b), StateSlot.CHAT_DRAFT))
    }

    @Test fun lateFailuresAfterAnAccountCycleCannotReachReceiptRecoveryOrRevokeTheNewSession() = runTest {
        val io = StandardTestDispatcher(testScheduler); val api = Api(); val stateStore = store
        val controller = NativeIdentityController(api, stateStore, pending, environment, io) { clock }
        controller.initialize(); controller.passkey(PasskeyPrompt { "fixture-credential" })
        for (code in listOf("not_found", "network", "proof_required", "identity_changed", "account_closing")) {
            val gate = CompletableDeferred<Unit>(); var oldFailureDelivered = false; var cancelled = false
            val old = launch {
                try { controller.authorized(AccountScope.of(a)) { gate.await(); throw IdentityFailure(code) } }
                catch (_: kotlinx.coroutines.CancellationException) { cancelled = true }
                catch (_: IdentityFailure) { oldFailureDelivered = true; stateStore.write(AccountScope.of(a), NativeWorkspaceController.PENDING_SLOT, "stale response changed custody") }
            }
            runCurrent()
            api.account = b; controller.passkey(PasskeyPrompt { "fixture-credential" })
            api.account = a; controller.passkey(PasskeyPrompt { "fixture-credential" })
            stateStore.write(AccountScope.of(a), NativeWorkspaceController.PENDING_SLOT, "new session exact request")
            gate.complete(Unit); old.join()
            assertTrue("Old $code must be cancelled", cancelled); assertFalse(oldFailureDelivered)
            assertEquals(AccountScope.of(a), controller.activeAccount.value); assertTrue(controller.state.value.signedIn)
            assertFalse(controller.state.value.accountClosing)
            assertEquals("new session exact request", stateStore.read(AccountScope.of(a), NativeWorkspaceController.PENDING_SLOT))
        }
    }

    @Test fun tamperedExpiredOrForeignKeyPendingStateIsErased() {
        val fixture = PendingIdentity(BrowserPurpose.SIGN_IN, "a".repeat(43), "b".repeat(43), clock.plusSeconds(300), PendingPhase.STARTING)
        pending.save(fixture)
        assertNull(PendingIdentityStore(pendingRoot, FakeSecretBox()).read(clock))
        pending.save(fixture); assertNull(pending.read(clock.plusSeconds(301)))
        pending.save(fixture)
        File(pendingRoot, "browser-return.bin").appendBytes(byteArrayOf(0))
        assertNull(pending.read(clock)); assertFalse(pendingRoot.exists())
    }
}
