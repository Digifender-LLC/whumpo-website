package com.whumpo.android

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
        val container = (application as WhumpoApplication).container
        setContent {
            WhumpoTheme {
                WhumpoApp(container)
            }
        }
    }
}
