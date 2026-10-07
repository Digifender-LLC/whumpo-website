package com.whumpo.core.account

import com.whumpo.core.identity.NativeIdentityController
import com.whumpo.core.identity.PendingIdentityStore
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.io.IOException

/** Real encrypted files with injected storage failures; no Android or provider fixture is involved. */
class AccountClosureStorageTest {
    @get:Rule val temp = TemporaryFolder()
    private val owner = AccountScope.of("acct_closure_fixture")
    private val session = NativeIdentityController.SESSION_SLOT
    private val closing = NativeIdentityController.CLOSING_SLOT
    private val pending = StateSlot(StateKind.PENDING_OPERATION, "original-request")

    private fun records() = linkedMapOf(session to "synthetic-logout-session", closing to "1")
    private fun aad(slot: StateSlot) = "whumpo-state-v1:${owner.storageKey}:${slot.fileName}".toByteArray()

    @Test
    fun closureDestroysThePrivateKeyAndRetainsOnlyRestartableLogoutIdentity() {
        val root = File(temp.root, "state")
        val box = FakeSecretBox()
        val store = AccountStateStore(root, box)
        store.activate(owner)
        store.write(owner, StateSlot.CHAT_DRAFT, "private draft")
        store.write(owner, pending, "private original request")
        val oldCiphertext = File(File(root, owner.storageKey), StateSlot.CHAT_DRAFT.fileName).readBytes()

        store.retainSessionOnly(owner, closing, records())

        assertEquals(1, box.destroyCount)
        assertThrows(Exception::class.java) { box.open(oldCiphertext, aad(StateSlot.CHAT_DRAFT)) }
        assertNull(store.read(owner, StateSlot.CHAT_DRAFT))
        assertNull(store.read(owner, pending))
        assertFalse(store.write(owner, StateSlot.CHAT_DRAFT, "late draft"))
        assertFalse(store.write(owner, pending, "late dispatched request"))
        assertEquals(setOf(session.fileName, closing.fileName), File(root, owner.storageKey).list()!!.toSet())

        val restarted = AccountStateStore(root, box)
        restarted.restore()
        assertEquals(owner, restarted.activeAccount.value)
        assertEquals("1", restarted.read(owner, closing))
        assertEquals("synthetic-logout-session", restarted.read(owner, session))
        assertNull(restarted.read(owner, pending))
        assertNull(restarted.read(owner, StateSlot.CHAT_DRAFT))
    }

    @Test
    fun interruptionAtEachRetainedRecordNeverRestoresABearerWithoutItsClosureMarker() {
        // Deliberately supply the bearer first. The storage boundary must enforce the durable order.
        for (failAt in listOf("whumpo-state-v1:active", String(aad(closing)), String(aad(session)))) {
            val root = temp.newFolder()
            val box = FailingSealBox()
            val store = AccountStateStore(root, box)
            store.activate(owner)
            store.write(owner, StateSlot.CHAT_DRAFT, "old private draft")
            store.write(owner, pending, "old pending request")
            store.write(owner, session, "old bearer")
            box.failAt = failAt

            assertThrows(IOException::class.java) { store.retainSessionOnly(owner, closing, records()) }
            assertEquals(1, box.delegate.destroyCount)
            assertFalse(store.write(owner, StateSlot.CHAT_DRAFT, "late draft after failure"))
            assertFalse(store.write(owner, pending, "late request after failure"))
            box.failAt = null

            val restarted = AccountStateStore(root, box)
            restarted.restore()
            assertNull(restarted.read(owner, StateSlot.CHAT_DRAFT))
            assertNull(restarted.read(owner, pending))
            val restoredSession = restarted.read(owner, session)
            assertTrue("A persisted bearer must always carry the frozen marker", restoredSession == null || restarted.read(owner, closing) == "1")
            if (failAt == String(aad(session))) assertEquals("1", restarted.read(owner, closing))
        }
    }

    @Test
    fun failedDirectoryDeletionStillInvalidatesTheOldKeyAndRefusesLateWrites() {
        val root = UndeletableRoot(File(temp.root, "cannot-delete"))
        val box = FakeSecretBox()
        val store = AccountStateStore(root, box)
        store.activate(owner)
        store.write(owner, StateSlot.CHAT_DRAFT, "private data whose directory cleanup fails")
        val ciphertext = File(File(root, owner.storageKey), StateSlot.CHAT_DRAFT.fileName).readBytes()

        assertThrows(IOException::class.java) { store.retainSessionOnly(owner, closing, records()) }

        assertTrue("The failure injection must leave the root undeleted", root.exists())
        assertEquals(1, box.destroyCount)
        assertThrows(Exception::class.java) { box.open(ciphertext, aad(StateSlot.CHAT_DRAFT)) }
        assertNull(store.activeAccount.value)
        assertFalse(store.write(owner, StateSlot.CHAT_DRAFT, "late private state"))
        assertFalse(store.write(owner, pending, "late original request"))
    }

    @Test
    fun pendingIdentityDeletionFailureStillDestroysItsSeparateKey() {
        val root = UndeletableRoot(File(temp.root, "pending-cannot-delete"))
        assertTrue(root.mkdirs())
        val box = FakeSecretBox()
        val binding = "synthetic-pending-binding".toByteArray()
        val ciphertext = box.seal("synthetic pending secret".toByteArray(), binding)
        File(root, "synthetic.bin").writeBytes(ciphertext)

        assertThrows(IOException::class.java) { PendingIdentityStore(root, box).clear() }

        assertEquals(1, box.destroyCount)
        assertThrows(Exception::class.java) { box.open(ciphertext, binding) }
    }

    private class FailingSealBox : SecretBox {
        val delegate = FakeSecretBox()
        var failAt: String? = null
        override fun seal(plaintext: ByteArray, associatedData: ByteArray): ByteArray {
            if (String(associatedData) == failAt) throw IOException("Synthetic interrupted write")
            return delegate.seal(plaintext, associatedData)
        }
        override fun open(ciphertext: ByteArray, associatedData: ByteArray) = delegate.open(ciphertext, associatedData)
        override fun destroyKey() = delegate.destroyKey()
    }

    private class UndeletableRoot(path: File) : File(path.path) {
        override fun delete(): Boolean = false
    }
}
