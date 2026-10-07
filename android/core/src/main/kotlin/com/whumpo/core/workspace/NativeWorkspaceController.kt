package com.whumpo.core.workspace

import com.whumpo.core.account.AccountScope
import com.whumpo.core.account.AccountStateStore
import com.whumpo.core.account.StateKind
import com.whumpo.core.account.StateSlot
import com.whumpo.core.identity.IdentityFailure
import com.whumpo.core.identity.IdentityProtocol
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.withContext
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.util.Base64
import java.util.UUID
import java.time.Instant

/** Screen state contains no bearer, browser secret or provider credential. */
data class WorkspaceState(
    val owner: AccountScope? = null, val busy: Boolean = false, val loaded: Boolean = false,
    val onboardingRequired: Boolean = false, val revision: Int? = null, val mode: String? = null,
    val chat: List<NativeTurn> = emptyList(), val chatCursor: String? = null, val search: String = "",
    val projects: List<NativeProject> = emptyList(), val projectCursor: String? = null,
    val activity: List<NativeActivity> = emptyList(), val activityCursor: String? = null,
    val reviews: List<NativeReview> = emptyList(), val pendingApproval: PendingApproval? = null,
    val pending: PendingChat? = null, val acceptedDraft: Pair<String, String>? = null,
    val notice: String = "Sign in from Settings to connect this device.",
)

/** One current request, persisted before dispatch. Reconnect and process restart perform reads only. */
class NativeWorkspaceController(
    private val session: WorkspaceSession,
    private val store: AccountStateStore,
    private val api: NativeWorkspaceApi,
    private val io: CoroutineDispatcher,
    private val now: () -> Instant = { Instant.now() },
) {
    private val lock = Any()
    private var generation = 0L
    private val mutable = MutableStateFlow(WorkspaceState())
    val state = mutable.asStateFlow()

    suspend fun observeAccounts() = withContext(io) {
        session.activeAccount.collectLatest { owner ->
            synchronized(lock) {
                generation++
                val pending = owner?.let { readPending(it) }
                val approval = owner?.let { readApproval(it) }
                mutable.value = WorkspaceState(owner = owner, pending = pending, pendingApproval = approval,
                    notice = if (owner == null) "Sign in from Settings to connect this device."
                    else if (pending != null || approval != null) "A saved request needs a status check. It will not be sent automatically."
                    else "Refresh to load your workspace.")
            }
            if (owner != null) refreshChat()
        }
    }

    private fun claim(): Pair<Long, AccountScope>? = synchronized(lock) {
        val current = mutable.value
        val owner = current.owner ?: return@synchronized null
        if (current.busy || session.activeAccount.value != owner) return@synchronized null
        generation++
        mutable.value = current.copy(busy = true)
        generation to owner
    }
    private fun change(ticket: Long, owner: AccountScope, update: (WorkspaceState) -> WorkspaceState) = synchronized(lock) {
        if (generation == ticket && mutable.value.owner == owner && session.activeAccount.value == owner) mutable.value = update(mutable.value)
    }
    private suspend fun action(block: suspend (Long, AccountScope) -> Unit) = withContext(io) {
        val (ticket, owner) = claim() ?: return@withContext
        try { block(ticket, owner) }
        catch (error: Exception) {
            change(ticket, owner) { it.copy(notice = message(error), onboardingRequired = it.onboardingRequired || (error as? IdentityFailure)?.code == "onboarding_required") }
            if (error is CancellationException) throw error
        } finally { change(ticket, owner) { it.copy(busy = false) } }
    }
    private suspend fun bootstrap(ticket: Long, owner: AccountScope): Boolean {
        val value = session.authorized(owner) { api.bootstrap(it) }
        change(ticket, owner) { it.copy(loaded = true, onboardingRequired = !value.onboardingComplete, revision = value.revision, mode = value.mode) }
        if (!value.onboardingComplete) change(ticket, owner) { it.copy(notice = "Finish welcome in your browser, then refresh here.") }
        return value.onboardingComplete
    }

    suspend fun refreshChat(query: String = state.value.search) = action { ticket, owner ->
        val search = query.take(100).trim()
        if (bootstrap(ticket, owner)) {
            val page = session.authorized(owner) { api.chat(it, null, search) }
            change(ticket, owner) { it.copy(chat = page.items, chatCursor = page.nextCursor, search = search,
                revision = page.revision, mode = page.mode, notice = if (it.pending == null) "Conversation refreshed." else "Check the saved request before sending another.") }
        }
    }
    suspend fun olderChat() = action { ticket, owner ->
        val snapshot = state.value; val cursor = snapshot.chatCursor ?: return@action
        if (snapshot.chat.size >= 200) throw IdentityFailure("page_limit")
        val page = session.authorized(owner) { api.chat(it, cursor, snapshot.search) }
        change(ticket, owner) { it.copy(chat = (page.items + it.chat).distinctBy(NativeTurn::id), chatCursor = page.nextCursor,
            revision = page.revision, mode = page.mode, notice = "Earlier messages loaded.") }
    }
    suspend fun refreshProjects(more: Boolean = false) = action { ticket, owner ->
        if (!bootstrap(ticket, owner)) return@action
        val snapshot = state.value
        if (more && (snapshot.projectCursor == null || snapshot.projects.size >= 200)) return@action
        val page = session.authorized(owner) { api.projects(it, if (more) snapshot.projectCursor else null) }
        change(ticket, owner) { it.copy(projects = (if (more) it.projects + page.items else page.items).distinctBy(NativeProject::id),
            projectCursor = page.nextCursor, notice = "Projects refreshed.") }
    }
    suspend fun refreshActivity(more: Boolean = false) = action { ticket, owner ->
        if (!bootstrap(ticket, owner)) return@action
        val snapshot = state.value
        if (more && (snapshot.activityCursor == null || snapshot.activity.size >= 200)) return@action
        val page = session.authorized(owner) { api.activity(it, if (more) snapshot.activityCursor else null) }
        change(ticket, owner) { it.copy(activity = (if (more) it.activity + page.items else page.items).distinctBy(NativeActivity::id),
            activityCursor = page.nextCursor, notice = "Activity refreshed.") }
    }

    suspend fun send(content: String) = action { ticket, owner ->
        val snapshot = state.value
        val text = content.trim()
        if (!snapshot.loaded || snapshot.onboardingRequired || snapshot.revision == null || snapshot.pending != null || snapshot.pendingApproval != null || !validContent(text)) throw IdentityFailure("invalid_request")
        val pending = PendingChat(UUID.randomUUID().toString(), snapshot.revision, text)
        dispatch(ticket, owner, pending)
    }
    private suspend fun dispatch(ticket: Long, owner: AccountScope, pending: PendingChat) {
        val original = pending.copy(delivery = ChatDelivery.UNCONFIRMED, status = null)
        val result = session.authorized(owner) { token ->
            // Saving failure prevents dispatch. AccountStateStore rejects a late write for a previous owner.
            if (!store.write(owner, PENDING_SLOT, PendingEncoding.write(original))) throw IdentityFailure("identity_changed")
            change(ticket, owner) { it.copy(pending = original, notice = "Sending this saved request once…") }
            api.send(token, original)
        }
        if (result.requestId != original.requestId || result.revision != original.expectedRevision + 1) throw IdentityFailure("invalid_response")
        val accepted = original.copy(delivery = ChatDelivery.ACCEPTED, status = result.status)
        if (!store.write(owner, PENDING_SLOT, PendingEncoding.write(accepted))) throw IdentityFailure("identity_changed")
        change(ticket, owner) { it.copy(pending = accepted, revision = result.revision,
            acceptedDraft = original.requestId to original.content, notice = "Whumpo saved this request. Check its result; acceptance does not mean completion.") }
        readResult(ticket, owner, accepted)
    }
    suspend fun checkPending() = action { ticket, owner ->
        val pending = state.value.pending ?: return@action
        readResult(ticket, owner, pending)
    }
    private suspend fun readResult(ticket: Long, owner: AccountScope, pending: PendingChat) {
        val turn = try { session.authorized(owner) { api.turn(it, pending.requestId) } }
        catch (error: IdentityFailure) {
            if (error.code == "not_found" && pending.delivery != ChatDelivery.ACCEPTED) {
                val missing = pending.copy(delivery = ChatDelivery.NOT_FOUND)
                if (!store.write(owner, PENDING_SLOT, PendingEncoding.write(missing))) throw IdentityFailure("identity_changed")
                change(ticket, owner) { it.copy(pending = missing, notice = "No saved result was found. You may explicitly resend the exact original request, or keep checking.") }
                return
            }
            throw error
        }
        if (turn.id != pending.requestId || turn.revision != pending.expectedRevision + 1 || turn.userText != pending.content) throw IdentityFailure("invalid_response")
        val accepted = pending.copy(delivery = ChatDelivery.ACCEPTED, status = turn.status)
        val terminal = turn.status == "completed" || turn.status == "failed"
        if (terminal) store.remove(owner, PENDING_SLOT)
        else if (!store.write(owner, PENDING_SLOT, PendingEncoding.write(accepted))) throw IdentityFailure("identity_changed")
        change(ticket, owner) { it.copy(pending = if (terminal) null else accepted,
            chat = (it.chat.filterNot { old -> old.id == turn.id } + turn).sortedBy(NativeTurn::revision),
            revision = maxOf(it.revision ?: 0, turn.revision), acceptedDraft = pending.requestId to pending.content,
            notice = when (turn.status) {
                "completed" -> "The saved reply is available."
                "failed" -> "The saved request failed. Read its result before trying another action."
                "uncertain" -> "The saved request has an uncertain result. Nothing will be repeated automatically."
                else -> "The saved request is still pending. Check again when ready."
            }) }
    }
    suspend fun resendOriginal() = action { ticket, owner ->
        val pending = state.value.pending ?: return@action
        if (pending.delivery != ChatDelivery.NOT_FOUND || state.value.pendingApproval != null) throw IdentityFailure("invalid_request")
        dispatch(ticket, owner, pending)
    }
    /** A current missing receipt plus a newer monotonic revision proves this old payload cannot newly commit. */
    suspend fun releaseStaleMissingRequest() = action { ticket, owner ->
        val pending = state.value.pending ?: return@action
        if (pending.delivery != ChatDelivery.NOT_FOUND) throw IdentityFailure("invalid_request")
        if (!bootstrap(ticket, owner) || (state.value.revision ?: -1) <= pending.expectedRevision) throw IdentityFailure("invalid_request")
        try {
            session.authorized(owner) { api.turn(it, pending.requestId) }
            readResult(ticket, owner, pending)
            return@action
        } catch (error: IdentityFailure) { if (error.code != "not_found") throw error }
        store.remove(owner, PENDING_SLOT)
        change(ticket, owner) { it.copy(pending = null, notice = "The missing request used an older conversation revision and cannot start now. Review your draft before sending a new request.") }
    }

    /** Keeps a known uncertain turn in history; this only unlocks composing another request. */
    suspend fun acknowledgeUncertain() = action { ticket, owner ->
        val pending = state.value.pending ?: return@action
        if (pending.delivery != ChatDelivery.ACCEPTED || pending.status != "uncertain") throw IdentityFailure("invalid_request")
        store.remove(owner, PENDING_SLOT)
        change(ticket, owner) { it.copy(pending = null, notice = "The uncertain result remains in history. Review it before starting a different request.") }
    }
    fun hasFreshProof(): Boolean = session.hasFreshProof()

    suspend fun refreshReviews() = action { ticket, owner ->
        if (!bootstrap(ticket, owner)) return@action
        val reviews = session.authorized(owner) { api.reviews(it) }
        reviews.forEach { it.validate() }
        change(ticket, owner) { it.copy(reviews = reviews, notice = "Read every disclosure and the complete saved program before choosing an approval.") }
    }
    suspend fun approveReview(reviewId: String, fingerprint: String, acknowledged: Boolean, confirmation: String) = action { ticket, owner ->
        val snapshot = state.value
        if (!acknowledged || snapshot.pending != null || !snapshot.loaded || snapshot.onboardingRequired || snapshot.revision == null) throw IdentityFailure("invalid_request")
        val currentReviews = session.authorized(owner) { api.reviews(it) }
        currentReviews.forEach { it.validate() }
        change(ticket, owner) { it.copy(reviews = currentReviews) }
        val review = currentReviews.singleOrNull { it.id == reviewId } ?: throw IdentityFailure("review_unavailable")
        review.validate()
        if (!review.current(now()) || review.fingerprint() != fingerprint || review.control == null) throw IdentityFailure("review_unavailable")
        if (review.kind == ReviewKind.RESTORE && confirmation != "RESTORE") throw IdentityFailure("invalid_request")
        if (review.requiresFreshPasskey && !session.hasFreshProof()) throw IdentityFailure("fresh_passkey_required")
        val prior = snapshot.pendingApproval
        if (prior != null && (prior.delivery != ChatDelivery.NOT_FOUND || prior.fingerprint != fingerprint || prior.control != review.control)) throw IdentityFailure("review_unavailable")
        val pending = prior?.copy(delivery = ChatDelivery.UNCONFIRMED, status = null)
            ?: PendingApproval(UUID.randomUUID().toString(), snapshot.revision, review.control, fingerprint, review.expiresAt)
        val result = session.authorized(owner) { token ->
            if (!store.write(owner, APPROVAL_SLOT, ApprovalEncoding.write(pending))) throw IdentityFailure("identity_changed")
            change(ticket, owner) { it.copy(pendingApproval = pending, notice = "Sending this exact approval once…") }
            api.approve(token, pending)
        }
        if (result.requestId != pending.requestId || result.revision != pending.expectedRevision + 1) throw IdentityFailure("invalid_response")
        val accepted = pending.copy(delivery = ChatDelivery.ACCEPTED, status = result.status)
        if (!store.write(owner, APPROVAL_SLOT, ApprovalEncoding.write(accepted))) throw IdentityFailure("identity_changed")
        change(ticket, owner) { it.copy(pendingApproval = accepted, revision = result.revision, notice = "The approval has a saved result. Checking it does not repeat the action.") }
        readApprovalResult(ticket, owner, accepted)
    }
    suspend fun checkPendingApproval() = action { ticket, owner ->
        val pending = state.value.pendingApproval ?: return@action
        readApprovalResult(ticket, owner, pending)
    }
    private suspend fun readApprovalResult(ticket: Long, owner: AccountScope, pending: PendingApproval) {
        // Receipt recovery never needs a still-open/unexpired review or a new passkey proof.
        val turn = try { session.authorized(owner) { api.turn(it, pending.requestId) } }
        catch (error: IdentityFailure) {
            if (error.code == "not_found" && pending.delivery != ChatDelivery.ACCEPTED) {
                val missing = pending.copy(delivery = ChatDelivery.NOT_FOUND)
                if (!store.write(owner, APPROVAL_SLOT, ApprovalEncoding.write(missing))) throw IdentityFailure("identity_changed")
                change(ticket, owner) { it.copy(pendingApproval = missing, notice = "No saved approval was found. Any retry requires reading the unchanged current review and explicitly approving its original request again.") }
                return
            }
            throw error
        }
        if (turn.id != pending.requestId || turn.revision != pending.expectedRevision + 1 || turn.userText != pending.control.label) throw IdentityFailure("invalid_response")
        val terminal = turn.status == "completed" || turn.status == "failed"
        if (terminal) store.remove(owner, APPROVAL_SLOT)
        else if (!store.write(owner, APPROVAL_SLOT, ApprovalEncoding.write(pending.copy(delivery = ChatDelivery.ACCEPTED, status = turn.status)))) throw IdentityFailure("identity_changed")
        change(ticket, owner) { it.copy(pendingApproval = if (terminal) null else pending.copy(delivery = ChatDelivery.ACCEPTED, status = turn.status),
            chat = (it.chat.filterNot { old -> old.id == turn.id } + turn).sortedBy(NativeTurn::revision), revision = maxOf(it.revision ?: 0, turn.revision),
            reviews = it.reviews.filterNot { review -> terminal && review.id == pending.control.reviewId },
            notice = when (turn.status) {
                "completed" -> "The saved approval result is available. Read its exact outcome below."
                "failed" -> "The saved approval failed. Read its result before starting another review."
                "uncertain" -> "This approval has an uncertain saved result. Nothing will be repeated automatically."
                else -> "The approval is still pending. Check its saved result again when ready."
            }) }
    }
    suspend fun releaseStaleMissingApproval() = action { ticket, owner ->
        val pending = state.value.pendingApproval ?: return@action
        if (pending.delivery != ChatDelivery.NOT_FOUND || !bootstrap(ticket, owner) || (state.value.revision ?: -1) <= pending.expectedRevision) throw IdentityFailure("invalid_request")
        try {
            session.authorized(owner) { api.turn(it, pending.requestId) }
            readApprovalResult(ticket, owner, pending); return@action
        } catch (error: IdentityFailure) { if (error.code != "not_found") throw error }
        store.remove(owner, APPROVAL_SLOT)
        change(ticket, owner) { it.copy(pendingApproval = null, notice = "The missing approval used an older conversation revision and cannot start now. Read a current review before any new approval.") }
    }
    suspend fun acknowledgeUncertainApproval() = action { ticket, owner ->
        val pending = state.value.pendingApproval ?: return@action
        if (pending.delivery != ChatDelivery.ACCEPTED || pending.status != "uncertain") throw IdentityFailure("invalid_request")
        store.remove(owner, APPROVAL_SLOT)
        change(ticket, owner) { it.copy(pendingApproval = null, notice = "The uncertain approval result remains in history. Check the actual application before authorizing anything else.") }
    }
    private fun readApproval(owner: AccountScope): PendingApproval? {
        val value = store.read(owner, APPROVAL_SLOT) ?: return null
        return try { ApprovalEncoding.read(value) } catch (_: Exception) { store.remove(owner, APPROVAL_SLOT); null }
    }

    private fun readPending(owner: AccountScope): PendingChat? {
        val raw = store.read(owner, PENDING_SLOT) ?: return null
        return try { PendingEncoding.read(raw) } catch (_: Exception) { store.remove(owner, PENDING_SLOT); null }
    }
    private fun message(error: Exception) = when ((error as? IdentityFailure)?.code) {
        "fresh_passkey_required" -> "Verify with a passkey, then read and explicitly approve the current review. Your session remains signed in."
        "review_unavailable" -> "This exact review changed, expired or is unavailable. Refresh and read the current review; no approval was repeated."
        "onboarding_required" -> "Finish welcome in your browser, then refresh here."
        "client_update_required" -> "Update Whumpo to use this workspace. Your saved request will not be repeated."
        "stale_revision" -> "The conversation changed. Check the saved request and refresh before starting another action."
        "chat_busy" -> "Another reply is pending. Refresh the conversation or check your saved request."
        "request_conflict" -> "This request conflicts with saved work. Check its original result; do not change and resend its payload."
        "rate_limited" -> "Too many requests. Wait a minute, then refresh or check the saved request."
        "page_limit" -> "Refresh or narrow the search to view a different part of the conversation."
        "proof_required", "identity_changed", "identity_incomplete" -> "Sign in again from Settings."
        "invalid_request" -> "Enter 1–1000 characters and resolve the saved request before sending."
        else -> "The reply could not be confirmed. Refresh or check the saved request; nothing will be sent again automatically."
    }
    companion object {
        val APPROVAL_SLOT = StateSlot(StateKind.PENDING_OPERATION, "native-approval-v1")
        val PENDING_SLOT = StateSlot(StateKind.PENDING_OPERATION, "native-chat-v1")
        fun validContent(value: String) = value.isNotBlank() && value.length <= 1000 && value.none { it.code in 0..8 || it.code in 11..12 || it.code in 14..31 || it.code == 127 }
    }
}

private object PendingEncoding {
    fun write(value: PendingChat): String = Base64.getEncoder().encodeToString(ByteArrayOutputStream().use { bytes ->
        DataOutputStream(bytes).use { it.writeInt(1); it.writeUTF(value.requestId); it.writeInt(value.expectedRevision); it.writeUTF(value.content); it.writeUTF(value.delivery.name); it.writeUTF(value.status.orEmpty()) }
        bytes.toByteArray()
    })
    fun read(value: String): PendingChat {
        require(value.length <= 16_384)
        val input = DataInputStream(ByteArrayInputStream(Base64.getDecoder().decode(value)))
        require(input.readInt() == 1)
        val result = PendingChat(input.readUTF(), input.readInt(), input.readUTF(), ChatDelivery.valueOf(input.readUTF()), input.readUTF().ifEmpty { null })
        require(input.available() == 0 && IdentityProtocol.uuid.matches(result.requestId) && result.expectedRevision in 0..2000 && NativeWorkspaceController.validContent(result.content))
        require(result.status == null || result.status in setOf("pending", "completed", "failed", "uncertain"))
        return result
    }
}
