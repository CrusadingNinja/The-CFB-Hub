package com.thecfbhub.app.ui.screens

import androidx.compose.foundation.BorderStroke
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.ArrowDropDown
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.thecfbhub.app.data.model.TeamPageData
import com.thecfbhub.app.data.model.TeamScheduleEvent
import com.thecfbhub.app.ui.components.EmptyStateCard
import com.thecfbhub.app.ui.components.ErrorStateCard
import com.thecfbhub.app.ui.components.LoadingStateBox
import com.thecfbhub.app.ui.components.RankBadge
import com.thecfbhub.app.ui.components.SegmentedOptionRow
import com.thecfbhub.app.ui.components.StatusPill
import com.thecfbhub.app.ui.components.TeamLogo
import com.thecfbhub.app.ui.components.parseHexColor
import com.thecfbhub.app.ui.state.AppUiState
import com.thecfbhub.app.ui.theme.CfbTheme
import com.thecfbhub.app.util.KickoffFormatter

private val TEAM_STAT_CHIPS = listOf(
  "all" to "All Stats",
  "passing" to "Passing",
  "rushing" to "Rushing",
  "receiving" to "Receiving",
  "defensive" to "Defense",
  "miscellaneous" to "Misc",
  "special" to "Special Teams",
  "scoring" to "Scoring"
)

@Composable
fun TeamsScreen(
  state: AppUiState,
  onSetDirectoryFilters: (String?, String?) -> Unit,
  onOpenTeam: (String, Int?, Boolean) -> Unit,
  onCloseTeam: () -> Unit,
  onBackToPreviousPage: () -> Unit,
  onSetTeamPageFilters: (String?, String?) -> Unit,
  onOpenGame: (String) -> Unit,
  onRetryDirectory: () -> Unit,
  onRetryTeamPage: () -> Unit
) {
  if (state.selectedTeamId != null) {
    TeamDetailContent(
      state = state,
      teamId = state.selectedTeamId,
      onCloseTeam = onCloseTeam,
      onBackToPreviousPage = onBackToPreviousPage,
      onChangeSeason = { yr -> onOpenTeam(state.selectedTeamId, yr, false) },
      onOpenOpponent = { oppId -> onOpenTeam(oppId, state.teamSelectedSeason, true) },
      onSetFilters = onSetTeamPageFilters,
      onOpenGame = onOpenGame,
      onRetry = onRetryTeamPage
    )
    return
  }

  var localQuery by remember { mutableStateOf("") }
  val combinedQ = (localQuery.ifBlank { state.searchQuery }).trim().lowercase()

  val filteredTeams = remember(
    state.teamsDirectory,
    state.teamsDivisionFilter,
    state.teamsConfFilter,
    combinedQ
  ) {
    state.teamsDirectory.filter { t ->
      if (state.teamsDivisionFilter != "all" && t.division != state.teamsDivisionFilter) return@filter false
      if (state.teamsConfFilter != "all" && t.conferenceId != state.teamsConfFilter) return@filter false
      if (combinedQ.isNotEmpty()) {
        val hay = "${t.displayName} ${t.shortName} ${t.abbreviation} ${t.conferenceName} ${t.conferenceShortName}".lowercase()
        if (!hay.contains(combinedQ)) return@filter false
      }
      true
    }
  }

  val confOptions = remember(state.teamsDirectory, state.teamsDivisionFilter) {
    state.teamsDirectory
      .filter {
        (state.teamsDivisionFilter == "all" || it.division == state.teamsDivisionFilter) &&
          it.conferenceId.isNotBlank() && it.conferenceShortName.isNotBlank()
      }
      .map { it.conferenceId to it.conferenceShortName }
      .distinctBy { it.first }
      .sortedBy { it.second }
  }

  LazyColumn(
    modifier = Modifier.fillMaxSize(),
    contentPadding = PaddingValues(12.dp),
    verticalArrangement = Arrangement.spacedBy(10.dp)
  ) {
    item(key = "teams-controls") {
      Card(
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow)
      ) {
        Column(
          modifier = Modifier
            .fillMaxWidth()
            .padding(12.dp),
          verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
          OutlinedTextField(
            value = localQuery,
            onValueChange = { localQuery = it },
            placeholder = { Text("Search any FBS, FCS, or college team...") },
            leadingIcon = { Icon(Icons.Rounded.Search, contentDescription = null) },
            singleLine = true,
            shape = RoundedCornerShape(12.dp),
            modifier = Modifier.fillMaxWidth()
          )
          Row(
            modifier = Modifier
              .fillMaxWidth()
              .horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically
          ) {
            SegmentedOptionRow(
              options = listOf("all" to "All (${state.teamsDirectory.size})", "FBS" to "FBS", "FCS" to "FCS"),
              selectedKey = state.teamsDivisionFilter,
              onSelect = { onSetDirectoryFilters(it, "all") }
            )
            var confMenuOpen by remember { mutableStateOf(false) }
            Box {
              OutlinedButton(
                onClick = { confMenuOpen = true },
                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp)
              ) {
                val confLabel = confOptions.firstOrNull { it.first == state.teamsConfFilter }?.second ?: "Conference"
                Text(confLabel, style = MaterialTheme.typography.labelSmall)
                Icon(Icons.Rounded.ArrowDropDown, contentDescription = null, modifier = Modifier.size(18.dp))
              }
              DropdownMenu(expanded = confMenuOpen, onDismissRequest = { confMenuOpen = false }) {
                DropdownMenuItem(
                  text = { Text("All Conferences") },
                  onClick = {
                    confMenuOpen = false
                    onSetDirectoryFilters(null, "all")
                  }
                )
                confOptions.forEach { (cid, cname) ->
                  DropdownMenuItem(
                    text = { Text(cname) },
                    onClick = {
                      confMenuOpen = false
                      onSetDirectoryFilters(null, cid)
                    }
                  )
                }
              }
            }
          }
        }
      }
    }

    if (state.teamsError != null && state.teamsDirectory.isEmpty()) {
      item { ErrorStateCard(message = state.teamsError, onRetry = onRetryDirectory) }
    } else if (state.teamsLoading && state.teamsDirectory.isEmpty()) {
      item { LoadingStateBox("Loading NCAA teams directory...") }
    } else if (filteredTeams.isEmpty()) {
      item {
        EmptyStateCard(
          title = "No teams matched",
          subtitle = "Try another school name or clear filters."
        )
      }
    } else {
      items(filteredTeams.take(250), key = { it.id }) { team ->
        Card(
          modifier = Modifier
            .fillMaxWidth()
            .clickable { onOpenTeam(team.id, null, false) },
          shape = RoundedCornerShape(14.dp),
          colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLowest),
          border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)
        ) {
          Row(
            modifier = Modifier
              .fillMaxWidth()
              .padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp)
          ) {
            TeamLogo(logoUrl = team.logo, abbreviation = team.abbreviation, colorHex = team.color, size = 38.dp)
            Column(modifier = Modifier.weight(1f)) {
              Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp)
              ) {
                RankBadge(team.rank)
                Text(
                  text = team.displayName,
                  style = MaterialTheme.typography.titleSmall,
                  fontWeight = FontWeight.Bold,
                  maxLines = 1,
                  overflow = TextOverflow.Ellipsis
                )
              }
              val sub = listOfNotNull(
                team.division.takeIf { it.isNotBlank() },
                team.conferenceShortName.takeIf { it.isNotBlank() },
                team.overallRecord.takeIf { it.isNotBlank() }
              ).joinToString(" · ")
              if (sub.isNotBlank()) {
                Text(
                  text = sub,
                  style = MaterialTheme.typography.bodySmall,
                  color = MaterialTheme.colorScheme.onSurfaceVariant,
                  maxLines = 1
                )
              }
            }
          }
        }
      }
    }
  }
}

@Composable
private fun TeamDetailContent(
  state: AppUiState,
  teamId: String,
  onCloseTeam: () -> Unit,
  onBackToPreviousPage: () -> Unit,
  onChangeSeason: (Int) -> Unit,
  onOpenOpponent: (String) -> Unit,
  onSetFilters: (String?, String?) -> Unit,
  onOpenGame: (String) -> Unit,
  onRetry: () -> Unit
) {
  val page: TeamPageData? = state.teamPageData?.takeIf { it.team.id == teamId }
  val backText = if (state.canGoBack) {
    if (state.backPageLabel.isNotBlank()) "Back to ${state.backPageLabel}" else "Back to Previous Page"
  } else {
    "All NCAA Teams"
  }

  LazyColumn(
    modifier = Modifier.fillMaxSize(),
    contentPadding = PaddingValues(12.dp),
    verticalArrangement = Arrangement.spacedBy(10.dp)
  ) {
    item(key = "team-top-actions") {
      Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
      ) {
        OutlinedButton(
          onClick = if (state.canGoBack) onBackToPreviousPage else onCloseTeam,
          contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp)
        ) {
          Icon(Icons.AutoMirrored.Rounded.ArrowBack, contentDescription = null, modifier = Modifier.size(16.dp))
          Spacer(Modifier.width(6.dp))
          Text(backText, style = MaterialTheme.typography.labelMedium)
        }
        SeasonPickerButton(
          selectedYear = state.teamSelectedSeason ?: state.currentSeasonYear,
          currentYear = state.currentSeasonYear,
          onSelect = onChangeSeason
        )
      }
    }

    if (state.teamPageError != null && page == null) {
      item { ErrorStateCard(message = state.teamPageError, onRetry = onRetry) }
    } else if (state.teamPageLoading && page == null) {
      item { LoadingStateBox("Loading team schedule and stats...") }
    } else if (page != null) {
      // Hero card
      item(key = "hero") {
        val teamColor = parseHexColor(page.team.color, MaterialTheme.colorScheme.primary)
        Card(
          shape = RoundedCornerShape(16.dp),
          colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLowest),
          border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)
        ) {
          Column(modifier = Modifier.fillMaxWidth()) {
            Box(
              modifier = Modifier
                .fillMaxWidth()
                .height(6.dp)
                .background(teamColor)
            )
            Column(
              modifier = Modifier.padding(14.dp),
              verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
              Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp)
              ) {
                TeamLogo(
                  logoUrl = page.team.logo,
                  abbreviation = page.team.abbreviation,
                  colorHex = page.team.color,
                  size = 54.dp
                )
                Column(modifier = Modifier.weight(1f)) {
                  Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                  ) {
                    RankBadge(page.team.rank)
                    Text(
                      text = page.team.displayName,
                      style = MaterialTheme.typography.titleLarge,
                      fontWeight = FontWeight.Bold
                    )
                  }
                  val sub = listOfNotNull(
                    page.team.division.takeIf { it.isNotBlank() },
                    page.team.conferenceShortName.takeIf { it.isNotBlank() },
                    page.team.standingSummary.takeIf { it.isNotBlank() }
                  ).joinToString(" · ")
                  if (sub.isNotBlank()) {
                    Text(
                      text = sub,
                      style = MaterialTheme.typography.bodySmall,
                      color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                  }
                }
              }

              Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
              ) {
                StatSummaryMini("Record", page.seasonSummary.record, "${page.seasonSummary.confRecord} Conf", Modifier.weight(1f))
                StatSummaryMini("PPG / OPP", "${page.seasonSummary.ppg} / ${page.seasonSummary.oppPpg}", "Diff ${page.seasonSummary.pointDiffDisplay}", Modifier.weight(1f))
                StatSummaryMini("Streak", page.seasonSummary.streak, "H ${page.seasonSummary.homeRecord}", Modifier.weight(1f))
              }
            }
          }
        }
      }

      // Schedule filter + rows
      val pastCount = page.events.count { it.isPast || it.isLive }
      val futureCount = page.events.count { it.isFuture }
      val filteredSched = page.events.filter {
        when (state.teamScheduleFilter) {
          "past" -> it.isPast || it.isLive
          "future" -> it.isFuture
          else -> true
        }
      }

      item(key = "sched-hdr") {
        Card(
          shape = RoundedCornerShape(16.dp),
          colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLowest),
          border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)
        ) {
          Column(modifier = Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
              text = "${page.seasonYear} Season Schedule",
              style = MaterialTheme.typography.titleMedium,
              fontWeight = FontWeight.Bold
            )
            SegmentedOptionRow(
              options = listOf(
                "all" to "All (${page.events.size})",
                "past" to "Played ($pastCount)",
                "future" to "Upcoming ($futureCount)"
              ),
              selectedKey = state.teamScheduleFilter,
              onSelect = { onSetFilters(it, null) }
            )
          }
        }
      }

      if (filteredSched.isEmpty()) {
        item {
          EmptyStateCard(
            title = "No games in this filter",
            subtitle = "Switch schedule filters or choose another season."
          )
        }
      } else {
        items(filteredSched, key = { "ts-${it.event.id}" }) { row ->
          TeamScheduleRowCard(
            row = row,
            onOpenOpponent = onOpenOpponent,
            onOpenGame = { onOpenGame(row.event.id) }
          )
        }
      }

      // Statistics section
      val stats = page.stats
      if (stats != null && stats.categories.isNotEmpty()) {
        item(key = "stats-hdr") {
          Card(
            shape = RoundedCornerShape(16.dp),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLowest),
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)
          ) {
            Column(
              modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
              verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
              Text(
                text = "Team Season Statistics",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold
              )
              Row(
                modifier = Modifier.horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(6.dp)
              ) {
                TEAM_STAT_CHIPS.forEach { (key, label) ->
                  FilterChip(
                    selected = state.teamStatsCategory == key,
                    onClick = { onSetFilters(null, key) },
                    label = { Text(label, style = MaterialTheme.typography.labelSmall) }
                  )
                }
              }
              val cats = if (state.teamStatsCategory == "all") {
                stats.categories
              } else {
                stats.categories.filter { it.groupKey == state.teamStatsCategory }
              }
              cats.forEach { cat ->
                Text(
                  text = cat.displayName,
                  style = MaterialTheme.typography.labelLarge,
                  color = MaterialTheme.colorScheme.primary,
                  fontWeight = FontWeight.Bold,
                  modifier = Modifier.padding(top = 6.dp)
                )
                cat.items.forEachIndexed { idx, item ->
                  Row(
                    modifier = Modifier
                      .fillMaxWidth()
                      .padding(vertical = 4.dp),
                    horizontalArrangement = Arrangement.SpaceBetween
                  ) {
                    Text(
                      text = item.label,
                      style = MaterialTheme.typography.bodySmall,
                      color = MaterialTheme.colorScheme.onSurfaceVariant,
                      modifier = Modifier.weight(1f)
                    )
                    Text(
                      text = item.teamValue,
                      style = MaterialTheme.typography.bodySmall,
                      fontWeight = FontWeight.Bold
                    )
                    if (!item.oppValue.isNullOrBlank()) {
                      Spacer(Modifier.width(10.dp))
                      Text(
                        text = "Opp ${item.oppValue}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                      )
                    }
                  }
                  if (idx < cat.items.lastIndex) {
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.25f))
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}

@Composable
private fun StatSummaryMini(title: String, value: String, subtitle: String, modifier: Modifier = Modifier) {
  Surface(
    modifier = modifier,
    shape = RoundedCornerShape(12.dp),
    color = MaterialTheme.colorScheme.surfaceContainerLow
  ) {
    Column(modifier = Modifier.padding(10.dp)) {
      Text(title, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
      Text(value, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, maxLines = 1)
      Text(subtitle, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
    }
  }
}

@Composable
private fun TeamScheduleRowCard(
  row: TeamScheduleEvent,
  onOpenOpponent: (String) -> Unit,
  onOpenGame: () -> Unit
) {
  val ext = CfbTheme.extended
  val ev = row.event
  val opp = row.opponent
  val canClickOpp = opp.id.isNotBlank() && opp.id != "-1" && opp.id != "-2"
  val dateHeading = KickoffFormatter.formatDayHeading(ev.date, ev.timeValid)
  val weekLabel = if (ev.seasonTypeId == "3") ev.weekText.ifBlank { "Postseason" } else ev.weekText

  Card(
    modifier = Modifier
      .fillMaxWidth()
      .clickable(onClick = onOpenGame),
    shape = RoundedCornerShape(14.dp),
    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLowest),
    border = BorderStroke(
      if (row.isLive) 1.5.dp else 1.dp,
      if (row.isLive) ext.live else MaterialTheme.colorScheme.outlineVariant
    )
  ) {
    Row(
      modifier = Modifier
        .fillMaxWidth()
        .padding(12.dp),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.SpaceBetween
    ) {
      Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(
          text = listOf(weekLabel, dateHeading).filter { it.isNotBlank() }.joinToString(" · "),
          style = MaterialTheme.typography.labelSmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Row(
          modifier = Modifier
            .clip(RoundedCornerShape(8.dp))
            .then(if (canClickOpp) Modifier.clickable { onOpenOpponent(opp.id) } else Modifier)
            .padding(vertical = 2.dp),
          verticalAlignment = Alignment.CenterVertically,
          horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
          Text(
            text = row.venuePrefix,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
          )
          TeamLogo(logoUrl = opp.logo, abbreviation = opp.abbreviation, colorHex = opp.color, size = 26.dp)
          RankBadge(opp.rank)
          Text(
            text = opp.displayName,
            style = MaterialTheme.typography.titleSmall,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
          )
        }
      }

      Spacer(Modifier.width(8.dp))
      Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        when {
          row.isLive -> {
            StatusPill(text = ev.statusDetail.ifBlank { "LIVE" }, state = "in")
            Text(
              text = "${row.teamComp.score.ifBlank { "0" }} - ${opp.score.ifBlank { "0" }}",
              style = MaterialTheme.typography.titleSmall,
              fontWeight = FontWeight.Bold
            )
          }
          row.isPast -> {
            val resBg = when (row.result) {
              "W" -> ext.winContainer
              "L" -> MaterialTheme.colorScheme.errorContainer
              else -> MaterialTheme.colorScheme.surfaceContainerHighest
            }
            val resFg = when (row.result) {
              "W" -> ext.onWinContainer
              "L" -> MaterialTheme.colorScheme.onErrorContainer
              else -> MaterialTheme.colorScheme.onSurfaceVariant
            }
            Row(
              verticalAlignment = Alignment.CenterVertically,
              horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
              if (row.result.isNotBlank()) {
                Surface(shape = RoundedCornerShape(6.dp), color = resBg, contentColor = resFg) {
                  Text(
                    text = row.result,
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.ExtraBold,
                    modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                  )
                }
              }
              Text(
                text = "${row.teamComp.score.ifBlank { "0" }} - ${opp.score.ifBlank { "0" }}",
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.Bold
              )
            }
          }
          else -> {
            val kickoff = KickoffFormatter.formatEventKickoff(
              isoDate = ev.date,
              timeValid = ev.timeValid,
              statusDetail = ev.statusDetail,
              flexTimeSlot = ev.flexTimeSlot
            )
            StatusPill(text = kickoff, state = "pre")
            if (ev.broadcast.isNotBlank()) {
              Text(
                text = ev.broadcast,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
              )
            }
          }
        }
      }
    }
  }
}
