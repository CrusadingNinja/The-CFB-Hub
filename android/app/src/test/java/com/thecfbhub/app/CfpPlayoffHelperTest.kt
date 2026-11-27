package com.thecfbhub.app

import com.thecfbhub.app.data.model.CommitteeG6Selection
import com.thecfbhub.app.data.model.RankedTeamRow
import com.thecfbhub.app.data.model.TeamDirectoryItem
import com.thecfbhub.app.util.CfpPlayoffHelper
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CfpPlayoffHelperTest {

  private fun rankedRow(rank: Int, name: String, confId: String, confShort: String = "") =
    RankedTeamRow(
      id = rank.toString(),
      displayName = name,
      shortName = name,
      abbreviation = name.take(4).uppercase(),
      conferenceId = confId,
      conferenceShortName = confShort,
      current = rank
    )

  private fun buildField(g6Rank: Int? = null): List<RankedTeamRow> {
    val rows = mutableListOf<RankedTeamRow>()
    for (r in 1..25) {
      if (g6Rank != null && r == g6Rank) {
        rows.add(rankedRow(r, "Boise State", "9", "Pac-12"))
      } else {
        rows.add(rankedRow(r, "P4 Team $r", "8", "SEC"))
      }
    }
    return rows
  }

  @Test
  fun computeCfpPlayoffInfo_g6InTop12_keepsCutoffAt12() {
    val info = CfpPlayoffHelper.computeCfpPlayoffInfo(buildField(g6Rank = 10))
    assertEquals(12, info.cutoffRank)
    assertFalse(info.g6OutsideTop12)
    assertFalse(info.g6Unranked)
    assertEquals(10, info.topG6Team?.current)
  }

  @Test
  fun computeCfpPlayoffInfo_g6Ranked17_setsCutoffTo11() {
    val info = CfpPlayoffHelper.computeCfpPlayoffInfo(buildField(g6Rank = 17))
    assertEquals(11, info.cutoffRank)
    assertTrue(info.g6OutsideTop12)
    assertFalse(info.g6Unranked)
    assertEquals(17, info.topG6Team?.current)
  }

  @Test
  fun computeCfpPlayoffInfo_noG6InTop25_setsCutoffTo11WithUnrankedSlot() {
    val info = CfpPlayoffHelper.computeCfpPlayoffInfo(buildField(g6Rank = null))
    assertEquals(11, info.cutoffRank)
    assertTrue(info.g6OutsideTop12)
    assertTrue(info.g6Unranked)
    assertNull(info.topG6Team)
    assertNull(info.committeeG6Team)
  }

  @Test
  fun computeCfpPlayoffInfo_committeeUnrankedSelection_resolvesFromDroppedOutAndDirectory() {
    val droppedBoise = RankedTeamRow(
      id = "68",
      displayName = "Boise State Broncos",
      shortName = "Boise St",
      abbreviation = "BOIS",
      logo = "https://a.espncdn.com/i/teamlogos/ncaa/500/68.png",
      conferenceId = "9",
      conferenceShortName = "Pac-12",
      current = 0,
      previous = 17,
      recordSummary = "9-1"
    )
    val info = CfpPlayoffHelper.computeCfpPlayoffInfo(
      allRanks = buildField(g6Rank = null),
      committeeUnrankedG6 = CommitteeG6Selection(
        teamName = "Boise State",
        sourceUrl = "https://collegefootballplayoff.com/news/2026/11/24/rankings",
        excerpt = "The CFP selection committee selected Boise State as the best team from the remaining conferences."
      ),
      droppedOut = listOf(droppedBoise)
    )
    assertEquals(11, info.cutoffRank)
    assertTrue(info.g6Unranked)
    assertNotNull(info.committeeG6Team)
    assertEquals("68", info.committeeG6Team?.id)
    assertEquals("Boise St", info.committeeG6Team?.shortName)
    assertEquals("Pac-12", info.committeeG6Team?.conferenceShortName)
    assertEquals(17, info.committeeG6Team?.previous)
  }

  @Test
  fun computeCfpPlayoffInfo_committeeUnrankedSelection_resolvesFromTeamsDirectoryWhenNotInDroppedOut() {
    val memphisDir = TeamDirectoryItem(
      id = "235",
      displayName = "Memphis Tigers",
      shortName = "Memphis",
      location = "Memphis",
      abbreviation = "MEM",
      logo = "https://a.espncdn.com/i/teamlogos/ncaa/500/235.png",
      division = "FBS",
      conferenceId = "151",
      conferenceShortName = "American",
      overallRecord = "10-2"
    )
    val info = CfpPlayoffHelper.computeCfpPlayoffInfo(
      allRanks = buildField(g6Rank = null),
      committeeUnrankedG6 = CommitteeG6Selection(teamName = "Memphis"),
      teamsDirectory = listOf(memphisDir)
    )
    assertNotNull(info.committeeG6Team)
    assertEquals("235", info.committeeG6Team?.id)
    assertEquals("Memphis", info.committeeG6Team?.shortName)
    assertEquals("American", info.committeeG6Team?.conferenceShortName)
    assertEquals("10-2", info.committeeG6Team?.recordSummary)
  }
}
