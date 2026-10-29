package com.whumpo.android.ui

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.whumpo.android.AppContainer
import com.whumpo.android.BuildConfig
import com.whumpo.android.ui.activity.ActivityViewModel
import com.whumpo.android.ui.chat.ChatViewModel
import com.whumpo.android.ui.projects.ProjectsViewModel
import com.whumpo.android.ui.settings.SettingsViewModel

// The ViewModels live in :shared; wiring them to the Android-only AppContainer stays here.
fun chatViewModelFactory(c: AppContainer): ViewModelProvider.Factory =
    viewModelFactory { initializer { ChatViewModel(c.chatDrafts, c.account) } }

fun projectsViewModelFactory(c: AppContainer): ViewModelProvider.Factory =
    viewModelFactory { initializer { ProjectsViewModel(c.api, c.photoPreparer) } }

fun activityViewModelFactory(c: AppContainer): ViewModelProvider.Factory =
    viewModelFactory { initializer { ActivityViewModel(c.api, c.notifications) } }

fun settingsViewModelFactory(c: AppContainer): ViewModelProvider.Factory =
    viewModelFactory { initializer {
        SettingsViewModel(c.account, c.api, c.sessions, c.themes, c.notifications, c.push, c.environment, BuildConfig.VERSION_NAME)
    } }
