package com.thecfbhub.app.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.AccountTree
import androidx.compose.material.icons.rounded.CalendarMonth
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.DarkMode
import androidx.compose.material.icons.rounded.Groups
import androidx.compose.material.icons.rounded.Leaderboard
import androidx.compose.material.icons.rounded.LightMode
import androidx.compose.material.icons.rounded.LiveTv
import androidx.compose.material.icons.rounded.MilitaryTech
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Sensors
import androidx.compose.material.icons.rounded.SportsFootball
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.thecfbhub.app.ui.screens.GameCenterSheet
import com.thecfbhub.app.ui.screens.LiveScreen
import com.thecfbhub.app.ui.screens.RankingsScreen
import com.thecfbhub.app.ui.screens.ScheduleScreen
import com.thecfbhub.app.ui.screens.StandingsScreen
import com.thecfbhub.app.ui.screens.TeamsScreen
import com.thecfbhub.app.ui.screens.TransitiveScreen
import com.thecfbhub.app.ui.screens.WatchScreen
import com.thecfbhub.app.ui.state.AppTab
import com.thecfbhub.app.ui.state.AppUiState
import com.thecfbhub.app.ui.state.CfbViewModel
import com.thecfbhub.app.ui.theme.CfbTheme
import com.thecfbhub.app.ui.theme.TheCfbHubTheme

@Composable
fun CfbHubApp(viewModel: CfbViewModel) {
  val state by viewModel.uiState.collectAsStateWithLifecycle()
  val snackbarHostState = remember { SnackbarHostState() }
  var searchBarVisible by remember { mutableStateOf(false) }

  LaunchedEffect(state.snackbarMessage) {
    val msg = state.snackbarMessage
    if (!msg.isNullOrBlank()) {
      snackbarHostState.showSnackbar(msg)
      viewModel.consumeSnackbar()
    }
  }

  val interceptBack = state.watchFullscreen ||
    state.sheetEventId != null ||
    state.canGoBack ||
    (state.activeTab == AppTab.TEAMS && state.selectedTeamId != null) ||
    state.activeTab != AppTab.SCHEDULE

  BackHandler(enabled = interceptBack) {
    when {
      state.watchFullscreen -> viewModel.setWatchFullscreen(false)
      state.sheetEventId != null -> viewModel.closeGameSheet()
      state.canGoBack -> viewModel.goBackToPreviousPage()
      state.activeTab == AppTab.TEAMS && state.selectedTeamId != null -> viewModel.closeTeamPage()
      state.activeTab != AppTab.SCHEDULE -> viewModel.selectTab(AppTab.SCHEDULE)
    }
  }

  TheCfbHubTheme(darkTheme = state.isDarkTheme) {
    val liveCount = remember(state.liveEvents) { state.liveEvents.count { it.state == "in" } }
    val watchLiveCount = remember(state.watchSource, state.ppvCatalog, state.timStreamsCatalog, state.strmFreeCatalog) {
      val list = when (state.watchSource) {
        "timstreams" -> state.timStreamsCatalog.streams
        "strmfree" -> state.strmFreeCatalog.streams
        else -> state.ppvCatalog.streams
      }
      list.count { it.isCfb && it.isLiveNow }
    }

    Scaffold(
      containerColor = MaterialTheme.colorScheme.background,
      snackbarHost = { SnackbarHost(snackbarHostState) },
      topBar = {
        if (!state.watchFullscreen) {
          CfbTopBar(
            state = state,
            liveCount = liveCount,
            searchBarVisible = searchBarVisible,
            onToggleSearch = {
              if (searchBarVisible) {
                viewModel.setSearchQuery("")
                searchBarVisible = false
              } else {
                searchBarVisible = true
              }
            },
            onSearchChange = viewModel::setSearchQuery,
            onBackClick = viewModel::goBackToPreviousPage,
            onToggleAutoRefresh = viewModel::toggleAutoRefresh,
            onRefresh = viewModel::manualRefresh,
            onToggleTheme = viewModel::toggleTheme
          )
        }
      },
      bottomBar = {
        if (!state.watchFullscreen) {
          CfbBottomNavigationBar(
            activeTab = state.activeTab,
            liveCount = liveCount,
            watchCfbCount = watchLiveCount,
            onSelectTab = { viewModel.selectTab(it, clearHistory = true) }
          )
        }
      }
    ) { innerPadding ->
      Box(
        modifier = Modifier
          .fillMaxSize()
          .padding(innerPadding)
      ) {
        when (state.activeTab) {
          AppTab.SCHEDULE -> ScheduleScreen(
            state = state,
            onChangeGroup = viewModel::changeScheduleGroup,
            onChangeSeasonType = viewModel::changeScheduleSeasonType,
            onSelectWeek = viewModel::selectScheduleWeek,
            onJumpCurrentWeek = viewModel::jumpToCurrentWeek,
            onSetFilters = viewModel::setScheduleFilters,
            onRefresh = viewModel::manualRefresh,
            onOpenGame = { ev -> viewModel.openGameSheet(ev.id, ev) },
            onOpenTeam = { tid -> viewModel.openTeamPage(tid, recordHistory = true) },
            onOpenWatch = { ev -> viewModel.openWatchForEvent(ev, recordHistory = true) }
          )

          AppTab.LIVE -> LiveScreen(
            state = state,
            onChangeDivision = viewModel::changeLiveDivision,
            onRefresh = viewModel::manualRefresh,
            onOpenGame = { ev -> viewModel.openGameSheet(ev.id, ev) },
            onOpenTeam = { tid -> viewModel.openTeamPage(tid, recordHistory = true) },
            onOpenWatch = { ev -> viewModel.openWatchForEvent(ev, recordHistory = true) }
          )

          AppTab.WATCH -> WatchScreen(
            state = state,
            onChangeSource = viewModel::changeWatchSource,
            onSetFilter = viewModel::setWatchFilter,
            onSelectStream = { viewModel.selectWatchStream(it, 0) },
            onSelectFeed = viewModel::selectWatchFeed,
            onToggleFullscreen = viewModel::setWatchFullscreen,
            onRetry = viewModel::manualRefresh
          )

          AppTab.STANDINGS -> StandingsScreen(
            state = state,
            onSelectConference = viewModel::selectConference,
            onOpenTeam = { tid -> viewModel.openTeamPage(tid, recordHistory = true) },
            onRetry = viewModel::manualRefresh
          )

          AppTab.RANKINGS -> RankingsScreen(
            state = state,
            onSelectPollTab = viewModel::setRankingsPollTab,
            onChangeSeason = viewModel::changeRankingsSeason,
            onSelectWeek = viewModel::selectRankingsWeek,
            onJumpLatest = viewModel::jumpLatestRankings,
            onSetConfFilter = viewModel::setRankingsConfFilter,
            onOpenTeam = { tid -> viewModel.openTeamPage(tid, recordHistory = true) },
            onRetry = viewModel::manualRefresh
          )

          AppTab.TEAMS -> TeamsScreen(
            state = state,
            onSetDirectoryFilters = viewModel::setTeamsFilters,
            onOpenTeam = { tid, season, recHist -> viewModel.openTeamPage(tid, season, recHist) },
            onCloseTeam = viewModel::closeTeamPage,
            onBackToPreviousPage = viewModel::goBackToPreviousPage,
            onSetTeamPageFilters = viewModel::setTeamPageFilters,
            onOpenGame = { eid -> viewModel.openGameSheet(eid) },
            onRetryDirectory = viewModel::manualRefresh,
            onRetryTeamPage = viewModel::manualRefresh
          )

          AppTab.TRANSITIVE -> TransitiveScreen(
            state = state,
            onSetMode = viewModel::setTransitiveMode,
            onSelectTeams = viewModel::selectTransitiveTeams,
            onSwapTeams = viewModel::swapTransitiveTeams,
            onUpdateFarthestOptions = viewModel::updateFarthestOptions,
            onCompareMatchupFromFarthest = viewModel::openTransitiveMatchupFromFarthest,
            onOpenTeam = { tid -> viewModel.openTeamPage(tid, recordHistory = true) },
            onOpenGame = { eid -> viewModel.openGameSheet(eid) },
            onRetryGraph = viewModel::retrySeasonGraph
          )
        }
      }

      if (state.sheetEventId != null) {
        GameCenterSheet(
          state = state,
          onDismiss = viewModel::closeGameSheet,
          onRefresh = { state.sheetEventId?.let { viewModel.refreshOpenGameSummary(it, showSpinner = false) } },
          onOpenTeam = { tid -> viewModel.openTeamPage(tid, recordHistory = true) },
          onOpenWatch = { summary -> viewModel.openWatchForSummary(summary) }
        )
      }
    }
  }
}

@Composable
private fun CfbTopBar(
  state: AppUiState,
  liveCount: Int,
  searchBarVisible: Boolean,
  onToggleSearch: () -> Unit,
  onSearchChange: (String) -> Unit,
  onBackClick: () -> Unit,
  onToggleAutoRefresh: () -> Unit,
  onRefresh: () -> Unit,
  onToggleTheme: () -> Unit
) {
  val ext = CfbTheme.extended
  val subtitle = remember(state, liveCount) { buildTopSubtitle(state) }

  Surface(
    color = MaterialTheme.colorScheme.surfaceContainerLow,
    tonalElevation = 1.dp
  ) {
    Column(
      modifier = Modifier
        .fillMaxWidth()
        .statusBarsPadding()
    ) {
      Row(
        modifier = Modifier
          .fillMaxWidth()
          .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween
      ) {
        Row(
          modifier = Modifier.weight(1f),
          verticalAlignment = Alignment.CenterVertically,
          horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
          if (state.canGoBack) {
            FilledTonalButton(
              onClick = onBackClick,
              contentPadding = PaddingValues(horizontal = 10.dp, vertical = 4.dp),
              shape = RoundedCornerShape(999.dp)
            ) {
              Icon(
                imageVector = Icons.AutoMirrored.Rounded.ArrowBack,
                contentDescription = "Back to Previous Page",
                modifier = Modifier.size(16.dp)
              )
              Spacer(Modifier.width(4.dp))
              Text(
                text = "Back",
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.Bold
              )
            }
          } else {
            Surface(
              shape = RoundedCornerShape(10.dp),
              color = MaterialTheme.colorScheme.primary,
              contentColor = MaterialTheme.colorScheme.onPrimary,
              modifier = Modifier.size(34.dp)
            ) {
              Box(contentAlignment = Alignment.Center) {
                Icon(
                  imageVector = Icons.Rounded.SportsFootball,
                  contentDescription = null,
                  modifier = Modifier.size(20.dp)
                )
              }
            }
          }

          Column(modifier = Modifier.weight(1f)) {
            Text(
              text = "The CFB Hub",
              style = MaterialTheme.typography.titleMedium,
              fontWeight = FontWeight.ExtraBold,
              maxLines = 1,
              overflow = TextOverflow.Ellipsis
            )
            Text(
              text = subtitle,
              style = MaterialTheme.typography.labelSmall,
              color = MaterialTheme.colorScheme.onSurfaceVariant,
              maxLines = 1,
              overflow = TextOverflow.Ellipsis
            )
          }
        }

        Row(
          verticalAlignment = Alignment.CenterVertically,
          horizontalArrangement = Arrangement.spacedBy(2.dp)
        ) {
          Surface(
            modifier = Modifier
              .clip(RoundedCornerShape(999.dp))
              .clickable(onClick = onToggleAutoRefresh),
            shape = RoundedCornerShape(999.dp),
            color = if (state.autoRefreshEnabled) MaterialTheme.colorScheme.primaryContainer
            else MaterialTheme.colorScheme.surfaceContainerHighest,
            contentColor = if (state.autoRefreshEnabled) MaterialTheme.colorScheme.onPrimaryContainer
            else MaterialTheme.colorScheme.onSurfaceVariant
          ) {
            Row(
              modifier = Modifier.padding(horizontal = 8.dp, vertical = 5.dp),
              verticalAlignment = Alignment.CenterVertically,
              horizontalArrangement = Arrangement.spacedBy(4.dp)
            ) {
              Box(
                modifier = Modifier
                  .size(7.dp)
                  .clip(CircleShape)
                  .background(
                    if (state.autoRefreshEnabled && liveCount > 0) ext.live
                    else MaterialTheme.colorScheme.primary
                  )
              )
              Text(
                text = if (state.autoRefreshEnabled) "15s" else "Off",
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.Bold
              )
            }
          }

          IconButton(onClick = onToggleSearch, modifier = Modifier.size(36.dp)) {
            Icon(
              imageVector = if (searchBarVisible) Icons.Rounded.Close else Icons.Rounded.Search,
              contentDescription = "Search",
              modifier = Modifier.size(20.dp)
            )
          }

          IconButton(onClick = onRefresh, modifier = Modifier.size(36.dp)) {
            Icon(
              imageVector = Icons.Rounded.Refresh,
              contentDescription = "Refresh",
              modifier = Modifier.size(20.dp)
            )
          }

          IconButton(onClick = onToggleTheme, modifier = Modifier.size(36.dp)) {
            Icon(
              imageVector = if (state.isDarkTheme) Icons.Rounded.LightMode else Icons.Rounded.DarkMode,
              contentDescription = "Toggle theme",
              modifier = Modifier.size(20.dp)
            )
          }
        }
      }

      AnimatedVisibility(visible = searchBarVisible) {
        OutlinedTextField(
          value = state.searchQuery,
          onValueChange = onSearchChange,
          placeholder = { Text("Search team, matchup, or conference...") },
          leadingIcon = { Icon(Icons.Rounded.Search, contentDescription = null) },
          trailingIcon = {
            if (state.searchQuery.isNotEmpty()) {
              IconButton(onClick = { onSearchChange("") }) {
                Icon(Icons.Rounded.Close, contentDescription = "Clear")
              }
            }
          },
          singleLine = true,
          shape = RoundedCornerShape(12.dp),
          modifier = Modifier
            .fillMaxWidth()
            .padding(start = 12.dp, end = 12.dp, bottom = 10.dp)
        )
      }

      HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
    }
  }
}

private fun buildTopSubtitle(state: AppUiState): String {
  val year = state.currentSeasonYear
  return when (state.activeTab) {
    AppTab.STANDINGS -> "$year Conference Standings"
    AppTab.RANKINGS -> {
      val yr = state.rankingsSeason ?: year
      val wk = state.rankingsData?.activeWeekLabel ?: "Latest Rankings"
      "$yr CFP & AP Top 25 · $wk"
    }
    AppTab.LIVE -> "${if (state.liveDivision == "81") "FCS" else "FBS"} Live & Play-by-Play"
    AppTab.WATCH -> {
      val label = when (state.watchSource) {
        "timstreams" -> "tim-streams.com"
        "strmfree" -> "strmfree.pk"
        else -> "ppv.st"
      }
      "Live College Football Streams · $label"
    }
    AppTab.TEAMS -> state.teamPageData?.takeIf { it.team.id == state.selectedTeamId }?.let {
      "${it.team.shortName} · ${it.seasonYear} Team Page"
    } ?: "NCAA FBS & FCS Teams Directory"
    AppTab.TRANSITIVE -> if (state.transitiveMode == "farthest") {
      "$year Farthest Transitive Chains"
    } else {
      "$year Transitive W/Ls Explorer"
    }
    AppTab.SCHEDULE -> {
      val div = if (state.scheduleGroup == "81") "FCS" else "FBS"
      val phase = if (state.scheduleSeasonType == "3") "Postseason" else "Regular Season"
      val entries = if (state.scheduleSeasonType == "3") state.calendar.postseason else state.calendar.regular
      val wkLabel = entries.firstOrNull { it.value == state.scheduleSelectedWeek }?.label
        ?: state.scheduleSelectedWeek?.let { "Week $it" }
        ?: "Loading"
      "$year $div $phase · $wkLabel"
    }
  }
}

private data class NavTabSpec(
  val tab: AppTab,
  val icon: ImageVector,
  val shortLabel: String,
  val badgeCount: Int = 0
)

@Composable
private fun CfbBottomNavigationBar(
  activeTab: AppTab,
  liveCount: Int,
  watchCfbCount: Int,
  onSelectTab: (AppTab) -> Unit
) {
  val ext = CfbTheme.extended
  val items = listOf(
    NavTabSpec(AppTab.SCHEDULE, Icons.Rounded.CalendarMonth, "Schedule"),
    NavTabSpec(AppTab.LIVE, Icons.Rounded.Sensors, "Live", badgeCount = liveCount),
    NavTabSpec(AppTab.WATCH, Icons.Rounded.LiveTv, "Watch", badgeCount = watchCfbCount),
    NavTabSpec(AppTab.STANDINGS, Icons.Rounded.Leaderboard, "Standings"),
    NavTabSpec(AppTab.RANKINGS, Icons.Rounded.MilitaryTech, "Rankings"),
    NavTabSpec(AppTab.TEAMS, Icons.Rounded.Groups, "Teams"),
    NavTabSpec(AppTab.TRANSITIVE, Icons.Rounded.AccountTree, "Transitive")
  )

  Surface(
    color = MaterialTheme.colorScheme.surfaceContainerLow,
    tonalElevation = 2.dp
  ) {
    Column(modifier = Modifier.fillMaxWidth().navigationBarsPadding()) {
      HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
      Row(
        modifier = Modifier
          .fillMaxWidth()
          .horizontalScroll(rememberScrollState())
          .padding(horizontal = 4.dp, vertical = 6.dp),
        horizontalArrangement = Arrangement.SpaceEvenly,
        verticalAlignment = Alignment.CenterVertically
      ) {
        items.forEach { spec ->
          val selected = spec.tab == activeTab
          Column(
            modifier = Modifier
              .widthIn(min = 66.dp)
              .clip(RoundedCornerShape(12.dp))
              .clickable { onSelectTab(spec.tab) }
              .padding(horizontal = 6.dp, vertical = 4.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(2.dp)
          ) {
            BadgedBox(
              badge = {
                if (spec.badgeCount > 0) {
                  Badge(
                    containerColor = ext.live,
                    contentColor = Color.White
                  ) {
                    Text(spec.badgeCount.toString())
                  }
                }
              }
            ) {
              Box(
                modifier = Modifier
                  .width(48.dp)
                  .height(28.dp)
                  .clip(RoundedCornerShape(999.dp))
                  .background(
                    if (selected) MaterialTheme.colorScheme.secondaryContainer
                    else Color.Transparent
                  ),
                contentAlignment = Alignment.Center
              ) {
                Icon(
                  imageVector = spec.icon,
                  contentDescription = spec.tab.label,
                  modifier = Modifier.size(20.dp),
                  tint = if (selected) MaterialTheme.colorScheme.onSecondaryContainer
                  else MaterialTheme.colorScheme.onSurfaceVariant
                )
              }
            }
            Text(
              text = spec.shortLabel,
              style = MaterialTheme.typography.labelSmall,
              fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
              color = if (selected) MaterialTheme.colorScheme.onSurface
              else MaterialTheme.colorScheme.onSurfaceVariant,
              maxLines = 1
            )
          }
        }
      }
    }
  }
}
