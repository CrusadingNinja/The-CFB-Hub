import { getState, setState } from '../store.js';
import {
  STREAM_SOURCES,
  matchStreamToEspnEvent,
  findMatchingStreamInSource
} from '../api.js';
import { escapeHtml, formatKickoffTime, showSnackbar } from '../ui.js';

let fsListenerBound = false;

function getSourceMeta(sourceId) {
  return STREAM_SOURCES.find((s) => s.id === sourceId) || STREAM_SOURCES[0];
}

function normalizeWatchSource(sourceId) {
  if (sourceId === 'thetvapp') return 'thetvapp';
  if (sourceId === 'strmfree') return 'strmfree';
  return 'ppv';
}

function getStreamsForSource(state, sourceId = null) {
  const target = normalizeWatchSource(sourceId || state.watchSource);
  if (target === 'thetvapp') return state.tvAppStreams || [];
  if (target === 'strmfree') return state.strmFreeStreams || [];
  return state.ppvStreams || [];
}

function getAllWatchStreams(state) {
  return [
    ...(state.ppvStreams || []),
    ...(state.tvAppStreams || []),
    ...(state.strmFreeStreams || [])
  ];
}

function findStreamById(state, streamId, preferredSource = null) {
  const idStr = String(streamId || '');
  if (!idStr) return null;
  if (preferredSource) {
    const inPref = getStreamsForSource(state, preferredSource).find((s) => String(s.id) === idStr);
    if (inPref) return inPref;
  }
  return getAllWatchStreams(state).find((s) => String(s.id) === idStr) || null;
}

function getStreamCompositeKey(streamOrSlot) {
  if (!streamOrSlot) return '';
  return `${streamOrSlot.source || 'ppv'}:${String(streamOrSlot.streamId || streamOrSlot.id || '')}`;
}

function getCatalogLoadingState(state) {
  const source = normalizeWatchSource(state.watchSource);
  if (source === 'thetvapp') {
    return {
      source,
      loading: Boolean(state.tvAppLoading),
      error: state.tvAppError,
      streams: state.tvAppStreams || []
    };
  }
  if (source === 'strmfree') {
    return {
      source,
      loading: Boolean(state.strmFreeLoading),
      error: state.strmFreeError,
      streams: state.strmFreeStreams || []
    };
  }
  return {
    source,
    loading: Boolean(state.ppvLoading),
    error: state.ppvError,
    streams: state.ppvStreams || []
  };
}

function ensureFullscreenSync() {
  if (fsListenerBound) return;
  fsListenerBound = true;
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && getState().watchFullscreen) {
      document.body.classList.remove('watch-multistream-fs');
      setState({ watchFullscreen: false, watchFsSidebarOpen: false });
    }
  });
}

/**
 * Enters or exits full-screen multistream mode without unmounting live video iframes.
 */
export function toggleWatchFullscreen(forceValue) {
  ensureFullscreenSync();
  const cur = getState();
  const nextVal = typeof forceValue === 'boolean' ? forceValue : !cur.watchFullscreen;
  document.body.classList.toggle('watch-multistream-fs', nextVal);

  if (nextVal !== cur.watchFullscreen) {
    setState({
      watchFullscreen: nextVal,
      ...(nextVal ? {} : { watchFsSidebarOpen: false })
    });
  } else if (!nextVal && cur.watchFsSidebarOpen) {
    setState({ watchFsSidebarOpen: false });
  }

  if (nextVal) {
    const stageContainer = document.getElementById('watch-stage-container');
    if (stageContainer && document.fullscreenElement !== stageContainer && typeof stageContainer.requestFullscreen === 'function') {
      try {
        const res = stageContainer.requestFullscreen();
        if (res && typeof res.catch === 'function') res.catch(() => {});
      } catch (err) {
        // Native fullscreen may be blocked in embedded contexts; CSS fixed viewport overlay still applies.
      }
    }
  } else if (document.fullscreenElement && typeof document.exitFullscreen === 'function') {
    try {
      const res = document.exitFullscreen();
      if (res && typeof res.catch === 'function') res.catch(() => {});
    } catch (err) {
      // Ignore exitFullscreen failures.
    }
  }
}

function applyWatchCount(nextCount) {
  const cur = getState();
  const clampedCount = Math.max(1, Math.min(4, Number(nextCount) || 2));
  const patch = {
    watchCount: clampedCount,
    watchActiveSlot: Math.min(cur.watchActiveSlot, clampedCount - 1),
    watchPrimarySlot: Math.min(cur.watchPrimarySlot, clampedCount - 1)
  };

  // Convenience: when user expands to 2/3/4 screens, fill empty newly exposed slots with top live CFB streams
  const activeStreams = getStreamsForSource(cur);
  const liveOrCfb = [...activeStreams.filter((s) => s.isCfb && s.isLiveNow), ...activeStreams.filter((s) => s.isCfb && !s.isLiveNow)];
  if (liveOrCfb.length > 0) {
    const nextSlots = [...cur.watchSlots];
    const usedIds = new Set(nextSlots.slice(0, clampedCount).filter(Boolean).map((s) => getStreamCompositeKey(s)));
    for (let i = 0; i < clampedCount; i++) {
      if (!nextSlots[i]) {
        const pick = liveOrCfb.find((s) => !usedIds.has(getStreamCompositeKey(s)));
        if (pick) {
          nextSlots[i] = toSlotPayload(pick);
          usedIds.add(getStreamCompositeKey(pick));
        }
      }
    }
    patch.watchSlots = nextSlots;
  }

  setState(patch);
}

function reorderWatchSlots(fromIdx, toIdx) {
  const cur = getState();
  const maxIdx = Math.max(0, (cur.watchCount || 1) - 1);
  if (
    !Number.isInteger(fromIdx) ||
    !Number.isInteger(toIdx) ||
    fromIdx === toIdx ||
    fromIdx < 0 ||
    toIdx < 0 ||
    fromIdx > maxIdx ||
    toIdx > maxIdx
  ) {
    return;
  }

  const nextSlots = [...cur.watchSlots];
  const moved = nextSlots[fromIdx];
  nextSlots[fromIdx] = nextSlots[toIdx];
  nextSlots[toIdx] = moved;

  let nextActive = cur.watchActiveSlot;
  if (cur.watchActiveSlot === fromIdx) {
    nextActive = toIdx;
  } else if (cur.watchActiveSlot === toIdx) {
    nextActive = fromIdx;
  }

  setState({
    watchSlots: nextSlots,
    watchActiveSlot: nextActive
  });
}

function toSlotPayload(stream, feed = null) {
  if (!stream || !Array.isArray(stream.feeds) || stream.feeds.length === 0) return null;
  const chosen = feed || stream.feeds[0];
  const srcId = stream.source || 'ppv';
  const extUrl = stream.externalUrl || stream.ppvUrl || getSourceMeta(srcId).url;
  return {
    streamId: stream.id,
    source: srcId,
    sourceLabel: stream.sourceLabel || getSourceMeta(srcId).label,
    feedId: chosen.id,
    iframe: chosen.iframe,
    name: stream.name,
    sourceTag: chosen.label || stream.sourceTag,
    uriName: chosen.uriName || stream.uriName,
    ppvUrl: extUrl,
    externalUrl: extUrl
  };
}

function selectStreamIntoTargetSlot(streamId, sourceHint = null) {
  const cur = getState();
  const stream = findStreamById(cur, streamId, sourceHint || cur.watchSource);
  if (!stream) return;
  const targetIdx = Math.max(0, Math.min(cur.watchCount - 1, cur.watchActiveSlot));
  const nextSlots = [...cur.watchSlots];
  nextSlots[targetIdx] = toSlotPayload(stream);
  setState({ watchSlots: nextSlots, watchPlayerActive: true, watchPipMinimized: false });
}

function addStreamToMultiview(streamId, sourceHint = null) {
  const cur = getState();
  const stream = findStreamById(cur, streamId, sourceHint || cur.watchSource);
  if (!stream) return;

  const nextSlots = [...cur.watchSlots];
  let nextCount = cur.watchCount;

  // Look for first empty slot in current layout; otherwise expand up to 4
  let targetIdx = nextSlots.slice(0, nextCount).findIndex((s) => !s);
  if (targetIdx === -1 && nextCount < 4) {
    targetIdx = nextCount;
    nextCount += 1;
  }
  if (targetIdx === -1) {
    targetIdx = Math.max(0, Math.min(nextCount - 1, cur.watchActiveSlot));
  }

  nextSlots[targetIdx] = toSlotPayload(stream);
  setState({
    watchCount: nextCount,
    watchSlots: nextSlots,
    watchActiveSlot: targetIdx,
    watchPlayerActive: true,
    watchPipMinimized: false
  });
}

export function openStreamInWatch(stream) {
  if (!stream) return null;
  const cur = getState();
  const payload = toSlotPayload(stream);
  if (!payload) return null;

  const streamKey = getStreamCompositeKey(payload);
  const maxVisible = Math.max(1, cur.watchCount || 2);
  const existingIdx = (cur.watchSlots || [])
    .slice(0, maxVisible)
    .findIndex((s) => s && getStreamCompositeKey(s) === streamKey);

  const nextSource = normalizeWatchSource(stream.source);
  if (existingIdx !== -1) {
    setState({
      route: 'watch',
      watchSource: nextSource,
      watchActiveSlot: existingIdx,
      watchPlayerActive: true,
      watchPipMinimized: false
    });
    return { slotIndex: existingIdx };
  }

  const nextSlots = [...(cur.watchSlots || [null, null, null, null])];
  nextSlots[0] = payload;
  setState({
    route: 'watch',
    watchSource: nextSource,
    watchSlots: nextSlots,
    watchActiveSlot: 0,
    watchPlayerActive: true,
    watchPipMinimized: false
  });
  return { slotIndex: 0 };
}

function applyWatchSource(nextSource, callbacks) {
  const validSource = normalizeWatchSource(nextSource);
  try {
    localStorage.setItem('cfb_watch_source', validSource);
  } catch (err) {
    // Ignore storage errors
  }

  const cur = getState();
  const targetStreams = getStreamsForSource(cur, validSource);
  const allEvents = getAllEspnEvents(cur);

  if (targetStreams.length === 0) {
    callbacks?.onRetryWatchStreams?.(validSource);
  }

  const nextSlots = [...cur.watchSlots];
  let matchedCount = 0;

  for (let i = 0; i < cur.watchCount; i++) {
    const slot = nextSlots[i];
    if (!slot) continue;
    if (normalizeWatchSource(slot.source) === validSource) {
      matchedCount += 1;
      continue;
    }
    const refStream = findStreamById(cur, slot.streamId, slot.source) || slot;
    const matched = findMatchingStreamInSource(refStream, targetStreams, allEvents);
    if (matched) {
      nextSlots[i] = toSlotPayload(matched);
      matchedCount += 1;
    }
  }

  if (matchedCount === 0 && targetStreams.length > 0) {
    const pool = [
      ...targetStreams.filter((s) => s.isCfb && s.isLiveNow),
      ...targetStreams.filter((s) => s.isCfb && !s.isLiveNow),
      ...targetStreams.filter((s) => !s.isCfb && s.isLiveNow),
      ...targetStreams
    ];
    for (let i = 0; i < cur.watchCount; i++) {
      nextSlots[i] = pool[i] ? toSlotPayload(pool[i]) : nextSlots[i];
    }
  }

  setState({
    watchSource: validSource,
    watchSlots: nextSlots
  });
}

function switchSlotSource(slotIdx, targetSource, callbacks) {
  const validSource = normalizeWatchSource(targetSource);
  const cur = getState();
  const slot = cur.watchSlots?.[slotIdx];
  if (!slot || normalizeWatchSource(slot.source) === validSource) return;

  const targetStreams = getStreamsForSource(cur, validSource);
  const allEvents = getAllEspnEvents(cur);
  const refStream = findStreamById(cur, slot.streamId, slot.source) || slot;
  const matched = findMatchingStreamInSource(refStream, targetStreams, allEvents);
  const srcMeta = getSourceMeta(validSource);

  if (matched) {
    const nextSlots = [...cur.watchSlots];
    nextSlots[slotIdx] = toSlotPayload(matched);
    setState({ watchSlots: nextSlots });
    showSnackbar(`Switched #${slotIdx + 1} to ${srcMeta.label}: ${matched.name}`);
    return;
  }

  if (targetStreams.length > 0) {
    const usedKeys = new Set(
      cur.watchSlots
        .slice(0, cur.watchCount)
        .filter((s, idx) => Boolean(s) && idx !== slotIdx)
        .map((s) => getStreamCompositeKey(s))
    );
    const pool = [
      ...targetStreams.filter((s) => s.isCfb && s.isLiveNow),
      ...targetStreams.filter((s) => s.isCfb && !s.isLiveNow),
      ...targetStreams
    ];
    const fallbackPick = pool.find((s) => !usedKeys.has(getStreamCompositeKey(s))) || pool[0];
    if (fallbackPick) {
      const nextSlots = [...cur.watchSlots];
      nextSlots[slotIdx] = toSlotPayload(fallbackPick);
      setState({ watchSource: validSource, watchSlots: nextSlots });
      showSnackbar(`"${slot.name}" unavailable on ${srcMeta.label} — loaded ${fallbackPick.name}`);
      return;
    }
  }

  callbacks?.onRetryWatchStreams?.(validSource);
  setState({ watchSource: validSource });
  showSnackbar(`Switched catalog to ${srcMeta.label} (loading streams)`);
}

function getPlayingSlotMap(state) {
  const playingSlotByStream = new Map();
  (state.watchSlots || []).slice(0, state.watchCount).forEach((s, idx) => {
    const key = getStreamCompositeKey(s);
    if (s && key && !playingSlotByStream.has(key)) {
      playingSlotByStream.set(key, idx);
    }
  });
  return playingSlotByStream;
}

function captureInputFocusState(inputEl) {
  if (!inputEl || document.activeElement !== inputEl) return null;
  return {
    selStart: inputEl.selectionStart,
    selEnd: inputEl.selectionEnd
  };
}

function restoreInputFocusState(inputEl, savedFocus) {
  if (!inputEl || !savedFocus) return;
  inputEl.focus({ preventScroll: true });
  if (savedFocus.selStart !== null && savedFocus.selEnd !== null) {
    try {
      inputEl.setSelectionRange(savedFocus.selStart, savedFocus.selEnd);
    } catch (err) {
      // ignore
    }
  }
}

function getAllEspnEvents(state) {
  const map = new Map();
  [...(state.liveEvents || []), ...(state.scoreboardEvents || [])].forEach((ev) => {
    if (ev && ev.id && !map.has(ev.id)) {
      map.set(ev.id, ev);
    }
  });
  return Array.from(map.values());
}

function formatStreamStart(unixSeconds) {
  if (!unixSeconds) return '24/7';
  return formatKickoffTime(new Date(unixSeconds * 1000).toISOString());
}

function buildToolbarMarkup(state) {
  const { watchCount, watchLayoutMode, watchSlots, watchSource } = state;
  const activeCount = watchSlots.slice(0, watchCount).filter(Boolean).length;

  return `
    <section class="md-card md-card-filled watch-toolbar-card">
      <div class="watch-toolbar-row">
        <div class="watch-toolbar-group">
          <span class="watch-control-label">Multiview Screens</span>
          <div class="md-segmented" role="group" aria-label="Simultaneous stream count">
            ${[1, 2, 3, 4]
              .map(
                (n) => `
              <button class="md-seg-btn${watchCount === n ? ' selected' : ''}" type="button" data-watch-count="${n}">
                <span class="material-symbols-rounded seg-check">check</span>
                ${n === 1 ? '1 Screen' : n === 2 ? '2 Split' : n === 3 ? '3 Triple' : '4 Quad'}
              </button>
            `
              )
              .join('')}
          </div>

          ${
            watchCount >= 2
              ? `
            <div class="md-segmented" role="group" aria-label="Multiview layout">
              <button class="md-seg-btn${watchLayoutMode === 'equal' ? ' selected' : ''}" type="button" data-watch-layout="equal">
                <span class="material-symbols-rounded seg-check">check</span>
                Equal Grid
              </button>
              <button class="md-seg-btn${watchLayoutMode === 'spotlight' ? ' selected' : ''}" type="button" data-watch-layout="spotlight">
                <span class="material-symbols-rounded seg-check">check</span>
                Spotlight
              </button>
            </div>
          `
              : ''
          }

          <span class="watch-control-label">Source</span>
          <div class="md-segmented watch-source-segmented" role="group" aria-label="Default stream source">
            ${STREAM_SOURCES.map((src) => {
              const srcCfbCount = getStreamsForSource(state, src.id).filter((s) => s.isCfb).length;
              return `
                <button class="md-seg-btn${watchSource === src.id ? ' selected' : ''}" type="button" data-watch-source="${src.id}">
                  <span class="material-symbols-rounded seg-check">check</span>
                  ${escapeHtml(src.label)}${srcCfbCount > 0 ? ` (${srcCfbCount})` : ''}
                </button>
              `;
            }).join('')}
          </div>
        </div>

        <div class="watch-toolbar-actions">
          <button class="md-btn md-btn-filled watch-fullscreen-btn" type="button" id="watch-fullscreen-btn" title="Enter Full Screen Multistream">
            <span class="material-symbols-rounded" style="font-size:18px;">fullscreen</span>
            Full Screen
          </button>
          ${
            activeCount > 0
              ? `
            <button class="md-btn md-btn-outlined" type="button" id="watch-clear-btn">
              <span class="material-symbols-rounded" style="font-size:18px;">clear_all</span>
              Clear
            </button>
          `
              : ''
          }
        </div>
      </div>
    </section>
  `;
}

function getFocusedPipSlotIndex(state) {
  const maxSlots = Math.max(1, state.watchCount || 1);
  const visibleSlots = (state.watchSlots || []).slice(0, maxSlots);
  if (visibleSlots[state.watchActiveSlot]) return state.watchActiveSlot;
  if (visibleSlots[state.watchPrimarySlot]) return state.watchPrimarySlot;
  const firstActive = visibleSlots.findIndex(Boolean);
  return firstActive !== -1 ? firstActive : 0;
}

function buildPipBarMarkup(state) {
  const maxSlots = Math.max(1, state.watchCount || 1);
  const visibleSlots = (state.watchSlots || []).slice(0, maxSlots);
  const activeEntries = visibleSlots
    .map((slot, idx) => (slot ? { slot, idx } : null))
    .filter(Boolean);
  if (activeEntries.length === 0) return '';

  const focusedIdx = getFocusedPipSlotIndex(state);
  const focusedEntry = activeEntries.find((e) => e.idx === focusedIdx) || activeEntries[0];
  const focusedSlot = focusedEntry.slot;
  const isMinimized = Boolean(state.watchPipMinimized);

  return `
    <div class="watch-pip-bar-info">
      <span class="watch-pip-badge">
        <span class="pulse-dot live"></span>
        PiP
      </span>
      <span class="watch-pip-title" title="${escapeHtml(focusedSlot.name || 'Live Stream')}">${escapeHtml(focusedSlot.name || 'Live Stream')}</span>
    </div>
    <div class="watch-pip-bar-actions">
      ${
        activeEntries.length > 1
          ? `
        <div class="watch-pip-slot-pills" role="group" aria-label="Switch active stream in Picture-in-Picture">
          ${activeEntries
            .map(
              (entry) => `
            <button
              class="watch-pip-slot-btn${entry.idx === focusedEntry.idx ? ' active' : ''}"
              type="button"
              data-pip-slot="${entry.idx}"
              title="${escapeHtml(entry.slot.name || `Stream #${entry.idx + 1}`)}"
            >#${entry.idx + 1}</button>
          `
            )
            .join('')}
        </div>
      `
          : ''
      }
      <button
        class="watch-pip-icon-btn"
        type="button"
        id="watch-pip-minimize-btn"
        data-pip-minimize
        title="${isMinimized ? 'Restore video' : 'Minimize Picture-in-Picture'}"
        aria-label="${isMinimized ? 'Restore video' : 'Minimize Picture-in-Picture'}"
      >
        <span class="material-symbols-rounded">${isMinimized ? 'expand_less' : 'minimize'}</span>
      </button>
      <button
        class="watch-pip-expand-btn"
        type="button"
        id="watch-pip-expand-btn"
        data-pip-expand
        title="Return to Watch tab"
      >
        <span class="material-symbols-rounded">open_in_full</span>
        <span>Watch</span>
      </button>
      <button
        class="watch-pip-icon-btn is-close"
        type="button"
        id="watch-pip-close-btn"
        data-pip-close
        title="Close Picture-in-Picture player"
        aria-label="Close Picture-in-Picture player"
      >
        <span class="material-symbols-rounded">close</span>
      </button>
    </div>
  `;
}

function buildFullscreenBarMarkup(state, liveCfbCount) {
  const { watchCount, watchLayoutMode, watchFsSidebarOpen, watchSource } = state;
  const sidebarOpen = Boolean(watchFsSidebarOpen);
  return `
    <div class="watch-fs-bar-left">
      <span class="watch-fs-brand">
        <span class="material-symbols-rounded" style="font-size:18px;">live_tv</span>
        Multistream Full Screen
      </span>
      <div class="watch-fs-group" role="group" aria-label="Full screen stream layout">
        ${[1, 2, 3, 4]
          .map(
            (n) => `
          <button class="watch-fs-pill${watchCount === n ? ' selected' : ''}" type="button" data-fs-watch-count="${n}">
            ${n === 1 ? '1 Screen' : n === 2 ? '2 Split' : n === 3 ? '3 Triple' : '4 Quad'}
          </button>
        `
          )
          .join('')}
      </div>
      ${
        watchCount >= 2
          ? `
        <div class="watch-fs-group" role="group" aria-label="Full screen grid mode">
          <button class="watch-fs-pill${watchLayoutMode === 'equal' ? ' selected' : ''}" type="button" data-fs-watch-mode="equal">
            Equal Grid
          </button>
          <button class="watch-fs-pill${watchLayoutMode === 'spotlight' ? ' selected' : ''}" type="button" data-fs-watch-mode="spotlight">
            Spotlight
          </button>
        </div>
      `
          : ''
      }
      <div class="watch-fs-group" role="group" aria-label="Full screen stream source">
        ${STREAM_SOURCES.map(
          (src) => `
          <button class="watch-fs-pill${watchSource === src.id ? ' selected' : ''}" type="button" data-fs-watch-source="${src.id}">
            ${escapeHtml(src.label)}
          </button>
        `
        ).join('')}
      </div>
    </div>
    <div class="watch-fs-bar-right">
      <button
        class="watch-fs-pill watch-fs-streams-btn${sidebarOpen ? ' selected' : ''}"
        type="button"
        id="watch-fs-sidebar-toggle-btn"
        aria-expanded="${sidebarOpen ? 'true' : 'false'}"
        title="Add or change games playing in Full Screen"
      >
        <span class="material-symbols-rounded" style="font-size:16px;">video_library</span>
        <span>Streams (${liveCfbCount} Live)</span>
      </button>
      <button class="watch-fs-exit-btn" type="button" id="watch-fs-exit-btn" title="Exit Full Screen (Esc)">
        <span class="material-symbols-rounded" style="font-size:18px;">fullscreen_exit</span>
        <span>Exit Full Screen</span>
      </button>
    </div>
  `;
}

function buildFullscreenSidebarMarkup(state, allEvents) {
  const { watchCategoryFilter, watchCount, watchActiveSlot, watchSearchQuery, watchSource } = state;
  const activeStreams = getStreamsForSource(state);
  const cfbCount = activeStreams.filter((s) => s.isCfb).length;
  const liveCount = activeStreams.filter((s) => s.isLiveNow).length;
  const footballCount = activeStreams.filter((s) => s.isFootball).length;
  const filtered = getFilteredStreams(state);
  const playingSlotByStream = getPlayingSlotMap(state);

  return `
    <div class="watch-fs-sidebar-header">
      <span class="watch-fs-sidebar-title">
        <span class="material-symbols-rounded" style="font-size:18px;">live_tv</span>
        Streams &amp; Games
      </span>
      <button
        class="watch-fs-sidebar-close-btn"
        type="button"
        id="watch-fs-sidebar-close-btn"
        aria-label="Close streams sidebar"
        title="Hide streams sidebar"
      >
        <span class="material-symbols-rounded" style="font-size:18px;">close</span>
      </button>
    </div>

    <div class="watch-fs-sidebar-controls">
      <div class="watch-fs-target-row" role="group" aria-label="Stream source">
        <span class="watch-fs-sublabel">Source:</span>
        ${STREAM_SOURCES.map(
          (src) => `
          <button class="watch-fs-pill${watchSource === src.id ? ' selected' : ''}" type="button" data-fs-watch-source="${src.id}">
            ${escapeHtml(src.label)}
          </button>
        `
        ).join('')}
      </div>

      <div class="watch-fs-target-row" role="group" aria-label="Select target stream slot">
        <span class="watch-fs-sublabel">Slot:</span>
        ${Array.from({ length: watchCount }, (_, idx) => idx)
          .map(
            (idx) => `
          <button class="watch-fs-pill${watchActiveSlot === idx ? ' selected' : ''}" type="button" data-fs-target-slot="${idx}">
            #${idx + 1}
          </button>
        `
          )
          .join('')}
        ${
          watchCount < 4
            ? `
          <button class="watch-fs-pill" type="button" id="watch-fs-add-slot-btn" title="Add another screen to multiview">
            + Slot
          </button>
        `
            : ''
        }
      </div>

      <div class="watch-fs-sidebar-filters" role="group" aria-label="Filter stream categories">
        <button class="watch-fs-pill${watchCategoryFilter === 'cfb' ? ' selected' : ''}" type="button" data-fs-cat="cfb">
          CFB (${cfbCount})
        </button>
        <button class="watch-fs-pill${watchCategoryFilter === 'live' ? ' selected' : ''}" type="button" data-fs-cat="live">
          Live (${liveCount})
        </button>
        <button class="watch-fs-pill${watchCategoryFilter === 'football' ? ' selected' : ''}" type="button" data-fs-cat="football">
          Football (${footballCount})
        </button>
        <button class="watch-fs-pill${watchCategoryFilter === 'all' ? ' selected' : ''}" type="button" data-fs-cat="all">
          All (${activeStreams.length})
        </button>
      </div>

      <label class="watch-fs-search-wrap" aria-label="Search full screen streams">
        <span class="material-symbols-rounded" style="font-size:16px;color:#8f9d98;">search</span>
        <input
          id="watch-fs-stream-search"
          type="search"
          placeholder="Search matchup or network..."
          value="${escapeHtml(watchSearchQuery)}"
          autocomplete="off"
        >
      </label>
    </div>

    <div class="watch-fs-sidebar-list">
      ${
        filtered.length === 0
          ? `<div style="padding:18px 8px;text-align:center;color:#9ba8a3;font-size:12px;">No matching streams found.</div>`
          : filtered
              .map((stream) => {
                const playingIdx = playingSlotByStream.get(getStreamCompositeKey(stream));
                const isPlaying = playingIdx !== undefined;
                const espnEv = stream.isFootball ? matchStreamToEspnEvent(stream, allEvents) : null;
                const statusSub = isPlaying
                  ? `Playing in #${playingIdx + 1}`
                  : stream.viewers > 0
                    ? `${escapeHtml(stream.viewersDisplay)} watching`
                    : escapeHtml(stream.sourceLabel);
                return `
                  <article class="watch-fs-stream-item${isPlaying ? ' is-playing' : ''}">
                    <div class="watch-fs-stream-meta">
                      ${
                        stream.isLiveNow
                          ? `<span class="status-pill live"><span class="pulse-dot live"></span>${stream.alwaysLive ? '24/7 LIVE' : 'LIVE'}</span>`
                          : `<span class="status-pill pre">${escapeHtml(stream.timeLabel || formatStreamStart(stream.startsAt))}</span>`
                      }
                      <span style="color:#9ba8a3;">${statusSub}</span>
                    </div>
                    <div class="watch-fs-stream-title">${escapeHtml(stream.name)}</div>
                    <div class="watch-fs-stream-sub">
                      <span>${escapeHtml(stream.sourceLabel)}</span>
                      <span>· ${escapeHtml(stream.sourceTag)}</span>
                      ${
                        espnEv
                          ? `<span>· <strong>${escapeHtml(espnEv.away.abbreviation)}</strong> ${espnEv.state === 'pre' ? '@' : escapeHtml(espnEv.away.score || '0')} ${espnEv.state === 'pre' ? '' : '-'} <strong>${escapeHtml(espnEv.home.abbreviation)}</strong> ${espnEv.state === 'pre' ? '' : escapeHtml(espnEv.home.score || '0')}</span>`
                          : ''
                      }
                    </div>
                    <div class="watch-fs-stream-actions">
                      <button class="watch-fs-stream-btn ${isPlaying ? '' : 'primary'}" type="button" data-fs-stream-select="${escapeHtml(stream.id)}" data-fs-stream-source="${escapeHtml(stream.source)}">
                        ${isPlaying ? `Active (#${playingIdx + 1})` : `Play in #${watchActiveSlot + 1}`}
                      </button>
                      <button class="watch-fs-stream-btn" type="button" data-fs-stream-add="${escapeHtml(stream.id)}" data-fs-stream-source="${escapeHtml(stream.source)}" title="Add to next Multiview slot">
                        + Multiview
                      </button>
                    </div>
                  </article>
                `;
              })
              .join('')
      }
    </div>
  `;
}

function buildSlotHeaderMarkup(idx, slot, stream, espnEvent, state) {
  const { watchCount, watchLayoutMode, watchPrimarySlot, watchActiveSlot } = state;
  const isPrimary = watchCount >= 2 && watchLayoutMode === 'spotlight' && watchPrimarySlot === idx;
  const isTarget = watchActiveSlot === idx;
  const feeds = stream?.feeds || [];
  const hasSkycast = feeds.some((f) => /skycast/i.test(f.label));
  const slotSource = normalizeWatchSource(slot.source);
  const srcMeta = getSourceMeta(slotSource);
  const openUrl = slot.externalUrl || slot.ppvUrl || srcMeta.url;

  const scoreChip = espnEvent
    ? `
      <span class="watch-score-chip${espnEvent.state === 'in' ? ' live' : ''}" title="${escapeHtml(espnEvent.statusDetail || '')}">
        ${escapeHtml(espnEvent.away.abbreviation)} ${espnEvent.state === 'pre' ? '' : escapeHtml(espnEvent.away.score || '0')}${espnEvent.state === 'pre' ? ' @ ' : ' - '}${escapeHtml(espnEvent.home.abbreviation)}${espnEvent.state === 'pre' ? '' : ` ${escapeHtml(espnEvent.home.score || '0')}`}
        ${espnEvent.state === 'in' && espnEvent.statusDetail ? ` · ${escapeHtml(espnEvent.statusDetail)}` : ''}
      </span>
    `
    : '';

  return `
    <div class="watch-slot-header-left">
      ${
        watchCount >= 2
          ? `
        <span class="watch-drag-handle" data-slot-drag-handle="${idx}" title="Click and drag to rearrange stream order" aria-label="Drag to rearrange Slot #${idx + 1}">
          <span class="material-symbols-rounded" style="font-size:18px;">drag_indicator</span>
        </span>
      `
          : ''
      }
      <button class="watch-slot-num-btn${isTarget ? ' is-target' : ''}" type="button" data-slot-target="${idx}" title="Target Slot #${idx + 1} when picking streams">
        #${idx + 1}
      </button>
      ${stream?.isLiveNow ? `<span class="watch-live-dot" title="Live now">LIVE</span>` : ''}
      <div class="watch-slot-title-wrap">
        <span class="watch-slot-title" title="${escapeHtml(slot.name)}">${escapeHtml(slot.name)}</span>
        <div class="watch-slot-sub">
          ${scoreChip}
          ${hasSkycast ? `<span class="broadcast-tag">SkyCast Ready</span>` : ''}
        </div>
      </div>
    </div>

    <div class="watch-slot-header-right">
      <select
        class="md-select watch-source-select"
        data-slot-source="${idx}"
        aria-label="Select stream source for slot ${idx + 1}"
        title="Change stream source for this game"
      >
        ${STREAM_SOURCES.map(
          (src) => `
          <option value="${escapeHtml(src.id)}"${slotSource === src.id ? ' selected' : ''}>${escapeHtml(src.label)}</option>
        `
        ).join('')}
      </select>

      ${
        feeds.length > 1
          ? `
        <select class="md-select watch-feed-select" data-slot-feed="${idx}" aria-label="Select broadcast feed for slot ${idx + 1}">
          ${feeds
            .map(
              (f) => `
            <option value="${escapeHtml(f.id)}"${String(f.id) === String(slot.feedId) ? ' selected' : ''}>${escapeHtml(f.label)}</option>
          `
            )
            .join('')}
        </select>
      `
          : `<span class="broadcast-tag">${escapeHtml(slot.sourceTag || 'HD')}</span>`
      }

      ${
        watchCount >= 2
          ? `
        <button class="md-icon-btn small${isPrimary ? ' tonal' : ''}" type="button" data-slot-promote="${idx}" title="${isPrimary ? 'Main Spotlight Slot' : 'Make Main Spotlight'}">
          <span class="material-symbols-rounded" style="font-size:17px;">${isPrimary ? 'star' : 'featured_video'}</span>
        </button>
      `
          : ''
      }

      ${
        espnEvent
          ? `
        <button class="md-icon-btn small" type="button" data-open-game="${escapeHtml(espnEvent.id)}" title="Open ESPN Game Center & Stats">
          <span class="material-symbols-rounded" style="font-size:17px;">scoreboard</span>
        </button>
      `
          : ''
      }

      <button class="md-icon-btn small" type="button" data-slot-reload="${idx}" title="Reload player">
        <span class="material-symbols-rounded" style="font-size:17px;">refresh</span>
      </button>

      <a class="md-icon-btn small" href="${escapeHtml(openUrl)}" target="_blank" rel="noopener noreferrer" title="Open on ${escapeHtml(srcMeta.label)}">
        <span class="material-symbols-rounded" style="font-size:17px;">open_in_new</span>
      </a>

      <button class="md-icon-btn small" type="button" data-slot-remove="${idx}" title="Remove stream from slot #${idx + 1}">
        <span class="material-symbols-rounded" style="font-size:17px;">close</span>
      </button>
    </div>
  `;
}

function buildEmptySlotMarkup(idx, isTarget) {
  return `
    <button class="watch-empty-slot-btn${isTarget ? ' is-target' : ''}" type="button" data-slot-target="${idx}">
      <span class="material-symbols-rounded watch-empty-icon">add_to_queue</span>
      <span class="watch-empty-title">Stream Slot #${idx + 1}${isTarget ? ' (Target)' : ''}</span>
      <span class="watch-empty-sub muted">Select any live game below to start streaming</span>
    </button>
  `;
}

function wireStageDragReorder(stageHost, getSuppressClick, setSuppressClick) {
  let lastDownTarget = null;
  let ghostEl = null;

  const pointerState = {
    active: false,
    moved: false,
    fromIdx: -1,
    targetIdx: null,
    startX: 0,
    startY: 0,
    sourceCard: null,
    label: ''
  };

  const html5Drag = {
    active: false,
    fromIdx: -1,
    targetIdx: null,
    sourceCard: null
  };

  function isNonDragControl(target) {
    return Boolean(
      target?.closest?.(
        '.watch-slot-header-right, select, input, a, [data-slot-promote], [data-open-game], [data-slot-reload], [data-slot-remove]'
      )
    );
  }

  function removeGhost() {
    if (ghostEl) {
      ghostEl.remove();
      ghostEl = null;
    }
  }

  function clearDragUi() {
    document.body.classList.remove('watch-is-dragging');
    stageHost.classList.remove('is-dragging');
    stageHost.querySelectorAll('.watch-slot-card').forEach((c) => {
      c.classList.remove('is-dragging-source', 'is-drop-target');
    });
    removeGhost();
  }

  function findDropTargetCard(clientX, clientY, fallbackEl = null) {
    if (Number.isFinite(clientX) && Number.isFinite(clientY) && (clientX !== 0 || clientY !== 0)) {
      const cards = Array.from(stageHost.querySelectorAll(':scope > .watch-slot-card[data-slot-index]'));
      for (const c of cards) {
        const rect = c.getBoundingClientRect();
        if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
          return c;
        }
      }
    }
    return fallbackEl?.closest?.('.watch-slot-card[data-slot-index]') || null;
  }

  function updateDropHighlight(sourceIdx, targetCard) {
    let nextTargetIdx = null;
    stageHost.querySelectorAll(':scope > .watch-slot-card[data-slot-index]').forEach((c) => {
      const cIdx = Number(c.dataset.slotIndex);
      const isDrop = targetCard === c && cIdx !== sourceIdx;
      c.classList.toggle('is-drop-target', isDrop);
      if (isDrop) nextTargetIdx = cIdx;
    });
    return nextTargetIdx;
  }

  stageHost.addEventListener('pointerdown', (e) => {
    lastDownTarget = e.target;
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (getState().watchCount < 2) return;
    if (isNonDragControl(e.target)) return;

    const dragOrigin = e.target.closest('.watch-slot-header, [data-slot-drag-handle], .watch-slot-card.is-empty');
    if (!dragOrigin) return;
    const card = dragOrigin.closest('.watch-slot-card[data-slot-index]');
    if (!card) return;

    const titleText = card.querySelector('.watch-slot-title')?.textContent?.trim() || `Slot #${Number(card.dataset.slotIndex) + 1}`;
    pointerState.active = true;
    pointerState.moved = false;
    pointerState.fromIdx = Number(card.dataset.slotIndex);
    pointerState.targetIdx = null;
    pointerState.startX = e.clientX;
    pointerState.startY = e.clientY;
    pointerState.sourceCard = card;
    pointerState.label = titleText;
  });

  window.addEventListener('pointermove', (e) => {
    if (!pointerState.active || html5Drag.active) return;

    const dist = Math.hypot(e.clientX - pointerState.startX, e.clientY - pointerState.startY);
    if (!pointerState.moved) {
      if (dist < 5) return;
      pointerState.moved = true;
      document.body.classList.add('watch-is-dragging');
      stageHost.classList.add('is-dragging');
      pointerState.sourceCard?.classList.add('is-dragging-source');

      ghostEl = document.createElement('div');
      ghostEl.className = 'watch-drag-ghost';
      ghostEl.textContent = `Move #${pointerState.fromIdx + 1}: ${pointerState.label}`;
      document.body.appendChild(ghostEl);
    }

    if (ghostEl) {
      ghostEl.style.left = `${Math.round(e.clientX + 14)}px`;
      ghostEl.style.top = `${Math.round(e.clientY + 14)}px`;
    }

    const targetCard = findDropTargetCard(e.clientX, e.clientY);
    pointerState.targetIdx = updateDropHighlight(pointerState.fromIdx, targetCard);
    if (ghostEl) {
      ghostEl.textContent =
        pointerState.targetIdx !== null
          ? `Swap #${pointerState.fromIdx + 1} ⇄ #${pointerState.targetIdx + 1}`
          : `Move #${pointerState.fromIdx + 1}: ${pointerState.label}`;
    }
  });

  function finishPointerDrag(e, cancelled) {
    if (!pointerState.active) return;
    const wasMoved = pointerState.moved;
    const fromIdx = pointerState.fromIdx;
    let toIdx = pointerState.targetIdx;

    if (!cancelled && wasMoved) {
      const targetCard = findDropTargetCard(e.clientX, e.clientY);
      if (targetCard) {
        toIdx = Number(targetCard.dataset.slotIndex);
      }
      setSuppressClick(Date.now() + 250);
    }

    pointerState.active = false;
    pointerState.moved = false;
    pointerState.sourceCard = null;
    pointerState.targetIdx = null;

    if (!html5Drag.active) {
      clearDragUi();
      if (!cancelled && wasMoved && toIdx !== null && toIdx !== fromIdx) {
        reorderWatchSlots(fromIdx, toIdx);
      }
    } else {
      removeGhost();
    }
  }

  window.addEventListener('pointerup', (e) => finishPointerDrag(e, false));
  window.addEventListener('pointercancel', (e) => finishPointerDrag(e, true));

  // HTML5 Drag & Drop support (handles browser native drag sessions when card.draggable = true)
  stageHost.addEventListener('dragstart', (e) => {
    if (getState().watchCount < 2 || isNonDragControl(lastDownTarget) || isNonDragControl(e.target)) {
      e.preventDefault();
      return;
    }
    const card = e.target.closest('.watch-slot-card[data-slot-index]');
    if (!card) {
      e.preventDefault();
      return;
    }

    pointerState.active = false;
    pointerState.moved = false;
    removeGhost();

    html5Drag.active = true;
    html5Drag.fromIdx = Number(card.dataset.slotIndex);
    html5Drag.targetIdx = null;
    html5Drag.sourceCard = card;

    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      try {
        e.dataTransfer.setData('text/plain', String(html5Drag.fromIdx));
      } catch (err) {
        // ignore
      }
    }

    document.body.classList.add('watch-is-dragging');
    stageHost.classList.add('is-dragging');
    setTimeout(() => {
      if (html5Drag.active) {
        card.classList.add('is-dragging-source');
      }
    }, 0);
  });

  stageHost.addEventListener('dragover', (e) => {
    if (!html5Drag.active) return;
    e.preventDefault();
    document.body.classList.add('watch-is-dragging');
    stageHost.classList.add('is-dragging');
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'move';
    }
    const targetCard = findDropTargetCard(e.clientX, e.clientY, e.target);
    html5Drag.targetIdx = updateDropHighlight(html5Drag.fromIdx, targetCard);
  });

  stageHost.addEventListener('drop', (e) => {
    if (!html5Drag.active) return;
    e.preventDefault();
    const targetCard = findDropTargetCard(e.clientX, e.clientY, e.target);
    const fromIdx = html5Drag.fromIdx;
    const toIdx = targetCard ? Number(targetCard.dataset.slotIndex) : html5Drag.targetIdx;

    html5Drag.active = false;
    html5Drag.sourceCard = null;
    html5Drag.targetIdx = null;
    clearDragUi();

    if (toIdx !== null && toIdx !== fromIdx) {
      reorderWatchSlots(fromIdx, toIdx);
    }
  });

  stageHost.addEventListener('dragend', () => {
    if (!html5Drag.active) return;
    html5Drag.active = false;
    html5Drag.sourceCard = null;
    html5Drag.targetIdx = null;
    clearDragUi();
  });
}

function reconcileVideoStage(stageHost, state, allEvents, callbacks) {
  const { watchCount, watchLayoutMode, watchPrimarySlot, watchActiveSlot, watchSlots } = state;
  const effectiveMode = watchCount >= 2 ? watchLayoutMode : 'equal';
  const canDrag = watchCount >= 2;
  const focusedPipIdx = getFocusedPipSlotIndex(state);
  stageHost.className = `watch-stage-grid count-${watchCount} mode-${effectiveMode}${stageHost.classList.contains('is-dragging') ? ' is-dragging' : ''}`;

  const streamById = new Map(getAllWatchStreams(state).map((s) => [String(s.id), s]));
  const existingCards = Array.from(stageHost.querySelectorAll(':scope > [data-slot-index]'));
  const usedCards = new Set();
  const matchedCards = new Array(watchCount).fill(null);

  // First pass: match mounted stream iframes anywhere in stageHost so reordering never detaches/reloads iframes
  for (let idx = 0; idx < watchCount; idx++) {
    const slot = watchSlots[idx] || null;
    if (!slot) continue;
    const match = existingCards.find(
      (c) => !usedCards.has(c) && c.dataset.slotKind === 'stream' && c.dataset.mountedIframe === slot.iframe
    );
    if (match) {
      matchedCards[idx] = match;
      usedCards.add(match);
    }
  }

  // Second pass: match empty slots to existing empty cards
  for (let idx = 0; idx < watchCount; idx++) {
    if (matchedCards[idx] || watchSlots[idx]) continue;
    const match = existingCards.find((c) => !usedCards.has(c) && c.dataset.slotKind === 'empty');
    if (match) {
      matchedCards[idx] = match;
      usedCards.add(match);
    }
  }

  // Remove unused leftover cards above watchCount or replaced streams
  existingCards.forEach((c) => {
    if (!usedCards.has(c)) {
      c.remove();
    }
  });

  for (let idx = 0; idx < watchCount; idx++) {
    const slot = watchSlots[idx] || null;
    const isPrimary = effectiveMode === 'spotlight' && watchPrimarySlot === idx;
    const isTarget = watchActiveSlot === idx;
    const card = matchedCards[idx];

    if (!slot) {
      if (!card) {
        const nextCard = document.createElement('article');
        nextCard.className = `md-card watch-slot-card is-empty${isPrimary ? ' is-primary' : ''}${isTarget ? ' is-target' : ''}`;
        nextCard.dataset.slotIndex = String(idx);
        nextCard.dataset.slotKind = 'empty';
        nextCard.style.order = String(idx);
        nextCard.draggable = canDrag;
        nextCard.innerHTML = buildEmptySlotMarkup(idx, isTarget);
        stageHost.appendChild(nextCard);
      } else {
        card.className = `md-card watch-slot-card is-empty${isPrimary ? ' is-primary' : ''}${isTarget ? ' is-target' : ''}`;
        card.dataset.slotIndex = String(idx);
        card.style.order = String(idx);
        card.draggable = canDrag;
        card.innerHTML = buildEmptySlotMarkup(idx, isTarget);
      }
      continue;
    }

    const stream = streamById.get(String(slot.streamId)) || null;
    const espnEvent = stream ? matchStreamToEspnEvent(stream, allEvents) : null;
    const accent = stream?.colors?.[0] || '#006c47';
    const isPipFocused = idx === focusedPipIdx;
    const existingIframe = card?.querySelector('iframe.watch-player-iframe');

    if (card && existingIframe) {
      // Preserve live video iframe untouched in DOM while updating order/slot index/metadata header
      card.className = `md-card watch-slot-card has-stream${isPrimary ? ' is-primary' : ''}${isTarget ? ' is-target' : ''}${isPipFocused ? ' is-pip-focused' : ''}`;
      card.dataset.slotIndex = String(idx);
      card.style.order = String(idx);
      card.draggable = canDrag;
      card.style.borderTop = `3px solid ${accent}`;
      const headerEl = card.querySelector('.watch-slot-header');
      if (headerEl) {
        headerEl.innerHTML = buildSlotHeaderMarkup(idx, slot, stream, espnEvent, state);
      }
      if (existingIframe.title !== slot.name) {
        existingIframe.title = slot.name;
      }
    } else {
      const nextCard = document.createElement('article');
      nextCard.className = `md-card watch-slot-card has-stream${isPrimary ? ' is-primary' : ''}${isTarget ? ' is-target' : ''}${isPipFocused ? ' is-pip-focused' : ''}`;
      nextCard.dataset.slotIndex = String(idx);
      nextCard.dataset.slotKind = 'stream';
      nextCard.dataset.mountedIframe = slot.iframe;
      nextCard.style.order = String(idx);
      nextCard.draggable = canDrag;
      nextCard.style.borderTop = `3px solid ${accent}`;
      nextCard.innerHTML = `
        <div class="watch-slot-header">
          ${buildSlotHeaderMarkup(idx, slot, stream, espnEvent, state)}
        </div>
        <div class="watch-player-wrap">
          <iframe
            class="watch-player-iframe"
            src="${escapeHtml(slot.iframe)}"
            title="${escapeHtml(slot.name)}"
            frameborder="0"
            allowfullscreen
            allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
            referrerpolicy="no-referrer"
          ></iframe>
        </div>
      `;
      stageHost.appendChild(nextCard);
    }
  }

  // Delegate stage slot controls once on stageHost
  if (!stageHost.dataset.eventsWired) {
    stageHost.dataset.eventsWired = '1';
    let suppressClickUntil = 0;

    wireStageDragReorder(
      stageHost,
      () => suppressClickUntil,
      (val) => {
        suppressClickUntil = val;
      }
    );

    stageHost.addEventListener('click', (e) => {
      if (Date.now() < suppressClickUntil) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      const gameBtn = e.target.closest('[data-open-game]');
      if (gameBtn) {
        callbacks.onOpenGameSheet?.(gameBtn.dataset.openGame);
        return;
      }

      const targetBtn = e.target.closest('[data-slot-target]');
      if (targetBtn) {
        const cur = getState();
        const nextIdx = Number(targetBtn.dataset.slotTarget) || 0;
        const patch = { watchActiveSlot: nextIdx };
        if (cur.watchFullscreen && !cur.watchSlots[nextIdx]) {
          patch.watchFsSidebarOpen = true;
        }
        setState(patch);
        return;
      }

      const promoteBtn = e.target.closest('[data-slot-promote]');
      if (promoteBtn) {
        const idx = Number(promoteBtn.dataset.slotPromote);
        setState({ watchPrimarySlot: idx, watchLayoutMode: 'spotlight' });
        return;
      }

      const reloadBtn = e.target.closest('[data-slot-reload]');
      if (reloadBtn) {
        const idx = Number(reloadBtn.dataset.slotReload);
        const slotEl = stageHost.querySelector(`:scope > [data-slot-index="${idx}"]`);
        const iframe = slotEl?.querySelector('iframe.watch-player-iframe');
        if (iframe && slotEl?.dataset.mountedIframe) {
          iframe.src = slotEl.dataset.mountedIframe;
        }
        return;
      }

      const removeBtn = e.target.closest('[data-slot-remove]');
      if (removeBtn) {
        const idx = Number(removeBtn.dataset.slotRemove);
        const cur = getState();
        const nextSlots = [...cur.watchSlots];
        nextSlots[idx] = null;
        const maxVisible = Math.max(1, cur.watchCount || 1);
        const anyRemaining = nextSlots.slice(0, maxVisible).some(Boolean);
        setState({
          watchSlots: nextSlots,
          watchActiveSlot: idx,
          ...(anyRemaining ? {} : { watchPlayerActive: false, watchPipMinimized: false })
        });
      }
    });

    stageHost.addEventListener('change', (e) => {
      const sourceSelectEl = e.target.closest('[data-slot-source]');
      if (sourceSelectEl) {
        const idx = Number(sourceSelectEl.dataset.slotSource);
        switchSlotSource(idx, String(sourceSelectEl.value), callbacks);
        return;
      }

      const selectEl = e.target.closest('[data-slot-feed]');
      if (!selectEl) return;
      const idx = Number(selectEl.dataset.slotFeed);
      const feedId = String(selectEl.value);
      const cur = getState();
      const slot = cur.watchSlots[idx];
      if (!slot) return;
      const stream = findStreamById(cur, slot.streamId, slot.source);
      const feed = stream?.feeds?.find((f) => String(f.id) === feedId);
      if (!stream || !feed) return;
      const nextSlots = [...cur.watchSlots];
      nextSlots[idx] = toSlotPayload(stream, feed);
      setState({ watchSlots: nextSlots });
    });
  }
}

function getFilteredStreams(state) {
  const { watchCategoryFilter, watchSearchQuery, searchQuery } = state;
  const activeStreams = getStreamsForSource(state);
  const q = (watchSearchQuery || searchQuery || '').trim().toLowerCase();

  return activeStreams.filter((s) => {
    if (watchCategoryFilter === 'cfb' && !s.isCfb) return false;
    if (watchCategoryFilter === 'live' && !s.isLiveNow) return false;
    if (watchCategoryFilter === 'football' && !s.isFootball) return false;

    if (q) {
      const hay = `${s.name} ${s.tag} ${s.category} ${s.sourceTag} ${s.sourceLabel || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function buildCatalogControlsMarkup(state) {
  const { watchCategoryFilter, watchCount, watchActiveSlot, watchSearchQuery, watchSource } = state;
  const activeStreams = getStreamsForSource(state);
  const activeSrcMeta = getSourceMeta(watchSource);
  const cfbCount = activeStreams.filter((s) => s.isCfb).length;
  const liveCount = activeStreams.filter((s) => s.isLiveNow).length;
  const footballCount = activeStreams.filter((s) => s.isFootball).length;

  return `
    <div class="watch-catalog-top">
      <div>
        <h2 class="section-heading">Available Live Streams</h2>
        <span class="muted" style="font-size:12px;">Source: ${escapeHtml(activeSrcMeta.label)} · Click any game to load into the targeted slot or + Multiview</span>
      </div>

      <div class="watch-catalog-right-controls">
        <div class="watch-target-pills" role="group" aria-label="Catalog stream source">
          <span class="muted" style="font-size:12px;font-weight:600;">Source:</span>
          ${STREAM_SOURCES.map(
            (src) => `
            <button class="md-chip${watchSource === src.id ? ' selected' : ''}" type="button" data-watch-source="${escapeHtml(src.id)}">
              ${escapeHtml(src.label)}
            </button>
          `
          ).join('')}
        </div>

        <div class="watch-target-pills" role="group" aria-label="Target player slot">
          <span class="muted" style="font-size:12px;font-weight:600;">Load into:</span>
          ${Array.from({ length: watchCount }, (_, idx) => idx)
            .map(
              (idx) => `
            <button class="md-chip${watchActiveSlot === idx ? ' selected' : ''}" type="button" data-catalog-target="${idx}">
              Slot #${idx + 1}
            </button>
          `
            )
            .join('')}
        </div>
      </div>
    </div>

    <div class="watch-catalog-filters">
      <div class="md-chip-row">
        <button class="md-chip${watchCategoryFilter === 'cfb' ? ' selected' : ''}" type="button" data-watch-cat="cfb">
          College Football (${cfbCount})
        </button>
        <button class="md-chip${watchCategoryFilter === 'live' ? ' selected' : ''}" type="button" data-watch-cat="live">
          Live Now (${liveCount})
        </button>
        <button class="md-chip${watchCategoryFilter === 'football' ? ' selected' : ''}" type="button" data-watch-cat="football">
          All Football (${footballCount})
        </button>
        <button class="md-chip${watchCategoryFilter === 'all' ? ' selected' : ''}" type="button" data-watch-cat="all">
          All Sports &amp; 24/7 (${activeStreams.length})
        </button>
      </div>

      <label class="md-search-bar watch-catalog-search" aria-label="Filter available streams">
        <span class="material-symbols-rounded muted">search</span>
        <input
          id="watch-stream-search"
          type="search"
          placeholder="Search matchup, network, or sport..."
          value="${escapeHtml(watchSearchQuery)}"
          autocomplete="off"
        >
      </label>
    </div>
  `;
}

function buildCatalogGridMarkup(state, allEvents, callbacks) {
  const { watchActiveSlot } = state;
  const { source: activeSource, loading, error, streams } = getCatalogLoadingState(state);
  const srcMeta = getSourceMeta(activeSource);

  if (loading && streams.length === 0) {
    return `
      <div class="watch-streams-grid">
        ${Array.from({ length: 6 })
          .map(() => `<div class="skeleton" style="height:220px;border-radius:16px;"></div>`)
          .join('')}
      </div>
    `;
  }

  if (error && streams.length === 0) {
    return `
      <div class="md-card empty-state-card">
        <span class="material-symbols-rounded">tv_off</span>
        <p class="empty-state-title">Unable to load ${escapeHtml(srcMeta.label)} stream directory</p>
        <p class="empty-state-desc">${escapeHtml(error)}</p>
        <button class="md-btn md-btn-filled" type="button" id="watch-retry-btn">Retry</button>
      </div>
    `;
  }

  const filtered = getFilteredStreams(state);
  if (filtered.length === 0) {
    return `
      <div class="md-card empty-state-card">
        <span class="material-symbols-rounded">search_off</span>
        <p class="empty-state-title">No streams match your filters</p>
        <p class="empty-state-desc">Try switching to All Sports, switching stream sources, or clearing the search box.</p>
      </div>
    `;
  }

  const playingSlotByStream = getPlayingSlotMap(state);
  const otherSources = STREAM_SOURCES.filter((src) => src.id !== activeSource).map((src) => ({
    meta: src,
    streams: getStreamsForSource(state, src.id)
  }));

  return `
    <div class="watch-streams-grid">
      ${filtered
        .map((stream) => {
          const playingIdx = playingSlotByStream.get(getStreamCompositeKey(stream));
          const isPlaying = playingIdx !== undefined;
          const espnEv = stream.isFootball ? matchStreamToEspnEvent(stream, allEvents) : null;
          const hasSkycast = stream.feeds.some((f) => /skycast/i.test(f.label));
          const altMatches = otherSources
            .map((other) => ({
              meta: other.meta,
              match: findMatchingStreamInSource(stream, other.streams, allEvents)
            }))
            .filter((entry) => Boolean(entry.match));
          const cornerBadge = stream.viewers > 0 ? `${stream.viewersDisplay} watching` : stream.sourceLabel;

          return `
            <article class="md-card watch-stream-card${isPlaying ? ' is-playing' : ''}">
              <div class="watch-stream-poster-wrap">
                ${
                  stream.poster
                    ? `<img class="watch-stream-poster" src="${escapeHtml(stream.poster)}" alt="${escapeHtml(stream.name)}" loading="lazy" onerror="this.style.display='none'">`
                    : `<div class="watch-stream-poster-fallback" style="background:linear-gradient(135deg, ${escapeHtml(stream.colors[0])}, ${escapeHtml(stream.colors[1])});"><span class="material-symbols-rounded" style="font-size:36px;">live_tv</span></div>`
                }
                <div class="watch-poster-badges">
                  ${
                    stream.isLiveNow
                      ? `<span class="status-pill live"><span class="pulse-dot live"></span>${stream.alwaysLive ? '24/7 LIVE' : 'LIVE'}</span>`
                      : `<span class="status-pill pre">${escapeHtml(stream.timeLabel || formatStreamStart(stream.startsAt))}</span>`
                  }
                  <span class="watch-viewers-pill">${escapeHtml(cornerBadge)}</span>
                </div>
                ${
                  isPlaying
                    ? `<span class="watch-playing-slot-badge">Playing in #${playingIdx + 1}</span>`
                    : ''
                }
              </div>

              <div class="watch-stream-body">
                <div class="watch-stream-title" title="${escapeHtml(stream.name)}">${escapeHtml(stream.name)}</div>
                <div class="watch-stream-tags">
                  <span class="broadcast-tag watch-card-source-tag">${escapeHtml(stream.sourceLabel)}</span>
                  <span class="broadcast-tag">${escapeHtml(stream.sourceTag)}</span>
                  <span class="broadcast-tag">${escapeHtml(stream.tag || stream.category)}</span>
                  ${stream.feeds.length > 1 ? `<span class="broadcast-tag">${stream.feeds.length} ${stream.source === 'thetvapp' ? 'servers' : 'feeds'}${hasSkycast ? ' · SkyCast' : ''}</span>` : ''}
                  ${altMatches
                    .map(
                      (alt) => `
                    <button
                      class="watch-alt-source-btn"
                      type="button"
                      data-watch-alt-load="${escapeHtml(alt.match.id)}"
                      data-watch-alt-source="${escapeHtml(alt.meta.id)}"
                      title="Watch this matchup using ${escapeHtml(alt.meta.label)} in Slot #${watchActiveSlot + 1}"
                    >
                      Use ${escapeHtml(alt.meta.label)}
                    </button>
                  `
                    )
                    .join('')}
                </div>

                ${
                  espnEv
                    ? `
                  <div class="watch-espn-match-row">
                    <span>
                      <strong>${escapeHtml(espnEv.away.abbreviation)}</strong> ${espnEv.state === 'pre' ? '' : escapeHtml(espnEv.away.score || '0')}
                      ${espnEv.state === 'pre' ? '@' : '-'}
                      <strong>${escapeHtml(espnEv.home.abbreviation)}</strong> ${espnEv.state === 'pre' ? '' : escapeHtml(espnEv.home.score || '0')}
                    </span>
                    <button class="watch-inline-gc-btn" type="button" data-open-game="${escapeHtml(espnEv.id)}">
                      ${espnEv.statusDetail ? escapeHtml(espnEv.statusDetail) : 'Game Center'} →
                    </button>
                  </div>
                `
                    : ''
                }

                <div class="watch-stream-actions">
                  <button class="md-btn ${isPlaying ? 'md-btn-tonal' : 'md-btn-filled'} watch-action-btn" type="button" data-watch-select="${escapeHtml(stream.id)}" data-watch-source-id="${escapeHtml(stream.source)}">
                    <span class="material-symbols-rounded" style="font-size:17px;">play_arrow</span>
                    ${isPlaying ? `Active (#${playingIdx + 1})` : `Watch in #${watchActiveSlot + 1}`}
                  </button>
                  <button class="md-btn md-btn-outlined watch-add-btn" type="button" data-watch-add="${escapeHtml(stream.id)}" data-watch-source-id="${escapeHtml(stream.source)}" title="Add to next Multiview slot">
                    <span class="material-symbols-rounded" style="font-size:17px;">add_to_queue</span>
                    Multiview
                  </button>
                </div>
              </div>
            </article>
          `;
        })
        .join('')}
    </div>
  `;
}

export function renderWatchView(container, callbacks) {
  const state = getState();
  const allEvents = getAllEspnEvents(state);
  const activeStreams = getStreamsForSource(state);
  const liveCfbCount = activeStreams.filter((s) => s.isCfb && s.isLiveNow).length;

  let shell = container.querySelector(':scope > .watch-view-shell');
  if (!shell) {
    container.innerHTML = `
      <div class="watch-view-shell">
        <div id="watch-toolbar-host"></div>
        <div id="watch-stage-container" class="watch-stage-container">
          <div id="watch-fs-bar-host" class="watch-fs-bar"></div>
          <div id="watch-pip-bar-host" class="watch-pip-bar"></div>
          <div id="watch-stage-host" class="watch-stage-grid"></div>
          <aside id="watch-fs-sidebar-host" class="watch-fs-sidebar" aria-label="Full screen stream selector"></aside>
        </div>
        <section class="md-card watch-catalog-card">
          <div id="watch-catalog-filters-host"></div>
          <div id="watch-catalog-grid-host"></div>
        </section>
      </div>
    `;
    shell = container.querySelector(':scope > .watch-view-shell');
  }

  const toolbarHost = shell.querySelector('#watch-toolbar-host');
  const stageContainer = shell.querySelector('#watch-stage-container');
  const fsBarHost = shell.querySelector('#watch-fs-bar-host');
  let pipBarHost = shell.querySelector('#watch-pip-bar-host');
  if (!pipBarHost && stageContainer) {
    pipBarHost = document.createElement('div');
    pipBarHost.id = 'watch-pip-bar-host';
    pipBarHost.className = 'watch-pip-bar';
    stageContainer.insertBefore(pipBarHost, stageContainer.querySelector('#watch-stage-host'));
  }
  const stageHost = shell.querySelector('#watch-stage-host');
  let fsSidebarHost = shell.querySelector('#watch-fs-sidebar-host');
  if (!fsSidebarHost && stageContainer) {
    fsSidebarHost = document.createElement('aside');
    fsSidebarHost.id = 'watch-fs-sidebar-host';
    fsSidebarHost.className = 'watch-fs-sidebar';
    fsSidebarHost.setAttribute('aria-label', 'Full screen stream selector');
    stageContainer.appendChild(fsSidebarHost);
  }
  const filtersHost = shell.querySelector('#watch-catalog-filters-host');
  const gridHost = shell.querySelector('#watch-catalog-grid-host');

  const maxSlots = Math.max(1, state.watchCount || 1);
  const hasVisibleStream = (state.watchSlots || []).slice(0, maxSlots).some(Boolean);
  const isPip = state.route !== 'watch' && Boolean(state.watchPlayerActive) && hasVisibleStream;
  const isFs = !isPip && Boolean(state.watchFullscreen);
  const showFsSidebar = Boolean(isFs && state.watchFsSidebarOpen);
  if (stageContainer) {
    stageContainer.classList.toggle('is-fullscreen', isFs);
    stageContainer.classList.toggle('has-sidebar-open', showFsSidebar);
    stageContainer.classList.toggle('is-pip-active', isPip);
  }
  document.body.classList.toggle('watch-multistream-fs', isFs);

  // Render Picture-in-Picture mini-player control bar when docked
  if (pipBarHost) {
    pipBarHost.innerHTML = isPip ? buildPipBarMarkup(state) : '';
    if (isPip) {
      pipBarHost.querySelectorAll('[data-pip-slot]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const idx = Number(btn.dataset.pipSlot) || 0;
          setState({
            watchActiveSlot: idx,
            watchPrimarySlot: idx,
            watchPipMinimized: false
          });
        });
      });

      const pipMinBtn = pipBarHost.querySelector('#watch-pip-minimize-btn');
      if (pipMinBtn) {
        pipMinBtn.addEventListener('click', () => {
          setState({ watchPipMinimized: !getState().watchPipMinimized });
        });
      }

      const pipExpandBtn = pipBarHost.querySelector('#watch-pip-expand-btn');
      if (pipExpandBtn) {
        pipExpandBtn.addEventListener('click', () => {
          if (callbacks?.onExpandPipToWatch) {
            callbacks.onExpandPipToWatch();
          } else {
            setState({ route: 'watch', watchPipMinimized: false, watchPlayerActive: true });
            window.scrollTo({ top: 0, behavior: 'auto' });
          }
        });
      }

      const pipCloseBtn = pipBarHost.querySelector('#watch-pip-close-btn');
      if (pipCloseBtn) {
        pipCloseBtn.addEventListener('click', () => {
          setState({
            watchSlots: [null, null, null, null],
            watchActiveSlot: 0,
            watchPlayerActive: false,
            watchPipMinimized: false
          });
        });
      }
    }
  }

  // 1. Update top Multiview toolbar
  toolbarHost.innerHTML = buildToolbarMarkup(state);

  toolbarHost.querySelectorAll('[data-watch-count]').forEach((btn) => {
    btn.addEventListener('click', () => {
      applyWatchCount(btn.dataset.watchCount);
    });
  });

  toolbarHost.querySelectorAll('[data-watch-layout]').forEach((btn) => {
    btn.addEventListener('click', () => {
      setState({ watchLayoutMode: btn.dataset.watchLayout });
    });
  });

  toolbarHost.querySelectorAll('[data-watch-source]').forEach((btn) => {
    btn.addEventListener('click', () => {
      applyWatchSource(btn.dataset.watchSource, callbacks);
    });
  });

  const fullscreenBtn = toolbarHost.querySelector('#watch-fullscreen-btn');
  if (fullscreenBtn) {
    fullscreenBtn.addEventListener('click', () => {
      toggleWatchFullscreen(true);
    });
  }

  // Render floating control bar when in Multistream Full Screen
  if (fsBarHost) {
    fsBarHost.innerHTML = isFs ? buildFullscreenBarMarkup(state, liveCfbCount) : '';
    if (isFs) {
      fsBarHost.querySelectorAll('[data-fs-watch-count]').forEach((btn) => {
        btn.addEventListener('click', () => {
          applyWatchCount(btn.dataset.fsWatchCount);
        });
      });
      fsBarHost.querySelectorAll('[data-fs-watch-mode]').forEach((btn) => {
        btn.addEventListener('click', () => {
          setState({ watchLayoutMode: btn.dataset.fsWatchMode });
        });
      });
      fsBarHost.querySelectorAll('[data-fs-watch-source]').forEach((btn) => {
        btn.addEventListener('click', () => {
          applyWatchSource(btn.dataset.fsWatchSource, callbacks);
        });
      });
      const fsSidebarToggleBtn = fsBarHost.querySelector('#watch-fs-sidebar-toggle-btn');
      if (fsSidebarToggleBtn) {
        fsSidebarToggleBtn.addEventListener('click', () => {
          setState({ watchFsSidebarOpen: !getState().watchFsSidebarOpen });
        });
      }
      const exitFsBtn = fsBarHost.querySelector('#watch-fs-exit-btn');
      if (exitFsBtn) {
        exitFsBtn.addEventListener('click', () => {
          toggleWatchFullscreen(false);
        });
      }
    }
  }

  // Render collapsible in-fullscreen sidebar so users can add/switch streams without exiting Full Screen
  if (fsSidebarHost) {
    fsSidebarHost.classList.toggle('is-open', showFsSidebar);
    const savedFsSearchFocus = captureInputFocusState(fsSidebarHost.querySelector('#watch-fs-stream-search'));
    const prevFsListScroll = fsSidebarHost.querySelector('.watch-fs-sidebar-list')?.scrollTop ?? null;
    fsSidebarHost.innerHTML = showFsSidebar ? buildFullscreenSidebarMarkup(state, allEvents) : '';
    if (showFsSidebar) {
      const nextFsList = fsSidebarHost.querySelector('.watch-fs-sidebar-list');
      if (nextFsList && prevFsListScroll !== null) {
        nextFsList.scrollTop = prevFsListScroll;
      }
      const closeSidebarBtn = fsSidebarHost.querySelector('#watch-fs-sidebar-close-btn');
      if (closeSidebarBtn) {
        closeSidebarBtn.addEventListener('click', () => {
          setState({ watchFsSidebarOpen: false });
        });
      }

      fsSidebarHost.querySelectorAll('[data-fs-watch-source]').forEach((btn) => {
        btn.addEventListener('click', () => {
          applyWatchSource(btn.dataset.fsWatchSource, callbacks);
        });
      });

      fsSidebarHost.querySelectorAll('[data-fs-target-slot]').forEach((btn) => {
        btn.addEventListener('click', () => {
          setState({ watchActiveSlot: Number(btn.dataset.fsTargetSlot) || 0 });
        });
      });

      const addSlotBtn = fsSidebarHost.querySelector('#watch-fs-add-slot-btn');
      if (addSlotBtn) {
        addSlotBtn.addEventListener('click', () => {
          const nextCount = Math.min(4, getState().watchCount + 1);
          applyWatchCount(nextCount);
          setState({ watchActiveSlot: nextCount - 1 });
        });
      }

      fsSidebarHost.querySelectorAll('[data-fs-cat]').forEach((btn) => {
        btn.addEventListener('click', () => {
          setState({ watchCategoryFilter: btn.dataset.fsCat });
        });
      });

      const fsSearchInput = fsSidebarHost.querySelector('#watch-fs-stream-search');
      if (fsSearchInput) {
        restoreInputFocusState(fsSearchInput, savedFsSearchFocus);
        fsSearchInput.addEventListener('input', (e) => {
          setState({ watchSearchQuery: e.target.value });
        });
      }

      fsSidebarHost.querySelectorAll('[data-fs-stream-select]').forEach((btn) => {
        btn.addEventListener('click', () => {
          selectStreamIntoTargetSlot(btn.dataset.fsStreamSelect, btn.dataset.fsStreamSource);
        });
      });

      fsSidebarHost.querySelectorAll('[data-fs-stream-add]').forEach((btn) => {
        btn.addEventListener('click', () => {
          addStreamToMultiview(btn.dataset.fsStreamAdd, btn.dataset.fsStreamSource);
        });
      });
    }
  }

  const clearBtn = toolbarHost.querySelector('#watch-clear-btn');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      setState({
        watchSlots: [null, null, null, null],
        watchActiveSlot: 0,
        watchPlayerActive: false,
        watchPipMinimized: false
      });
    });
  }

  // 2. Reconcile Multi-Stream Video Stage while preserving untouched iframes
  reconcileVideoStage(stageHost, state, allEvents, callbacks);

  // 3. Catalog Filter Bar (preserve search input focus if user is typing)
  const savedSearchFocus = captureInputFocusState(filtersHost.querySelector('#watch-stream-search'));

  filtersHost.innerHTML = buildCatalogControlsMarkup(state);

  filtersHost.querySelectorAll('[data-watch-source]').forEach((btn) => {
    btn.addEventListener('click', () => {
      applyWatchSource(btn.dataset.watchSource, callbacks);
    });
  });

  filtersHost.querySelectorAll('[data-catalog-target]').forEach((btn) => {
    btn.addEventListener('click', () => {
      setState({ watchActiveSlot: Number(btn.dataset.catalogTarget) || 0 });
    });
  });

  filtersHost.querySelectorAll('[data-watch-cat]').forEach((btn) => {
    btn.addEventListener('click', () => {
      setState({ watchCategoryFilter: btn.dataset.watchCat });
    });
  });

  const newSearchInput = filtersHost.querySelector('#watch-stream-search');
  if (newSearchInput) {
    restoreInputFocusState(newSearchInput, savedSearchFocus);
    newSearchInput.addEventListener('input', (e) => {
      setState({ watchSearchQuery: e.target.value });
    });
  }

  // 4. Stream Directory Grid
  gridHost.innerHTML = buildCatalogGridMarkup(state, allEvents, callbacks);

  const retryBtn = gridHost.querySelector('#watch-retry-btn');
  if (retryBtn) {
    retryBtn.addEventListener('click', () => callbacks.onRetryWatchStreams?.(getState().watchSource));
  }

  gridHost.querySelectorAll('[data-open-game]').forEach((btn) => {
    btn.addEventListener('click', () => {
      callbacks.onOpenGameSheet?.(btn.dataset.openGame);
    });
  });

  gridHost.querySelectorAll('[data-watch-select]').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectStreamIntoTargetSlot(btn.dataset.watchSelect, btn.dataset.watchSourceId);
    });
  });

  gridHost.querySelectorAll('[data-watch-add]').forEach((btn) => {
    btn.addEventListener('click', () => {
      addStreamToMultiview(btn.dataset.watchAdd, btn.dataset.watchSourceId);
    });
  });

  gridHost.querySelectorAll('[data-watch-alt-load]').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectStreamIntoTargetSlot(btn.dataset.watchAltLoad, btn.dataset.watchAltSource);
    });
  });
}
