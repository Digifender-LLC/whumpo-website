package com.whumpo.core.workspace

import com.whumpo.core.account.*
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
import java.time.Instant

@OptIn(ExperimentalCoroutinesApi::class)
class NativeApprovalTest {
    @get:Rule val temp = TemporaryFolder()
    private val clock = Instant.parse("2026-10-07T12:00:00Z")
    private val owner = AccountScope.of("00000000-0000-4000-8000-000000000001")
    private val reviewId = "00000000-0000-4000-8000-000000000002"
    private val project = "00000000-0000-4000-8000-000000000003"
    private val box = object : SecretBox {
        val delegate = FakeSecretBox(); var fail = false
        override fun seal(plaintext: ByteArray, associatedData: ByteArray): ByteArray { check(!fail); return delegate.seal(plaintext, associatedData) }
        override fun open(ciphertext: ByteArray, associatedData: ByteArray) = delegate.open(ciphertext, associatedData)
        override fun destroyKey() = delegate.destroyKey()
    }
    private val store by lazy { AccountStateStore(File(temp.root, "state"), box) }
    private fun review(restore: Boolean = false): NativeReview {
        val kind = if (restore) ReviewKind.RESTORE else ReviewKind.APPLICATION
        val source = if (restore) null else "export default (document, input) => ({document, result: input});"
        return NativeReview(kind, reviewId, project, "Private project", "pending", clock.plusSeconds(600), true,
            ReviewControl(kind, reviewId, if (restore) project else null), restore, "Exact saved effect", listOf("Every document will change.", "Publication is separate."),
            null, source, source?.let { digest(it.toByteArray()) }, null)
    }
    private inner class Session : WorkspaceSession {
        override val activeAccount = MutableStateFlow<AccountScope?>(owner)
        var fresh = false; var epoch = 0
        init { store.activate(owner) }
        override fun hasFreshProof() = fresh
        fun leave() { epoch++; store.signOut(); activeAccount.value = null }
        override suspend fun <T> authorized(owner: AccountScope, action: suspend (String) -> T): T {
            val expected = epoch
            if (activeAccount.value != owner) throw IdentityFailure("proof_required")
            val result = action("a".repeat(64))
            if (expected != epoch || activeAccount.value != owner) throw CancellationException("Account changed")
            return result
        }
    }
    private inner class Api : NativeWorkspaceApi {
        var items = listOf(review()); var revision = 0; var outcome = "completed"
        var gate: CompletableDeferred<Unit>? = null
        val approvals = mutableListOf<PendingApproval>(); val messages = mutableListOf<PendingChat>()
        val turns = mutableMapOf<String, NativeTurn>(); var reads = 0
        override suspend fun bootstrap(token: String) = WorkspaceBootstrap(true, revision, "guided", 1, items.size)
        override suspend fun reviews(token: String) = items
        override suspend fun chat(token: String, cursor: String?, query: String) = NativeChatPage(revision, "guided", turns.values.toList(), null)
        override suspend fun projects(token: String, cursor: String?) = NativePage<NativeProject>(emptyList(), null)
        override suspend fun activity(token: String, cursor: String?) = NativePage<NativeActivity>(emptyList(), null)
        override suspend fun turn(token: String, requestId: String): NativeTurn { reads++; return turns[requestId] ?: throw IdentityFailure("not_found") }
        override suspend fun send(token: String, request: PendingChat): ChatAcceptance { messages += request; throw IdentityFailure("network") }
        override suspend fun approve(token: String, request: PendingApproval): ChatAcceptance {
            approvals += request; gate?.await()
            if (outcome == "offline") throw IdentityFailure("network")
            if (outcome == "fresh") throw IdentityFailure("fresh_passkey_required")
            check(revision == request.expectedRevision); revision++
            val status = if (outcome == "lost") "completed" else outcome
            turns[request.requestId] = NativeTurn(request.requestId, revision, status, "guided", clock.toString(), request.control.label, "Exact saved result", false, false)
            if (outcome == "lost") throw IdentityFailure("network")
            return ChatAcceptance(request.requestId, revision, status)
        }
    }
    private fun TestScope.controller(api: Api, session: Session): NativeWorkspaceController {
        val result = NativeWorkspaceController(session, store, api, StandardTestDispatcher(testScheduler)) { clock }
        backgroundScope.launch { result.observeAccounts() }; runCurrent()
        return result
    }
    private suspend fun NativeWorkspaceController.approve(value: NativeReview, text: String = "") = approveReview(value.id, value.fingerprint(), true, text)

    @Test fun sourceDigestAndEveryDisclosureBindApprovalAndChangedMetadataNeverDispatches() = runTest {
        val api = Api(); val controller = controller(api, Session()); val original = api.items.single()
        val different = original.copy(lines = original.lines + "New consequence.")
        assertNotEquals(original.fingerprint(), different.fingerprint())
        assertThrows(IdentityFailure::class.java) { original.copy(sourceDigest = "0".repeat(64)).validate() }
        val large = "é".repeat(5000)
        assertThrows(IdentityFailure::class.java) { original.copy(source = large, sourceDigest = digest(large.toByteArray())).validate() }
        api.items = listOf(different); controller.approve(original)
        assertTrue(api.approvals.isEmpty()); assertNull(controller.state.value.pendingApproval)
        assertEquals(different, controller.state.value.reviews.single())
        controller.approve(different); assertEquals(1, api.approvals.size)
    }
    @Test fun restoreNeedsLiteralAcknowledgementAndFreshProofThenAnIndependentApproval() = runTest {
        val api = Api().apply { items = listOf(review(true)) }; val session = Session(); val controller = controller(api, session); val review = api.items.single()
        controller.approve(review, "RESTORE"); assertTrue(api.approvals.isEmpty())
        session.fresh = true
        assertTrue(api.approvals.isEmpty())
        controller.approve(review, "restore"); assertTrue(api.approvals.isEmpty())
        controller.approve(review, "RESTORE"); assertEquals(review.control, api.approvals.single().control)
        assertNull(controller.state.value.pendingApproval); assertNull(controller.state.value.acceptedDraft)
    }
    @Test fun lostApprovalReplyRecoversAfterRestartEvenWhenTheReviewExpiredOrDisappeared() = runTest {
        val api = Api().apply { outcome = "lost" }; val session = Session(); val first = controller(api, session)
        store.write(owner, StateSlot.CHAT_DRAFT, "unrelated unsent draft")
        first.approve(api.items.single()); val pending = first.state.value.pendingApproval!!
        api.items = emptyList()
        val restarted = controller(api, session)
        assertEquals(pending, restarted.state.value.pendingApproval); assertEquals(1, api.approvals.size); assertEquals(0, api.reads)
        restarted.checkPendingApproval()
        assertNull(restarted.state.value.pendingApproval); assertNull(store.read(owner, NativeWorkspaceController.APPROVAL_SLOT))
        assertEquals(1, api.approvals.size); assertEquals("unrelated unsent draft", store.read(owner, StateSlot.CHAT_DRAFT))
        assertNull(restarted.state.value.acceptedDraft)
    }
    @Test fun explicitMissingReceiptRetryKeepsOriginalIdRevisionControlAndRequiresUnchangedReview() = runTest {
        val api = Api().apply { outcome = "offline" }; val controller = controller(api, Session()); val original = api.items.single()
        controller.approve(original); val first = api.approvals.single()
        controller.approve(original); assertEquals(1, api.approvals.size)
        controller.checkPendingApproval(); assertEquals(ChatDelivery.NOT_FOUND, controller.state.value.pendingApproval!!.delivery)
        api.items = listOf(original.copy(expiresAt = original.expiresAt.plusSeconds(10)))
        controller.approve(original); assertEquals(1, api.approvals.size)
        api.items = listOf(original); api.outcome = "completed"; controller.approve(original)
        assertEquals(listOf(first, first), api.approvals); assertNull(controller.state.value.pendingApproval)
    }
    @Test fun dualSavedSlotsOnRestartBlockAllNewDispatchButPermitIndependentReadbacks() = runTest {
        val api = Api().apply { outcome = "offline" }; val session = Session(); val first = controller(api, session)
        first.send("existing Chat request")
        val original = api.items.single()
        val approval = PendingApproval("00000000-0000-4000-8000-000000000004", 0, original.control!!, original.fingerprint(), original.expiresAt)
        store.write(owner, NativeWorkspaceController.APPROVAL_SLOT, ApprovalEncoding.write(approval))
        val restarted = controller(api, session)
        assertNotNull(restarted.state.value.pending); assertNotNull(restarted.state.value.pendingApproval)
        restarted.send("new"); restarted.approve(original); restarted.resendOriginal()
        assertEquals(1, api.messages.size); assertTrue(api.approvals.isEmpty()); assertEquals(0, api.reads)
        restarted.checkPending(); restarted.checkPendingApproval()
        assertEquals(2, api.reads); assertEquals(ChatDelivery.NOT_FOUND, restarted.state.value.pending!!.delivery)
        assertEquals(ChatDelivery.NOT_FOUND, restarted.state.value.pendingApproval!!.delivery)
        restarted.resendOriginal(); restarted.approve(original)
        assertEquals(1, api.messages.size); assertTrue(api.approvals.isEmpty())
    }
    @Test fun persistenceFailureDuplicateTapsAndAccountChangeCannotDispatchOrRestoreLateApproval() = runTest {
        val api = Api(); val session = Session(); val controller = controller(api, session); val review = api.items.single()
        box.fail = true; controller.approve(review); assertTrue(api.approvals.isEmpty()); assertNull(controller.state.value.pendingApproval)
        box.fail = false; api.gate = CompletableDeferred()
        val action = launch { controller.approve(review) }; runCurrent()
        assertNotNull(store.read(owner, NativeWorkspaceController.APPROVAL_SLOT))
        controller.send("parallel text"); controller.approve(review)
        assertEquals(1, api.approvals.size); assertTrue(api.messages.isEmpty())
        session.leave(); runCurrent(); api.gate!!.complete(Unit); action.join()
        assertNull(controller.state.value.owner); assertNull(controller.state.value.pendingApproval); assertTrue(controller.state.value.chat.isEmpty())
    }
    @Test fun unknownPendingReceiptCannotBeReleasedWithoutStrictlyNewerRevisionAndFreshMissingReadback() = runTest {
        val api = Api().apply { outcome = "offline"; revision = 2 }; val controller = controller(api, Session())
        controller.approve(api.items.single()); controller.checkPendingApproval()
        controller.releaseStaleMissingApproval(); assertNotNull(controller.state.value.pendingApproval)
        api.revision = 1; controller.releaseStaleMissingApproval(); assertNotNull(controller.state.value.pendingApproval)
        api.revision = 3; controller.releaseStaleMissingApproval(); assertNull(controller.state.value.pendingApproval)
        assertEquals(1, api.approvals.size)
    }
}
