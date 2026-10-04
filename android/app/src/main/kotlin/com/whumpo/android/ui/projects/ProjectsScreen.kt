package com.whumpo.android.ui.projects

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.whumpo.android.R
import com.whumpo.android.ui.common.AvailabilityContent
import com.whumpo.android.ui.common.ScreenTitle
import com.whumpo.android.ui.common.ScrollingPage

@Composable
fun ProjectsScreen(viewModel: ProjectsViewModel) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    ScrollingPage {
        ScreenTitle(stringResource(R.string.nav_projects))
        Text(
            text = stringResource(R.string.projects_intro),
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onBackground,
        )
        AvailabilityContent(state) { projects ->
            projects.forEach { project ->
                Text("${project.name} · ${project.status}", style = MaterialTheme.typography.bodyLarge)
            }
        }
    }
}
