package com.whumpo.android.identity

import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import com.whumpo.android.BuildConfig
import com.whumpo.core.environment.WhumpoEnvironment
import com.whumpo.core.identity.BrowserPurpose
import com.whumpo.core.identity.IdentityFailure
import com.whumpo.core.identity.IdentityProtocol
import kotlinx.coroutines.test.runTest
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import java.net.InetSocketAddress
import java.util.concurrent.CopyOnWriteArrayList

/** Real loopback HTTP, synthetic identities only: verifies the actual Android adapter's transport boundary. */
class HttpIdentityApiTest {
    private lateinit var server: HttpServer
    private lateinit var api: HttpIdentityApi
    private val seen = CopyOnWriteArrayList<Pair<String, Map<String, String>>>()
    private var reply: (HttpExchange) -> Unit = { it.send(503, "{}") }
    private val token = "a".repeat(64)
    private val account = "00000000-0000-4000-8000-000000000001"
    private val expiry = "2026-10-08T12:00:00Z"
    private val fresh = "2026-10-07T12:10:00Z"

    @Before fun start() {
        server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/") {
            seen.add(it.requestURI.path to it.requestHeaders.entries.associate { entry -> entry.key.lowercase() to entry.value.joinToString() })
            reply(it)
        }
        server.start()
        api = HttpIdentityApi(WhumpoEnvironment.from("local", "http://127.0.0.1:${server.address.port}"))
    }
    @After fun stop() { server.stop(0) }

    @Test fun configurationRejectsStaleBuildAndChangedIdentityEndpoints() = runTest {
        reply = { it.send(200, """{"version":1,"contract":1,"minimumBuild":3,"rpId":"whumpo.com","browserReturn":"https://whumpo.com/app/return"}""") }
        api.checkConfiguration()
        assertEquals("/api/mobile/v1/config", seen.single().first)
        assertFalse(seen.single().second.containsKey("authorization"))
        reply = { it.send(200, """{"version":1,"contract":1,"minimumBuild":4,"rpId":"whumpo.com","browserReturn":"https://whumpo.com/app/return"}""") }
        assertEquals("client_update_required", failure { api.checkConfiguration() })
        reply = { it.send(200, """{"version":1,"contract":1,"minimumBuild":3,"rpId":"evil.test","browserReturn":"https://whumpo.com/app/return"}""") }
        assertEquals("invalid_response", failure { api.checkConfiguration() })
    }

    @Test fun sessionUsesOnlyFixedRouteBearerAndCurrentEmptyCapabilities() = runTest {
        assertEquals(BuildConfig.VERSION_CODE, JSONObject(IdentityProtocol.CLIENT).getInt("build"))
        reply = { it.send(200, """{"version":1,"account":{"id":"$account","label":"a***@example.test"},"session":{"expiresAt":"$expiry","freshUntil":"$fresh"}}""") }
        assertEquals(account, api.session(token).id)
        assertEquals("/api/mobile/v1/session", seen.single().first)
        val headers = seen.single().second
        assertEquals("Bearer $token", headers["authorization"])
        assertEquals(IdentityProtocol.CLIENT, headers["whumpo-client"])
        assertFalse(headers.containsKey("cookie")); assertFalse(headers.containsKey("origin"))
    }

    @Test fun browserStartSendsPublicChallengeButNoVerifierOrBearer() = runTest {
        val state = "s".repeat(43); val challenge = "c".repeat(43)
        reply = {
            assertEquals("POST", it.requestMethod)
            val body = JSONObject(it.requestBody.bufferedReader().readText())
            assertEquals(setOf("version", "purpose", "state", "codeChallenge", "codeChallengeMethod", "redirectUri"), body.keys().asSequence().toSet())
            assertEquals(state, body.getString("state")); assertEquals(challenge, body.getString("codeChallenge"))
            assertEquals(IdentityProtocol.RETURN_URI, body.getString("redirectUri")); assertEquals("S256", body.getString("codeChallengeMethod"))
            it.send(200, """{"version":1,"handoffId":"$account","browserPath":"/workspace/native/${"b".repeat(64)}","expiresAt":"$fresh"}""")
        }
        assertEquals(account, api.start(BrowserPurpose.RECOVERY, state, challenge).id)
        assertFalse(seen.single().second.containsKey("authorization"))
    }

    @Test fun redirectsAreNeverFollowedAndAnUnexpectedVersionIsRefused() = runTest {
        reply = { it.responseHeaders.add("Location", "/stolen"); it.send(302, "{}") }
        assertEquals("invalid_response", failure { api.session(token) })
        assertEquals(1, seen.size)
        reply = { it.send(200, """{"version":2,"account":{},"session":{}}""") }
        assertEquals("client_update_required", failure { api.session(token) })
    }

    @Test fun oversizedOrWidenedResponsesAndMalformedChallengesNeverReachThePrompt() = runTest {
        reply = { it.send(200, "x".repeat(65_537)) }
        assertEquals("invalid_response", failure { api.session(token) })
        reply = { it.send(200, """{"version":1,"account":{"id":"$account","label":"a***@example.test","email":"hidden"},"session":{"expiresAt":"$expiry","freshUntil":"$fresh"}}""") }
        assertEquals("invalid_response", failure { api.session(token) })
        reply = { it.send(200, """{"version":1,"challengeId":"$account","expiresAt":"$fresh","options":{"rpId":"evil.test","userVerification":"required"}}""") }
        assertEquals("invalid_response", failure { api.challenge() })
    }

    @Test fun revocationStatusClearsAuthorityEvenWithUnreadableErrorBodyAndNeverRetriesWrites() = runTest {
        reply = { it.send(401, "not-json") }
        assertEquals("proof_required", failure { api.session(token) })
        reply = { it.responseHeaders.add("Retry-After", "0"); it.send(503, """{"version":1,"error":{"code":"unavailable","message":"private-provider-detail"}}""") }
        assertEquals("unavailable", failure { api.logout(token) })
        assertEquals(2, seen.size)
        reply = { it.responseHeaders.add("Retry-After", "0"); it.send(408, """{"version":1,"error":{"code":"unavailable"}}""") }
        assertEquals("unavailable", failure { api.exchange(account, "b".repeat(64), "s".repeat(43), "v".repeat(43)) })
        assertEquals(3, seen.size)
    }

    private suspend fun failure(action: suspend () -> Unit): String = try { action(); fail("Expected refusal"); "" }
        catch (error: IdentityFailure) { error.code }

    private fun HttpExchange.send(status: Int, body: String) {
        responseHeaders.add("Content-Type", "application/json; charset=utf-8")
        val bytes = body.toByteArray(Charsets.UTF_8)
        sendResponseHeaders(status, bytes.size.toLong())
        responseBody.use { it.write(bytes) }
        close()
    }
}
