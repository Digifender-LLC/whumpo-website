package com.whumpo.core.workspace

import com.whumpo.core.account.AccountScope
import kotlinx.coroutines.flow.StateFlow

/** A token is available only within one account-fenced operation, never in screen state. */
interface WorkspaceSession {
    val activeAccount: StateFlow<AccountScope?>
    suspend fun <T> authorized(owner: AccountScope, action: suspend (String) -> T): T
}

data class WorkspaceBootstrap(val onboardingComplete: Boolean, val revision: Int?, val mode: String?, val projectCount: Int, val reviewCount: Int)
data class NativeTurn(val id: String, val revision: Int, val status: String, val mode: String, val createdAt: String,
    val userText: String, val assistantText: String?, val hasReview: Boolean, val hasInteraction: Boolean)
data class NativeProject(val id: String, val name: String, val purpose: String, val status: String, val siteLive: Boolean, val backendLive: Boolean)
data class NativeActivity(val id: String, val projectId: String?, val action: String, val summary: String, val createdAt: String)
data class NativePage<T>(val items: List<T>, val nextCursor: String?)
data class NativeChatPage(val revision: Int, val mode: String, val items: List<NativeTurn>, val nextCursor: String?)
data class ChatAcceptance(val requestId: String, val revision: Int, val status: String)
enum class ChatDelivery { UNCONFIRMED, NOT_FOUND, ACCEPTED }
data class PendingChat(val requestId: String, val expectedRevision: Int, val content: String,
    val delivery: ChatDelivery = ChatDelivery.UNCONFIRMED, val status: String? = null)

/** Supported browsing and plain Chat only. No review approvals or interaction mutations are callable here. */
interface NativeWorkspaceApi {
    suspend fun bootstrap(token: String): WorkspaceBootstrap
    suspend fun chat(token: String, cursor: String?, query: String): NativeChatPage
    suspend fun turn(token: String, requestId: String): NativeTurn
    suspend fun send(token: String, request: PendingChat): ChatAcceptance
    suspend fun projects(token: String, cursor: String?): NativePage<NativeProject>
    suspend fun activity(token: String, cursor: String?): NativePage<NativeActivity>
}
