package com.whumpo.android.ui

import com.whumpo.android.ui.settings.SettingsViewModel
import com.whumpo.core.account.AccountScope
import com.whumpo.core.environment.EnvironmentKind
import com.whumpo.core.environment.WhumpoEnvironment
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ScreensViewModelTest {
    private lateinit var main: TestDispatcher

    @Before
    fun setUp() {
        main = StandardTestDispatcher()
        Dispatchers.setMain(main)
    }

    @After
    fun tearDown() = Dispatchers.resetMain()

    @Test
    fun settingsShowsEnvironmentAndSignsOut() = runTest(main) {
        val account = FakeAccountRepository(AccountScope.of("acct_fixture_a"))
        val vm = SettingsViewModel(account, WhumpoEnvironment.from("local", "http://127.0.0.1:8787"), "0.1.0-test")
        val collector = backgroundScope.launch { vm.state.collect {} }
        advanceUntilIdle()
        assertTrue(vm.state.value.signedIn)
        assertEquals(EnvironmentKind.LOCAL, vm.state.value.environmentKind)
        assertEquals("http://127.0.0.1:8787", vm.state.value.origin)

        vm.signOut()
        advanceUntilIdle()
        assertEquals(1, account.signOutCalls)
        assertFalse(vm.state.value.signedIn)
        collector.cancel()
    }
}
