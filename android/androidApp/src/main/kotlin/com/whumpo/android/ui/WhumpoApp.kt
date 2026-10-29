package com.whumpo.android.ui

import androidx.compose.runtime.Composable
import androidx.lifecycle.viewmodel.compose.viewModel
import com.whumpo.android.AppContainer
import com.whumpo.android.ui.activity.ActivityScreen
import com.whumpo.android.ui.chat.ChatScreen
import com.whumpo.android.ui.projects.ProjectsScreen
import com.whumpo.android.ui.settings.SettingsScreen
import com.whumpo.android.ui.shell.AdaptivePanes
import com.whumpo.android.ui.shell.DetailPlaceholder
import com.whumpo.android.ui.shell.TopDestination
import com.whumpo.android.ui.shell.WhumpoShell

/**
 * Wires the shared adaptive shell (navigation, insets, back, panes) to the app's screens. On expanded widths
 * each screen is the list pane and the detail pane is a placeholder until WP6 and WP7 fill it in.
 */
@Composable
fun WhumpoApp(container: AppContainer) {
    // No connectivity source yet, so the offline banner stays off until the API client reports one.
    WhumpoShell { destination, width ->
        AdaptivePanes(
            width = width,
            list = {
                when (destination) {
                    TopDestination.Chat -> ChatScreen(viewModel(factory = chatViewModelFactory(container)))
                    TopDestination.Projects -> ProjectsScreen(viewModel(factory = projectsViewModelFactory(container)))
                    TopDestination.Activity -> ActivityScreen(viewModel(factory = activityViewModelFactory(container)))
                    TopDestination.Settings -> SettingsScreen(viewModel(factory = settingsViewModelFactory(container)))
                }
            },
            detail = { DetailPlaceholder() },
        )
    }
}
