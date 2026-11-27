package com.thecfbhub.app.util

import com.thecfbhub.app.data.model.CommitteeG6Selection
import com.thecfbhub.app.data.model.RankedTeamRow
import com.thecfbhub.app.data.model.TeamDirectoryItem
import java.text.Normalizer

data class ResolvedCommitteeG6Team(
  val id: String,
  val displayName: String,
  val shortName: String,
  val abbreviation: String,
  val logo: String = "",
  val color: String? = null,
  val conferenceId: String? = null,
  val conferenceShortName: String = "",
  val recordSummary: String = "",
  val previous: Int = 0,
  val sourceUrl: String = "",
  val excerpt: String = ""
)

data class CfpPlayoffInfo(
  val topG6Team: RankedTeamRow?,
  val g6OutsideTop12: Boolean,
  val g6Unranked: Boolean,
  val cutoffRank: Int,
  val committeeG6Team: ResolvedCommitteeG6Team? = null
)

/**
 * Resolves the 12-team CFP Playoff field cutoff and Group of 6 automatic qualifier slot.
 */
object CfpPlayoffHelper {
  val POWER_4_CONFERENCE_IDS = setOf("1", "4", "5", "8")
  val GROUP_OF_6_CONFERENCE_IDS = setOf("9", "12", "15", "17", "37", "151")
  const val FBS_INDEPENDENT_CONFERENCE_ID = "18"

  private val G6_CONF_REGEX = Regex(
    "^(Pac-12|American|AAC|Mountain West|MWC|Sun Belt|SBC|MAC|Mid-American|CUSA|Conf\\.?\\s*USA)$",
    RegexOption.IGNORE_CASE
  )

  fun isGroupOf6Team(row: RankedTeamRow): Boolean =
    isGroupOf6Conference(row.conferenceId, row.conferenceShortName)

  fun isGroupOf6Conference(conferenceId: String?, conferenceShortName: String): Boolean {
    val cid = conferenceId?.trim().orEmpty()
    if (cid.isNotEmpty()) {
      if (GROUP_OF_6_CONFERENCE_IDS.contains(cid)) return true
      return !POWER_4_CONFERENCE_IDS.contains(cid) && cid != FBS_INDEPENDENT_CONFERENCE_ID
    }
    return G6_CONF_REGEX.matches(conferenceShortName.trim())
  }

  private fun normalizeTeamMatchKey(name: String): String {
    val decomposed = Normalizer.normalize(name, Normalizer.Form.NFD)
      .replace(Regex("[\\p{InCombiningDiacriticalMarks}]"), "")
    return decomposed
      .lowercase()
      .replace("’", "")
      .replace("'", "")
      .replace("&", " and ")
      .replace(Regex("[^a-z0-9\\s]"), " ")
      .replace(Regex("\\s+"), " ")
      .trim()
  }

  private fun matchScoreForFields(fields: List<String>, normTarget: String, altTarget: String): Int {
    if (normTarget.isEmpty()) return 0
    val normalized = fields.map { normalizeTeamMatchKey(it) }.filter { it.isNotEmpty() }
    for (f in normalized) {
      if (f == normTarget || f == altTarget) return 4
    }
    for (f in normalized) {
      if (f.startsWith("$normTarget ") || f.startsWith("$altTarget ")) return 3
    }
    return 0
  }

  fun resolveCommitteeG6Team(
    selection: CommitteeG6Selection,
    droppedOut: List<RankedTeamRow> = emptyList(),
    others: List<RankedTeamRow> = emptyList(),
    teamsDirectory: List<TeamDirectoryItem> = emptyList()
  ): ResolvedCommitteeG6Team {
    val rawName = selection.teamName.trim()
    val normTarget = normalizeTeamMatchKey(rawName)
    val altTarget = if (normTarget.contains(" state")) {
      normTarget.replace(Regex("\\bstate\\b"), "st")
    } else {
      normTarget.replace(Regex("\\bst\\b"), "state")
    }

    var bestPoll: RankedTeamRow? = null
    var bestPollScore = 0
    for (entry in droppedOut + others) {
      val score = matchScoreForFields(listOf(entry.shortName, entry.displayName), normTarget, altTarget)
      if (score > bestPollScore) {
        bestPollScore = score
        bestPoll = entry
      }
    }

    var bestDir: TeamDirectoryItem? = null
    var bestDirScore = 0
    for (entry in teamsDirectory) {
      if (bestPoll != null && entry.id == bestPoll.id) {
        bestDir = entry
        break
      }
      val baseScore = matchScoreForFields(
        listOf(entry.location, entry.shortName, entry.displayName),
        normTarget,
        altTarget
      )
      if (baseScore == 0) continue
      var totalScore = baseScore * 10
      if (entry.division == "FBS") totalScore += 3
      if (isGroupOf6Conference(entry.conferenceId, entry.conferenceShortName)) totalScore += 2
      if (totalScore > bestDirScore) {
        bestDirScore = totalScore
        bestDir = entry
      }
    }

    val confId = bestPoll?.conferenceId ?: bestDir?.conferenceId?.takeIf { it.isNotBlank() }
    val confShort = bestPoll?.conferenceShortName?.takeIf { it.isNotBlank() }
      ?: bestDir?.conferenceShortName?.takeIf { it.isNotBlank() }
      ?: ""

    val fallbackAbbr = rawName.replace(Regex("[^A-Za-z]"), "").take(4).uppercase().ifEmpty { "G6" }

    return ResolvedCommitteeG6Team(
      id = bestPoll?.id?.takeIf { it.isNotBlank() } ?: bestDir?.id.orEmpty(),
      displayName = bestPoll?.displayName?.takeIf { it.isNotBlank() }
        ?: bestDir?.displayName?.takeIf { it.isNotBlank() }
        ?: rawName,
      shortName = bestPoll?.shortName?.takeIf { it.isNotBlank() }
        ?: bestDir?.shortName?.takeIf { it.isNotBlank() }
        ?: rawName,
      abbreviation = bestPoll?.abbreviation?.takeIf { it.isNotBlank() }
        ?: bestDir?.abbreviation?.takeIf { it.isNotBlank() }
        ?: fallbackAbbr,
      logo = bestPoll?.logo?.takeIf { it.isNotBlank() } ?: bestDir?.logo.orEmpty(),
      color = bestPoll?.color ?: bestDir?.color,
      conferenceId = confId,
      conferenceShortName = confShort,
      recordSummary = bestPoll?.recordSummary?.takeIf { it.isNotBlank() }
        ?: bestDir?.overallRecord.orEmpty(),
      previous = bestPoll?.previous ?: 0,
      sourceUrl = selection.sourceUrl,
      excerpt = selection.excerpt
    )
  }

  fun computeCfpPlayoffInfo(
    allRanks: List<RankedTeamRow>,
    committeeUnrankedG6: CommitteeG6Selection? = null,
    droppedOut: List<RankedTeamRow> = emptyList(),
    others: List<RankedTeamRow> = emptyList(),
    teamsDirectory: List<TeamDirectoryItem> = emptyList()
  ): CfpPlayoffInfo {
    val ranked = allRanks
      .filter { it.current > 0 }
      .sortedBy { it.current }
    val topG6Team = ranked.firstOrNull { isGroupOf6Team(it) }
    val hasRankedG6InTop12 = topG6Team != null && topG6Team.current <= 12
    val g6Unranked = ranked.size >= 12 && topG6Team == null
    val g6OutsideTop12 = ranked.size >= 12 && !hasRankedG6InTop12
    val cutoffRank = if (g6OutsideTop12) 11 else 12
    val committeeG6Team = if (g6Unranked && committeeUnrankedG6 != null && committeeUnrankedG6.teamName.isNotBlank()) {
      resolveCommitteeG6Team(
        selection = committeeUnrankedG6,
        droppedOut = droppedOut,
        others = others,
        teamsDirectory = teamsDirectory
      )
    } else null

    return CfpPlayoffInfo(
      topG6Team = topG6Team,
      g6OutsideTop12 = g6OutsideTop12,
      g6Unranked = g6Unranked,
      cutoffRank = cutoffRank,
      committeeG6Team = committeeG6Team
    )
  }
}
