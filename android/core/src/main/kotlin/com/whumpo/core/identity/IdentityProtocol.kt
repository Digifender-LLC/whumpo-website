package com.whumpo.core.identity

import java.net.URI
import java.security.MessageDigest
import java.security.SecureRandom
import java.time.Instant
import java.util.Base64

/** Closed identity-only client; unimplemented Chat/review capabilities are never advertised. */
object IdentityProtocol {
    const val BUILD = 3
    const val RETURN_URI = "https://whumpo.com/app/return"
    const val CLIENT = "{\"contract\":1,\"build\":3,\"platform\":\"android\",\"controls\":[],\"interaction\":{\"versions\":[1],\"fieldTypes\":[],\"bindings\":[]}}"
    val uuid = Regex("[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")
    val token = Regex("[0-9a-f]{64}")
    val opaque = Regex("[A-Za-z0-9_-]{43}")

    fun random(): String = Base64.getUrlEncoder().withoutPadding()
        .encodeToString(ByteArray(32).also { SecureRandom().nextBytes(it) })

    fun challenge(verifier: String): String = Base64.getUrlEncoder().withoutPadding()
        .encodeToString(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.US_ASCII)))

    /** Exact app link only: reject fragments, duplicate/extra keys, encoding tricks and caller destinations. */
    fun parseReturn(value: String): BrowserReturn {
        val uri = try { URI(value) } catch (_: Exception) { throw IdentityFailure("invalid_return") }
        if (uri.scheme != "https" || uri.rawAuthority != "whumpo.com" || uri.rawPath != "/app/return" || uri.rawFragment != null) {
            throw IdentityFailure("invalid_return")
        }
        val parts = uri.rawQuery?.split('&') ?: throw IdentityFailure("invalid_return")
        if (parts.size != 2) throw IdentityFailure("invalid_return")
        val values = parts.map { it.split('=', limit = 2) }
        if (values.any { it.size != 2 } || values.map { it[0] }.toSet() != setOf("handoffId", "code")) throw IdentityFailure("invalid_return")
        val fields = values.associate { it[0] to it[1] }
        val id = fields.getValue("handoffId")
        val code = fields.getValue("code")
        if (!uuid.matches(id) || !token.matches(code)) throw IdentityFailure("invalid_return")
        return BrowserReturn(id, code)
    }

    fun browserPath(path: String): Boolean = Regex("/workspace/native/[0-9a-f]{64}").matches(path)
    fun time(value: String): Instant = try { Instant.parse(value) } catch (_: Exception) { throw IdentityFailure("invalid_response") }
}

class IdentityFailure(val code: String) : Exception("Native identity request failed") {
    override fun toString(): String = "IdentityFailure($code)"
}

class BrowserReturn(val handoffId: String, val code: String) {
    override fun toString(): String = "BrowserReturn(<redacted>)"
}

enum class BrowserPurpose(val wire: String) { SIGN_IN("signin"), SIGN_UP("signup"), RECOVERY("recovery") }
class PasskeyChallenge(val id: String, val expiresAt: Instant, val options: String) {
    override fun toString(): String = "PasskeyChallenge(<redacted>)"
}
class NativeSession(val token: String, val expiresAt: Instant, val freshUntil: Instant) {
    init { require(IdentityProtocol.token.matches(token)) }
    override fun toString(): String = "NativeSession(<redacted>)"
}
data class VerifiedAccount(val id: String, val label: String, val expiresAt: Instant, val freshUntil: Instant)
class StartedHandoff(val id: String, val browserPath: String, val expiresAt: Instant)

/** The Android adapter implements only this operation set; there is no caller-chosen path or URL. */
interface NativeIdentityApi {
    suspend fun checkConfiguration()
    suspend fun challenge(token: String? = null): PasskeyChallenge
    suspend fun verify(challengeId: String, credentialJson: String, token: String? = null): NativeSession
    suspend fun session(token: String): VerifiedAccount
    suspend fun logout(token: String)
    suspend fun start(purpose: BrowserPurpose, state: String, challenge: String): StartedHandoff
    suspend fun exchange(handoffId: String, code: String, state: String, verifier: String): NativeSession
}

fun interface PasskeyPrompt {
    suspend fun authenticate(optionsJson: String): String
}
