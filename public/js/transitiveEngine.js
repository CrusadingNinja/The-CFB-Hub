/**
 * Pure graph builder and shortest-degree diverse transitive chain solver
 * for College Football Tracker ("Transitive W/Ls" view).
 */

const MAX_CANDIDATES_PER_DEGREE = 2500;

/**
 * Builds directed adjacency lists and reverse predecessor lists from completed games.
 * For mode === 'wins', edges point winnerId -> loserId.
 * For mode === 'losses', edges point loserId -> winnerId.
 */
export function buildDirectedGraph(games = [], mode = 'wins') {
  const pairBest = new Map();
  const teamRecordMap = new Map();

  const bumpRecord = (teamId, isWin) => {
    let rec = teamRecordMap.get(teamId);
    if (!rec) {
      rec = { wins: 0, losses: 0 };
      teamRecordMap.set(teamId, rec);
    }
    if (isWin) rec.wins += 1;
    else rec.losses += 1;
  };

  for (let i = 0; i < games.length; i++) {
    const g = games[i];
    if (!g || !g.winnerId || !g.loserId) continue;
    const wId = String(g.winnerId);
    const lId = String(g.loserId);
    if (wId === lId) continue;

    bumpRecord(wId, true);
    bumpRecord(lId, false);

    const fromId = mode === 'losses' ? lId : wId;
    const toId = mode === 'losses' ? wId : lId;
    const margin = Number(g.margin) || Math.abs((Number(g.winnerScore) || 0) - (Number(g.loserScore) || 0));
    const pairKey = `${fromId}->${toId}`;
    const existing = pairBest.get(pairKey);

    if (
      !existing ||
      margin > existing.margin ||
      (margin === existing.margin && String(g.date || '') > String(existing.game.date || ''))
    ) {
      pairBest.set(pairKey, {
        fromId,
        toId,
        margin,
        game: g
      });
    }
  }

  const forward = new Map();
  const reverse = new Map();

  pairBest.forEach((edge) => {
    let fwdList = forward.get(edge.fromId);
    if (!fwdList) {
      fwdList = [];
      forward.set(edge.fromId, fwdList);
    }
    fwdList.push(edge);

    let revList = reverse.get(edge.toId);
    if (!revList) {
      revList = [];
      reverse.set(edge.toId, revList);
    }
    revList.push(edge.fromId);
  });

  forward.forEach((edges) => {
    edges.sort((a, b) => {
      if (b.margin !== a.margin) return b.margin - a.margin;
      return String(b.game.date || '').localeCompare(String(a.game.date || ''));
    });
  });

  return { forward, reverse, teamRecordMap };
}

function computeReverseDistances(reverseAdj, targetId, excludedSourceId) {
  const dist = new Map();
  dist.set(targetId, 0);
  const queue = [targetId];
  let head = 0;

  while (head < queue.length) {
    const curr = queue[head++];
    const currDist = dist.get(curr);
    const preds = reverseAdj.get(curr);
    if (!preds) continue;

    for (let i = 0; i < preds.length; i++) {
      const prev = preds[i];
      if (dist.has(prev)) continue;
      dist.set(prev, currDist + 1);
      // Do not expand through Team A so shortest remaining paths never route via Team A
      if (prev !== excludedSourceId) {
        queue.push(prev);
      }
    }
  }

  return dist;
}

function selectDiverseChains(candidates, neededCount, usedIntermediates) {
  if (!candidates.length || neededCount <= 0) return [];
  const pool = candidates.slice();
  const chosen = [];

  while (chosen.length < neededCount && pool.length > 0) {
    let bestIdx = 0;
    let bestScore = null;

    for (let i = 0; i < pool.length; i++) {
      const cand = pool[i];
      let distinctOverlap = 0;
      let totalReuse = 0;

      for (let j = 0; j < cand.intermediateIds.length; j++) {
        const useCount = usedIntermediates.get(cand.intermediateIds[j]) || 0;
        if (useCount > 0) {
          distinctOverlap += 1;
          totalReuse += useCount;
        }
      }

      const better =
        !bestScore ||
        distinctOverlap < bestScore.distinctOverlap ||
        (distinctOverlap === bestScore.distinctOverlap && totalReuse < bestScore.totalReuse) ||
        (distinctOverlap === bestScore.distinctOverlap &&
          totalReuse === bestScore.totalReuse &&
          cand.totalMargin > bestScore.totalMargin) ||
        (distinctOverlap === bestScore.distinctOverlap &&
          totalReuse === bestScore.totalReuse &&
          cand.totalMargin === bestScore.totalMargin &&
          cand.minMargin > bestScore.minMargin);

      if (better) {
        bestIdx = i;
        bestScore = {
          distinctOverlap,
          totalReuse,
          totalMargin: cand.totalMargin,
          minMargin: cand.minMargin
        };
      }
    }

    const picked = pool.splice(bestIdx, 1)[0];
    chosen.push(picked);
    for (let j = 0; j < picked.intermediateIds.length; j++) {
      const tid = picked.intermediateIds[j];
      usedIntermediates.set(tid, (usedIntermediates.get(tid) || 0) + 1);
    }
  }

  return chosen;
}

function collectSimplePathsOfLength(
  forward,
  directToTargetMap,
  minEdgesToB,
  teamAId,
  teamBId,
  targetEdges,
  maxCandidates = MAX_CANDIDATES_PER_DEGREE
) {
  if (targetEdges === 1) {
    const directEdge = directToTargetMap.get(teamAId);
    if (!directEdge) return [];
    return [
      {
        degree: 0,
        edgeCount: 1,
        teamIds: [teamAId, teamBId],
        intermediateIds: [],
        games: [directEdge.game],
        totalMargin: directEdge.margin,
        minMargin: directEdge.margin
      }
    ];
  }

  const firstEdges = (forward.get(teamAId) || []).filter((edge) => {
    if (edge.toId === teamAId || edge.toId === teamBId) return false;
    const rem = minEdgesToB.get(edge.toId);
    return rem !== undefined && 1 + rem <= targetEdges;
  });

  if (firstEdges.length === 0) return [];

  const candidates = [];
  const perBranchCap = Math.max(80, Math.ceil(maxCandidates / firstEdges.length));

  const visited = new Set([teamAId, teamBId]);
  const pathTeams = [teamAId];
  const pathEdges = [];

  for (let b = 0; b < firstEdges.length; b++) {
    if (candidates.length >= maxCandidates) break;
    const firstEdge = firstEdges[b];
    let branchCollected = 0;

    const dfs = (currNode, depth) => {
      if (branchCollected >= perBranchCap || candidates.length >= maxCandidates) return;

      if (depth === targetEdges - 1) {
        const closingEdge = directToTargetMap.get(currNode);
        if (!closingEdge) return;

        let totalMargin = 0;
        let minMargin = Infinity;
        const gamesOut = [];
        for (let k = 0; k < pathEdges.length; k++) {
          const m = pathEdges[k].margin;
          totalMargin += m;
          if (m < minMargin) minMargin = m;
          gamesOut.push(pathEdges[k].game);
        }
        totalMargin += closingEdge.margin;
        if (closingEdge.margin < minMargin) minMargin = closingEdge.margin;
        gamesOut.push(closingEdge.game);

        candidates.push({
          degree: targetEdges - 1,
          edgeCount: targetEdges,
          teamIds: [...pathTeams, teamBId],
          intermediateIds: pathTeams.slice(1),
          games: gamesOut,
          totalMargin,
          minMargin
        });
        branchCollected += 1;
        return;
      }

      const nextEdges = forward.get(currNode);
      if (!nextEdges) return;

      for (let i = 0; i < nextEdges.length; i++) {
        if (branchCollected >= perBranchCap || candidates.length >= maxCandidates) break;
        const edge = nextEdges[i];
        const nextId = edge.toId;
        if (visited.has(nextId)) continue;

        const rem = minEdgesToB.get(nextId);
        if (rem === undefined || depth + 1 + rem > targetEdges) continue;

        visited.add(nextId);
        pathTeams.push(nextId);
        pathEdges.push(edge);

        dfs(nextId, depth + 1);

        pathEdges.pop();
        pathTeams.pop();
        visited.delete(nextId);
      }
    };

    visited.add(firstEdge.toId);
    pathTeams.push(firstEdge.toId);
    pathEdges.push(firstEdge);

    dfs(firstEdge.toId, 1);

    pathEdges.pop();
    pathTeams.pop();
    visited.delete(firstEdge.toId);
  }

  return candidates;
}

/**
 * Finds up to `maxChains` shortest-degree transitive chains from `teamAId` to `teamBId`.
 * Degree 0 = direct game (edgeCount = 1). Degree k = k intermediate teams (edgeCount = k + 1).
 */
export function findTransitiveChains(
  games,
  teamAId,
  teamBId,
  { mode = 'wins', maxChains = 5, maxEdges = 25, prebuiltGraph = null } = {}
) {
  const aId = String(teamAId || '');
  const bId = String(teamBId || '');
  if (!aId || !bId || aId === bId) return [];

  const { forward, reverse } = prebuiltGraph || buildDirectedGraph(games, mode);
  const minEdgesToB = computeReverseDistances(reverse, bId, aId);
  const minStartEdges = minEdgesToB.get(aId);
  if (minStartEdges === undefined || minStartEdges > maxEdges) {
    return [];
  }

  // O(1) lookup for closing hop u -> B
  const directToTargetMap = new Map();
  const bPreds = reverse.get(bId) || [];
  for (let i = 0; i < bPreds.length; i++) {
    const predId = bPreds[i];
    const edges = forward.get(predId) || [];
    const hit = edges.find((e) => e.toId === bId);
    if (hit) directToTargetMap.set(predId, hit);
  }

  const selected = [];
  const usedIntermediates = new Map();

  for (let targetEdges = minStartEdges; targetEdges <= maxEdges && selected.length < maxChains; targetEdges++) {
    const candidates = collectSimplePathsOfLength(
      forward,
      directToTargetMap,
      minEdgesToB,
      aId,
      bId,
      targetEdges
    );
    if (candidates.length === 0) continue;

    const needed = maxChains - selected.length;
    const picked = selectDiverseChains(candidates, needed, usedIntermediates);
    selected.push(...picked);
  }

  return selected;
}

/**
 * Computes both transitive win chains (A > ... > B) and transitive loss chains (A < ... < B).
 */
export function computeTransitiveComparison(seasonGraph, teamAId, teamBId, { maxChains = 5 } = {}) {
  const games = seasonGraph && Array.isArray(seasonGraph.games) ? seasonGraph.games : [];
  const aId = String(teamAId || '');
  const bId = String(teamBId || '');

  const winGraph = buildDirectedGraph(games, 'wins');
  const lossGraph = buildDirectedGraph(games, 'losses');

  const winChains = findTransitiveChains(games, aId, bId, {
    mode: 'wins',
    maxChains,
    prebuiltGraph: winGraph
  });
  const lossChains = findTransitiveChains(games, aId, bId, {
    mode: 'losses',
    maxChains,
    prebuiltGraph: lossGraph
  });

  const recA = winGraph.teamRecordMap.get(aId) || { wins: 0, losses: 0 };
  const recB = winGraph.teamRecordMap.get(bId) || { wins: 0, losses: 0 };

  return {
    winChains,
    lossChains,
    stats: {
      teamAWins: recA.wins,
      teamALosses: recA.losses,
      teamBWins: recB.wins,
      teamBLosses: recB.losses,
      completedCount: games.length
    }
  };
}

/**
 * Finds the exact farthest minimum-degree reachable target (eccentricity) from `sourceId`
 * in a directed graph, breaking ties at maximum shortest distance by largest combined point margin.
 */
export function findFarthestChainFromTeam(forward, sourceId, eligibleTargetSet = null) {
  const src = String(sourceId || '');
  if (!src) {
    return {
      degree: null,
      edgeCount: 0,
      targetId: null,
      tiedCount: 0,
      reachableCount: 0,
      teamIds: [],
      intermediateIds: [],
      games: [],
      totalMargin: 0,
      minMargin: 0
    };
  }

  const dist = new Map([[src, 0]]);
  const bestMargin = new Map([[src, 0]]);
  const minEdgeMargin = new Map([[src, Infinity]]);
  const parentNode = new Map();
  const parentEdge = new Map();
  const queue = [src];
  let head = 0;

  while (head < queue.length) {
    const u = queue[head++];
    const du = dist.get(u);
    const mu = bestMargin.get(u);
    const minU = minEdgeMargin.get(u);
    const edges = forward.get(u);
    if (!edges) continue;

    for (let i = 0; i < edges.length; i++) {
      const edge = edges[i];
      const v = edge.toId;
      if (v === src) continue;

      const candMargin = mu + edge.margin;
      const candMinEdge = Math.min(minU, edge.margin);
      const existingDist = dist.get(v);

      if (existingDist === undefined) {
        dist.set(v, du + 1);
        bestMargin.set(v, candMargin);
        minEdgeMargin.set(v, candMinEdge);
        parentNode.set(v, u);
        parentEdge.set(v, edge);
        queue.push(v);
      } else if (existingDist === du + 1) {
        const curBestM = bestMargin.get(v);
        const curMinE = minEdgeMargin.get(v);
        if (candMargin > curBestM || (candMargin === curBestM && candMinEdge > curMinE)) {
          bestMargin.set(v, candMargin);
          minEdgeMargin.set(v, candMinEdge);
          parentNode.set(v, u);
          parentEdge.set(v, edge);
        }
      }
    }
  }

  let maxEdges = 0;
  let tiedCount = 0;
  let reachableCount = 0;
  let bestTargetId = null;
  let bestTotalMargin = -1;
  let bestMinMargin = -1;

  dist.forEach((dv, v) => {
    if (v === src) return;
    if (eligibleTargetSet && !eligibleTargetSet.has(v)) return;
    reachableCount += 1;

    const totalV = bestMargin.get(v);
    const minV = minEdgeMargin.get(v);
    if (dv > maxEdges) {
      maxEdges = dv;
      tiedCount = 1;
      bestTargetId = v;
      bestTotalMargin = totalV;
      bestMinMargin = minV;
    } else if (dv === maxEdges) {
      tiedCount += 1;
      if (totalV > bestTotalMargin || (totalV === bestTotalMargin && minV > bestMinMargin)) {
        bestTargetId = v;
        bestTotalMargin = totalV;
        bestMinMargin = minV;
      }
    }
  });

  if (!bestTargetId || maxEdges === 0) {
    return {
      degree: null,
      edgeCount: 0,
      targetId: null,
      tiedCount: 0,
      reachableCount,
      teamIds: [],
      intermediateIds: [],
      games: [],
      totalMargin: 0,
      minMargin: 0
    };
  }

  const revTeams = [bestTargetId];
  const revEdges = [];
  let cur = bestTargetId;
  while (cur !== src) {
    const edge = parentEdge.get(cur);
    const prev = parentNode.get(cur);
    if (!edge || prev === undefined) break;
    revEdges.push(edge);
    revTeams.push(prev);
    cur = prev;
  }

  revTeams.reverse();
  revEdges.reverse();

  return {
    degree: maxEdges - 1,
    edgeCount: maxEdges,
    targetId: bestTargetId,
    tiedCount,
    reachableCount,
    teamIds: revTeams,
    intermediateIds: revTeams.slice(1, -1),
    games: revEdges.map((e) => e.game),
    totalMargin: bestTotalMargin,
    minMargin: bestMinMargin === Infinity ? 0 : bestMinMargin
  };
}

/**
 * Computes both Farthest Minimum-Degree Transitive Win and Farthest Minimum-Degree Transitive Loss
 * for every school in `schoolIds`.
 */
export function computeSchoolFarthestChains(seasonGraph, schoolIds = [], { eligibleTargetIds = null } = {}) {
  const games = seasonGraph && Array.isArray(seasonGraph.games) ? seasonGraph.games : [];
  const winGraph = buildDirectedGraph(games, 'wins');
  const lossGraph = buildDirectedGraph(games, 'losses');

  let targetSet = null;
  if (Array.isArray(eligibleTargetIds)) {
    targetSet = new Set(eligibleTargetIds.map((id) => String(id)));
  } else if (eligibleTargetIds instanceof Set) {
    targetSet = eligibleTargetIds;
  }

  return (schoolIds || []).map((rawId) => {
    const teamId = String(rawId);
    const rec = winGraph.teamRecordMap.get(teamId) || { wins: 0, losses: 0 };
    return {
      teamId,
      wins: rec.wins,
      losses: rec.losses,
      farthestWin: findFarthestChainFromTeam(winGraph.forward, teamId, targetSet),
      farthestLoss: findFarthestChainFromTeam(lossGraph.forward, teamId, targetSet)
    };
  });
}
