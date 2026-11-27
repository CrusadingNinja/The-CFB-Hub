package com.thecfbhub.app

import com.thecfbhub.app.data.model.SeasonResultGame
import com.thecfbhub.app.data.model.SeasonResultsGraph
import com.thecfbhub.app.util.TransitiveEngine
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TransitiveEngineTest {

  private fun game(
    id: String,
    winnerId: String,
    loserId: String,
    winnerScore: Int = 28,
    loserScore: Int = 14,
    date: String = "2026-10-10T18:00Z"
  ) = SeasonResultGame(
    id = id,
    date = date,
    winnerId = winnerId,
    loserId = loserId,
    winnerScore = winnerScore,
    loserScore = loserScore,
    margin = winnerScore - loserScore
  )

  @Test
  fun findTransitiveChains_directAndMultiDegree_ordersLowestFirstAndExcludesEndpoints() {
    val games = listOf(
      // Direct Degree 0: A beats B
      game("g0", "A", "B", 24, 17),
      // Degree 1: A -> C -> B
      game("g1", "A", "C", 35, 7),
      game("g2", "C", "B", 21, 14),
      // Degree 1: A -> D -> B
      game("g3", "A", "D", 31, 10),
      game("g4", "D", "B", 28, 24),
      // Degree 2: A -> E -> F -> B
      game("g5", "A", "E", 42, 0),
      game("g6", "E", "F", 24, 21),
      game("g7", "F", "B", 17, 10),
      // Cycle containing A/B that must never become an intermediate: B -> G -> A
      game("g8", "B", "G", 20, 10),
      game("g9", "G", "A", 14, 10)
    )

    val winChains = TransitiveEngine.findTransitiveChains(games, "A", "B", mode = "wins", maxChains = 5)
    assertEquals(4, winChains.size)
    assertEquals(0, winChains[0].degree)
    assertEquals(listOf("A", "B"), winChains[0].teamIds)
    assertEquals(1, winChains[1].degree)
    assertEquals(1, winChains[2].degree)
    assertEquals(2, winChains[3].degree)

    for (chain in winChains) {
      assertTrue(!chain.intermediateIds.contains("A"))
      assertTrue(!chain.intermediateIds.contains("B"))
    }
  }

  @Test
  fun findTransitiveChains_capsAtFiveAndFavorsDiverseIntermediates() {
    val games = mutableListOf<SeasonResultGame>()
    // 6 distinct Degree-1 paths A -> X_i -> B
    for (i in 1..6) {
      val mid = "M$i"
      games.add(game("w1-$i", "A", mid, 30 + i, 10))
      games.add(game("w2-$i", mid, "B", 20 + i, 14))
    }

    val chains = TransitiveEngine.findTransitiveChains(games, "A", "B", mode = "wins", maxChains = 5)
    assertEquals(5, chains.size)
    val distinctIntermediates = chains.flatMap { it.intermediateIds }.toSet()
    assertEquals(5, distinctIntermediates.size)
  }

  @Test
  fun computeTransitiveComparison_returnsBothWinAndLossChains() {
    val games = listOf(
      game("1", "A", "C", 28, 14),
      game("2", "C", "B", 21, 10),
      // Reverse loss path: B > D > A => A < D < B
      game("3", "B", "D", 35, 17),
      game("4", "D", "A", 17, 14)
    )
    val graph = SeasonResultsGraph(
      seasonYear = 2026,
      generatedAt = 1L,
      completedCount = games.size,
      teamCount = 4,
      games = games
    )

    val comp = TransitiveEngine.computeTransitiveComparison(graph, "A", "B")
    assertEquals(1, comp.winChains.size)
    assertEquals(1, comp.winChains[0].degree)
    assertEquals(listOf("A", "C", "B"), comp.winChains[0].teamIds)

    assertEquals(1, comp.lossChains.size)
    assertEquals(1, comp.lossChains[0].degree)
    assertEquals(listOf("A", "D", "B"), comp.lossChains[0].teamIds)
  }

  @Test
  fun computeSchoolFarthestChains_findsExactMinimumDegreeEccentricity() {
    val games = listOf(
      game("1", "A", "B", 28, 7),
      game("2", "B", "C", 24, 17),
      game("3", "C", "D", 31, 21)
    )
    val graph = SeasonResultsGraph(
      seasonYear = 2026,
      generatedAt = 1L,
      completedCount = games.size,
      teamCount = 4,
      games = games
    )

    val rows = TransitiveEngine.computeSchoolFarthestChains(
      graph,
      schoolIds = listOf("A", "D"),
      eligibleTargetIds = setOf("A", "B", "C", "D")
    )
    val rowA = rows.first { it.teamId == "A" }
    val rowD = rows.first { it.teamId == "D" }

    assertEquals("D", rowA.farthestWin.targetId)
    assertEquals(2, rowA.farthestWin.degree)
    assertEquals(listOf("A", "B", "C", "D"), rowA.farthestWin.teamIds)

    assertEquals("A", rowD.farthestLoss.targetId)
    assertEquals(2, rowD.farthestLoss.degree)
    assertEquals(listOf("D", "C", "B", "A"), rowD.farthestLoss.teamIds)
  }
}
