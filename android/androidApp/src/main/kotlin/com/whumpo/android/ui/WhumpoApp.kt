package com.whumpo.android.ui

import androidx.annotation.DrawableRes
import androidx.annotation.StringRes
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.whumpo.android.AppContainer
import com.whumpo.android.R
import com.whumpo.android.ui.activity.ActivityScreen
import com.whumpo.android.ui.chat.ChatScreen
import com.whumpo.android.ui.projects.ProjectsScreen
import com.whumpo.android.ui.settings.SettingsScreen

/** Top-level destinations. Chat is first: it is the primary owner surface. */
enum class TopDestination(
    val route: String,
    @param:StringRes val label: Int,
    @param:DrawableRes val icon: Int,
) {
    CHAT("chat", R.string.nav_chat, R.drawable.ic_nav_chat),
    PROJECTS("projects", R.string.nav_projects, R.drawable.ic_nav_projects),
    ACTIVITY("activity", R.string.nav_activity, R.drawable.ic_nav_activity),
    SETTINGS("settings", R.string.nav_settings, R.drawable.ic_nav_settings),
}

@Composable
fun WhumpoApp(container: AppContainer) {
    val navController = rememberNavController()
    val backStack by navController.currentBackStackEntryAsState()
    val current = backStack?.destination

    Scaffold(
        bottomBar = {
            NavigationBar {
                TopDestination.entries.forEach { destination ->
                    val selected = current?.hierarchy?.any { it.route == destination.route } == true
                    NavigationBarItem(
                        modifier = Modifier.testTag("nav-${destination.route}"),
                        selected = selected,
                        onClick = {
                            navController.navigate(destination.route) {
                                popUpTo(navController.graph.findStartDestination().id) { saveState = true }
                                launchSingleTop = true
                                restoreState = true
                            }
                        },
                        // The visible label names the tab for TalkBack; the icon is decorative.
                        icon = { Icon(painterResource(destination.icon), contentDescription = null) },
                        label = { Text(stringResource(destination.label)) },
                    )
                }
            }
        },
    ) { padding ->
        NavHost(
            navController = navController,
            startDestination = TopDestination.CHAT.route,
            modifier = Modifier.padding(padding).consumeWindowInsets(padding),
        ) {
            composable(TopDestination.CHAT.route) {
                ChatScreen(viewModel(factory = chatViewModelFactory(container)))
            }
            composable(TopDestination.PROJECTS.route) {
                ProjectsScreen(viewModel(factory = projectsViewModelFactory(container)))
            }
            composable(TopDestination.ACTIVITY.route) {
                ActivityScreen(viewModel(factory = activityViewModelFactory(container)))
            }
            composable(TopDestination.SETTINGS.route) {
                SettingsScreen(viewModel(factory = settingsViewModelFactory(container)))
            }
        }
    }
}
