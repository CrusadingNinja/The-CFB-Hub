import { getState, setState } from '../store.js';
import { findStreamForEspnEvent } from '../api.js';
import { mountGameDetail } from './gameDetail.js';
import {
  escapeHtml,
  renderTeamLogo,
  renderRankBadge,
  formatKickoffTime,
  formatEventKickoff,
  isKickoffTimeTbd,
  formatCountdown
} from '../ui.js';

function renderSelectorItem(ev, isSelected, theme) {
  const isLive = ev.state === 'in';
  const isPre = ev.state === 'pre';
  const awayPoss = isLive && ev.situation?.possession === ev.away.id;
  const homePoss = isLive && ev.situation?.possession === ev.home.id;
  const matchedStream = isLive ? findStreamForEspnEvent(ev, getState()) : null;

  const statusText = isPre
    ? isKickoffTimeTbd(ev)
      ? formatEventKickoff(ev)
      : `${formatKickoffTime(ev.date)} · ${formatCountdown(ev.date)}`
    : ev.statusDetail || (isLive ? 'LIVE' : 'Final');

  return `
    <button class="live-selector-item${isSelected ? ' selected' : ''}" type="button" data-live-select="${escapeHtml(ev.id)}">
      <div class="game-card-top">
        <span class="status-pill ${isLive ? 'live' : isPre ? 'pre' : 'post'}">
          ${isLive ? '<span class="pulse-dot live"></span>' : ''}
          ${escapeHtml(statusText)}
        </span>
        <div class="live-card-top-right">
          ${
            isLive
              ? `
            <span
              class="watch-stream-link compact"
              data-watch-event="${escapeHtml(ev.id)}"
              ${matchedStream ? `data-watch-stream-id="${escapeHtml(matchedStream.id)}" data-watch-stream-source="${escapeHtml(matchedStream.source)}"` : ''}
              role="link"
              tabindex="0"
              title="${matchedStream ? `Watch ${escapeHtml(matchedStream.name)} on ${escapeHtml(matchedStream.sourceLabel)}` : `Watch ${escapeHtml(ev.shortName || ev.name)} live stream`}"
            >
              <span class="material-symbols-rounded" style="font-size:13px;">live_tv</span>
              <span>Watch Stream</span>
            </span>
          `
              : ''
          }
          ${ev.broadcast ? `<span class="broadcast-tag">${escapeHtml(ev.broadcast)}</span>` : ''}
        </div>
      </div>

      <div class="game-teams-list" style="gap:6px;">
        <div class="game-team-row">
          <div class="game-team-info">
            ${renderTeamLogo(ev.away, { size: 'sm', theme })}
            <div class="game-team-name-line">
              ${renderRankBadge(ev.away.rank)}
              <span class="game-team-name team-page-link" data-team-id="${escapeHtml(ev.away.id)}" role="link" tabindex="0" title="View ${escapeHtml(ev.away.displayName)} team page">${escapeHtml(ev.away.shortName)}</span>
              ${awayPoss ? '<span class="possession-dot"></span>' : ''}
            </div>
          </div>
          <span class="game-team-score" style="font-size:17px;">${isPre ? '' : escapeHtml(ev.away.score || '0')}</span>
        </div>

        <div class="game-team-row">
          <div class="game-team-info">
            ${renderTeamLogo(ev.home, { size: 'sm', theme })}
            <div class="game-team-name-line">
              ${renderRankBadge(ev.home.rank)}
              <span class="game-team-name team-page-link" data-team-id="${escapeHtml(ev.home.id)}" role="link" tabindex="0" title="View ${escapeHtml(ev.home.displayName)} team page">${escapeHtml(ev.home.shortName)}</span>
              ${homePoss ? '<span class="possession-dot"></span>' : ''}
            </div>
          </div>
          <span class="game-team-score" style="font-size:17px;">${isPre ? '' : escapeHtml(ev.home.score || '0')}</span>
        </div>
      </div>

      ${
        isLive && ev.situation?.downDistanceText
          ? `
        <div class="game-card-situation${ev.situation.isRedZone ? ' redzone' : ''}" style="padding:4px 8px;font-size:11px;">
          <span>${escapeHtml(ev.situation.downDistanceText)}</span>
          ${ev.situation.isRedZone ? '<span>RED ZONE</span>' : ''}
        </div>
      `
          : ''
      }
    </button>
  `;
}

function matchesSearch(ev, query) {
  if (!query) return true;
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [
    ev.name,
    ev.away.displayName,
    ev.away.abbreviation,
    ev.home.displayName,
    ev.home.abbreviation
  ]
    .join(' ')
    .toLowerCase();
  return hay.includes(q);
}

export function renderLiveView(container, callbacks) {
  const state = getState();
  const { theme, liveEvents, liveLoading, liveSelectedEventId, liveDivision, searchQuery } = state;

  const filtered = liveEvents.filter((ev) => matchesSearch(ev, searchQuery));
  const liveGames = filtered.filter((ev) => ev.state === 'in');
  const upcomingGames = filtered.filter((ev) => ev.state === 'pre').slice(0, 8);
  const completedGames = filtered.filter((ev) => ev.state === 'post').slice(0, 12);

  // Pick a valid selected game ID: preserve selection if present, else first live, else first completed, else first upcoming
  let selectedId = liveSelectedEventId;
  if (!selectedId || !filtered.some((e) => e.id === selectedId)) {
    selectedId = liveGames[0]?.id || completedGames[0]?.id || upcomingGames[0]?.id || null;
  }

  const selectedEvent = filtered.find((e) => e.id === selectedId) || null;

  let masterPane = container.querySelector('.live-master-pane');
  let detailPane = container.querySelector('#live-detail-pane');
  const existingMasterScroll = masterPane ? masterPane.scrollTop : 0;

  if (!masterPane || !detailPane) {
    container.innerHTML = `
      <div class="live-layout">
        <aside class="live-master-pane"></aside>
        <section class="live-detail-pane" id="live-detail-pane"></section>
      </div>
    `;
    masterPane = container.querySelector('.live-master-pane');
    detailPane = container.querySelector('#live-detail-pane');
  }

  masterPane.innerHTML = `
    <div class="md-card md-card-filled live-status-banner">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
        <strong style="font-size:15px;">Live Game Center</strong>
        <div class="md-segmented" style="height:32px;" role="group" aria-label="Live division">
          <button class="md-seg-btn${liveDivision === '80' ? ' selected' : ''}" type="button" data-live-div="80" style="padding:0 10px;font-size:12px;">FBS</button>
          <button class="md-seg-btn${liveDivision === '81' ? ' selected' : ''}" type="button" data-live-div="81" style="padding:0 10px;font-size:12px;">FCS</button>
        </div>
      </div>
      ${
        liveGames.length > 0
          ? `<div class="muted" style="font-size:12px;"><span class="pulse-dot live" style="margin-right:6px;"></span>${liveGames.length} game${liveGames.length === 1 ? '' : 's'} currently in progress — auto-updating every 15s.</div>`
          : `<div class="muted" style="font-size:12px;">No games on the field right now — auto-checking every 15s. Inspect recent finals with full play-by-play or upcoming kickoffs below.</div>`
      }
    </div>

    ${
      liveLoading && liveEvents.length === 0
        ? `
      <div class="skeleton" style="height:110px;"></div>
      <div class="skeleton" style="height:110px;"></div>
      <div class="skeleton" style="height:110px;"></div>
    `
        : `
      ${
        liveGames.length > 0
          ? `
        <div class="live-list-group-label">Live Now (${liveGames.length})</div>
        ${liveGames.map((ev) => renderSelectorItem(ev, ev.id === selectedId, theme)).join('')}
      `
          : ''
      }

      ${
        completedGames.length > 0
          ? `
        <div class="live-list-group-label">Recent Finals · Play-by-Play (${completedGames.length})</div>
        ${completedGames.map((ev) => renderSelectorItem(ev, ev.id === selectedId, theme)).join('')}
      `
          : ''
      }

      ${
        upcomingGames.length > 0
          ? `
        <div class="live-list-group-label">Up Next Kickoffs (${upcomingGames.length})</div>
        ${upcomingGames.map((ev) => renderSelectorItem(ev, ev.id === selectedId, theme)).join('')}
      `
          : ''
      }

      ${
        filtered.length === 0
          ? `
        <div class="md-card empty-state-card" style="padding:24px;">
          <span class="material-symbols-rounded">search_off</span>
          <p class="empty-state-desc">No games match your search in this week's live slate.</p>
        </div>
      `
          : ''
      }
    `
    }
  `;
  masterPane.scrollTop = existingMasterScroll;

  masterPane.querySelectorAll('[data-live-div]').forEach((btn) => {
    btn.addEventListener('click', () => {
      callbacks.onChangeLiveDivision(btn.dataset.liveDiv);
    });
  });

  masterPane.querySelectorAll('[data-live-select]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      if (e.target.closest('[data-team-id], [data-watch-event]')) return;
      setState({ liveSelectedEventId: btn.dataset.liveSelect });
    });
  });

  if (selectedEvent) {
    const sameLoaded = detailPane.dataset.loadedEventId === selectedEvent.id;
    detailPane.dataset.targetEventId = selectedEvent.id;
    mountGameDetail(detailPane, selectedEvent.id, {
      eventPreview: selectedEvent,
      force: false,
      showSkeleton: !sameLoaded
    });
  } else {
    detailPane.dataset.targetEventId = '';
    detailPane.dataset.loadedEventId = '';
    detailPane.innerHTML = `
      <div class="empty-state-card">
        <span class="material-symbols-rounded">sensors</span>
        <p class="empty-state-title">Select a Game</p>
        <p class="empty-state-desc">Choose any live, completed, or upcoming game from the list to inspect live scores, field position, and play-by-play drives.</p>
      </div>
    `;
  }
}

export function refreshLiveDetailPaneOnly(container, force = true) {
  const detailPane = container.querySelector('#live-detail-pane');
  if (!detailPane) return;
  const state = getState();
  const selectedId =
    state.liveSelectedEventId ||
    state.liveEvents.find((e) => e.state === 'in')?.id ||
    state.liveEvents[0]?.id;
  const ev = state.liveEvents.find((e) => e.id === selectedId);
  if (detailPane && ev) {
    detailPane.dataset.targetEventId = ev.id;
    mountGameDetail(detailPane, ev.id, {
      eventPreview: ev,
      force,
      showSkeleton: false
    });
  }
}
