// Transitive W/Ls view — Search any two FBS/FCS teams to compute up to 5 shortest transitive win and loss chains
import { getState } from '../store.js';
import { escapeHtml, renderTeamLogo, renderRankBadge } from '../ui.js';
import { computeTransitiveComparison, computeSchoolFarthestChains } from '../transitiveEngine.js';

const pickerState = {
  A: { open: false, query: '', divisionFilter: 'all' },
  B: { open: false, query: '', divisionFilter: 'all' }
};

const farthestUiState = {
  query: '',
  showAll: false
};

let farthestMemoKey = '';
let farthestMemoRows = [];

let activeContainerRef = null;
let activeCallbacksRef = null;
let activeCatalogRef = [];
let globalOutsideWired = false;

function formatShortGameDate(isoDate) {
  if (!isoDate) return '';
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(d);
}

function getSelectableTeams(teamsDirectory = []) {
  return (teamsDirectory || [])
    .filter((t) => t && (t.division === 'FBS' || t.division === 'FCS'))
    .slice()
    .sort((a, b) => {
      if (a.division !== b.division) return a.division === 'FBS' ? -1 : 1;
      const ra = a.rank || 999;
      const rb = b.rank || 999;
      if (ra !== rb) return ra - rb;
      return String(a.displayName || '').localeCompare(String(b.displayName || ''));
    });
}

function scoreTeamMatch(team, queryLower) {
  if (!queryLower) return 1;
  const display = String(team.displayName || '').toLowerCase();
  const shortN = String(team.shortName || '').toLowerCase();
  const loc = String(team.location || '').toLowerCase();
  const abbr = String(team.abbreviation || '').toLowerCase();
  const nick = String(team.nickname || '').toLowerCase();
  const conf = `${team.conferenceName || ''} ${team.conferenceShortName || ''}`.toLowerCase();

  if (abbr === queryLower || shortN === queryLower || loc === queryLower) return 100;
  if (display.startsWith(queryLower) || shortN.startsWith(queryLower) || loc.startsWith(queryLower)) return 80;
  if (abbr.startsWith(queryLower) || nick.startsWith(queryLower)) return 65;
  if (display.includes(queryLower) || shortN.includes(queryLower)) return 45;
  if (conf.includes(queryLower)) return 25;
  return 0;
}

function filterSelectableTeams(catalog, slot) {
  const ps = pickerState[slot];
  const div = ps.divisionFilter || 'all';
  const q = String(ps.query || '').trim().toLowerCase();

  let list = catalog;
  if (div === 'FBS' || div === 'FCS') {
    list = list.filter((t) => t.division === div);
  }

  if (!q) {
    return list.slice(0, 80);
  }

  return list
    .map((team) => ({ team, score: scoreTeamMatch(team, q) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.team.division !== b.team.division) return a.team.division === 'FBS' ? -1 : 1;
      return String(a.team.displayName || '').localeCompare(String(b.team.displayName || ''));
    })
    .slice(0, 80)
    .map((item) => item.team);
}

function resolveTeamMeta(teamId, state) {
  const id = String(teamId || '');
  const dirTeam = state.teamsById?.[id];
  const graphTeam = state.transitiveSeasonGraph?.teams?.[id];
  if (!dirTeam && !graphTeam) {
    return {
      id,
      displayName: `Team ${id}`,
      shortName: `Team ${id}`,
      abbreviation: 'CFB',
      logo: '',
      color: null,
      division: ''
    };
  }
  return {
    ...(graphTeam || {}),
    ...(dirTeam || {}),
    logo: dirTeam?.logo || graphTeam?.logo || '',
    logoDark: dirTeam?.logoDark || dirTeam?.logo || graphTeam?.logo || ''
  };
}

function getPairRecordLabel(teamMeta, graphStatsWins, graphStatsLosses) {
  if (teamMeta?.overallRecord) return teamMeta.overallRecord;
  if (Number.isFinite(graphStatsWins) && Number.isFinite(graphStatsLosses)) {
    return `${graphStatsWins}-${graphStatsLosses}`;
  }
  return '';
}

function renderPickerDropdownItems(catalog, slot, oppositeTeamId, currentSelectedId, theme) {
  const filtered = filterSelectableTeams(catalog, slot);
  const ps = pickerState[slot];

  if (catalog.length === 0) {
    return `<div class="transitive-menu-empty">Loading FBS & FCS teams directory...</div>`;
  }
  if (filtered.length === 0) {
    return `<div class="transitive-menu-empty">No FBS or FCS teams matched "${escapeHtml(ps.query)}".</div>`;
  }

  return filtered
    .map((team) => {
      const isSelected = String(team.id) === String(currentSelectedId || '');
      const isOpposite = String(team.id) === String(oppositeTeamId || '');
      const metaBits = [team.division, team.conferenceShortName || team.conferenceName, team.overallRecord]
        .filter(Boolean)
        .join(' · ');

      return `
        <button
          type="button"
          class="transitive-option${isSelected ? ' selected' : ''}${isOpposite ? ' opposite' : ''}"
          role="option"
          aria-selected="${isSelected ? 'true' : 'false'}"
          data-pick-slot="${slot}"
          data-pick-team="${escapeHtml(team.id)}"
        >
          ${renderTeamLogo(team, { size: 'sm', theme })}
          <div class="transitive-option-main">
            <div class="transitive-option-top">
              ${team.rank ? renderRankBadge(team.rank) : ''}
              <span class="transitive-option-name">${escapeHtml(team.displayName)}</span>
            </div>
            <span class="transitive-option-meta">${escapeHtml(metaBits)}</span>
          </div>
          ${
            isSelected
              ? `<span class="transitive-option-tag selected">Selected</span>`
              : isOpposite
                ? `<span class="transitive-option-tag">Swap with ${slot === 'A' ? 'B' : 'A'}</span>`
                : `<span class="transitive-option-abbr">${escapeHtml(team.abbreviation)}</span>`
          }
        </button>
      `;
    })
    .join('');
}

function renderTeamPickerCard({
  slot,
  label,
  selectedId,
  oppositeId,
  catalog,
  teamsLoading,
  theme,
  recordFallback
}) {
  const ps = pickerState[slot];
  const selectedTeam = selectedId ? catalog.find((t) => String(t.id) === String(selectedId)) : null;
  const inputPlaceholder = selectedTeam
    ? `Change ${label} (${selectedTeam.shortName})...`
    : teamsLoading && catalog.length === 0
      ? 'Loading FBS & FCS teams...'
      : `Search FBS or FCS team for ${label}...`;

  const rec = selectedTeam?.overallRecord || recordFallback || '';
  const metaParts = selectedTeam
    ? [selectedTeam.division, selectedTeam.conferenceShortName || selectedTeam.conferenceName, rec].filter(Boolean)
    : [];

  return `
    <div class="transitive-picker-box${ps.open ? ' is-open' : ''}" data-picker-box="${slot}">
      <div class="transitive-picker-header">
        <span class="transitive-slot-label">${escapeHtml(label)}</span>
        ${
          selectedTeam
            ? `
              <button
                type="button"
                class="transitive-clear-btn"
                data-clear-slot="${slot}"
                aria-label="Clear ${escapeHtml(label)}"
                title="Clear ${escapeHtml(label)}"
              >
                <span class="material-symbols-rounded" style="font-size:16px;">close</span>
                Clear
              </button>
            `
            : `<span class="transitive-slot-hint">FBS or FCS</span>`
        }
      </div>

      ${
        selectedTeam
          ? `
            <div class="transitive-selected-pill">
              ${renderTeamLogo(selectedTeam, { theme })}
              <div class="transitive-selected-info">
                <div class="transitive-selected-title-row">
                  ${selectedTeam.rank ? renderRankBadge(selectedTeam.rank) : ''}
                  <span class="transitive-selected-name">${escapeHtml(selectedTeam.displayName)}</span>
                </div>
                <span class="transitive-selected-meta">${escapeHtml(metaParts.join(' · '))}</span>
              </div>
            </div>
          `
          : ''
      }

      <div class="transitive-combobox-wrap">
        <span class="material-symbols-rounded transitive-combobox-icon">search</span>
        <input
          id="transitive-search-${slot}"
          type="search"
          class="transitive-combobox-input"
          data-search-slot="${slot}"
          aria-label="${escapeHtml(label)} search menu"
          placeholder="${escapeHtml(inputPlaceholder)}"
          value="${escapeHtml(ps.query)}"
          autocomplete="off"
        >
        <button
          type="button"
          class="transitive-menu-toggle"
          data-toggle-menu="${slot}"
          aria-label="Toggle ${escapeHtml(label)} menu"
          aria-expanded="${ps.open ? 'true' : 'false'}"
        >
          <span class="material-symbols-rounded">${ps.open ? 'expand_less' : 'expand_more'}</span>
        </button>
      </div>

      <div
        id="transitive-menu-${slot}"
        class="transitive-dropdown-menu${ps.open ? '' : ' hidden'}"
        role="listbox"
        aria-label="${escapeHtml(label)} options"
      >
        <div class="transitive-menu-filters">
          ${['all', 'FBS', 'FCS']
            .map(
              (div) => `
                <button
                  type="button"
                  class="transitive-div-chip${ps.divisionFilter === div ? ' active' : ''}"
                  data-menu-div-slot="${slot}"
                  data-menu-div="${div}"
                >
                  ${div === 'all' ? 'All Teams' : div}
                </button>
              `
            )
            .join('')}
        </div>
        <div id="transitive-list-${slot}" class="transitive-options-list">
          ${ps.open ? renderPickerDropdownItems(catalog, slot, oppositeId, selectedId, theme) : ''}
        </div>
      </div>
    </div>
  `;
}

function buildQuickMatchups(catalog = [], seasonGraph = null) {
  if (!catalog.length) return [];

  const byShortLower = new Map();
  catalog.forEach((t) => {
    const keys = [t.displayName, t.shortName, t.location].filter(Boolean);
    keys.forEach((k) => {
      const lower = String(k).toLowerCase();
      if (!byShortLower.has(lower)) byShortLower.set(lower, t);
    });
  });

  const presets = [];
  const candidatePairs = [
    ['Ohio State', 'Indiana'],
    ['Alabama', 'Georgia'],
    ['Texas', 'Oregon'],
    ['North Dakota State', 'Montana State']
  ];

  for (const [nameA, nameB] of candidatePairs) {
    const teamA = byShortLower.get(nameA.toLowerCase());
    const teamB = byShortLower.get(nameB.toLowerCase());
    if (teamA && teamB && teamA.id !== teamB.id) {
      presets.push({
        label: `${teamA.shortName} vs ${teamB.shortName}`,
        teamAId: teamA.id,
        teamBId: teamB.id
      });
    }
  }

  if (presets.length === 0 && seasonGraph?.games?.length) {
    const g = seasonGraph.games[0];
    const tA = catalog.find((t) => String(t.id) === String(g.winnerId));
    const tB = catalog.find((t) => String(t.id) === String(g.loserId));
    if (tA && tB) {
      presets.push({
        label: `${tA.shortName} vs ${tB.shortName}`,
        teamAId: tA.id,
        teamBId: tB.id
      });
    }
  }

  return presets.slice(0, 4);
}

function renderChainCard(chain, idx, mode, state) {
  const { theme } = state;
  const isWin = mode === 'wins';
  const degreeLabel = `Degree ${chain.degree}`;
  const gamesLabel = chain.edgeCount === 1 ? '1 game' : `${chain.edgeCount} games`;
  const marginLabel = isWin ? `+${chain.totalMargin} pt diff` : `-${chain.totalMargin} pt diff`;
  const arrowChar = isWin ? '>' : '<';

  const teamNodes = chain.teamIds.map((tid) => resolveTeamMeta(tid, state));

  const breadcrumbHtml = teamNodes
    .map((tm, stepIdx) => {
      const isEndpoint = stepIdx === 0 || stepIdx === teamNodes.length - 1;
      const sep =
        stepIdx < teamNodes.length - 1
          ? `<span class="transitive-chain-arrow" aria-hidden="true">${escapeHtml(arrowChar)}</span>`
          : '';
      return `
        <span class="transitive-node-pill${isEndpoint ? ' endpoint' : ' intermediate'}" title="${escapeHtml(tm.displayName)}">
          ${renderTeamLogo(tm, { size: 'sm', theme })}
          <span class="transitive-node-abbr">${escapeHtml(tm.abbreviation || tm.shortName)}</span>
        </span>
        ${sep}
      `;
    })
    .join('');

  const gamesHtml = chain.games
    .map((game, stepIdx) => {
      const leftTeam = teamNodes[stepIdx];
      const rightTeam = teamNodes[stepIdx + 1];
      const leftWon = String(game.winnerId) === String(leftTeam.id);
      const leftScore = leftWon ? game.winnerScore : game.loserScore;
      const rightScore = leftWon ? game.loserScore : game.winnerScore;
      const verb = isWin ? 'def.' : 'lost to';
      const dateText = formatShortGameDate(game.date);
      const weekMeta = [game.weekLabel, dateText].filter(Boolean).join(' · ');

      return `
        <button
          type="button"
          class="transitive-game-step"
          data-open-event="${escapeHtml(game.id)}"
          data-open-title="${escapeHtml(game.shortName || `${leftTeam.shortName} vs ${rightTeam.shortName}`)}"
          title="Open Game Center: ${escapeHtml(game.shortName || '')}"
        >
          <div class="transitive-game-teams">
            <span class="transitive-step-side${leftWon ? ' winner' : ''}">
              ${renderTeamLogo(leftTeam, { size: 'sm', theme })}
              <span class="transitive-step-team">${escapeHtml(leftTeam.shortName || leftTeam.abbreviation)}</span>
              <span class="transitive-step-score tabular">${escapeHtml(String(leftScore))}</span>
            </span>
            <span class="transitive-step-verb ${isWin ? 'win' : 'loss'}">${escapeHtml(verb)}</span>
            <span class="transitive-step-side${!leftWon ? ' winner' : ''}">
              ${renderTeamLogo(rightTeam, { size: 'sm', theme })}
              <span class="transitive-step-team">${escapeHtml(rightTeam.shortName || rightTeam.abbreviation)}</span>
              <span class="transitive-step-score tabular">${escapeHtml(String(rightScore))}</span>
            </span>
          </div>
          <div class="transitive-game-meta">
            <span>${escapeHtml(weekMeta)}</span>
            <span class="transitive-game-link">Game Center →</span>
          </div>
        </button>
      `;
    })
    .join('');

  return `
    <article class="md-card transitive-chain-card ${isWin ? 'win-chain' : 'loss-chain'}">
      <div class="transitive-chain-header">
        <div class="transitive-chain-badges">
          <span class="transitive-chain-rank">#${idx + 1}</span>
          <span class="transitive-degree-badge ${chain.degree === 0 ? 'direct' : ''}">${escapeHtml(degreeLabel)}</span>
        </div>
        <div class="transitive-chain-metrics">
          <span>${escapeHtml(gamesLabel)}</span>
          <span class="transitive-margin-chip ${isWin ? 'win' : 'loss'} tabular">${escapeHtml(marginLabel)}</span>
        </div>
      </div>

      <div class="transitive-breadcrumb-row">
        ${breadcrumbHtml}
      </div>

      <div class="transitive-games-stack">
        ${gamesHtml}
      </div>
    </article>
  `;
}

function renderChainColumn({ mode, teamA, teamB, chains, stats, seasonYear, theme }) {
  const isWin = mode === 'wins';
  const title = isWin
    ? `Transitive Wins · ${teamA.shortName} over ${teamB.shortName}`
    : `Transitive Losses · ${teamA.shortName} to ${teamB.shortName}`;
  const icon = isWin ? 'emoji_events' : 'trending_down';
  const countText = `${chains.length} / 5 found`;

  let emptyHint = `No ${isWin ? 'transitive win' : 'transitive loss'} chains found from ${teamA.displayName} to ${teamB.displayName} in completed ${seasonYear} games.`;
  if (chains.length === 0 && stats) {
    if (isWin && stats.teamAWins === 0) {
      emptyHint = `${teamA.displayName} has no completed wins recorded so far in the ${seasonYear} season.`;
    } else if (isWin && stats.teamBLosses === 0) {
      emptyHint = `${teamB.displayName} is undefeated (${stats.teamBWins}-0) in completed ${seasonYear} games, so no team has a transitive win over them.`;
    } else if (!isWin && stats.teamALosses === 0) {
      emptyHint = `${teamA.displayName} is undefeated (${stats.teamAWins}-0) in completed ${seasonYear} games, so they have no transitive losses.`;
    } else if (!isWin && stats.teamBWins === 0) {
      emptyHint = `${teamB.displayName} has no completed wins recorded so far in the ${seasonYear} season.`;
    }
  }

  return `
    <section class="transitive-column" aria-label="${escapeHtml(title)}">
      <header class="transitive-column-header ${isWin ? 'win' : 'loss'}">
        <div class="transitive-column-title-wrap">
          <span class="material-symbols-rounded transitive-col-icon">${icon}</span>
          <div>
            <h2 class="transitive-column-title">${escapeHtml(title)}</h2>
            <p class="transitive-column-subtitle">
              ${isWin ? 'Shortest chains where Team A defeated ... defeated Team B' : 'Shortest chains where Team A lost to ... lost to Team B'}
            </p>
          </div>
        </div>
        <span class="transitive-count-pill">${escapeHtml(countText)}</span>
      </header>

      <div class="transitive-chains-list">
        ${
          chains.length > 0
            ? chains.map((c, idx) => renderChainCard(c, idx, mode, { ...getState(), theme })).join('')
            : `
              <div class="md-card transitive-empty-chain">
                <span class="material-symbols-rounded muted" style="font-size:28px;">route</span>
                <p>${escapeHtml(emptyHint)}</p>
              </div>
            `
        }
      </div>
    </section>
  `;
}

function wireGlobalMenuClose() {
  if (globalOutsideWired) return;
  globalOutsideWired = true;

  document.addEventListener('click', (e) => {
    if (!activeContainerRef || !document.body.contains(activeContainerRef)) return;
    if (getState().route !== 'transitive') return;

    const clickedBox = e.target.closest?.('[data-picker-box]');
    const clickedSlot = clickedBox ? clickedBox.dataset.pickerBox : null;
    let changed = false;

    ['A', 'B'].forEach((slot) => {
      if (pickerState[slot].open && slot !== clickedSlot) {
        pickerState[slot].open = false;
        changed = true;
      }
    });

    if (changed) {
      syncMenuVisibility('A');
      syncMenuVisibility('B');
    }
  });
}

function syncMenuVisibility(slot) {
  if (!activeContainerRef) return;
  const menuEl = activeContainerRef.querySelector(`#transitive-menu-${slot}`);
  const boxEl = activeContainerRef.querySelector(`[data-picker-box="${slot}"]`);
  const toggleBtn = activeContainerRef.querySelector(`[data-toggle-menu="${slot}"]`);
  const ps = pickerState[slot];
  if (menuEl) menuEl.classList.toggle('hidden', !ps.open);
  if (boxEl) boxEl.classList.toggle('is-open', ps.open);
  if (toggleBtn) {
    toggleBtn.setAttribute('aria-expanded', ps.open ? 'true' : 'false');
    const iconEl = toggleBtn.querySelector('.material-symbols-rounded');
    if (iconEl) iconEl.textContent = ps.open ? 'expand_less' : 'expand_more';
  }
  if (ps.open) {
    refreshMenuListOnly(slot);
  }
}

function refreshMenuListOnly(slot) {
  if (!activeContainerRef) return;
  const listEl = activeContainerRef.querySelector(`#transitive-list-${slot}`);
  if (!listEl) return;
  const state = getState();
  const currentSelectedId = slot === 'A' ? state.transitiveTeamAId : state.transitiveTeamBId;
  const oppositeId = slot === 'A' ? state.transitiveTeamBId : state.transitiveTeamAId;
  listEl.innerHTML = renderPickerDropdownItems(activeCatalogRef, slot, oppositeId, currentSelectedId, state.theme);
}

function getFarthestLeaderboardRows(seasonGraph, selectableCatalog, targetScope, state) {
  if (!seasonGraph || !Array.isArray(seasonGraph.games) || selectableCatalog.length === 0) {
    return [];
  }

  const key = `${seasonGraph.generatedAt || 0}|${selectableCatalog.length}|${targetScope || 'fbs_fcs'}`;
  if (farthestMemoKey === key && farthestMemoRows.length > 0) {
    return farthestMemoRows;
  }

  let eligibleTargetIds = null;
  if (targetScope === 'fbs') {
    eligibleTargetIds = selectableCatalog.filter((t) => t.division === 'FBS').map((t) => t.id);
  } else if (targetScope === 'fbs_fcs') {
    eligibleTargetIds = selectableCatalog.map((t) => t.id);
  }

  const schoolIds = selectableCatalog.map((t) => t.id);
  const rawResults = computeSchoolFarthestChains(seasonGraph, schoolIds, { eligibleTargetIds });
  const catalogById = new Map(selectableCatalog.map((t) => [String(t.id), t]));

  farthestMemoRows = rawResults.map((res) => {
    const team = catalogById.get(res.teamId) || resolveTeamMeta(res.teamId, state);
    return {
      ...res,
      team
    };
  });
  farthestMemoKey = key;
  return farthestMemoRows;
}

function filterAndSortFarthestRows(rows, { schoolDiv = 'all', sortMode = 'win_desc', query = '' } = {}) {
  const q = String(query || '').trim().toLowerCase();
  const filtered = rows.filter((row) => {
    if (schoolDiv === 'FBS' && row.team.division !== 'FBS') return false;
    if (schoolDiv === 'FCS' && row.team.division !== 'FCS') return false;
    if (q && scoreTeamMatch(row.team, q) <= 0) return false;
    return true;
  });

  filtered.sort((a, b) => {
    if (sortMode === 'school_asc') {
      return String(a.team.displayName || '').localeCompare(String(b.team.displayName || ''));
    }
    if (sortMode === 'loss_desc') {
      const da = a.farthestLoss.degree === null ? -1 : a.farthestLoss.degree;
      const db = b.farthestLoss.degree === null ? -1 : b.farthestLoss.degree;
      if (db !== da) return db - da;
      if (b.farthestLoss.totalMargin !== a.farthestLoss.totalMargin) {
        return b.farthestLoss.totalMargin - a.farthestLoss.totalMargin;
      }
    } else {
      const da = a.farthestWin.degree === null ? -1 : a.farthestWin.degree;
      const db = b.farthestWin.degree === null ? -1 : b.farthestWin.degree;
      if (db !== da) return db - da;
      if (b.farthestWin.totalMargin !== a.farthestWin.totalMargin) {
        return b.farthestWin.totalMargin - a.farthestWin.totalMargin;
      }
    }
    const ra = a.team.rank || 999;
    const rb = b.team.rank || 999;
    if (ra !== rb) return ra - rb;
    return String(a.team.displayName || '').localeCompare(String(b.team.displayName || ''));
  });

  return filtered;
}

function renderFarthestCellSummary(result, mode, row, state) {
  const isWin = mode === 'wins';
  if (result.degree === null || !result.targetId) {
    const emptyText = isWin
      ? row.wins === 0
        ? 'No wins'
        : 'No eligible win target'
      : row.losses === 0
        ? `Undefeated (${row.wins}-0)`
        : 'No eligible loss target';
    return `<span class="transitive-cell-empty muted">${escapeHtml(emptyText)}</span>`;
  }

  const targetMeta = resolveTeamMeta(result.targetId, state);
  const diffLabel = isWin ? `+${result.totalMargin} pt diff` : `-${result.totalMargin} pt diff`;
  const tiedLabel = result.tiedCount > 1 ? `${result.tiedCount} tied` : '1 target';
  const tiedTitle = `${result.tiedCount} destination ${result.tiedCount === 1 ? 'team' : 'teams'} tied at Degree ${result.degree}`;

  return `
    <div class="transitive-cell-chain">
      <div class="transitive-cell-top">
        <span class="transitive-degree-badge ${result.degree === 0 ? 'direct' : ''}">Degree ${result.degree}</span>
        <span class="transitive-margin-chip ${isWin ? 'win' : 'loss'} tabular">${escapeHtml(diffLabel)}</span>
        <span class="transitive-tied-pill" title="${escapeHtml(tiedTitle)}">${escapeHtml(tiedLabel)}</span>
      </div>
      <div class="transitive-cell-target">
        <span class="muted">${isWin ? 'over' : 'to'}</span>
        ${renderTeamLogo(targetMeta, { size: 'sm', theme: state.theme })}
        <span class="transitive-cell-target-name">${escapeHtml(targetMeta.shortName || targetMeta.displayName)}</span>
      </div>
    </div>
  `;
}

function renderFarthestLeaderboardMarkup(filteredRows, state, seasonYear) {
  if (activeCatalogRef.length === 0 && state.teamsLoading) {
    return `<div class="skeleton" style="height:260px;"></div>`;
  }
  if (!state.transitiveSeasonGraph) {
    return `<div class="skeleton" style="height:260px;"></div>`;
  }
  if (filteredRows.length === 0) {
    return `
      <div class="md-card empty-card transitive-prompt-card">
        <span class="material-symbols-rounded muted" style="font-size:36px;">search_off</span>
        <h3>No matching schools</h3>
        <p class="muted">No FBS or FCS schools match your current search or division filter.</p>
      </div>
    `;
  }

  const expandedSet = new Set((state.transitiveExpandedSchoolIds || []).map(String));
  const shouldSlice = !farthestUiState.query.trim() && !farthestUiState.showAll && filteredRows.length > 75;
  const visibleRows = shouldSlice ? filteredRows.slice(0, 75) : filteredRows;

  let topWinRow = null;
  let topLossRow = null;
  filteredRows.forEach((row) => {
    if (
      row.farthestWin.degree !== null &&
      (!topWinRow ||
        row.farthestWin.degree > topWinRow.farthestWin.degree ||
        (row.farthestWin.degree === topWinRow.farthestWin.degree &&
          row.farthestWin.totalMargin > topWinRow.farthestWin.totalMargin))
    ) {
      topWinRow = row;
    }
    if (
      row.farthestLoss.degree !== null &&
      (!topLossRow ||
        row.farthestLoss.degree > topLossRow.farthestLoss.degree ||
        (row.farthestLoss.degree === topLossRow.farthestLoss.degree &&
          row.farthestLoss.totalMargin > topLossRow.farthestLoss.totalMargin))
    ) {
      topLossRow = row;
    }
  });

  const highlightWinTarget = topWinRow?.farthestWin?.targetId ? resolveTeamMeta(topWinRow.farthestWin.targetId, state) : null;
  const highlightLossTarget = topLossRow?.farthestLoss?.targetId ? resolveTeamMeta(topLossRow.farthestLoss.targetId, state) : null;

  const highlightsHtml =
    topWinRow || topLossRow
      ? `
        <div class="transitive-highlights-grid">
          ${
            topWinRow && highlightWinTarget
              ? `
                <div class="md-card transitive-highlight-card win">
                  <div class="transitive-highlight-head">
                    <span class="transitive-highlight-label">Longest Minimum-Degree Win</span>
                    <span class="transitive-degree-badge direct">Degree ${topWinRow.farthestWin.degree}</span>
                  </div>
                  <div class="transitive-highlight-pair">
                    <span class="transitive-summary-team">
                      ${renderTeamLogo(topWinRow.team, { size: 'sm', theme: state.theme })}
                      <strong>${escapeHtml(topWinRow.team.shortName)}</strong>
                    </span>
                    <span class="muted">over</span>
                    <span class="transitive-summary-team">
                      ${renderTeamLogo(highlightWinTarget, { size: 'sm', theme: state.theme })}
                      <strong>${escapeHtml(highlightWinTarget.shortName)}</strong>
                    </span>
                    <span class="transitive-margin-chip win tabular">+${topWinRow.farthestWin.totalMargin} pt diff</span>
                    ${
                      topWinRow.farthestWin.tiedCount > 1
                        ? `<span class="transitive-tied-pill">${topWinRow.farthestWin.tiedCount} tied</span>`
                        : ''
                    }
                  </div>
                </div>
              `
              : ''
          }
          ${
            topLossRow && highlightLossTarget
              ? `
                <div class="md-card transitive-highlight-card loss">
                  <div class="transitive-highlight-head">
                    <span class="transitive-highlight-label">Longest Minimum-Degree Loss</span>
                    <span class="transitive-degree-badge">Degree ${topLossRow.farthestLoss.degree}</span>
                  </div>
                  <div class="transitive-highlight-pair">
                    <span class="transitive-summary-team">
                      ${renderTeamLogo(topLossRow.team, { size: 'sm', theme: state.theme })}
                      <strong>${escapeHtml(topLossRow.team.shortName)}</strong>
                    </span>
                    <span class="muted">to</span>
                    <span class="transitive-summary-team">
                      ${renderTeamLogo(highlightLossTarget, { size: 'sm', theme: state.theme })}
                      <strong>${escapeHtml(highlightLossTarget.shortName)}</strong>
                    </span>
                    <span class="transitive-margin-chip loss tabular">-${topLossRow.farthestLoss.totalMargin} pt diff</span>
                    ${
                      topLossRow.farthestLoss.tiedCount > 1
                        ? `<span class="transitive-tied-pill">${topLossRow.farthestLoss.tiedCount} tied</span>`
                        : ''
                    }
                  </div>
                </div>
              `
              : ''
          }
        </div>
      `
      : '';

  const rowsHtml = visibleRows
    .map((row, idx) => {
      const isExpanded = expandedSet.has(row.teamId);
      const recText = row.team.overallRecord || `${row.wins}-${row.losses}`;
      const metaBits = [row.team.division, row.team.conferenceShortName || row.team.conferenceName, recText]
        .filter(Boolean)
        .join(' · ');

      const winTargetMeta = row.farthestWin.targetId ? resolveTeamMeta(row.farthestWin.targetId, state) : null;
      const lossTargetMeta = row.farthestLoss.targetId ? resolveTeamMeta(row.farthestLoss.targetId, state) : null;

      return `
        <article class="md-card transitive-school-row${isExpanded ? ' is-expanded' : ''}">
          <button
            type="button"
            class="transitive-school-summary"
            data-toggle-school="${escapeHtml(row.teamId)}"
            aria-expanded="${isExpanded ? 'true' : 'false'}"
          >
            <div class="transitive-school-col-school">
              <span class="transitive-school-rank tabular">${idx + 1}</span>
              ${renderTeamLogo(row.team, { theme: state.theme })}
              <div class="transitive-school-name-wrap">
                <div class="transitive-school-title-row">
                  ${row.team.rank ? renderRankBadge(row.team.rank) : ''}
                  <span class="transitive-school-name">${escapeHtml(row.team.displayName)}</span>
                </div>
                <span class="transitive-school-meta">${escapeHtml(metaBits)}</span>
              </div>
            </div>

            <div class="transitive-school-col-chain">
              <span class="transitive-col-mobile-label">Farthest Win</span>
              ${renderFarthestCellSummary(row.farthestWin, 'wins', row, state)}
            </div>

            <div class="transitive-school-col-chain">
              <span class="transitive-col-mobile-label">Farthest Loss</span>
              ${renderFarthestCellSummary(row.farthestLoss, 'losses', row, state)}
            </div>

            <span class="material-symbols-rounded transitive-row-chevron">${isExpanded ? 'expand_less' : 'expand_more'}</span>
          </button>

          ${
            isExpanded
              ? `
                <div class="transitive-school-expanded">
                  <div class="transitive-expanded-pane">
                    <div class="transitive-expanded-header">
                      <div>
                        <h4>Farthest Minimum-Degree Win${winTargetMeta ? ` · over ${escapeHtml(winTargetMeta.shortName)}` : ''}</h4>
                        ${
                          row.farthestWin.tiedCount > 1
                            ? `<span class="muted">${row.farthestWin.tiedCount} eligible targets tied at Degree ${row.farthestWin.degree} (showing highest pt diff)</span>`
                            : ''
                        }
                      </div>
                      ${
                        winTargetMeta
                          ? `
                            <button
                              type="button"
                              class="md-chip"
                              data-compare-a="${escapeHtml(row.teamId)}"
                              data-compare-b="${escapeHtml(row.farthestWin.targetId)}"
                            >
                              Compare in Team A vs B →
                            </button>
                          `
                          : ''
                      }
                    </div>
                    ${
                      row.farthestWin.degree !== null
                        ? renderChainCard(row.farthestWin, 0, 'wins', state)
                        : `<div class="md-card transitive-empty-chain"><p>No farthest transitive win available in ${escapeHtml(String(seasonYear))} for this filter.</p></div>`
                    }
                  </div>

                  <div class="transitive-expanded-pane">
                    <div class="transitive-expanded-header">
                      <div>
                        <h4>Farthest Minimum-Degree Loss${lossTargetMeta ? ` · to ${escapeHtml(lossTargetMeta.shortName)}` : ''}</h4>
                        ${
                          row.farthestLoss.tiedCount > 1
                            ? `<span class="muted">${row.farthestLoss.tiedCount} eligible targets tied at Degree ${row.farthestLoss.degree} (showing highest pt diff)</span>`
                            : ''
                        }
                      </div>
                      ${
                        lossTargetMeta
                          ? `
                            <button
                              type="button"
                              class="md-chip"
                              data-compare-a="${escapeHtml(row.teamId)}"
                              data-compare-b="${escapeHtml(row.farthestLoss.targetId)}"
                            >
                              Compare in Team A vs B →
                            </button>
                          `
                          : ''
                      }
                    </div>
                    ${
                      row.farthestLoss.degree !== null
                        ? renderChainCard(row.farthestLoss, 0, 'losses', state)
                        : `<div class="md-card transitive-empty-chain"><p>No farthest transitive loss available in ${escapeHtml(String(seasonYear))} for this filter.</p></div>`
                    }
                  </div>
                </div>
              `
              : ''
          }
        </article>
      `;
    })
    .join('');

  const showAllBtnHtml = shouldSlice
    ? `
      <div class="transitive-show-all-wrap">
        <button id="transitive-show-all-btn" type="button" class="md-btn md-btn-tonal">
          Show all ${filteredRows.length} schools (showing top ${visibleRows.length})
        </button>
      </div>
    `
    : '';

  return `
    ${highlightsHtml}
    <div class="transitive-leaderboard-head">
      <span>School</span>
      <span>Farthest Transitive Win</span>
      <span>Farthest Transitive Loss</span>
      <span></span>
    </div>
    <div class="transitive-leaderboard-list">
      ${rowsHtml}
    </div>
    ${showAllBtnHtml}
  `;
}

function updateFarthestHostInPlace(container) {
  const host = container.querySelector('#transitive-farthest-list-host');
  if (!host) return;
  const state = getState();
  const seasonGraph = state.transitiveSeasonGraph;
  const seasonYear = seasonGraph?.seasonYear || state.currentSeasonYear || new Date().getFullYear();
  const targetScope = state.transitiveFarthestTargetScope || 'fbs_fcs';
  const schoolDiv = state.transitiveFarthestSchoolDiv || 'all';
  const sortMode = state.transitiveFarthestSort || 'win_desc';

  const allRows = getFarthestLeaderboardRows(seasonGraph, activeCatalogRef, targetScope, state);
  const filteredRows = filterAndSortFarthestRows(allRows, {
    schoolDiv,
    sortMode,
    query: farthestUiState.query
  });

  const countPill = container.querySelector('#transitive-farthest-count');
  if (countPill) {
    countPill.textContent = `${filteredRows.length} schools`;
  }

  host.innerHTML = renderFarthestLeaderboardMarkup(filteredRows, state, seasonYear);
}

export function renderTransitiveView(container, callbacks) {
  const state = getState();
  activeContainerRef = container;
  activeCallbacksRef = callbacks;
  wireGlobalMenuClose();

  const selectableCatalog = getSelectableTeams(state.teamsDirectory);
  activeCatalogRef = selectableCatalog;

  const mode = state.transitiveMode === 'farthest' ? 'farthest' : 'matchup';
  const targetScope = state.transitiveFarthestTargetScope || 'fbs_fcs';
  const schoolDiv = state.transitiveFarthestSchoolDiv || 'all';
  const sortMode = state.transitiveFarthestSort || 'win_desc';
  const expandedKey = (state.transitiveExpandedSchoolIds || []).join(',');

  const renderKey = [
    state.theme,
    mode,
    state.transitiveTeamAId || '',
    state.transitiveTeamBId || '',
    targetScope,
    schoolDiv,
    sortMode,
    expandedKey,
    state.transitiveLoading ? '1' : '0',
    state.transitiveError || '',
    state.transitiveSeasonGraph?.generatedAt || 0,
    selectableCatalog.length,
    state.teamsLoading ? '1' : '0'
  ].join('|');

  if (container.dataset.transitiveRenderKey === renderKey && container.querySelector('.transitive-view')) {
    return;
  }
  container.dataset.transitiveRenderKey = renderKey;

  const teamAId = state.transitiveTeamAId ? String(state.transitiveTeamAId) : null;
  const teamBId = state.transitiveTeamBId ? String(state.transitiveTeamBId) : null;
  const bothSelected = Boolean(teamAId && teamBId && teamAId !== teamBId);

  const seasonGraph = state.transitiveSeasonGraph;
  const seasonYear = seasonGraph?.seasonYear || state.currentSeasonYear || new Date().getFullYear();

  const modeTabsHtml = `
    <div class="md-segmented transitive-mode-tabs" role="tablist" aria-label="Transitive W/Ls mode">
      <button
        type="button"
        class="md-seg-btn${mode === 'matchup' ? ' selected' : ''}"
        role="tab"
        aria-selected="${mode === 'matchup' ? 'true' : 'false'}"
        data-transitive-mode="matchup"
      >
        Team A vs Team B
      </button>
      <button
        type="button"
        class="md-seg-btn${mode === 'farthest' ? ' selected' : ''}"
        role="tab"
        aria-selected="${mode === 'farthest' ? 'true' : 'false'}"
        data-transitive-mode="farthest"
      >
        Farthest Chains by School
      </button>
    </div>
  `;

  if (mode === 'farthest') {
    const allFarthestRows = getFarthestLeaderboardRows(seasonGraph, selectableCatalog, targetScope, state);
    const filteredRows = filterAndSortFarthestRows(allFarthestRows, {
      schoolDiv,
      sortMode,
      query: farthestUiState.query
    });

    const controlsHtml = `
      <section class="md-card transitive-controls-card" aria-label="Farthest chains by school controls">
        <div class="transitive-controls-top">
          <div>
            <h2 class="transitive-hero-title">Transitive Wins & Losses Explorer</h2>
            <p class="transitive-hero-subtitle">
              Exact farthest minimum-degree transitive win and loss chains for every FBS & FCS school in ${escapeHtml(String(seasonYear))} (with tied destination counts and combined point diff tie-breaking).
            </p>
          </div>
          ${
            seasonGraph
              ? `
                <div class="transitive-graph-badge">
                  <span class="material-symbols-rounded" style="font-size:16px;">sports_football</span>
                  <span class="tabular">${escapeHtml(String(seasonGraph.completedCount))} completed games indexed</span>
                </div>
              `
              : ''
          }
        </div>

        ${modeTabsHtml}

        <div class="transitive-farthest-toolbar">
          <label class="md-search-bar transitive-farthest-search-wrap" aria-label="Filter schools">
            <span class="material-symbols-rounded muted">search</span>
            <input
              id="transitive-farthest-search"
              type="search"
              placeholder="Search school or conference..."
              value="${escapeHtml(farthestUiState.query)}"
              autocomplete="off"
            >
          </label>

          <div class="transitive-filter-group">
            <span class="transitive-filter-label">School Division</span>
            <div class="md-segmented" role="group" aria-label="School division filter">
              ${[
                { key: 'all', label: 'All' },
                { key: 'FBS', label: 'FBS' },
                { key: 'FCS', label: 'FCS' }
              ]
                .map(
                  (opt) => `
                    <button
                      type="button"
                      class="md-seg-btn${schoolDiv === opt.key ? ' selected' : ''}"
                      data-school-div="${opt.key}"
                    >
                      ${opt.label}
                    </button>
                  `
                )
                .join('')}
            </div>
          </div>

          <div class="transitive-filter-group">
            <span class="transitive-filter-label">Destination Target</span>
            <div class="md-segmented" role="group" aria-label="Destination endpoint scope">
              ${[
                { key: 'fbs_fcs', label: 'FBS & FCS' },
                { key: 'fbs', label: 'FBS Only' },
                { key: 'all', label: 'All Opponents' }
              ]
                .map(
                  (opt) => `
                    <button
                      type="button"
                      class="md-seg-btn${targetScope === opt.key ? ' selected' : ''}"
                      data-target-scope="${opt.key}"
                    >
                      ${opt.label}
                    </button>
                  `
                )
                .join('')}
            </div>
          </div>

          <div class="transitive-filter-group">
            <span class="transitive-filter-label">Sort By</span>
            <div class="md-segmented" role="group" aria-label="Sort leaderboard">
              ${[
                { key: 'win_desc', label: 'Farthest Win ↓' },
                { key: 'loss_desc', label: 'Farthest Loss ↓' },
                { key: 'school_asc', label: 'School A–Z' }
              ]
                .map(
                  (opt) => `
                    <button
                      type="button"
                      class="md-seg-btn${sortMode === opt.key ? ' selected' : ''}"
                      data-farthest-sort="${opt.key}"
                    >
                      ${opt.label}
                    </button>
                  `
                )
                .join('')}
            </div>
          </div>

          <span id="transitive-farthest-count" class="transitive-count-pill tabular">${filteredRows.length} schools</span>
        </div>
      </section>
    `;

    const bodyHtml =
      state.transitiveError && !seasonGraph
        ? `
          <div class="md-card error-card">
            <h3>Unable to load ${escapeHtml(String(seasonYear))} season results</h3>
            <p class="muted">${escapeHtml(state.transitiveError)}</p>
            <button id="transitive-retry-btn" class="md-btn md-btn-filled" type="button">Retry</button>
          </div>
        `
        : `<div id="transitive-farthest-list-host" class="transitive-farthest-host">${renderFarthestLeaderboardMarkup(filteredRows, state, seasonYear)}</div>`;

    container.innerHTML = `<div class="transitive-view">${controlsHtml}${bodyHtml}</div>`;

    container.querySelectorAll('[data-transitive-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        callbacks.onUpdateTransitiveState?.({ transitiveMode: btn.dataset.transitiveMode });
      });
    });

    container.querySelectorAll('[data-school-div]').forEach((btn) => {
      btn.addEventListener('click', () => {
        farthestUiState.showAll = false;
        callbacks.onUpdateTransitiveState?.({ transitiveFarthestSchoolDiv: btn.dataset.schoolDiv });
      });
    });

    container.querySelectorAll('[data-target-scope]').forEach((btn) => {
      btn.addEventListener('click', () => {
        farthestUiState.showAll = false;
        callbacks.onUpdateTransitiveState?.({ transitiveFarthestTargetScope: btn.dataset.targetScope });
      });
    });

    container.querySelectorAll('[data-farthest-sort]').forEach((btn) => {
      btn.addEventListener('click', () => {
        callbacks.onUpdateTransitiveState?.({ transitiveFarthestSort: btn.dataset.farthestSort });
      });
    });

    const farthestSearchEl = container.querySelector('#transitive-farthest-search');
    if (farthestSearchEl) {
      farthestSearchEl.addEventListener('input', () => {
        farthestUiState.query = farthestSearchEl.value;
        farthestUiState.showAll = false;
        updateFarthestHostInPlace(container);
      });
    }

    container.querySelector('#transitive-retry-btn')?.addEventListener('click', () => {
      callbacks.onRetrySeasonGraph?.();
    });

    const hostEl = container.querySelector('#transitive-farthest-list-host');
    if (hostEl) {
      hostEl.addEventListener('click', (e) => {
        const showAllBtn = e.target.closest?.('#transitive-show-all-btn');
        if (showAllBtn) {
          farthestUiState.showAll = true;
          updateFarthestHostInPlace(container);
          return;
        }

        const openGameBtn = e.target.closest?.('[data-open-event]');
        if (openGameBtn) {
          callbacks.onOpenGameSheet?.(openGameBtn.dataset.openEvent, openGameBtn.dataset.openTitle || '');
          return;
        }

        const compareBtn = e.target.closest?.('[data-compare-a]');
        if (compareBtn) {
          callbacks.onUpdateTransitiveState?.({
            transitiveMode: 'matchup',
            transitiveTeamAId: compareBtn.dataset.compareA,
            transitiveTeamBId: compareBtn.dataset.compareB
          });
          return;
        }

        const toggleBtn = e.target.closest?.('[data-toggle-school]');
        if (toggleBtn) {
          const tid = String(toggleBtn.dataset.toggleSchool || '');
          if (!tid) return;
          const prev = (getState().transitiveExpandedSchoolIds || []).map(String);
          const next = prev.includes(tid) ? prev.filter((id) => id !== tid) : [...prev, tid];
          callbacks.onUpdateTransitiveState?.({ transitiveExpandedSchoolIds: next });
        }
      });
    }

    return;
  }

  let comparison = null;
  if (bothSelected && seasonGraph && Array.isArray(seasonGraph.games)) {
    comparison = computeTransitiveComparison(seasonGraph, teamAId, teamBId, { maxChains: 5 });
  }

  const teamAMeta = teamAId ? resolveTeamMeta(teamAId, state) : null;
  const teamBMeta = teamBId ? resolveTeamMeta(teamBId, state) : null;
  const quickMatchups = buildQuickMatchups(selectableCatalog, seasonGraph);

  const controlsHtml = `
    <section class="md-card transitive-controls-card" aria-label="Team comparison selector">
      <div class="transitive-controls-top">
        <div>
          <h2 class="transitive-hero-title">Transitive Wins & Losses Explorer</h2>
          <p class="transitive-hero-subtitle">
            Search any two FBS or FCS teams to find up to 5 shortest transitive win chains and 5 shortest transitive loss chains from ${escapeHtml(String(seasonYear))} season results.
          </p>
        </div>
        ${
          seasonGraph
            ? `
              <div class="transitive-graph-badge">
                <span class="material-symbols-rounded" style="font-size:16px;">sports_football</span>
                <span class="tabular">${escapeHtml(String(seasonGraph.completedCount))} completed games indexed</span>
              </div>
            `
            : ''
        }
      </div>

      ${modeTabsHtml}

      <div class="transitive-pickers-row">
        ${renderTeamPickerCard({
          slot: 'A',
          label: 'Team A',
          selectedId: teamAId,
          oppositeId: teamBId,
          catalog: selectableCatalog,
          teamsLoading: state.teamsLoading,
          theme: state.theme,
          recordFallback: comparison ? `${comparison.stats.teamAWins}-${comparison.stats.teamALosses}` : ''
        })}

        <div class="transitive-swap-col">
          <button
            type="button"
            class="md-btn md-btn-tonal transitive-swap-btn"
            data-swap-teams="1"
            ${!teamAId && !teamBId ? 'disabled' : ''}
            aria-label="Swap Team A and Team B"
            title="Swap Team A and Team B"
          >
            <span class="material-symbols-rounded">swap_horiz</span>
            <span>Swap</span>
          </button>
        </div>

        ${renderTeamPickerCard({
          slot: 'B',
          label: 'Team B',
          selectedId: teamBId,
          oppositeId: teamAId,
          catalog: selectableCatalog,
          teamsLoading: state.teamsLoading,
          theme: state.theme,
          recordFallback: comparison ? `${comparison.stats.teamBWins}-${comparison.stats.teamBLosses}` : ''
        })}
      </div>

      ${
        quickMatchups.length > 0 && !bothSelected
          ? `
            <div class="transitive-presets-row">
              <span class="transitive-presets-label">Try a matchup:</span>
              ${quickMatchups
                .map(
                  (m) => `
                    <button
                      type="button"
                      class="md-chip transitive-preset-chip"
                      data-preset-a="${escapeHtml(m.teamAId)}"
                      data-preset-b="${escapeHtml(m.teamBId)}"
                    >
                      ${escapeHtml(m.label)}
                    </button>
                  `
                )
                .join('')}
            </div>
          `
          : ''
      }
    </section>
  `;

  let bodyHtml = '';
  if (state.transitiveError && !seasonGraph) {
    bodyHtml = `
      <div class="md-card error-card">
        <h3>Unable to load ${escapeHtml(String(seasonYear))} season results</h3>
        <p class="muted">${escapeHtml(state.transitiveError)}</p>
        <button id="transitive-retry-btn" class="md-btn md-btn-filled" type="button">Retry</button>
      </div>
    `;
  } else if (!bothSelected) {
    bodyHtml = `
      <div class="md-card empty-card transitive-prompt-card">
        <span class="material-symbols-rounded" style="font-size:40px;color:var(--md-sys-color-primary);">account_tree</span>
        <h3>Select Team A and Team B</h3>
        <p class="muted">
          Choose any FBS or FCS team in both search menus above. Chains with lower degrees of separation appear first (Degree 0 is a direct head-to-head result; Degree 1 uses one intermediate team).
        </p>
      </div>
    `;
  } else if (state.transitiveLoading && !seasonGraph) {
    bodyHtml = `
      <div class="transitive-results-grid">
        <div class="skeleton" style="height:280px;"></div>
        <div class="skeleton" style="height:280px;"></div>
      </div>
    `;
  } else if (comparison && teamAMeta && teamBMeta) {
    const shortestWin = comparison.winChains.length > 0 ? `Degree ${comparison.winChains[0].degree}` : 'None found';
    const shortestLoss = comparison.lossChains.length > 0 ? `Degree ${comparison.lossChains[0].degree}` : 'None found';

    bodyHtml = `
      <div class="md-card transitive-summary-strip">
        <div class="transitive-summary-pair">
          <span class="transitive-summary-team">
            ${renderTeamLogo(teamAMeta, { size: 'sm', theme: state.theme })}
            <strong>${escapeHtml(teamAMeta.shortName)}</strong>
            <span class="muted tabular">(${escapeHtml(getPairRecordLabel(teamAMeta, comparison.stats.teamAWins, comparison.stats.teamALosses))})</span>
          </span>
          <span class="muted">vs</span>
          <span class="transitive-summary-team">
            ${renderTeamLogo(teamBMeta, { size: 'sm', theme: state.theme })}
            <strong>${escapeHtml(teamBMeta.shortName)}</strong>
            <span class="muted tabular">(${escapeHtml(getPairRecordLabel(teamBMeta, comparison.stats.teamBWins, comparison.stats.teamBLosses))})</span>
          </span>
        </div>
        <div class="transitive-summary-metrics">
          <span class="transitive-metric-badge win">Shortest Win: <strong>${escapeHtml(shortestWin)}</strong></span>
          <span class="transitive-metric-badge loss">Shortest Loss: <strong>${escapeHtml(shortestLoss)}</strong></span>
        </div>
      </div>

      <div class="transitive-results-grid">
        ${renderChainColumn({
          mode: 'wins',
          teamA: teamAMeta,
          teamB: teamBMeta,
          chains: comparison.winChains,
          stats: comparison.stats,
          seasonYear,
          theme: state.theme
        })}
        ${renderChainColumn({
          mode: 'losses',
          teamA: teamAMeta,
          teamB: teamBMeta,
          chains: comparison.lossChains,
          stats: comparison.stats,
          seasonYear,
          theme: state.theme
        })}
      </div>
    `;
  }

  container.innerHTML = `<div class="transitive-view">${controlsHtml}${bodyHtml}</div>`;

  // Mode toggle tabs
  container.querySelectorAll('[data-transitive-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      callbacks.onUpdateTransitiveState?.({ transitiveMode: btn.dataset.transitiveMode });
    });
  });

  // Wire search inputs (update list directly so focus stays intact while typing)
  container.querySelectorAll('[data-search-slot]').forEach((inputEl) => {
    const slot = inputEl.dataset.searchSlot;

    inputEl.addEventListener('focus', () => {
      if (!pickerState[slot].open) {
        pickerState[slot].open = true;
        pickerState[slot === 'A' ? 'B' : 'A'].open = false;
        syncMenuVisibility('A');
        syncMenuVisibility('B');
      }
    });

    inputEl.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!pickerState[slot].open) {
        pickerState[slot].open = true;
        pickerState[slot === 'A' ? 'B' : 'A'].open = false;
        syncMenuVisibility('A');
        syncMenuVisibility('B');
      }
    });

    inputEl.addEventListener('input', () => {
      pickerState[slot].query = inputEl.value;
      pickerState[slot].open = true;
      pickerState[slot === 'A' ? 'B' : 'A'].open = false;
      syncMenuVisibility('A');
      syncMenuVisibility('B');
    });

    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        pickerState[slot].open = false;
        syncMenuVisibility(slot);
      } else if (e.key === 'Enter') {
        const firstOpt = container.querySelector(`#transitive-list-${slot} [data-pick-team]`);
        if (firstOpt) {
          e.preventDefault();
          firstOpt.click();
        }
      }
    });
  });

  // Toggle menu buttons
  container.querySelectorAll('[data-toggle-menu]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const slot = btn.dataset.toggleMenu;
      pickerState[slot].open = !pickerState[slot].open;
      pickerState[slot === 'A' ? 'B' : 'A'].open = false;
      syncMenuVisibility('A');
      syncMenuVisibility('B');
      if (pickerState[slot].open) {
        container.querySelector(`#transitive-search-${slot}`)?.focus();
      }
    });
  });

  // Division filter chips inside dropdown menus
  container.querySelectorAll('[data-menu-div-slot]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const slot = btn.dataset.menuDivSlot;
      const div = btn.dataset.menuDiv;
      pickerState[slot].divisionFilter = div;
      const menuEl = container.querySelector(`#transitive-menu-${slot}`);
      menuEl?.querySelectorAll('[data-menu-div-slot]').forEach((chip) => {
        chip.classList.toggle('active', chip.dataset.menuDiv === div);
      });
      refreshMenuListOnly(slot);
      container.querySelector(`#transitive-search-${slot}`)?.focus();
    });
  });

  // Delegated click handler on options list
  container.querySelectorAll('.transitive-options-list').forEach((listEl) => {
    listEl.addEventListener('click', (e) => {
      const opt = e.target.closest?.('[data-pick-team]');
      if (!opt) return;
      e.stopPropagation();
      const slot = opt.dataset.pickSlot;
      const pickedId = opt.dataset.pickTeam;
      const cur = getState();
      let nextA = cur.transitiveTeamAId ? String(cur.transitiveTeamAId) : null;
      let nextB = cur.transitiveTeamBId ? String(cur.transitiveTeamBId) : null;

      if (slot === 'A') {
        if (String(pickedId) === String(nextB || '')) {
          nextB = nextA;
        }
        nextA = pickedId;
      } else {
        if (String(pickedId) === String(nextA || '')) {
          nextA = nextB;
        }
        nextB = pickedId;
      }

      pickerState[slot].open = false;
      pickerState[slot].query = '';
      activeCallbacksRef?.onSelectTeams?.({ teamAId: nextA, teamBId: nextB });
    });
  });

  // Clear buttons
  container.querySelectorAll('[data-clear-slot]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const slot = btn.dataset.clearSlot;
      const cur = getState();
      pickerState[slot].query = '';
      pickerState[slot].open = false;
      if (slot === 'A') {
        callbacks.onSelectTeams({ teamAId: null, teamBId: cur.transitiveTeamBId });
      } else {
        callbacks.onSelectTeams({ teamAId: cur.transitiveTeamAId, teamBId: null });
      }
    });
  });

  // Swap button
  container.querySelector('[data-swap-teams]')?.addEventListener('click', () => {
    const cur = getState();
    callbacks.onSelectTeams({
      teamAId: cur.transitiveTeamBId || null,
      teamBId: cur.transitiveTeamAId || null
    });
  });

  // Quick matchup presets
  container.querySelectorAll('[data-preset-a]').forEach((btn) => {
    btn.addEventListener('click', () => {
      pickerState.A.open = false;
      pickerState.B.open = false;
      pickerState.A.query = '';
      pickerState.B.query = '';
      callbacks.onSelectTeams({
        teamAId: btn.dataset.presetA,
        teamBId: btn.dataset.presetB
      });
    });
  });

  // Retry button
  container.querySelector('#transitive-retry-btn')?.addEventListener('click', () => {
    callbacks.onRetrySeasonGraph?.();
  });

  // Clickable games -> open Game Center side sheet
  container.querySelectorAll('.transitive-results-grid [data-open-event]').forEach((btn) => {
    btn.addEventListener('click', () => {
      callbacks.onOpenGameSheet?.(btn.dataset.openEvent, btn.dataset.openTitle || '');
    });
  });
}
