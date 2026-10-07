package com.whumpo.android.ui.projects

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
fun ProjectsScreen(controller: NativeWorkspaceController, origin: String) {
    val state by controller.state.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    LaunchedEffect(state.owner) { if (state.owner != null) controller.refreshProjects() }
    ScrollingPage {
        ScreenTitle(stringResource(R.string.nav_projects))
        Text("Your private projects and their current website and application status.")
        WorkspaceNotice(state, origin)
        OutlinedButton(onClick = { scope.launch { controller.refreshProjects() } }, enabled = state.owner != null && !state.busy) { Text("Refresh projects") }
        state.projects.forEach { project ->
            Text(project.name, style = MaterialTheme.typography.titleLarge)
            Text(project.purpose)
            Text("${project.status} · Website ${if (project.siteLive) "live" else "offline"} · Application ${if (project.backendLive) "live" else "offline"}")
        }
        if (state.loaded && !state.busy && !state.onboardingRequired && state.projects.isEmpty()) Text("No projects are loaded. Refresh to check your account.")
        if (state.projectCursor != null && state.projects.size < 200) OutlinedButton(onClick = { scope.launch { controller.refreshProjects(more = true) } }, enabled = !state.busy) { Text("More projects") }
    }
}
