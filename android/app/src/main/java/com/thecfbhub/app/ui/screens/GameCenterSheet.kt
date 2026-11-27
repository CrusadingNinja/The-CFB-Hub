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
import androidx.compose.foundation.layout.fillMaxHeight
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
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.ExpandLess
import androidx.compose.material.icons.rounded.ExpandMore
import androidx.compose.material.icons.rounded.LiveTv
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.thecfbhub.app.data.model.DriveInfo
import com.thecfbhub.app.data.model.GameEvent
import com.thecfbhub.app.data.model.GameSummary
import com.thecfbhub.app.ui.components.BroadcastTag
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

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GameCenterSheet(
  state: AppUiState,
  onDismiss: () -> Unit,
  onRefresh: () -> Unit,
  onOpenTeam: (String) -> Unit,
  onOpenWatch: (GameSummary) -> Unit
) {
  val eventId = state.sheetEventId ?: return
  val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
  var activeSubTab by remember(eventId) { mutableStateOf("pbp") }
  var expandedDrives by remember(eventId) { mutableStateOf(emptySet<String>()) }

  ModalBottomSheet(
    onDismissRequest = onDismiss,
    sheetState = sheetState,
    containerColor = MaterialTheme.colorScheme.surface
  ) {
    Column(
      modifier = Modifier
        .fillMaxWidth()
        .fillMaxHeight(0.92f)
    ) {
      // Sheet header bar
      Row(
        modifier = Modifier
          .fillMaxWidth()
          .padding(horizontal = 16.dp, vertical = 6.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
      ) {
        Text(
          text = state.sheetEventPreview?.shortName ?: "Game Center",
          style = MaterialTheme.typography.titleMedium,
          fontWeight = FontWeight.Bold
        )
        Row {
          IconButton(onClick = onRefresh) {
            Icon(Icons.Rounded.Refresh, contentDescription = "Refresh game")
          }
          IconButton(onClick = onDismiss) {
            Icon(Icons.Rounded.Close, contentDescription = "Close")
          }
        }
      }
      HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

      when {
        state.gameSummaryLoading && state.gameSummary == null -> {
          LoadingStateBox("Loading Game Center & Play-by-Play...")
        }
        state.gameSummaryError != null && state.gameSummary == null -> {
          Box(modifier = Modifier.padding(16.dp)) {
            ErrorStateCard(message = state.gameSummaryError, onRetry = onRefresh)
          }
        }
        state.gameSummary != null -> {
          val summary = state.gameSummary
          val preview = state.sheetEventPreview
          GameCenterBody(
            summary = summary,
            preview = preview,
            activeSubTab = activeSubTab,
            onSelectSubTab = { activeSubTab = it },
            expandedDrives = expandedDrives,
            onToggleDrive = { did ->
              expandedDrives = if (expandedDrives.contains(did)) expandedDrives - did else expandedDrives + did
            },
            onOpenTeam = onOpenTeam,
            onOpenWatch = { onOpenWatch(summary) }
          )
        }
      }
    }
  }
}

@Composable
private fun GameCenterBody(
  summary: GameSummary,
  preview: GameEvent?,
  activeSubTab: String,
  onSelectSubTab: (String) -> Unit,
  expandedDrives: Set<String>,
  onToggleDrive: (String) -> Unit,
  onOpenTeam: (String) -> Unit,
  onOpenWatch: () -> Unit
) {
  val ext = CfbTheme.extended
  val away = summary.away
  val home = summary.home
  val isPre = summary.state == "pre"
  val isLive = summary.state == "in"
  val isTimePattern = remember { Regex("\\b\\d{1,2}:\\d{2}\\s*[ap]m\\b", RegexOption.IGNORE_CASE) }
  val mergedTimeValid = !(
    !summary.timeValid ||
      (preview?.timeValid == false && !isTimePattern.containsMatchIn(summary.statusDetail))
    )
  val mergedDate = summary.date.ifBlank { preview?.date.orEmpty() }
  val mergedFlex = summary.flexTimeSlot.ifBlank { preview?.flexTimeSlot.orEmpty() }
  val mergedStatusDetail = summary.statusDetail.ifBlank { preview?.statusDetail.orEmpty() }

  val statusText = if (isPre) {
    val dayStr = KickoffFormatter.formatDayHeading(mergedDate, mergedTimeValid)
    val timeStr = KickoffFormatter.formatEventKickoff(
      isoDate = mergedDate,
      timeValid = mergedTimeValid,
      statusDetail = mergedStatusDetail,
      flexTimeSlot = mergedFlex
    )
    "$dayStr · $timeStr"
  } else {
    summary.statusDetail.ifBlank { if (isLive) "LIVE" else "Final" }
  }

  LazyColumn(
    modifier = Modifier.fillMaxWidth(),
    contentPadding = PaddingValues(14.dp),
    verticalArrangement = Arrangement.spacedBy(12.dp)
  ) {
    // Hero Matchup Card
    item(key = "gc-hero") {
      Card(
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)
      ) {
        Column(
          modifier = Modifier
            .fillMaxWidth()
            .padding(14.dp),
          verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
          Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
          ) {
            StatusPill(text = statusText, state = summary.state, modifier = Modifier.weight(1f, fill = false))
            Spacer(Modifier.width(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
              if (summary.broadcast.isNotBlank()) BroadcastTag(summary.broadcast)
              if (isLive) {
                Button(
                  onClick = onOpenWatch,
                  contentPadding = PaddingValues(horizontal = 10.dp, vertical = 4.dp)
                ) {
                  Icon(Icons.Rounded.LiveTv, contentDescription = null, modifier = Modifier.size(14.dp))
                  Spacer(Modifier.width(4.dp))
                  Text("Watch", style = MaterialTheme.typography.labelSmall)
                }
              }
            }
          }

          Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically
          ) {
            Column(
              modifier = Modifier
                .weight(1f)
                .clip(RoundedCornerShape(10.dp))
                .clickable { onOpenTeam(away.id) }
                .padding(4.dp),
              horizontalAlignment = Alignment.CenterHorizontally
            ) {
              TeamLogo(logoUrl = away.logo, abbreviation = away.abbreviation, colorHex = away.color, size = 46.dp)
              Spacer(Modifier.height(6.dp))
              Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                RankBadge(away.rank)
                Text(away.shortName, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
              }
              Text(away.overallRecord, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }

            Column(
              horizontalAlignment = Alignment.CenterHorizontally,
              modifier = Modifier.padding(horizontal = 8.dp)
            ) {
              if (!isPre) {
                Text(
                  text = "${away.score.ifBlank { "0" }} - ${home.score.ifBlank { "0" }}",
                  style = MaterialTheme.typography.headlineSmall,
                  fontWeight = FontWeight.ExtraBold
                )
              } else {
                Text("@", style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
              }
            }

            Column(
              modifier = Modifier
                .weight(1f)
                .clip(RoundedCornerShape(10.dp))
                .clickable { onOpenTeam(home.id) }
                .padding(4.dp),
              horizontalAlignment = Alignment.CenterHorizontally
            ) {
              TeamLogo(logoUrl = home.logo, abbreviation = home.abbreviation, colorHex = home.color, size = 46.dp)
              Spacer(Modifier.height(6.dp))
              Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                RankBadge(home.rank)
                Text(home.shortName, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
              }
              Text(home.overallRecord, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
          }

          // Linescore table
          val quarters = maxOf(4, away.linescores.size, home.linescores.size)
          if (!isPre && (away.linescores.isNotEmpty() || home.linescores.isNotEmpty())) {
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
              Row(modifier = Modifier.fillMaxWidth()) {
                Text("TEAM", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
                for (q in 0 until quarters) {
                  val lbl = if (q < 4) "Q${q + 1}" else "OT${if (q > 4) q - 3 else ""}"
                  Text(lbl, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center, modifier = Modifier.width(30.dp))
                }
                Text("T", style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold, textAlign = TextAlign.End, modifier = Modifier.width(32.dp))
              }
              listOf(away, home).forEach { team ->
                Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                  Text(team.abbreviation, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                  for (q in 0 until quarters) {
                    Text(
                      text = team.linescores.getOrNull(q) ?: "-",
                      style = MaterialTheme.typography.bodySmall,
                      textAlign = TextAlign.Center,
                      modifier = Modifier.width(30.dp)
                    )
                  }
                  Text(team.score.ifBlank { "0" }, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.ExtraBold, textAlign = TextAlign.End, modifier = Modifier.width(32.dp))
                }
              }
            }
          }

          val venueStr = listOf(summary.venue.name, summary.venue.city, summary.venue.state)
            .filter { it.isNotBlank() }
            .joinToString(", ")
          val oddsStr = summary.odds?.let {
            listOfNotNull(
              it.details.takeIf { d -> d.isNotBlank() },
              it.overUnder?.let { ou -> "O/U $ou" }
            ).joinToString(" · ")
          }.orEmpty()
          if (venueStr.isNotBlank() || oddsStr.isNotBlank()) {
            Text(
              text = listOf(venueStr, oddsStr).filter { it.isNotBlank() }.joinToString(" · "),
              style = MaterialTheme.typography.bodySmall,
              color = MaterialTheme.colorScheme.onSurfaceVariant
            )
          }
        }
      }
    }

    // Sub-tab selector
    item(key = "gc-tabs") {
      Row(modifier = Modifier.horizontalScroll(rememberScrollState())) {
        SegmentedOptionRow(
          options = listOf(
            "pbp" to "Play-by-Play",
            "scoring" to "Scoring (${summary.scoringPlays.size})",
            "boxscore" to "Team Stats",
            "leaders" to "Leaders"
          ),
          selectedKey = activeSubTab,
          onSelect = onSelectSubTab
        )
      }
    }

    when (activeSubTab) {
      "pbp" -> {
        val allDrives = buildList {
          summary.currentDrive?.let { add(it) }
          addAll(summary.previousDrives.reversed())
        }
        if (allDrives.isEmpty()) {
          item {
            Text(
              text = if (isPre) "Play-by-play will populate once kickoff begins."
              else "Detailed drive play-by-play is not available for this matchup.",
              style = MaterialTheme.typography.bodyMedium,
              color = MaterialTheme.colorScheme.onSurfaceVariant,
              modifier = Modifier.padding(8.dp)
            )
          }
        } else {
          items(allDrives, key = { it.id }) { drive ->
            DriveAccordionCard(
              drive = drive,
              awayAbbr = away.abbreviation,
              homeAbbr = home.abbreviation,
              expanded = drive.isCurrent || expandedDrives.contains(drive.id),
              onToggle = { onToggleDrive(drive.id) }
            )
          }
        }
      }
      "scoring" -> {
        if (summary.scoringPlays.isEmpty()) {
          item {
            Text(
              text = "No scoring plays recorded yet.",
              style = MaterialTheme.typography.bodyMedium,
              color = MaterialTheme.colorScheme.onSurfaceVariant
            )
          }
        } else {
          items(summary.scoringPlays, key = { it.id }) { sp ->
            Card(
              shape = RoundedCornerShape(12.dp),
              colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLowest),
              border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)
            ) {
              Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(
                  modifier = Modifier.fillMaxWidth(),
                  horizontalArrangement = Arrangement.SpaceBetween,
                  verticalAlignment = Alignment.CenterVertically
                ) {
                  Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    TeamLogo(logoUrl = sp.teamLogo, abbreviation = sp.teamAbbr, size = 22.dp)
                    Text("${sp.teamAbbr} · ${KickoffFormatter.quarterLabel(sp.period)} ${sp.clock}", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
                  }
                  Surface(shape = RoundedCornerShape(6.dp), color = ext.winContainer, contentColor = ext.onWinContainer) {
                    Text(
                      text = "${away.abbreviation} ${sp.awayScore} - ${home.abbreviation} ${sp.homeScore}",
                      style = MaterialTheme.typography.labelSmall,
                      fontWeight = FontWeight.Bold,
                      modifier = Modifier.padding(horizontal = 7.dp, vertical = 2.dp)
                    )
                  }
                }
                Text(sp.text, style = MaterialTheme.typography.bodySmall)
              }
            }
          }
        }
      }
      "boxscore" -> {
        if (summary.boxscoreRows.isEmpty()) {
          item {
            Text(
              text = "Team boxscore statistics are not yet available.",
              style = MaterialTheme.typography.bodyMedium,
              color = MaterialTheme.colorScheme.onSurfaceVariant
            )
          }
        } else {
          items(summary.boxscoreRows, key = { it.key }) { row ->
            val aNum = row.awayValue.toFloatOrNull()
            val hNum = row.homeValue.toFloatOrNull()
            val awayShare = if (aNum != null && hNum != null && (aNum + hNum) > 0f) {
              (aNum / (aNum + hNum)).coerceIn(0.05f, 0.95f)
            } else 0.5f

            Card(
              shape = RoundedCornerShape(12.dp),
              colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLowest),
              border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)
            ) {
              Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                  Text("${away.abbreviation} ${row.awayValue}", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
                  Text(row.label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                  Text("${row.homeValue} ${home.abbreviation}", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
                }
                LinearProgressIndicator(
                  progress = { awayShare },
                  modifier = Modifier
                    .fillMaxWidth()
                    .height(6.dp)
                    .clip(RoundedCornerShape(999.dp)),
                  color = parseHexColor(away.color, MaterialTheme.colorScheme.primary),
                  trackColor = parseHexColor(home.color, MaterialTheme.colorScheme.tertiary)
                )
              }
            }
          }
        }
      }
      "leaders" -> {
        if (summary.leaders.isEmpty()) {
          item {
            Text(
              text = "Statistical leaders are not yet available.",
              style = MaterialTheme.typography.bodyMedium,
              color = MaterialTheme.colorScheme.onSurfaceVariant
            )
          }
        } else {
          items(summary.leaders, key = { it.teamId.ifBlank { it.teamName } }) { grp ->
            Card(
              shape = RoundedCornerShape(12.dp),
              colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLowest),
              border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)
            ) {
              Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(grp.teamName, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
                grp.categories.forEach { cat ->
                  Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Column(modifier = Modifier.weight(1f)) {
                      Text(cat.category, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
                      Text("${cat.athleteName} (${cat.position})", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
                    }
                    Text(cat.displayValue, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
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
private fun DriveAccordionCard(
  drive: DriveInfo,
  awayAbbr: String,
  homeAbbr: String,
  expanded: Boolean,
  onToggle: () -> Unit
) {
  val ext = CfbTheme.extended
  Card(
    shape = RoundedCornerShape(12.dp),
    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLowest),
    border = BorderStroke(
      1.dp,
      if (drive.isCurrent) ext.live else if (drive.isScore) ext.win else MaterialTheme.colorScheme.outlineVariant
    )
  ) {
    Column(modifier = Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
      Row(
        modifier = Modifier
          .fillMaxWidth()
          .clickable(onClick = onToggle),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween
      ) {
        Row(
          modifier = Modifier.weight(1f),
          verticalAlignment = Alignment.CenterVertically,
          horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
          TeamLogo(logoUrl = drive.team.logo, abbreviation = drive.team.abbreviation, size = 26.dp)
          Column(modifier = Modifier.weight(1f)) {
            Text(
              text = "${drive.team.displayName.ifBlank { drive.team.abbreviation }} · ${drive.displayResult}",
              style = MaterialTheme.typography.titleSmall,
              fontWeight = FontWeight.Bold,
              maxLines = 1,
              overflow = TextOverflow.Ellipsis
            )
            Text(
              text = "${drive.offensivePlays} plays · ${drive.yards} yds" +
                if (drive.timeElapsed.isNotBlank()) " · ${drive.timeElapsed}" else "",
              style = MaterialTheme.typography.bodySmall,
              color = MaterialTheme.colorScheme.onSurfaceVariant
            )
          }
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
          Text(
            text = "$awayAbbr ${drive.awayScore} - $homeAbbr ${drive.homeScore}",
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.Bold
          )
          Icon(
            imageVector = if (expanded) Icons.Rounded.ExpandLess else Icons.Rounded.ExpandMore,
            contentDescription = null
          )
        }
      }

      if (expanded && drive.plays.isNotEmpty()) {
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))
        val orderedPlays = drive.plays.reversed()
        orderedPlays.forEach { p ->
          Column(
            modifier = Modifier
              .fillMaxWidth()
              .padding(vertical = 3.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp)
          ) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
              Text(
                text = listOfNotNull(
                  "Q${p.period} ${p.clock}".trim().takeIf { it.isNotBlank() },
                  p.downDistanceText.takeIf { it.isNotBlank() }
                ).joinToString(" · "),
                style = MaterialTheme.typography.labelSmall,
                color = if (p.scoringPlay) ext.win else MaterialTheme.colorScheme.primary,
                fontWeight = FontWeight.Bold
              )
              if (p.scoringPlay) {
                Text(
                  text = "$awayAbbr ${p.awayScore} - $homeAbbr ${p.homeScore}",
                  style = MaterialTheme.typography.labelSmall,
                  fontWeight = FontWeight.ExtraBold,
                  color = ext.win
                )
              }
            }
            Text(p.text, style = MaterialTheme.typography.bodySmall)
          }
        }
      }
    }
  }
}
