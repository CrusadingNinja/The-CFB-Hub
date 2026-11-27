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
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.thecfbhub.app.data.model.RankedTeamRow
import com.thecfbhub.app.data.model.RankingPoll
import com.thecfbhub.app.ui.components.EmptyStateCard
import com.thecfbhub.app.ui.components.ErrorStateCard
import com.thecfbhub.app.ui.components.LoadingStateBox
import com.thecfbhub.app.ui.components.SegmentedOptionRow
import com.thecfbhub.app.ui.components.TeamLogo
import com.thecfbhub.app.ui.state.AppUiState
import com.thecfbhub.app.ui.theme.CfbTheme
import com.thecfbhub.app.util.CfpPlayoffHelper
import com.thecfbhub.app.util.CfpPlayoffInfo

@Composable
fun RankingsScreen(
  state: AppUiState,
  onSelectPollTab: (String) -> Unit,
  onChangeSeason: (Int) -> Unit,
  onSelectWeek: (String, String) -> Unit,
  onJumpLatest: () -> Unit,
  onSetConfFilter: (String) -> Unit,
  onOpenTeam: (String) -> Unit,
  onRetry: () -> Unit
) {
  val data = state.rankingsData
  val cfpPoll = data?.cfpPoll
  val apPoll = data?.apPoll
  val activePollKey = when {
    state.rankingsPollTab == "cfp" && cfpPoll != null -> "cfp"
    state.rankingsPollTab == "ap" && apPoll != null -> "ap"
    cfpPoll != null -> "cfp"
    apPoll != null -> "ap"
    else -> state.rankingsPollTab
  }
  val activePoll: RankingPoll? = if (activePollKey == "cfp") cfpPoll else apPoll
  val isCfp = activePollKey == "cfp"
  val cfpInfo: CfpPlayoffInfo? = remember(activePoll, isCfp, state.teamsDirectory) {
    if (isCfp && activePoll != null) {
      CfpPlayoffHelper.computeCfpPlayoffInfo(
        allRanks = activePoll.ranks,
        committeeUnrankedG6 = activePoll.committeeUnrankedG6,
        droppedOut = activePoll.droppedOut,
        others = activePoll.others,
        teamsDirectory = state.teamsDirectory
      )
    } else null
  }
  val showCutline = isCfp &&
    cfpInfo != null &&
    state.rankingsConfFilter == "all" &&
    state.searchQuery.isBlank()

  val q = state.searchQuery.trim().lowercase()
  val filteredRanks = remember(activePoll, state.rankingsConfFilter, state.searchQuery) {
    (activePoll?.ranks ?: emptyList()).filter { row ->
      if (state.rankingsConfFilter != "all" && row.conferenceId != state.rankingsConfFilter) {
        return@filter false
      }
      if (q.isNotEmpty()) {
        val hay = "${row.displayName} ${row.shortName} ${row.abbreviation} ${row.conferenceShortName}".lowercase()
        if (!hay.contains(q)) return@filter false
      }
      true
    }
  }

  val confOptions = remember(activePoll) {
    (activePoll?.ranks ?: emptyList())
      .mapNotNull { r ->
        val cid = r.conferenceId
        val cname = r.conferenceShortName
        if (cid != null && cname.isNotBlank()) cid to cname else null
      }
      .distinctBy { it.first }
      .sortedBy { it.second }
  }

  LazyColumn(
    modifier = Modifier.fillMaxSize(),
    contentPadding = PaddingValues(12.dp),
    verticalArrangement = Arrangement.spacedBy(10.dp)
  ) {
    // Controls Card
    item(key = "rankings-controls") {
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
            val pollOpts = buildList {
              if (cfpPoll != null || apPoll == null) add("cfp" to "CFP Top 25")
              if (apPoll != null || cfpPoll == null) add("ap" to "AP Top 25")
            }
            if (pollOpts.size > 1) {
              SegmentedOptionRow(
                options = pollOpts,
                selectedKey = activePollKey,
                onSelect = onSelectPollTab
              )
            } else {
              Surface(
                shape = RoundedCornerShape(999.dp),
                color = MaterialTheme.colorScheme.secondaryContainer
              ) {
                Text(
                  text = activePoll?.shortName ?: "Top 25 Rankings",
                  style = MaterialTheme.typography.labelMedium,
                  fontWeight = FontWeight.Bold,
                  color = MaterialTheme.colorScheme.onSecondaryContainer,
                  modifier = Modifier.padding(horizontal = 12.dp, vertical = 7.dp)
                )
              }
            }

            SeasonPickerButton(
              selectedYear = state.rankingsSeason ?: state.currentSeasonYear,
              currentYear = state.currentSeasonYear,
              onSelect = onChangeSeason
            )

            if (data != null && data.weeks.isNotEmpty() && data.activeWeekKey != data.weeks.last().key) {
              FilledTonalButton(
                onClick = onJumpLatest,
                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp)
              ) {
                Text("Latest Poll", style = MaterialTheme.typography.labelSmall)
              }
            }
          }

          if (data != null && data.weeks.isNotEmpty()) {
            LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
              items(data.weeks, key = { it.key }) { wk ->
                FilterChip(
                  selected = wk.key == data.activeWeekKey,
                  onClick = { onSelectWeek(wk.seasonType, wk.week) },
                  label = { Text(wk.shortLabel, style = MaterialTheme.typography.labelSmall) }
                )
              }
            }
          }

          if (confOptions.isNotEmpty()) {
            LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
              item(key = "conf-all") {
                FilterChip(
                  selected = state.rankingsConfFilter == "all",
                  onClick = { onSetConfFilter("all") },
                  label = { Text("All Conferences", style = MaterialTheme.typography.labelSmall) }
                )
              }
              items(confOptions, key = { it.first }) { (cid, cname) ->
                FilterChip(
                  selected = state.rankingsConfFilter == cid,
                  onClick = { onSetConfFilter(cid) },
                  label = { Text(cname, style = MaterialTheme.typography.labelSmall) }
                )
              }
            }
          }
        }
      }
    }

    if (state.rankingsError != null && data == null) {
      item { ErrorStateCard(message = state.rankingsError, onRetry = onRetry) }
    } else if (state.rankingsLoading && data == null) {
      item { LoadingStateBox("Loading CFP & AP Top 25 polls...") }
    } else if (activePoll == null) {
      item {
        EmptyStateCard(
          title = "Poll not yet released for ${data?.activeWeekLabel ?: "this week"}",
          subtitle = "Switch between CFP and AP polls or pick another week above."
        )
      }
    } else {
      item(key = "poll-table") {
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
              Column(modifier = Modifier.weight(1f)) {
                Text(
                  text = activePoll.name.ifBlank { "Top 25 Poll" },
                  style = MaterialTheme.typography.titleMedium,
                  fontWeight = FontWeight.Bold
                )
                Text(
                  text = activePoll.occurrenceLabel.ifBlank { data?.activeWeekLabel.orEmpty() },
                  style = MaterialTheme.typography.bodySmall,
                  color = MaterialTheme.colorScheme.onSurfaceVariant
                )
              }
              Text(
                text = if (isCfp && cfpInfo != null) {
                  when {
                    cfpInfo.topG6Team != null && cfpInfo.g6OutsideTop12 ->
                      "Cutoff: Top 11 + #${cfpInfo.topG6Team.current} ${cfpInfo.topG6Team.shortName} (G6)"
                    cfpInfo.topG6Team != null ->
                      "Top 12 (#${cfpInfo.topG6Team.current} ${cfpInfo.topG6Team.shortName} G6)"
                    cfpInfo.g6Unranked && cfpInfo.committeeG6Team != null ->
                      "Cutoff: Top 11 + ${cfpInfo.committeeG6Team.shortName} (NR · G6)"
                    cfpInfo.g6Unranked ->
                      "Cutoff: Top 11 + Top G6 (Unranked)"
                    else -> "Top 12 Playoff Field"
                  }
                } else {
                  "${filteredRanks.size} ranked"
                },
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.primary,
                fontWeight = FontWeight.Bold
              )
            }

            if (filteredRanks.isEmpty()) {
              Text(
                text = "No ranked teams matched your filter.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(16.dp)
              )
            } else {
              HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))
              filteredRanks.forEachIndexed { idx, row ->
                val isTopG6 = isCfp && cfpInfo?.topG6Team?.id == row.id
                val inPlayoffField = isCfp && cfpInfo != null && (row.current <= cfpInfo.cutoffRank || isTopG6)
                val isBumpedOut = isCfp && cfpInfo?.g6OutsideTop12 == true && row.current == 12 && !isTopG6
                val isCutlineRow = showCutline && row.current == cfpInfo.cutoffRank

                RankedTeamRowItem(
                  row = row,
                  inPlayoffField = inPlayoffField,
                  isTopG6 = isTopG6,
                  isBumpedOut = isBumpedOut,
                  onClick = { onOpenTeam(row.id) }
                )
                if (isCutlineRow) {
                  val cutlineText = when {
                    cfpInfo.g6OutsideTop12 && cfpInfo.topG6Team != null ->
                      "Playoff Cutoff (Top 11) · #${cfpInfo.topG6Team.current} ${cfpInfo.topG6Team.shortName} claims 12th G6 slot"
                    cfpInfo.g6Unranked && cfpInfo.committeeG6Team != null ->
                      "Playoff Cutoff (Top 11) · ${cfpInfo.committeeG6Team.shortName} (Unranked) claims 12th slot per CFP Committee"
                    cfpInfo.g6Unranked ->
                      "Playoff Cutoff (Top 11) · Top G6 team (Unranked) claims 12th slot"
                    else -> "12-Team Playoff Cutoff"
                  }
                  Surface(
                    color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.35f),
                    modifier = Modifier.fillMaxWidth()
                  ) {
                    Text(
                      text = cutlineText,
                      style = MaterialTheme.typography.labelSmall,
                      fontWeight = FontWeight.Bold,
                      color = MaterialTheme.colorScheme.primary,
                      textAlign = TextAlign.Center,
                      modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 12.dp, vertical = 6.dp)
                    )
                  }
                } else if (idx < filteredRanks.lastIndex) {
                  HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.35f))
                }
              }

              if (showCutline && cfpInfo.g6Unranked) {
                val g6 = cfpInfo.committeeG6Team
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))
                Surface(
                  color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.28f),
                  modifier = Modifier.fillMaxWidth()
                ) {
                  Row(
                    modifier = Modifier
                      .fillMaxWidth()
                      .let { baseMod ->
                        if (g6 != null && g6.id.isNotBlank()) baseMod.clickable { onOpenTeam(g6.id) }
                        else baseMod
                      }
                      .padding(horizontal = 12.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically
                  ) {
                    Text(
                      text = "NR",
                      style = MaterialTheme.typography.titleSmall,
                      fontWeight = FontWeight.ExtraBold,
                      color = MaterialTheme.colorScheme.primary,
                      modifier = Modifier.width(30.dp)
                    )
                    if (g6 != null) {
                      TeamLogo(
                        logoUrl = g6.logo,
                        abbreviation = g6.abbreviation,
                        colorHex = g6.color,
                        size = 32.dp
                      )
                      Spacer(Modifier.width(10.dp))
                    }
                    Column(modifier = Modifier.weight(1f)) {
                      Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                      ) {
                        Text(
                          text = g6?.shortName ?: "Top Group of 6 Team",
                          style = MaterialTheme.typography.titleSmall,
                          fontWeight = FontWeight.Bold,
                          maxLines = 1,
                          overflow = TextOverflow.Ellipsis
                        )
                        Surface(
                          shape = RoundedCornerShape(999.dp),
                          color = MaterialTheme.colorScheme.primary
                        ) {
                          Text(
                            text = "G6 Playoff Slot",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onPrimary,
                            fontWeight = FontWeight.Bold,
                            modifier = Modifier.padding(horizontal = 6.dp, vertical = 1.dp)
                          )
                        }
                      }
                      val subtitleText = if (g6 != null) {
                        listOfNotNull(
                          g6.conferenceShortName.takeIf { it.isNotBlank() },
                          g6.recordSummary.takeIf { it.isNotBlank() },
                          "Unranked · CFP Committee Projected Bid"
                        ).joinToString(" · ")
                      } else {
                        "Unranked · Highest-ranked G6 team as determined by CFP Committee"
                      }
                      Text(
                        text = subtitleText,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 2
                      )
                    }
                    Column(horizontalAlignment = Alignment.End) {
                      Surface(
                        shape = RoundedCornerShape(6.dp),
                        color = MaterialTheme.colorScheme.tertiaryContainer
                      ) {
                        Text(
                          text = "Auto-Bid",
                          style = MaterialTheme.typography.labelSmall,
                          color = MaterialTheme.colorScheme.onTertiaryContainer,
                          fontWeight = FontWeight.Bold,
                          modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                        )
                      }
                      if (g6 != null && g6.previous > 0) {
                        Text(
                          text = "Prev #${g6.previous}",
                          style = MaterialTheme.typography.labelSmall,
                          color = MaterialTheme.colorScheme.onSurfaceVariant,
                          textAlign = TextAlign.End
                        )
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }

      if (activePoll.others.isNotEmpty()) {
        item(key = "others-receiving") {
          Card(
            shape = RoundedCornerShape(16.dp),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow)
          ) {
            Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
              Text(
                text = "Others Receiving Votes",
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.Bold
              )
              activePoll.others.forEach { r ->
                Row(
                  modifier = Modifier
                    .fillMaxWidth()
                    .clickable { onOpenTeam(r.id) }
                    .padding(vertical = 4.dp),
                  horizontalArrangement = Arrangement.SpaceBetween,
                  verticalAlignment = Alignment.CenterVertically
                ) {
                  Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    TeamLogo(logoUrl = r.logo, abbreviation = r.abbreviation, colorHex = r.color, size = 24.dp)
                    Text(r.shortName, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                  }
                  Text(r.trendDisplay, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
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
private fun RankedTeamRowItem(
  row: RankedTeamRow,
  inPlayoffField: Boolean = false,
  isTopG6: Boolean = false,
  isBumpedOut: Boolean = false,
  onClick: () -> Unit
) {
  val ext = CfbTheme.extended
  val trendBg = when (row.movement) {
    "up" -> ext.winContainer
    "down" -> MaterialTheme.colorScheme.errorContainer
    "new" -> MaterialTheme.colorScheme.tertiaryContainer
    else -> MaterialTheme.colorScheme.surfaceContainerHigh
  }
  val trendFg = when (row.movement) {
    "up" -> ext.onWinContainer
    "down" -> MaterialTheme.colorScheme.onErrorContainer
    "new" -> MaterialTheme.colorScheme.onTertiaryContainer
    else -> MaterialTheme.colorScheme.onSurfaceVariant
  }

  Surface(
    color = if (isTopG6) MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.25f)
    else androidx.compose.ui.graphics.Color.Transparent
  ) {
    Row(
      modifier = Modifier
        .fillMaxWidth()
        .clickable(onClick = onClick)
        .padding(horizontal = 12.dp, vertical = 10.dp),
      verticalAlignment = Alignment.CenterVertically
    ) {
      Text(
        text = "${row.current}",
        style = MaterialTheme.typography.titleMedium,
        fontWeight = FontWeight.ExtraBold,
        color = if (inPlayoffField) MaterialTheme.colorScheme.primary
        else MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.width(30.dp)
      )
      TeamLogo(logoUrl = row.logo, abbreviation = row.abbreviation, colorHex = row.color, size = 32.dp)
      Spacer(Modifier.width(10.dp))
      Column(modifier = Modifier.weight(1f)) {
        Row(
          verticalAlignment = Alignment.CenterVertically,
          horizontalArrangement = Arrangement.spacedBy(6.dp)
        ) {
          Text(
            text = row.shortName,
            style = MaterialTheme.typography.titleSmall,
            fontWeight = FontWeight.Bold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
          )
          if (isTopG6) {
            Surface(
              shape = RoundedCornerShape(999.dp),
              color = MaterialTheme.colorScheme.primary
            ) {
              Text(
                text = "G6 Slot",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onPrimary,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(horizontal = 5.dp, vertical = 1.dp)
              )
            }
          }
          if (isBumpedOut) {
            Surface(
              shape = RoundedCornerShape(999.dp),
              color = MaterialTheme.colorScheme.surfaceContainerHighest
            ) {
              Text(
                text = "Bumped by G6",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(horizontal = 5.dp, vertical = 1.dp)
              )
            }
          }
          if (row.firstRoundBye) {
            Surface(
              shape = RoundedCornerShape(4.dp),
              color = MaterialTheme.colorScheme.primaryContainer
            ) {
              Text(
                text = "BYE",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onPrimaryContainer,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(horizontal = 4.dp, vertical = 1.dp)
              )
            }
          }
        }
        val meta = listOfNotNull(
          row.conferenceShortName.takeIf { it.isNotBlank() },
          row.recordSummary.takeIf { it.isNotBlank() }
        ).joinToString(" · ")
        if (meta.isNotBlank()) {
          Text(
            text = meta,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1
          )
        }
      }
      Column(horizontalAlignment = Alignment.End) {
        Surface(shape = RoundedCornerShape(6.dp), color = trendBg, contentColor = trendFg) {
          Text(
            text = row.trendDisplay,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
          )
        }
        if (row.points > 0) {
          Text(
            text = "${row.points} pts" + if (row.firstPlaceVotes > 0) " (${row.firstPlaceVotes})" else "",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.End
          )
        }
      }
    }
  }
}

@Composable
fun SeasonPickerButton(
  selectedYear: Int,
  currentYear: Int,
  onSelect: (Int) -> Unit
) {
  var expanded by remember { mutableStateOf(false) }
  val years = remember(currentYear) { (currentYear downTo (currentYear - 5).coerceAtLeast(2014)).toList() }

  Box {
    OutlinedButton(
      onClick = { expanded = true },
      contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp)
    ) {
      Text("$selectedYear Season", style = MaterialTheme.typography.labelSmall)
      Icon(Icons.Rounded.ArrowDropDown, contentDescription = null, modifier = Modifier.size(18.dp))
    }
    DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
      years.forEach { yr ->
        DropdownMenuItem(
          text = { Text("$yr Season") },
          onClick = {
            expanded = false
            onSelect(yr)
          }
        )
      }
    }
  }
}
