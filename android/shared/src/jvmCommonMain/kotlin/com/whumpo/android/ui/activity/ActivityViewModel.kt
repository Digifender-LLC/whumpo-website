package com.whumpo.android.ui.activity

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
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
}
