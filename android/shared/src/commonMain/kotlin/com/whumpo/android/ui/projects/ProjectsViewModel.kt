package com.whumpo.android.ui.projects

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.whumpo.android.ui.common.StatusChip
import com.whumpo.android.ui.common.TimeLabel
import com.whumpo.android.ui.common.Tone
import com.whumpo.android.ui.common.loadUi
import com.whumpo.android.ui.common.timeLabel
import com.whumpo.android.ui.common.userMessage
import com.whumpo.android.ui.photos.PhotoPreparer
import com.whumpo.android.ui.photos.PhotoRejected
import com.whumpo.android.ui.photos.PreparedPhoto
import com.whumpo.android.ui.state.UiState
import com.whumpo.core.api.MobileApiClient
import com.whumpo.core.api.MobileApiException
import com.whumpo.core.api.Photo
import com.whumpo.core.api.Project
import com.whumpo.core.api.SiteVersion
import com.whumpo.core.api.newRequestId
import kotlin.coroutines.cancellation.CancellationException
import kotlin.time.Clock
import kotlin.time.Instant
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class ProjectRow(
    val id: String,
    val name: String,
    val purpose: String,
    val status: StatusChip,
    val website: StatusChip,
    val app: StatusChip,
    val updated: TimeLabel,
)

/** [nextCursor] is non-null while more projects exist. */
data class ProjectList(
    val rows: List<ProjectRow>,
    val nextCursor: String?,
    val loadingMore: Boolean = false,
    val moreFailed: Boolean = false,
)

data class VersionRow(val id: String, val component: String, val saved: TimeLabel)

data class ProjectDetail(val project: ProjectRow, val versions: List<VersionRow>)

data class PhotoRow(val id: String, val name: String, val summary: String, val status: StatusChip)

enum class UploadPhase { Preparing, Uploading, Failed }

/** One photo the owner is adding. A failed upload keeps its bytes and ID, so [canRetry] repeats the same request. */
data class UploadRow(val id: String, val phase: UploadPhase, val message: String? = null, val canRetry: Boolean = false)

data class PhotosState(
    val photos: UiState<List<PhotoRow>> = UiState.Loading,
    val uploads: List<UploadRow> = emptyList(),
)

/**
 * Projects list, the selected project's detail with versions, and its photos.
 * Reads go through [api]; the only write is a photo upload, which carries a caller-owned upload ID.
 * Selection is kept here so it survives rotation; the screen decides how to lay it out.
 */
class ProjectsViewModel(
    private val api: MobileApiClient,
    private val preparer: PhotoPreparer,
    private val clock: () -> Instant = { Clock.System.now() },
) : ViewModel() {
    private val _list = MutableStateFlow<UiState<ProjectList>>(UiState.Loading)
    val list: StateFlow<UiState<ProjectList>> = _list.asStateFlow()

    private val _selected = MutableStateFlow<String?>(null)
    val selected: StateFlow<String?> = _selected.asStateFlow()

    private val _detail = MutableStateFlow<UiState<ProjectDetail>>(UiState.Loading)
    val detail: StateFlow<UiState<ProjectDetail>> = _detail.asStateFlow()

    private val _photos = MutableStateFlow(PhotosState())
    val photos: StateFlow<PhotosState> = _photos.asStateFlow()

    private var listJob: Job? = null
    private var detailJob: Job? = null
    private var photosJob: Job? = null

    /** Prepared bytes by upload ID, held until the upload is confirmed or dismissed. */
    private class Held(val projectId: String, val photo: PreparedPhoto)

    private val held = mutableMapOf<String, Held>()

    init {
        refresh()
    }

    fun refresh() {
        listJob?.cancel()
        _list.value = UiState.Loading
        listJob = viewModelScope.launch {
            _list.value = loadUi<ProjectList>("your projects", { it.rows.isEmpty() }) { fetchPage(null) }
        }
    }

    fun loadMore() {
        val current = (_list.value as? UiState.Content)?.value ?: return
        val cursor = current.nextCursor ?: return
        if (current.loadingMore) return
        _list.value = UiState.Content(current.copy(loadingMore = true, moreFailed = false))
        viewModelScope.launch {
            _list.value = try {
                val page = fetchPage(cursor)
                UiState.Content(ProjectList(current.rows + page.rows, page.nextCursor))
            } catch (e: CancellationException) {
                throw e
            } catch (_: MobileApiException) {
                UiState.Content(current.copy(loadingMore = false, moreFailed = true))
            }
        }
    }

    fun select(projectId: String?) {
        if (projectId == _selected.value) return
        _selected.value = projectId
        detailJob?.cancel()
        photosJob?.cancel()
        _photos.value = PhotosState()
        if (projectId != null) {
            loadDetail(projectId)
            loadPhotos(projectId)
        }
    }

    fun retryDetail() {
        _selected.value?.let { loadDetail(it) }
    }

    fun refreshPhotos() {
        _selected.value?.let { loadPhotos(it) }
    }

    /** The owner picked [source] (a platform handle). One new upload ID per pick; retries reuse it. */
    fun addPhoto(source: String) {
        val projectId = _selected.value ?: return
        val uploadId = newRequestId()
        setUpload(UploadRow(uploadId, UploadPhase.Preparing))
        viewModelScope.launch {
            val prepared = try {
                preparer.prepare(source)
            } catch (e: PhotoRejected) {
                setUpload(UploadRow(uploadId, UploadPhase.Failed, e.message, canRetry = false))
                return@launch
            }
            held[uploadId] = Held(projectId, prepared)
            send(uploadId)
        }
    }

    /** An explicit owner retry: same ID, same bytes, same name. */
    fun retryUpload(uploadId: String) {
        val row = _photos.value.uploads.firstOrNull { it.id == uploadId } ?: return
        if (row.phase != UploadPhase.Failed || !row.canRetry || uploadId !in held) return
        viewModelScope.launch { send(uploadId) }
    }

    fun dismissUpload(uploadId: String) {
        held.remove(uploadId)
        _photos.update { it.copy(uploads = it.uploads.filterNot { u -> u.id == uploadId }) }
    }

    private suspend fun send(uploadId: String) {
        val h = held[uploadId] ?: return
        setUpload(UploadRow(uploadId, UploadPhase.Uploading))
        try {
            api.uploadPhoto(h.projectId, uploadId, h.photo.name, h.photo.jpeg)
            uploaded(uploadId, h.projectId)
        } catch (e: CancellationException) {
            throw e
        } catch (e: MobileApiException) {
            if (e is MobileApiException.Transport && e.outcomeUnknown) {
                resolveLostReply(uploadId, h)
            } else {
                val retry = e is MobileApiException.RateLimited || e is MobileApiException.Unavailable
                setUpload(UploadRow(uploadId, UploadPhase.Failed, uploadMessage(e), canRetry = retry))
            }
        }
    }

    /** The reply was lost: read the upload instead of guessing. Not found means nothing committed. */
    private suspend fun resolveLostReply(uploadId: String, h: Held) {
        try {
            api.getPhotoUpload(h.projectId, uploadId)
            uploaded(uploadId, h.projectId)
        } catch (e: CancellationException) {
            throw e
        } catch (_: MobileApiException.NotFound) {
            setUpload(UploadRow(uploadId, UploadPhase.Failed, "The upload didn't finish. Nothing was added.", canRetry = true))
        } catch (_: MobileApiException) {
            setUpload(UploadRow(uploadId, UploadPhase.Failed, "We couldn't confirm the upload. Try again; it won't be added twice.", canRetry = true))
        }
    }

    private fun uploaded(uploadId: String, projectId: String) {
        held.remove(uploadId)
        _photos.update { it.copy(uploads = it.uploads.filterNot { u -> u.id == uploadId }) }
        if (_selected.value == projectId) loadPhotos(projectId)
    }

    private fun uploadMessage(e: MobileApiException): String = when (e) {
        is MobileApiException.PayloadTooLarge -> "That photo is too large. Choose a less detailed photo."
        is MobileApiException.UnsupportedMediaType, is MobileApiException.ValidationFailed -> "That photo can't be used."
        is MobileApiException.RateLimited -> e.userMessage("the photo").let { "${it.first} ${it.second}" }
        is MobileApiException.ProofRequired, is MobileApiException.IdentityChanged -> "You've been signed out. Sign in again to add photos."
        is MobileApiException.Unavailable -> e.message ?: "The photo wasn't added. Nothing was changed." // the server's plain quota/storage message (contract: 503 unavailable)
        else -> "The photo wasn't added. Nothing was changed."
    }

    private fun setUpload(row: UploadRow) = _photos.update { s ->
        val exists = s.uploads.any { it.id == row.id }
        s.copy(uploads = if (exists) s.uploads.map { if (it.id == row.id) row else it } else s.uploads + row)
    }

    private suspend fun fetchPage(cursor: String?): ProjectList {
        val page = api.listProjects(cursor = cursor)
        val now = clock()
        return ProjectList(page.items.map { it.toRow(now) }, page.nextCursor)
    }

    private fun loadDetail(projectId: String) {
        detailJob?.cancel()
        _detail.value = UiState.Loading
        detailJob = viewModelScope.launch {
            val result = loadUi<ProjectDetail>("this project") {
                val now = clock()
                val project = api.getProject(projectId).project.toRow(now)
                ProjectDetail(project, api.listVersions(projectId).items.map { it.toRow(now) })
            }
            if (_selected.value == projectId) _detail.value = result
        }
    }

    private fun loadPhotos(projectId: String) {
        photosJob?.cancel()
        _photos.update { it.copy(photos = UiState.Loading) }
        photosJob = viewModelScope.launch {
            val result = loadUi<List<PhotoRow>>("photos", { it.isEmpty() }) { api.listPhotos(projectId).items.map { it.toRow() } }
            if (_selected.value == projectId) _photos.update { it.copy(photos = result) }
        }
    }
}

private fun Project.toRow(now: Instant): ProjectRow = ProjectRow(
    id = id,
    name = name,
    purpose = purpose,
    status = when {
        siteLive -> StatusChip("Live", Tone.Ready)
        status == "draft" -> StatusChip("Draft", Tone.Neutral)
        else -> StatusChip(status.replace('_', ' ').replaceFirstChar { it.uppercase() }, Tone.Progress)
    },
    website = if (siteLive) StatusChip("Live", Tone.Ready) else StatusChip("Not live yet", Tone.Neutral),
    app = if (backendLive) StatusChip("Live", Tone.Ready) else StatusChip("Not live yet", Tone.Neutral),
    updated = timeLabel(updatedAt, now, "Updated"),
)

private fun SiteVersion.toRow(now: Instant) = VersionRow(id, componentId, timeLabel(createdAt, now, "Saved"))

private fun Photo.toRow() = PhotoRow(
    id = id,
    name = name,
    summary = "$width × $height, ${sizeLabel(size)}",
    status = when {
        safetyStatus == "blocked" -> StatusChip("Not approved", Tone.Attention)
        usable -> StatusChip("Ready", Tone.Ready)
        else -> StatusChip("Checking", Tone.Progress)
    },
)

private fun sizeLabel(bytes: Int): String =
    if (bytes < 1_048_576) "${maxOf(1, bytes / 1024)} KB" else (bytes * 10L / 1_048_576).let { "${it / 10}.${it % 10} MB" }
