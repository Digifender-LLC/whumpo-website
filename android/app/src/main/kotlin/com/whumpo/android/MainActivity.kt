package com.whumpo.android

import android.os.Bundle
import android.content.Intent
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import com.whumpo.android.ui.WhumpoApp
import com.whumpo.android.ui.theme.WhumpoTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        val container = (application as WhumpoApplication).container
        if (savedInstanceState == null) receiveReturn(intent)
        setContent {
            WhumpoTheme {
                WhumpoApp(container)
            }
        }
    }
    override fun onStart() {
        super.onStart()
        val identity = (application as WhumpoApplication).container.identity
        if (identity.state.value.signedIn && !identity.state.value.busy) {
            lifecycleScope.launch { identity.checkSession() }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        receiveReturn(intent)
    }

    private fun receiveReturn(incoming: Intent?) {
        if (incoming?.action != Intent.ACTION_VIEW) return
        val uri = incoming.dataString ?: return
        // Never retain a one-time return code in Activity saved state or log it.
        incoming.data = null
        setIntent(Intent(this, MainActivity::class.java).setAction(Intent.ACTION_MAIN))
        lifecycleScope.launch {
            (application as WhumpoApplication).container.identity.receiveReturn(uri)
        }
    }
}
