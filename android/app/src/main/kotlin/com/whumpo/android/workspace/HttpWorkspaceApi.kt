package com.whumpo.android.workspace

import com.whumpo.android.identity.HttpIdentityApi
import com.whumpo.android.identity.HttpIdentityApi.WorkspaceOperation
import com.whumpo.core.identity.IdentityFailure
import com.whumpo.core.identity.IdentityProtocol
import com.whumpo.core.workspace.*
import org.json.JSONArray
import org.json.JSONObject

/** Exact current projections and two fully rendered controls. Other controls are refused. */
class HttpWorkspaceApi(private val transport: HttpIdentityApi) : NativeWorkspaceApi {
    override suspend fun reviews(token: String): List<NativeReview> {
        val value = transport.workspace(WorkspaceOperation.REVIEWS, token)
        exact(value, "version", "items", "denied", "unavailable")
        number(value, "denied", 1_000_000); number(value, "unavailable", 1_000_000)
        val items = array(value, "items").map(::review)
        if (items.size > 5 || items.map { it.id }.distinct().size != items.size) invalid()
        return items
    }
    override suspend fun approve(token: String, request: PendingApproval): ChatAcceptance {
        val control = JSONObject().put("reviewId", request.control.reviewId)
        when (request.control.kind) {
            ReviewKind.APPLICATION -> control.put("type", "confirm").put("kind", "application")
            ReviewKind.RESTORE -> control.put("type", "appRestore").put("projectId", request.control.projectId).put("confirmation", "RESTORE")
            else -> throw IdentityFailure("unsupported_control")
        }
        val input = JSONObject().put("version", 1).put("requestId", request.requestId).put("expectedRevision", request.expectedRevision).put("control", control)
        val value = transport.workspace(WorkspaceOperation.APPROVE, token, input)
        exact(value, "version", "requestId", "accepted", "revision", "turnStatus")
        if (!bool(value, "accepted")) invalid()
        return ChatAcceptance(uuid(value, "requestId"), number(value, "revision", 2000), status(value, "turnStatus"))
    }
    private fun review(value: JSONObject): NativeReview {
        exact(value, "kind", "reviewId", "project", "state", "expiresAt", "canApprove", "control", "requiresFreshPasskey", "disclosure", "preview", "artifact", "unavailableReason")
        val kind = ReviewKind.entries.find { it.wire == text(value, "kind", 30) } ?: throw IdentityFailure("client_update_required")
        val id = uuid(value, "reviewId")
        val project = if (value.isNull("project")) null else obj(value, "project").also { exact(it, "id", "name") }
        val disclosure = obj(value, "disclosure"); exact(disclosure, "title", "lines")
        val lines = disclosure.opt("lines") as? JSONArray ?: invalid()
        if (lines.length() !in 1..20) invalid()
        val lineTexts = (0 until lines.length()).map { index -> (lines.opt(index) as? String)?.takeIf { it.length <= 2000 && it.none { c -> c.isISOControl() && c != '\n' && c != '\t' } } ?: invalid() }
        val preview = if (value.isNull("preview")) null else obj(value, "preview").let {
            exact(it, "path")
            text(it, "path", 150).also { path ->
                val expected = when (kind) { ReviewKind.SPECIFICATION -> "/api/specification-reviews/$id/diff"; ReviewKind.SITE -> "/api/publication-reviews/$id/diff"; else -> invalid() }
                if (path != expected) invalid()
            }
        }
        val artifact = if (value.isNull("artifact")) null else obj(value, "artifact").also {
            exact(it, "kind", "source", "digest"); if (text(it, "kind", 30) != "application-source") invalid()
        }
        val control = if (value.isNull("control")) null else obj(value, "control").let {
            if (uuid(it, "reviewId") != id) invalid()
            when (kind) {
                ReviewKind.APPLICATION -> { exact(it, "type", "kind", "reviewId"); if (text(it, "type", 20) != "confirm" || text(it, "kind", 30) != "application") invalid(); ReviewControl(kind, id) }
                ReviewKind.RESTORE -> { exact(it, "type", "projectId", "reviewId", "confirmation"); if (text(it, "type", 20) != "appRestore" || text(it, "confirmation", 10) != "RESTORE") invalid(); ReviewControl(kind, id, uuid(it, "projectId")) }
                else -> invalid()
            }
        }
        return NativeReview(kind, id, project?.let { uuid(it, "id") }, project?.let { text(it, "name", 100) }, text(value, "state", 20),
            IdentityProtocol.time(date(value, "expiresAt")), bool(value, "canApprove"), control, bool(value, "requiresFreshPasskey"),
            text(disclosure, "title", 200), lineTexts, preview, artifact?.let { text(it, "source", 8192) }, artifact?.let { text(it, "digest", 64) },
            if (value.isNull("unavailableReason")) null else text(value, "unavailableReason", 30)).also { it.validate() }
    }
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
        review?.let { review(it) }
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
