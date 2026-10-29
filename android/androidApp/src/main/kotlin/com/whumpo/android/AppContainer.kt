package com.whumpo.android

import android.content.Context
import com.whumpo.android.appearance.PrefsThemeStore
import com.whumpo.android.session.ShellSessionProvider
import com.whumpo.android.ui.common.AppLinks
import com.whumpo.android.ui.photos.AndroidPhotoPreparer
import com.whumpo.android.ui.photos.PhotoPreparer
import com.whumpo.android.ui.theme.ThemeStore
import com.whumpo.core.account.AccountStateStore
import com.whumpo.core.api.ClientInfo
import com.whumpo.core.api.MobileApiClient
import com.whumpo.core.api.SessionProvider
import com.whumpo.core.api.okHttpEngine
import com.whumpo.core.data.AccountRepository
import com.whumpo.core.data.ChatDraftRepository
import com.whumpo.core.data.StoreAccountRepository
import com.whumpo.core.data.StoredChatDraftRepository
import com.whumpo.core.environment.WhumpoEnvironment
import com.whumpo.core.push.DeviceNotifications
import com.whumpo.core.push.NoOpPushMessaging
import com.whumpo.core.push.PushMessaging
import kotlinx.coroutines.CoroutineDispatcher

/** Manual dependency graph for the shell; one instance per process. */
class AppContainer(
    val environment: WhumpoEnvironment,
    val accountState: AccountStateStore,
    io: CoroutineDispatcher,
    context: Context,
) {
    val account: AccountRepository = StoreAccountRepository(accountState, io)
    val chatDrafts: ChatDraftRepository = StoredChatDraftRepository(accountState, io)

    /** WP5 replaces this with the Keystore-backed native session. */
    val sessions: SessionProvider = ShellSessionProvider

    // This build declares no review controls: nothing in it confirms a change yet (WP6 widens this with Chat).
    val api = MobileApiClient(
        okHttpEngine(),
        environment.mobileApiBase,
        ClientInfo.current(BuildConfig.VERSION_CODE, controls = emptyList()),
        sessions,
    )

    /** No Firebase in this build; see docs/android-notifications.md for the owner steps that swap in FCM. */
    val push: PushMessaging = NoOpPushMessaging
    val notifications = DeviceNotifications(api, push)

    val themes: ThemeStore = PrefsThemeStore(context)
    val photoPreparer: PhotoPreparer = AndroidPhotoPreparer(context.contentResolver)
    val links = AppLinks(environment.origin)
}
