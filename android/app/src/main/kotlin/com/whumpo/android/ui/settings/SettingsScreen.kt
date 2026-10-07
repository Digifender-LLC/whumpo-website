package com.whumpo.android.ui.settings

import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.whumpo.android.R
import com.whumpo.android.identity.IdentityPanel
import com.whumpo.core.identity.NativeIdentityController
import com.whumpo.android.ui.common.ScreenTitle
import com.whumpo.android.ui.common.ScrollingPage
import com.whumpo.core.environment.EnvironmentKind

@Composable
fun SettingsScreen(viewModel: SettingsViewModel, identity: NativeIdentityController) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    ScrollingPage {
        ScreenTitle(stringResource(R.string.nav_settings))

        SectionTitle(stringResource(R.string.settings_account))
        if (state.signedIn) {
            Text(stringResource(R.string.settings_signed_in), style = MaterialTheme.typography.bodyLarge)
            Text(
                stringResource(R.string.settings_sign_out_detail),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            OutlinedButton(onClick = viewModel::signOut, modifier = Modifier.testTag("settings-sign-out")) {
                Text(stringResource(R.string.settings_sign_out))
            }
        } else {
            Text(stringResource(R.string.settings_signed_out), style = MaterialTheme.typography.bodyLarge)
        }

        IdentityPanel(identity)

        HorizontalDivider()
        SectionTitle(stringResource(R.string.settings_environment))
        Text(
            text = when (state.environmentKind) {
                EnvironmentKind.LOCAL -> stringResource(R.string.settings_environment_local, state.origin)
                EnvironmentKind.TEST -> stringResource(R.string.settings_environment_test, state.origin)
            },
            style = MaterialTheme.typography.bodyLarge,
            modifier = Modifier.testTag("settings-environment"),
        )
        Text(
            stringResource(R.string.settings_version, state.versionName),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun SectionTitle(text: String) {
    Text(
        text = text,
        style = MaterialTheme.typography.titleMedium,
        color = MaterialTheme.colorScheme.primary,
        modifier = Modifier.semantics { heading() },
    )
}
