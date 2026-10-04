package com.whumpo.android.ui.activity

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.whumpo.android.AppContainer
import com.whumpo.core.data.ActivityItem
import com.whumpo.core.data.ActivityRepository
import com.whumpo.core.data.Availability
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn

class ActivityViewModel(repository: ActivityRepository) : ViewModel() {
    /** Null while loading. */
    val state: StateFlow<Availability<List<ActivityItem>>?> = repository.activity()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    companion object {
        fun factory(container: AppContainer): ViewModelProvider.Factory = viewModelFactory {
            initializer { ActivityViewModel(container.activity) }
        }
    }
}
