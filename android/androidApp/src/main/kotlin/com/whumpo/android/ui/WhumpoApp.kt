package com.whumpo.android.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts.PickVisualMedia
import androidx.compose.runtime.Composable
import androidx.lifecycle.viewmodel.compose.viewModel
import com.whumpo.android.AppContainer
import com.whumpo.android.ui.auth.AuthGate
import com.whumpo.android.ui.activity.ActivityScreen
import com.whumpo.android.ui.chat.ChatScreen
import com.whumpo.android.ui.projects.ProjectsScreen
import com.whumpo.android.ui.projects.ProjectsViewModel
import com.whumpo.android.ui.settings.SettingsScreen
import com.whumpo.android.ui.shell.TopDestination
import com.whumpo.android.ui.shell.WhumpoShell

/**
 * Wires the shared adaptive shell (navigation, insets, back, panes) to the app's screens. Chat lays out its own panes
 * (the review sheet is its detail pane on expanded widths); Projects, Activity and Settings are in :shared and lay out theirs.
 */
@Composable
fun WhumpoApp(container: AppContainer) {
    // The shell only shows for a signed-in account; signed out, the sign-in screens (WP5) take its place.
    AuthGate(container.auth) {
        // No connectivity source yet, so the offline banner stays off until the API client reports one.
        WhumpoShell { destination, width ->
            when (destination) {
                TopDestination.Chat ->
                    ChatScreen(viewModel(factory = chatViewModelFactory(container)), width, container.environment.origin)
                TopDestination.Projects -> {
                    val projects = viewModel<ProjectsViewModel>(factory = projectsViewModelFactory(container))
                    // The system photo picker: no storage permission, and the app only sees the one photo the owner chose.
                    val picker = rememberLauncherForActivityResult(PickVisualMedia()) { uri -> uri?.let { projects.addPhoto(it.toString()) } }
                    ProjectsScreen(
                        projects, width, container.links,
                        onPickPhoto = { picker.launch(PickVisualMediaRequest(PickVisualMedia.ImageOnly)) },
                    )
                }
                TopDestination.Activity ->
                    ActivityScreen(viewModel(factory = activityViewModelFactory(container)), width, container.links)
                TopDestination.Settings ->
                    SettingsScreen(viewModel(factory = settingsViewModelFactory(container)), width, container.links)
            }
        }
    }
}
