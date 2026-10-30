package com.whumpo.android

import android.app.Application
import com.whumpo.android.appearance.PrefsThemeStore
import com.whumpo.android.auth.ActivityTracker
import com.whumpo.android.auth.CredentialManagerPasskeys
import com.whumpo.android.auth.CustomTabsBrowser
import com.whumpo.android.ui.chat.ReauthHook
import com.whumpo.android.ui.common.AppLinks
import com.whumpo.android.ui.photos.AndroidPhotoPreparer
import com.whumpo.android.ui.photos.PhotoPreparer
import com.whumpo.android.ui.theme.ThemeStore
import com.whumpo.core.account.AccountStateStore
import com.whumpo.core.api.ClientInfo
import com.whumpo.core.api.MobileApiClient
import com.whumpo.core.api.okHttpEngine
import com.whumpo.core.auth.AuthController
import com.whumpo.core.auth.ReauthResult
import com.whumpo.core.auth.SessionAccountRepository
import com.whumpo.core.auth.SessionManager
import com.whumpo.core.data.AccountRepository
import com.whumpo.core.data.ChatDraftRepository
import com.whumpo.core.data.StoredChatDraftRepository
import com.whumpo.core.environment.WhumpoEnvironment
import com.whumpo.core.push.DeviceNotifications
import com.whumpo.core.push.NoOpPushMessaging
import com.whumpo.core.push.PushMessaging
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope

/** Manual dependency graph for the shell; one instance per process. */
class AppContainer(
    val environment: WhumpoEnvironment,
    val accountState: AccountStateStore,
    io: CoroutineDispatcher,
    app: Application,
    scope: CoroutineScope,
) {
    // WP5: the native session, the v1 client and sign-in. WP7 reuses `mobileApi`.
    val sessions = SessionManager(accountState, io)
    val clientInfo: ClientInfo = ClientInfo.current(BuildConfig.VERSION_CODE)
    val mobileApi = MobileApiClient(okHttpEngine(), environment.mobileApiBase, clientInfo, sessions)
    val activities = ActivityTracker()
    val auth = AuthController(
        api = mobileApi,
        sessions = sessions,
        passkeys = CredentialManagerPasskeys(app, activities),
        browser = CustomTabsBrowser(app, activities),
        origin = environment.origin,
        scope = scope,
    )

    // Chat calls this after `proof_required` with `fresh_passkey`, then retries with the same request ID.
    val reauth: ReauthHook = ReauthHook { auth.reauthenticate() == ReauthResult.Fresh }

    val account: AccountRepository = SessionAccountRepository(accountState, auth)
    val chatDrafts: ChatDraftRepository = StoredChatDraftRepository(accountState, io)

    /** No Firebase in this build; see docs/android-notifications.md for the owner steps that swap in FCM. */
    val push: PushMessaging = NoOpPushMessaging
    val notifications = DeviceNotifications(mobileApi, push)

    val themes: ThemeStore = PrefsThemeStore(app)
    val photoPreparer: PhotoPreparer = AndroidPhotoPreparer(app.contentResolver)
    val links = AppLinks(environment.origin)
}
