package com.whumpo.android.workspace

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.whumpo.android.identity.AndroidPasskeys
import com.whumpo.core.identity.NativeIdentityController
import com.whumpo.core.workspace.*
import kotlinx.coroutines.launch
import java.time.Instant

/** The complete server-owned disclosure and source precede the closed, explicitly chosen control. */
@Composable
fun NativeReviewPanel(controller: NativeWorkspaceController, identity: NativeIdentityController, origin: String) {
    val state by controller.state.collectAsStateWithLifecycle()
    val auth by identity.state.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val activity = remember(context) { context.reviewActivity() }
    HorizontalDivider()
    Text("Pending reviews", style = MaterialTheme.typography.titleLarge)
    OutlinedButton(onClick = { scope.launch { controller.refreshReviews() } }, enabled = !state.busy) { Text("Refresh pending reviews") }
    state.pendingApproval?.let { pending ->
        Text("Saved approval · ${pending.control.kind.wire}", style = MaterialTheme.typography.titleMedium)
        Text("Review ${pending.control.reviewId}")
        Text(if (pending.delivery == ChatDelivery.ACCEPTED) "Saved by Whumpo · ${pending.status ?: "status unknown"}" else "Delivery needs confirmation. No approval will be repeated automatically.")
        OutlinedButton(onClick = { scope.launch { controller.checkPendingApproval() } }, enabled = !state.busy,
            modifier = Modifier.testTag("review-check-result")) { Text("Check saved approval result") }
        if (pending.delivery == ChatDelivery.NOT_FOUND) Text("No result was found. Refresh and read the unchanged review below before explicitly retrying this exact original approval.")
        if (pending.delivery == ChatDelivery.NOT_FOUND && (state.revision ?: -1) > pending.expectedRevision)
            OutlinedButton(onClick = { scope.launch { controller.releaseStaleMissingApproval() } }, enabled = !state.busy) { Text("Release the missing approval from an older conversation") }
        if (pending.delivery == ChatDelivery.ACCEPTED && pending.status == "uncertain")
            OutlinedButton(onClick = { scope.launch { controller.acknowledgeUncertainApproval() } }, enabled = !state.busy) { Text("Keep the uncertain result and review other work") }
    }
    state.reviews.forEach { review ->
        val fingerprint = review.fingerprint()
        key(state.owner, fingerprint) {
            var acknowledged by remember { mutableStateOf(false) }
            var confirmation by remember { mutableStateOf("") }
            HorizontalDivider()
            Text(review.title, style = MaterialTheme.typography.titleMedium)
            review.projectName?.let { Text(it) }
            Text("Review ${review.id} · ${review.state} · expires ${review.expiresAt}", style = MaterialTheme.typography.bodySmall)
            review.lines.forEach { Text(it) }
            review.source?.let { source ->
                Text("Complete saved program", style = MaterialTheme.typography.titleSmall)
                SelectionContainer {
                    Text(source, fontFamily = FontFamily.Monospace,
                        modifier = Modifier.fillMaxWidth().heightIn(max = 400.dp).verticalScroll(rememberScrollState()).testTag("review-complete-source"))
                }
                SelectionContainer { Text("SHA-256: ${review.sourceDigest}", style = MaterialTheme.typography.bodySmall) }
            }
            if (review.kind !in setOf(ReviewKind.APPLICATION, ReviewKind.RESTORE)) {
                Text("Open the website to inspect the private comparison and approve this review. This app has no approval control for it.")
                WebsiteButton(origin)
            } else if (!review.canApprove) {
                Text("Approval is unavailable (${review.unavailableReason ?: review.state}). Refresh to read a current review.")
            } else {
                Row {
                    Checkbox(acknowledged, { acknowledged = it }, modifier = Modifier.testTag("review-acknowledge"))
                    Text(if (review.source != null) "I have read all disclosures and the complete saved program above." else "I have read all disclosures and understand the exact data replacement above.")
                }
                if (review.kind == ReviewKind.RESTORE) {
                    OutlinedTextField(confirmation, { confirmation = it.take(7) }, label = { Text("Type RESTORE to acknowledge data replacement") },
                        singleLine = true, modifier = Modifier.fillMaxWidth().testTag("review-restore-ack"))
                    Text(if (controller.hasFreshProof()) "A recent passkey verification is available. Approval remains a separate action." else "Verify with a passkey before approving. Verification alone never sends the approval.")
                    OutlinedButton(onClick = { activity?.let { scope.launch { identity.passkey(AndroidPasskeys(it), reauthenticate = true) } } },
                        enabled = !state.busy && !auth.busy && activity != null, modifier = Modifier.testTag("review-verify-passkey")) { Text("Verify with a passkey") }
                    Text(auth.message)
                }
                val prior = state.pendingApproval
                val retry = prior != null && prior.delivery == ChatDelivery.NOT_FOUND && prior.control == review.control && prior.fingerprint == fingerprint
                Button(onClick = { scope.launch { controller.approveReview(review.id, fingerprint, acknowledged, confirmation) } },
                    enabled = acknowledged && !state.busy && !auth.busy && state.pending == null && (prior == null || retry) && review.current(Instant.now()) &&
                        (!review.requiresFreshPasskey || controller.hasFreshProof()) && (review.kind != ReviewKind.RESTORE || confirmation == "RESTORE"),
                    modifier = Modifier.testTag("review-approve")) {
                    Text(if (retry) "Retry exact original approval" else if (review.kind == ReviewKind.RESTORE) "Restore these exact private documents" else "Authorize this exact program")
                }
            }
        }
    }
}
private fun Context.reviewActivity(): Activity? = when (this) { is Activity -> this; is ContextWrapper -> baseContext.reviewActivity(); else -> null }
