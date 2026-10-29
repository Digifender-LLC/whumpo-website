package com.whumpo.android

import com.whumpo.core.account.AccountStateStore
import com.whumpo.core.data.AccountRepository
import com.whumpo.core.data.ActivityRepository
import com.whumpo.core.data.ChatDraftRepository
import com.whumpo.core.data.ProjectsRepository
import com.whumpo.core.data.ShellActivityRepository
import com.whumpo.core.data.ShellProjectsRepository
import com.whumpo.core.data.StoreAccountRepository
import com.whumpo.core.data.StoredChatDraftRepository
import com.whumpo.core.environment.WhumpoEnvironment
import kotlinx.coroutines.CoroutineDispatcher

/** Manual dependency graph for the shell; one instance per process. */
class AppContainer(
    val environment: WhumpoEnvironment,
    val accountState: AccountStateStore,
    io: CoroutineDispatcher,
) {
    val account: AccountRepository = StoreAccountRepository(accountState, io)
    val chatDrafts: ChatDraftRepository = StoredChatDraftRepository(accountState, io)
    val projects: ProjectsRepository = ShellProjectsRepository(accountState)
    val activity: ActivityRepository = ShellActivityRepository(accountState)
}
