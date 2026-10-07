package com.whumpo.android.ui.activity

import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.whumpo.android.R
import com.whumpo.android.ui.common.ScreenTitle
import com.whumpo.android.ui.common.ScrollingPage
import com.whumpo.android.workspace.WorkspaceNotice
import com.whumpo.core.workspace.NativeWorkspaceController
import kotlinx.coroutines.launch

@Composable
fun ActivityScreen(controller: NativeWorkspaceController, origin: String) {
    val state by controller.state.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    LaunchedEffect(state.owner) { if (state.owner != null) controller.refreshActivity() }
    ScrollingPage {
        ScreenTitle(stringResource(R.string.nav_activity))
        Text("Saved account activity. A recorded request can still be pending or uncertain.")
        WorkspaceNotice(state, origin)
        OutlinedButton(onClick = { scope.launch { controller.refreshActivity() } }, enabled = state.owner != null && !state.busy) { Text("Refresh activity") }
        state.activity.forEach { item ->
            Text(item.action, style = MaterialTheme.typography.titleMedium)
            Text(item.summary)
            Text(item.createdAt, style = MaterialTheme.typography.bodySmall)
        }
        if (state.loaded && !state.busy && !state.onboardingRequired && state.activity.isEmpty()) Text("No activity is loaded. Refresh to check your account.")
        if (state.activityCursor != null && state.activity.size < 200) OutlinedButton(onClick = { scope.launch { controller.refreshActivity(more = true) } }, enabled = !state.busy) { Text("Earlier activity") }
    }
}
