package com.whumpo.android.ui.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.whumpo.android.AppContainer
import com.whumpo.android.BuildConfig
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

    companion object {
        fun factory(container: AppContainer): ViewModelProvider.Factory = viewModelFactory {
            initializer { SettingsViewModel(container.account, container.environment, BuildConfig.VERSION_NAME) }
        }
    }
}
