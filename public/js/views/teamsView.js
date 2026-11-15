import { getState, setState } from '../store.js';
import {
  escapeHtml,
  renderTeamLogo,
  renderRankBadge,
  formatKickoffTime,
  formatDayHeading
} from '../ui.js';
import { POWER_4_CONFERENCE_IDS } from './scheduleView.js';
import { adaptColorForTheme, parseBarShare } from './gameDetail.js';

let quickSearchQuery = '';
let lastRenderedTeamId = null;

const TEAM_STAT_FILTER_CHIPS = [
  { key: 'all', label: 'All Categories' },
  { key: 'passing', label: 'Passing' },
  { key: 'rushing', label: 'Rushing' },
  { key: 'receiving', label: 'Receiving' },
  { key: 'defensive', label: 'Defense' },
  { key: 'miscellaneous', label: 'Downs & Misc' },
  { key: 'special', label: 'Special Teams' },
  { key: 'scoring', label: 'Scoring' }
];

function isValidTeamId(id) {
  return Boolean(id) && String(id) !== '0' && !/^-\d+$/.test(String(id));
}

function preserveFocusedInput(container, activeSnap) {
  if (!activeSnap) return;
  const input = container.querySelector(`#${activeSnap.id}`);
  if (!input) return;
  input.focus({ preventScroll: true });
  if (typeof activeSnap.start === 'number' && typeof activeSnap.end === 'number') {
    try {
      input.setSelectionRange(activeSnap.start, activeSnap.end);
    } catch (err) {
      // Ignore selection restoration error on unsupported input types
    }
  }
}

function getFilteredDirectoryTeams(state) {
  const { teamsDirectory, teamsFilter, searchQuery } = state;
  const q = (teamsFilter.search || searchQuery || '').trim().toLowerCase();

  return teamsDirectory.filter((team) => {
    if (teamsFilter.division === 'top25' && !team.rank) {
      return false;
    } else if (
      teamsFilter.division !== 'all' &&
      teamsFilter.division !== 'top25' &&
      team.division !== teamsFilter.division
    ) {
      return false;
    }

    if (teamsFilter.conferenceId === 'power4') {
      if (!POWER_4_CONFERENCE_IDS.has(String(team.conferenceId || ''))) {
        return false;
      }
    } else if (teamsFilter.conferenceId !== 'all') {
      if (String(team.conferenceId || '') !== String(teamsFilter.conferenceId)) {
        return false;
      }
    }

    if (q) {
      const hay = [
        team.displayName,
        team.shortName,
        team.location,
        team.nickname,
        team.abbreviation,
        team.conferenceName,
        team.conferenceShortName,
        team.division
      ]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) {
        return false;
      }
    }

    return true;
  });
}

function renderDirectoryTeamCard(team, theme) {
  return `
    <button
      class="md-card md-card-interactive team-dir-card"
      type="button"
      data-select-team="${escapeHtml(team.id)}"
      aria-label="Open ${escapeHtml(team.displayName)} team page"
    >
      <div class="team-dir-card-top">
        ${renderTeamLogo(team, { theme })}
        <div class="team-dir-card-meta">
          <div class="team-dir-name-row">
            ${renderRankBadge(team.rank)}
            <span class="team-dir-name">${escapeHtml(team.displayName)}</span>
          </div>
          <div class="team-dir-sub muted">
            <span>${escapeHtml(team.abbreviation || team.shortName)}</span>
            <span>·</span>
            <span>${escapeHtml(team.conferenceShortName || team.division)}</span>
          </div>
        </div>
      </div>
      <div class="team-dir-card-footer">
        <span class="team-div-pill div-${escapeHtml(team.division.replace('/', '').toLowerCase())}">${escapeHtml(team.division)}</span>
        ${
          team.overallRecord
            ? `<span class="tabular" style="font-size:12px;font-weight:600;">${escapeHtml(team.overallRecord)}</span>`
            : `<span class="muted" style="font-size:12px;font-weight:500;">Schedule &amp; Stats →</span>`
        }
      </div>
    </button>
  `;
}

function renderDirectoryResultsHtml(state, filtered, visibleTeams, hasMore) {
  const { theme, teamsDirectory, teamsLoading, teamsError } = state;

  if (teamsLoading && teamsDirectory.length === 0) {
    return `
      <div class="teams-dir-grid">
        ${Array.from({ length: 12 })
          .map(() => `<div class="skeleton" style="height:104px;border-radius:16px;"></div>`)
          .join('')}
      </div>
    `;
  }

  if (teamsError && teamsDirectory.length === 0) {
    return `
      <div class="md-card empty-state-card">
        <span class="material-symbols-rounded">cloud_off</span>
        <p class="empty-state-title">Unable to load NCAA teams directory</p>
        <p class="empty-state-desc">${escapeHtml(teamsError)}</p>
        <button class="md-btn md-btn-filled" type="button" id="retry-teams-dir-btn">Retry</button>
      </div>
    `;
  }

  if (visibleTeams.length === 0) {
    return `
      <div class="md-card empty-state-card">
        <span class="material-symbols-rounded">search_off</span>
        <p class="empty-state-title">No matching teams found</p>
        <p class="empty-state-desc">Try searching by school name, mascot, abbreviation, or switching division/conference filters.</p>
        <button class="md-btn md-btn-tonal" type="button" id="reset-teams-dir-btn">Reset Filters</button>
      </div>
    `;
  }

  return `
    <div class="teams-dir-grid">
      ${visibleTeams.map((team) => renderDirectoryTeamCard(team, theme)).join('')}
    </div>
    ${
      hasMore
        ? `
      <div class="teams-load-more-row">
        <button class="md-btn md-btn-tonal" type="button" id="teams-show-all-btn">
          Show All ${filtered.length} Matching Teams (${filtered.length - visibleTeams.length} more)
        </button>
      </div>
    `
        : ''
    }
  `;
}

function bindDirectoryResultEvents(container, callbacks) {
  const showAllBtn = container.querySelector('#teams-show-all-btn');
  if (showAllBtn) {
    showAllBtn.addEventListener('click', () => {
      setState((prev) => ({
        teamsFilter: { ...prev.teamsFilter, limit: 2000 }
      }));
    });
  }

  const resetBtn = container.querySelector('#reset-teams-dir-btn');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      setState({
        searchQuery: '',
        teamsFilter: { division: 'all', conferenceId: 'all', search: '', limit: 120 }
      });
      const globalSearch = document.getElementById('global-search');
      if (globalSearch) globalSearch.value = '';
    });
  }

  const retryBtn = container.querySelector('#retry-teams-dir-btn');
  if (retryBtn) {
    retryBtn.addEventListener('click', () => callbacks.onRetryDirectory());
  }

  container.querySelectorAll('[data-select-team]').forEach((card) => {
    card.addEventListener('click', () => {
      callbacks.onOpenTeam(card.dataset.selectTeam);
    });
  });
}

function renderTeamsDirectory(container, state, callbacks, focusSnap) {
  const {
    theme,
    teamsDirectory,
    teamsFilter,
    conferences,
    fcsConferences
  } = state;

  const filtered = getFilteredDirectoryTeams(state);
  const fbsCount = teamsDirectory.filter((t) => t.division === 'FBS').length;
  const fcsCount = teamsDirectory.filter((t) => t.division === 'FCS').length;
  const d2Count = teamsDirectory.filter((t) => t.division === 'D2/D3').length;
  const top25Count = teamsDirectory.filter((t) => Boolean(t.rank)).length;

  const maxVisible = teamsFilter.limit || 120;
  const visibleTeams = filtered.slice(0, maxVisible);
  const hasMore = filtered.length > visibleTeams.length;

  // Preserve the directory search input DOM element across live typing updates
  const existingResultsEl = container.querySelector('#teams-dir-results');
  const existingShellCount = existingResultsEl?.dataset.totalCount;
  const existingConfsCount = existingResultsEl?.dataset.confsCount;
  const existingTheme = existingResultsEl?.dataset.theme;
  if (
    existingResultsEl &&
    String(existingShellCount) === String(teamsDirectory.length) &&
    String(existingConfsCount) === String(conferences.length + fcsConferences.length) &&
    String(existingTheme) === String(theme)
  ) {
    const dirInput = container.querySelector('#teams-dir-search');
    if (dirInput && dirInput.value !== teamsFilter.search) {
      dirInput.value = teamsFilter.search;
    }
    const clearBtn = container.querySelector('#teams-dir-search-clear');
    if (clearBtn) {
      clearBtn.style.display = teamsFilter.search ? 'inline-flex' : 'none';
    }
    container.querySelectorAll('[data-team-div]').forEach((btn) => {
      const active = btn.dataset.teamDiv === teamsFilter.division;
      btn.classList.toggle('selected', active);
      if (btn.dataset.teamDiv === 'top25') {
        const iconEl = btn.querySelector('.material-symbols-rounded');
        if (iconEl) iconEl.textContent = active ? 'check' : 'star';
      }
    });
    const confSelect = container.querySelector('#teams-conf-select');
    if (confSelect && confSelect.value !== teamsFilter.conferenceId) {
      confSelect.value = teamsFilter.conferenceId;
    }
    const countEl = container.querySelector('#teams-dir-count');
    if (countEl) {
      countEl.textContent = `${filtered.length} team${filtered.length === 1 ? '' : 's'}`;
    }
    existingResultsEl.innerHTML = renderDirectoryResultsHtml(state, filtered, visibleTeams, hasMore);
    bindDirectoryResultEvents(existingResultsEl, callbacks);
    return;
  }

  container.innerHTML = `
    <section class="md-card md-card-filled teams-header-card">
      <div class="teams-header-top">
        <div>
          <h2 class="section-heading">NCAA Football Teams Directory</h2>
          <div class="muted" style="font-size:12px;">
            ${teamsDirectory.length ? `Browse and search all ${teamsDirectory.length} NCAA teams (FBS, FCS &amp; Division II/III)` : 'Loading NCAA teams catalog from ESPN...'}
          </div>
        </div>

        <label class="md-search-bar teams-dir-search-bar" aria-label="Search all NCAA football teams">
          <span class="material-symbols-rounded muted">search</span>
          <input
            id="teams-dir-search"
            type="search"
            value="${escapeHtml(teamsFilter.search)}"
            placeholder="Search any NCAA team (e.g. Alabama, NDSU, Texas)..."
            autocomplete="off"
          >
          <button
            id="teams-dir-search-clear"
            class="md-icon-btn small"
            type="button"
            aria-label="Clear team search"
            style="display:${teamsFilter.search ? 'inline-flex' : 'none'};"
          >
            <span class="material-symbols-rounded" style="font-size:18px;">close</span>
          </button>
        </label>
      </div>

      <div class="controls-filter-row">
        <div class="md-chip-row">
          <button class="md-chip${teamsFilter.division === 'all' ? ' selected' : ''}" type="button" data-team-div="all">
            All NCAA (${teamsDirectory.length})
          </button>
          <button class="md-chip${teamsFilter.division === 'FBS' ? ' selected' : ''}" type="button" data-team-div="FBS">
            FBS (${fbsCount})
          </button>
          <button class="md-chip${teamsFilter.division === 'FCS' ? ' selected' : ''}" type="button" data-team-div="FCS">
            FCS (${fcsCount})
          </button>
          <button class="md-chip${teamsFilter.division === 'D2/D3' ? ' selected' : ''}" type="button" data-team-div="D2/D3">
            Div II / III (${d2Count})
          </button>
          <button class="md-chip${teamsFilter.division === 'top25' ? ' selected' : ''}" type="button" data-team-div="top25">
            <span class="material-symbols-rounded">${teamsFilter.division === 'top25' ? 'check' : 'star'}</span>
            Top 25 (${top25Count})
          </button>
        </div>

        <div style="display:flex;align-items:center;gap:10px;">
          <select class="md-select" id="teams-conf-select" aria-label="Filter teams by conference">
            <option value="all"${teamsFilter.conferenceId === 'all' ? ' selected' : ''}>All Conferences</option>
            <option value="power4"${teamsFilter.conferenceId === 'power4' ? ' selected' : ''}>Power 4 Conferences</option>
            ${
              conferences.length > 0
                ? `<optgroup label="FBS Conferences">
                    ${conferences
                      .map(
                        (c) =>
                          `<option value="${escapeHtml(c.id)}"${teamsFilter.conferenceId === c.id ? ' selected' : ''}>${escapeHtml(c.shortName)}</option>`
                      )
                      .join('')}
                  </optgroup>`
                : ''
            }
            ${
              fcsConferences.length > 0
                ? `<optgroup label="FCS Conferences">
                    ${fcsConferences
                      .map(
                        (c) =>
                          `<option value="${escapeHtml(c.id)}"${teamsFilter.conferenceId === c.id ? ' selected' : ''}>${escapeHtml(c.shortName)}</option>`
                      )
                      .join('')}
                  </optgroup>`
                : ''
            }
          </select>
          <span id="teams-dir-count" class="muted tabular" style="font-size:12px;font-weight:600;">${filtered.length} team${filtered.length === 1 ? '' : 's'}</span>
        </div>
      </div>
    </section>

    <div
      id="teams-dir-results"
      data-total-count="${teamsDirectory.length}"
      data-confs-count="${conferences.length + fcsConferences.length}"
      data-theme="${escapeHtml(theme)}"
    >
      ${renderDirectoryResultsHtml(state, filtered, visibleTeams, hasMore)}
    </div>
  `;

  preserveFocusedInput(container, focusSnap);

  const dirSearchInput = container.querySelector('#teams-dir-search');
  if (dirSearchInput) {
    dirSearchInput.addEventListener('input', () => {
      const val = dirSearchInput.value;
      setState((prev) => ({
        teamsFilter: { ...prev.teamsFilter, search: val, limit: 120 }
      }));
    });
  }

  const clearBtn = container.querySelector('#teams-dir-search-clear');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      setState((prev) => ({
        teamsFilter: { ...prev.teamsFilter, search: '' }
      }));
      if (dirSearchInput) dirSearchInput.focus();
    });
  }

  container.querySelectorAll('[data-team-div]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const nextDiv = btn.dataset.teamDiv;
      setState((prev) => ({
        teamsFilter: {
          ...prev.teamsFilter,
          division: nextDiv,
          conferenceId:
            nextDiv === 'FBS' && prev.teamsFilter.conferenceId === 'power4'
              ? 'power4'
              : 'all',
          limit: 120
        }
      }));
    });
  });

  const confSelect = container.querySelector('#teams-conf-select');
  if (confSelect) {
    confSelect.addEventListener('change', () => {
      const val = confSelect.value;
      setState((prev) => ({
        teamsFilter: {
          ...prev.teamsFilter,
          conferenceId: val,
          division: val === 'all' ? prev.teamsFilter.division : 'all',
          limit: 120
        }
      }));
    });
  }

  bindDirectoryResultEvents(container, callbacks);
}

function renderQuickSearchDropdown(teamsDirectory, query, currentTeamId, theme) {
  const q = query.trim().toLowerCase();
  if (!q) return '';

  const matches = teamsDirectory
    .filter((t) => {
      if (t.id === String(currentTeamId)) return false;
      const hay = `${t.displayName} ${t.abbreviation} ${t.conferenceShortName} ${t.division}`.toLowerCase();
      return hay.includes(q);
    })
    .slice(0, 8);

  if (matches.length === 0) {
    return `<div class="team-quick-empty muted">No NCAA teams matching "${escapeHtml(query)}"</div>`;
  }

  return matches
    .map(
      (t) => `
    <button class="team-quick-item" type="button" data-quick-team="${escapeHtml(t.id)}">
      ${renderTeamLogo(t, { size: 'sm', theme })}
      <span class="team-quick-item-name">
        ${renderRankBadge(t.rank)}
        <span>${escapeHtml(t.displayName)}</span>
      </span>
      <span class="muted" style="font-size:11px;white-space:nowrap;">${escapeHtml(t.conferenceShortName || t.division)}</span>
    </button>
  `
    )
    .join('');
}

function renderSeasonScheduleRow(ev, { theme, isCurrentSeason, rankMap, liveEvents = [], scoreboardEvents = [] }) {
  const opp = ev.opponent;
  const oppRank = opp.rank || (ev.isFuture && isCurrentSeason ? rankMap[opp.id] : null);
  const canLinkOpp = isValidTeamId(opp.id);
  const dateLabel = formatDayHeading(ev.date);
  const badgeText =
    ev.seasonTypeId === '3'
      ? ev.weekText || 'Postseason'
      : ev.weekText || (ev.weekNumber ? `Week ${ev.weekNumber}` : 'Game');

  const oppNameHtml = canLinkOpp
    ? `<span class="team-sched-opp-name team-page-link" data-team-id="${escapeHtml(opp.id)}" role="link" tabindex="0" title="Open ${escapeHtml(opp.displayName)} team page">${escapeHtml(opp.displayName)}</span>`
    : `<span class="team-sched-opp-name">${escapeHtml(opp.displayName)}</span>`;

  let outcomeHtml = '';
  if (ev.isLive) {
    const liveFeed = liveEvents.find((e) => e.id === ev.id) || scoreboardEvents.find((e) => e.id === ev.id);
    const liveTeamComp = liveFeed ? (ev.isHome ? liveFeed.home : liveFeed.away) : ev.teamComp;
    const liveOppComp = liveFeed ? (ev.isHome ? liveFeed.away : liveFeed.home) : opp;
    const liveStatus = liveFeed?.statusDetail || ev.statusDetail || 'LIVE';
    const liveTeamScore = liveTeamComp?.score || ev.teamComp.score || '0';
    const liveOppScore = liveOppComp?.score || opp.score || '0';

    outcomeHtml = `
      <div class="team-sched-outcome">
        <span class="status-pill live"><span class="pulse-dot live"></span>${escapeHtml(liveStatus)}</span>
        <span class="team-sched-score tabular">${escapeHtml(liveTeamScore)} - ${escapeHtml(liveOppScore)}</span>
        <button class="md-btn md-btn-tonal team-game-open-btn" type="button" data-open-game="${escapeHtml(ev.id)}">Live PBP →</button>
      </div>
    `;
  } else if (ev.isPast) {
    const resClass = ev.result === 'W' ? 'win' : ev.result === 'L' ? 'loss' : 'tie';
    outcomeHtml = `
      <div class="team-sched-outcome">
        ${ev.result ? `<span class="team-result-pill ${resClass}">${escapeHtml(ev.result)}</span>` : ''}
        <span class="team-sched-score tabular">${escapeHtml(ev.teamComp.score || '0')} - ${escapeHtml(opp.score || '0')}</span>
        <button class="md-btn md-btn-outlined team-game-open-btn" type="button" data-open-game="${escapeHtml(ev.id)}">Game Center</button>
      </div>
    `;
  } else {
    const kickoff = ev.statusDetail && /tbd/i.test(ev.statusDetail) ? 'TBD' : formatKickoffTime(ev.date);
    outcomeHtml = `
      <div class="team-sched-outcome">
        <div class="team-sched-future-meta">
          <span class="status-pill pre">${escapeHtml(kickoff)}</span>
          ${ev.broadcast ? `<span class="broadcast-tag">${escapeHtml(ev.broadcast)}</span>` : ''}
        </div>
        <button class="md-btn md-btn-tonal team-game-open-btn" type="button" data-open-game="${escapeHtml(ev.id)}">Preview</button>
      </div>
    `;
  }

  return `
    <div class="team-sched-row${ev.isLive ? ' is-live' : ''}">
      <div class="team-sched-date-col">
        <span class="team-sched-week">${escapeHtml(badgeText)}</span>
        <span class="muted" style="font-size:12px;">${escapeHtml(dateLabel)}</span>
      </div>

      <div class="team-sched-matchup-col">
        <span class="team-venue-chip">${escapeHtml(ev.venuePrefix)}</span>
        ${renderTeamLogo(opp, { size: 'sm', theme })}
        <div class="team-sched-opp-stack">
          <div class="team-sched-opp-line">
            ${renderRankBadge(oppRank)}
            ${oppNameHtml}
          </div>
          <div class="muted team-sched-opp-sub">
            ${opp.overallRecord ? `<span>${escapeHtml(opp.overallRecord)}</span>` : ''}
            ${opp.overallRecord && ev.venue?.name ? '<span>·</span>' : ''}
            ${ev.venue?.name ? `<span>${escapeHtml(ev.venue.name)}</span>` : ''}
            ${ev.headline ? `<span>· ${escapeHtml(ev.headline)}</span>` : ''}
          </div>
        </div>
      </div>

      ${outcomeHtml}
    </div>
  `;
}

function renderScheduleGroupSection(title, games, opts) {
  if (games.length === 0) return '';
  return `
    <div class="team-sched-group">
      <div class="team-sched-group-title">
        <span>${escapeHtml(title)}</span>
        <span class="muted tabular" style="font-size:12px;">${games.length} game${games.length === 1 ? '' : 's'}</span>
      </div>
      <div class="team-sched-list">
        ${games.map((g) => renderSeasonScheduleRow(g, opts)).join('')}
      </div>
    </div>
  `;
}

function renderTeamStatisticsSection(data, teamColor, state, seasonYear) {
  const { team, stats, seasonSummary } = data;
  const oppColor = state.theme === 'dark' ? '#94a3b8' : '#64748b';
  const selectedCat = state.teamStatsCategory || 'all';

  if (!stats || !stats.categories || stats.categories.length === 0) {
    return `
      <section class="md-card team-section-card">
        <div class="team-section-header">
          <div>
            <h3 class="section-heading">${escapeHtml(seasonYear)} Team Statistics</h3>
            <div class="muted" style="font-size:12px;">Season scoring and performance splits derived from game results</div>
          </div>
        </div>

        <div class="team-fallback-stats-note muted">
          <span class="material-symbols-rounded" style="font-size:18px;">info</span>
          <span>ESPN does not publish full passing/rushing/defensive team boxscore splits for this division or season. Showing schedule-derived scoring metrics below.</span>
        </div>

        <div class="team-stats-cat-grid">
          <div class="md-card team-stat-cat-card">
            <h4 class="team-stat-cat-title">Season Scoring &amp; Splits</h4>
            <table class="team-stat-table">
              <tbody>
                <tr><td>Games Completed</td><td class="tabular">${escapeHtml(seasonSummary.completedCount)}</td></tr>
                <tr><td>Overall Record</td><td class="tabular">${escapeHtml(seasonSummary.record)}</td></tr>
                <tr><td>Home / Road Record</td><td class="tabular">${escapeHtml(seasonSummary.homeRecord)} / ${escapeHtml(seasonSummary.awayRecord)}</td></tr>
                <tr><td>Total Points Scored</td><td class="tabular">${escapeHtml(seasonSummary.pointsFor)}</td></tr>
                <tr><td>Total Points Allowed</td><td class="tabular">${escapeHtml(seasonSummary.pointsAgainst)}</td></tr>
                <tr><td>Points Per Game</td><td class="tabular">${escapeHtml(seasonSummary.ppg)}</td></tr>
                <tr><td>Opponent Points Per Game</td><td class="tabular">${escapeHtml(seasonSummary.oppPpg)}</td></tr>
                <tr><td>Point Differential</td><td class="tabular">${escapeHtml(seasonSummary.pointDiffDisplay)}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>
    `;
  }

  const availableGroups = new Set(stats.categories.map((c) => c.groupKey));
  const filteredCats =
    selectedCat === 'all'
      ? stats.categories
      : stats.categories.filter((c) => c.groupKey === selectedCat);

  return `
    <section class="md-card team-section-card">
      <div class="team-section-header">
        <div>
          <h3 class="section-heading">${escapeHtml(seasonYear)} Team Statistics</h3>
          <div class="muted" style="font-size:12px;">Season totals, efficiency averages, and opponent comparisons via ESPN</div>
        </div>
      </div>

      ${
        stats.overviewComparisons.length > 0
          ? `
        <div class="md-card md-card-filled team-compare-card">
          <div class="team-compare-header">
            <div style="display:flex;align-items:center;gap:6px;">
              <span class="team-color-swatch" style="background:${teamColor}"></span>
              <strong style="color:${teamColor};">${escapeHtml(team.abbreviation || team.shortName)}</strong>
            </div>
            <span class="muted" style="font-size:11px;font-weight:700;letter-spacing:0.4px;">SEASON TEAM VS. OPPONENTS</span>
            <div style="display:flex;align-items:center;gap:6px;">
              <strong style="color:${oppColor};">Opponents</strong>
              <span class="team-color-swatch" style="background:${oppColor}"></span>
            </div>
          </div>

          <div class="stats-comparison-list">
            ${stats.overviewComparisons
              .map((row) => {
                const { awayPct, homePct } = parseBarShare(row.teamNumeric, row.oppNumeric);
                return `
                  <div class="stat-compare-item">
                    <div class="stat-compare-labels">
                      <strong style="color:${teamColor};">${escapeHtml(row.teamValue)}</strong>
                      <span class="muted">
                        ${escapeHtml(row.label)}
                        ${row.oppRank ? `<span style="opacity:0.8;"> (Opp #${escapeHtml(row.oppRank)})</span>` : ''}
                      </span>
                      <strong>${escapeHtml(row.oppValue)}</strong>
                    </div>
                    <div class="stat-compare-bar">
                      <div class="stat-bar-away" style="width:${awayPct}%;background-color:${teamColor};${awayPct === 0 ? 'display:none;' : ''}"></div>
                      <div class="stat-bar-home" style="width:${homePct}%;background-color:${oppColor};${homePct === 0 ? 'display:none;' : ''}"></div>
                    </div>
                  </div>
                `;
              })
              .join('')}
          </div>
        </div>
      `
          : ''
      }

      <div class="md-chip-row" style="margin:14px 0;">
        ${TEAM_STAT_FILTER_CHIPS.filter((ch) => ch.key === 'all' || availableGroups.has(ch.key))
          .map(
            (ch) => `
          <button
            class="md-chip${selectedCat === ch.key ? ' selected' : ''}"
            type="button"
            data-team-stat-cat="${escapeHtml(ch.key)}"
          >
            ${escapeHtml(ch.label)}
          </button>
        `
          )
          .join('')}
      </div>

      <div class="team-stats-cat-grid">
        ${filteredCats
          .map(
            (cat) => `
          <div class="md-card team-stat-cat-card">
            <h4 class="team-stat-cat-title">${escapeHtml(cat.displayName)}</h4>
            <div class="team-stat-table-wrap">
              <table class="team-stat-table">
                <thead>
                  <tr>
                    <th>Statistic</th>
                    <th>${escapeHtml(team.abbreviation || 'Team')}</th>
                    <th>Opp</th>
                  </tr>
                </thead>
                <tbody>
                  ${cat.items
                    .map(
                      (item) => `
                    <tr title="${escapeHtml(item.description)}">
                      <td>${escapeHtml(item.label)}</td>
                      <td class="tabular" style="font-weight:700;">${escapeHtml(item.teamValue)}</td>
                      <td class="tabular muted">${escapeHtml(item.oppValue ?? '-')}</td>
                    </tr>
                  `
                    )
                    .join('')}
                </tbody>
              </table>
            </div>
          </div>
        `
          )
          .join('')}
      </div>
    </section>
  `;
}

function renderTeamPage(container, state, callbacks, focusSnap) {
  const {
    selectedTeamId,
    teamSelectedSeason,
    teamScheduleFilter,
    teamPageData,
    teamPageLoading,
    teamPageError,
    teamsById,
    teamsDirectory,
    conferenceMap,
    rankMap,
    theme
  } = state;

  if (lastRenderedTeamId !== String(selectedTeamId)) {
    quickSearchQuery = '';
    lastRenderedTeamId = String(selectedTeamId);
  }

  const fallbackTeam = teamsById[String(selectedTeamId)] || null;
  const activeSeason =
    Number(teamSelectedSeason) ||
    teamPageData?.seasonYear ||
    state.currentSeasonYear ||
    new Date().getFullYear();
  const baseYear = teamPageData?.currentSeasonYear || state.currentSeasonYear || new Date().getFullYear();
  const seasonOptions = [];
  for (let y = baseYear; y >= Math.max(2018, baseYear - 8); y--) {
    seasonOptions.push(y);
  }

  const team = teamPageData?.team || fallbackTeam;
  const teamColor = adaptColorForTheme(team?.color || '#006c47', theme);
  const isCurrentSeason = Number(activeSeason) === Number(baseYear);
  const confObj =
    team?.conferenceId && conferenceMap[team.conferenceId]
      ? conferenceMap[team.conferenceId]
      : fallbackTeam?.conferenceShortName
        ? { name: fallbackTeam.conferenceName, shortName: fallbackTeam.conferenceShortName }
        : null;
  const divisionLabel = team?.division || fallbackTeam?.division || 'NCAA';
  const currentRank = isCurrentSeason ? rankMap[String(selectedTeamId)] || fallbackTeam?.rank || null : null;

  const events = teamPageData?.events || [];
  const liveGames = events.filter((e) => e.isLive);
  const pastGames = events.filter((e) => e.isPast);
  const futureGames = events.filter((e) => e.isFuture);
  const seasonSummary = teamPageData?.seasonSummary || {
    completedCount: 0,
    record: '0-0',
    confRecord: '0-0',
    homeRecord: '0-0',
    awayRecord: '0-0',
    pointsFor: 0,
    pointsAgainst: 0,
    ppg: '-',
    oppPpg: '-',
    pointDiff: 0,
    pointDiffDisplay: '-',
    streak: '-'
  };

  container.innerHTML = `
    <div class="team-nav-bar">
      <button class="md-btn md-btn-tonal" type="button" id="back-to-teams-btn">
        <span class="material-symbols-rounded" style="font-size:18px;">arrow_back</span>
        All NCAA Teams
      </button>

      <div class="team-quick-search-wrap">
        <label class="md-search-bar team-quick-search-bar" aria-label="Switch to another NCAA team">
          <span class="material-symbols-rounded muted">search</span>
          <input
            id="team-quick-search"
            type="search"
            value="${escapeHtml(quickSearchQuery)}"
            placeholder="Switch team..."
            autocomplete="off"
          >
        </label>
        <div class="team-quick-dropdown${quickSearchQuery.trim() ? ' open' : ''}" id="team-quick-dropdown">
          ${renderQuickSearchDropdown(teamsDirectory, quickSearchQuery, selectedTeamId, theme)}
        </div>
      </div>
    </div>

    ${
      teamPageLoading && (!teamPageData || String(teamPageData.team.id) !== String(selectedTeamId) || Number(teamPageData.seasonYear) !== Number(activeSeason))
        ? `
      <div class="skeleton" style="height:200px;border-radius:20px;margin-bottom:18px;"></div>
      <div class="skeleton" style="height:340px;border-radius:16px;margin-bottom:18px;"></div>
      <div class="skeleton" style="height:260px;border-radius:16px;"></div>
    `
        : teamPageError && !teamPageData
          ? `
      <div class="md-card empty-state-card">
        <span class="material-symbols-rounded">error_outline</span>
        <p class="empty-state-title">Unable to load Team Page</p>
        <p class="empty-state-desc">${escapeHtml(teamPageError)}</p>
        <div style="display:flex;gap:10px;justify-content:center;">
          <button class="md-btn md-btn-filled" type="button" id="retry-team-page-btn">Retry</button>
          <button class="md-btn md-btn-tonal" type="button" id="error-back-teams-btn">Back to Teams</button>
        </div>
      </div>
    `
          : `
      <section class="md-card md-card-elevated team-hero-card" style="border-top:4px solid ${escapeHtml(teamColor)};">
        <div class="team-hero-top">
          <div class="team-hero-identity">
            ${renderTeamLogo(team, { size: 'lg', theme })}
            <div style="min-width:0;">
              <div class="team-hero-title-row">
                ${renderRankBadge(currentRank)}
                <h2 class="team-hero-title">${escapeHtml(team?.displayName || 'College Football Team')}</h2>
              </div>
              <div class="team-hero-badges">
                <span class="team-div-pill div-${escapeHtml(divisionLabel.replace('/', '').toLowerCase())}">${escapeHtml(divisionLabel)}</span>
                ${confObj?.shortName ? `<span class="broadcast-tag">${escapeHtml(confObj.shortName)}</span>` : ''}
                ${isCurrentSeason && team?.standingSummary ? `<span class="status-pill pre">${escapeHtml(team.standingSummary)}</span>` : ''}
                ${team?.abbreviation ? `<span class="muted" style="font-size:12px;font-weight:600;">${escapeHtml(team.abbreviation)}</span>` : ''}
              </div>
            </div>
          </div>

          <div class="team-hero-actions">
            <label for="team-season-select" class="muted" style="font-size:12px;font-weight:600;">Season</label>
            <select class="md-select" id="team-season-select" aria-label="Select season year">
              ${seasonOptions
                .map(
                  (yr) => `<option value="${yr}"${Number(activeSeason) === yr ? ' selected' : ''}>${yr} Season</option>`
                )
                .join('')}
            </select>
          </div>
        </div>

        <div class="team-kpi-grid">
          <div class="team-kpi-card">
            <span class="team-kpi-label">${escapeHtml(activeSeason)} Record</span>
            <strong class="team-kpi-value tabular">${escapeHtml(seasonSummary.completedCount > 0 ? seasonSummary.record : (isCurrentSeason && team?.recordSummary ? team.recordSummary : '0-0'))}</strong>
            <span class="team-kpi-sub muted">${escapeHtml(seasonSummary.confRecord)} Conference</span>
          </div>
          <div class="team-kpi-card">
            <span class="team-kpi-label">Points / Game</span>
            <strong class="team-kpi-value tabular">${escapeHtml(seasonSummary.ppg)}</strong>
            <span class="team-kpi-sub muted">${escapeHtml(seasonSummary.pointsFor)} total pts</span>
          </div>
          <div class="team-kpi-card">
            <span class="team-kpi-label">Opp Points / Game</span>
            <strong class="team-kpi-value tabular">${escapeHtml(seasonSummary.oppPpg)}</strong>
            <span class="team-kpi-sub muted">${escapeHtml(seasonSummary.pointsAgainst)} allowed</span>
          </div>
          <div class="team-kpi-card">
            <span class="team-kpi-label">Point Differential</span>
            <strong class="team-kpi-value tabular ${seasonSummary.pointDiff > 0 ? 'diff-pos' : seasonSummary.pointDiff < 0 ? 'diff-neg' : ''}">${escapeHtml(seasonSummary.pointDiffDisplay)}</strong>
            <span class="team-kpi-sub muted">${escapeHtml(seasonSummary.completedCount)} game${seasonSummary.completedCount === 1 ? '' : 's'} played</span>
          </div>
          <div class="team-kpi-card">
            <span class="team-kpi-label">Home / Away</span>
            <strong class="team-kpi-value tabular">${escapeHtml(seasonSummary.homeRecord)} · ${escapeHtml(seasonSummary.awayRecord)}</strong>
            <span class="team-kpi-sub muted">Home · Road splits</span>
          </div>
          <div class="team-kpi-card">
            <span class="team-kpi-label">Streak / Form</span>
            <strong class="team-kpi-value tabular">${escapeHtml(seasonSummary.streak)}</strong>
            <span class="team-kpi-sub muted">${escapeHtml(futureGames.length)} upcoming game${futureGames.length === 1 ? '' : 's'}</span>
          </div>
        </div>
      </section>

      <section class="md-card team-section-card">
        <div class="team-section-header">
          <div>
            <h3 class="section-heading">${escapeHtml(activeSeason)} Season Schedule</h3>
            <div class="muted" style="font-size:12px;">Past results and future matchups · Click any opponent to view its team page</div>
          </div>

          <div class="md-chip-row">
            <button class="md-chip${teamScheduleFilter === 'all' ? ' selected' : ''}" type="button" data-team-sched-filter="all">
              All Games (${events.length})
            </button>
            <button class="md-chip${teamScheduleFilter === 'past' ? ' selected' : ''}" type="button" data-team-sched-filter="past">
              Past Results (${pastGames.length})
            </button>
            <button class="md-chip${teamScheduleFilter === 'future' ? ' selected' : ''}" type="button" data-team-sched-filter="future">
              Future Games (${futureGames.length})
            </button>
          </div>
        </div>

        ${
          events.length === 0
            ? `
          <div class="empty-state-card" style="padding:28px 16px;">
            <span class="material-symbols-rounded">event_busy</span>
            <p class="empty-state-title">No ${escapeHtml(activeSeason)} Games Found</p>
            <p class="empty-state-desc">ESPN did not return schedule events for this team in the ${escapeHtml(activeSeason)} season.</p>
          </div>
        `
            : `
          ${
            teamScheduleFilter === 'all'
              ? `
                ${renderScheduleGroupSection('Live In Progress', liveGames, { theme, isCurrentSeason, rankMap, liveEvents: state.liveEvents, scoreboardEvents: state.scoreboardEvents })}
                ${renderScheduleGroupSection('Future & Upcoming Games', futureGames, { theme, isCurrentSeason, rankMap })}
                ${renderScheduleGroupSection('Past Games & Results', pastGames, { theme, isCurrentSeason, rankMap })}
              `
              : teamScheduleFilter === 'past'
                ? (pastGames.length
                    ? renderScheduleGroupSection('Past Games & Results', pastGames, { theme, isCurrentSeason, rankMap })
                    : `<div class="empty-state-card" style="padding:24px;"><p class="empty-state-desc">No completed games in this season yet.</p></div>`)
                : (futureGames.length
                    ? renderScheduleGroupSection('Future & Upcoming Games', futureGames, { theme, isCurrentSeason, rankMap })
                    : `<div class="empty-state-card" style="padding:24px;"><p class="empty-state-desc">No remaining upcoming games scheduled for ${escapeHtml(activeSeason)}.</p></div>`)
          }
        `
        }
      </section>

      ${renderTeamStatisticsSection(teamPageData || { team, stats: null, seasonSummary }, teamColor, state, activeSeason)}
    `
    }
  `;

  preserveFocusedInput(container, focusSnap);

  const backBtn = container.querySelector('#back-to-teams-btn');
  if (backBtn) {
    backBtn.addEventListener('click', () => callbacks.onBackToDirectory());
  }

  const errorBackBtn = container.querySelector('#error-back-teams-btn');
  if (errorBackBtn) {
    errorBackBtn.addEventListener('click', () => callbacks.onBackToDirectory());
  }

  const retryPageBtn = container.querySelector('#retry-team-page-btn');
  if (retryPageBtn) {
    retryPageBtn.addEventListener('click', () => callbacks.onOpenTeam(selectedTeamId, activeSeason, { force: true }));
  }

  const seasonSelect = container.querySelector('#team-season-select');
  if (seasonSelect) {
    seasonSelect.addEventListener('change', () => {
      callbacks.onChangeSeason(selectedTeamId, Number(seasonSelect.value));
    });
  }

  container.querySelectorAll('[data-team-sched-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      setState({ teamScheduleFilter: btn.dataset.teamSchedFilter });
    });
  });

  container.querySelectorAll('[data-team-stat-cat]').forEach((btn) => {
    btn.addEventListener('click', () => {
      setState({ teamStatsCategory: btn.dataset.teamStatCat });
    });
  });

  container.querySelectorAll('[data-open-game]').forEach((btn) => {
    btn.addEventListener('click', () => {
      callbacks.onOpenGameSheet(btn.dataset.openGame);
    });
  });

  const quickInput = container.querySelector('#team-quick-search');
  const quickDropdown = container.querySelector('#team-quick-dropdown');
  const bindQuickItems = () => {
    if (!quickDropdown) return;
    quickDropdown.querySelectorAll('[data-quick-team]').forEach((item) => {
      item.addEventListener('click', () => {
        quickSearchQuery = '';
        callbacks.onOpenTeam(item.dataset.quickTeam);
      });
    });
  };
  bindQuickItems();

  if (quickInput && quickDropdown) {
    quickInput.addEventListener('input', () => {
      quickSearchQuery = quickInput.value;
      quickDropdown.classList.toggle('open', Boolean(quickSearchQuery.trim()));
      quickDropdown.innerHTML = renderQuickSearchDropdown(
        teamsDirectory,
        quickSearchQuery,
        selectedTeamId,
        theme
      );
      bindQuickItems();
    });
  }
}

export function renderTeamsView(container, callbacks) {
  const state = getState();
  const activeEl = document.activeElement;
  const focusSnap =
    activeEl && (activeEl.id === 'teams-dir-search' || activeEl.id === 'team-quick-search')
      ? {
          id: activeEl.id,
          start: activeEl.selectionStart,
          end: activeEl.selectionEnd
        }
      : null;

  if (state.selectedTeamId) {
    renderTeamPage(container, state, callbacks, focusSnap);
  } else {
    lastRenderedTeamId = null;
    renderTeamsDirectory(container, state, callbacks, focusSnap);
  }
}
