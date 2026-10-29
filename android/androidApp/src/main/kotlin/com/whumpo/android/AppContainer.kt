package com.whumpo.android

import android.app.Application
import com.whumpo.android.auth.ActivityTracker
import com.whumpo.android.auth.CredentialManagerPasskeys
import com.whumpo.android.auth.CustomTabsBrowser
import com.whumpo.core.account.AccountStateStore
import com.whumpo.core.api.ClientInfo
import com.whumpo.core.api.MobileApiClient
import com.whumpo.core.api.okHttpEngine
import com.whumpo.core.auth.AuthController
import com.whumpo.core.auth.SessionAccountRepository
import com.whumpo.core.auth.SessionManager
import com.whumpo.core.data.AccountRepository
import com.whumpo.core.data.ActivityRepository
import com.whumpo.core.data.ChatDraftRepository
import com.whumpo.core.data.ProjectsRepository
import com.whumpo.core.data.ShellActivityRepository
import com.whumpo.core.data.ShellProjectsRepository
import com.whumpo.core.data.StoredChatDraftRepository
import com.whumpo.core.environment.WhumpoEnvironment
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
    // WP5: the native session, the v1 client and sign-in. WP6 and WP7 reuse `api`; the client declares no review control
    // until Chat can render one (the server enables only what a build declares).
    val sessions = SessionManager(accountState, io)
    val api = MobileApiClient(
        okHttpEngine(),
        environment.mobileApiBase,
        ClientInfo.current(BuildConfig.VERSION_CODE, controls = emptyList()),
        sessions,
    )
    val activities = ActivityTracker()
    val auth = AuthController(
        api = api,
        sessions = sessions,
        passkeys = CredentialManagerPasskeys(app, activities),
        browser = CustomTabsBrowser(app, activities),
        origin = environment.origin,
        scope = scope,
    )

    val account: AccountRepository = SessionAccountRepository(accountState, auth)
    val chatDrafts: ChatDraftRepository = StoredChatDraftRepository(accountState, io)
    val projects: ProjectsRepository = ShellProjectsRepository(accountState)
    val activity: ActivityRepository = ShellActivityRepository(accountState)
}
