package com.whumpo.android.workspace

import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.core.net.toUri
import com.whumpo.core.workspace.WorkspaceState

@Composable
fun WorkspaceNotice(state: WorkspaceState, origin: String) {
    Text(if (state.busy) "Loading…" else state.notice,
        modifier = Modifier.testTag("workspace-status").semantics { liveRegion = LiveRegionMode.Polite })
    if (state.onboardingRequired) WebsiteButton(origin, "Finish welcome in the browser")
}

/** The website keeps its own sign-in. Native credentials are never attached to a browser URL. */
@Composable
fun WebsiteButton(origin: String, label: String = "Open the workspace website") {
    val context = LocalContext.current
    var failed by remember { mutableStateOf(false) }
    OutlinedButton(onClick = {
        try { CustomTabsIntent.Builder().build().launchUrl(context, "$origin/workspace/".toUri()) }
        catch (_: Exception) { failed = true }
    }) { Text(label) }
    if (failed) Text("A browser could not be opened. Install a browser and try again.")
}
