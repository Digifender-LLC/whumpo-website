package com.whumpo.android.workspace

import com.whumpo.android.identity.HttpIdentityApi
import com.whumpo.android.identity.HttpIdentityApi.WorkspaceOperation
import com.whumpo.core.identity.IdentityFailure
import com.whumpo.core.identity.IdentityProtocol
import com.whumpo.core.workspace.*
import org.json.JSONArray
import org.json.JSONObject

/** Exact v1 projections. Unsupported reviews/forms remain read-only notices directing the owner to the website. */
class HttpWorkspaceApi(private val transport: HttpIdentityApi) : NativeWorkspaceApi {
    override suspend fun bootstrap(token: String): WorkspaceBootstrap {
        val value = transport.workspace(WorkspaceOperation.BOOTSTRAP, token)
        exact(value, "version", "onboarding", "chat", "projectCount", "pendingReviewCount")
        val onboarding = obj(value, "onboarding"); exact(onboarding, "complete", "browserPath")
        val complete = bool(onboarding, "complete")
        if (complete && !onboarding.isNull("browserPath") || !complete && text(onboarding, "browserPath", 30) != "/workspace/") invalid()
        val chat = if (value.isNull("chat")) null else obj(value, "chat")
        if (complete != (chat != null)) invalid()
        chat?.let { exact(it, "revision", "mode") }
        return WorkspaceBootstrap(complete, chat?.let { number(it, "revision", 2000) }, chat?.let { mode(it) }, number(value, "projectCount", 1_000_000), number(value, "pendingReviewCount", 1000))
    }
    override suspend fun chat(token: String, cursor: String?, query: String): NativeChatPage {
        val value = transport.workspace(WorkspaceOperation.CHAT, token, cursor = cursor, query = query)
        exact(value, "version", "revision", "mode", "items", "nextCursor")
        val items = array(value, "items").map(::turn)
        if (items.map { it.id }.distinct().size != items.size || items.zipWithNext().any { (a, b) -> a.revision >= b.revision }) invalid()
        return NativeChatPage(number(value, "revision", 2000), mode(value), items, cursor(value))
    }
    override suspend fun turn(token: String, requestId: String): NativeTurn {
        val value = transport.workspace(WorkspaceOperation.TURN, token, id = requestId)
        exact(value, "version", "turn")
        return turn(obj(value, "turn")).also { if (it.id != requestId) invalid() }
    }
    override suspend fun send(token: String, request: PendingChat): ChatAcceptance {
        val input = JSONObject().put("version", 1).put("requestId", request.requestId).put("expectedRevision", request.expectedRevision).put("content", request.content)
        val value = transport.workspace(WorkspaceOperation.SEND, token, input)
        exact(value, "version", "requestId", "accepted", "revision", "turnStatus")
        if (!bool(value, "accepted")) invalid()
        return ChatAcceptance(uuid(value, "requestId"), number(value, "revision", 2000), status(value, "turnStatus"))
    }
    override suspend fun projects(token: String, cursor: String?): NativePage<NativeProject> {
        val value = transport.workspace(WorkspaceOperation.PROJECTS, token, cursor = cursor)
        exact(value, "version", "items", "nextCursor")
        val items = array(value, "items").map {
            exact(it, "id", "name", "purpose", "status", "siteLive", "backendLive", "createdAt", "updatedAt")
            date(it, "createdAt"); date(it, "updatedAt")
            NativeProject(uuid(it, "id"), text(it, "name", 100), text(it, "purpose", 1000), text(it, "status", 100), bool(it, "siteLive"), bool(it, "backendLive"))
        }
        return NativePage(items, cursor(value))
    }
    override suspend fun activity(token: String, cursor: String?): NativePage<NativeActivity> {
        val value = transport.workspace(WorkspaceOperation.ACTIVITY, token, cursor = cursor)
        exact(value, "version", "items", "nextCursor")
        val items = array(value, "items").map {
            exact(it, "id", "projectId", "action", "summary", "createdAt")
            val id = text(it, "id", 80)
            if (!Regex("[A-Za-z0-9:_-]{1,80}").matches(id)) invalid()
            NativeActivity(id, if (it.isNull("projectId")) null else uuid(it, "projectId"), text(it, "action", 100), text(it, "summary", 300), date(it, "createdAt"))
        }
        return NativePage(items, cursor(value))
    }
    private fun turn(value: JSONObject): NativeTurn {
        exact(value, "id", "revision", "status", "mode", "createdAt", "userText", "assistantText", "review", "interaction")
        val review = if (value.isNull("review")) null else obj(value, "review")
        // An empty capability header cannot authorize a native approval, even if a malformed server reply offers one.
        if (review != null && (bool(review, "canApprove") || !review.isNull("control"))) invalid()
        val interaction = if (value.isNull("interaction")) null else obj(value, "interaction")
        interaction?.let { exact(it, "interactionId", "state"); uuid(it, "interactionId"); text(it, "state", 40) }
        return NativeTurn(uuid(value, "id"), number(value, "revision", 2000), status(value, "status"), mode(value), date(value, "createdAt"),
            text(value, "userText", 1000), if (value.isNull("assistantText")) null else text(value, "assistantText", 20_000), review != null, interaction != null)
    }
    private fun invalid(): Nothing = throw IdentityFailure("invalid_response")
    private fun exact(value: JSONObject, vararg keys: String) { if (value.keys().asSequence().toSet() != keys.toSet()) invalid() }
    private fun obj(value: JSONObject, key: String) = value.opt(key) as? JSONObject ?: invalid()
    private fun array(value: JSONObject, key: String): List<JSONObject> {
        val items = value.opt(key) as? JSONArray ?: invalid()
        if (items.length() > 10) invalid()
        return (0 until items.length()).map { items.opt(it) as? JSONObject ?: invalid() }
    }
    private fun text(value: JSONObject, key: String, max: Int): String = (value.opt(key) as? String)?.takeIf { it.length <= max && it.none { c -> c.code in 0..8 || c.code in 11..12 || c.code in 14..31 || c.code == 127 } } ?: invalid()
    private fun bool(value: JSONObject, key: String) = value.opt(key) as? Boolean ?: invalid()
    private fun number(value: JSONObject, key: String, max: Int) = (value.opt(key) as? Int)?.takeIf { it in 0..max } ?: invalid()
    private fun uuid(value: JSONObject, key: String) = text(value, key, 36).also { if (!IdentityProtocol.uuid.matches(it)) invalid() }
    private fun date(value: JSONObject, key: String) = text(value, key, 40).also { IdentityProtocol.time(it) }
    private fun mode(value: JSONObject) = text(value, "mode", 10).also { if (it !in setOf("guided", "ai")) invalid() }
    private fun status(value: JSONObject, key: String) = text(value, key, 12).also { if (it !in setOf("pending", "completed", "failed", "uncertain")) invalid() }
    private fun cursor(value: JSONObject): String? = if (value.isNull("nextCursor")) null else text(value, "nextCursor", 256).also { if (!Regex("[A-Za-z0-9_-]{1,256}").matches(it)) invalid() }
}
