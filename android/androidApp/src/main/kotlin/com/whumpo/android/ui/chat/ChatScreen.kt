package com.whumpo.android.ui.chat

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.whumpo.android.R
import com.whumpo.android.ui.common.ScreenTitle
import com.whumpo.android.ui.common.ScrollingPage
import com.whumpo.android.ui.common.UnavailableNotice
import com.whumpo.core.data.UnavailableReason

@Composable
fun ChatScreen(viewModel: ChatViewModel) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    Column(modifier = Modifier.fillMaxSize().imePadding()) {
        ScrollingPage(modifier = Modifier.weight(1f)) {
            ScreenTitle(stringResource(R.string.nav_chat))
            Text(
                text = stringResource(R.string.chat_intro),
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onBackground,
            )
            if (!state.loading && state.owner == null) {
                UnavailableNotice(UnavailableReason.SIGN_IN_REQUIRED)
            }
        }
        if (state.owner != null) {
            Composer(
                draft = state.draft,
                enabled = state.composerEnabled,
                onDraftChanged = viewModel::onDraftChanged,
            )
        }
    }
}

@Composable
private fun Composer(draft: String, enabled: Boolean, onDraftChanged: (String) -> Unit) {
    Surface(tonalElevation = 2.dp, modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp)) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                OutlinedTextField(
                    value = draft,
                    onValueChange = onDraftChanged,
                    enabled = enabled,
                    label = { Text(stringResource(R.string.chat_composer_label)) },
                    maxLines = 5,
                    modifier = Modifier.weight(1f).testTag("chat-composer"),
                )
                // Sending needs the native session and mobile API (WH-083/084).
                Button(onClick = {}, enabled = false) {
                    Text(stringResource(R.string.chat_send))
                }
            }
            Text(
                text = stringResource(R.string.chat_send_unavailable),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 8.dp),
            )
        }
    }
}
