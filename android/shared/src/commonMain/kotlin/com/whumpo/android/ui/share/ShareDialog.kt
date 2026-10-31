package com.whumpo.android.ui.share

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.whumpo.android.ui.projects.ProjectList
import com.whumpo.android.ui.state.UiState
import com.whumpo.android.ui.theme.WhumpoPrimaryButton
import com.whumpo.android.ui.theme.WhumpoQuietButton

/** Something another app handed over through the system share sheet. Holding it sends and fetches nothing. */
sealed interface SharedItem {
    /** A photo, as a platform handle (a content URI on Android). */
    data class Photo(val source: String) : SharedItem

    /** Text or a link. It is only ever copied into the Chat draft; the app never opens or fetches it. */
    data class Text(val text: String) : SharedItem
}

/**
 * Asks what to do with a shared item. Nothing is sent, uploaded or fetched until the owner confirms here: a photo is
 * added to the project they pick, text lands in the Chat draft (still unsent).
 */
@Composable
fun ShareDialog(
    item: SharedItem,
    projects: UiState<ProjectList>,
    onAddPhoto: (projectId: String) -> Unit,
    onAddToDraft: (text: String) -> Unit,
    onDismiss: () -> Unit,
) {
    var chosen by remember { mutableStateOf<String?>(null) }
    AlertDialog(
        onDismissRequest = onDismiss,
        modifier = Modifier.testTag("share-dialog"),
        title = { Text(if (item is SharedItem.Photo) "Add this photo to a project?" else "Add this to your Chat draft?") },
        text = {
            when (item) {
                is SharedItem.Text -> Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(item.text, maxLines = 6, overflow = TextOverflow.Ellipsis, modifier = Modifier.testTag("share-text"))
                    Text(
                        "It goes into your draft only. Nothing is sent until you send it.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                is SharedItem.Photo -> ProjectChoice(projects, chosen) { chosen = it }
            }
        },
        confirmButton = {
            when (item) {
                is SharedItem.Text -> WhumpoPrimaryButton(
                    onClick = { onAddToDraft(item.text) },
                    modifier = Modifier.heightIn(min = 48.dp).testTag("share-confirm"),
                ) { Text("Add to draft") }
                is SharedItem.Photo -> WhumpoPrimaryButton(
                    onClick = { chosen?.let(onAddPhoto) },
                    enabled = chosen != null,
                    modifier = Modifier.heightIn(min = 48.dp).testTag("share-confirm"),
                ) { Text("Add photo") }
            }
        },
        dismissButton = {
            WhumpoQuietButton(onClick = onDismiss, modifier = Modifier.heightIn(min = 48.dp).testTag("share-cancel")) { Text("Cancel") }
        },
    )
}

@Composable
private fun ProjectChoice(projects: UiState<ProjectList>, chosen: String?, onChoose: (String) -> Unit) {
    when (projects) {
        is UiState.Content -> Column(Modifier.selectableGroup().testTag("share-projects")) {
            Text(
                "Pick the project. The photo is resized and stripped of location details first, and nothing is added until you tap Add photo.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(bottom = 8.dp),
            )
            projects.value.rows.forEach { row ->
                Row(
                    Modifier.fillMaxWidth().heightIn(min = 48.dp)
                        .selectable(selected = chosen == row.id, role = Role.RadioButton, onClick = { onChoose(row.id) })
                        .testTag("share-project-${row.id}"),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    RadioButton(selected = chosen == row.id, onClick = null)
                    Text(row.name, modifier = Modifier.padding(start = 12.dp))
                }
            }
        }
        UiState.Loading -> Text("Loading your projects")
        UiState.Empty -> Text("You don't have a project to add this to yet. Create one in Chat first.")
        else -> Text("We couldn't load your projects. Cancel and try sharing again.")
    }
}
