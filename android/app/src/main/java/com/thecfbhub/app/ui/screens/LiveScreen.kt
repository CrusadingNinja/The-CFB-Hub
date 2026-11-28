package com.thecfbhub.app.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
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

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LiveScreen(
  state: AppUiState,
  onChangeDivision: (String) -> Unit,
  onRefresh: () -> Unit,
  onOpenGame: (GameEvent) -> Unit,
  onOpenTeam: (String) -> Unit,
  onOpenWatch: (GameEvent) -> Unit
) {
  val q = state.searchQuery.trim().lowercase()
  val filtered = remember(state.liveEvents, state.searchQuery) {
    if (q.isEmpty()) state.liveEvents
    else state.liveEvents.filter { ev ->
      "${ev.name} ${ev.shortName} ${ev.away.displayName} ${ev.home.displayName}".lowercase().contains(q)
    }
  }

  val liveNow = remember(filtered) { filtered.filter { it.state == "in" } }
  val upcoming = remember(filtered) { filtered.filter { it.state == "pre" } }
  val finals = remember(filtered) { filtered.filter { it.state == "post" } }

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
      item(key = "live-header") {
        Card(
          shape = RoundedCornerShape(16.dp),
          colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow)
        ) {
          Row(
            modifier = Modifier
              .fillMaxWidth()
              .padding(12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
          ) {
            Column(modifier = Modifier.weight(1f)) {
              Text(
                text = "Live & Play-by-Play",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold
              )
              Text(
                text = "${liveNow.size} live · ${upcoming.size} upcoming · Tap any game for full PBP",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
              )
            }
            SegmentedOptionRow(
              options = listOf("80" to "FBS", "81" to "FCS"),
              selectedKey = state.liveDivision,
              onSelect = onChangeDivision
            )
          }
        }
      }

      if (state.liveError != null && state.liveEvents.isEmpty()) {
        item {
          ErrorStateCard(message = state.liveError, onRetry = onRefresh)
        }
      } else if (state.liveLoading && state.liveEvents.isEmpty()) {
        item {
          LoadingStateBox("Loading live college football slate...")
        }
      } else if (filtered.isEmpty()) {
        item {
          EmptyStateCard(
            title = "No active games found",
            subtitle = "Switch between FBS and FCS or clear your search filter."
          )
        }
      } else {
        if (liveNow.isNotEmpty()) {
          item {
            SectionHeader(
              title = "In Progress",
              trailing = "${liveNow.size} live",
              isLiveAccent = true
            )
          }
          items(liveNow, key = { "live-in-${it.id}" }) { ev ->
            val matched = EspnJsonParser.findStreamForEvent(
              ev,
              state.watchSource,
              state.ppvCatalog.streams,
              state.timStreamsCatalog.streams,
              state.strmFreeCatalog.streams
            ) != null
            GameCard(
              event = ev,
              hasMatchedStream = matched,
              onOpenGame = { onOpenGame(ev) },
              onOpenTeam = onOpenTeam,
              onOpenWatch = { onOpenWatch(ev) }
            )
          }
        } else {
          item {
            EmptyStateCard(
              title = "No games currently live in ${if (state.liveDivision == "81") "FCS" else "FBS"}",
              subtitle = "Live games appear automatically during kickoff windows."
            )
          }
        }

        if (upcoming.isNotEmpty()) {
          item {
            SectionHeader(title = "Upcoming Slate", trailing = "${upcoming.size} games")
          }
          items(upcoming, key = { "live-pre-${it.id}" }) { ev ->
            val labelOverride = if (KickoffFormatter.isKickoffTimeTbd(ev.date, ev.timeValid, ev.statusDetail)) {
              ev.flexTimeSlot.ifBlank { "TBD" }
            } else {
              val t = KickoffFormatter.formatKickoffTime(ev.date)
              val cd = KickoffFormatter.formatCountdown(ev.date)
              if (cd.isNotBlank()) "$t · $cd" else t
            }
            val displayEvent = if (ev.timeValid) ev.copy(timeValid = false, flexTimeSlot = labelOverride) else ev
            GameCard(
              event = displayEvent,
              hasMatchedStream = false,
              onOpenGame = { onOpenGame(ev) },
              onOpenTeam = onOpenTeam,
              onOpenWatch = { onOpenWatch(ev) }
            )
          }
        }

        if (finals.isNotEmpty()) {
          item {
            SectionHeader(title = "Completed", trailing = "${finals.size} final")
          }
          items(finals, key = { "live-post-${it.id}" }) { ev ->
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
