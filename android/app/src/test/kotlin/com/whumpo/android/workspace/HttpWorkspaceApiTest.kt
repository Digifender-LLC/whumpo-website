package com.whumpo.android.workspace

import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import com.whumpo.android.identity.HttpIdentityApi
import com.whumpo.core.environment.WhumpoEnvironment
import com.whumpo.core.identity.IdentityFailure
import com.whumpo.core.identity.IdentityProtocol
import com.whumpo.core.workspace.PendingChat
import kotlinx.coroutines.test.runTest
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import java.net.InetSocketAddress
import java.util.concurrent.CopyOnWriteArrayList

class HttpWorkspaceApiTest {
    private lateinit var server: HttpServer
    private lateinit var api: HttpWorkspaceApi
    private var reply: (HttpExchange) -> Unit = { it.send(503, "{}") }
    private val requests = CopyOnWriteArrayList<String>()
    private val token = "a".repeat(64)
    private val id = "00000000-0000-4000-8000-000000000001"
    private val time = "2026-10-07T12:00:00.000Z"
    @Before fun start() {
        server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/") { requests += it.requestURI.toASCIIString(); reply(it) }
        server.start()
        api = HttpWorkspaceApi(HttpIdentityApi(WhumpoEnvironment.from("local", "http://127.0.0.1:${server.address.port}")))
    }
    @After fun stop() { server.stop(0) }

    @Test fun onboardingOnlyAcceptsTheFixedBrowserDestinationAndNoChatBeforeWelcome() = runTest {
        reply = { it.send(200, """{"version":1,"onboarding":{"complete":false,"browserPath":"/workspace/"},"chat":null,"projectCount":0,"pendingReviewCount":0}""") }
        assertFalse(api.bootstrap(token).onboardingComplete)
        reply = { it.send(200, """{"version":1,"onboarding":{"complete":false,"browserPath":"https://foreign.invalid/"},"chat":null,"projectCount":0,"pendingReviewCount":0}""") }
        assertEquals("invalid_response", failure { api.bootstrap(token) })
    }

    @Test fun boundedHistorySupportsRealTextSizesAndEncodesSearchWithoutLeakingCredentials() = runTest {
        reply = {
            assertEquals("Bearer $token", it.requestHeaders.getFirst("Authorization"))
            assertEquals(IdentityProtocol.CLIENT, it.requestHeaders.getFirst("Whumpo-Client"))
            assertNull(it.requestHeaders.getFirst("Cookie")); assertNull(it.requestHeaders.getFirst("Origin"))
            val items = (1..4).joinToString(",") { n -> turn(n, "x".repeat(20_000)) }
            it.send(200, """{"version":1,"revision":4,"mode":"guided","items":[$items],"nextCursor":"abc_123"}""")
        }
        val page = api.chat(token, "prior_123", "a & b")
        assertEquals(4, page.items.size); assertEquals(20_000, page.items.first().assistantText!!.length)
        assertEquals("abc_123", page.nextCursor)
        assertEquals("/api/mobile/v1/chat?limit=10&cursor=prior_123&q=a%20%26%20b", requests.single())
    }

    @Test fun exactOriginalMutationIsOneShotEvenWhen503RequestsImmediateRetry() = runTest {
        val pending = PendingChat(id, 7, "Exact original content")
        reply = {
            assertEquals("POST", it.requestMethod)
            val body = JSONObject(it.requestBody.bufferedReader().readText())
            assertEquals(setOf("version", "requestId", "expectedRevision", "content"), body.keys().asSequence().toSet())
            assertEquals(id, body.getString("requestId")); assertEquals(7, body.getInt("expectedRevision")); assertEquals(pending.content, body.getString("content"))
            it.responseHeaders.add("Retry-After", "0")
            it.send(503, """{"version":1,"error":{"code":"unavailable"}}""")
        }
        assertEquals("unavailable", failure { api.send(token, pending) })
        assertEquals(listOf("/api/mobile/v1/chat/messages"), requests.toList())
    }

    @Test fun activityPreservesItsRealOpaquePrefixedIdsAndPagingCursor() = runTest {
        reply = { it.send(200, """{"version":1,"items":[{"id":"project:$id","projectId":"$id","action":"project.created","summary":"Saved project","createdAt":"$time"}],"nextCursor":"next_123"}""") }
        val page = api.activity(token, null)
        assertEquals("project:$id", page.items.single().id); assertEquals("next_123", page.nextCursor)
        reply = { it.send(200, """{"version":1,"items":[{"id":"https://foreign.invalid","projectId":null,"action":"x","summary":"x","createdAt":"$time"}],"nextCursor":null}""") }
        assertEquals("invalid_response", failure { api.activity(token, "next_123") })
    }

    @Test fun malformedOrderingAndUnadvertisedReviewAuthorityAreRefused() = runTest {
        reply = { it.send(200, """{"version":1,"revision":2,"mode":"guided","items":[${turn(2)},${turn(1)}],"nextCursor":null}""") }
        assertEquals("invalid_response", failure { api.chat(token, null, "") })
        reply = { it.send(200, """{"version":1,"turn":${turn(1).replace("\"review\":null", "\"review\":{\"canApprove\":true,\"control\":{}}")} }""") }
        assertEquals("invalid_response", failure { api.turn(token, id) })
        reply = { it.send(200, """{"version":1,"revision":0,"mode":"guided","items":[],"nextCursor":null,"commands":["approve"]}""") }
        assertEquals("invalid_response", failure { api.chat(token, null, "") })
    }

    private fun turn(n: Int, assistant: String = "saved") = """{"id":"00000000-0000-4000-8000-${n.toString().padStart(12, '0')}","revision":$n,"status":"completed","mode":"guided","createdAt":"$time","userText":"message$n","assistantText":"$assistant","review":null,"interaction":null}"""
    private suspend fun failure(action: suspend () -> Unit): String = try { action(); fail("Expected refusal"); "" } catch (error: IdentityFailure) { error.code }
    private fun HttpExchange.send(status: Int, text: String) {
        responseHeaders.add("Content-Type", "application/json")
        val bytes = text.toByteArray(); sendResponseHeaders(status, bytes.size.toLong())
        responseBody.use { it.write(bytes) }; close()
    }
}
