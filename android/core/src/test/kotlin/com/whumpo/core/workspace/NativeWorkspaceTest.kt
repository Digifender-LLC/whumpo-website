package com.whumpo.core.workspace

import com.whumpo.core.account.AccountScope
import com.whumpo.core.account.AccountStateStore
import com.whumpo.core.account.FakeSecretBox
import com.whumpo.core.account.StateSlot
import com.whumpo.core.identity.IdentityFailure
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

@OptIn(ExperimentalCoroutinesApi::class)
class NativeWorkspaceTest {
    @get:Rule val temp = TemporaryFolder()
    private val a = AccountScope.of("00000000-0000-4000-8000-000000000001")
    private val b = AccountScope.of("00000000-0000-4000-8000-000000000002")
    private val root get() = File(temp.root, "state")
    private val store by lazy { AccountStateStore(root, FakeSecretBox()) }
    private inner class Session : WorkspaceSession {
        override fun hasFreshProof() = true
        override val activeAccount = MutableStateFlow<AccountScope?>(a)
        var epoch = 0
        init { store.activate(a) }
        fun switch(owner: AccountScope?) { epoch++; if (owner == null) store.signOut() else store.activate(owner); activeAccount.value = owner }
        override suspend fun <T> authorized(owner: AccountScope, action: suspend (String) -> T): T {
            if (activeAccount.value != owner) throw IdentityFailure("proof_required")
            val expected = epoch
            return try {
                val result = action("a".repeat(64))
                if (epoch != expected || activeAccount.value != owner) throw CancellationException("Account changed")
                result
            } catch (error: IdentityFailure) { if (error.code == "proof_required") switch(null); throw error }
        }
    }
    private class Api : NativeWorkspaceApi {
        override suspend fun reviews(token: String) = emptyList<NativeReview>()
        override suspend fun approve(token: String, request: PendingApproval): ChatAcceptance = error("Unexpected approval")
        var revision = 0
        var welcome = true
        var outcome = "completed"
        var sendWait: CompletableDeferred<Unit>? = null
        var projectWait: CompletableDeferred<Unit>? = null
        var reads = 0
        var chatReads = 0
        var projectReads = 0
        val sends = mutableListOf<PendingChat>()
        val turns = linkedMapOf<String, NativeTurn>()
        override suspend fun bootstrap(token: String) = WorkspaceBootstrap(welcome, if (welcome) revision else null, if (welcome) "guided" else null, 0, 0)
        override suspend fun chat(token: String, cursor: String?, query: String): NativeChatPage {
            chatReads++
            return NativeChatPage(revision, "guided", turns.values.toList(), null)
        }
        override suspend fun turn(token: String, requestId: String): NativeTurn { reads++; return turns[requestId] ?: throw IdentityFailure("not_found") }
        override suspend fun send(token: String, request: PendingChat): ChatAcceptance {
            sends += request
            sendWait?.await()
            if (outcome == "offline") throw IdentityFailure("network")
            if (outcome == "stale") throw IdentityFailure("stale_revision")
            check(request.expectedRevision == revision)
            revision++
            val status = if (outcome == "lost") "completed" else outcome
            turns[request.requestId] = NativeTurn(request.requestId, revision, status, "guided", "2026-10-07T12:00:00.000Z", request.content, "Saved reply", false, false)
            if (outcome == "lost") throw IdentityFailure("network")
            return ChatAcceptance(request.requestId, revision, status)
        }
        override suspend fun projects(token: String, cursor: String?): NativePage<NativeProject> {
            projectReads++; projectWait?.await()
            return NativePage(listOf(NativeProject("00000000-0000-4000-8000-000000000003", "private owner A", "Purpose", "offline", false, false)), null)
        }
        override suspend fun activity(token: String, cursor: String?) = NativePage<NativeActivity>(emptyList(), null)
    }
    private fun TestScope.controller(api: Api, session: Session): NativeWorkspaceController {
        val controller = NativeWorkspaceController(session, store, api, StandardTestDispatcher(testScheduler))
        backgroundScope.launch { controller.observeAccounts() }
        runCurrent()
        return controller
    }

    @Test fun lostAcknowledgementSurvivesRestartWithoutResendAndReadbackClearsOnlyKnownCompletion() = runTest {
        val api = Api().apply { outcome = "lost" }; val session = Session()
        val first = controller(api, session)
        first.send("a private original request")
        val original = first.state.value.pending!!
        assertEquals(ChatDelivery.UNCONFIRMED, original.delivery)
        val disk = root.walkTopDown().filter { it.isFile }.joinToString { String(it.readBytes(), Charsets.ISO_8859_1) }
        assertFalse(disk.contains(original.content)); assertFalse(disk.contains(original.requestId))
        val restarted = controller(api, session)
        assertEquals(original, restarted.state.value.pending)
        assertEquals(1, api.sends.size); assertEquals(0, api.reads)
        restarted.checkPending()
        assertNull(restarted.state.value.pending); assertEquals(1, api.sends.size)
        assertEquals(original.requestId to original.content, restarted.state.value.acceptedDraft)
        assertNull(store.read(a, NativeWorkspaceController.PENDING_SLOT))
    }

    @Test fun onlyExplicitResendAfterMissingReadbackUsesTheExactPersistedPayload() = runTest {
        val api = Api().apply { outcome = "offline" }; val controller = controller(api, Session())
        controller.send(" original request ")
        val original = api.sends.single()
        controller.send("another request"); controller.resendOriginal()
        assertEquals(1, api.sends.size)
        controller.checkPending(); assertEquals(ChatDelivery.NOT_FOUND, controller.state.value.pending!!.delivery)
        api.outcome = "completed"; controller.resendOriginal()
        assertEquals(2, api.sends.size); assertEquals(original, api.sends.last())
        assertNull(controller.state.value.pending)
    }

    @Test fun duplicateTapsPersistBeforeDispatchAndCreateOneRequest() = runTest {
        val api = Api().apply { sendWait = CompletableDeferred(); outcome = "pending" }; val controller = controller(api, Session())
        val first = launch { controller.send("one action") }; runCurrent()
        assertNotNull(store.read(a, NativeWorkspaceController.PENDING_SLOT))
        controller.send("second tap")
        assertEquals(1, api.sends.size)
        api.sendWait!!.complete(Unit); first.join()
        assertEquals(ChatDelivery.ACCEPTED, controller.state.value.pending!!.delivery)
        controller.resendOriginal(); assertEquals(1, api.sends.size)
    }

    @Test fun signOutOrAccountChangeDropsPrivateRepliesAndPendingWork() = runTest {
        val api = Api().apply { outcome = "offline" }; val session = Session(); val controller = controller(api, session)
        controller.send("owner A action"); store.write(a, StateSlot.CHAT_DRAFT, "A draft")
        api.projectWait = CompletableDeferred()
        val request = launch { controller.refreshProjects() }; runCurrent()
        session.switch(b); runCurrent()
        api.projectWait!!.complete(Unit); request.join()
        assertEquals(b, controller.state.value.owner)
        assertTrue(controller.state.value.projects.isEmpty()); assertNull(controller.state.value.pending)
        assertNull(store.read(b, StateSlot.CHAT_DRAFT)); assertNull(store.read(b, NativeWorkspaceController.PENDING_SLOT))
        session.switch(null); runCurrent()
        assertNull(controller.state.value.owner); assertTrue(controller.state.value.chat.isEmpty())
    }

    @Test fun missingRequestCannotBeReleasedUntilANewerRevisionProvesItsPayloadStale() = runTest {
        val api = Api().apply { outcome = "stale"; revision = 2 }; val controller = controller(api, Session())
        controller.send("old draft"); val old = controller.state.value.pending!!
        controller.checkPending(); controller.releaseStaleMissingRequest()
        assertNotNull(controller.state.value.pending)
        api.revision = 1; controller.releaseStaleMissingRequest(); assertNotNull(controller.state.value.pending)
        api.revision = 4; controller.refreshChat(); controller.releaseStaleMissingRequest()
        assertNull(controller.state.value.pending); assertEquals(1, api.sends.size)
        api.outcome = "completed"; controller.send("reviewed new draft")
        assertEquals(2, api.sends.size); assertEquals(4, api.sends.last().expectedRevision)
        assertNotEquals(old.requestId, api.sends.last().requestId)
    }

    @Test fun welcomeGateBlocksChatAndProjectsUntilExplicitRefreshAfterBrowserCompletion() = runTest {
        val api = Api().apply { welcome = false }; val controller = controller(api, Session())
        assertTrue(controller.state.value.onboardingRequired); assertEquals(0, api.chatReads)
        controller.send("must not send"); controller.refreshProjects()
        assertTrue(api.sends.isEmpty()); assertEquals(0, api.projectReads)
        api.welcome = true; controller.refreshChat()
        assertFalse(controller.state.value.onboardingRequired); assertEquals(1, api.chatReads)
    }

    @Test fun uncertainSavedResultRequiresExplicitAcknowledgementAndNeverResends() = runTest {
        val api = Api().apply { outcome = "uncertain" }; val controller = controller(api, Session())
        controller.send("uncertain action")
        assertEquals("uncertain", controller.state.value.pending!!.status)
        controller.resendOriginal(); assertEquals(1, api.sends.size)
        controller.acknowledgeUncertain()
        assertNull(controller.state.value.pending); assertEquals("uncertain", controller.state.value.chat.single().status)
        assertEquals(1, api.sends.size)
    }

    @Test fun readbackMustMatchOriginalIdRevisionAndContentBeforeClearingPendingOrDraft() = runTest {
        val api = Api().apply { outcome = "lost" }; val controller = controller(api, Session())
        controller.send("original")
        val request = controller.state.value.pending!!
        api.turns[request.requestId] = api.turns.getValue(request.requestId).copy(userText = "different payload")
        controller.checkPending()
        assertNotNull(controller.state.value.pending); assertNull(controller.state.value.acceptedDraft)
        assertNotNull(store.read(a, NativeWorkspaceController.PENDING_SLOT))
    }
}
