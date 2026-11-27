package com.thecfbhub.app.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.thecfbhub.app.data.model.ConferenceStandings
import com.thecfbhub.app.data.model.StandingTeamRow
import com.thecfbhub.app.ui.components.EmptyStateCard
import com.thecfbhub.app.ui.components.ErrorStateCard
import com.thecfbhub.app.ui.components.LoadingStateBox
import com.thecfbhub.app.ui.components.RankBadge
import com.thecfbhub.app.ui.components.TeamLogo
import com.thecfbhub.app.ui.state.AppUiState
import com.thecfbhub.app.ui.theme.CfbTheme

@Composable
fun StandingsScreen(
  state: AppUiState,
  onSelectConference: (String) -> Unit,
  onOpenTeam: (String) -> Unit,
  onRetry: () -> Unit
) {
  val q = state.searchQuery.trim().lowercase()
  val visibleConferences = remember(state.conferences, state.selectedConferenceId, state.searchQuery) {
    val base = if (q.isNotEmpty()) {
      state.conferences.mapNotNull { conf ->
        val filteredGroups = conf.groups.mapNotNull { grp ->
          val entries = grp.entries.filter {
            "${it.name} ${it.shortName} ${it.abbreviation} ${conf.name}".lowercase().contains(q)
          }
          if (entries.isEmpty()) null else grp.copy(entries = entries)
        }
        if (filteredGroups.isEmpty()) null else conf.copy(groups = filteredGroups)
      }
    } else if (state.selectedConferenceId == "all") {
      state.conferences
    } else {
      val selected = state.conferences.firstOrNull { it.id == state.selectedConferenceId }
      if (selected != null) listOf(selected) else state.conferences.take(1)
    }
    base
  }

  LazyColumn(
    modifier = Modifier.fillMaxSize(),
    contentPadding = PaddingValues(12.dp),
    verticalArrangement = Arrangement.spacedBy(10.dp)
  ) {
    if (state.conferences.isNotEmpty()) {
      item(key = "conf-pills") {
        LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
          item(key = "all") {
            FilterChip(
              selected = state.selectedConferenceId == "all",
              onClick = { onSelectConference("all") },
              label = { Text("All (${state.conferences.size})", style = MaterialTheme.typography.labelSmall) }
            )
          }
          items(state.conferences, key = { it.id }) { conf ->
            FilterChip(
              selected = state.selectedConferenceId == conf.id,
              onClick = { onSelectConference(conf.id) },
              label = { Text(conf.shortName, style = MaterialTheme.typography.labelSmall) }
            )
          }
        }
      }
    }

    if (state.standingsError != null && state.conferences.isEmpty()) {
      item { ErrorStateCard(message = state.standingsError, onRetry = onRetry) }
    } else if (state.standingsLoading && state.conferences.isEmpty()) {
      item { LoadingStateBox("Loading FBS conference standings...") }
    } else if (visibleConferences.isEmpty()) {
      item {
        EmptyStateCard(
          title = "No standings rows matched",
          subtitle = "Clear your search filter or choose another conference."
        )
      }
    } else {
      items(visibleConferences, key = { it.id }) { conf ->
        ConferenceStandingsCard(conf = conf, pollName = state.standingsPollName, onOpenTeam = onOpenTeam)
      }
    }
  }
}

@Composable
private fun ConferenceStandingsCard(
  conf: ConferenceStandings,
  pollName: String,
  onOpenTeam: (String) -> Unit
) {
  Card(
    shape = RoundedCornerShape(16.dp),
    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLowest),
    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)
  ) {
    Column(modifier = Modifier.fillMaxWidth()) {
      Row(
        modifier = Modifier
          .fillMaxWidth()
          .padding(horizontal = 14.dp, vertical = 12.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
      ) {
        Text(
          text = conf.name,
          style = MaterialTheme.typography.titleMedium,
          fontWeight = FontWeight.Bold,
          modifier = Modifier.weight(1f)
        )
        Text(
          text = pollName,
          style = MaterialTheme.typography.labelSmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant
        )
      }

      conf.groups.forEach { grp ->
        if (!grp.name.isNullOrBlank()) {
          Text(
            text = grp.name,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.primary,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 4.dp)
          )
        }
        // Table Header
        Row(
          modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 6.dp),
          verticalAlignment = Alignment.CenterVertically
        ) {
          Text("#", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.width(24.dp))
          Text("Team", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
          Text("CONF", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.End, modifier = Modifier.width(46.dp))
          Text("OVR", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.End, modifier = Modifier.width(46.dp))
          Text("DIFF", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.End, modifier = Modifier.width(46.dp))
          Text("STRK", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.End, modifier = Modifier.width(40.dp))
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))

        grp.entries.forEachIndexed { idx, row ->
          StandingEntryRow(row = row, displayPos = idx + 1, onClick = { onOpenTeam(row.teamId) })
          if (idx < grp.entries.lastIndex) {
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.35f))
          }
        }
      }
    }
  }
}

@Composable
private fun StandingEntryRow(
  row: StandingTeamRow,
  displayPos: Int,
  onClick: () -> Unit
) {
  val ext = CfbTheme.extended
  val diffColor = when {
    row.pointDiff > 0 -> ext.win
    row.pointDiff < 0 -> MaterialTheme.colorScheme.error
    else -> MaterialTheme.colorScheme.onSurfaceVariant
  }

  Row(
    modifier = Modifier
      .fillMaxWidth()
      .clickable(onClick = onClick)
      .padding(horizontal = 12.dp, vertical = 10.dp),
    verticalAlignment = Alignment.CenterVertically
  ) {
    Text(
      text = if (row.seed < 999) row.seedDisplay else displayPos.toString(),
      style = MaterialTheme.typography.labelMedium,
      fontWeight = FontWeight.Bold,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
      modifier = Modifier.width(24.dp)
    )
    Row(
      modifier = Modifier.weight(1f),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
      TeamLogo(logoUrl = row.logo, abbreviation = row.abbreviation, size = 26.dp)
      Column(modifier = Modifier.weight(1f)) {
        Row(
          verticalAlignment = Alignment.CenterVertically,
          horizontalArrangement = Arrangement.spacedBy(5.dp)
        ) {
          RankBadge(row.rank)
          Text(
            text = row.shortName,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
          )
        }
      }
    }
    Text(
      text = row.confRecord,
      style = MaterialTheme.typography.bodySmall,
      fontWeight = FontWeight.SemiBold,
      textAlign = TextAlign.End,
      modifier = Modifier.width(46.dp)
    )
    Text(
      text = row.overallRecord,
      style = MaterialTheme.typography.bodySmall,
      textAlign = TextAlign.End,
      modifier = Modifier.width(46.dp)
    )
    Text(
      text = row.pointDiffDisplay,
      style = MaterialTheme.typography.bodySmall,
      color = diffColor,
      fontWeight = FontWeight.SemiBold,
      textAlign = TextAlign.End,
      modifier = Modifier.width(46.dp)
    )
    Text(
      text = row.streak,
      style = MaterialTheme.typography.bodySmall,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
      textAlign = TextAlign.End,
      modifier = Modifier.width(40.dp)
    )
  }
}
