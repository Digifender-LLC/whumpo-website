package com.whumpo.core.identity

import com.whumpo.core.account.SecretBox
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import java.io.IOException
import java.time.Instant
import java.util.Base64

/** Pre-auth state has its own key and no-backup directory: it must never pretend to be an account. */
enum class PendingPhase { STARTING, BROWSER, RETURNED, EXCHANGING }
class PendingIdentity(
    val purpose: BrowserPurpose,
    val state: String,
    val verifier: String,
    val expiresAt: Instant,
    val phase: PendingPhase,
    val handoffId: String = "",
    val browserPath: String = "",
    val code: String = "",
) {
    fun move(phase: PendingPhase, id: String = handoffId, path: String = browserPath, until: Instant = expiresAt, code: String = this.code) =
        PendingIdentity(purpose, state, verifier, until, phase, id, path, code)
    override fun toString(): String = "PendingIdentity(<redacted>)"
}

class PendingIdentityStore(private val root: File, private val box: SecretBox) {
    private val file get() = File(root, "browser-return.bin")
    private val aad = "whumpo-native-pending-v1".toByteArray(Charsets.US_ASCII)

    @Synchronized
    fun save(pending: PendingIdentity) {
        val bytes = encode {
            writeInt(1); writeUTF(pending.purpose.name); writeUTF(pending.state); writeUTF(pending.verifier)
            writeLong(pending.expiresAt.epochSecond); writeUTF(pending.phase.name); writeUTF(pending.handoffId)
            writeUTF(pending.browserPath); writeUTF(pending.code)
        }
        root.mkdirs()
        val temp = File(root, "browser-return.tmp")
        temp.writeBytes(box.seal(bytes, aad))
        if (!temp.renameTo(file)) { temp.delete(); throw IOException("Could not save browser return") }
    }

    @Synchronized
    fun read(now: Instant): PendingIdentity? {
        if (!file.exists()) return null
        return try {
            require(file.length() <= 8192)
            val input = DataInputStream(ByteArrayInputStream(box.open(file.readBytes(), aad)))
            require(input.readInt() == 1)
            val result = PendingIdentity(BrowserPurpose.valueOf(input.readUTF()), input.readUTF(), input.readUTF(),
                Instant.ofEpochSecond(input.readLong()), PendingPhase.valueOf(input.readUTF()), input.readUTF(), input.readUTF(), input.readUTF())
            require(input.available() == 0 && result.expiresAt.isAfter(now))
            require(IdentityProtocol.opaque.matches(result.state) && IdentityProtocol.opaque.matches(result.verifier))
            if (result.phase != PendingPhase.STARTING) require(IdentityProtocol.uuid.matches(result.handoffId) && IdentityProtocol.browserPath(result.browserPath))
            if (result.phase == PendingPhase.RETURNED || result.phase == PendingPhase.EXCHANGING) require(IdentityProtocol.token.matches(result.code))
            result
        } catch (_: Exception) { clear(); null }
    }

    @Synchronized
    fun clear() {
        try { if (root.exists() && !root.deleteRecursively()) throw IOException("Could not erase browser return") }
        finally { box.destroyKey() }
    }
}

internal fun encode(write: DataOutputStream.() -> Unit): ByteArray = ByteArrayOutputStream().use { bytes ->
    DataOutputStream(bytes).use { it.write() }; bytes.toByteArray()
}

internal object SessionEncoding {
    fun write(session: NativeSession): String = Base64.getEncoder().encodeToString(encode {
        writeInt(1); writeUTF(session.token); writeLong(session.expiresAt.epochSecond); writeLong(session.freshUntil.epochSecond)
    })
    fun read(value: String, now: Instant): NativeSession? = try {
        require(value.length <= 1024)
        val input = DataInputStream(ByteArrayInputStream(Base64.getDecoder().decode(value)))
        require(input.readInt() == 1)
        val result = NativeSession(input.readUTF(), Instant.ofEpochSecond(input.readLong()), Instant.ofEpochSecond(input.readLong()))
        require(input.available() == 0 && result.expiresAt.isAfter(now))
        result
    } catch (_: Exception) { null }
}
