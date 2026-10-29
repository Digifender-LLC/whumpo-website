package com.whumpo.android.ui.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.whumpo.android.ui.theme.ThemePreference
import com.whumpo.android.ui.theme.ThemeStore
import com.whumpo.core.api.MobileApiClient
import com.whumpo.core.api.MobileApiException
import com.whumpo.core.api.SessionProvider
import com.whumpo.core.data.AccountRepository
import com.whumpo.core.environment.EnvironmentKind
import com.whumpo.core.environment.WhumpoEnvironment
import com.whumpo.core.push.DeviceNotifications
import com.whumpo.core.push.PushMessaging
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/** What Settings shows. [accountLabel] is the server's masked label (for example `o***@example.com`), null until read. */
data class SettingsUi(
    val signedIn: Boolean,
    val accountLabel: String?,
    val accountUnavailable: Boolean,
    val theme: ThemePreference,
    val pushAvailable: Boolean,
    val notificationsOn: Boolean,
    val notificationsError: Boolean,
    val signingOut: Boolean,
    val environmentKind: EnvironmentKind,
    val origin: String,
    val versionName: String,
)

class SettingsViewModel(
    private val account: AccountRepository,
    private val api: MobileApiClient,
    private val sessions: SessionProvider,
    private val themes: ThemeStore,
    private val notifications: DeviceNotifications,
    private val push: PushMessaging,
    environment: WhumpoEnvironment,
    private val versionName: String,
) : ViewModel() {
    private class Account(val label: String?, val unavailable: Boolean)

    private val accountInfo = MutableStateFlow(Account(null, false))
    private val notificationsOn = MutableStateFlow(false)
    private val notificationsError = MutableStateFlow(false)
    private val signingOut = MutableStateFlow(false)
    private val kind = environment.kind
    private val origin = environment.origin

    val state: StateFlow<SettingsUi> = combine(
        account.activeAccount,
        accountInfo,
        themes.preference,
        combine(notificationsOn, notificationsError) { on, error -> on to error },
        signingOut,
    ) { active, info, theme, (on, error), out ->
        SettingsUi(
            signedIn = active != null,
            accountLabel = info.label.takeIf { active != null },
            accountUnavailable = info.unavailable && active != null,
            theme = theme,
            pushAvailable = push.available,
            notificationsOn = on,
            notificationsError = error,
            signingOut = out,
            environmentKind = kind,
            origin = origin,
            versionName = versionName,
        )
    }.stateIn(
        viewModelScope,
        SharingStarted.WhileSubscribed(5_000),
        SettingsUi(false, null, false, themes.preference.value, push.available, false, false, false, kind, origin, versionName),
    )

    init {
        viewModelScope.launch {
            account.activeAccount.collect { active ->
                accountInfo.value = if (active == null) Account(null, false) else readAccount()
            }
        }
    }

    fun retryAccount() {
        viewModelScope.launch { accountInfo.value = readAccount() }
    }

    fun setTheme(preference: ThemePreference) = themes.set(preference)

    /** Registers or removes this device. Without a push provider the switch is not offered, so this never runs. */
    fun setNotifications(enabled: Boolean) {
        viewModelScope.launch {
            notificationsError.value = false
            try {
                if (enabled) {
                    if (notifications.register() == null) notificationsError.value = true else notificationsOn.value = true
                } else {
                    notifications.remove()
                    notificationsOn.value = false
                }
            } catch (e: CancellationException) {
                throw e
            } catch (_: MobileApiException) {
                notificationsError.value = true
            }
        }
    }

    /**
     * Ends the session on the server, then erases everything on this device. The server call is best effort: sign-out
     * must work offline, and the server revokes the session on its own expiry. [SessionProvider.onSessionRejected]
     * is the interface's hook for dropping the local bearer token (WP5 implements it).
     */
    fun signOut() {
        if (signingOut.value) return
        signingOut.value = true
        viewModelScope.launch {
            try {
                try {
                    api.logout()
                } catch (e: CancellationException) {
                    throw e
                } catch (_: MobileApiException) {
                    // Offline or already rejected: the local erase below still runs.
                }
                sessions.onSessionRejected()
                push.deleteToken()
                account.signOut()
            } finally {
                signingOut.value = false
            }
        }
    }

    private suspend fun readAccount(): Account =
        try {
            Account(api.getSession().account.label, false)
        } catch (e: CancellationException) {
            throw e
        } catch (_: MobileApiException) {
            Account(null, true)
        }
}
