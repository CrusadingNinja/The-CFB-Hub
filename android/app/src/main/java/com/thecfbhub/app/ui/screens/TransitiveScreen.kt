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
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowForward
import androidx.compose.material.icons.rounded.ArrowDropDown
import androidx.compose.material.icons.rounded.ExpandLess
import androidx.compose.material.icons.rounded.ExpandMore
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.SwapHoriz
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.thecfbhub.app.data.model.FarthestChainResult
import com.thecfbhub.app.data.model.SchoolFarthestRow
import com.thecfbhub.app.data.model.SeasonResultGame
import com.thecfbhub.app.data.model.TeamDirectoryItem
import com.thecfbhub.app.data.model.TransitiveChain
import com.thecfbhub.app.ui.components.EmptyStateCard
import com.thecfbhub.app.ui.components.ErrorStateCard
import com.thecfbhub.app.ui.components.LoadingStateBox
import com.thecfbhub.app.ui.components.RankBadge
import com.thecfbhub.app.ui.components.SegmentedOptionRow
import com.thecfbhub.app.ui.components.TeamLogo
import com.thecfbhub.app.ui.state.AppUiState
import com.thecfbhub.app.ui.theme.CfbTheme

private data class ResolvedTeamUi(
  val id: String,
  val displayName: String,
  val shortName: String,
  val abbreviation: String,
  val logo: String,
  val color: String?,
  val division: String,
  val rank: Int?
)

private fun resolveTeamUi(id: String, state: AppUiState): ResolvedTeamUi {
  val dir = state.teamsById[id]
  val g = state.seasonResultsGraph?.teams?.get(id)
  return ResolvedTeamUi(
    id = id,
    displayName = dir?.displayName ?: g?.displayName ?: "Team $id",
    shortName = dir?.shortName ?: g?.shortName ?: "Team $id",
    abbreviation = dir?.abbreviation ?: g?.abbreviation ?: "CFB",
    logo = dir?.logo?.ifBlank { g?.logo.orEmpty() } ?: g?.logo.orEmpty(),
    color = dir?.color ?: g?.color,
    division = dir?.division.orEmpty(),
    rank = dir?.rank
  )
}

@Composable
fun TransitiveScreen(
  state: AppUiState,
  onSetMode: (String) -> Unit,
  onSelectTeams: (String?, String?) -> Unit,
  onSwapTeams: () -> Unit,
  onUpdateFarthestOptions: (String?, String?, String?) -> Unit,
  onCompareMatchupFromFarthest: (String, String) -> Unit,
  onOpenTeam: (String) -> Unit,
  onOpenGame: (String) -> Unit,
  onRetryGraph: () -> Unit
) {
  val selectableCatalog = remember(state.teamsDirectory) {
    state.teamsDirectory
      .filter { it.division == "FBS" || it.division == "FCS" }
      .sortedWith { a, b ->
        if (a.division != b.division) if (a.division == "FBS") -1 else 1
        else {
          val ra = a.rank ?: 999
          val rb = b.rank ?: 999
          if (ra != rb) ra.compareTo(rb) else a.displayName.compareTo(b.displayName)
        }
      }
  }

  var pickerSlot by remember { mutableStateOf<String?>(null) }

  pickerSlot?.let { slot ->
    val currentId = if (slot == "A") state.transitiveTeamAId else state.transitiveTeamBId
    val oppositeId = if (slot == "A") state.transitiveTeamBId else state.transitiveTeamAId
    TeamPickerDialog(
      title = if (slot == "A") "Select Team A" else "Select Team B",
      catalog = selectableCatalog,
      selectedId = currentId,
      oppositeId = oppositeId,
      onDismiss = { pickerSlot = null },
      onPick = { pickedId ->
        pickerSlot = null
        if (slot == "A") onSelectTeams(pickedId, state.transitiveTeamBId)
        else onSelectTeams(state.transitiveTeamAId, pickedId)
      }
    )
  }

  val farthestQuery = remember { mutableStateOf("") }
  val expandedSchools = remember { mutableStateOf(emptySet<String>()) }
  val showAllFarthest = remember { mutableStateOf(false) }

  val filteredSortedFarthest = remember(
    state.farthestRows,
    state.farthestSchoolDiv,
    state.farthestSort,
    state.teamsById,
    farthestQuery.value
  ) {
    val q = farthestQuery.value.trim().lowercase()
    state.farthestRows
      .filter { row ->
        val team = state.teamsById[row.teamId]
        if (state.farthestSchoolDiv == "FBS" && team?.division != "FBS") return@filter false
        if (state.farthestSchoolDiv == "FCS" && team?.division != "FCS") return@filter false
        if (q.isNotEmpty()) {
          val hay = "${team?.displayName.orEmpty()} ${team?.shortName.orEmpty()} ${team?.abbreviation.orEmpty()} ${team?.conferenceShortName.orEmpty()}".lowercase()
          if (!hay.contains(q)) return@filter false
        }
        true
      }
      .sortedWith { a, b ->
        val resDiff = when (state.farthestSort) {
          "loss_desc" -> {
            val da = a.farthestLoss.degree ?: -1
            val db = b.farthestLoss.degree ?: -1
            if (db != da) db.compareTo(da)
            else b.farthestLoss.totalMargin.compareTo(a.farthestLoss.totalMargin)
          }
          "school_asc" -> 0
          else -> {
            val da = a.farthestWin.degree ?: -1
            val db = b.farthestWin.degree ?: -1
            if (db != da) db.compareTo(da)
            else b.farthestWin.totalMargin.compareTo(a.farthestWin.totalMargin)
          }
        }
        if (resDiff != 0) resDiff
        else {
          val ta = state.teamsById[a.teamId]
          val tb = state.teamsById[b.teamId]
          if (state.farthestSort != "school_asc") {
            val ra = ta?.rank ?: 999
            val rb = tb?.rank ?: 999
            if (ra != rb) return@sortedWith ra.compareTo(rb)
          }
          (ta?.displayName ?: a.teamId).compareTo(tb?.displayName ?: b.teamId)
        }
      }
  }

  LazyColumn(
    modifier = Modifier.fillMaxSize(),
    contentPadding = PaddingValues(12.dp),
    verticalArrangement = Arrangement.spacedBy(10.dp)
  ) {
    // Header & mode switch
    item(key = "trans-hdr") {
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
          Text(
            text = "Transitive Wins & Losses",
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold
          )
          val countDesc = state.seasonResultsGraph?.let {
            "${it.seasonYear} Season · ${it.completedCount} completed games"
          } ?: "Compare up to 5 shortest transitive win & loss chains"
          Text(
            text = countDesc,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
          )
          SegmentedOptionRow(
            options = listOf("matchup" to "Matchup Explorer", "farthest" to "Farthest Chains"),
            selectedKey = state.transitiveMode,
            onSelect = onSetMode
          )
        }
      }
    }

    if (state.seasonGraphError != null && state.seasonResultsGraph == null) {
      item { ErrorStateCard(message = state.seasonGraphError, onRetry = onRetryGraph) }
      return@LazyColumn
    }

    if (state.seasonGraphLoading && state.seasonResultsGraph == null) {
      item { LoadingStateBox("Loading season game results graph...") }
      return@LazyColumn
    }

    if (state.transitiveMode == "matchup") {
      val teamA = state.transitiveTeamAId?.let { resolveTeamUi(it, state) }
      val teamB = state.transitiveTeamBId?.let { resolveTeamUi(it, state) }

      item(key = "picker-card") {
        Card(
          shape = RoundedCornerShape(16.dp),
          colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLowest),
          border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)
        ) {
          Column(
            modifier = Modifier
              .fillMaxWidth()
              .padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
          ) {
            Row(
              modifier = Modifier.fillMaxWidth(),
              verticalAlignment = Alignment.CenterVertically,
              horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
              TeamSelectorButton(
                label = "Team A",
                team = teamA,
                onClick = { pickerSlot = "A" },
                modifier = Modifier.weight(1f)
              )
              IconButton(onClick = onSwapTeams) {
                Icon(Icons.Rounded.SwapHoriz, contentDescription = "Swap teams")
              }
              TeamSelectorButton(
                label = "Team B",
                team = teamB,
                onClick = { pickerSlot = "B" },
                modifier = Modifier.weight(1f)
              )
            }

            if (state.transitiveTeamAId != null && state.transitiveTeamAId == state.transitiveTeamBId) {
              Text(
                text = "Choose two different schools to compute transitive chains.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error
              )
            }
          }
        }
      }

      if (state.transitiveComputing) {
        item { LoadingStateBox("Calculating transitive win and loss chains...") }
      } else {
        val comp = state.transitiveComparison
        if (comp != null && teamA != null && teamB != null) {
          item(key = "win-hdr") {
            TransitiveSectionHeader(
              title = "${teamA.shortName} > ${teamB.shortName} (Transitive Wins)",
              count = comp.winChains.size,
              isWin = true
            )
          }
          if (comp.winChains.isEmpty()) {
            item(key = "win-empty") {
              EmptyStateCard(
                title = "No Transitive Win Chains Found",
                subtitle = "No chain of wins connects ${teamA.shortName} to ${teamB.shortName} in recorded season games."
              )
            }
          } else {
            items(comp.winChains, key = { c -> "w-${c.teamIds.joinToString("-")}" }) { chain ->
              TransitiveChainCard(
                chain = chain,
                isWin = true,
                state = state,
                onOpenTeam = onOpenTeam,
                onOpenGame = onOpenGame
              )
            }
          }

          item(key = "loss-hdr") {
            TransitiveSectionHeader(
              title = "${teamA.shortName} < ${teamB.shortName} (Transitive Losses)",
              count = comp.lossChains.size,
              isWin = false
            )
          }
          if (comp.lossChains.isEmpty()) {
            item(key = "loss-empty") {
              EmptyStateCard(
                title = "No Transitive Loss Chains Found",
                subtitle = "No chain of losses connects ${teamA.shortName} to ${teamB.shortName} in recorded season games."
              )
            }
          } else {
            items(comp.lossChains, key = { c -> "l-${c.teamIds.joinToString("-")}" }) { chain ->
              TransitiveChainCard(
                chain = chain,
                isWin = false,
                state = state,
                onOpenTeam = onOpenTeam,
                onOpenGame = onOpenGame
              )
            }
          }
        }
      }
    } else {
      // FARTHEST CHAINS BY SCHOOL
      item(key = "farthest-controls") {
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
              value = farthestQuery.value,
              onValueChange = { farthestQuery.value = it },
              placeholder = { Text("Filter schools by name or conference...") },
              leadingIcon = { Icon(Icons.Rounded.Search, contentDescription = null) },
              singleLine = true,
              shape = RoundedCornerShape(12.dp),
              modifier = Modifier.fillMaxWidth()
            )
            Row(
              modifier = Modifier.horizontalScroll(rememberScrollState()),
              horizontalArrangement = Arrangement.spacedBy(8.dp),
              verticalAlignment = Alignment.CenterVertically
            ) {
              SegmentedOptionRow(
                options = listOf("all" to "All", "FBS" to "FBS", "FCS" to "FCS"),
                selectedKey = state.farthestSchoolDiv,
                onSelect = { onUpdateFarthestOptions(null, it, null) }
              )
              SegmentedOptionRow(
                options = listOf("fbs_fcs" to "Targets: All", "fbs" to "Targets: FBS"),
                selectedKey = state.farthestTargetScope,
                onSelect = { onUpdateFarthestOptions(it, null, null) }
              )
            }
            SegmentedOptionRow(
              options = listOf(
                "win_desc" to "Longest Win",
                "loss_desc" to "Longest Loss",
                "school_asc" to "School A–Z"
              ),
              selectedKey = state.farthestSort,
              onSelect = { onUpdateFarthestOptions(null, null, it) }
            )
          }
        }
      }

      if (state.farthestComputing && state.farthestRows.isEmpty()) {
        item { LoadingStateBox("Computing shortest-path eccentricity for all schools...") }
      } else if (filteredSortedFarthest.isEmpty()) {
        item {
          EmptyStateCard(
            title = "No schools matched",
            subtitle = "Clear filters or wait for the teams catalog to finish loading."
          )
        }
      } else {
        val visibleLimit = if (showAllFarthest.value) filteredSortedFarthest.size else 50
        val sliced = filteredSortedFarthest.take(visibleLimit)
        items(sliced, key = { "far-${it.teamId}" }) { row ->
          FarthestSchoolCard(
            row = row,
            expanded = expandedSchools.value.contains(row.teamId),
            state = state,
            onToggleExpand = {
              val cur = expandedSchools.value
              expandedSchools.value = if (cur.contains(row.teamId)) cur - row.teamId else cur + row.teamId
            },
            onCompareMatchup = onCompareMatchupFromFarthest,
            onOpenTeam = onOpenTeam,
            onOpenGame = onOpenGame
          )
        }
        if (filteredSortedFarthest.size > visibleLimit) {
          item(key = "show-all-farthest") {
            Button(
              onClick = { showAllFarthest.value = true },
              modifier = Modifier.fillMaxWidth()
            ) {
              Text("Show All ${filteredSortedFarthest.size} Schools")
            }
          }
        }
      }
    }
  }
}

@Composable
private fun TeamSelectorButton(
  label: String,
  team: ResolvedTeamUi?,
  onClick: () -> Unit,
  modifier: Modifier = Modifier
) {
  OutlinedButton(
    onClick = onClick,
    modifier = modifier,
    shape = RoundedCornerShape(12.dp),
    contentPadding = PaddingValues(horizontal = 10.dp, vertical = 10.dp)
  ) {
    Row(
      modifier = Modifier.fillMaxWidth(),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
      if (team != null) {
        TeamLogo(logoUrl = team.logo, abbreviation = team.abbreviation, colorHex = team.color, size = 26.dp)
        Column(modifier = Modifier.weight(1f)) {
          Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
          Text(
            text = team.shortName,
            style = MaterialTheme.typography.labelLarge,
            fontWeight = FontWeight.Bold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
          )
        }
      } else {
        Text(
          text = "Select $label",
          style = MaterialTheme.typography.labelMedium,
          modifier = Modifier.weight(1f)
        )
      }
      Icon(Icons.Rounded.ArrowDropDown, contentDescription = null, modifier = Modifier.size(18.dp))
    }
  }
}

@Composable
private fun TransitiveSectionHeader(title: String, count: Int, isWin: Boolean) {
  val ext = CfbTheme.extended
  Row(
    modifier = Modifier
      .fillMaxWidth()
      .padding(top = 4.dp),
    horizontalArrangement = Arrangement.SpaceBetween,
    verticalAlignment = Alignment.CenterVertically
  ) {
    Text(
      text = title,
      style = MaterialTheme.typography.titleSmall,
      fontWeight = FontWeight.Bold,
      color = if (isWin) ext.win else MaterialTheme.colorScheme.error,
      modifier = Modifier.weight(1f)
    )
    Text(
      text = "$count chain${if (count == 1) "" else "s"}",
      style = MaterialTheme.typography.labelSmall,
      color = MaterialTheme.colorScheme.onSurfaceVariant
    )
  }
}

@Composable
private fun TransitiveChainCard(
  chain: TransitiveChain,
  isWin: Boolean,
  state: AppUiState,
  onOpenTeam: (String) -> Unit,
  onOpenGame: (String) -> Unit
) {
  val ext = CfbTheme.extended
  val badgeBg = if (isWin) ext.winContainer else MaterialTheme.colorScheme.errorContainer
  val badgeFg = if (isWin) ext.onWinContainer else MaterialTheme.colorScheme.onErrorContainer

  Card(
    shape = RoundedCornerShape(14.dp),
    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLowest),
    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)
  ) {
    Column(
      modifier = Modifier
        .fillMaxWidth()
        .padding(12.dp),
      verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
      Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
      ) {
        Surface(shape = RoundedCornerShape(999.dp), color = badgeBg, contentColor = badgeFg) {
          Text(
            text = "Degree ${chain.degree}",
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(horizontal = 9.dp, vertical = 3.dp)
          )
        }
        Text(
          text = "Combined margin ${chain.totalMargin} pts",
          style = MaterialTheme.typography.labelSmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant
        )
      }

      ChainStepsList(
        teamIds = chain.teamIds,
        games = chain.games,
        isWin = isWin,
        state = state,
        onOpenTeam = onOpenTeam,
        onOpenGame = onOpenGame
      )
    }
  }
}

@Composable
private fun ChainStepsList(
  teamIds: List<String>,
  games: List<SeasonResultGame>,
  isWin: Boolean,
  state: AppUiState,
  onOpenTeam: (String) -> Unit,
  onOpenGame: (String) -> Unit
) {
  val ext = CfbTheme.extended
  Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
    games.forEachIndexed { idx, g ->
      val leftId = teamIds.getOrNull(idx) ?: return@forEachIndexed
      val rightId = teamIds.getOrNull(idx + 1) ?: return@forEachIndexed
      val left = resolveTeamUi(leftId, state)
      val right = resolveTeamUi(rightId, state)
      val verb = if (isWin) "def." else "lost to"
      val scoreText = "${g.winnerScore}-${g.loserScore}"

      Surface(
        shape = RoundedCornerShape(10.dp),
        color = MaterialTheme.colorScheme.surfaceContainerLow
      ) {
        Row(
          modifier = Modifier
            .fillMaxWidth()
            .clickable { onOpenGame(g.id) }
            .padding(horizontal = 10.dp, vertical = 7.dp),
          verticalAlignment = Alignment.CenterVertically,
          horizontalArrangement = Arrangement.spacedBy(6.dp)
        ) {
          Row(
            modifier = Modifier
              .weight(1f)
              .clip(RoundedCornerShape(6.dp))
              .clickable { onOpenTeam(left.id) },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(5.dp)
          ) {
            TeamLogo(logoUrl = left.logo, abbreviation = left.abbreviation, colorHex = left.color, size = 22.dp)
            Text(
              text = left.shortName,
              style = MaterialTheme.typography.labelMedium,
              fontWeight = FontWeight.Bold,
              maxLines = 1,
              overflow = TextOverflow.Ellipsis
            )
          }
          Text(
            text = "$verb ($scoreText)",
            style = MaterialTheme.typography.labelSmall,
            color = if (isWin) ext.win else MaterialTheme.colorScheme.error,
            fontWeight = FontWeight.SemiBold
          )
          Row(
            modifier = Modifier
              .weight(1f)
              .clip(RoundedCornerShape(6.dp))
              .clickable { onOpenTeam(right.id) },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.End
          ) {
            Text(
              text = right.shortName,
              style = MaterialTheme.typography.labelMedium,
              fontWeight = FontWeight.Bold,
              maxLines = 1,
              overflow = TextOverflow.Ellipsis
            )
            Spacer(Modifier.width(5.dp))
            TeamLogo(logoUrl = right.logo, abbreviation = right.abbreviation, colorHex = right.color, size = 22.dp)
          }
        }
      }
    }
  }
}

@Composable
private fun FarthestSchoolCard(
  row: SchoolFarthestRow,
  expanded: Boolean,
  state: AppUiState,
  onToggleExpand: () -> Unit,
  onCompareMatchup: (String, String) -> Unit,
  onOpenTeam: (String) -> Unit,
  onOpenGame: (String) -> Unit
) {
  val team = resolveTeamUi(row.teamId, state)
  val ext = CfbTheme.extended

  Card(
    shape = RoundedCornerShape(14.dp),
    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLowest),
    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)
  ) {
    Column(modifier = Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
      Row(
        modifier = Modifier
          .fillMaxWidth()
          .clickable(onClick = onToggleExpand),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween
      ) {
        Row(
          modifier = Modifier.weight(1f),
          verticalAlignment = Alignment.CenterVertically,
          horizontalArrangement = Arrangement.spacedBy(10.dp)
        ) {
          TeamLogo(logoUrl = team.logo, abbreviation = team.abbreviation, colorHex = team.color, size = 34.dp)
          Column(modifier = Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
              RankBadge(team.rank)
              Text(
                text = team.displayName,
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.Bold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
              )
            }
            Text(
              text = "${team.division} · ${row.wins}-${row.losses} in graph",
              style = MaterialTheme.typography.bodySmall,
              color = MaterialTheme.colorScheme.onSurfaceVariant
            )
          }
        }
        Icon(
          imageVector = if (expanded) Icons.Rounded.ExpandLess else Icons.Rounded.ExpandMore,
          contentDescription = null
        )
      }

      Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp)
      ) {
        FarthestMetricBadge(
          label = "Farthest Win",
          res = row.farthestWin,
          isWin = true,
          state = state,
          modifier = Modifier.weight(1f)
        )
        FarthestMetricBadge(
          label = "Farthest Loss",
          res = row.farthestLoss,
          isWin = false,
          state = state,
          modifier = Modifier.weight(1f)
        )
      }

      if (expanded) {
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))
        if (row.farthestWin.degree != null && row.farthestWin.targetId != null) {
          val targetW = resolveTeamUi(row.farthestWin.targetId, state)
          Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
          ) {
            Text(
              text = "Win Path to ${targetW.shortName} (Degree ${row.farthestWin.degree})",
              style = MaterialTheme.typography.labelLarge,
              color = ext.win,
              fontWeight = FontWeight.Bold,
              modifier = Modifier.weight(1f)
            )
            FilledTonalButton(
              onClick = { onCompareMatchup(row.teamId, row.farthestWin.targetId) },
              contentPadding = PaddingValues(horizontal = 10.dp, vertical = 4.dp)
            ) {
              Text("Compare", style = MaterialTheme.typography.labelSmall)
              Spacer(Modifier.width(3.dp))
              Icon(Icons.AutoMirrored.Rounded.ArrowForward, contentDescription = null, modifier = Modifier.size(13.dp))
            }
          }
          ChainStepsList(
            teamIds = row.farthestWin.teamIds,
            games = row.farthestWin.games,
            isWin = true,
            state = state,
            onOpenTeam = onOpenTeam,
            onOpenGame = onOpenGame
          )
        }
        if (row.farthestLoss.degree != null && row.farthestLoss.targetId != null) {
          val targetL = resolveTeamUi(row.farthestLoss.targetId, state)
          Row(
            modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
          ) {
            Text(
              text = "Loss Path to ${targetL.shortName} (Degree ${row.farthestLoss.degree})",
              style = MaterialTheme.typography.labelLarge,
              color = MaterialTheme.colorScheme.error,
              fontWeight = FontWeight.Bold,
              modifier = Modifier.weight(1f)
            )
            FilledTonalButton(
              onClick = { onCompareMatchup(row.teamId, row.farthestLoss.targetId) },
              contentPadding = PaddingValues(horizontal = 10.dp, vertical = 4.dp)
            ) {
              Text("Compare", style = MaterialTheme.typography.labelSmall)
              Spacer(Modifier.width(3.dp))
              Icon(Icons.AutoMirrored.Rounded.ArrowForward, contentDescription = null, modifier = Modifier.size(13.dp))
            }
          }
          ChainStepsList(
            teamIds = row.farthestLoss.teamIds,
            games = row.farthestLoss.games,
            isWin = false,
            state = state,
            onOpenTeam = onOpenTeam,
            onOpenGame = onOpenGame
          )
        }
      }
    }
  }
}

@Composable
private fun FarthestMetricBadge(
  label: String,
  res: FarthestChainResult,
  isWin: Boolean,
  state: AppUiState,
  modifier: Modifier = Modifier
) {
  val ext = CfbTheme.extended
  val targetTeam = res.targetId?.let { resolveTeamUi(it, state) }
  Surface(
    modifier = modifier,
    shape = RoundedCornerShape(10.dp),
    color = if (isWin) ext.winContainer.copy(alpha = 0.45f)
    else MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.45f)
  ) {
    Column(modifier = Modifier.padding(8.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
      Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
      if (res.degree != null && targetTeam != null) {
        Text(
          text = "Degree ${res.degree}",
          style = MaterialTheme.typography.titleSmall,
          fontWeight = FontWeight.ExtraBold,
          color = if (isWin) ext.win else MaterialTheme.colorScheme.error
        )
        Text(
          text = "-> ${targetTeam.shortName}",
          style = MaterialTheme.typography.bodySmall,
          maxLines = 1,
          overflow = TextOverflow.Ellipsis
        )
      } else {
        Text(
          text = if (isWin) "None" else "None / Undefeated",
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant
        )
      }
    }
  }
}

@Composable
private fun TeamPickerDialog(
  title: String,
  catalog: List<TeamDirectoryItem>,
  selectedId: String?,
  oppositeId: String?,
  onDismiss: () -> Unit,
  onPick: (String) -> Unit
) {
  var query by remember { mutableStateOf("") }
  var divFilter by remember { mutableStateOf("all") }

  val filtered = remember(catalog, query, divFilter) {
    val q = query.trim().lowercase()
    catalog
      .filter { t ->
        if (divFilter != "all" && t.division != divFilter) return@filter false
        if (q.isNotEmpty()) {
          val hay = "${t.displayName} ${t.shortName} ${t.abbreviation} ${t.conferenceShortName}".lowercase()
          if (!hay.contains(q)) return@filter false
        }
        true
      }
      .take(100)
  }

  AlertDialog(
    onDismissRequest = onDismiss,
    title = { Text(title, fontWeight = FontWeight.Bold) },
    text = {
      Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedTextField(
          value = query,
          onValueChange = { query = it },
          placeholder = { Text("Search FBS or FCS team...") },
          leadingIcon = { Icon(Icons.Rounded.Search, contentDescription = null) },
          singleLine = true,
          modifier = Modifier.fillMaxWidth()
        )
        SegmentedOptionRow(
          options = listOf("all" to "All", "FBS" to "FBS", "FCS" to "FCS"),
          selectedKey = divFilter,
          onSelect = { divFilter = it }
        )
        LazyColumn(
          modifier = Modifier
            .fillMaxWidth()
            .heightIn(max = 320.dp),
          verticalArrangement = Arrangement.spacedBy(4.dp)
        ) {
          items(filtered, key = { it.id }) { team ->
            val isSelected = team.id == selectedId
            val isOpposite = team.id == oppositeId
            Surface(
              modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(10.dp))
                .clickable(enabled = !isOpposite) { onPick(team.id) },
              color = if (isSelected) MaterialTheme.colorScheme.primaryContainer
              else MaterialTheme.colorScheme.surfaceContainerLow
            ) {
              Row(
                modifier = Modifier.padding(horizontal = 10.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
              ) {
                TeamLogo(logoUrl = team.logo, abbreviation = team.abbreviation, colorHex = team.color, size = 26.dp)
                Column(modifier = Modifier.weight(1f)) {
                  Text(
                    text = team.displayName,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                  )
                  Text(
                    text = listOf(team.division, team.conferenceShortName, team.overallRecord)
                      .filter { it.isNotBlank() }
                      .joinToString(" · "),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                  )
                }
                if (isOpposite) {
                  Text("Other", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
              }
            }
          }
        }
      }
    },
    confirmButton = {
      TextButton(onClick = onDismiss) { Text("Close") }
    }
  )
}
