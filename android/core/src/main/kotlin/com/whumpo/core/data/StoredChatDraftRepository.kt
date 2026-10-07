package com.whumpo.core.data

import com.whumpo.core.account.AccountScope
import com.whumpo.core.account.AccountStateStore
import com.whumpo.core.account.StateSlot
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.withContext

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
