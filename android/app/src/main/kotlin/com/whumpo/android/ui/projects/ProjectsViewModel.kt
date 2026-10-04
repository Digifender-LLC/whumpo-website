package com.whumpo.android.ui.projects

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.whumpo.android.AppContainer
import com.whumpo.core.data.Availability
import com.whumpo.core.data.ProjectSummary
import com.whumpo.core.data.ProjectsRepository
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn

class ProjectsViewModel(repository: ProjectsRepository) : ViewModel() {
    /** Null while loading. */
    val state: StateFlow<Availability<List<ProjectSummary>>?> = repository.projects()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    companion object {
        fun factory(container: AppContainer): ViewModelProvider.Factory = viewModelFactory {
            initializer { ProjectsViewModel(container.projects) }
        }
    }
}
