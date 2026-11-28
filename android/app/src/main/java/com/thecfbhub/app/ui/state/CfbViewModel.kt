package com.thecfbhub.app.ui.state

import android.app.Application
import android.content.Context
import android.content.res.Configuration
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.thecfbhub.app.data.model.ConferenceInfo
import com.thecfbhub.app.data.model.ConferenceStandings
import com.thecfbhub.app.data.model.GameEvent
import com.thecfbhub.app.data.model.GameSummary
import com.thecfbhub.app.data.model.SchoolFarthestRow
import com.thecfbhub.app.data.model.SeasonCalendar
import com.thecfbhub.app.data.model.SeasonResultsGraph
import com.thecfbhub.app.data.model.StandingsBundle
import com.thecfbhub.app.data.model.TeamDirectoryItem
import com.thecfbhub.app.data.model.TeamPageData
import com.thecfbhub.app.data.model.TransitiveComparison
import com.thecfbhub.app.data.model.WatchCatalog
import com.thecfbhub.app.data.model.WatchStream
import com.thecfbhub.app.data.model.WeeklyRankingsData
import com.thecfbhub.app.data.remote.CfbRepository
import com.thecfbhub.app.data.remote.EspnJsonParser
import com.thecfbhub.app.util.TransitiveEngine
import java.util.Calendar
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

enum class AppTab(val label: String) {
  SCHEDULE("Schedule"),
  LIVE("Live"),
  WATCH("Watch"),
  STANDINGS("Standings"),
  RANKINGS("Rankings"),
  TEAMS("Teams"),
  TRANSITIVE("Transitive W/Ls")
}

data class NavSnapshot(
  val tab: AppTab,
  val label: String,
  val selectedTeamId: String?,
  val teamSelectedSeason: Int?,
  val transitiveMode: String,
  val transitiveTeamAId: String?,
  val transitiveTeamBId: String?,
  val sheetEventId: String?,
  val sheetEventPreview: GameEvent?
)

data class AppUiState(
  val isDarkTheme: Boolean = false,
  val activeTab: AppTab = AppTab.SCHEDULE,
  val searchQuery: String = "",
  val autoRefreshEnabled: Boolean = true,
  val isRefreshingManual: Boolean = false,
  val lastUpdatedMs: Long? = null,
  val snackbarMessage: String? = null,
  val backStack: List<NavSnapshot> = emptyList(),

  // Schedule
  val scheduleGroup: String = "80",
  val scheduleSeasonType: String = "2",
  val scheduleSelectedWeek: String? = null,
  val currentSeasonYear: Int = Calendar.getInstance().get(Calendar.YEAR),
  val currentSeasonType: String? = null,
  val currentWeekNumber: String? = null,
  val calendar: SeasonCalendar = SeasonCalendar(),
  val scoreboardEvents: List<GameEvent> = emptyList(),
  val scoreboardLoading: Boolean = true,
  val scoreboardError: String? = null,
  val scheduleStatusFilter: String = "all",
  val top25Only: Boolean = false,
  val scheduleConferenceFilter: String = "all",

  // Live
  val liveDivision: String = "80",
  val liveEvents: List<GameEvent> = emptyList(),
  val liveLoading: Boolean = true,
  val liveError: String? = null,

  // Watch
  val watchSource: String = "ppv",
  val watchFilter: String = "cfb",
  val ppvCatalog: WatchCatalog = WatchCatalog(),
  val ppvLoading: Boolean = false,
  val ppvError: String? = null,
  val timStreamsCatalog: WatchCatalog = WatchCatalog(),
  val timStreamsLoading: Boolean = false,
  val timStreamsError: String? = null,
  val strmFreeCatalog: WatchCatalog = WatchCatalog(),
  val strmFreeLoading: Boolean = false,
  val strmFreeError: String? = null,
  val selectedStream: WatchStream? = null,
  val selectedFeedIndex: Int = 0,
  val watchFullscreen: Boolean = false,

  // Standings
  val conferences: List<ConferenceStandings> = emptyList(),
  val conferenceMap: Map<String, ConferenceInfo> = emptyMap(),
  val rankMap: Map<String, Int> = emptyMap(),
  val standingsPollName: String = "Top 25",
  val selectedConferenceId: String? = null,
  val standingsLoading: Boolean = true,
  val standingsError: String? = null,

  // Rankings
  val rankingsSeason: Int? = null,
  val rankingsWeekKey: String? = null,
  val rankingsPollTab: String = "cfp",
  val rankingsConfFilter: String = "all",
  val rankingsData: WeeklyRankingsData? = null,
  val rankingsLoading: Boolean = false,
  val rankingsError: String? = null,

  // Teams
  val teamsDirectory: List<TeamDirectoryItem> = emptyList(),
  val teamsById: Map<String, TeamDirectoryItem> = emptyMap(),
  val teamsLoading: Boolean = false,
  val teamsError: String? = null,
  val teamsDivisionFilter: String = "all",
  val teamsConfFilter: String = "all",
  val selectedTeamId: String? = null,
  val teamSelectedSeason: Int? = null,
  val teamPageData: TeamPageData? = null,
  val teamPageLoading: Boolean = false,
  val teamPageError: String? = null,
  val teamScheduleFilter: String = "all",
  val teamStatsCategory: String = "all",

  // Transitive W/Ls
  val seasonResultsGraph: SeasonResultsGraph? = null,
  val seasonGraphLoading: Boolean = false,
  val seasonGraphError: String? = null,
  val transitiveMode: String = "matchup",
  val transitiveTeamAId: String? = null,
  val transitiveTeamBId: String? = null,
  val transitiveComparison: TransitiveComparison? = null,
  val transitiveComputing: Boolean = false,
  val farthestTargetScope: String = "fbs_fcs",
  val farthestSchoolDiv: String = "all",
  val farthestSort: String = "win_desc",
  val farthestRows: List<SchoolFarthestRow> = emptyList(),
  val farthestComputing: Boolean = false,

  // Game Center Sheet
  val sheetEventId: String? = null,
  val sheetEventPreview: GameEvent? = null,
  val gameSummary: GameSummary? = null,
  val gameSummaryLoading: Boolean = false,
  val gameSummaryError: String? = null
) {
  val canGoBack: Boolean get() = backStack.isNotEmpty()
  val backPageLabel: String get() = backStack.lastOrNull()?.label.orEmpty()
}

class CfbViewModel(application: Application) : AndroidViewModel(application) {
  private val repository = CfbRepository()
  private val prefs = application.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

  private val _uiState = MutableStateFlow(
    AppUiState(isDarkTheme = resolveInitialTheme(application))
  )
  val uiState: StateFlow<AppUiState> = _uiState.asStateFlow()

  private var pollJob: Job? = null
  private var teamRequestToken = 0
  private var rankingsRequestToken = 0
  private var gameSheetRequestToken = 0
  private var lastScheduleKey = ""
  private var lastWatchFetchMs = 0L
  private var isForeground = true

  private var cachedStandingsBundle: StandingsBundle? = null
  private var farthestCacheKey = ""
  private var farthestCachedRaw = emptyList<SchoolFarthestRow>()

  init {
    bootstrapLoad()
    startAutoPolling()
  }

  private fun resolveInitialTheme(ctx: Context): Boolean {
    return when (prefs.getString(KEY_THEME, null)) {
      "dark" -> true
      "light" -> false
      else -> (ctx.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
        Configuration.UI_MODE_NIGHT_YES
    }
  }

  fun toggleTheme() {
    val next = !_uiState.value.isDarkTheme
    prefs.edit().putString(KEY_THEME, if (next) "dark" else "light").apply()
    _uiState.update { it.copy(isDarkTheme = next) }
  }

  fun toggleAutoRefresh() {
    val next = !_uiState.value.autoRefreshEnabled
    _uiState.update {
      it.copy(
        autoRefreshEnabled = next,
        snackbarMessage = if (next) "Live 15s auto-refresh enabled" else "Auto-refresh paused"
      )
    }
  }

  fun onAppForegroundChanged(foreground: Boolean) {
    isForeground = foreground
  }

  fun consumeSnackbar() {
    _uiState.update { it.copy(snackbarMessage = null) }
  }

  fun setSearchQuery(query: String) {
    _uiState.update { it.copy(searchQuery = query) }
  }

  private fun bootstrapLoad() {
    viewModelScope.launch {
      listOf(
        async { loadScoreboard(useCurrentDefaults = true) },
        async { loadLiveSlate() },
        async { loadStandingsAndCatalog() },
        async { loadWatchStreams(silent = true) }
      ).awaitAll()
    }
  }

  private fun startAutoPolling() {
    pollJob?.cancel()
    pollJob = viewModelScope.launch {
      while (isActive) {
        delay(15_000L)
        val s = _uiState.value
        if (!isForeground || !s.autoRefreshEnabled) continue

        loadLiveSlate(force = true, silent = true)
        val cur = _uiState.value
        when (cur.activeTab) {
          AppTab.SCHEDULE -> {
            val activeKey = "${cur.liveDivision}:${cur.currentSeasonType}:${cur.currentWeekNumber}"
            if (lastScheduleKey == activeKey) {
              loadScoreboard(force = true, silent = true)
            }
          }
          AppTab.WATCH -> {
            if (System.currentTimeMillis() - lastWatchFetchMs >= 60_000L) {
              loadWatchStreams(force = true, silent = true)
            }
          }
          else -> Unit
        }
        val openEventId = cur.sheetEventId
        if (openEventId != null && cur.sheetEventPreview?.state == "in") {
          refreshOpenGameSummary(openEventId, showSpinner = false)
        }
      }
    }
  }

  fun selectTab(tab: AppTab, clearHistory: Boolean = true) {
    _uiState.update { s ->
      s.copy(
        activeTab = tab,
        watchFullscreen = if (tab != AppTab.WATCH) false else s.watchFullscreen,
        backStack = if (clearHistory) emptyList() else s.backStack
      )
    }
    when (tab) {
      AppTab.STANDINGS -> if (_uiState.value.conferences.isEmpty()) viewModelScope.launch { loadStandingsAndCatalog() }
      AppTab.RANKINGS -> if (_uiState.value.rankingsData == null) viewModelScope.launch { loadRankings() }
      AppTab.TEAMS -> if (_uiState.value.teamsDirectory.isEmpty()) viewModelScope.launch { loadTeamsCatalog() }
      AppTab.TRANSITIVE -> {
        viewModelScope.launch {
          if (_uiState.value.teamsDirectory.isEmpty()) loadTeamsCatalog()
          if (_uiState.value.seasonResultsGraph == null) loadSeasonResultsGraph()
          else ensureDefaultTransitiveSelection()
        }
      }
      AppTab.WATCH -> {
        val st = _uiState.value
        if (st.ppvCatalog.streams.isEmpty() && st.timStreamsCatalog.streams.isEmpty() && st.strmFreeCatalog.streams.isEmpty()) {
          viewModelScope.launch { loadWatchStreams(force = false) }
        }
      }
      AppTab.LIVE -> if (_uiState.value.liveEvents.isEmpty()) viewModelScope.launch { loadLiveSlate() }
      AppTab.SCHEDULE -> if (_uiState.value.scoreboardEvents.isEmpty()) viewModelScope.launch { loadScoreboard() }
    }
  }

  fun manualRefresh() {
    viewModelScope.launch {
      _uiState.update { it.copy(isRefreshingManual = true) }
      try {
        val s = _uiState.value
        when (s.activeTab) {
          AppTab.STANDINGS -> loadStandingsAndCatalog(force = true)
          AppTab.RANKINGS -> {
            val parts = s.rankingsWeekKey?.split(":").orEmpty()
            loadRankings(
              season = s.rankingsSeason,
              seasonType = parts.getOrNull(0),
              week = parts.getOrNull(1),
              force = true
            )
          }
          AppTab.LIVE -> loadLiveSlate(force = true)
          AppTab.TEAMS -> {
            val tid = s.selectedTeamId
            if (tid != null) {
              loadTeamPage(tid, s.teamSelectedSeason ?: s.currentSeasonYear, force = true)
            }
            else loadTeamsCatalog(force = true)
          }
          AppTab.TRANSITIVE -> {
            loadSeasonResultsGraph(force = true)
          }
          AppTab.WATCH -> {
            loadWatchStreams(force = true)
            loadLiveSlate(force = true, silent = true)
          }
          AppTab.SCHEDULE -> {
            loadScoreboard(force = true)
            loadLiveSlate(force = true, silent = true)
          }
        }
        val openEventId = _uiState.value.sheetEventId
        if (openEventId != null) {
          refreshOpenGameSummary(openEventId, showSpinner = false, force = true)
        }
        _uiState.update { it.copy(snackbarMessage = "Synced latest ESPN data") }
      } finally {
        _uiState.update { it.copy(isRefreshingManual = false) }
      }
    }
  }

  // ==================== SCHEDULE & LIVE ====================

  fun changeScheduleGroup(group: String) {
    _uiState.update {
      it.copy(
        scheduleGroup = group,
        scheduleConferenceFilter = "all"
      )
    }
    viewModelScope.launch { loadScoreboard(force = false) }
  }

  fun changeScheduleSeasonType(seasonType: String) {
    val cur = _uiState.value
    val entries = if (seasonType == "3") cur.calendar.postseason else cur.calendar.regular
    val defaultWeek = if (seasonType == cur.currentSeasonType && !cur.currentWeekNumber.isNullOrEmpty()) {
      cur.currentWeekNumber
    } else {
      entries.firstOrNull()?.value ?: "1"
    }
    _uiState.update {
      it.copy(
        scheduleSeasonType = seasonType,
        scheduleSelectedWeek = defaultWeek
      )
    }
    viewModelScope.launch { loadScoreboard(force = false) }
  }

  fun selectScheduleWeek(weekValue: String) {
    _uiState.update { it.copy(scheduleSelectedWeek = weekValue) }
    viewModelScope.launch { loadScoreboard(force = false) }
  }

  fun jumpToCurrentWeek() {
    val cur = _uiState.value
    _uiState.update {
      it.copy(
        scheduleSeasonType = cur.currentSeasonType ?: "2",
        scheduleSelectedWeek = cur.currentWeekNumber ?: cur.scheduleSelectedWeek
      )
    }
    viewModelScope.launch { loadScoreboard(useCurrentDefaults = cur.currentWeekNumber == null, force = true) }
  }

  fun setScheduleFilters(status: String? = null, top25Only: Boolean? = null, confId: String? = null) {
    _uiState.update {
      it.copy(
        scheduleStatusFilter = status ?: it.scheduleStatusFilter,
        top25Only = top25Only ?: it.top25Only,
        scheduleConferenceFilter = confId ?: it.scheduleConferenceFilter
      )
    }
  }

  fun changeLiveDivision(division: String) {
    _uiState.update { it.copy(liveDivision = division) }
    viewModelScope.launch { loadLiveSlate(force = true) }
  }

  private suspend fun loadScoreboard(
    useCurrentDefaults: Boolean = false,
    force: Boolean = false,
    silent: Boolean = false
  ) {
    val cur = _uiState.value
    if (!silent) {
      _uiState.update { it.copy(scoreboardLoading = true, scoreboardError = null) }
    }
    try {
      val data = repository.getScoreboard(
        seasonType = if (useCurrentDefaults) null else cur.scheduleSeasonType,
        week = if (useCurrentDefaults) null else cur.scheduleSelectedWeek,
        group = cur.scheduleGroup,
        force = force
      )
      lastScheduleKey = "${cur.scheduleGroup}:${data.seasonType}:${data.weekNumber}"
      _uiState.update { s ->
        s.copy(
          scoreboardEvents = data.events,
          scoreboardLoading = false,
          scoreboardError = null,
          calendar = if (data.calendar.regular.isNotEmpty() || data.calendar.postseason.isNotEmpty()) {
            data.calendar
          } else s.calendar,
          scheduleSeasonType = if (useCurrentDefaults) data.seasonType else s.scheduleSeasonType,
          scheduleSelectedWeek = if (useCurrentDefaults || s.scheduleSelectedWeek == null) {
            data.weekNumber
          } else s.scheduleSelectedWeek,
          currentSeasonYear = if (useCurrentDefaults) data.seasonYear else s.currentSeasonYear,
          currentSeasonType = if (useCurrentDefaults) data.seasonType else s.currentSeasonType,
          currentWeekNumber = if (useCurrentDefaults) data.weekNumber else s.currentWeekNumber,
          lastUpdatedMs = System.currentTimeMillis()
        )
      }
    } catch (e: Exception) {
      if (!silent) {
        _uiState.update {
          it.copy(
            scoreboardLoading = false,
            scoreboardError = e.message ?: "Failed to load scoreboard"
          )
        }
      }
    }
  }

  private suspend fun loadLiveSlate(force: Boolean = false, silent: Boolean = false) {
    val cur = _uiState.value
    if (!silent && cur.liveEvents.isEmpty()) {
      _uiState.update { it.copy(liveLoading = true, liveError = null) }
    }
    try {
      val data = repository.getScoreboard(
        seasonType = null,
        week = null,
        group = cur.liveDivision,
        force = force
      )
      _uiState.update {
        it.copy(
          liveEvents = data.events,
          liveLoading = false,
          liveError = null,
          currentSeasonYear = data.seasonYear,
          currentSeasonType = data.seasonType,
          currentWeekNumber = data.weekNumber,
          lastUpdatedMs = System.currentTimeMillis()
        )
      }
    } catch (e: Exception) {
      if (!silent) {
        _uiState.update {
          it.copy(
            liveLoading = false,
            liveError = e.message ?: "Failed to load live slate"
          )
        }
      }
    }
  }

  // ==================== STANDINGS, RANKINGS & TEAMS ====================

  private suspend fun loadStandingsAndCatalog(force: Boolean = false) {
    if (_uiState.value.conferences.isEmpty() || force) {
      _uiState.update { it.copy(standingsLoading = true, standingsError = null) }
    }
    try {
      val bundle = repository.getStandingsAndRankings(force = force)
      cachedStandingsBundle = bundle
      _uiState.update { s ->
        s.copy(
          conferences = bundle.conferences,
          conferenceMap = bundle.conferenceMap,
          rankMap = bundle.rankMap,
          standingsPollName = bundle.pollName,
          selectedConferenceId = s.selectedConferenceId ?: bundle.conferences.firstOrNull()?.id,
          standingsLoading = false,
          standingsError = null
        )
      }
      if (_uiState.value.teamsDirectory.isEmpty() || force) {
        loadTeamsCatalog(force = force)
      }
    } catch (e: Exception) {
      _uiState.update {
        it.copy(
          standingsLoading = false,
          standingsError = e.message ?: "Failed to load standings"
        )
      }
    }
  }

  fun selectConference(conferenceId: String) {
    _uiState.update { it.copy(selectedConferenceId = conferenceId) }
  }

  fun setRankingsPollTab(pollTab: String) {
    _uiState.update { it.copy(rankingsPollTab = pollTab) }
  }

  fun setRankingsConfFilter(confId: String) {
    _uiState.update { it.copy(rankingsConfFilter = confId) }
  }

  fun changeRankingsSeason(season: Int) {
    viewModelScope.launch { loadRankings(season = season, week = null, seasonType = null, force = false) }
  }

  fun selectRankingsWeek(seasonType: String, week: String) {
    viewModelScope.launch {
      loadRankings(season = _uiState.value.rankingsSeason, week = week, seasonType = seasonType, force = false)
    }
  }

  fun jumpLatestRankings() {
    viewModelScope.launch {
      loadRankings(season = _uiState.value.rankingsSeason, week = null, seasonType = null, force = false)
    }
  }

  private suspend fun loadRankings(
    season: Int? = _uiState.value.rankingsSeason,
    week: String? = null,
    seasonType: String? = null,
    force: Boolean = false
  ) {
    val reqToken = ++rankingsRequestToken
    _uiState.update { it.copy(rankingsLoading = true, rankingsError = null) }
    try {
      val data = repository.getWeeklyRankings(season = season, week = week, seasonType = seasonType, force = force)
      if (reqToken != rankingsRequestToken) return
      _uiState.update {
        it.copy(
          rankingsSeason = data.seasonYear,
          rankingsWeekKey = data.activeWeekKey,
          rankingsData = data,
          rankingsLoading = false,
          rankingsError = null
        )
      }
    } catch (e: Exception) {
      if (reqToken != rankingsRequestToken) return
      _uiState.update {
        it.copy(
          rankingsLoading = false,
          rankingsError = e.message ?: "Failed to load Top 25 rankings"
        )
      }
    }
  }

  private suspend fun loadTeamsCatalog(force: Boolean = false) {
    _uiState.update { it.copy(teamsLoading = true, teamsError = null) }
    try {
      val bundle = cachedStandingsBundle ?: repository.getStandingsAndRankings(force = force).also {
        cachedStandingsBundle = it
      }
      val (dir, byId) = repository.getTeamsDirectory(bundle, force = force)
      _uiState.update {
        it.copy(
          teamsDirectory = dir,
          teamsById = byId,
          teamsLoading = false,
          teamsError = null
        )
      }
      if (_uiState.value.activeTab == AppTab.TRANSITIVE) {
        ensureDefaultTransitiveSelection()
      }
    } catch (e: Exception) {
      _uiState.update {
        it.copy(
          teamsLoading = false,
          teamsError = e.message ?: "Failed to load NCAA teams directory"
        )
      }
    }
  }

  fun setTeamsFilters(division: String? = null, confId: String? = null) {
    _uiState.update {
      it.copy(
        teamsDivisionFilter = division ?: it.teamsDivisionFilter,
        teamsConfFilter = confId ?: it.teamsConfFilter
      )
    }
  }

  fun openTeamPage(teamId: String, season: Int? = null, recordHistory: Boolean = true) {
    val id = teamId.trim()
    if (id.isEmpty() || id == "-1" || id == "-2") return
    val cur = _uiState.value
    val nextStack = if (recordHistory) pushSnapshot(cur) else cur.backStack
    val seasonYear = season ?: cur.currentSeasonYear

    _uiState.update { s ->
      val sameTeam = s.selectedTeamId == id
      s.copy(
        activeTab = AppTab.TEAMS,
        selectedTeamId = id,
        teamSelectedSeason = seasonYear,
        teamScheduleFilter = if (sameTeam) s.teamScheduleFilter else "all",
        teamStatsCategory = if (sameTeam) s.teamStatsCategory else "all",
        sheetEventId = null,
        gameSummary = null,
        backStack = nextStack
      )
    }
    viewModelScope.launch {
      if (_uiState.value.teamsDirectory.isEmpty()) loadTeamsCatalog()
      loadTeamPage(id, seasonYear, force = false)
    }
  }

  fun closeTeamPage() {
    val cur = _uiState.value
    val updatedStack = if (cur.backStack.lastOrNull()?.let { it.tab == AppTab.TEAMS && it.selectedTeamId == null } == true) {
      cur.backStack.dropLast(1)
    } else {
      cur.backStack
    }
    _uiState.update {
      it.copy(
        selectedTeamId = null,
        teamPageError = null,
        backStack = updatedStack
      )
    }
  }

  fun setTeamPageFilters(scheduleFilter: String? = null, statsCategory: String? = null) {
    _uiState.update {
      it.copy(
        teamScheduleFilter = scheduleFilter ?: it.teamScheduleFilter,
        teamStatsCategory = statsCategory ?: it.teamStatsCategory
      )
    }
  }

  private suspend fun loadTeamPage(teamId: String, seasonYear: Int, force: Boolean) {
    val reqToken = ++teamRequestToken
    _uiState.update { it.copy(teamPageLoading = true, teamPageError = null) }
    try {
      val cur = _uiState.value
      val data = repository.getTeamPageData(
        teamId = teamId,
        season = seasonYear,
        currentSeasonYear = cur.currentSeasonYear,
        catalogEntry = cur.teamsById[teamId],
        force = force
      )
      if (reqToken != teamRequestToken) return
      _uiState.update {
        it.copy(
          teamPageData = data,
          teamPageLoading = false,
          teamPageError = null
        )
      }
    } catch (e: Exception) {
      if (reqToken != teamRequestToken) return
      _uiState.update {
        it.copy(
          teamPageLoading = false,
          teamPageError = e.message ?: "Failed to load team details"
        )
      }
    }
  }

  // ==================== TRANSITIVE W/Ls & FARTHEST CHAINS ====================

  fun setTransitiveMode(mode: String) {
    _uiState.update { it.copy(transitiveMode = mode) }
    if (mode == "farthest") {
      recomputeFarthestLeaderboard()
    } else {
      recomputeTransitiveMatchup()
    }
  }

  fun selectTransitiveTeams(teamAId: String?, teamBId: String?) {
    _uiState.update {
      it.copy(
        transitiveTeamAId = teamAId,
        transitiveTeamBId = teamBId
      )
    }
    recomputeTransitiveMatchup()
  }

  fun swapTransitiveTeams() {
    val cur = _uiState.value
    selectTransitiveTeams(cur.transitiveTeamBId, cur.transitiveTeamAId)
  }

  fun updateFarthestOptions(targetScope: String? = null, schoolDiv: String? = null, sort: String? = null) {
    val prevScope = _uiState.value.farthestTargetScope
    _uiState.update {
      it.copy(
        farthestTargetScope = targetScope ?: it.farthestTargetScope,
        farthestSchoolDiv = schoolDiv ?: it.farthestSchoolDiv,
        farthestSort = sort ?: it.farthestSort
      )
    }
    if (targetScope != null && targetScope != prevScope || _uiState.value.farthestRows.isEmpty()) {
      recomputeFarthestLeaderboard()
    }
  }

  fun openTransitiveMatchupFromFarthest(teamAId: String, teamBId: String) {
    val nextStack = pushSnapshot(_uiState.value)
    _uiState.update {
      it.copy(
        activeTab = AppTab.TRANSITIVE,
        transitiveMode = "matchup",
        transitiveTeamAId = teamAId,
        transitiveTeamBId = teamBId,
        backStack = nextStack
      )
    }
    recomputeTransitiveMatchup()
  }

  fun retrySeasonGraph() {
    viewModelScope.launch { loadSeasonResultsGraph(force = true) }
  }

  private suspend fun loadSeasonResultsGraph(force: Boolean = false) {
    _uiState.update { it.copy(seasonGraphLoading = true, seasonGraphError = null) }
    try {
      val graph = repository.getSeasonResultsGraph(force = force)
      farthestCacheKey = ""
      farthestCachedRaw = emptyList()
      _uiState.update {
        it.copy(
          seasonResultsGraph = graph,
          seasonGraphLoading = false,
          seasonGraphError = null
        )
      }
      ensureDefaultTransitiveSelection()
      if (_uiState.value.transitiveMode == "farthest") {
        recomputeFarthestLeaderboard()
      }
    } catch (e: Exception) {
      _uiState.update {
        it.copy(
          seasonGraphLoading = false,
          seasonGraphError = e.message ?: "Failed to load season game graph"
        )
      }
    }
  }

  private fun ensureDefaultTransitiveSelection() {
    val cur = _uiState.value
    val selectable = cur.teamsDirectory.filter { it.division == "FBS" || it.division == "FCS" }
    if (selectable.size < 2) return
    if (cur.transitiveTeamAId == null || cur.transitiveTeamBId == null) {
      val first = selectable.first().id
      val second = selectable.firstOrNull { it.id != first }?.id ?: selectable[1].id
      _uiState.update {
        it.copy(
          transitiveTeamAId = it.transitiveTeamAId ?: first,
          transitiveTeamBId = it.transitiveTeamBId ?: second
        )
      }
    }
    if (_uiState.value.seasonResultsGraph != null) {
      recomputeTransitiveMatchup()
    }
  }

  private fun recomputeTransitiveMatchup() {
    val cur = _uiState.value
    val graph = cur.seasonResultsGraph ?: return
    val aId = cur.transitiveTeamAId ?: return
    val bId = cur.transitiveTeamBId ?: return
    if (aId == bId) {
      _uiState.update { it.copy(transitiveComparison = null, transitiveComputing = false) }
      return
    }
    _uiState.update { it.copy(transitiveComputing = true) }
    viewModelScope.launch {
      val comp = withContext(Dispatchers.Default) {
        TransitiveEngine.computeTransitiveComparison(graph, aId, bId, maxChains = 5)
      }
      _uiState.update { it.copy(transitiveComparison = comp, transitiveComputing = false) }
    }
  }

  private fun recomputeFarthestLeaderboard() {
    val cur = _uiState.value
    val graph = cur.seasonResultsGraph ?: return
    val selectable = cur.teamsDirectory.filter { it.division == "FBS" || it.division == "FCS" }
    if (selectable.isEmpty()) return

    val targetScope = cur.farthestTargetScope
    val key = "${graph.generatedAt}|${selectable.size}|$targetScope"
    if (key == farthestCacheKey && farthestCachedRaw.isNotEmpty()) {
      _uiState.update { it.copy(farthestRows = farthestCachedRaw, farthestComputing = false) }
      return
    }

    _uiState.update { it.copy(farthestComputing = true) }
    viewModelScope.launch {
      val computed = withContext(Dispatchers.Default) {
        val eligibleTargets = if (targetScope == "fbs") {
          selectable.filter { it.division == "FBS" }.map { it.id }.toSet()
        } else {
          selectable.map { it.id }.toSet()
        }
        val schoolIds = selectable.map { it.id }
        TransitiveEngine.computeSchoolFarthestChains(graph, schoolIds, eligibleTargets)
      }
      farthestCacheKey = key
      farthestCachedRaw = computed
      _uiState.update { it.copy(farthestRows = computed, farthestComputing = false) }
    }
  }

  // ==================== WATCH STREAMS ====================

  fun changeWatchSource(source: String) {
    _uiState.update { it.copy(watchSource = source) }
    viewModelScope.launch {
      when (source) {
        "timstreams" -> if (_uiState.value.timStreamsCatalog.streams.isEmpty()) loadTimStreams()
        "strmfree" -> if (_uiState.value.strmFreeCatalog.streams.isEmpty()) loadStrmFreeStreams()
        else -> if (_uiState.value.ppvCatalog.streams.isEmpty()) loadPpvStreams()
      }
    }
  }

  fun setWatchFilter(filter: String) {
    _uiState.update { it.copy(watchFilter = filter) }
  }

  fun selectWatchStream(stream: WatchStream, feedIndex: Int = 0) {
    _uiState.update {
      it.copy(
        watchSource = stream.source,
        selectedStream = stream,
        selectedFeedIndex = feedIndex.coerceIn(0, (stream.feeds.size - 1).coerceAtLeast(0))
      )
    }
  }

  fun selectWatchFeed(index: Int) {
    _uiState.update { s ->
      val feedsSize = s.selectedStream?.feeds?.size ?: 0
      s.copy(selectedFeedIndex = if (feedsSize > 0) index.coerceIn(0, feedsSize - 1) else 0)
    }
  }

  fun setWatchFullscreen(fullscreen: Boolean) {
    _uiState.update { it.copy(watchFullscreen = fullscreen) }
  }

  fun openWatchForEvent(event: GameEvent, preMatchedStream: WatchStream? = null, recordHistory: Boolean = true) {
    val cur = _uiState.value
    val match = preMatchedStream ?: EspnJsonParser.findStreamForEvent(
      event = event,
      preferredSource = cur.watchSource,
      ppvStreams = cur.ppvCatalog.streams,
      timStreams = cur.timStreamsCatalog.streams,
      strmFreeStreams = cur.strmFreeCatalog.streams
    )
    val nextStack = if (recordHistory) pushSnapshot(cur) else cur.backStack
    _uiState.update {
      it.copy(
        activeTab = AppTab.WATCH,
        watchSource = match?.source ?: it.watchSource,
        selectedStream = match ?: it.selectedStream,
        selectedFeedIndex = 0,
        sheetEventId = null,
        gameSummary = null,
        backStack = nextStack,
        snackbarMessage = if (match == null) "Showing live CFB stream directory for ${event.shortName}" else null
      )
    }
    if (match == null) {
      viewModelScope.launch { loadWatchStreams(force = false) }
    }
  }

  fun openWatchForSummary(summary: GameSummary) {
    val preview = _uiState.value.sheetEventPreview
    val event = preview ?: GameEvent(
      id = summary.id,
      name = "${summary.away.shortName} at ${summary.home.shortName}",
      shortName = "${summary.away.abbreviation} @ ${summary.home.abbreviation}",
      away = summary.away,
      home = summary.home,
      state = summary.state,
      date = summary.date
    )
    openWatchForEvent(event, recordHistory = true)
  }

  private suspend fun loadWatchStreams(force: Boolean = false, silent: Boolean = false) = kotlinx.coroutines.coroutineScope {
    lastWatchFetchMs = System.currentTimeMillis()
    listOf(
      async { loadPpvStreams(force = force, silent = silent) },
      async { loadTimStreams(force = force, silent = silent) },
      async { loadStrmFreeStreams(force = force, silent = silent) }
    ).awaitAll()
  }

  private suspend fun loadPpvStreams(force: Boolean = false, silent: Boolean = false) {
    if (!silent && _uiState.value.ppvCatalog.streams.isEmpty()) {
      _uiState.update { it.copy(ppvLoading = true, ppvError = null) }
    }
    try {
      val catalog = repository.getPpvStreams(force = force)
      _uiState.update { s ->
        val autoPick = s.selectedStream ?: catalog.streams.firstOrNull { it.isCfb && it.isLiveNow }
          ?: catalog.streams.firstOrNull { it.isCfb }
        s.copy(
          ppvCatalog = catalog,
          ppvLoading = false,
          ppvError = null,
          selectedStream = if (s.watchSource == "ppv" && s.selectedStream == null) autoPick else s.selectedStream
        )
      }
    } catch (e: Exception) {
      _uiState.update { it.copy(ppvLoading = false, ppvError = e.message ?: "Failed to load ppv.st streams") }
    }
  }

  private suspend fun loadTimStreams(force: Boolean = false, silent: Boolean = false) {
    if (!silent && _uiState.value.timStreamsCatalog.streams.isEmpty()) {
      _uiState.update { it.copy(timStreamsLoading = true, timStreamsError = null) }
    }
    try {
      val catalog = repository.getTimStreams(force = force)
      _uiState.update { s ->
        val autoPick = catalog.streams.firstOrNull { it.isCfb && it.isLiveNow } ?: catalog.streams.firstOrNull { it.isCfb }
        s.copy(
          timStreamsCatalog = catalog,
          timStreamsLoading = false,
          timStreamsError = null,
          selectedStream = if (s.watchSource == "timstreams" && s.selectedStream == null) autoPick else s.selectedStream
        )
      }
    } catch (e: Exception) {
      _uiState.update { it.copy(timStreamsLoading = false, timStreamsError = e.message ?: "Failed to load tim-streams.com streams") }
    }
  }

  private suspend fun loadStrmFreeStreams(force: Boolean = false, silent: Boolean = false) {
    if (!silent && _uiState.value.strmFreeCatalog.streams.isEmpty()) {
      _uiState.update { it.copy(strmFreeLoading = true, strmFreeError = null) }
    }
    try {
      val catalog = repository.getStrmFreeStreams(force = force)
      _uiState.update { s ->
        val autoPick = catalog.streams.firstOrNull { it.isCfb && it.isLiveNow } ?: catalog.streams.firstOrNull { it.isCfb }
        s.copy(
          strmFreeCatalog = catalog,
          strmFreeLoading = false,
          strmFreeError = null,
          selectedStream = if (s.watchSource == "strmfree" && s.selectedStream == null) autoPick else s.selectedStream
        )
      }
    } catch (e: Exception) {
      _uiState.update { it.copy(strmFreeLoading = false, strmFreeError = e.message ?: "Failed to load strmfree.pk streams") }
    }
  }

  // ==================== GAME CENTER SHEET ====================

  fun openGameSheet(eventId: String, previewHint: GameEvent? = null) {
    val id = eventId.trim()
    if (id.isEmpty()) return
    val preview = previewHint
      ?: _uiState.value.scoreboardEvents.firstOrNull { it.id == id }
      ?: _uiState.value.liveEvents.firstOrNull { it.id == id }
      ?: _uiState.value.teamPageData?.events?.firstOrNull { it.event.id == id }?.event

    _uiState.update {
      it.copy(
        sheetEventId = id,
        sheetEventPreview = preview,
        gameSummary = null,
        gameSummaryLoading = true,
        gameSummaryError = null
      )
    }
    refreshOpenGameSummary(id, showSpinner = true, force = false)
  }

  fun closeGameSheet() {
    ++gameSheetRequestToken
    _uiState.update {
      it.copy(
        sheetEventId = null,
        sheetEventPreview = null,
        gameSummary = null,
        gameSummaryLoading = false,
        gameSummaryError = null
      )
    }
  }

  fun refreshOpenGameSummary(eventId: String, showSpinner: Boolean = true, force: Boolean = true) {
    val token = ++gameSheetRequestToken
    if (showSpinner) {
      _uiState.update { it.copy(gameSummaryLoading = true, gameSummaryError = null) }
    }
    viewModelScope.launch {
      try {
        val summary = repository.getGameSummary(eventId, force = force)
        if (token != gameSheetRequestToken) return@launch
        _uiState.update {
          it.copy(
            gameSummary = summary,
            gameSummaryLoading = false,
            gameSummaryError = null
          )
        }
      } catch (e: Exception) {
        if (token != gameSheetRequestToken) return@launch
        _uiState.update {
          it.copy(
            gameSummaryLoading = false,
            gameSummaryError = e.message ?: "Failed to load Game Center"
          )
        }
      }
    }
  }

  // ==================== BACK TO PREVIOUS PAGE HISTORY ====================

  private fun describeLabel(s: AppUiState): String = when (s.activeTab) {
    AppTab.TEAMS -> if (s.selectedTeamId != null) {
      s.teamPageData?.team?.shortName
        ?: s.teamPageData?.team?.displayName
        ?: s.teamsById[s.selectedTeamId]?.shortName
        ?: "Team Page"
    } else "Teams"
    AppTab.LIVE -> "Live"
    AppTab.WATCH -> "Watch"
    AppTab.STANDINGS -> "Standings"
    AppTab.RANKINGS -> "Rankings"
    AppTab.TRANSITIVE -> if (s.transitiveMode == "farthest") "Farthest Chains" else "Transitive W/Ls"
    AppTab.SCHEDULE -> "Schedule"
  }

  private fun pushSnapshot(s: AppUiState): List<NavSnapshot> {
    val snap = NavSnapshot(
      tab = s.activeTab,
      label = describeLabel(s),
      selectedTeamId = s.selectedTeamId,
      teamSelectedSeason = s.teamSelectedSeason,
      transitiveMode = s.transitiveMode,
      transitiveTeamAId = s.transitiveTeamAId,
      transitiveTeamBId = s.transitiveTeamBId,
      sheetEventId = s.sheetEventId,
      sheetEventPreview = s.sheetEventPreview
    )
    return (s.backStack + snap).takeLast(25)
  }

  fun goBackToPreviousPage() {
    val cur = _uiState.value
    val snap = cur.backStack.lastOrNull() ?: return
    val trimmedStack = cur.backStack.dropLast(1)
    _uiState.update {
      it.copy(
        activeTab = snap.tab,
        watchFullscreen = false,
        selectedTeamId = snap.selectedTeamId,
        teamSelectedSeason = snap.teamSelectedSeason,
        transitiveMode = snap.transitiveMode,
        transitiveTeamAId = snap.transitiveTeamAId,
        transitiveTeamBId = snap.transitiveTeamBId,
        backStack = trimmedStack
      )
    }
    if (snap.tab == AppTab.TEAMS && snap.selectedTeamId != null) {
      val season = snap.teamSelectedSeason ?: _uiState.value.currentSeasonYear
      if (_uiState.value.teamPageData?.team?.id != snap.selectedTeamId ||
        _uiState.value.teamPageData?.seasonYear != season
      ) {
        viewModelScope.launch { loadTeamPage(snap.selectedTeamId, season, force = false) }
      }
    }
    if (snap.tab == AppTab.TRANSITIVE) {
      if (snap.transitiveMode == "farthest") recomputeFarthestLeaderboard()
      else recomputeTransitiveMatchup()
    }
    if (snap.sheetEventId != null) {
      openGameSheet(snap.sheetEventId, snap.sheetEventPreview)
    } else if (cur.sheetEventId != null) {
      closeGameSheet()
    }
  }

  companion object {
    private const val PREFS_NAME = "cfb_hub_prefs"
    private const val KEY_THEME = "cfb_theme"
  }
}
