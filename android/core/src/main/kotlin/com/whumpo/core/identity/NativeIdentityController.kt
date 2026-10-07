package com.whumpo.core.identity

import com.whumpo.core.account.AccountScope
import com.whumpo.core.account.AccountStateStore
import com.whumpo.core.account.StateKind
import com.whumpo.core.account.StateSlot
import com.whumpo.core.data.AccountRepository
import com.whumpo.core.environment.WhumpoEnvironment
import com.whumpo.core.workspace.WorkspaceSession
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import java.time.Instant

/** Non-sensitive state only; no token, verifier, code, browser path or passkey response reaches UI state. */
data class IdentityState(
    val busy: Boolean = false,
    val signedIn: Boolean = false,
    val label: String? = null,
    val message: String = "Sign in to connect this device.",
    val browserPending: Boolean = false,
    val returnReady: Boolean = false,
    val savedSession: Boolean = false,
    val updateRequired: Boolean = false,
    val accountClosing: Boolean = false,
    val localCleanupFailed: Boolean = false,
)

/** One current flow, explicit network writes, durable encrypted PKCE and generation fences across every await. */
class NativeIdentityController(
    private val api: NativeIdentityApi,
    private val store: AccountStateStore,
    private val pendingStore: PendingIdentityStore,
    private val environment: WhumpoEnvironment,
    private val io: CoroutineDispatcher,
    private val now: () -> Instant = { Instant.now() },
) : AccountRepository, WorkspaceSession {
    private val lock = Any()
    private var generation = 0L
    private var session: NativeSession? = null
    private var initialized = false
    private val ready = CompletableDeferred<Unit>()
    private val active = MutableStateFlow<AccountScope?>(null)
    override val activeAccount: StateFlow<AccountScope?> = active.asStateFlow()
    private val mutableState = MutableStateFlow(IdentityState(busy = true, message = "Checking this device…"))
    val state: StateFlow<IdentityState> = mutableState.asStateFlow()

    suspend fun initialize() = withContext(io) {
        val start = synchronized(lock) { if (initialized) false else { initialized = true; true } }
        if (!start) return@withContext
        try {
            store.restore()
            val owner = store.activeAccount.value
            val saved = owner?.let { store.read(it, SESSION_SLOT) }?.let { SessionEncoding.read(it, now()) }
            synchronized(lock) {
                session = saved
                if (saved == null && owner != null) store.signOut()
                val closing = saved != null && store.read(owner, CLOSING_SLOT) == "1"
                mutableState.value = IdentityState(savedSession = saved != null, accountClosing = closing,
                    message = if (closing) CLOSING_MESSAGE else "Sign in to connect this device.")
                if (closing) {
                    eraseForClosure(owner, saved)
                } else showPending()
            }
        } catch (_: Exception) {
            synchronized(lock) { if (!mutableState.value.accountClosing) mutableState.value = IdentityState(message = "Protected state could not be opened. Sign in again.") }
        } finally { ready.complete(Unit) }
        if (synchronized(lock) { session != null && !mutableState.value.accountClosing && pendingStore.read(now()) == null }) checkSession()
    }

    private fun claim(): Long? = synchronized(lock) {
        if (mutableState.value.busy || mutableState.value.accountClosing || mutableState.value.localCleanupFailed) return@synchronized null
        generation += 1
        mutableState.value = mutableState.value.copy(busy = true, message = "Working…", updateRequired = false)
        generation
    }
    private fun current(ticket: Long) = synchronized(lock) { generation == ticket }
    private fun requireCurrent(ticket: Long) { if (!current(ticket)) throw CancellationException("Identity action cancelled") }
    private fun settle(ticket: Long, update: () -> Unit) = synchronized(lock) { if (generation == ticket) update() }

    private fun showPending() {
        val pending = pendingStore.read(now())
        mutableState.value = mutableState.value.copy(
            browserPending = pending?.phase == PendingPhase.BROWSER,
            returnReady = pending?.phase == PendingPhase.RETURNED,
            message = if (mutableState.value.updateRequired) mutableState.value.message else when (pending?.phase) {
                PendingPhase.BROWSER -> "Finish in the browser, then return here."
                PendingPhase.RETURNED -> "Browser sign-in is ready. Confirm to connect this device."
                PendingPhase.STARTING, PendingPhase.EXCHANGING -> "The previous reply was not saved. Start a new sign-in; it will not be repeated automatically."
                null -> mutableState.value.message
            },
        )
    }

    private fun failed(ticket: Long, error: Exception) = settle(ticket) {
        val code = (error as? IdentityFailure)?.code
        var cleanupFailed = false
        if (code in setOf("proof_required", "identity_changed", "identity_incomplete")) {
            session = null; active.value = null
            try { store.signOut() } catch (_: Exception) { cleanupFailed = true }
            try { pendingStore.clear() } catch (_: Exception) { cleanupFailed = true }
        }
        mutableState.value = mutableState.value.copy(
            busy = false, signedIn = active.value != null, localCleanupFailed = cleanupFailed,
            label = if (active.value != null) mutableState.value.label else null,
            savedSession = session != null && active.value == null,
            updateRequired = code == "client_update_required",
            message = if (cleanupFailed) "This device is frozen. Local cleanup could not be confirmed; erase this app’s storage before signing in again." else when (code) {
                "client_update_required" -> "Update Whumpo to sign in. Account recovery is available on the website."
                "proof_required", "identity_changed" -> "Your session is no longer available. Sign in again."
                "identity_incomplete" -> "Complete account setup or recovery on the website first."
                "invalid_return" -> "This browser return does not match the sign-in started on this device."
                "expired" -> "This sign-in expired. Start again."
                "cancelled" -> "Sign-in cancelled."
                "no_passkey" -> "No Whumpo passkey was found. Sign in or recover your account through the browser."
                "rate_limited" -> "Too many requests. Wait a minute, then try again."
                "unavailable" -> "Native sign-in is not available right now. Use the website or try again later."
                else -> if (error is CancellationException) "Sign-in cancelled." else "The request could not be confirmed. Nothing will be sent again automatically."
            },
        )
        showPending()
    }

    private fun validate(info: VerifiedAccount, candidate: NativeSession) {
        if (!IdentityProtocol.uuid.matches(info.id) || info.label.isBlank() || info.label.length > 100 ||
            info.label.any { it.isISOControl() } || info.expiresAt != candidate.expiresAt || !info.expiresAt.isAfter(now())) {
            throw IdentityFailure("invalid_response")
        }
    }

    private suspend fun install(ticket: Long, candidate: NativeSession, expected: AccountScope? = null) {
        requireCurrent(ticket)
        val account = api.session(candidate.token)
        validate(account, candidate)
        val owner = AccountScope.of(account.id)
        if (expected != null && expected != owner) throw IdentityFailure("identity_changed")
        settle(ticket) {
            val verified = NativeSession(candidate.token, account.expiresAt, account.freshUntil)
            store.activate(owner)
            if (!store.write(owner, SESSION_SLOT, SessionEncoding.write(verified))) throw IdentityFailure("identity_changed")
            pendingStore.clear(); session = verified; active.value = owner
            mutableState.value = IdentityState(signedIn = true, label = account.label, message = "This device is connected.")
        }
        if (!current(ticket)) {
            // A successful login whose reply crossed sign-out must not leave a usable orphan session.
            discardIssued(candidate)
        }
    }

    private suspend fun discardIssued(candidate: NativeSession) = withContext(NonCancellable) {
        // Navigation cancellation must not prevent this one bounded cleanup attempt; never retry it.
        try { withTimeout(30_000) { api.logout(candidate.token) } } catch (_: Exception) { /* Locally discarded. */ }
    }

    suspend fun checkSession() = withContext(io) {
        ready.await()
        val ticket = claim() ?: return@withContext
        try {
            val candidate = synchronized(lock) { session } ?: throw IdentityFailure("proof_required")
            val expected = store.activeAccount.value ?: throw IdentityFailure("proof_required")
            install(ticket, candidate, expected)
        } catch (error: Exception) { failed(ticket, error); if (error is CancellationException) throw error }
    }

    suspend fun passkey(prompt: PasskeyPrompt, reauthenticate: Boolean = false) = withContext(io) {
        ready.await()
        val ticket = claim() ?: return@withContext
        var issued: NativeSession? = null
        try {
            synchronized(lock) { pendingStore.clear() }
            val previous = synchronized(lock) { session }
            val bearer = if (reauthenticate) previous?.token ?: throw IdentityFailure("proof_required") else null
            api.checkConfiguration()
            requireCurrent(ticket)
            val challenge = api.challenge(bearer)
            requireCurrent(ticket)
            if (!challenge.expiresAt.isAfter(now())) throw IdentityFailure("expired")
            val credential = prompt.authenticate(challenge.options)
            requireCurrent(ticket)
            if (!challenge.expiresAt.isAfter(now())) throw IdentityFailure("expired")
            val candidate = api.verify(challenge.id, credential, bearer)
            issued = if (reauthenticate) null else candidate
            requireCurrent(ticket)
            if (reauthenticate && (candidate.token != previous?.token || candidate.expiresAt != previous.expiresAt)) throw IdentityFailure("invalid_response")
            install(ticket, candidate, if (reauthenticate) active.value else null)
        } catch (error: Exception) {
            if (issued != null && synchronized(lock) { session?.token != issued.token }) discardIssued(issued)
            failed(ticket, error); if (error is CancellationException) throw error
        }
    }

    suspend fun beginBrowser(purpose: BrowserPurpose): String? = withContext(io) {
        ready.await()
        val ticket = claim() ?: return@withContext null
        try {
            api.checkConfiguration()
            requireCurrent(ticket)
            val pending = PendingIdentity(purpose, IdentityProtocol.random(), IdentityProtocol.random(), now().plusSeconds(300), PendingPhase.STARTING)
            settle(ticket) { pendingStore.save(pending) }
            requireCurrent(ticket)
            val started = api.start(purpose, pending.state, IdentityProtocol.challenge(pending.verifier))
            requireCurrent(ticket)
            if (!IdentityProtocol.uuid.matches(started.id) || !IdentityProtocol.browserPath(started.browserPath) ||
                !started.expiresAt.isAfter(now()) || started.expiresAt.isAfter(now().plusSeconds(301))) throw IdentityFailure("invalid_response")
            settle(ticket) {
                pendingStore.save(pending.move(PendingPhase.BROWSER, started.id, started.browserPath, started.expiresAt))
                mutableState.value = mutableState.value.copy(busy = false); showPending()
            }
            if (current(ticket)) environment.origin + started.browserPath else null
        } catch (error: Exception) { failed(ticket, error); if (error is CancellationException) throw error; null }
    }

    suspend fun resumeBrowser(): String? = withContext(io) {
        ready.await()
        synchronized(lock) {
            val pending = pendingStore.read(now())
            if (mutableState.value.busy || pending?.phase != PendingPhase.BROWSER) null
            else environment.origin + pending.browserPath
        }
    }

    /** App Link arrival only stages encrypted state. Exchange always needs the visible Finish sign in button. */
    suspend fun receiveReturn(uri: String) = withContext(io) {
        ready.await()
        synchronized(lock) {
            if (mutableState.value.accountClosing || mutableState.value.localCleanupFailed) return@synchronized
            try {
                val incoming = IdentityProtocol.parseReturn(uri)
                val pending = pendingStore.read(now()) ?: throw IdentityFailure("invalid_return")
                if (mutableState.value.busy || pending.phase != PendingPhase.BROWSER || pending.handoffId != incoming.handoffId) throw IdentityFailure("invalid_return")
                pendingStore.save(pending.move(PendingPhase.RETURNED, code = incoming.code)); showPending()
            } catch (_: Exception) {
                mutableState.value = mutableState.value.copy(message = "This browser return is expired, already used or belongs to another sign-in.")
            }
        }
    }

    suspend fun completeBrowser() = withContext(io) {
        ready.await()
        val ticket = claim() ?: return@withContext
        var issued: NativeSession? = null
        try {
            val pending = synchronized(lock) {
                val saved = pendingStore.read(now()) ?: throw IdentityFailure("expired")
                if (saved.phase != PendingPhase.RETURNED) throw IdentityFailure("invalid_return")
                pendingStore.save(saved.move(PendingPhase.EXCHANGING)); saved
            }
            requireCurrent(ticket)
            val candidate = api.exchange(pending.handoffId, pending.code, pending.state, pending.verifier)
            issued = candidate
            requireCurrent(ticket)
            install(ticket, candidate)
        } catch (error: Exception) {
            if (issued != null && synchronized(lock) { session?.token != issued.token }) discardIssued(issued)
            failed(ticket, error); if (error is CancellationException) throw error
        }
    }

    suspend fun cancel() = withContext(io) {
        ready.await()
        synchronized(lock) {
            if (mutableState.value.accountClosing || mutableState.value.localCleanupFailed) return@synchronized
            generation += 1; pendingStore.clear()
            mutableState.value = IdentityState(signedIn = active.value != null, label = mutableState.value.label,
                savedSession = session != null && active.value == null, message = "Sign-in cancelled.")
        }
    }

    override suspend fun signOut() = withContext(io) {
        ready.await()
        val (ticket, token) = synchronized(lock) {
            generation += 1
            val old = session?.token
            session = null; active.value = null
            var clean = true
            try { pendingStore.clear() } catch (_: Exception) { clean = false }
            try { store.signOut() } catch (_: Exception) { clean = false }
            mutableState.value = IdentityState(localCleanupFailed = !clean, message = if (clean) "Signed out on this device." else "This device is frozen. Local cleanup could not be confirmed; erase this app’s storage before signing in again.")
            generation to old
        }
        if (token != null) try { api.logout(token) } catch (error: Exception) {
            if ((error as? IdentityFailure)?.code != "proof_required") settle(ticket) {
                mutableState.value = mutableState.value.copy(message = if (mutableState.value.localCleanupFailed) "This device is frozen. Local cleanup and server sign-out could not be confirmed. Erase this app’s storage and revoke the session on the website." else "Signed out on this device. Server sign-out was not confirmed; revoke this session on the website if needed.")
            }
            if (error is CancellationException) throw error
        }
    }

    private fun freezeForClosure(ticket: Long) = settle(ticket) {
        val owner = store.activeAccount.value
        val candidate = session
        generation++
        active.value = null
        mutableState.value = IdentityState(savedSession = candidate != null, accountClosing = true, message = CLOSING_MESSAGE)
        eraseForClosure(owner, candidate)
    }

    private fun eraseForClosure(owner: AccountScope?, candidate: NativeSession?) {
        var failed = false
        try { pendingStore.clear() } catch (_: Exception) { failed = true }
        try {
            if (owner != null && candidate != null) store.retainSessionOnly(owner, CLOSING_SLOT,
                linkedMapOf(CLOSING_SLOT to "1", SESSION_SLOT to SessionEncoding.write(candidate)))
            else store.signOut()
        } catch (_: Exception) { failed = true }
        if (failed) mutableState.value = mutableState.value.copy(message = "Account closure is in progress. This device is frozen, but local cleanup could not be fully confirmed. Sign out or erase this app’s storage, and check account status on the website.")
    }

    val accountStatusUrl: String get() = environment.origin + "/workspace/account"

    override fun hasFreshProof(): Boolean = synchronized(lock) { active.value != null && session?.freshUntil?.isAfter(now()) == true && session?.expiresAt?.isAfter(now()) == true }

    override suspend fun <T> authorized(owner: AccountScope, action: suspend (String) -> T): T = withContext(io) {
        ready.await()
        val (ticket, candidate) = synchronized(lock) {
            if (active.value != owner || session == null) throw IdentityFailure("proof_required")
            generation to session!!
        }
        try {
            if (!candidate.expiresAt.isAfter(now())) throw IdentityFailure("proof_required")
            val result = action(candidate.token)
            synchronized(lock) {
                if (generation != ticket || active.value != owner || session?.token != candidate.token) {
                    throw CancellationException("Account changed")
                }
            }
            result
        } catch (error: IdentityFailure) {
            if (error.code == "account_closing") freezeForClosure(ticket)
            else if (error.code in setOf("proof_required", "identity_changed", "identity_incomplete")) failed(ticket, error)
            throw error
        }
    }

    companion object {
        val SESSION_SLOT = StateSlot(StateKind.SESSION, "native-v1")
        val CLOSING_SLOT = StateSlot(StateKind.SESSION, "account-closing-v1")
        private const val CLOSING_MESSAGE = "Account closure is in progress. Private work was erased from this device. Check account status on the website, or sign out."
    }
}
