package com.whumpo.core.data

import com.whumpo.android.ui.photos.PendingUpload
import com.whumpo.core.account.AccountScope
import com.whumpo.core.account.AccountStateStore
import com.whumpo.core.account.FakeSecretBox
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/** WH-085: prepared uploads survive a restart, belong to one account and never reach disk in the clear. */
class StoredUploadStoreTest {
    @get:Rule
    val temp = TemporaryFolder()

    private val ownerA = AccountScope.of("acct_fixture_a")
    private val ownerB = AccountScope.of("acct_fixture_b")
    private val box = FakeSecretBox()
    private val jpeg = ByteArray(4_096) { (it * 7).toByte() }

    private fun accountStore() = AccountStateStore(File(temp.root, "account-state"), box)

    private fun upload(n: Int) = PendingUpload("00000000-0000-4000-8000-00000000000$n", "project-$n", "van$n.jpg", jpeg)

    @Test
    fun theSameBytesNameAndIdComeBackAfterARestart() = runBlocking {
        val first = accountStore().apply { activate(ownerA) }
        StoredUploadStore(first, Dispatchers.Unconfined).save(upload(1))

        val restarted = accountStore().apply { restore() }
        val back = StoredUploadStore(restarted, Dispatchers.Unconfined).load().single()
        assertEquals("00000000-0000-4000-8000-000000000001", back.id)
        assertEquals("project-1", back.projectId)
        assertEquals("van1.jpg", back.name)
        assertArrayEquals(jpeg, back.jpeg)
    }

    @Test
    fun signOutAndAccountChangeEraseThePhotoBytes() = runBlocking {
        val account = accountStore().apply { activate(ownerA) }
        val store = StoredUploadStore(account, Dispatchers.Unconfined)
        store.save(upload(1))

        account.activate(ownerB)
        assertTrue(store.load().isEmpty())
        account.activate(ownerA)
        assertTrue("another account's upload must not return", store.load().isEmpty())

        store.save(upload(2))
        account.signOut()
        assertTrue(store.load().isEmpty())
        assertFalse(File(temp.root, "account-state").exists())
    }

    @Test
    fun bytesAreEncryptedAtRestAndNothingIsSavedSignedOut() = runBlocking {
        val account = accountStore()
        val store = StoredUploadStore(account, Dispatchers.Unconfined)
        assertFalse(store.save(upload(1)))

        account.activate(ownerA)
        store.save(PendingUpload("00000000-0000-4000-8000-000000000009", "p", "marker-name.jpg", jpeg))
        val disk = File(temp.root, "account-state").walkTopDown().filter { it.isFile }
            .joinToString("|") { it.readBytes().toString(Charsets.ISO_8859_1) }
        assertFalse(disk.contains("marker-name"))
    }

    @Test
    fun removeBoundsAndMalformedIds() = runBlocking {
        val account = accountStore().apply { activate(ownerA) }
        val store = StoredUploadStore(account, Dispatchers.Unconfined)
        for (n in 1..StoredUploadStore.MAX_PENDING) assertTrue(store.save(upload(n)))
        assertFalse("the sixth is refused", store.save(upload(StoredUploadStore.MAX_PENDING + 1)))
        assertTrue("re-saving an existing id is allowed", store.save(upload(1)))
        assertFalse(store.save(PendingUpload("../escape", "p", "x.jpg", jpeg)))
        assertFalse(store.save(PendingUpload("00000000-0000-4000-8000-00000000000a", "p", "x.jpg", ByteArray(StoredUploadStore.MAX_BYTES + 1))))

        store.remove(upload(1).id)
        assertEquals(StoredUploadStore.MAX_PENDING - 1, store.load().size)
    }
}
