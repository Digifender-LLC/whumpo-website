package com.whumpo.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import com.whumpo.android.ui.WhumpoApp
import com.whumpo.android.ui.theme.WhumpoTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        val container = (application as WhumpoApplication).container
        setContent {
            val preference by container.themes.preference.collectAsState()
            WhumpoTheme(darkTheme = preference.isDark(isSystemInDarkTheme())) {
                WhumpoApp(container)
            }
        }
    }
}
