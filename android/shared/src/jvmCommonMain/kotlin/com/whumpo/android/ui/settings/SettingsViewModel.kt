package com.whumpo.android.ui.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.whumpo.core.data.AccountRepository
import com.whumpo.core.environment.EnvironmentKind
import com.whumpo.core.environment.WhumpoEnvironment
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class SettingsViewModel(
    private val account: AccountRepository,
    environment: WhumpoEnvironment,
    private val versionName: String,
) : ViewModel() {
    data class UiState(
        val signedIn: Boolean,
        val environmentKind: EnvironmentKind,
        val origin: String,
        val versionName: String,
    )

    private val initial = UiState(false, environment.kind, environment.origin, versionName)

    val state: StateFlow<UiState> = account.activeAccount
        .map { initial.copy(signedIn = it != null) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), initial)

    /** Erases all account-scoped state on this device and destroys its key. */
    fun signOut() {
        viewModelScope.launch { account.signOut() }
    }
}
