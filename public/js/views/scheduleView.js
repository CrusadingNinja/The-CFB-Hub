import { getState, setState } from '../store.js';
import { findStreamForEspnEvent } from '../api.js';
import {
  escapeHtml,
  renderTeamLogo,
  renderRankBadge,
  formatKickoffTime,
  formatDayHeading,
  getLocalDateKey
} from '../ui.js';

// ESPN FBS Conference IDs: 1 = ACC, 4 = Big 12, 5 = Big Ten, 8 = SEC
export const POWER_4_CONFERENCE_IDS = new Set(['1', '4', '5', '8']);

export function renderGameCard(ev, theme) {
  const isLive = ev.state === 'in';
  const isPre = ev.state === 'pre';
  const isPost = ev.state === 'post';

  const statusPillClass = isLive ? 'live' : isPre ? 'pre' : 'post';
  const statusLabel = isPre ? formatKickoffTime(ev.date) : ev.statusDetail || (isLive ? 'LIVE' : 'Final');

  const awayPoss = isLive && ev.situation?.possession === ev.away.id;
  const homePoss = isLive && ev.situation?.possession === ev.home.id;

  const awayRowClass = isPost
    ? ev.away.winner
      ? ' winner'
      : ' loser'
    : '';
  const homeRowClass = isPost
    ? ev.home.winner
      ? ' winner'
      : ' loser'
    : '';

  const venueParts = [ev.venue.name, ev.venue.city].filter(Boolean);
  const sit = isLive ? ev.situation : null;
  const matchedStream = isLive ? findStreamForEspnEvent(ev, getState()) : null;

  return `
    <button class="md-card md-card-interactive game-card${isLive ? ' is-live' : ''}" type="button" data-open-game="${escapeHtml(ev.id)}">
      <div class="game-card-top">
        <span class="status-pill ${statusPillClass}">
          ${isLive ? '<span class="pulse-dot live"></span>' : ''}
          ${escapeHtml(statusLabel)}
        </span>
        <div style="display:flex;align-items:center;gap:6px;min-width:0;">
          ${ev.headline ? `<span class="broadcast-tag" title="${escapeHtml(ev.headline)}">${escapeHtml(ev.headline)}</span>` : ''}
          ${ev.broadcast ? `<span class="broadcast-tag">${escapeHtml(ev.broadcast)}</span>` : ''}
        </div>
      </div>

      <div class="game-teams-list">
        <div class="game-team-row${awayRowClass}">
          <div class="game-team-info">
            ${renderTeamLogo(ev.away, { theme })}
            <div class="game-team-name-block">
              <div class="game-team-name-line">
                ${renderRankBadge(ev.away.rank)}
                <span class="game-team-name team-page-link" data-team-id="${escapeHtml(ev.away.id)}" role="link" tabindex="0" title="View ${escapeHtml(ev.away.displayName)} team page">${escapeHtml(ev.away.shortName)}</span>
                ${awayPoss ? '<span class="possession-dot" title="Possession"></span>' : ''}
              </div>
              <span class="game-team-record">${escapeHtml(ev.away.overallRecord || '0-0')}${ev.away.confRecord ? ` · ${escapeHtml(ev.away.confRecord)} Conf` : ''}</span>
            </div>
          </div>
          <span class="game-team-score">${isPre ? '' : escapeHtml(ev.away.score || '0')}</span>
        </div>

        <div class="game-team-row${homeRowClass}">
          <div class="game-team-info">
            ${renderTeamLogo(ev.home, { theme })}
            <div class="game-team-name-block">
              <div class="game-team-name-line">
                ${renderRankBadge(ev.home.rank)}
                <span class="game-team-name team-page-link" data-team-id="${escapeHtml(ev.home.id)}" role="link" tabindex="0" title="View ${escapeHtml(ev.home.displayName)} team page">${escapeHtml(ev.home.shortName)}</span>
                ${homePoss ? '<span class="possession-dot" title="Possession"></span>' : ''}
              </div>
              <span class="game-team-record">${escapeHtml(ev.home.overallRecord || '0-0')}${ev.home.confRecord ? ` · ${escapeHtml(ev.home.confRecord)} Conf` : ''}</span>
            </div>
          </div>
          <span class="game-team-score">${isPre ? '' : escapeHtml(ev.home.score || '0')}</span>
        </div>
      </div>

      ${
        sit && (sit.downDistanceText || sit.possessionText)
          ? `
        <div class="game-card-situation${sit.isRedZone ? ' redzone' : ''}">
          <span>${escapeHtml(sit.downDistanceText || sit.shortDownDistanceText || sit.possessionText)}</span>
          ${sit.isRedZone ? '<span>RED ZONE</span>' : ''}
        </div>
      `
          : ''
      }

      <div class="game-card-footer">
        <span class="game-card-venue">${escapeHtml(venueParts.join(' · ') || 'College Football')}</span>
        <div class="game-card-footer-actions">
          ${
            isLive
              ? `
            <span
              class="watch-stream-link"
              data-watch-event="${escapeHtml(ev.id)}"
              ${matchedStream ? `data-watch-stream-id="${escapeHtml(matchedStream.id)}" data-watch-stream-source="${escapeHtml(matchedStream.source)}"` : ''}
              role="link"
              tabindex="0"
              title="${matchedStream ? `Watch ${escapeHtml(matchedStream.name)} on ${escapeHtml(matchedStream.sourceLabel)}` : `Watch ${escapeHtml(ev.shortName || ev.name)} live stream`}"
            >
              <span class="material-symbols-rounded" style="font-size:14px;">live_tv</span>
              <span>Watch Stream</span>
            </span>
          `
              : ''
          }
          <span style="font-weight:600;color:var(--md-sys-color-primary);white-space:nowrap;">${isLive || isPost ? 'Play-by-Play →' : 'Preview →'}</span>
        </div>
      </div>
    </button>
  `;
}

function getFilteredEvents(state) {
  const { scoreboardEvents, scheduleFilter, searchQuery, conferenceMap } = state;
  const q = searchQuery.trim().toLowerCase();

  return scoreboardEvents.filter((ev) => {
    if (scheduleFilter.status !== 'all' && ev.state !== scheduleFilter.status) {
      return false;
    }
    if (scheduleFilter.top25Only && !ev.away.rank && !ev.home.rank) {
      return false;
    }
    if (scheduleFilter.conferenceId === 'power4') {
      const awayIsP4 = POWER_4_CONFERENCE_IDS.has(String(ev.away.conferenceId || ''));
      const homeIsP4 = POWER_4_CONFERENCE_IDS.has(String(ev.home.conferenceId || ''));
      if (!awayIsP4 && !homeIsP4) {
        return false;
      }
    } else if (scheduleFilter.conferenceId !== 'all') {
      const cid = scheduleFilter.conferenceId;
      if (ev.away.conferenceId !== cid && ev.home.conferenceId !== cid) {
        return false;
      }
    }
    if (q) {
      const awayConf = conferenceMap[ev.away.conferenceId]?.shortName || '';
      const homeConf = conferenceMap[ev.home.conferenceId]?.shortName || '';
      const haystack = [
        ev.name,
        ev.shortName,
        ev.away.displayName,
        ev.away.abbreviation,
        ev.home.displayName,
        ev.home.abbreviation,
        ev.headline,
        ev.broadcast,
        awayConf,
        homeConf
      ]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(q)) {
        return false;
      }
    }
    return true;
  });
}

export function renderScheduleView(container, callbacks) {
  const state = getState();
  const {
    theme,
    group,
    seasonType,
    selectedWeek,
    currentSeasonType,
    currentWeekNumber,
    calendar,
    scoreboardEvents,
    scoreboardLoading,
    scoreboardError,
    scheduleFilter,
    conferences
  } = state;

  const weeks = seasonType === '3' ? calendar.postseason : calendar.regular;
  const activeWeekIdx = weeks.findIndex((w) => String(w.value) === String(selectedWeek));
  const isAtCurrentWeek =
    String(seasonType) === String(currentSeasonType) &&
    String(selectedWeek) === String(currentWeekNumber);

  const filtered = getFilteredEvents(state);
  const liveGames = filtered.filter((e) => e.state === 'in');
  const nonLiveGames = filtered.filter((e) => e.state !== 'in');

  // Group non-live games by local day
  const byDay = new Map();
  nonLiveGames.forEach((ev) => {
    const key = getLocalDateKey(ev.date);
    if (!byDay.has(key)) {
      byDay.set(key, {
        heading: formatDayHeading(ev.date),
        games: []
      });
    }
    byDay.get(key).games.push(ev);
  });

  const liveCountAll = scoreboardEvents.filter((e) => e.state === 'in').length;
  const preCountAll = scoreboardEvents.filter((e) => e.state === 'pre').length;
  const postCountAll = scoreboardEvents.filter((e) => e.state === 'post').length;

  const stripKey = `${group}:${seasonType}:${selectedWeek}`;
  const prevWeekStrip = container.querySelector('#week-scroll-strip');
  const prevStripKey = prevWeekStrip?.dataset.stripKey || '';
  const prevStripScrollLeft = prevWeekStrip ? prevWeekStrip.scrollLeft : null;

  container.innerHTML = `
    <section class="md-card md-card-filled schedule-controls-card">
      <div class="controls-top-row">
        <div class="controls-segmented-group">
          <div class="md-segmented" role="group" aria-label="Division">
            <button class="md-seg-btn${group === '80' ? ' selected' : ''}" type="button" data-group="80">
              <span class="material-symbols-rounded seg-check">check</span>
              FBS
            </button>
            <button class="md-seg-btn${group === '81' ? ' selected' : ''}" type="button" data-group="81">
              <span class="material-symbols-rounded seg-check">check</span>
              FCS
            </button>
          </div>

          <div class="md-segmented" role="group" aria-label="Season Phase">
            <button class="md-seg-btn${seasonType === '2' ? ' selected' : ''}" type="button" data-season-type="2">
              <span class="material-symbols-rounded seg-check">check</span>
              Regular Season
            </button>
            <button class="md-seg-btn${seasonType === '3' ? ' selected' : ''}" type="button" data-season-type="3">
              <span class="material-symbols-rounded seg-check">check</span>
              Postseason
            </button>
          </div>
        </div>

        ${
          !isAtCurrentWeek && currentWeekNumber
            ? `
          <button class="md-btn md-btn-tonal" type="button" id="jump-current-week-btn" style="height:34px;padding:0 14px;">
            <span class="material-symbols-rounded" style="font-size:17px;">today</span>
            Jump to Current Week
          </button>
        `
            : ''
        }
      </div>

      ${
        weeks.length > 0
          ? `
        <div class="week-strip-row">
          <button class="md-icon-btn" type="button" id="prev-week-btn" ${activeWeekIdx <= 0 ? 'disabled style="opacity:0.4;cursor:default;"' : ''} aria-label="Previous week">
            <span class="material-symbols-rounded">chevron_left</span>
          </button>
          <div class="week-scroll-strip" id="week-scroll-strip" data-strip-key="${escapeHtml(stripKey)}">
            ${weeks
              .map(
                (w) => `
              <button class="week-pill${String(w.value) === String(selectedWeek) ? ' active' : ''}" type="button" data-week-val="${escapeHtml(w.value)}">
                <span class="week-pill-label">${escapeHtml(w.label)}</span>
                <span class="week-pill-detail">${escapeHtml(w.detail)}</span>
              </button>
            `
              )
              .join('')}
          </div>
          <button class="md-icon-btn" type="button" id="next-week-btn" ${activeWeekIdx === -1 || activeWeekIdx >= weeks.length - 1 ? 'disabled style="opacity:0.4;cursor:default;"' : ''} aria-label="Next week">
            <span class="material-symbols-rounded">chevron_right</span>
          </button>
        </div>
      `
          : ''
      }

      <div class="controls-filter-row">
        <div class="md-chip-row">
          <button class="md-chip${scheduleFilter.status === 'all' ? ' selected' : ''}" type="button" data-status-filter="all">
            All (${scoreboardEvents.length})
          </button>
          <button class="md-chip${scheduleFilter.status === 'in' ? ' selected' : ''}" type="button" data-status-filter="in">
            ${liveCountAll > 0 ? '<span class="pulse-dot live"></span>' : ''}
            Live (${liveCountAll})
          </button>
          <button class="md-chip${scheduleFilter.status === 'pre' ? ' selected' : ''}" type="button" data-status-filter="pre">
            Upcoming (${preCountAll})
          </button>
          <button class="md-chip${scheduleFilter.status === 'post' ? ' selected' : ''}" type="button" data-status-filter="post">
            Final (${postCountAll})
          </button>
          <button class="md-chip${scheduleFilter.top25Only ? ' selected' : ''}" type="button" id="top25-filter-btn">
            <span class="material-symbols-rounded">${scheduleFilter.top25Only ? 'check' : 'star'}</span>
            Top 25 Only
          </button>
          <button class="md-chip${scheduleFilter.conferenceId === 'power4' ? ' selected' : ''}" type="button" id="power4-filter-btn">
            <span class="material-symbols-rounded">${scheduleFilter.conferenceId === 'power4' ? 'check' : 'shield'}</span>
            Power 4 Conferences
          </button>
        </div>

        <div style="display:flex;align-items:center;gap:10px;">
          <select class="md-select" id="conf-filter-select" aria-label="Filter by conference">
            <option value="all">All Conferences</option>
            <option value="power4"${scheduleFilter.conferenceId === 'power4' ? ' selected' : ''}>Power 4 Conferences</option>
            ${conferences
              .map(
                (c) =>
                  `<option value="${escapeHtml(c.id)}"${scheduleFilter.conferenceId === c.id ? ' selected' : ''}>${escapeHtml(c.shortName)}</option>`
              )
              .join('')}
          </select>
          <span class="muted tabular" style="font-size:12px;font-weight:600;">${filtered.length} shown</span>
        </div>
      </div>
    </section>

    ${
      scoreboardLoading && scoreboardEvents.length === 0
        ? `
      <div class="games-grid">
        ${Array.from({ length: 6 })
          .map(() => `<div class="skeleton" style="height:178px;border-radius:16px;"></div>`)
          .join('')}
      </div>
    `
        : scoreboardError
          ? `
      <div class="md-card empty-state-card">
        <span class="material-symbols-rounded">cloud_off</span>
        <p class="empty-state-title">Unable to load schedule</p>
        <p class="empty-state-desc">${escapeHtml(scoreboardError)}</p>
        <button class="md-btn md-btn-filled" type="button" id="retry-schedule-btn">Retry</button>
      </div>
    `
          : filtered.length === 0
            ? `
      <div class="md-card empty-state-card">
        <span class="material-symbols-rounded">event_busy</span>
        <p class="empty-state-title">No matching games found</p>
        <p class="empty-state-desc">Try clearing the search box or switching status, Top 25, or conference filters.</p>
        <button class="md-btn md-btn-tonal" type="button" id="reset-filters-btn">Reset Filters</button>
      </div>
    `
            : `
      ${
        liveGames.length > 0
          ? `
        <section class="schedule-section">
          <div class="section-header-row">
            <h2 class="section-heading">
              <span class="pulse-dot live"></span>
              Live In Progress (${liveGames.length})
            </h2>
          </div>
          <div class="games-grid">
            ${liveGames.map((ev) => renderGameCard(ev, theme)).join('')}
          </div>
        </section>
      `
          : ''
      }

      ${Array.from(byDay.values())
        .map(
          (groupDay) => `
        <section class="schedule-section">
          <div class="section-header-row">
            <h2 class="section-heading">${escapeHtml(groupDay.heading)}</h2>
            <span class="muted tabular" style="font-size:12px;font-weight:600;">${groupDay.games.length} game${groupDay.games.length === 1 ? '' : 's'}</span>
          </div>
          <div class="games-grid">
            ${groupDay.games.map((ev) => renderGameCard(ev, theme)).join('')}
          </div>
        </section>
      `
        )
        .join('')}
    `
    }
  `;

  // Preserve or center active week pill horizontally without scrolling the vertical page
  const weekStripEl = container.querySelector('#week-scroll-strip');
  const activePill = weekStripEl?.querySelector('.week-pill.active');
  if (weekStripEl) {
    if (prevStripKey === stripKey && prevStripScrollLeft !== null) {
      weekStripEl.scrollLeft = prevStripScrollLeft;
    } else if (activePill) {
      const targetLeft =
        activePill.offsetLeft - weekStripEl.clientWidth / 2 + activePill.clientWidth / 2;
      weekStripEl.scrollLeft = Math.max(0, targetLeft);
    }
  }

  // Event listeners
  container.querySelectorAll('[data-group]').forEach((btn) => {
    btn.addEventListener('click', () => {
      callbacks.onChangeScheduleParams({ group: btn.dataset.group });
    });
  });

  container.querySelectorAll('[data-season-type]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const nextSeasonType = btn.dataset.seasonType;
      const targetWeeks = nextSeasonType === '3' ? calendar.postseason : calendar.regular;
      const nextWeek =
        nextSeasonType === String(currentSeasonType) && currentWeekNumber
          ? currentWeekNumber
          : targetWeeks[0]?.value || '1';
      callbacks.onChangeScheduleParams({ seasonType: nextSeasonType, week: nextWeek });
    });
  });

  container.querySelectorAll('[data-week-val]').forEach((btn) => {
    btn.addEventListener('click', () => {
      callbacks.onChangeScheduleParams({ week: btn.dataset.weekVal });
    });
  });

  const prevBtn = container.querySelector('#prev-week-btn');
  if (prevBtn && activeWeekIdx > 0) {
    prevBtn.addEventListener('click', () => {
      callbacks.onChangeScheduleParams({ week: weeks[activeWeekIdx - 1].value });
    });
  }

  const nextBtn = container.querySelector('#next-week-btn');
  if (nextBtn && activeWeekIdx !== -1 && activeWeekIdx < weeks.length - 1) {
    nextBtn.addEventListener('click', () => {
      callbacks.onChangeScheduleParams({ week: weeks[activeWeekIdx + 1].value });
    });
  }

  const jumpBtn = container.querySelector('#jump-current-week-btn');
  if (jumpBtn) {
    jumpBtn.addEventListener('click', () => {
      callbacks.onChangeScheduleParams({
        seasonType: String(currentSeasonType || '2'),
        week: String(currentWeekNumber || '1')
      });
    });
  }

  container.querySelectorAll('[data-status-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      setState((prev) => ({
        scheduleFilter: { ...prev.scheduleFilter, status: btn.dataset.statusFilter }
      }));
    });
  });

  const top25Btn = container.querySelector('#top25-filter-btn');
  if (top25Btn) {
    top25Btn.addEventListener('click', () => {
      setState((prev) => ({
        scheduleFilter: { ...prev.scheduleFilter, top25Only: !prev.scheduleFilter.top25Only }
      }));
    });
  }

  const power4Btn = container.querySelector('#power4-filter-btn');
  if (power4Btn) {
    power4Btn.addEventListener('click', () => {
      setState((prev) => ({
        scheduleFilter: {
          ...prev.scheduleFilter,
          conferenceId: prev.scheduleFilter.conferenceId === 'power4' ? 'all' : 'power4'
        }
      }));
    });
  }

  const confSelect = container.querySelector('#conf-filter-select');
  if (confSelect) {
    confSelect.addEventListener('change', () => {
      setState((prev) => ({
        scheduleFilter: { ...prev.scheduleFilter, conferenceId: confSelect.value }
      }));
    });
  }

  const resetBtn = container.querySelector('#reset-filters-btn');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      setState({
        searchQuery: '',
        scheduleFilter: { status: 'all', top25Only: false, conferenceId: 'all' }
      });
      const searchInput = document.getElementById('global-search');
      if (searchInput) searchInput.value = '';
    });
  }

  const retryBtn = container.querySelector('#retry-schedule-btn');
  if (retryBtn) {
    retryBtn.addEventListener('click', () => callbacks.onRetrySchedule());
  }

  container.querySelectorAll('[data-open-game]').forEach((card) => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('[data-team-id], [data-watch-event]')) return;
      callbacks.onOpenGameSheet(card.dataset.openGame);
    });
  });
}
