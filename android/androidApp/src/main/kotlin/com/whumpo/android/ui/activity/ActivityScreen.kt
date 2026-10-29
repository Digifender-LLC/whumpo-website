package com.whumpo.android.ui.activity

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
fun ActivityScreen(viewModel: ActivityViewModel) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    ScrollingPage {
        ScreenTitle(stringResource(R.string.nav_activity))
        Text(
            text = stringResource(R.string.activity_intro),
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onBackground,
        )
        AvailabilityContent(state) { items ->
            items.forEach { item ->
                Text("${item.title} · ${item.state}", style = MaterialTheme.typography.bodyLarge)
            }
        }
    }
}
