package com.whumpo.android.ui.chat

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.whumpo.android.ui.shell.WidthClass

/** The Android host for the shared Chat layout: it only supplies the ViewModel and the three platform hand-offs. */
@Composable
fun ChatScreen(viewModel: ChatViewModel, width: WidthClass, origin: String) {
    val screen by viewModel.screen.collectAsStateWithLifecycle()
    val context = LocalContext.current
    ChatLayout(
        screen = screen,
        width = width,
        actions = viewModel,
        // shortcut: previews open in the default browser, not an authenticated Custom Tab; WP7 adds the Custom Tab.
        onOpenPreview = { preview -> open(context, origin + preview.path) },
        onUpdateApp = { open(context, "market://details?id=${context.packageName}") },
        onHelp = { open(context, origin) },
    )
}

private fun open(context: Context, url: String) {
    try {
        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
    } catch (_: ActivityNotFoundException) {
        // No handler installed; nothing else to do.
    }
}
