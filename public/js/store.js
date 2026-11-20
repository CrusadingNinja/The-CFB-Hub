// Reactive application state store

const initialState = {
  route: 'schedule', // 'schedule' | 'live' | 'watch' | 'standings' | 'rankings' | 'teams' | 'transitive'
  canGoBack: false,
  backPageLabel: '',
  theme: 'light',    // 'light' | 'dark'
  searchQuery: '',
  autoRefresh: true,
  lastUpdated: null,

  // Schedule state
  group: '80',       // '80' (FBS) | '81' (FCS)
  seasonType: '2',   // '2' (Regular Season) | '3' (Postseason)
  selectedWeek: null,
  currentSeasonYear: null,
  currentSeasonType: null,
  currentWeekNumber: null,
  calendar: {
    regular: [],
    postseason: []
  },
  scheduleFilter: {
    status: 'all',   // 'all' | 'in' | 'pre' | 'post'
    top25Only: false,
    conferenceId: 'all'
  },
  scoreboardEvents: [],
  scoreboardLoading: false,
  scoreboardError: null,

  // Live view state
  liveEvents: [],
  liveLoading: false,
  liveSelectedEventId: null,
  liveDivision: '80',

  // Standings state
  conferences: [],
  conferenceMap: {},
  rankMap: {},
  pollName: '',
  standingsLoading: false,
  standingsError: null,
  selectedConferenceId: 'all',
  standingsSort: {
    key: 'seed',
    dir: 'asc'
  },

  // Rankings state (AP Top 25 & CFP Committee week-by-week)
  rankingsSeason: null,
  rankingsWeekKey: null,       // '<seasonType>:<week>', e.g. '2:11' or '1:1'
  rankingsLatestWeekKey: null,
  rankingsWeeks: [],           // [{ key, week, seasonType, label, shortLabel }]
  rankingsData: null,          // { seasonYear, activeWeekKey, activeWeekLabel, cfpPoll, apPoll }
  rankingsLoading: false,
  rankingsError: null,
  rankingsViewMode: 'both',    // 'both' | 'cfp' | 'ap'
  rankingsConferenceFilter: 'all',

  // Teams directory & dedicated Team Page state
  teamsRaw: [],
  teamsDirectory: [],
  teamsById: {},
  fcsConferences: [],
  teamsLoading: false,
  teamsError: null,
  teamsFilter: {
    division: 'all', // 'all' | 'FBS' | 'FCS' | 'D2/D3' | 'top25'
    conferenceId: 'all',
    search: '',
    limit: 120
  },
  selectedTeamId: null,
  teamSelectedSeason: null,
  teamScheduleFilter: 'all', // 'all' | 'past' | 'future'
  teamStatsCategory: 'all',  // 'all' | 'passing' | 'rushing' | 'receiving' | 'defensive' | 'miscellaneous' | 'special' | 'scoring'
  teamPageData: null,
  teamPageLoading: false,
  teamPageError: null,

  // Watch / Multiview (ppv.st, thetvapp.plus & strmfree.pk)
  watchSource: (() => {
    try {
      const saved = localStorage.getItem('cfb_watch_source');
      return saved === 'thetvapp' || saved === 'strmfree' ? saved : 'ppv';
    } catch (err) {
      return 'ppv';
    }
  })(),
  ppvStreams: [],
  ppvCategories: [],
  ppvTimestamp: 0,
  ppvLoading: false,
  ppvError: null,
  tvAppStreams: [],
  tvAppCategories: [],
  tvAppTimestamp: 0,
  tvAppLoading: false,
  tvAppError: null,
  strmFreeStreams: [],
  strmFreeCategories: [],
  strmFreeTimestamp: 0,
  strmFreeLoading: false,
  strmFreeError: null,
  watchCount: 2, // 1 | 2 | 3 | 4 visible stream slots
  watchLayoutMode: 'equal', // 'equal' | 'spotlight'
  watchFullscreen: false,
  watchFsSidebarOpen: false,
  watchPrimarySlot: 0,
  watchActiveSlot: 0,
  watchSlots: [null, null, null, null],
  watchPlayerActive: false,
  watchPipMinimized: false,
  watchCategoryFilter: 'cfb', // 'cfb' | 'live' | 'football' | 'all'
  watchSearchQuery: '',

  // Transitive W/Ls state
  transitiveMode: 'matchup', // 'matchup' | 'farthest'
  transitiveTeamAId: null,
  transitiveTeamBId: null,
  transitiveFarthestTargetScope: 'fbs_fcs', // 'fbs_fcs' | 'fbs' | 'all'
  transitiveFarthestSchoolDiv: 'all', // 'all' | 'FBS' | 'FCS'
  transitiveFarthestSort: 'win_desc', // 'win_desc' | 'loss_desc' | 'school_asc'
  transitiveExpandedSchoolIds: [],
  transitiveSeasonGraph: null,
  transitiveLoading: false,
  transitiveError: null,

  // Modal sheet state (used from Schedule / Standings / Team Page / Transitive W/Ls)
  sheetEventId: null
};

let state = structuredCloneSafe(initialState);
const listeners = new Set();

function structuredCloneSafe(obj) {
  return JSON.parse(JSON.stringify(obj));
}

export function getState() {
  return state;
}

export function setState(patch) {
  if (typeof patch === 'function') {
    state = { ...state, ...patch(state) };
  } else {
    state = { ...state, ...patch };
  }
  listeners.forEach((fn) => {
    try {
      fn(state);
    } catch (err) {
      console.error('Store listener error:', err);
    }
  });
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
