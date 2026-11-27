package com.thecfbhub.app.util

import com.thecfbhub.app.data.model.FarthestChainResult
import com.thecfbhub.app.data.model.SchoolFarthestRow
import com.thecfbhub.app.data.model.SeasonResultGame
import com.thecfbhub.app.data.model.SeasonResultsGraph
import com.thecfbhub.app.data.model.TransitiveChain
import com.thecfbhub.app.data.model.TransitiveComparison
import com.thecfbhub.app.data.model.TransitiveStats
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min

/**
 * Pure graph builder and shortest-degree diverse transitive chain solver for Transitive W/Ls.
 */
object TransitiveEngine {
  private const val MAX_CANDIDATES_PER_DEGREE = 2500

  data class DirectedEdge(
    val fromId: String,
    val toId: String,
    val margin: Int,
    val game: SeasonResultGame
  )

  data class TeamRecord(
    var wins: Int = 0,
    var losses: Int = 0
  )

  data class DirectedGraph(
    val forward: Map<String, List<DirectedEdge>>,
    val reverse: Map<String, List<String>>,
    val teamRecordMap: Map<String, TeamRecord>
  )

  fun buildDirectedGraph(games: List<SeasonResultGame>, mode: String = "wins"): DirectedGraph {
    val pairBest = HashMap<String, DirectedEdge>(games.size * 2)
    val teamRecordMap = HashMap<String, TeamRecord>()

    fun bumpRecord(teamId: String, isWin: Boolean) {
      val rec = teamRecordMap.getOrPut(teamId) { TeamRecord() }
      if (isWin) rec.wins += 1 else rec.losses += 1
    }

    for (g in games) {
      val wId = g.winnerId
      val lId = g.loserId
      if (wId.isEmpty() || lId.isEmpty() || wId == lId) continue

      bumpRecord(wId, true)
      bumpRecord(lId, false)

      val fromId = if (mode == "losses") lId else wId
      val toId = if (mode == "losses") wId else lId
      val margin = if (g.margin != 0) g.margin else abs(g.winnerScore - g.loserScore)
      val pairKey = "$fromId->$toId"
      val existing = pairBest[pairKey]

      if (existing == null ||
        margin > existing.margin ||
        (margin == existing.margin && g.date > existing.game.date)
      ) {
        pairBest[pairKey] = DirectedEdge(
          fromId = fromId,
          toId = toId,
          margin = margin,
          game = g
        )
      }
    }

    val forward = HashMap<String, MutableList<DirectedEdge>>()
    val reverse = HashMap<String, MutableList<String>>()

    for (edge in pairBest.values) {
      forward.getOrPut(edge.fromId) { ArrayList() }.add(edge)
      reverse.getOrPut(edge.toId) { ArrayList() }.add(edge.fromId)
    }

    val comparator = Comparator<DirectedEdge> { a, b ->
      if (b.margin != a.margin) {
        b.margin.compareTo(a.margin)
      } else {
        b.game.date.compareTo(a.game.date)
      }
    }
    for (edges in forward.values) {
      edges.sortWith(comparator)
    }

    return DirectedGraph(
      forward = forward,
      reverse = reverse,
      teamRecordMap = teamRecordMap
    )
  }

  private fun computeReverseDistances(
    reverseAdj: Map<String, List<String>>,
    targetId: String,
    excludedSourceId: String
  ): Map<String, Int> {
    val dist = HashMap<String, Int>()
    dist[targetId] = 0
    val queue = ArrayDeque<String>()
    queue.addLast(targetId)

    while (queue.isNotEmpty()) {
      val curr = queue.removeFirst()
      val currDist = dist[curr] ?: 0
      val preds = reverseAdj[curr] ?: continue
      for (prev in preds) {
        if (dist.containsKey(prev)) continue
        dist[prev] = currDist + 1
        // Never expand through Team A so shortest remaining paths never route via Team A
        if (prev != excludedSourceId) {
          queue.addLast(prev)
        }
      }
    }
    return dist
  }

  private data class SelectionScore(
    val distinctOverlap: Int,
    val totalReuse: Int,
    val totalMargin: Int,
    val minMargin: Int
  )

  private fun selectDiverseChains(
    candidates: List<TransitiveChain>,
    neededCount: Int,
    usedIntermediates: MutableMap<String, Int>
  ): List<TransitiveChain> {
    if (candidates.isEmpty() || neededCount <= 0) return emptyList()
    val pool = candidates.toMutableList()
    val chosen = ArrayList<TransitiveChain>(min(neededCount, candidates.size))

    while (chosen.size < neededCount && pool.isNotEmpty()) {
      var bestIdx = 0
      var bestScore: SelectionScore? = null

      for (i in pool.indices) {
        val cand = pool[i]
        var distinctOverlap = 0
        var totalReuse = 0
        for (tid in cand.intermediateIds) {
          val useCount = usedIntermediates[tid] ?: 0
          if (useCount > 0) {
            distinctOverlap += 1
            totalReuse += useCount
          }
        }

        val currentBest = bestScore
        val better = currentBest == null ||
          distinctOverlap < currentBest.distinctOverlap ||
          (distinctOverlap == currentBest.distinctOverlap && totalReuse < currentBest.totalReuse) ||
          (distinctOverlap == currentBest.distinctOverlap &&
            totalReuse == currentBest.totalReuse &&
            cand.totalMargin > currentBest.totalMargin) ||
          (distinctOverlap == currentBest.distinctOverlap &&
            totalReuse == currentBest.totalReuse &&
            cand.totalMargin == currentBest.totalMargin &&
            cand.minMargin > currentBest.minMargin)

        if (better) {
          bestIdx = i
          bestScore = SelectionScore(
            distinctOverlap = distinctOverlap,
            totalReuse = totalReuse,
            totalMargin = cand.totalMargin,
            minMargin = cand.minMargin
          )
        }
      }

      val picked = pool.removeAt(bestIdx)
      chosen.add(picked)
      for (tid in picked.intermediateIds) {
        usedIntermediates[tid] = (usedIntermediates[tid] ?: 0) + 1
      }
    }

    return chosen
  }

  private fun collectSimplePathsOfLength(
    forward: Map<String, List<DirectedEdge>>,
    directToTargetMap: Map<String, DirectedEdge>,
    minEdgesToB: Map<String, Int>,
    teamAId: String,
    teamBId: String,
    targetEdges: Int,
    maxCandidates: Int = MAX_CANDIDATES_PER_DEGREE
  ): List<TransitiveChain> {
    if (targetEdges == 1) {
      val directEdge = directToTargetMap[teamAId] ?: return emptyList()
      return listOf(
        TransitiveChain(
          degree = 0,
          edgeCount = 1,
          teamIds = listOf(teamAId, teamBId),
          intermediateIds = emptyList(),
          games = listOf(directEdge.game),
          totalMargin = directEdge.margin,
          minMargin = directEdge.margin
        )
      )
    }

    val firstEdges = (forward[teamAId] ?: emptyList()).filter { edge ->
      if (edge.toId == teamAId || edge.toId == teamBId) {
        false
      } else {
        val rem = minEdgesToB[edge.toId]
        rem != null && 1 + rem <= targetEdges
      }
    }
    if (firstEdges.isEmpty()) return emptyList()

    val candidates = ArrayList<TransitiveChain>()
    val perBranchCap = max(80, ceil(maxCandidates.toDouble() / firstEdges.size).toInt())

    val visited = HashSet<String>(listOf(teamAId, teamBId))
    val pathTeams = ArrayList<String>(targetEdges + 1).apply { add(teamAId) }
    val pathEdges = ArrayList<DirectedEdge>(targetEdges)

    for (firstEdge in firstEdges) {
      if (candidates.size >= maxCandidates) break
      var branchCollected = 0

      fun dfs(currNode: String, depth: Int) {
        if (branchCollected >= perBranchCap || candidates.size >= maxCandidates) return

        if (depth == targetEdges - 1) {
          val closingEdge = directToTargetMap[currNode] ?: return

          var totalMargin = 0
          var minMargin = Int.MAX_VALUE
          val gamesOut = ArrayList<SeasonResultGame>(targetEdges)
          for (e in pathEdges) {
            totalMargin += e.margin
            if (e.margin < minMargin) minMargin = e.margin
            gamesOut.add(e.game)
          }
          totalMargin += closingEdge.margin
          if (closingEdge.margin < minMargin) minMargin = closingEdge.margin
          gamesOut.add(closingEdge.game)

          val teamsSnapshot = ArrayList<String>(pathTeams.size + 1).apply {
            addAll(pathTeams)
            add(teamBId)
          }
          val intermediatesSnapshot = if (pathTeams.size > 1) {
            pathTeams.subList(1, pathTeams.size).toList()
          } else {
            emptyList()
          }

          candidates.add(
            TransitiveChain(
              degree = targetEdges - 1,
              edgeCount = targetEdges,
              teamIds = teamsSnapshot,
              intermediateIds = intermediatesSnapshot,
              games = gamesOut,
              totalMargin = totalMargin,
              minMargin = if (minMargin == Int.MAX_VALUE) 0 else minMargin
            )
          )
          branchCollected += 1
          return
        }

        val nextEdges = forward[currNode] ?: return
        for (edge in nextEdges) {
          if (branchCollected >= perBranchCap || candidates.size >= maxCandidates) break
          val nextId = edge.toId
          if (visited.contains(nextId)) continue

          val rem = minEdgesToB[nextId] ?: continue
          if (depth + 1 + rem > targetEdges) continue

          visited.add(nextId)
          pathTeams.add(nextId)
          pathEdges.add(edge)

          dfs(nextId, depth + 1)

          pathEdges.removeAt(pathEdges.lastIndex)
          pathTeams.removeAt(pathTeams.lastIndex)
          visited.remove(nextId)
        }
      }

      visited.add(firstEdge.toId)
      pathTeams.add(firstEdge.toId)
      pathEdges.add(firstEdge)

      dfs(firstEdge.toId, 1)

      pathEdges.removeAt(pathEdges.lastIndex)
      pathTeams.removeAt(pathTeams.lastIndex)
      visited.remove(firstEdge.toId)
    }

    return candidates
  }

  fun findTransitiveChains(
    games: List<SeasonResultGame>,
    teamAId: String,
    teamBId: String,
    mode: String = "wins",
    maxChains: Int = 5,
    maxEdges: Int = 25,
    prebuiltGraph: DirectedGraph? = null
  ): List<TransitiveChain> {
    val aId = teamAId.trim()
    val bId = teamBId.trim()
    if (aId.isEmpty() || bId.isEmpty() || aId == bId) return emptyList()

    val graph = prebuiltGraph ?: buildDirectedGraph(games, mode)
    val minEdgesToB = computeReverseDistances(graph.reverse, bId, aId)
    val minStartEdges = minEdgesToB[aId] ?: return emptyList()
    if (minStartEdges > maxEdges) return emptyList()

    val directToTargetMap = HashMap<String, DirectedEdge>()
    val bPreds = graph.reverse[bId] ?: emptyList()
    for (predId in bPreds) {
      val hit = graph.forward[predId]?.firstOrNull { it.toId == bId }
      if (hit != null) {
        directToTargetMap[predId] = hit
      }
    }

    val selected = ArrayList<TransitiveChain>(maxChains)
    val usedIntermediates = HashMap<String, Int>()

    var targetEdges = minStartEdges
    while (targetEdges <= maxEdges && selected.size < maxChains) {
      val candidates = collectSimplePathsOfLength(
        forward = graph.forward,
        directToTargetMap = directToTargetMap,
        minEdgesToB = minEdgesToB,
        teamAId = aId,
        teamBId = bId,
        targetEdges = targetEdges
      )
      if (candidates.isNotEmpty()) {
        val needed = maxChains - selected.size
        selected.addAll(selectDiverseChains(candidates, needed, usedIntermediates))
      }
      targetEdges += 1
    }

    return selected
  }

  fun computeTransitiveComparison(
    seasonGraph: SeasonResultsGraph,
    teamAId: String,
    teamBId: String,
    maxChains: Int = 5
  ): TransitiveComparison {
    val games = seasonGraph.games
    val aId = teamAId.trim()
    val bId = teamBId.trim()

    val winGraph = buildDirectedGraph(games, "wins")
    val lossGraph = buildDirectedGraph(games, "losses")

    val winChains = findTransitiveChains(
      games = games,
      teamAId = aId,
      teamBId = bId,
      mode = "wins",
      maxChains = maxChains,
      prebuiltGraph = winGraph
    )
    val lossChains = findTransitiveChains(
      games = games,
      teamAId = aId,
      teamBId = bId,
      mode = "losses",
      maxChains = maxChains,
      prebuiltGraph = lossGraph
    )

    val recA = winGraph.teamRecordMap[aId] ?: TeamRecord()
    val recB = winGraph.teamRecordMap[bId] ?: TeamRecord()

    return TransitiveComparison(
      winChains = winChains,
      lossChains = lossChains,
      stats = TransitiveStats(
        teamAWins = recA.wins,
        teamALosses = recA.losses,
        teamBWins = recB.wins,
        teamBLosses = recB.losses,
        completedCount = games.size
      )
    )
  }

  fun findFarthestChainFromTeam(
    forward: Map<String, List<DirectedEdge>>,
    sourceId: String,
    eligibleTargetSet: Set<String>? = null
  ): FarthestChainResult {
    val src = sourceId.trim()
    if (src.isEmpty()) {
      return FarthestChainResult(
        degree = null,
        edgeCount = 0,
        targetId = null,
        tiedCount = 0,
        reachableCount = 0,
        teamIds = emptyList(),
        intermediateIds = emptyList(),
        games = emptyList(),
        totalMargin = 0,
        minMargin = 0
      )
    }

    val dist = HashMap<String, Int>()
    val bestMargin = HashMap<String, Int>()
    val minEdgeMargin = HashMap<String, Int>()
    val parentNode = HashMap<String, String>()
    val parentEdge = HashMap<String, DirectedEdge>()

    dist[src] = 0
    bestMargin[src] = 0
    minEdgeMargin[src] = Int.MAX_VALUE

    val queue = ArrayDeque<String>()
    queue.addLast(src)

    while (queue.isNotEmpty()) {
      val u = queue.removeFirst()
      val du = dist[u] ?: 0
      val mu = bestMargin[u] ?: 0
      val minU = minEdgeMargin[u] ?: Int.MAX_VALUE
      val edges = forward[u] ?: continue

      for (edge in edges) {
        val v = edge.toId
        if (v == src) continue

        val candMargin = mu + edge.margin
        val candMinEdge = min(minU, edge.margin)
        val existingDist = dist[v]

        if (existingDist == null) {
          dist[v] = du + 1
          bestMargin[v] = candMargin
          minEdgeMargin[v] = candMinEdge
          parentNode[v] = u
          parentEdge[v] = edge
          queue.addLast(v)
        } else if (existingDist == du + 1) {
          val curBestM = bestMargin[v] ?: 0
          val curMinE = minEdgeMargin[v] ?: 0
          if (candMargin > curBestM || (candMargin == curBestM && candMinEdge > curMinE)) {
            bestMargin[v] = candMargin
            minEdgeMargin[v] = candMinEdge
            parentNode[v] = u
            parentEdge[v] = edge
          }
        }
      }
    }

    var maxEdges = 0
    var tiedCount = 0
    var reachableCount = 0
    var bestTargetId: String? = null
    var bestTotalMargin = -1
    var bestMinMargin = -1

    for ((v, dv) in dist) {
      if (v == src) continue
      if (eligibleTargetSet != null && !eligibleTargetSet.contains(v)) continue
      reachableCount += 1

      val totalV = bestMargin[v] ?: 0
      val minV = minEdgeMargin[v] ?: 0
      if (dv > maxEdges) {
        maxEdges = dv
        tiedCount = 1
        bestTargetId = v
        bestTotalMargin = totalV
        bestMinMargin = minV
      } else if (dv == maxEdges) {
        tiedCount += 1
        if (totalV > bestTotalMargin || (totalV == bestTotalMargin && minV > bestMinMargin)) {
          bestTargetId = v
          bestTotalMargin = totalV
          bestMinMargin = minV
        }
      }
    }

    if (bestTargetId == null || maxEdges == 0) {
      return FarthestChainResult(
        degree = null,
        edgeCount = 0,
        targetId = null,
        tiedCount = 0,
        reachableCount = reachableCount,
        teamIds = emptyList(),
        intermediateIds = emptyList(),
        games = emptyList(),
        totalMargin = 0,
        minMargin = 0
      )
    }

    val revTeams = ArrayList<String>(maxEdges + 1).apply { add(bestTargetId) }
    val revEdges = ArrayList<DirectedEdge>(maxEdges)
    var cur: String = bestTargetId
    while (cur != src) {
      val edge = parentEdge[cur] ?: break
      val prev = parentNode[cur] ?: break
      revEdges.add(edge)
      revTeams.add(prev)
      cur = prev
    }

    revTeams.reverse()
    revEdges.reverse()

    return FarthestChainResult(
      degree = maxEdges - 1,
      edgeCount = maxEdges,
      targetId = bestTargetId,
      tiedCount = tiedCount,
      reachableCount = reachableCount,
      teamIds = revTeams,
      intermediateIds = if (revTeams.size > 2) revTeams.subList(1, revTeams.size - 1).toList() else emptyList(),
      games = revEdges.map { it.game },
      totalMargin = bestTotalMargin,
      minMargin = if (bestMinMargin == Int.MAX_VALUE) 0 else bestMinMargin
    )
  }

  fun computeSchoolFarthestChains(
    seasonGraph: SeasonResultsGraph,
    schoolIds: List<String>,
    eligibleTargetIds: Set<String>? = null
  ): List<SchoolFarthestRow> {
    val games = seasonGraph.games
    val winGraph = buildDirectedGraph(games, "wins")
    val lossGraph = buildDirectedGraph(games, "losses")

    return schoolIds.map { teamId ->
      val rec = winGraph.teamRecordMap[teamId] ?: TeamRecord()
      SchoolFarthestRow(
        teamId = teamId,
        wins = rec.wins,
        losses = rec.losses,
        farthestWin = findFarthestChainFromTeam(winGraph.forward, teamId, eligibleTargetIds),
        farthestLoss = findFarthestChainFromTeam(lossGraph.forward, teamId, eligibleTargetIds)
      )
    }
  }
}
