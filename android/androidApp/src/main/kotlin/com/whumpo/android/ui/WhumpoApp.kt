package com.whumpo.android.ui

import androidx.compose.runtime.Composable
import androidx.lifecycle.viewmodel.compose.viewModel
import com.whumpo.android.AppContainer
import com.whumpo.android.ui.auth.AuthGate
import com.whumpo.android.ui.activity.ActivityScreen
import com.whumpo.android.ui.chat.ChatScreen
import com.whumpo.android.ui.projects.ProjectsScreen
import com.whumpo.android.ui.settings.SettingsScreen
import com.whumpo.android.ui.shell.AdaptivePanes
import com.whumpo.android.ui.shell.DetailPlaceholder
import com.whumpo.android.ui.shell.TopDestination
import com.whumpo.android.ui.shell.WhumpoShell

/**
 * Wires the shared adaptive shell (navigation, insets, back, panes) to the app's screens. Chat lays out its own panes
 * (the review sheet is its detail pane on expanded widths); the other screens are the list pane with a placeholder
 * detail pane until WP7 fills it in.
 */
@Composable
fun WhumpoApp(container: AppContainer) {
    // The shell only shows for a signed-in account; signed out, the sign-in screens (WP5) take its place.
    AuthGate(container.auth) {
        // No connectivity source yet, so the offline banner stays off until the API client reports one.
        WhumpoShell { destination, width ->
            if (destination == TopDestination.Chat) {
                ChatScreen(viewModel(factory = chatViewModelFactory(container)), width, container.environment.origin)
            } else {
                AdaptivePanes(
                    width = width,
                    list = {
                        when (destination) {
                            TopDestination.Chat -> Unit
                            TopDestination.Projects -> ProjectsScreen(viewModel(factory = projectsViewModelFactory(container)))
                            TopDestination.Activity -> ActivityScreen(viewModel(factory = activityViewModelFactory(container)))
                            TopDestination.Settings -> SettingsScreen(viewModel(factory = settingsViewModelFactory(container)))
                        }
                    },
                    detail = { DetailPlaceholder() },
                )
            }
        }
    }
}
