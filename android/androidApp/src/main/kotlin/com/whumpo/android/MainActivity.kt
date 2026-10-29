package com.whumpo.android

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import com.whumpo.android.ui.WhumpoApp
import com.whumpo.android.ui.theme.WhumpoTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent {
            WhumpoTheme {
                WhumpoApp(container)
            }
        }
        handleLink(intent)
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
        handleLink(intent)
    }

    private fun handleLink(intent: Intent?) {
        if (intent?.action == Intent.ACTION_VIEW) intent.dataString?.let(container.auth::onReturn)
    }
}
