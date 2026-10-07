package com.whumpo.core.workspace

import com.whumpo.core.identity.IdentityFailure
import com.whumpo.core.identity.IdentityProtocol
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.security.MessageDigest
import java.time.Instant
import java.util.Base64

enum class ReviewKind(val wire: String) { APPLICATION("application"), RESTORE("app-restore"), SPECIFICATION("specification"), SITE("site") }
data class ReviewControl(val kind: ReviewKind, val reviewId: String, val projectId: String? = null) {
    val label: String get() = when (kind) {
        ReviewKind.APPLICATION -> "Authorize the reviewed application change."
        ReviewKind.RESTORE -> "Restore the exact reviewed application data."
        else -> throw IdentityFailure("client_update_required")
    }
}
data class NativeReview(
    val kind: ReviewKind, val id: String, val projectId: String?, val projectName: String?, val state: String,
    val expiresAt: Instant, val canApprove: Boolean, val control: ReviewControl?, val requiresFreshPasskey: Boolean,
    val title: String, val lines: List<String>, val preview: String?, val source: String?, val sourceDigest: String?, val unavailableReason: String?,
) {
    fun validate() {
        fun valid(test: Boolean) { if (!test) throw IdentityFailure("invalid_response") }
        valid(IdentityProtocol.uuid.matches(id) && (projectId == null || IdentityProtocol.uuid.matches(projectId)))
        valid((projectId == null) == (projectName == null) && (projectName?.length ?: 0) <= 100)
        valid(state in setOf("pending", "applied", "expired", "superseded", "unavailable"))
        valid(title.isNotBlank() && title.length <= 200 && lines.isNotEmpty() && lines.size <= 20 && lines.all { it.isNotBlank() && it.length <= 2000 })
        valid(unavailableReason == null || unavailableReason in setOf("client_update_required", "expired", "stale", "not_current"))
        if (canApprove) {
            valid(state == "pending" && unavailableReason == null && control?.kind == kind && control.reviewId == id && projectId != null)
            valid(kind == ReviewKind.APPLICATION || kind == ReviewKind.RESTORE)
        } else valid(control == null)
        if (kind == ReviewKind.APPLICATION) {
            valid(!requiresFreshPasskey && preview == null && source != null && sourceDigest != null)
            valid(source!!.toByteArray(Charsets.UTF_8).size <= 8192 && IdentityProtocol.token.matches(sourceDigest!!))
            valid(digest(source.toByteArray(Charsets.UTF_8)) == sourceDigest)
            if (control != null) valid(control.projectId == null)
        } else {
            valid(source == null && sourceDigest == null)
            if (kind == ReviewKind.RESTORE) {
                valid(requiresFreshPasskey && preview == null)
                if (control != null) valid(control.projectId == projectId)
            }
        }
    }
    /** Includes every displayed effect and every exact-control identity, not a prose approximation. */
    fun fingerprint(): String {
        validate()
        return digest(binary {
            writeUTF(kind.wire); writeUTF(id); writeUTF(projectId.orEmpty()); writeUTF(projectName.orEmpty()); writeUTF(state)
            writeUTF(expiresAt.toString()); writeBoolean(canApprove); writeBoolean(requiresFreshPasskey)
            writeUTF(title); writeInt(lines.size); lines.forEach { writeUTF(it) }
            writeUTF(preview.orEmpty()); writeUTF(source.orEmpty()); writeUTF(sourceDigest.orEmpty()); writeUTF(unavailableReason.orEmpty())
            writeUTF(control?.kind?.wire.orEmpty()); writeUTF(control?.reviewId.orEmpty()); writeUTF(control?.projectId.orEmpty())
        })
    }
    fun current(now: Instant): Boolean = canApprove && state == "pending" && expiresAt.isAfter(now)
}
data class PendingApproval(val requestId: String, val expectedRevision: Int, val control: ReviewControl, val fingerprint: String,
    val expiresAt: Instant, val delivery: ChatDelivery = ChatDelivery.UNCONFIRMED, val status: String? = null)

internal object ApprovalEncoding {
    fun write(value: PendingApproval): String = Base64.getEncoder().encodeToString(binary {
        writeInt(1); writeUTF(value.requestId); writeInt(value.expectedRevision); writeUTF(value.control.kind.name)
        writeUTF(value.control.reviewId); writeUTF(value.control.projectId.orEmpty()); writeUTF(value.fingerprint)
        writeUTF(value.expiresAt.toString()); writeUTF(value.delivery.name); writeUTF(value.status.orEmpty())
    })
    fun read(value: String): PendingApproval {
        require(value.length <= 4096)
        val input = DataInputStream(ByteArrayInputStream(Base64.getDecoder().decode(value)))
        require(input.readInt() == 1)
        val id = input.readUTF(); val revision = input.readInt()
        val control = ReviewControl(ReviewKind.valueOf(input.readUTF()), input.readUTF(), input.readUTF().ifEmpty { null })
        val result = PendingApproval(id, revision, control, input.readUTF(), IdentityProtocol.time(input.readUTF()), ChatDelivery.valueOf(input.readUTF()), input.readUTF().ifEmpty { null })
        require(input.available() == 0 && IdentityProtocol.uuid.matches(id) && revision in 0..2000 && IdentityProtocol.uuid.matches(control.reviewId))
        require(control.kind == ReviewKind.APPLICATION && control.projectId == null || control.kind == ReviewKind.RESTORE && control.projectId?.let { IdentityProtocol.uuid.matches(it) } == true)
        require(IdentityProtocol.token.matches(result.fingerprint) && (result.status == null || result.status in setOf("pending", "completed", "failed", "uncertain")))
        return result
    }
}
private fun binary(block: DataOutputStream.() -> Unit): ByteArray = ByteArrayOutputStream().use { bytes -> DataOutputStream(bytes).use(block); bytes.toByteArray() }
internal fun digest(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
