package com.whumpo.core.data

import com.whumpo.core.account.AccountScope
import com.whumpo.core.account.AccountStateStore
import com.whumpo.core.account.FakeSecretBox
import com.whumpo.core.account.StateSlot
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class StoredChatDraftRepositoryTest {
    @get:Rule
    val temp = TemporaryFolder()

    private val ownerA = AccountScope.of("acct_fixture_a")
    private val ownerB = AccountScope.of("acct_fixture_b")

    private fun store() = AccountStateStore(File(temp.root, "state"), FakeSecretBox())

    @Test
    fun draftsRequireTheirAccountAndAreBounded() = runTest {
        val store = store()
        val drafts = StoredChatDraftRepository(store, StandardTestDispatcher(testScheduler))
        assertNull(drafts.loadDraft(ownerA))
        assertFalse(drafts.saveDraft(ownerA, "lost"))

        store.activate(ownerA)
        assertEquals("", drafts.loadDraft(ownerA))
        assertNull(drafts.loadDraft(ownerB))
        assertFalse(drafts.saveDraft(ownerB, "wrong owner"))
        assertTrue(drafts.saveDraft(ownerA, "x".repeat(StoredChatDraftRepository.MAX_DRAFT_CHARS + 5)))
        assertEquals(StoredChatDraftRepository.MAX_DRAFT_CHARS, drafts.loadDraft(ownerA)!!.length)

        assertTrue(drafts.saveDraft(ownerA, ""))
        assertNull(store.read(ownerA, StateSlot.CHAT_DRAFT))
    }

}
