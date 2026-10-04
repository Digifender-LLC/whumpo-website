package com.whumpo.android.ui.chat

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.whumpo.android.AppContainer
import com.whumpo.core.account.AccountScope
import com.whumpo.core.data.AccountRepository
import com.whumpo.core.data.ChatDraftRepository
import com.whumpo.core.data.StoredChatDraftRepository
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch

/**
 * Chat composer state. The draft belongs to the signed-in account: it is loaded from and
 * saved to encrypted account-scoped storage, and it disappears from the screen as soon
 * as the account signs out or changes. Sending arrives with WH-084.
 */
class ChatViewModel(
    private val drafts: ChatDraftRepository,
    account: AccountRepository,
) : ViewModel() {
    data class UiState(
        val loading: Boolean = true,
        val owner: AccountScope? = null,
        val draft: String = "",
    ) {
        val composerEnabled: Boolean get() = owner != null && !loading
    }

    private val mutableState = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = mutableState.asStateFlow()

    private var saveJob: Job? = null

    init {
        viewModelScope.launch {
            account.activeAccount.collectLatest { owner ->
                saveJob?.cancel()
                if (owner == null) {
                    mutableState.value = UiState(loading = false)
                    return@collectLatest
                }
                mutableState.value = UiState(loading = true, owner = owner)
                val draft = drafts.loadDraft(owner)
                mutableState.value = if (draft == null) {
                    UiState(loading = false)
                } else {
                    UiState(loading = false, owner = owner, draft = draft)
                }
            }
        }
    }

    fun onDraftChanged(text: String) {
        val current = mutableState.value
        val owner = current.owner ?: return
        if (current.loading) return
        val bounded = text.take(StoredChatDraftRepository.MAX_DRAFT_CHARS)
        mutableState.value = current.copy(draft = bounded)
        saveJob?.cancel()
        saveJob = viewModelScope.launch {
            delay(SAVE_DEBOUNCE_MS)
            drafts.saveDraft(owner, bounded)
        }
    }

    companion object {
        const val SAVE_DEBOUNCE_MS: Long = 250

        fun factory(container: AppContainer): ViewModelProvider.Factory = viewModelFactory {
            initializer { ChatViewModel(container.chatDrafts, container.account) }
        }
    }
}
