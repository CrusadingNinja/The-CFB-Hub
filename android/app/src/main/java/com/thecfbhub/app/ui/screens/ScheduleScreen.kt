package com.thecfbhub.app.ui.screens

import androidx.compose.foundation.BorderStroke
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ArrowDropDown
import androidx.compose.material.icons.rounded.Today
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.thecfbhub.app.data.model.GameEvent
import com.thecfbhub.app.data.remote.EspnJsonParser
import com.thecfbhub.app.ui.components.EmptyStateCard
import com.thecfbhub.app.ui.components.ErrorStateCard
import com.thecfbhub.app.ui.components.GameCard
import com.thecfbhub.app.ui.components.LoadingStateBox
import com.thecfbhub.app.ui.components.SectionHeader
import com.thecfbhub.app.ui.components.SegmentedOptionRow
import com.thecfbhub.app.ui.state.AppUiState
import com.thecfbhub.app.util.KickoffFormatter

private val POWER_4_IDS = setOf("1", "4", "5", "8")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ScheduleScreen(
  state: AppUiState,
  onChangeGroup: (String) -> Unit,
  onChangeSeasonType: (String) -> Unit,
  onSelectWeek: (String) -> Unit,
  onJumpCurrentWeek: () -> Unit,
  onSetFilters: (String?, Boolean?, String?) -> Unit,
  onRefresh: () -> Unit,
  onOpenGame: (GameEvent) -> Unit,
  onOpenTeam: (String) -> Unit,
  onOpenWatch: (GameEvent) -> Unit
) {
  val weeks = if (state.scheduleSeasonType == "3") state.calendar.postseason else state.calendar.regular
  val isAtCurrentWeek = state.scheduleSeasonType == state.currentSeasonType &&
    state.scheduleSelectedWeek == state.currentWeekNumber

  val q = state.searchQuery.trim().lowercase()
  val filtered = remember(
    state.scoreboardEvents,
    state.scheduleStatusFilter,
    state.top25Only,
    state.scheduleConferenceFilter,
    state.searchQuery,
    state.conferenceMap
  ) {
    state.scoreboardEvents.filter { ev ->
      if (state.scheduleStatusFilter != "all" && ev.state != state.scheduleStatusFilter) return@filter false
      if (state.top25Only && ev.away.rank == null && ev.home.rank == null) return@filter false
      when (state.scheduleConferenceFilter) {
        "all" -> Unit
        "power4" -> {
          if (!POWER_4_IDS.contains(ev.away.conferenceId) && !POWER_4_IDS.contains(ev.home.conferenceId)) {
            return@filter false
          }
        }
        else -> {
          val cid = state.scheduleConferenceFilter
          if (ev.away.conferenceId != cid && ev.home.conferenceId != cid) return@filter false
        }
      }
      if (q.isNotEmpty()) {
        val awayConf = state.conferenceMap[ev.away.conferenceId]?.shortName.orEmpty()
        val homeConf = state.conferenceMap[ev.home.conferenceId]?.shortName.orEmpty()
        val hay = listOf(
          ev.name, ev.shortName, ev.away.displayName, ev.away.abbreviation,
          ev.home.displayName, ev.home.abbreviation, ev.headline, ev.flexTimeSlot,
          ev.broadcast, awayConf, homeConf
        ).joinToString(" ").lowercase()
        if (!hay.contains(q)) return@filter false
      }
      true
    }
  }

  val liveGames = remember(filtered) { filtered.filter { it.state == "in" } }
  val groupedByDay = remember(filtered) {
    val map = LinkedHashMap<String, Pair<String, MutableList<GameEvent>>>()
    filtered.filter { it.state != "in" }.forEach { ev ->
      val key = KickoffFormatter.getLocalDateKey(ev.date, ev.timeValid)
      val entry = map.getOrPut(key) {
        KickoffFormatter.formatDayHeading(ev.date, ev.timeValid) to mutableListOf()
      }
      entry.second.add(ev)
    }
    map.entries.map { Triple(it.key, it.value.first, it.value.second.toList()) }
  }

  val liveCountAll = remember(state.scoreboardEvents) { state.scoreboardEvents.count { it.state == "in" } }
  val preCountAll = remember(state.scoreboardEvents) { state.scoreboardEvents.count { it.state == "pre" } }
  val postCountAll = remember(state.scoreboardEvents) { state.scoreboardEvents.count { it.state == "post" } }

  PullToRefreshBox(
    isRefreshing = state.isRefreshingManual,
    onRefresh = onRefresh,
    modifier = Modifier.fillMaxSize()
  ) {
    LazyColumn(
      modifier = Modifier.fillMaxSize(),
      contentPadding = PaddingValues(12.dp),
      verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
      // Controls card
      item(key = "controls") {
        Card(
          shape = RoundedCornerShape(16.dp),
          colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow)
        ) {
          Column(
            modifier = Modifier
              .fillMaxWidth()
              .padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
          ) {
            Row(
              modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState()),
              horizontalArrangement = Arrangement.spacedBy(8.dp),
              verticalAlignment = Alignment.CenterVertically
            ) {
              SegmentedOptionRow(
                options = listOf("80" to "FBS", "81" to "FCS"),
                selectedKey = state.scheduleGroup,
                onSelect = onChangeGroup
              )
              SegmentedOptionRow(
                options = listOf("2" to "Regular", "3" to "Postseason"),
                selectedKey = state.scheduleSeasonType,
                onSelect = onChangeSeasonType
              )
              if (!isAtCurrentWeek && !state.currentWeekNumber.isNullOrEmpty()) {
                FilledTonalButton(
                  onClick = onJumpCurrentWeek,
                  contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp)
                ) {
                  Icon(Icons.Rounded.Today, contentDescription = null, modifier = Modifier.size(16.dp))
                  Spacer(Modifier.width(4.dp))
                  Text("Current Week", style = MaterialTheme.typography.labelMedium)
                }
              }
            }

            if (weeks.isNotEmpty()) {
              LazyRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp)
              ) {
                items(weeks, key = { it.value }) { wk ->
                  val active = wk.value == state.scheduleSelectedWeek
                  Surface(
                    modifier = Modifier
                      .clip(RoundedCornerShape(12.dp))
                      .clickable { onSelectWeek(wk.value) },
                    shape = RoundedCornerShape(12.dp),
                    color = if (active) MaterialTheme.colorScheme.primaryContainer
                    else MaterialTheme.colorScheme.surfaceContainerLowest,
                    border = BorderStroke(
                      1.dp,
                      if (active) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant
                    )
                  ) {
                    Column(
                      modifier = Modifier.padding(horizontal = 12.dp, vertical = 7.dp),
                      horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                      Text(
                        text = wk.label,
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.Bold,
                        color = if (active) MaterialTheme.colorScheme.onPrimaryContainer
                        else MaterialTheme.colorScheme.onSurface
                      )
                      if (wk.detail.isNotBlank()) {
                        Text(
                          text = wk.detail,
                          style = MaterialTheme.typography.labelSmall,
                          color = if (active) MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.85f)
                          else MaterialTheme.colorScheme.onSurfaceVariant
                        )
                      }
                    }
                  }
                }
              }
            }

            // Filter chips + Conference dropdown
            Row(
              modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState()),
              horizontalArrangement = Arrangement.spacedBy(6.dp),
              verticalAlignment = Alignment.CenterVertically
            ) {
              listOf(
                "all" to "All (${state.scoreboardEvents.size})",
                "in" to "Live ($liveCountAll)",
                "pre" to "Upcoming ($preCountAll)",
                "post" to "Final ($postCountAll)"
              ).forEach { (key, label) ->
                FilterChip(
                  selected = state.scheduleStatusFilter == key,
                  onClick = { onSetFilters(key, null, null) },
                  label = { Text(label, style = MaterialTheme.typography.labelSmall) }
                )
              }
              FilterChip(
                selected = state.top25Only,
                onClick = { onSetFilters(null, !state.top25Only, null) },
                label = { Text("Top 25", style = MaterialTheme.typography.labelSmall) }
              )

              ConferenceFilterDropdown(
                selectedId = state.scheduleConferenceFilter,
                conferences = state.conferences.map { it.id to it.shortName },
                onSelect = { onSetFilters(null, null, it) }
              )
            }
          }
        }
      }

      if (state.scoreboardError != null && state.scoreboardEvents.isEmpty()) {
        item(key = "error") {
          ErrorStateCard(
            message = state.scoreboardError,
            onRetry = onRefresh
          )
        }
      } else if (state.scoreboardLoading && state.scoreboardEvents.isEmpty()) {
        item(key = "loading") {
          LoadingStateBox("Loading ESPN college football scoreboard...")
        }
      } else if (filtered.isEmpty()) {
        item(key = "empty") {
          EmptyStateCard(
            title = "No matchups matched your filters",
            subtitle = "Try another week, clear the search query, or switch conferences."
          )
        }
      } else {
        if (liveGames.isNotEmpty()) {
          item(key = "hdr-live") {
            SectionHeader(
              title = "Live Right Now",
              trailing = "${liveGames.size} in progress",
              isLiveAccent = true
            )
          }
          items(liveGames, key = { "live-${it.id}" }) { ev ->
            val matched = remember(ev.id, state.watchSource, state.ppvCatalog, state.tvAppCatalog, state.strmFreeCatalog) {
              EspnJsonParser.findStreamForEvent(
                ev,
                state.watchSource,
                state.ppvCatalog.streams,
                state.tvAppCatalog.streams,
                state.strmFreeCatalog.streams
              ) != null
            }
            GameCard(
              event = ev,
              hasMatchedStream = matched,
              onOpenGame = { onOpenGame(ev) },
              onOpenTeam = onOpenTeam,
              onOpenWatch = { onOpenWatch(ev) }
            )
          }
        }

        groupedByDay.forEach { (dateKey, heading, games) ->
          item(key = "hdr-$dateKey") {
            SectionHeader(
              title = heading,
              trailing = "${games.size} game${if (games.size == 1) "" else "s"}"
            )
          }
          items(games, key = { "game-$dateKey-${it.id}" }) { ev ->
            GameCard(
              event = ev,
              hasMatchedStream = false,
              onOpenGame = { onOpenGame(ev) },
              onOpenTeam = onOpenTeam,
              onOpenWatch = { onOpenWatch(ev) }
            )
          }
        }
      }
    }
  }
}

@Composable
private fun ConferenceFilterDropdown(
  selectedId: String,
  conferences: List<Pair<String, String>>,
  onSelect: (String) -> Unit
) {
  var expanded by remember { mutableStateOf(false) }
  val label = when (selectedId) {
    "all" -> "All Conferences"
    "power4" -> "Power 4"
    else -> conferences.firstOrNull { it.first == selectedId }?.second ?: "Conference"
  }

  Box {
    OutlinedButton(
      onClick = { expanded = true },
      contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp)
    ) {
      Text(label, style = MaterialTheme.typography.labelSmall)
      Icon(Icons.Rounded.ArrowDropDown, contentDescription = null, modifier = Modifier.size(18.dp))
    }
    DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
      DropdownMenuItem(
        text = { Text("All Conferences") },
        onClick = {
          expanded = false
          onSelect("all")
        }
      )
      DropdownMenuItem(
        text = { Text("Power 4 (SEC, B1G, ACC, B12)") },
        onClick = {
          expanded = false
          onSelect("power4")
        }
      )
      conferences.forEach { (id, name) ->
        DropdownMenuItem(
          text = { Text(name) },
          onClick = {
            expanded = false
            onSelect(id)
          }
        )
      }
    }
  }
}
