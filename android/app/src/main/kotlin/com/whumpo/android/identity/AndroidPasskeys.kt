package com.whumpo.android.identity

import android.app.Activity
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetPublicKeyCredentialOption
import androidx.credentials.PublicKeyCredential
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.NoCredentialException
import com.whumpo.core.identity.IdentityFailure
import com.whumpo.core.identity.PasskeyPrompt
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class AndroidPasskeys(private val activity: Activity) : PasskeyPrompt {
    override suspend fun authenticate(optionsJson: String): String = withContext(Dispatchers.Main) {
        try {
            val result = CredentialManager.create(activity).getCredential(activity,
                GetCredentialRequest(listOf(GetPublicKeyCredentialOption(optionsJson))))
            (result.credential as? PublicKeyCredential)?.authenticationResponseJson ?: throw IdentityFailure("invalid_response")
        } catch (error: CancellationException) { throw error }
        catch (_: NoCredentialException) { throw IdentityFailure("no_passkey") }
        catch (_: GetCredentialCancellationException) { throw IdentityFailure("cancelled") }
        catch (error: IdentityFailure) { throw error }
        catch (_: Exception) { throw IdentityFailure("unavailable") }
    }
}
