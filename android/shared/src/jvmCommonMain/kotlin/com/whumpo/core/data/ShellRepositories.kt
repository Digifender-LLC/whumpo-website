package com.whumpo.core.data

import com.whumpo.core.account.AccountScope
import com.whumpo.core.account.AccountStateStore
import com.whumpo.core.account.StateSlot
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.withContext

/**
 * Repositories for the WH-082 shell. They never contact a server: remote data reports
 * why it is unavailable instead of inventing content, and drafts live only in the
 * encrypted account store.
 */
class ShellProjectsRepository(private val store: AccountStateStore) : ProjectsRepository {
    override fun projects(): Flow<Availability<List<ProjectSummary>>> =
        store.activeAccount.map { unavailableFor(it != null) }
}

class ShellActivityRepository(private val store: AccountStateStore) : ActivityRepository {
    override fun activity(): Flow<Availability<List<ActivityItem>>> =
        store.activeAccount.map { unavailableFor(it != null) }
}

class StoredChatDraftRepository(
    private val store: AccountStateStore,
    private val io: CoroutineDispatcher,
) : ChatDraftRepository {
    override suspend fun loadDraft(owner: AccountScope): String? = withContext(io) {
        if (store.activeAccount.value != owner) null else store.read(owner, StateSlot.CHAT_DRAFT).orEmpty()
    }

    override suspend fun saveDraft(owner: AccountScope, text: String): Boolean = withContext(io) {
        val bounded = text.take(MAX_DRAFT_CHARS)
        if (bounded.isEmpty()) {
            store.remove(owner, StateSlot.CHAT_DRAFT)
        } else {
            store.write(owner, StateSlot.CHAT_DRAFT, bounded)
        }
    }

    companion object {
        const val MAX_DRAFT_CHARS: Int = 16_000
    }
}

class StoreAccountRepository(
    private val store: AccountStateStore,
    private val io: CoroutineDispatcher,
) : AccountRepository {
    override val activeAccount: Flow<AccountScope?> = store.activeAccount

    override suspend fun signOut() = withContext(io) { store.signOut() }
}

private fun unavailableFor(signedIn: Boolean): Availability<Nothing> =
    Availability.Unavailable(
        if (signedIn) UnavailableReason.SERVICE_NOT_CONNECTED else UnavailableReason.SIGN_IN_REQUIRED,
    )
