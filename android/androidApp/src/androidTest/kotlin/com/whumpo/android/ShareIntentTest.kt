package com.whumpo.android

import android.content.ContentValues
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.provider.MediaStore
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * WH-085 on the emulator: the system share sheet's intents (ACTION_SEND) reach the app, and nothing is prepared, uploaded or
 * sent until the owner confirms. The server is [FakeWorker] on device loopback; this is synthetic emulator evidence, not
 * a physical device and not a safety-scan or provider result.
 */
@RunWith(AndroidJUnit4::class)
class ShareIntentTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    private lateinit var worker: FakeWorker
    private var scenario: ActivityScenario<MainActivity>? = null
    private var photoUri: Uri? = null

    @Before
    fun signedInWithAFakeWorker() {
        // The loopback stand-in speaks cleartext HTTP on 127.0.0.1, which only the local flavor's network config allows.
        assumeTrue(BuildConfig.WHUMPO_ENVIRONMENT == "local")
        Fixtures.reset()
        worker = FakeWorker()
        // Account state plus an in-memory bearer, as a finished sign-in would leave them. Synthetic values only.
        Fixtures.container.sessions.begin("0".repeat(63) + "1")
        Fixtures.container.accountState.activate(Fixtures.ownerA)
    }

    @After
    fun cleanUp() {
        scenario?.close()
        if (!::worker.isInitialized) return
        photoUri?.let { InstrumentationRegistry.getInstrumentation().targetContext.contentResolver.delete(it, null, null) }
        if (::worker.isInitialized) worker.close()
        Fixtures.reset()
    }

    private fun launch(intent: Intent) {
        scenario = ActivityScenario.launch(intent.setClassName(Fixtures.app.packageName, MainActivity::class.java.name))
        compose.waitUntil(10_000) { compose.onAllNodesWithTag("share-dialog").fetchSemanticsNodes().isNotEmpty() }
    }

    private fun sharedText(text: String) = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text)

    private fun sharedPhoto(): Intent {
        val bitmap = Bitmap.createBitmap(64, 48, Bitmap.Config.ARGB_8888).apply { eraseColor(Color.rgb(20, 120, 200)) }
        val values = ContentValues().apply {
            put(MediaStore.Images.Media.DISPLAY_NAME, "synthetic-share.jpg")
            put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg")
            put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/whumpo-synthetic")
        }
        val resolver = InstrumentationRegistry.getInstrumentation().targetContext.contentResolver
        val uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)!!
        resolver.openOutputStream(uri)!!.use { bitmap.compress(Bitmap.CompressFormat.JPEG, 90, it) }
        photoUri = uri
        return Intent(Intent.ACTION_SEND).setType("image/jpeg").putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }

    /** Emulator screenshots for the PR (app external files, pulled by adb); a failure to capture never fails a test. */
    private fun shot(name: String) {
        try {
            val ctx = InstrumentationRegistry.getInstrumentation().targetContext
            val dir = java.io.File(ctx.getExternalFilesDir(null), "shots").apply { mkdirs() }
            val night = (ctx.resources.configuration.uiMode and android.content.res.Configuration.UI_MODE_NIGHT_MASK) ==
                android.content.res.Configuration.UI_MODE_NIGHT_YES
            Thread.sleep(400)
            InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()?.let { bmp ->
                java.io.File(dir, "$name-${if (night) "dark" else "light"}.png").outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
            }
        } catch (_: Exception) {
        }
    }

    private fun waitFor(timeout: Long = 10_000, condition: () -> Boolean) = compose.waitUntil(timeout, condition)

    @Test
    fun sharedTextOnlyReachesTheDraftAfterConfirmAndIsNeverSent() {
        launch(sharedText("Please add opening hours https://example.test/hours"))
        compose.onNodeWithTag("share-text").assertIsDisplayed()
        shot("share-text")
        // Before confirming: nothing was posted, and the link was not fetched.
        assertTrue(worker.requests.none { it.method != "GET" })
        assertTrue(worker.requests.none { "example.test" in it.path })

        compose.onNodeWithTag("share-confirm").performClick()
        waitFor { compose.onAllNodesWithTag("share-dialog").fetchSemanticsNodes().isEmpty() }
        waitFor { compose.onAllNodesWithText("Please add opening hours", substring = true).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("chat-composer").assertIsDisplayed()
        Thread.sleep(500)
        assertTrue("the draft is not sent", worker.requests.none { it.method != "GET" })
    }

    @Test
    fun cancellingAShareSendsAndUploadsNothing() {
        launch(sharedPhoto())
        compose.onNodeWithTag("share-cancel").performClick()
        waitFor { compose.onAllNodesWithTag("share-dialog").fetchSemanticsNodes().isEmpty() }
        Thread.sleep(500)
        assertTrue(worker.uploads().isEmpty())
        assertTrue(runBlocking { Fixtures.container.uploads.load() }.isEmpty())
    }

    @Test
    fun aSharedPhotoUploadsOnlyAfterAProjectIsChosenAndConfirmed() {
        launch(sharedPhoto())
        waitFor { compose.onAllNodesWithTag("share-project-${FakeWorker.PROJECT_ID}").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("share-confirm").assertIsNotEnabled()
        shot("share-photo-choose")
        assertTrue(worker.uploads().isEmpty())

        compose.onNodeWithTag("share-project-${FakeWorker.PROJECT_ID}").performClick()
        compose.onNodeWithTag("share-confirm").assertIsEnabled()
        shot("share-photo-chosen")
        Thread.sleep(500)
        assertTrue("choosing a project is not submitting", worker.uploads().isEmpty())

        compose.onNodeWithTag("share-confirm").performClick()
        waitFor { worker.uploads().isNotEmpty() }
        val put = worker.uploads().single()
        assertEquals("synthetic-share.jpg", put.headers["x-photo-name"])
        // A prepared baseline JPEG with no EXIF/APPn segment.
        assertEquals(0xFF.toByte(), put.body[0])
        assertEquals(0xD8.toByte(), put.body[1])
        assertFalse(String(put.body, Charsets.ISO_8859_1).contains("Exif"))
        assertTrue(put.body.size <= 1_048_576)
    }

    @Test
    fun aLostReplyKeepsTheExactBytesAndRetriesTheSameRequestUntilLogoutErasesThem() {
        worker.dropUploads = true
        launch(sharedPhoto())
        waitFor { compose.onAllNodesWithTag("share-project-${FakeWorker.PROJECT_ID}").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("share-project-${FakeWorker.PROJECT_ID}").performClick()
        compose.onNodeWithTag("share-confirm").performClick()

        // The reply is lost; the status read finds nothing; the owner sees a retry that "won't be added twice".
        waitFor { compose.onAllNodesWithText("Try again").fetchSemanticsNodes().isNotEmpty() }
        worker.dropUploads = false
        val first = worker.uploads().first()
        val kept = runBlocking { Fixtures.container.uploads.load() }.single()
        assertArrayEquals(first.body, kept.jpeg)
        assertTrue(first.path.endsWith("/photos/${kept.id}"))

        compose.onAllNodesWithText("Try again")[0].performScrollTo().performClick()
        waitFor { worker.uploads().size > 1 && runBlocking { Fixtures.container.uploads.load() }.isEmpty() }
        val second = worker.uploads().last()
        worker.uploads().forEach { assertArrayEquals(first.body, it.body); assertEquals(first.path, it.path) }
        assertEquals(first.path, second.path)
        assertEquals(first.headers["x-photo-name"], second.headers["x-photo-name"])
        assertArrayEquals(first.body, second.body)

        // And a fresh interrupted upload does not survive sign-out.
        runBlocking {
            Fixtures.container.uploads.save(com.whumpo.android.ui.photos.PendingUpload("00000000-0000-4000-8000-0000000000aa", FakeWorker.PROJECT_ID, "x.jpg", first.body))
        }
        Fixtures.container.accountState.signOut()
        assertTrue(runBlocking { Fixtures.container.uploads.load() }.isEmpty())
    }

    @Test
    fun unsupportedSharesAreIgnored() {
        scenario = ActivityScenario.launch(
            Intent(Intent.ACTION_SEND).setType("application/pdf").putExtra(Intent.EXTRA_TEXT, "x")
                .setClassName(Fixtures.app.packageName, MainActivity::class.java.name),
        )
        Thread.sleep(1_000)
        assertTrue(compose.onAllNodesWithTag("share-dialog").fetchSemanticsNodes().isEmpty())
        // A file:// handle is refused as well.
        scenario!!.onActivity {
            it.handleShare(Intent(Intent.ACTION_SEND).setType("image/jpeg").putExtra(Intent.EXTRA_STREAM, Uri.parse("file:///data/local/tmp/x.jpg")))
        }
        Thread.sleep(500)
        assertTrue(compose.onAllNodesWithTag("share-dialog").fetchSemanticsNodes().isEmpty())
        assertTrue(worker.requests.none { it.method != "GET" })
    }
}
