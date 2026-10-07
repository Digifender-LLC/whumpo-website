package com.whumpo.android.ui.chat

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
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
import com.whumpo.android.workspace.WebsiteButton
import com.whumpo.android.workspace.WorkspaceNotice
import com.whumpo.core.data.UnavailableReason
import com.whumpo.core.workspace.ChatDelivery
import com.whumpo.core.workspace.NativeWorkspaceController
import kotlinx.coroutines.launch

@Composable
fun ChatScreen(viewModel: ChatViewModel, controller: NativeWorkspaceController, origin: String) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val workspace by controller.state.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    var search by remember { mutableStateOf("") }
    LaunchedEffect(workspace.acceptedDraft) {
        workspace.acceptedDraft?.let { viewModel.accepted(workspace.owner, it.second) }
    }
    Column(modifier = Modifier.fillMaxSize().imePadding()) {
        ScrollingPage(modifier = Modifier.weight(1f)) {
            ScreenTitle(stringResource(R.string.nav_chat))
            if (!state.loading && state.owner == null) UnavailableNotice(UnavailableReason.SIGN_IN_REQUIRED)
            if (state.owner != null) {
                WorkspaceNotice(workspace, origin)
                OutlinedTextField(search, { search = it.take(100) }, label = { Text("Search conversation") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedButton(onClick = { scope.launch { controller.refreshChat(search) } }, enabled = !workspace.busy) { Text("Refresh and search") }
                if (workspace.chatCursor != null && workspace.chat.size < 200) OutlinedButton(onClick = { scope.launch { controller.olderChat() } }, enabled = !workspace.busy) { Text("Earlier messages") }
                workspace.chat.forEach { turn ->
                    HorizontalDivider()
                    Text("You · ${turn.createdAt}", style = MaterialTheme.typography.labelLarge)
                    Text(turn.userText)
                    Text("Whumpo · ${turn.status}", style = MaterialTheme.typography.labelLarge)
                    Text(turn.assistantText ?: if (turn.status == "pending") "Reply pending. Refresh to check." else "No reply text was saved.")
                    if (turn.hasReview || turn.hasInteraction) {
                        Text("This request includes a review or form. Complete it on the website; this app cannot approve or submit it.")
                        WebsiteButton(origin)
                    }
                }
                workspace.pending?.let { pending ->
                    HorizontalDivider()
                    Text("Saved request", style = MaterialTheme.typography.titleMedium)
                    Text(pending.content)
                    Text(if (pending.delivery == ChatDelivery.ACCEPTED) "Saved by Whumpo · ${pending.status ?: "status unknown"}" else "Delivery needs confirmation. The original request is saved on this device.")
                    OutlinedButton(onClick = { scope.launch { controller.checkPending() } }, enabled = !workspace.busy, modifier = Modifier.testTag("chat-check-request")) { Text("Check saved request") }
                    if (pending.delivery == ChatDelivery.NOT_FOUND) OutlinedButton(onClick = { scope.launch { controller.resendOriginal() } }, enabled = !workspace.busy,
                        modifier = Modifier.testTag("chat-resend-original")) { Text("Resend exact original request") }
                    if (pending.delivery == ChatDelivery.NOT_FOUND && (workspace.revision ?: -1) > pending.expectedRevision) OutlinedButton(onClick = { scope.launch { controller.releaseStaleMissingRequest() } }, enabled = !workspace.busy) { Text("Release the missing request and review my draft") }
                    if (pending.delivery == ChatDelivery.ACCEPTED && pending.status == "uncertain") OutlinedButton(onClick = { scope.launch { controller.acknowledgeUncertain() } }, enabled = !workspace.busy) { Text("Keep uncertain result and compose a different request") }
                }
            }
        }
        if (state.owner != null) {
            Surface(tonalElevation = 2.dp, modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        OutlinedTextField(state.draft, viewModel::onDraftChanged, enabled = state.composerEnabled,
                            label = { Text(stringResource(R.string.chat_composer_label)) }, maxLines = 5,
                            modifier = Modifier.weight(1f).testTag("chat-composer"))
                        Button(onClick = { scope.launch { controller.send(state.draft) } },
                            enabled = workspace.owner == state.owner && workspace.loaded && !workspace.onboardingRequired && !workspace.busy && workspace.pending == null && NativeWorkspaceController.validContent(state.draft.trim()),
                            modifier = Modifier.testTag("chat-send")) { Text(stringResource(R.string.chat_send)) }
                    }
                    Text("${state.draft.trim().length}/1000 · Send starts this request once. Reconnect never sends a saved request.", style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    }
}
