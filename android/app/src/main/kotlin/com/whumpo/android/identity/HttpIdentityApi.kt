package com.whumpo.android.identity

import com.whumpo.core.environment.WhumpoEnvironment
import com.whumpo.core.identity.BrowserPurpose
import com.whumpo.core.identity.IdentityFailure
import com.whumpo.core.identity.IdentityProtocol
import com.whumpo.core.identity.NativeIdentityApi
import com.whumpo.core.identity.NativeSession
import com.whumpo.core.identity.PasskeyChallenge
import com.whumpo.core.identity.StartedHandoff
import com.whumpo.core.identity.VerifiedAccount
import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.Call
import okhttp3.Callback
import okhttp3.CookieJar
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okio.BufferedSink
import okhttp3.Response
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** No cookie jar, redirects, authentication interceptor, logging, cache or automatic connection retry. */
class HttpIdentityApi(private val environment: WhumpoEnvironment) : NativeIdentityApi {
    private val client = OkHttpClient.Builder()
        .cookieJar(CookieJar.NO_COOKIES).followRedirects(false).followSslRedirects(false)
        .retryOnConnectionFailure(false).connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS).callTimeout(30, TimeUnit.SECONDS).build()

    private suspend fun send(route: Route, input: JSONObject? = null, token: String? = null): JSONObject {
        if (route.authenticated != (token != null) || (token != null && !IdentityProtocol.token.matches(token))) throw IdentityFailure("invalid_request")
        if (input != null && input.toString().toByteArray(Charsets.UTF_8).size > 16_384) throw IdentityFailure("invalid_request")
        val request = Request.Builder().url(environment.mobileApiBase + route.path)
            .header("Whumpo-Client", IdentityProtocol.CLIENT).header("Accept", "application/json")
            .apply { if (token != null) header("Authorization", "Bearer $token") }
            .apply { if (input != null) post(oneShotBody(input)) else get() }
            .build()
        return suspendCancellableCoroutine { continuation ->
            val call = client.newCall(request)
            continuation.invokeOnCancellation { call.cancel() }
            call.enqueue(object : Callback {
                override fun onFailure(call: Call, e: IOException) {
                    if (continuation.isActive) continuation.resumeWithException(IdentityFailure("network"))
                }
                override fun onResponse(call: Call, response: Response) {
                    try {
                        val result = response.use {
                            if (it.code in 300..399) throw IdentityFailure("invalid_response")
                            if (it.code == 401) throw IdentityFailure("proof_required")
                            if (it.code == 426) throw IdentityFailure("client_update_required")
                            val body = it.body ?: throw IdentityFailure("invalid_response")
                            if (body.contentType()?.let { type -> type.type == "application" && type.subtype == "json" } != true) throw IdentityFailure("invalid_response")
                            if (body.contentLength() > 65_536) throw IdentityFailure("invalid_response")
                            val source = body.source()
                            source.request(65_537)
                            if (source.buffer.size > 65_536) throw IdentityFailure("invalid_response")
                            val json = try { JSONObject(source.readUtf8()) } catch (_: Exception) { throw IdentityFailure("invalid_response") }
                            if (json.opt("version") != 1) throw IdentityFailure("client_update_required")
                            if (!it.isSuccessful) {
                                exact(json, "version", "error")
                                val error = json.optJSONObject("error") ?: throw IdentityFailure("invalid_response")
                                val code = error.optString("code")
                                if (code !in ERRORS) throw IdentityFailure("invalid_response")
                                throw IdentityFailure(code)
                            }
                            json
                        }
                        if (continuation.isActive) continuation.resume(result)
                    } catch (error: Exception) {
                        if (continuation.isActive) continuation.resumeWithException(if (error is IdentityFailure) error else IdentityFailure("invalid_response"))
                    }
                }
            })
        }
    }

    override suspend fun checkConfiguration() {
        val result = send(Route.CONFIG)
        exact(result, "version", "contract", "minimumBuild", "rpId", "browserReturn")
        val minimum = result.opt("minimumBuild") as? Int ?: throw IdentityFailure("invalid_response")
        if (result.opt("contract") != 1 || minimum > IdentityProtocol.BUILD) throw IdentityFailure("client_update_required")
        if (minimum < 1 || text(result, "rpId") != "whumpo.com" || text(result, "browserReturn") != IdentityProtocol.RETURN_URI) throw IdentityFailure("invalid_response")
    }

    override suspend fun challenge(token: String?): PasskeyChallenge {
        val result = send(if (token == null) Route.LOGIN_OPTIONS else Route.REAUTH_OPTIONS, body(), token)
        exact(result, "version", "challengeId", "expiresAt", "options")
        val id = text(result, "challengeId")
        if (!IdentityProtocol.uuid.matches(id)) throw IdentityFailure("invalid_response")
        val options = result.optJSONObject("options") ?: throw IdentityFailure("invalid_response")
        if (options.optString("rpId") != "whumpo.com" || options.optString("userVerification") != "required") throw IdentityFailure("invalid_response")
        return PasskeyChallenge(id, IdentityProtocol.time(text(result, "expiresAt")), options.toString())
    }

    override suspend fun verify(challengeId: String, credentialJson: String, token: String?): NativeSession {
        if (!IdentityProtocol.uuid.matches(challengeId) || credentialJson.length > 16_000) throw IdentityFailure("invalid_request")
        val credential = try { JSONObject(credentialJson) } catch (_: Exception) { throw IdentityFailure("invalid_request") }
        val result = send(if (token == null) Route.LOGIN_VERIFY else Route.REAUTH_VERIFY,
            body().put("challengeId", challengeId).put("credential", credential), token)
        exact(result, "version", "session")
        return sessionBody(result.getJSONObject("session"), token)
    }

    override suspend fun session(token: String): VerifiedAccount {
        val result = send(Route.SESSION, token = token)
        exact(result, "version", "session", "account")
        val account = result.optJSONObject("account") ?: throw IdentityFailure("invalid_response")
        exact(account, "id", "label")
        val session = sessionBody(result.getJSONObject("session"), token)
        return VerifiedAccount(text(account, "id"), text(account, "label"), session.expiresAt, session.freshUntil)
    }

    override suspend fun logout(token: String) {
        val result = send(Route.LOGOUT, body(), token)
        exact(result, "version", "signedOut")
        if (result.opt("signedOut") != true) throw IdentityFailure("invalid_response")
    }

    override suspend fun start(purpose: BrowserPurpose, state: String, challenge: String): StartedHandoff {
        val result = send(Route.START, body().put("purpose", purpose.wire).put("state", state).put("codeChallenge", challenge)
            .put("codeChallengeMethod", "S256").put("redirectUri", IdentityProtocol.RETURN_URI))
        exact(result, "version", "handoffId", "browserPath", "expiresAt")
        return StartedHandoff(text(result, "handoffId"), text(result, "browserPath"), IdentityProtocol.time(text(result, "expiresAt")))
    }

    override suspend fun exchange(handoffId: String, code: String, state: String, verifier: String): NativeSession {
        val result = send(Route.EXCHANGE, body().put("handoffId", handoffId).put("code", code).put("state", state).put("codeVerifier", verifier))
        exact(result, "version", "session")
        return sessionBody(result.getJSONObject("session"))
    }

    private fun sessionBody(value: JSONObject, bearer: String? = null): NativeSession {
        if (bearer == null) exact(value, "token", "expiresAt", "freshUntil") else exact(value, "expiresAt", "freshUntil")
        val token = bearer ?: text(value, "token")
        if (!IdentityProtocol.token.matches(token)) throw IdentityFailure("invalid_response")
        return NativeSession(token, IdentityProtocol.time(text(value, "expiresAt")), IdentityProtocol.time(text(value, "freshUntil")))
    }

    private enum class Route(val path: String, val authenticated: Boolean) {
        CONFIG("/config", false), LOGIN_OPTIONS("/session/login/options", false), LOGIN_VERIFY("/session/login/verify", false),
        REAUTH_OPTIONS("/session/reauth/options", true), REAUTH_VERIFY("/session/reauth/verify", true),
        SESSION("/session", true), LOGOUT("/session/logout", true),
        START("/session/handoff/start", false), EXCHANGE("/session/handoff/exchange", false),
    }
    private companion object {
        val ERRORS = setOf("invalid_request", "unknown_field", "missing_field", "proof_required", "identity_incomplete", "not_found", "identity_changed", "request_conflict", "payload_too_large", "client_update_required", "rate_limited", "unavailable")
        fun oneShotBody(input: JSONObject): RequestBody {
            val bytes = input.toString().toByteArray(Charsets.UTF_8)
            return object : RequestBody() {
                override fun contentType() = "application/json; charset=utf-8".toMediaType()
                override fun contentLength() = bytes.size.toLong()
                override fun isOneShot() = true
                override fun writeTo(sink: BufferedSink) { sink.write(bytes) }
            }
        }
        fun body() = JSONObject().put("version", 1)
        fun exact(value: JSONObject, vararg fields: String) {
            if (value.keys().asSequence().toSet() != fields.toSet()) throw IdentityFailure("invalid_response")
        }
        fun text(value: JSONObject, key: String): String = (value.opt(key) as? String)?.takeIf { it.length <= 16_384 }
            ?: throw IdentityFailure("invalid_response")
    }
}
