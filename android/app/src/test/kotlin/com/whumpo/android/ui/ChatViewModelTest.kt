package com.whumpo.android.ui

import com.whumpo.android.ui.chat.ChatViewModel
import com.whumpo.core.account.AccountScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ChatViewModelTest {
    private val ownerA = AccountScope.of("acct_fixture_a")
    private val ownerB = AccountScope.of("acct_fixture_b")
    private lateinit var main: TestDispatcher

    @Before
    fun setUp() {
        main = StandardTestDispatcher()
        Dispatchers.setMain(main)
    }

    @After
    fun tearDown() = Dispatchers.resetMain()

    @Test
    fun signedOutComposerIsHiddenAndIgnoresInput() = runTest(main) {
        val account = FakeAccountRepository()
        val drafts = FakeChatDraftRepository(account)
        val vm = ChatViewModel(drafts, account)
        advanceUntilIdle()

        assertNull(vm.state.value.owner)
        assertFalse(vm.state.value.composerEnabled)
        vm.onDraftChanged("typed while signed out")
        advanceUntilIdle()
        assertEquals("", vm.state.value.draft)
        assertEquals(0, drafts.saves)
    }

    @Test
    fun restoresAndDebouncesTheAccountDraft() = runTest(main) {
        val account = FakeAccountRepository(ownerA)
        val drafts = FakeChatDraftRepository(account).apply { stored[ownerA] = "saved earlier" }
        val vm = ChatViewModel(drafts, account)
        advanceUntilIdle()
        assertEquals("saved earlier", vm.state.value.draft)
        assertTrue(vm.state.value.composerEnabled)

        vm.onDraftChanged("a")
        vm.onDraftChanged("ab")
        vm.onDraftChanged("abc")
        advanceTimeBy(ChatViewModel.SAVE_DEBOUNCE_MS + 1)
        assertEquals(1, drafts.saves)
        assertEquals("abc", drafts.stored[ownerA])
    }

    @Test
    fun acceptanceClearsOnlyTheExactDraftAndNeverAnEditOrAnotherAccount() = runTest(main) {
        val account = FakeAccountRepository(ownerA)
        val drafts = FakeChatDraftRepository(account)
        val vm = ChatViewModel(drafts, account)
        advanceUntilIdle()
        vm.onDraftChanged("new edit")
        vm.accepted(ownerA, "old submitted text")
        vm.accepted(ownerB, "new edit")
        assertEquals("new edit", vm.state.value.draft)
        vm.accepted(ownerA, "new edit")
        advanceUntilIdle()
        assertEquals("", vm.state.value.draft)
        assertEquals("", drafts.stored[ownerA])
    }

    @Test
    fun signOutClearsTheVisibleDraftAndDropsPendingSaves() = runTest(main) {
        val account = FakeAccountRepository(ownerA)
        val drafts = FakeChatDraftRepository(account)
        val vm = ChatViewModel(drafts, account)
        advanceUntilIdle()

        vm.onDraftChanged("not yet saved")
        account.signOut()
        advanceUntilIdle()
        assertEquals("", vm.state.value.draft)
        assertNull(vm.state.value.owner)
        assertEquals(0, drafts.saves)
    }

    @Test
    fun accountChangeNeverCarriesADraftAcross() = runTest(main) {
        val account = FakeAccountRepository(ownerA)
        val drafts = FakeChatDraftRepository(account)
        val vm = ChatViewModel(drafts, account)
        advanceUntilIdle()

        vm.onDraftChanged("owner A only")
        account.activeAccount.value = ownerB
        advanceUntilIdle()
        assertEquals(ownerB, vm.state.value.owner)
        assertEquals("", vm.state.value.draft)
        assertNull(drafts.stored[ownerB])
        assertNull(drafts.stored[ownerA])
    }
}
