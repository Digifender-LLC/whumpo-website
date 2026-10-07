package com.whumpo.android.identity

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import androidx.core.net.toUri
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.whumpo.core.identity.BrowserPurpose
import com.whumpo.core.identity.NativeIdentityController
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

/** Explicit identity controls, independent of Chat, generated views or model availability. */
@Composable
fun IdentityPanel(controller: NativeIdentityController) {
    val state by controller.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val activity = remember(context) { context.activity() }
    val scope = rememberCoroutineScope()
    var work by remember { mutableStateOf<Job?>(null) }
    var browserUnavailable by remember { mutableStateOf(false) }
    DisposableEffect(controller) { onDispose { work?.cancel() } }
    fun run(block: suspend () -> Unit) { work = scope.launch { block() } }
    fun open(url: String?) {
        if (url == null) return
        try { CustomTabsIntent.Builder().build().launchUrl(context, url.toUri()) }
        catch (_: Exception) { browserUnavailable = true }
    }

    Text(state.message, modifier = Modifier.testTag("identity-status").semantics { liveRegion = LiveRegionMode.Polite })
    state.label?.let { Text(it) }
    if (browserUnavailable) Text("A browser could not be opened. Install a browser, then choose Resume browser sign-in.")

    if (state.returnReady) {
        Button(onClick = { run { controller.completeBrowser() } }, enabled = !state.busy,
            modifier = Modifier.testTag("identity-finish-browser")) { Text("Finish sign in") }
    }
    if (state.browserPending) {
        OutlinedButton(onClick = { run { open(controller.resumeBrowser()) } }, enabled = !state.busy,
            modifier = Modifier.testTag("identity-resume-browser")) { Text("Resume browser sign-in") }
    }
    if (state.accountClosing) {
        OutlinedButton(onClick = { open(controller.accountStatusUrl) },
            modifier = Modifier.testTag("identity-account-status")) { Text("Account closure status on the website") }
    }
    if (state.savedSession || state.localCleanupFailed) {
        OutlinedButton(onClick = { work?.cancel(); run { controller.signOut() } },
            modifier = Modifier.testTag("identity-forget-session")) { Text("Sign out on this device") }
        if (!state.accountClosing && !state.localCleanupFailed) OutlinedButton(onClick = { run { controller.checkSession() } }, enabled = !state.busy,
            modifier = Modifier.testTag("identity-check-session")) { Text("Check saved session") }
    }
    if (!state.signedIn && !state.updateRequired && !state.accountClosing && !state.localCleanupFailed) {
        Button(onClick = { activity?.let { run { controller.passkey(AndroidPasskeys(it)) } } },
            enabled = !state.busy && activity != null, modifier = Modifier.testTag("identity-passkey")) { Text("Sign in with a passkey") }
        OutlinedButton(onClick = { run { open(controller.beginBrowser(BrowserPurpose.SIGN_IN)) } },
            enabled = !state.busy, modifier = Modifier.testTag("identity-browser")) { Text("Sign in through browser") }
        OutlinedButton(onClick = { run { open(controller.beginBrowser(BrowserPurpose.SIGN_UP)) } }, enabled = !state.busy) { Text("Create an invited account") }
        OutlinedButton(onClick = { run { open(controller.beginBrowser(BrowserPurpose.RECOVERY)) } }, enabled = !state.busy) { Text("Recover an account") }
    }
    if (state.signedIn) {
        OutlinedButton(onClick = { activity?.let { run { controller.passkey(AndroidPasskeys(it), reauthenticate = true) } } },
            enabled = !state.busy && activity != null, modifier = Modifier.testTag("identity-reauth")) { Text("Verify with a passkey") }
    }
    if (state.busy || state.browserPending || state.returnReady) {
        OutlinedButton(onClick = { work?.cancel(); scope.launch { controller.cancel() } },
            modifier = Modifier.testTag("identity-cancel")) { Text("Cancel sign-in") }
    }
    OutlinedButton(onClick = { open("https://whumpo.com/workspace/support") }) { Text("Account help on the website") }
}

private fun Context.activity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.activity()
    else -> null
}
