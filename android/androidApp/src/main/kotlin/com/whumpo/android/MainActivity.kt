package com.whumpo.android

import android.content.ContentResolver
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import com.whumpo.android.ui.WhumpoApp
import com.whumpo.android.ui.share.SharedItem
import com.whumpo.android.ui.shell.DeepLink
import com.whumpo.android.ui.theme.WhumpoTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent {
            val preference by container.themes.preference.collectAsState()
            WhumpoTheme(darkTheme = preference.isDark(isSystemInDarkTheme())) {
                WhumpoApp(container)
            }
        }
        handleIntent(intent)
    }

    private val container get() = (application as WhumpoApplication).container

    // Passkey and Custom Tabs need the activity that is on screen.
    override fun onStart() {
        super.onStart()
        container.activities.started(this)
    }

    override fun onStop() {
        container.activities.stopped(this)
        super.onStop()
    }

    // The verified App Link https://whumpo.com/app/return comes back here (launchMode singleTask).
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(intent: Intent?) {
        if (intent?.action == Intent.ACTION_SEND) handleShare(intent) else handleLink(intent)
    }

    // The system share sheet. This only remembers what was shared; the owner confirms in a dialog before anything is
    // prepared, sent or fetched. Only an image content URI or plain text is accepted, and a link is never opened.
    internal fun handleShare(intent: Intent) {
        val type = intent.type.orEmpty()
        val item = when {
            type in SHARED_IMAGE_TYPES -> {
                @Suppress("DEPRECATION")
                val uri = intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
                uri?.takeIf { it.scheme == ContentResolver.SCHEME_CONTENT }?.let { SharedItem.Photo(it.toString()) }
            }
            type == "text/plain" ->
                intent.getStringExtra(Intent.EXTRA_TEXT)?.trim()?.takeIf { it.isNotEmpty() }?.let { SharedItem.Text(it.take(MAX_SHARED_TEXT)) }
            else -> null
        }
        if (item != null) container.shares.offer(item)
    }

    private companion object {
        val SHARED_IMAGE_TYPES = setOf("image/jpeg", "image/png", "image/webp")
        const val MAX_SHARED_TEXT = 4_000
    }

    // Verified App Links: the hand-off return, then the Projects and Activity deep links (docs/android/app-ux.md).
    internal fun handleLink(intent: Intent?) {
        if (intent?.action != Intent.ACTION_VIEW) return
        val url = intent.dataString ?: return
        val link = DeepLink.parse(url)
        if (link != null) container.deepLinks.offer(link) else container.auth.onReturn(url)
    }
}
