package com.whumpo.core.push

import com.whumpo.android.ui.ApiFixtures
import io.ktor.http.HttpMethod
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DeviceNotificationsTest {
    private val api = ApiFixtures()

    @Test
    fun withoutFirebaseNothingIsRegisteredAndNoRequestIsMade() = runTest {
        val notifications = DeviceNotifications(api.client, NoOpPushMessaging)
        assertFalse(notifications.available)
        assertNull(notifications.register())
        assertTrue(api.requests.isEmpty())
    }

    @Test
    fun registerSendsTheTokenAndThePreference() = runTest {
        val push = object : PushMessaging {
            override val available = true

            override suspend fun token() = "SYNTHETIC-TOKEN-0001"

            override suspend fun deleteToken() = Unit
        }
        val response = DeviceNotifications(api.client, push).register(notificationsEnabled = true)!!
        assertTrue(response.preferences.notificationsEnabled)
        val body = api.bodies.single().decodeToString()
        assertTrue(body.contains("\"fcmRegistrationToken\":\"SYNTHETIC-TOKEN-0001\""))
        assertTrue(body.contains("\"notificationsEnabled\":true"))
    }

    @Test
    fun removeDeletesTheServerDeviceThenTheLocalToken() = runTest {
        var deleted = false
        val push = object : PushMessaging {
            override val available = true

            override suspend fun token(): String? = null

            override suspend fun deleteToken() {
                deleted = true
            }
        }
        assertTrue(DeviceNotifications(api.client, push).remove().removed)
        assertEquals(HttpMethod.Delete, api.requests.single().method)
        assertTrue(deleted)
    }

    @Test
    fun eventReadIsAnAuthenticatedGetOnly() = runTest {
        val event = DeviceNotifications(api.client, NoOpPushMessaging).event("bbbbbbbb-bbbb-4bbb-8bbb-000000000001")
        assertEquals("review_pending", event.kind)
        assertEquals(HttpMethod.Get, api.requests.single().method)
        assertEquals("Bearer ${ApiFixtures.TOKEN}", api.requests.single().headers["Authorization"])
    }
}
