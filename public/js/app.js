import {
  getScoreboard,
  getStandingsAndRankings,
  getWeeklyRankings,
  getTeamsDirectory,
  buildTeamsCatalog,
  getTeamPageData,
  getSeasonResultsGraph,
  getPpvStreams,
  getTimStreams,
  getStrmFreeStreams,
  findStreamForEspnEvent
} from './api.js';
import { getState, setState, subscribe } from './store.js';
import { renderScheduleView } from './views/scheduleView.js';
import { renderLiveView, refreshLiveDetailPaneOnly } from './views/liveView.js';
import { renderStandingsView } from './views/standingsView.js';
import { renderRankingsView } from './views/rankingsView.js';
import { renderTeamsView } from './views/teamsView.js';
import { renderTransitiveView } from './views/transitiveView.js';
import { renderWatchView, toggleWatchFullscreen, openStreamInWatch } from './views/watchView.js';
import { mountGameDetail } from './views/gameDetail.js';
import { showSnackbar } from './ui.js';

const appViewEl = document.getElementById('app-view');
const watchRootEl = document.getElementById('watch-persistent-root');
const topSubtitleEl = document.getElementById('top-subtitle');
const searchInputEl = document.getElementById('global-search');
const searchClearBtn = document.getElementById('search-clear-btn');
const autoRefreshBtn = document.getElementById('auto-refresh-btn');
const autoRefreshDot = document.getElementById('auto-refresh-dot');
const autoRefreshLabel = document.getElementById('auto-refresh-label');
const refreshBtn = document.getElementById('refresh-btn');
const themeToggleBtn = document.getElementById('theme-toggle');
const themeIconEl = document.getElementById('theme-icon');
const navBackBtn = document.getElementById('nav-back-btn');
const liveNavBadge = document.getElementById('live-nav-badge');
const liveMobileBadge = document.getElementById('live-mobile-badge');
const watchNavBadge = document.getElementById('watch-count-badge');
const watchMobileBadge = document.getElementById('watch-count-badge-mobile');

const sheetEl = document.getElementById('game-sheet');
const sheetBackdropEl = document.getElementById('game-sheet-backdrop');
const sheetTitleEl = document.getElementById('sheet-title');
const sheetBodyEl = document.getElementById('game-sheet-body');
const sheetCloseBtn = document.getElementById('sheet-close-btn');

let pollTimer = null;
let lastScheduleLoadKey = '';
let lastLiveSelectedRendered = null;
let lastRenderedRoute = null;
let lastRenderedTeamId = null;
let teamsDirectoryPromise = null;
let transitiveGraphPromise = null;
let activeTeamRequestToken = 0;
let activeRankingsRequestToken = 0;
let watchAutoPopulated = false;
let lastPpvFetchAt = 0;

const MAX_LINK_HISTORY = 25;
const linkHistoryStack = [];

function describePageLabel(state) {
  if (!state) return 'Previous Page';
  if (state.route === 'teams') {
    if (state.selectedTeamId) {
      return (
        state.teamPageData?.team?.shortName ||
        state.teamPageData?.team?.displayName ||
        state.teamsById?.[String(state.selectedTeamId)]?.shortName ||
        'Team Page'
      );
    }
    return 'Teams';
  }
  if (state.route === 'live') return 'Live';
  if (state.route === 'watch') return 'Watch';
  if (state.route === 'standings') return 'Standings';
  if (state.route === 'rankings') return 'Rankings';
  if (state.route === 'transitive') {
    return state.transitiveMode === 'farthest' ? 'Farthest Chains' : 'Transitive W/Ls';
  }
  return 'Schedule';
}

function getHistoryPatch() {
  const len = linkHistoryStack.length;
  return {
    canGoBack: len > 0,
    backPageLabel: len > 0 ? linkHistoryStack[len - 1].label : ''
  };
}

function pushLinkHistorySnapshot(prevState = getState()) {
  if (!prevState) return;
  const snapshot = {
    route: prevState.route || 'schedule',
    label: describePageLabel(prevState),
    scrollX: window.scrollX || window.pageXOffset || 0,
    scrollY: window.scrollY || window.pageYOffset || 0,
    group: prevState.group,
    seasonType: prevState.seasonType,
    selectedWeek: prevState.selectedWeek,
    scheduleFilter: prevState.scheduleFilter
      ? { ...prevState.scheduleFilter }
      : { status: 'all', top25Only: false, conferenceId: 'all' },
    liveDivision: prevState.liveDivision,
    liveSelectedEventId: prevState.liveSelectedEventId,
    liveMasterScrollTop: appViewEl.querySelector('.live-master-pane')?.scrollTop || 0,
    selectedConferenceId: prevState.selectedConferenceId,
    rankingsSeason: prevState.rankingsSeason,
    rankingsWeekKey: prevState.rankingsWeekKey,
    rankingsViewMode: prevState.rankingsViewMode,
    rankingsConferenceFilter: prevState.rankingsConferenceFilter,
    selectedTeamId: prevState.selectedTeamId ? String(prevState.selectedTeamId) : null,
    teamSelectedSeason: prevState.teamSelectedSeason,
    teamScheduleFilter: prevState.teamScheduleFilter || 'all',
    teamStatsCategory: prevState.teamStatsCategory || 'all',
    teamPageData: prevState.teamPageData || null,
    transitiveMode: prevState.transitiveMode || 'matchup',
    transitiveTeamAId: prevState.transitiveTeamAId || null,
    transitiveTeamBId: prevState.transitiveTeamBId || null,
    transitiveFarthestTargetScope: prevState.transitiveFarthestTargetScope || 'fbs_fcs',
    transitiveFarthestSchoolDiv: prevState.transitiveFarthestSchoolDiv || 'all',
    transitiveFarthestSort: prevState.transitiveFarthestSort || 'win_desc',
    transitiveExpandedSchoolIds: Array.isArray(prevState.transitiveExpandedSchoolIds)
      ? [...prevState.transitiveExpandedSchoolIds]
      : [],
    sheetEventId: prevState.sheetEventId ? String(prevState.sheetEventId) : null,
    sheetTitle: prevState.sheetEventId && sheetTitleEl ? sheetTitleEl.textContent : ''
  };
  linkHistoryStack.push(snapshot);
  if (linkHistoryStack.length > MAX_LINK_HISTORY) {
    linkHistoryStack.shift();
  }
}

function clearLinkHistory() {
  linkHistoryStack.length = 0;
}

async function goBackToPreviousPage() {
  if (linkHistoryStack.length === 0) return;
  const cur = getState();
  if (cur.watchFullscreen) {
    toggleWatchFullscreen(false);
  }
  ++activeTeamRequestToken;

  const snap = linkHistoryStack.pop();
  if (cur.sheetEventId && !snap.sheetEventId) {
    closeGameSheet();
  }

  setState({
    route: snap.route,
    group: snap.group,
    seasonType: snap.seasonType,
    selectedWeek: snap.selectedWeek,
    scheduleFilter: snap.scheduleFilter,
    liveDivision: snap.liveDivision,
    liveSelectedEventId: snap.liveSelectedEventId,
    selectedConferenceId: snap.selectedConferenceId,
    rankingsSeason: snap.rankingsSeason,
    rankingsWeekKey: snap.rankingsWeekKey,
    rankingsViewMode: snap.rankingsViewMode,
    rankingsConferenceFilter: snap.rankingsConferenceFilter,
    selectedTeamId: snap.selectedTeamId,
    teamSelectedSeason: snap.teamSelectedSeason,
    teamScheduleFilter: snap.teamScheduleFilter,
    teamStatsCategory: snap.teamStatsCategory,
    teamPageData: snap.teamPageData,
    teamPageLoading: false,
    teamPageError: null,
    transitiveMode: snap.transitiveMode,
    transitiveTeamAId: snap.transitiveTeamAId,
    transitiveTeamBId: snap.transitiveTeamBId,
    transitiveFarthestTargetScope: snap.transitiveFarthestTargetScope,
    transitiveFarthestSchoolDiv: snap.transitiveFarthestSchoolDiv,
    transitiveFarthestSort: snap.transitiveFarthestSort,
    transitiveExpandedSchoolIds: snap.transitiveExpandedSchoolIds,
    ...getHistoryPatch()
  });

  const restoreScrolls = () => {
    if (snap.route === 'live') {
      const masterPane = appViewEl.querySelector('.live-master-pane');
      if (masterPane && Number.isFinite(snap.liveMasterScrollTop)) {
        masterPane.scrollTop = snap.liveMasterScrollTop;
      }
    }
    window.scrollTo({ left: snap.scrollX || 0, top: snap.scrollY || 0, behavior: 'auto' });
  };

  restoreScrolls();
  requestAnimationFrame(restoreScrolls);

  if (snap.route === 'teams' && snap.selectedTeamId && !snap.teamPageData) {
    await openTeamPage(snap.selectedTeamId, { season: snap.teamSelectedSeason, recordHistory: false });
    restoreScrolls();
  } else if (snap.route === 'schedule') {
    const targetKey = `${snap.group}:${snap.seasonType}:${snap.selectedWeek}`;
    if (lastScheduleLoadKey !== targetKey) {
      await loadScoreboard({ group: snap.group, seasonType: snap.seasonType, week: snap.selectedWeek, force: false });
      restoreScrolls();
    }
  }

  if (snap.sheetEventId) {
    openGameSheet(snap.sheetEventId, snap.sheetTitle);
  }
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('cfb-theme', theme);
  if (themeIconEl) {
    themeIconEl.textContent = theme === 'dark' ? 'light_mode' : 'dark_mode';
  }
  setState({ theme });
}

function initTheme() {
  const saved = localStorage.getItem('cfb-theme');
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = saved === 'dark' || saved === 'light' ? saved : prefersDark ? 'dark' : 'light';
  applyTheme(theme);
}

function updateChrome(state) {
  // Back to previous page button
  if (navBackBtn) {
    navBackBtn.classList.toggle('hidden', !state.canGoBack);
    navBackBtn.title = state.backPageLabel
      ? `Back to Previous Page (${state.backPageLabel})`
      : 'Back to Previous Page';
  }

  // Navigation active states
  document.querySelectorAll('[data-nav]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.nav === state.route);
  });

  // Live count badges
  const liveCount = state.liveEvents.filter((e) => e.state === 'in').length;
  [liveNavBadge, liveMobileBadge].forEach((badge) => {
    if (!badge) return;
    if (liveCount > 0) {
      badge.textContent = String(liveCount);
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  });

  // Watch live CFB count badges
  const activeWatchStreams =
    state.watchSource === 'timstreams'
      ? state.timStreams || []
      : state.watchSource === 'strmfree'
        ? state.strmFreeStreams || []
        : state.ppvStreams || [];
  const watchCfbCount = activeWatchStreams.filter((s) => s.isCfb && s.isLiveNow).length;
  [watchNavBadge, watchMobileBadge].forEach((badge) => {
    if (!badge) return;
    if (watchCfbCount > 0) {
      badge.textContent = String(watchCfbCount);
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  });

  // Auto-refresh button
  if (autoRefreshBtn) {
    autoRefreshBtn.classList.toggle('enabled', state.autoRefresh);
  }
  if (autoRefreshDot) {
    autoRefreshDot.classList.toggle('live', state.autoRefresh && liveCount > 0);
  }
  if (autoRefreshLabel) {
    autoRefreshLabel.textContent = state.autoRefresh ? 'Auto 15s' : 'Paused';
  }

  // Top bar subtitle
  if (topSubtitleEl) {
    const phaseLabel = state.seasonType === '3' ? 'Postseason' : 'Regular Season';
    const weekEntries = state.seasonType === '3' ? state.calendar.postseason : state.calendar.regular;
    const wkObj = weekEntries.find((w) => String(w.value) === String(state.selectedWeek));
    const wkText = wkObj ? wkObj.label : state.selectedWeek ? `Week ${state.selectedWeek}` : 'Loading...';
    const divText = state.group === '81' ? 'FCS' : 'FBS';
    const updatedText = state.lastUpdated
      ? ` · Updated ${new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(new Date(state.lastUpdated))}`
      : '';
    if (state.route === 'standings') {
      topSubtitleEl.textContent = `${state.currentSeasonYear || ''} Conference Standings${updatedText}`;
    } else if (state.route === 'rankings') {
      const yr = state.rankingsSeason || state.currentSeasonYear || '';
      const wkLabel = state.rankingsData?.activeWeekLabel || 'Latest Rankings';
      topSubtitleEl.textContent = `${yr} CFP & AP Top 25 Rankings · ${wkLabel}${updatedText}`;
    } else if (state.route === 'live') {
      topSubtitleEl.textContent = `${state.liveDivision === '81' ? 'FCS' : 'FBS'} Live & Play-by-Play${updatedText}`;
    } else if (state.route === 'watch') {
      const visibleSlots = (state.watchSlots || []).slice(0, state.watchCount).filter(Boolean);
      const playingNow = visibleSlots.length;
      const sourceLabelForId = (srcId) =>
        srcId === 'timstreams' ? 'tim-streams.com' : srcId === 'strmfree' ? 'strmfree.pk' : 'ppv.st';
      const slotSourceLabels = Array.from(
        new Set(visibleSlots.map((s) => sourceLabelForId(s.source)))
      );
      const activeSourceText =
        slotSourceLabels.length > 0
          ? slotSourceLabels.join(' + ')
          : sourceLabelForId(state.watchSource);
      topSubtitleEl.textContent = `Live Multi-Stream Video Center · ${playingNow} active via ${activeSourceText}${updatedText}`;
    } else if (state.route === 'teams') {
      if (state.selectedTeamId) {
        const tName =
          state.teamPageData?.team?.displayName ||
          state.teamsById[String(state.selectedTeamId)]?.displayName ||
          'Team Page';
        topSubtitleEl.textContent = `${tName} · ${state.teamSelectedSeason || state.currentSeasonYear || ''} Schedule & Team Stats`;
      } else {
        const countLabel = state.teamsDirectory.length ? `${state.teamsDirectory.length} ` : '';
        topSubtitleEl.textContent = `${countLabel}NCAA Football Teams Directory`;
      }
    } else if (state.route === 'transitive') {
      const yr = state.transitiveSeasonGraph?.seasonYear || state.currentSeasonYear || '';
      const count = state.transitiveSeasonGraph?.completedCount;
      const countText = Number.isFinite(count) ? ` · ${count} completed games` : '';
      topSubtitleEl.textContent = `${yr} Transitive Wins & Losses Explorer${countText}${updatedText}`;
    } else {
      topSubtitleEl.textContent = `${state.currentSeasonYear || ''} ${divText} ${phaseLabel} · ${wkText}${updatedText}`;
    }
  }
}

async function loadScoreboard({ seasonType = null, week = null, group = null, force = false, silent = false } = {}) {
  const prev = getState();
  const nextGroup = group || prev.group || '80';
  const nextSeasonType = seasonType !== null ? seasonType : prev.selectedWeek ? prev.seasonType : null;
  const nextWeek = week !== null ? week : prev.selectedWeek;

  if (!silent || prev.scoreboardEvents.length === 0) {
    setState({ scoreboardLoading: true, scoreboardError: null });
  }

  try {
    const data = await getScoreboard({
      seasonType: nextSeasonType,
      week: nextWeek,
      group: nextGroup,
      force
    });

    const isInitialLoad = !prev.currentWeekNumber;
    const resolvedSeasonType = nextSeasonType || data.season.type;
    const resolvedWeek = nextWeek || data.week.number;
    const currentIsSame =
      String(resolvedSeasonType) === String(prev.currentSeasonType || data.season.type) &&
      String(resolvedWeek) === String(prev.currentWeekNumber || data.week.number) &&
      String(nextGroup) === String(prev.liveDivision);

    const patch = {
      group: nextGroup,
      seasonType: resolvedSeasonType,
      selectedWeek: resolvedWeek,
      currentSeasonYear: isInitialLoad ? data.season.year : prev.currentSeasonYear || data.season.year,
      currentSeasonType: isInitialLoad ? data.season.type : prev.currentSeasonType || data.season.type,
      currentWeekNumber: isInitialLoad ? data.week.number : prev.currentWeekNumber || data.week.number,
      calendar: data.calendar.regular.length ? data.calendar : prev.calendar,
      scoreboardEvents: data.events,
      scoreboardLoading: false,
      scoreboardError: null,
      lastUpdated: Date.now()
    };

    if (isInitialLoad || currentIsSame) {
      patch.liveEvents = data.events;
      patch.liveLoading = false;
    }

    lastScheduleLoadKey = `${nextGroup}:${resolvedSeasonType}:${resolvedWeek}`;
    setState(patch);
  } catch (err) {
    setState({
      scoreboardLoading: false,
      scoreboardError: err.message || 'Failed to load ESPN scoreboard'
    });
  }
}

async function loadLiveSlate({ force = false, silent = false } = {}) {
  const state = getState();
  if (!silent && state.liveEvents.length === 0) {
    setState({ liveLoading: true });
  }
  try {
    const data = await getScoreboard({ group: state.liveDivision, force });
    setState({
      liveEvents: data.events,
      liveLoading: false,
      currentSeasonYear: state.currentSeasonYear || data.season.year,
      currentSeasonType: state.currentSeasonType || data.season.type,
      currentWeekNumber: state.currentWeekNumber || data.week.number,
      lastUpdated: Date.now()
    });
  } catch (err) {
    setState({ liveLoading: false });
    if (!silent) {
      showSnackbar(`Refresh error: ${err.message}`);
    }
  }
}

async function loadStandings({ force = false } = {}) {
  setState({ standingsLoading: true, standingsError: null });
  try {
    const data = await getStandingsAndRankings({ force });
    const prev = getState();
    const nextPatch = {
      conferences: data.conferences,
      conferenceMap: data.conferenceMap,
      rankMap: data.rankMap,
      pollName: data.pollName,
      standingsLoading: false,
      standingsError: null
    };
    if (prev.teamsRaw.length > 0) {
      const catalog = buildTeamsCatalog(
        prev.teamsRaw,
        data.conferences,
        prev.fcsConferences,
        data.rankMap
      );
      nextPatch.teamsDirectory = catalog.teamsDirectory;
      nextPatch.teamsById = catalog.teamsById;
    }
    setState(nextPatch);
  } catch (err) {
    setState({
      standingsLoading: false,
      standingsError: err.message || 'Failed to load ESPN standings'
    });
  }
}

async function loadRankings({ season = null, week = null, seasonType = null, force = false } = {}) {
  const reqToken = ++activeRankingsRequestToken;
  setState({ rankingsLoading: true, rankingsError: null });
  if (getState().teamsRaw.length === 0) {
    loadTeamsDirectory({ force: false });
  }
  try {
    const data = await getWeeklyRankings({ season, week, seasonType, force });
    if (reqToken !== activeRankingsRequestToken) {
      return;
    }
    const prev = getState();
    const resolvedWeeks =
      prev.rankingsSeason === data.seasonYear &&
      prev.rankingsWeeks.length > data.weeks.length &&
      data.weeks.length <= 1
        ? prev.rankingsWeeks
        : data.weeks;

    const shouldSetLatest = !week && !seasonType;
    const rankingsLatestWeekKey = shouldSetLatest
      ? data.activeWeekKey
      : prev.rankingsSeason === data.seasonYear && prev.rankingsLatestWeekKey
        ? prev.rankingsLatestWeekKey
        : resolvedWeeks[resolvedWeeks.length - 1]?.key || data.activeWeekKey;

    setState({
      rankingsSeason: data.seasonYear,
      rankingsWeekKey: data.activeWeekKey,
      rankingsLatestWeekKey,
      rankingsWeeks: resolvedWeeks,
      rankingsData: data,
      rankingsLoading: false,
      rankingsError: null,
      lastUpdated: Date.now()
    });
  } catch (err) {
    if (reqToken !== activeRankingsRequestToken) {
      return;
    }
    setState({
      rankingsLoading: false,
      rankingsError: err.message || 'Failed to load ESPN rankings'
    });
  }
}

async function loadTeamsDirectory({ force = false } = {}) {
  if (teamsDirectoryPromise && !force) {
    return teamsDirectoryPromise;
  }

  setState({ teamsLoading: true, teamsError: null });
  teamsDirectoryPromise = (async () => {
    try {
      const { rawTeams, fcsConferences } = await getTeamsDirectory({ force });
      const cur = getState();
      const catalog = buildTeamsCatalog(rawTeams, cur.conferences, fcsConferences, cur.rankMap);
      setState({
        teamsRaw: rawTeams,
        fcsConferences,
        teamsDirectory: catalog.teamsDirectory,
        teamsById: catalog.teamsById,
        teamsLoading: false,
        teamsError: null
      });
    } catch (err) {
      setState({
        teamsLoading: false,
        teamsError: err.message || 'Failed to load NCAA teams directory'
      });
    } finally {
      teamsDirectoryPromise = null;
    }
  })();

  return teamsDirectoryPromise;
}

async function loadTransitiveSeasonGraph({ season = null, force = false } = {}) {
  if (transitiveGraphPromise && !force) {
    return transitiveGraphPromise;
  }

  setState({ transitiveLoading: true, transitiveError: null });
  transitiveGraphPromise = (async () => {
    try {
      const graph = await getSeasonResultsGraph({ season, force });
      setState({
        transitiveSeasonGraph: graph,
        transitiveLoading: false,
        transitiveError: null
      });
    } catch (err) {
      setState({
        transitiveLoading: false,
        transitiveError: err.message || 'Failed to load season game results'
      });
    } finally {
      transitiveGraphPromise = null;
    }
  })();

  return transitiveGraphPromise;
}

async function openTeamPage(teamId, { season = null, force = false, recordHistory = true } = {}) {
  if (!teamId || /^-\d+$/.test(String(teamId))) return;
  const targetId = String(teamId);
  const reqToken = ++activeTeamRequestToken;
  const prev = getState();

  const shouldPushHistory =
    recordHistory &&
    !(prev.route === 'teams' && String(prev.selectedTeamId || '') === targetId && !prev.sheetEventId);
  if (shouldPushHistory) {
    pushLinkHistorySnapshot(prev);
  }

  if (prev.sheetEventId) {
    closeGameSheet();
  }
  if (prev.watchFullscreen) {
    toggleWatchFullscreen(false);
  }

  const defaultSeason = prev.currentSeasonYear || new Date().getFullYear();
  const isSameTeam = String(prev.selectedTeamId) === targetId;
  const resolvedSeason = Number(season) || (isSameTeam && prev.teamSelectedSeason ? prev.teamSelectedSeason : defaultSeason);

  if (prev.teamsRaw.length === 0) {
    loadTeamsDirectory({ force: false });
  }

  setState({
    route: 'teams',
    selectedTeamId: targetId,
    teamSelectedSeason: resolvedSeason,
    teamScheduleFilter: isSameTeam ? prev.teamScheduleFilter : 'all',
    teamPageData: isSameTeam ? prev.teamPageData : null,
    teamPageLoading: true,
    teamPageError: null,
    ...getHistoryPatch()
  });
  window.scrollTo({ top: 0, behavior: 'auto' });

  try {
    const data = await getTeamPageData(targetId, { season: resolvedSeason, force });
    if (reqToken !== activeTeamRequestToken || String(getState().selectedTeamId) !== targetId) {
      return;
    }
    setState({
      teamPageData: data,
      teamSelectedSeason: data.seasonYear,
      teamPageLoading: false,
      teamPageError: null
    });
  } catch (err) {
    if (reqToken !== activeTeamRequestToken || String(getState().selectedTeamId) !== targetId) {
      return;
    }
    setState({
      teamPageLoading: false,
      teamPageError: err.message || 'Failed to load team details'
    });
  }
}

function findEventById(eventId) {
  const s = getState();
  return (
    s.scoreboardEvents.find((e) => e.id === String(eventId)) ||
    s.liveEvents.find((e) => e.id === String(eventId)) ||
    s.teamPageData?.events?.find((e) => e.id === String(eventId)) ||
    null
  );
}

function openGameSheet(eventId, titleHint = '') {
  if (document.fullscreenElement) {
    toggleWatchFullscreen(false);
  }
  const ev = findEventById(eventId);
  setState({ sheetEventId: String(eventId) });

  if (sheetTitleEl) {
    sheetTitleEl.textContent = ev ? ev.shortName : titleHint || 'Game Center';
  }
  sheetBackdropEl.classList.add('open');
  sheetBackdropEl.setAttribute('aria-hidden', 'false');
  sheetEl.classList.add('open');
  sheetEl.setAttribute('aria-hidden', 'false');

  sheetBodyEl.dataset.targetEventId = String(eventId);
  mountGameDetail(sheetBodyEl, eventId, { eventPreview: ev, force: false, showSkeleton: true });
}

function closeGameSheet() {
  setState({ sheetEventId: null });
  sheetBackdropEl.classList.remove('open');
  sheetBackdropEl.setAttribute('aria-hidden', 'true');
  sheetEl.classList.remove('open');
  sheetEl.setAttribute('aria-hidden', 'true');
}

function findStreamByHints(state, streamId, streamSource) {
  if (!streamId) return null;
  const idStr = String(streamId);
  if (streamSource) {
    const srcList =
      streamSource === 'timstreams'
        ? state.timStreams || []
        : streamSource === 'strmfree'
          ? state.strmFreeStreams || []
          : state.ppvStreams || [];
    const found = srcList.find((s) => String(s.id) === idStr);
    if (found) return found;
  }
  const all = [
    ...(state.ppvStreams || []),
    ...(state.timStreams || []),
    ...(state.strmFreeStreams || [])
  ];
  return all.find((s) => String(s.id) === idStr) || null;
}

async function openWatchForEvent({ eventId, streamId = null, streamSource = null }) {
  const curBefore = getState();
  if (curBefore.route !== 'watch' || curBefore.sheetEventId) {
    pushLinkHistorySnapshot(curBefore);
  }
  if (curBefore.sheetEventId) {
    closeGameSheet();
  }
  if (curBefore.watchFullscreen) {
    toggleWatchFullscreen(false);
  }

  const hasAnyStreams =
    (curBefore.ppvStreams?.length || 0) > 0 ||
    (curBefore.timStreams?.length || 0) > 0 ||
    (curBefore.strmFreeStreams?.length || 0) > 0;

  if (!hasAnyStreams) {
    await loadWatchStreams({ force: false, silent: true });
  }

  const stateNow = getState();
  const ev = eventId ? findEventById(eventId) : null;
  const stream =
    findStreamByHints(stateNow, streamId, streamSource) ||
    (ev ? findStreamForEspnEvent(ev, stateNow) : null);

  if (stream) {
    watchAutoPopulated = true;
    const res = openStreamInWatch(stream);
    setState(getHistoryPatch());
    window.scrollTo({ top: 0, behavior: 'auto' });
    const slotNum = res ? res.slotIndex + 1 : 1;
    showSnackbar(`Loaded ${stream.name} (${stream.sourceLabel}) in Slot #${slotNum}`);
    return;
  }

  setState({ route: 'watch', watchPipMinimized: false, ...getHistoryPatch() });
  window.scrollTo({ top: 0, behavior: 'auto' });
  showSnackbar(
    ev?.shortName || ev?.name
      ? `No direct stream match for ${ev.shortName || ev.name} — browse available streams`
      : 'Browse available live streams below'
  );
}

const scheduleCallbacks = {
  onChangeScheduleParams({ group, seasonType, week }) {
    const cur = getState();
    const g = group ?? cur.group;
    const st = seasonType ?? cur.seasonType;
    const w = week ?? cur.selectedWeek;
    loadScoreboard({ group: g, seasonType: st, week: w, force: false });
  },
  onRetrySchedule() {
    loadScoreboard({ force: true });
  },
  onOpenGameSheet(eventId) {
    openGameSheet(eventId);
  }
};

const liveCallbacks = {
  onChangeLiveDivision(div) {
    setState({ liveDivision: div, liveSelectedEventId: null });
    loadLiveSlate({ force: true });
  }
};

const standingsCallbacks = {
  onRetryStandings() {
    loadStandings({ force: true });
  }
};

const rankingsCallbacks = {
  onSelectWeek(seasonType, week) {
    loadRankings({
      season: getState().rankingsSeason,
      seasonType,
      week,
      force: false
    });
  },
  onChangeSeason(season) {
    loadRankings({ season, week: null, seasonType: null, force: false });
  },
  onJumpLatest() {
    loadRankings({
      season: getState().rankingsSeason,
      week: null,
      seasonType: null,
      force: false
    });
  },
  onRetryRankings() {
    const cur = getState();
    const parts = cur.rankingsWeekKey ? cur.rankingsWeekKey.split(':') : [];
    const seasonType = parts.length === 2 ? parts[0] : null;
    const week = parts.length === 2 ? parts[1] : null;
    loadRankings({ season: cur.rankingsSeason, seasonType, week, force: true });
  }
};

const teamsCallbacks = {
  onRetryDirectory() {
    loadTeamsDirectory({ force: true });
  },
  onOpenTeam(teamId, season = null, opts = {}) {
    openTeamPage(teamId, { season, ...opts });
  },
  onChangeSeason(teamId, seasonYear) {
    openTeamPage(teamId, { season: seasonYear, force: false, recordHistory: false });
  },
  onBackToDirectory() {
    const top = linkHistoryStack[linkHistoryStack.length - 1];
    if (top && top.route === 'teams' && !top.selectedTeamId) {
      linkHistoryStack.pop();
    }
    setState({ selectedTeamId: null, teamPageError: null, ...getHistoryPatch() });
    window.scrollTo({ top: 0, behavior: 'auto' });
  },
  onOpenGameSheet(eventId) {
    openGameSheet(eventId);
  }
};

const transitiveCallbacks = {
  onSelectTeams({ teamAId, teamBId }) {
    setState({
      transitiveTeamAId: teamAId ? String(teamAId) : null,
      transitiveTeamBId: teamBId ? String(teamBId) : null
    });
  },
  onUpdateTransitiveState(patch) {
    setState(patch);
  },
  onNavigateToMatchup({ teamAId, teamBId }) {
    pushLinkHistorySnapshot(getState());
    setState({
      route: 'transitive',
      transitiveMode: 'matchup',
      transitiveTeamAId: teamAId ? String(teamAId) : null,
      transitiveTeamBId: teamBId ? String(teamBId) : null,
      ...getHistoryPatch()
    });
    window.scrollTo({ top: 0, behavior: 'auto' });
  },
  onRetrySeasonGraph() {
    loadTransitiveSeasonGraph({ force: true });
  },
  onOpenGameSheet(eventId, shortName = '') {
    openGameSheet(eventId, shortName);
  }
};

const watchCallbacks = {
  onExpandPipToWatch() {
    const cur = getState();
    if (cur.route !== 'watch') {
      pushLinkHistorySnapshot(cur);
    }
    setState({
      route: 'watch',
      watchPipMinimized: false,
      watchPlayerActive: true,
      ...getHistoryPatch()
    });
    window.scrollTo({ top: 0, behavior: 'auto' });
  },
  onRetryPpv() {
    loadWatchStreams({ force: true });
  },
  onRetryWatchStreams(sourceId = null) {
    if (sourceId === 'timstreams') {
      loadTimStreams({ force: true });
    } else if (sourceId === 'strmfree') {
      loadStrmFreeStreams({ force: true });
    } else if (sourceId === 'ppv') {
      loadPpvStreams({ force: true });
    } else {
      loadWatchStreams({ force: true });
    }
  },
  onOpenGameSheet(eventId) {
    openGameSheet(eventId);
  }
};

function hasActiveWatchStreams(state) {
  const maxSlots = Math.max(1, state?.watchCount || 1);
  return (state?.watchSlots || []).slice(0, maxSlots).some(Boolean);
}

function buildInitialWatchSlotPatch(streams, cur, expectedSource) {
  if (watchAutoPopulated || !cur.watchSlots.every((s) => !s) || streams.length === 0) {
    return {};
  }
  if ((cur.watchSource || 'ppv') !== expectedSource) {
    return {};
  }
  const defaultStream =
    streams.find((s) => s.isCfb && s.isLiveNow) ||
    streams.find((s) => s.isCfb) ||
    streams[0];
  if (!defaultStream || !defaultStream.feeds?.length) {
    return {};
  }
  watchAutoPopulated = true;
  const primaryFeed = defaultStream.feeds[0];
  const nextSlots = [...cur.watchSlots];
  nextSlots[0] = {
    streamId: defaultStream.id,
    source: defaultStream.source || expectedSource,
    sourceLabel:
      defaultStream.sourceLabel ||
      (expectedSource === 'timstreams'
        ? 'tim-streams.com'
        : expectedSource === 'strmfree'
          ? 'strmfree.pk'
          : 'ppv.st'),
    feedId: primaryFeed.id,
    iframe: primaryFeed.iframe,
    name: defaultStream.name,
    sourceTag: primaryFeed.label || defaultStream.sourceTag,
    uriName: primaryFeed.uriName || defaultStream.uriName,
    ppvUrl: defaultStream.externalUrl || defaultStream.ppvUrl,
    externalUrl: defaultStream.externalUrl || defaultStream.ppvUrl
  };
  return {
    watchSlots: nextSlots,
    watchActiveSlot: cur.watchCount > 1 ? 1 : 0,
    ...(cur.route === 'watch' ? { watchPlayerActive: true } : {})
  };
}

async function loadPpvStreams({ force = false, silent = false } = {}) {
  const prev = getState();
  if (!silent && prev.ppvStreams.length === 0) {
    setState({ ppvLoading: true, ppvError: null });
  }
  try {
    const data = await getPpvStreams({ force });
    lastPpvFetchAt = Date.now();
    const cur = getState();
    const patch = {
      ppvStreams: data.streams,
      ppvCategories: data.categories,
      ppvTimestamp: data.timestamp,
      ppvLoading: false,
      ppvError: null,
      ...buildInitialWatchSlotPatch(data.streams, cur, 'ppv')
    };

    setState(patch);
  } catch (err) {
    setState({
      ppvLoading: false,
      ppvError: err.message || 'Failed to load ppv.st live streams'
    });
    if (!silent && getState().watchSource === 'ppv') {
      showSnackbar(`Stream directory error: ${err.message}`);
    }
  }
}

async function loadTimStreams({ force = false, silent = false } = {}) {
  const prev = getState();
  if (!silent && prev.timStreams.length === 0) {
    setState({ timStreamsLoading: true, timStreamsError: null });
  }
  try {
    const data = await getTimStreams({ force });
    lastPpvFetchAt = Date.now();
    const cur = getState();
    const patch = {
      timStreams: data.streams,
      timStreamsCategories: data.categories,
      timStreamsTimestamp: data.timestamp,
      timStreamsLoading: false,
      timStreamsError: null,
      ...buildInitialWatchSlotPatch(data.streams, cur, 'timstreams')
    };

    setState(patch);
  } catch (err) {
    setState({
      timStreamsLoading: false,
      timStreamsError: err.message || 'Failed to load tim-streams.com live streams'
    });
    if (!silent && getState().watchSource === 'timstreams') {
      showSnackbar(`tim-streams.com stream error: ${err.message}`);
    }
  }
}

async function loadStrmFreeStreams({ force = false, silent = false } = {}) {
  const prev = getState();
  if (!silent && prev.strmFreeStreams.length === 0) {
    setState({ strmFreeLoading: true, strmFreeError: null });
  }
  try {
    const data = await getStrmFreeStreams({ force });
    lastPpvFetchAt = Date.now();
    const cur = getState();
    const patch = {
      strmFreeStreams: data.streams,
      strmFreeCategories: data.categories,
      strmFreeTimestamp: data.timestamp,
      strmFreeLoading: false,
      strmFreeError: null,
      ...buildInitialWatchSlotPatch(data.streams, cur, 'strmfree')
    };

    setState(patch);
  } catch (err) {
    setState({
      strmFreeLoading: false,
      strmFreeError: err.message || 'Failed to load strmfree.pk live streams'
    });
    if (!silent && getState().watchSource === 'strmfree') {
      showSnackbar(`strmfree.pk stream error: ${err.message}`);
    }
  }
}

async function loadWatchStreams({ force = false, silent = false } = {}) {
  await Promise.allSettled([
    loadPpvStreams({ force, silent }),
    loadTimStreams({ force, silent }),
    loadStrmFreeStreams({ force, silent })
  ]);
  if (getState().route === 'live' && appViewEl.querySelector('#live-detail-pane')) {
    refreshLiveDetailPaneOnly(appViewEl, false);
  }
}

function restoreWindowScroll(prevX, prevY) {
  if (prevX === null || prevY === null) return;
  const curX = window.scrollX || window.pageXOffset || 0;
  const curY = window.scrollY || window.pageYOffset || 0;
  if (curX !== prevX || curY !== prevY) {
    window.scrollTo(prevX, prevY);
  }
}

function renderActiveView(state, { preserveDetailPane = false } = {}) {
  const currentTeamId = state.route === 'teams' ? state.selectedTeamId || null : null;
  const sameViewContext =
    lastRenderedRoute === state.route &&
    (state.route !== 'teams' || String(lastRenderedTeamId || '') === String(currentTeamId || ''));
  const prevWinX = sameViewContext ? window.scrollX || window.pageXOffset || 0 : null;
  const prevWinY = sameViewContext ? window.scrollY || window.pageYOffset || 0 : null;
  lastRenderedRoute = state.route;
  lastRenderedTeamId = currentTeamId;

  updateChrome(state);

  const hasStreams = hasActiveWatchStreams(state);

  if (state.route === 'watch') {
    lastLiveSelectedRendered = null;
    if (hasStreams && !state.watchPlayerActive) {
      state.watchPlayerActive = true;
    }
    appViewEl.classList.add('is-hidden-by-watch');
    if (watchRootEl) {
      watchRootEl.classList.remove('is-hidden', 'is-pip-mode', 'is-pip-minimized');
      watchRootEl.classList.add('is-watch-route');
      renderWatchView(watchRootEl, watchCallbacks);
    }
    restoreWindowScroll(prevWinX, prevWinY);
    return;
  }

  appViewEl.classList.remove('is-hidden-by-watch');

  if (state.route === 'schedule') {
    lastLiveSelectedRendered = null;
    renderScheduleView(appViewEl, scheduleCallbacks);
  } else if (state.route === 'live') {
    const selectedNow =
      state.liveSelectedEventId ||
      state.liveEvents.find((e) => e.state === 'in')?.id ||
      state.liveEvents[0]?.id ||
      null;

    if (preserveDetailPane && lastLiveSelectedRendered === selectedNow && appViewEl.querySelector('#live-detail-pane')) {
      // Update left list selection / scores without wiping right pane scroll/tabs, then refresh detail in place
      const prevScroll = appViewEl.querySelector('.live-master-pane')?.scrollTop || 0;
      const detailNode = appViewEl.querySelector('#live-detail-pane');
      renderLiveView(appViewEl, liveCallbacks);
      const nextMaster = appViewEl.querySelector('.live-master-pane');
      if (nextMaster) nextMaster.scrollTop = prevScroll;
      if (detailNode) {
        refreshLiveDetailPaneOnly(appViewEl, true);
      }
    } else {
      lastLiveSelectedRendered = selectedNow;
      renderLiveView(appViewEl, liveCallbacks);
    }
  } else if (state.route === 'standings') {
    lastLiveSelectedRendered = null;
    renderStandingsView(appViewEl, standingsCallbacks);
  } else if (state.route === 'rankings') {
    lastLiveSelectedRendered = null;
    renderRankingsView(appViewEl, rankingsCallbacks);
  } else if (state.route === 'teams') {
    lastLiveSelectedRendered = null;
    renderTeamsView(appViewEl, teamsCallbacks);
  } else if (state.route === 'transitive') {
    lastLiveSelectedRendered = null;
    renderTransitiveView(appViewEl, transitiveCallbacks);
  }

  if (watchRootEl) {
    const showPip = Boolean(state.watchPlayerActive && hasStreams);
    if (showPip) {
      watchRootEl.classList.remove('is-hidden', 'is-watch-route');
      watchRootEl.classList.add('is-pip-mode');
      watchRootEl.classList.toggle('is-pip-minimized', Boolean(state.watchPipMinimized));
      renderWatchView(watchRootEl, watchCallbacks);
    } else {
      watchRootEl.classList.remove('is-watch-route', 'is-pip-mode', 'is-pip-minimized');
      watchRootEl.classList.add('is-hidden');
      if (!hasStreams && watchRootEl.querySelector('.watch-view-shell')) {
        renderWatchView(watchRootEl, watchCallbacks);
      }
    }
  }

  restoreWindowScroll(prevWinX, prevWinY);
}

async function performManualRefresh() {
  refreshBtn.classList.add('spinning');
  const s = getState();
  try {
    if (s.route === 'standings') {
      await loadStandings({ force: true });
    } else if (s.route === 'rankings') {
      const parts = s.rankingsWeekKey ? s.rankingsWeekKey.split(':') : [];
      await loadRankings({
        season: s.rankingsSeason,
        seasonType: parts.length === 2 ? parts[0] : null,
        week: parts.length === 2 ? parts[1] : null,
        force: true
      });
    } else if (s.route === 'live') {
      await loadLiveSlate({ force: true });
      refreshLiveDetailPaneOnly(appViewEl, true);
    } else if (s.route === 'teams') {
      if (s.selectedTeamId) {
        await openTeamPage(s.selectedTeamId, { season: s.teamSelectedSeason, force: true, recordHistory: false });
      } else {
        await loadTeamsDirectory({ force: true });
      }
    } else if (s.route === 'transitive') {
      await Promise.all([
        loadTransitiveSeasonGraph({ force: true }),
        s.teamsRaw.length === 0 ? loadTeamsDirectory({ force: false }) : Promise.resolve()
      ]);
    } else if (s.route === 'watch') {
      await Promise.all([
        loadWatchStreams({ force: true }),
        loadLiveSlate({ force: true, silent: true })
      ]);
    } else {
      await Promise.all([
        loadScoreboard({ force: true }),
        loadLiveSlate({ force: true, silent: true })
      ]);
    }
    if (s.sheetEventId) {
      const ev = findEventById(s.sheetEventId);
      mountGameDetail(sheetBodyEl, s.sheetEventId, { eventPreview: ev, force: true, showSkeleton: false });
    }
    showSnackbar('Synced latest ESPN data');
  } finally {
    refreshBtn.classList.remove('spinning');
  }
}

async function pollTick() {
  const s = getState();
  if (!s.autoRefresh || document.hidden) return;

  const prevPollX = window.scrollX || window.pageXOffset || 0;
  const prevPollY = window.scrollY || window.pageYOffset || 0;
  let userScrolledDuringPoll = false;
  const onUserScroll = () => {
    userScrolledDuringPoll = true;
  };
  window.addEventListener('wheel', onUserScroll, { passive: true, once: true });
  window.addEventListener('touchmove', onUserScroll, { passive: true, once: true });

  try {
    await loadLiveSlate({ force: true, silent: true });

    const after = getState();
    if (after.route === 'schedule') {
      const currentKey = `${after.liveDivision}:${after.currentSeasonType}:${after.currentWeekNumber}`;
      if (lastScheduleLoadKey === currentKey) {
        await loadScoreboard({ force: true, silent: true });
      }
    } else if (after.route === 'live') {
      refreshLiveDetailPaneOnly(appViewEl, true);
    } else if (after.route === 'watch' && Date.now() - lastPpvFetchAt >= 60000) {
      await loadWatchStreams({ force: true, silent: true });
    }

    if (after.sheetEventId) {
      const ev = findEventById(after.sheetEventId);
      if (ev && ev.state === 'in') {
        mountGameDetail(sheetBodyEl, after.sheetEventId, { eventPreview: ev, force: true, showSkeleton: false });
      }
    }

    if (!userScrolledDuringPoll) {
      restoreWindowScroll(prevPollX, prevPollY);
    }
  } finally {
    window.removeEventListener('wheel', onUserScroll);
    window.removeEventListener('touchmove', onUserScroll);
  }
}

function startPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(pollTick, 15000);
}

function wireEvents() {
  if (navBackBtn) {
    navBackBtn.addEventListener('click', () => {
      goBackToPreviousPage();
    });
  }

  // Navigation rail & bottom bar
  document.querySelectorAll('[data-nav]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetRoute = btn.dataset.nav;
      const prev = getState();
      clearLinkHistory();
      if (prev.watchFullscreen && targetRoute !== 'watch') {
        toggleWatchFullscreen(false);
      }
      if (targetRoute === 'teams') {
        const shouldResetTeam = prev.route === 'teams' && prev.selectedTeamId;
        setState({
          route: 'teams',
          ...(shouldResetTeam ? { selectedTeamId: null, teamPageError: null } : {}),
          ...getHistoryPatch()
        });
        if (prev.teamsRaw.length === 0) {
          loadTeamsDirectory({ force: false });
        }
      } else if (targetRoute === 'watch') {
        setState({
          route: 'watch',
          watchPipMinimized: false,
          ...(hasActiveWatchStreams(prev) ? { watchPlayerActive: true } : {}),
          ...getHistoryPatch()
        });
      } else {
        setState({ route: targetRoute, ...getHistoryPatch() });
      }
      if (targetRoute === 'live') {
        loadLiveSlate({ force: true, silent: true });
      } else if (targetRoute === 'watch') {
        loadWatchStreams({ force: false, silent: false });
      } else if (targetRoute === 'standings' && getState().conferences.length === 0) {
        loadStandings({ force: false });
      } else if (targetRoute === 'rankings' && !getState().rankingsData) {
        loadRankings({ force: false });
      } else if (targetRoute === 'transitive') {
        const curState = getState();
        if (curState.teamsRaw.length === 0) {
          loadTeamsDirectory({ force: false });
        }
        if (curState.conferences.length === 0) {
          loadStandings({ force: false });
        }
        if (!curState.transitiveSeasonGraph) {
          loadTransitiveSeasonGraph({ force: false });
        }
      }
      window.scrollTo({ top: 0, behavior: 'auto' });
    });
  });

  // Global app-wide team link & Watch Stream link handlers (Schedule, Game Center, Live, Standings, Opponent schedules)
  document.addEventListener(
    'click',
    (e) => {
      const watchEl = e.target.closest?.('[data-watch-event]');
      if (watchEl) {
        e.preventDefault();
        e.stopPropagation();
        openWatchForEvent({
          eventId: watchEl.dataset.watchEvent,
          streamId: watchEl.dataset.watchStreamId || null,
          streamSource: watchEl.dataset.watchStreamSource || null
        });
        return;
      }

      const teamEl = e.target.closest?.('[data-team-id]');
      if (!teamEl) return;
      const tid = teamEl.dataset.teamId;
      if (!tid || /^-\d+$/.test(tid)) return;
      e.preventDefault();
      e.stopPropagation();
      openTeamPage(tid);
    },
    true
  );

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const watchEl = document.activeElement?.closest?.('[data-watch-event]');
    if (watchEl) {
      e.preventDefault();
      e.stopPropagation();
      openWatchForEvent({
        eventId: watchEl.dataset.watchEvent,
        streamId: watchEl.dataset.watchStreamId || null,
        streamSource: watchEl.dataset.watchStreamSource || null
      });
      return;
    }

    const teamEl = document.activeElement?.closest?.('[data-team-id]');
    if (!teamEl) return;
    const tid = teamEl.dataset.teamId;
    if (!tid || /^-\d+$/.test(tid)) return;
    e.preventDefault();
    e.stopPropagation();
    openTeamPage(tid);
  });

  // Search input
  let searchDebounce = null;
  searchInputEl.addEventListener('input', () => {
    const val = searchInputEl.value;
    searchClearBtn.style.display = val ? 'inline-flex' : 'none';
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      setState({ searchQuery: val });
    }, 120);
  });

  searchClearBtn.addEventListener('click', () => {
    searchInputEl.value = '';
    searchClearBtn.style.display = 'none';
    setState({ searchQuery: '' });
    searchInputEl.focus();
  });

  // Auto-refresh toggle
  autoRefreshBtn.addEventListener('click', () => {
    const next = !getState().autoRefresh;
    setState({ autoRefresh: next });
    showSnackbar(next ? 'Live 15-second auto-refresh enabled' : 'Auto-refresh paused');
    if (next) pollTick();
  });

  // Manual refresh
  refreshBtn.addEventListener('click', performManualRefresh);

  // Theme toggle
  themeToggleBtn.addEventListener('click', () => {
    const nextTheme = getState().theme === 'dark' ? 'light' : 'dark';
    applyTheme(nextTheme);
    const openSheetId = getState().sheetEventId;
    if (openSheetId) {
      const ev = findEventById(openSheetId);
      mountGameDetail(sheetBodyEl, openSheetId, { eventPreview: ev, force: false, showSkeleton: false });
    }
  });

  // Modal sheet closing
  sheetCloseBtn.addEventListener('click', closeGameSheet);
  sheetBackdropEl.addEventListener('click', closeGameSheet);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (getState().sheetEventId) {
      closeGameSheet();
    } else if (getState().watchFullscreen) {
      toggleWatchFullscreen(false);
    }
  });

  // Visibility wake-up refresh
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && getState().autoRefresh) {
      pollTick();
    }
  });
}

async function init() {
  initTheme();
  wireEvents();

  subscribe((nextState) => {
    renderActiveView(nextState);
  });

  renderActiveView(getState());

  // Fetch initial current week scoreboard, conference standings/rankings, and weekly Top 25 polls in parallel
  await Promise.all([
    loadScoreboard({ group: '80', force: false }),
    loadStandings({ force: false }),
    loadRankings({ force: false })
  ]);

  // Pre-warm full NCAA teams directory and live stream catalogs in background
  loadTeamsDirectory({ force: false });
  loadWatchStreams({ force: false, silent: true });

  startPolling();
}

init();
