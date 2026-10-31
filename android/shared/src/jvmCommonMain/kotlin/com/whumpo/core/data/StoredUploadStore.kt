package com.whumpo.core.data

import com.whumpo.android.ui.photos.PendingUpload
import com.whumpo.android.ui.photos.UploadStore
import com.whumpo.core.account.AccountStateStore
import com.whumpo.core.account.StateKind
import com.whumpo.core.account.StateSlot
import java.io.IOException
import java.util.Base64
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/** Prepared uploads in the encrypted account store (no-backup, key erased on sign-out). At most [MAX_PENDING] at a time. */
class StoredUploadStore(
    private val store: AccountStateStore,
    private val io: CoroutineDispatcher,
) : UploadStore {
    override val account: Flow<Any?> = store.activeAccount

    @Serializable
    private class Record(val projectId: String, val name: String, val jpeg: String)

    override suspend fun save(upload: PendingUpload): Boolean = withContext(io) {
        val owner = store.activeAccount.value ?: return@withContext false
        val slot = slot(upload.id) ?: return@withContext false
        if (upload.jpeg.size > MAX_BYTES) return@withContext false
        val held = store.list(owner, StateKind.UPLOAD)
        if (slot.name !in held && held.size >= MAX_PENDING) return@withContext false
        val record = Record(upload.projectId, upload.name, Base64.getEncoder().encodeToString(upload.jpeg))
        try {
            store.write(owner, slot, Json.encodeToString(Record.serializer(), record))
        } catch (_: IOException) {
            false
        }
    }

    override suspend fun load(): List<PendingUpload> = withContext(io) {
        val owner = store.activeAccount.value ?: return@withContext emptyList()
        store.list(owner, StateKind.UPLOAD).mapNotNull { name ->
            val slot = StateSlot(StateKind.UPLOAD, name)
            val text = store.read(owner, slot) ?: return@mapNotNull null
            try {
                val r = Json.decodeFromString(Record.serializer(), text)
                PendingUpload(name.removePrefix(PREFIX), r.projectId, r.name, Base64.getDecoder().decode(r.jpeg))
            } catch (_: Exception) {
                store.remove(owner, slot) // unreadable: never trusted
                null
            }
        }
    }

    override suspend fun remove(id: String) {
        withContext(io) {
            val owner = store.activeAccount.value ?: return@withContext
            slot(id)?.let { store.remove(owner, it) }
        }
    }

    /** Upload IDs are UUIDs; anything else cannot name a slot. */
    private fun slot(id: String): StateSlot? =
        (PREFIX + id.lowercase()).takeIf { StateSlot.isValidName(it) }?.let { StateSlot(StateKind.UPLOAD, it) }

    companion object {
        private const val PREFIX = "u-"
        const val MAX_PENDING = 5
        const val MAX_BYTES = 1_048_576
    }
}
