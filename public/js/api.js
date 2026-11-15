// ESPN College Football API client & normalizers

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/football/college-football';
const clientCache = new Map();

async function fetchJson(url, ttlMs = 12000, { force = false } = {}) {
  const now = Date.now();
  if (!force) {
    const cached = clientCache.get(url);
    if (cached && cached.expiresAt > now) {
      return cached.data;
    }
  }

  let data;
  const proxyUrl = `/api/espn?target=${encodeURIComponent(url)}`;
  try {
    const proxyRes = await fetch(proxyUrl);
    if (!proxyRes.ok) {
      throw new Error(`HTTP ${proxyRes.status}`);
    }
    data = await proxyRes.json();
  } catch (proxyErr) {
    const directRes = await fetch(url, { mode: 'cors' });
    if (!directRes.ok) {
      throw new Error(`ESPN request failed (${directRes.status || proxyErr.message})`);
    }
    data = await directRes.json();
  }

  if (clientCache.size > 150) {
    clientCache.clear();
  }
  clientCache.set(url, {
    data,
    expiresAt: Date.now() + ttlMs
  });

  return data;
}

async function fetchOptionalJson(url, ttlMs = 60000, { force = false } = {}) {
  const cacheKey = `optional:${url}`;
  const now = Date.now();
  if (!force) {
    const cached = clientCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.data;
    }
  }

  let data = null;
  try {
    const proxyUrl = `/api/espn?target=${encodeURIComponent(url)}&optional=1`;
    const res = await fetch(proxyUrl);
    if (res.ok) {
      const parsed = await res.json();
      data = parsed && parsed.empty ? null : parsed;
    }
  } catch (err) {
    data = null;
  }

  if (clientCache.size > 150) {
    clientCache.clear();
  }
  clientCache.set(cacheKey, {
    data,
    expiresAt: Date.now() + ttlMs
  });

  return data;
}

function extractScore(rawScore) {
  if (rawScore === undefined || rawScore === null) return '';
  if (typeof rawScore === 'object') {
    if (rawScore.displayValue !== undefined && rawScore.displayValue !== null) {
      return String(rawScore.displayValue);
    }
    if (rawScore.value !== undefined && rawScore.value !== null) {
      return String(rawScore.value);
    }
    return '';
  }
  return String(rawScore);
}

function extractImageUrl(val) {
  if (!val) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'object' && typeof val.href === 'string') return val.href;
  return '';
}

function getLogoUrls(team) {
  const logos = Array.isArray(team?.logos) ? team.logos : [];
  const rawDefaultLogo =
    extractImageUrl(
      logos.find((l) => Array.isArray(l.rel) && l.rel.includes('default') && !l.rel.includes('dark'))
    ) ||
    extractImageUrl(team?.logo) ||
    extractImageUrl(logos.find((l) => !Array.isArray(l.rel) || !l.rel.includes('dark'))) ||
    extractImageUrl(logos[0]) ||
    '';
  const defaultLogo = rawDefaultLogo.replace(/\/500-dark\//gi, '/500/');
  return { logo: defaultLogo, logoDark: defaultLogo };
}

function normalizeRank(rawRank) {
  const num = Number(rawRank);
  return Number.isFinite(num) && num >= 1 && num <= 25 ? num : null;
}

function pickRecord(records, typeName) {
  if (!Array.isArray(records)) return '';
  const match = records.find((r) => r.type === typeName);
  return match?.summary || match?.displayValue || '';
}

function normalizeCompetitor(raw, fallbackLeaders = []) {
  const team = raw?.team || {};
  const { logo, logoDark } = getLogoUrls(team);
  const records = raw?.records || raw?.record || [];
  const rank = normalizeRank(raw?.curatedRank?.current ?? raw?.rank);

  return {
    id: String(raw?.id || team.id || ''),
    homeAway: raw?.homeAway || '',
    abbreviation: team.abbreviation || team.shortDisplayName || 'TBD',
    displayName: team.displayName || team.location || 'TBD',
    shortName: team.shortDisplayName || team.nickname || team.location || 'TBD',
    location: team.location || '',
    color: team.color ? `#${String(team.color).replace(/^#/, '')}` : null,
    alternateColor: team.alternateColor ? `#${String(team.alternateColor).replace(/^#/, '')}` : null,
    logo,
    logoDark,
    conferenceId: team.conferenceId ? String(team.conferenceId) : (team.groups?.id ? String(team.groups.id) : null),
    score: extractScore(raw?.score),
    winner: Boolean(raw?.winner),
    possession: Boolean(raw?.possession),
    rank,
    overallRecord: pickRecord(records, 'total'),
    confRecord: pickRecord(records, 'vsconf'),
    linescores: Array.isArray(raw?.linescores)
      ? raw.linescores.map((ls) => ls.displayValue ?? String(ls.value ?? '0'))
      : [],
    leaders: normalizeCompetitorLeaders(raw?.leaders || fallbackLeaders)
  };
}

function normalizeCompetitorLeaders(rawLeaders) {
  if (!Array.isArray(rawLeaders)) return [];
  return rawLeaders
    .map((cat) => {
      const top = Array.isArray(cat.leaders) ? cat.leaders[0] : null;
      if (!top) return null;
      return {
        category: cat.shortDisplayName || cat.displayName || cat.name || '',
        displayName: cat.displayName || '',
        athleteName: top.athlete?.displayName || top.athlete?.shortName || '',
        headshot: extractImageUrl(top.athlete?.headshot),
        jersey: top.athlete?.jersey || '',
        position: top.athlete?.position?.abbreviation || '',
        displayValue: top.displayValue || ''
      };
    })
    .filter(Boolean);
}

function normalizeEvent(ev) {
  const comp = ev?.competitions?.[0] || {};
  const competitors = Array.isArray(comp.competitors) ? comp.competitors : [];
  const awayRaw = competitors.find((c) => c.homeAway === 'away') || competitors[1] || competitors[0] || {};
  const homeRaw = competitors.find((c) => c.homeAway === 'home') || competitors[0] || {};

  const away = normalizeCompetitor(awayRaw);
  const home = normalizeCompetitor(homeRaw);

  const statusObj = ev?.status || comp.status || {};
  const state = statusObj.type?.state || 'pre';
  const seasonTypeRaw = ev?.seasonType?.id ?? ev?.seasonType?.type ?? ev?.season?.type ?? '2';
  const seasonTypeId = String(seasonTypeRaw || '2');
  const broadcastNames = comp.broadcasts?.[0]?.names;
  const broadcast =
    (Array.isArray(broadcastNames) && broadcastNames.length > 0 ? broadcastNames.join(' / ') : '') ||
    comp.broadcast ||
    comp.geoBroadcasts?.[0]?.media?.shortName ||
    '';

  const sit = comp.situation || null;
  const situation = sit
    ? {
        possession: sit.possession ? String(sit.possession) : null,
        down: typeof sit.down === 'number' ? sit.down : null,
        distance: typeof sit.distance === 'number' ? sit.distance : null,
        downDistanceText: sit.downDistanceText || '',
        shortDownDistanceText: sit.shortDownDistanceText || '',
        possessionText: sit.possessionText || '',
        yardLine: typeof sit.yardLine === 'number' ? sit.yardLine : null,
        isRedZone: Boolean(sit.isRedZone),
        homeTimeouts: sit.homeTimeouts ?? null,
        awayTimeouts: sit.awayTimeouts ?? null,
        lastPlay: sit.lastPlay?.text || ''
      }
    : null;

  return {
    id: String(ev.id),
    name: ev.name || `${away.shortName} at ${home.shortName}`,
    shortName: ev.shortName || `${away.abbreviation} @ ${home.abbreviation}`,
    date: ev.date || comp.date || '',
    seasonTypeId,
    seasonTypeName: ev?.seasonType?.name || (seasonTypeId === '3' ? 'Postseason' : 'Regular Season'),
    weekNumber: ev?.week?.number ? Number(ev.week.number) : null,
    weekText: ev?.week?.text || (ev?.week?.number ? `Week ${ev.week.number}` : ''),
    state,
    statusDetail: statusObj.type?.shortDetail || statusObj.type?.detail || '',
    statusDescription: statusObj.type?.description || '',
    completed: Boolean(statusObj.type?.completed),
    period: statusObj.period || 0,
    displayClock: statusObj.displayClock || '',
    neutralSite: Boolean(comp.neutralSite),
    conferenceCompetition: Boolean(comp.conferenceCompetition),
    playByPlayAvailable: Boolean(comp.playByPlayAvailable),
    broadcast,
    headline: comp.notes?.[0]?.headline || '',
    venue: {
      name: comp.venue?.fullName || '',
      city: comp.venue?.address?.city || '',
      state: comp.venue?.address?.state || ''
    },
    odds: comp.odds?.[0]
      ? {
          details: comp.odds[0].details || '',
          overUnder: comp.odds[0].overUnder ?? null
        }
      : null,
    away,
    home,
    situation
  };
}

function normalizeCalendar(rawCalendar) {
  const sections = Array.isArray(rawCalendar) ? rawCalendar : [];
  const regSection = sections.find((s) => String(s.value) === '2') || sections[0];
  const postSection = sections.find((s) => String(s.value) === '3');

  const mapEntries = (sec) =>
    (sec?.entries || []).map((entry) => ({
      label: entry.label || entry.alternateLabel || `Week ${entry.value}`,
      detail: entry.detail || '',
      value: String(entry.value),
      startDate: entry.startDate || '',
      endDate: entry.endDate || ''
    }));

  return {
    regular: mapEntries(regSection),
    postseason: mapEntries(postSection)
  };
}

export async function getScoreboard({ seasonType = null, week = null, group = '80', force = false } = {}) {
  const params = new URLSearchParams({
    groups: String(group || '80'),
    limit: '200'
  });
  if (seasonType) {
    params.set('seasontype', String(seasonType));
  }
  if (week) {
    params.set('week', String(week));
  }

  const url = `${BASE}/scoreboard?${params.toString()}`;
  const raw = await fetchJson(url, 12000, { force });

  const calendar = normalizeCalendar(raw?.leagues?.[0]?.calendar);
  const events = Array.isArray(raw?.events) ? raw.events.map(normalizeEvent) : [];

  // Sort: live first, then chronological kickoff, then final
  const stateOrder = { in: 0, pre: 1, post: 2 };
  events.sort((a, b) => {
    const orderDiff = (stateOrder[a.state] ?? 1) - (stateOrder[b.state] ?? 1);
    if (orderDiff !== 0) return orderDiff;
    return new Date(a.date).getTime() - new Date(b.date).getTime();
  });

  return {
    season: {
      year: raw?.season?.year || new Date().getFullYear(),
      type: String(raw?.season?.type || seasonType || '2')
    },
    week: {
      number: raw?.week?.number ? String(raw.week.number) : String(week || '1')
    },
    calendar,
    events
  };
}

function normalizePlay(play) {
  return {
    id: String(play.id || Math.random()),
    sequenceNumber: Number(play.sequenceNumber || 0),
    period: play.period?.number || 1,
    clock: play.clock?.displayValue || '',
    text: play.text || '',
    awayScore: play.awayScore ?? 0,
    homeScore: play.homeScore ?? 0,
    scoringPlay: Boolean(play.scoringPlay),
    isTurnover: Boolean(play.isTurnover),
    isPenalty: Boolean(play.isPenalty),
    statYardage: typeof play.statYardage === 'number' ? play.statYardage : null,
    typeText: play.type?.text || '',
    downDistanceText: play.start?.downDistanceText || play.end?.downDistanceText || '',
    shortDownDistance: play.start?.shortDownDistanceText || '',
    possessionText: play.start?.possessionText || play.end?.possessionText || '',
    yardLine: typeof play.start?.yardLine === 'number' ? play.start.yardLine : null,
    yardsToEndzone: typeof play.start?.yardsToEndzone === 'number' ? play.start.yardsToEndzone : null,
    end: play.end
      ? {
          down: typeof play.end.down === 'number' ? play.end.down : null,
          distance: typeof play.end.distance === 'number' ? play.end.distance : null,
          yardLine: typeof play.end.yardLine === 'number' ? play.end.yardLine : null,
          yardsToEndzone: typeof play.end.yardsToEndzone === 'number' ? play.end.yardsToEndzone : null,
          downDistanceText: play.end.downDistanceText || '',
          shortDownDistanceText: play.end.shortDownDistanceText || '',
          possessionText: play.end.possessionText || '',
          teamId: play.end.team?.id ? String(play.end.team.id) : null
        }
      : null
  };
}

function normalizeDrive(drive, isCurrent = false) {
  const { logo, logoDark } = getLogoUrls(drive.team || {});
  const plays = Array.isArray(drive.plays) ? drive.plays.map(normalizePlay) : [];
  const lastPlay = plays.length > 0 ? plays[plays.length - 1] : null;

  return {
    id: String(drive.id || `drive-${Math.random()}`),
    isCurrent,
    description: drive.description || '',
    team: {
      id: String(drive.team?.id || ''),
      abbreviation: drive.team?.abbreviation || '',
      displayName: drive.team?.displayName || drive.team?.name || '',
      logo,
      logoDark
    },
    result: drive.result || '',
    displayResult: drive.displayResult || drive.shortDisplayResult || (isCurrent ? 'In Progress' : 'Drive'),
    isScore: Boolean(drive.isScore),
    yards: drive.yards ?? 0,
    offensivePlays: drive.offensivePlays ?? plays.length,
    timeElapsed: drive.timeElapsed?.displayValue || '',
    startText: drive.start?.text || '',
    endText: drive.end?.text || '',
    awayScore: lastPlay ? Number(lastPlay.awayScore ?? 0) : 0,
    homeScore: lastPlay ? Number(lastPlay.homeScore ?? 0) : 0,
    plays
  };
}

function normalizeBoxscore(boxscoreTeams, awayId, homeId) {
  if (!Array.isArray(boxscoreTeams) || boxscoreTeams.length < 2) {
    return null;
  }

  const awayTeam = boxscoreTeams.find((t) => String(t.team?.id) === String(awayId)) || boxscoreTeams[0];
  const homeTeam = boxscoreTeams.find((t) => String(t.team?.id) === String(homeId)) || boxscoreTeams[1];

  const getMap = (stats) => {
    const map = {};
    (stats || []).forEach((s) => {
      map[s.name] = {
        label: s.label || s.name,
        displayValue: s.displayValue ?? '0'
      };
    });
    return map;
  };

  const awayStats = getMap(awayTeam.statistics);
  const homeStats = getMap(homeTeam.statistics);

  const metricSpecs = [
    { key: 'totalYards', label: 'Total Yards' },
    { key: 'netPassingYards', label: 'Passing Yards' },
    { key: 'completionAttempts', label: 'Completions / Att' },
    { key: 'rushingYards', label: 'Rushing Yards' },
    { key: 'rushingAttempts', label: 'Rushing Attempts' },
    { key: 'firstDowns', label: '1st Downs' },
    { key: 'thirdDownEff', label: '3rd Down Efficiency' },
    { key: 'fourthDownEff', label: '4th Down Efficiency' },
    { key: 'turnovers', label: 'Turnovers' },
    { key: 'totalPenaltiesYards', label: 'Penalties - Yards' },
    { key: 'possessionTime', label: 'Time of Possession' }
  ];

  const rows = metricSpecs
    .map((spec) => {
      const a = awayStats[spec.key];
      const h = homeStats[spec.key];
      if (!a && !h) return null;
      return {
        key: spec.key,
        label: a?.label || h?.label || spec.label,
        awayValue: a?.displayValue || '0',
        homeValue: h?.displayValue || '0'
      };
    })
    .filter(Boolean);

  return rows;
}

export async function getGameSummary(eventId, { force = false } = {}) {
  const url = `${BASE}/summary?event=${encodeURIComponent(String(eventId))}`;
  const raw = await fetchJson(url, 10000, { force });

  const comp = raw?.header?.competitions?.[0] || {};
  const competitors = Array.isArray(comp.competitors) ? comp.competitors : [];
  const awayRaw = competitors.find((c) => c.homeAway === 'away') || competitors[1] || competitors[0] || {};
  const homeRaw = competitors.find((c) => c.homeAway === 'home') || competitors[0] || {};

  const away = normalizeCompetitor(awayRaw);
  const home = normalizeCompetitor(homeRaw);

  const statusObj = comp.status || {};
  const state = statusObj.type?.state || 'pre';

  const broadcastNames = comp.broadcasts?.[0]?.media?.shortName || comp.broadcasts?.[0]?.names?.join(' / ') || '';
  const venueInfo = raw?.gameInfo?.venue || {};

  const currentDrive = raw?.drives?.current ? normalizeDrive(raw.drives.current, true) : null;
  const rawPrevDrives = Array.isArray(raw?.drives?.previous) ? raw.drives.previous : [];
  const previousDrives = rawPrevDrives
    .filter((d, idx) => {
      if (!currentDrive) return true;
      if (d?.id && currentDrive.id && String(d.id) === String(currentDrive.id)) return false;
      if (
        idx === rawPrevDrives.length - 1 &&
        !d?.result &&
        !d?.displayResult &&
        String(d?.team?.id || '') === String(currentDrive.team?.id || '') &&
        String(d?.description || '') === String(currentDrive.description || '')
      ) {
        return false;
      }
      return true;
    })
    .map((d) => normalizeDrive(d, false));

  let runningAwayScore = 0;
  let runningHomeScore = 0;
  const chronologicalDrives = currentDrive ? [...previousDrives, currentDrive] : [...previousDrives];
  chronologicalDrives.forEach((d) => {
    d.startAwayScore = runningAwayScore;
    d.startHomeScore = runningHomeScore;
    d.plays.forEach((p) => {
      const pAway = Number(p.awayScore);
      const pHome = Number(p.homeScore);
      if (Number.isFinite(pAway) && pAway >= runningAwayScore) runningAwayScore = pAway;
      if (Number.isFinite(pHome) && pHome >= runningHomeScore) runningHomeScore = pHome;
      p.awayScore = runningAwayScore;
      p.homeScore = runningHomeScore;
    });
    d.awayScore = runningAwayScore;
    d.homeScore = runningHomeScore;
  });

  const scoringPlays = Array.isArray(raw?.scoringPlays)
    ? raw.scoringPlays.map((sp) => {
        const { logo, logoDark } = getLogoUrls(sp.team || {});
        return {
          id: String(sp.id || Math.random()),
          period: sp.period?.number || 1,
          clock: sp.clock?.displayValue || '',
          text: sp.text || '',
          awayScore: sp.awayScore ?? 0,
          homeScore: sp.homeScore ?? 0,
          teamId: String(sp.team?.id || ''),
          teamAbbr: sp.team?.abbreviation || '',
          teamName: sp.team?.displayName || '',
          teamLogo: logo,
          teamLogoDark: logoDark,
          scoringType: sp.scoringType?.abbreviation || sp.type?.abbreviation || 'SCORE',
          scoringLabel: sp.scoringType?.displayName || sp.type?.text || 'Score'
        };
      })
    : [];

  const leaders = Array.isArray(raw?.leaders)
    ? raw.leaders.map((teamBlock) => ({
        teamId: String(teamBlock.team?.id || ''),
        teamAbbr: teamBlock.team?.abbreviation || '',
        teamName: teamBlock.team?.displayName || '',
        categories: normalizeCompetitorLeaders(teamBlock.leaders)
      }))
    : [];

  const oddsRaw = raw?.pickcenter?.[0] || raw?.odds?.[0] || null;
  const odds = oddsRaw
    ? {
        details: oddsRaw.details || '',
        overUnder: oddsRaw.overUnder ?? null
      }
    : null;

  return {
    id: String(eventId),
    date: comp.date || '',
    state,
    statusDetail: statusObj.type?.shortDetail || statusObj.type?.detail || '',
    period: statusObj.period || 0,
    displayClock: statusObj.displayClock || '',
    broadcast: broadcastNames,
    venue: {
      name: venueInfo.fullName || '',
      city: venueInfo.address?.city || '',
      state: venueInfo.address?.state || '',
      attendance: raw?.gameInfo?.attendance || null
    },
    away,
    home,
    currentDrive,
    previousDrives,
    scoringPlays,
    boxscoreRows: normalizeBoxscore(raw?.boxscore?.teams, away.id, home.id),
    leaders,
    odds
  };
}

function getStat(stats, typeName) {
  if (!Array.isArray(stats)) return null;
  return stats.find((s) => s.type === typeName) || null;
}

function normalizeStandingEntries(entries, rankMap) {
  const rows = (entries || []).map((entry) => {
    const team = entry.team || {};
    const { logo, logoDark } = getLogoUrls(team);
    const stats = entry.stats || [];

    const seedStat = getStat(stats, 'playoffseed');
    const seedVal = seedStat && Number(seedStat.value) > 0 ? Number(seedStat.value) : 999;

    const confRecStat = getStat(stats, 'vsconf');
    const confPctStat = getStat(stats, 'vsconf_leaguewinpercent');
    const ovrRecStat = getStat(stats, 'total');
    const homeRecStat = getStat(stats, 'homerecord');
    const awayRecStat = getStat(stats, 'awayrecord');
    const pfStat = getStat(stats, 'pointsfor');
    const paStat = getStat(stats, 'pointsagainst');
    const diffStat = getStat(stats, 'pointdifferential');
    const streakStat = getStat(stats, 'streak');
    const winsStat = getStat(stats, 'wins');
    const ovrPctStat = getStat(stats, 'leaguewinpercent');

    const teamId = String(team.id || '');
    const rank = rankMap[teamId] || null;
    const diffVal = Number(diffStat?.value ?? 0);

    return {
      teamId,
      name: team.displayName || team.shortDisplayName || 'Team',
      shortName: team.shortDisplayName || team.location || 'Team',
      abbreviation: team.abbreviation || '',
      logo,
      logoDark,
      rank,
      seed: seedVal,
      seedDisplay: seedVal < 999 ? String(seedVal) : '-',
      confRecord: confRecStat?.summary || confRecStat?.displayValue || '0-0',
      confWinPct: Number(confPctStat?.value ?? 0),
      confWinPctDisplay: confPctStat?.displayValue || '.000',
      overallRecord: ovrRecStat?.summary || ovrRecStat?.displayValue || '0-0',
      overallWins: Number(winsStat?.value ?? 0),
      overallWinPct: Number(ovrPctStat?.value ?? 0),
      homeRecord: homeRecStat?.summary || homeRecStat?.displayValue || '0-0',
      awayRecord: awayRecStat?.summary || awayRecStat?.displayValue || '0-0',
      pointsFor: Number(pfStat?.value ?? 0),
      pointsAgainst: Number(paStat?.value ?? 0),
      pointDiff: diffVal,
      pointDiffDisplay: diffStat?.displayValue || (diffVal > 0 ? `+${diffVal}` : String(diffVal)),
      streak: streakStat?.displayValue || '-',
      streakValue: Number(streakStat?.value ?? 0)
    };
  });

  // ESPN returns entries sorted by overall wins, so re-sort cleanly by conference seed -> confWinPct -> overallWins
  rows.sort((a, b) => {
    if (a.seed !== b.seed) return a.seed - b.seed;
    if (b.confWinPct !== a.confWinPct) return b.confWinPct - a.confWinPct;
    return b.overallWins - a.overallWins;
  });

  return rows;
}

function normalizeStandingsConferences(rawChildren, rankMap = {}, priorityOrder = []) {
  const conferenceMap = {};
  const conferences = (Array.isArray(rawChildren) ? rawChildren : []).map((conf) => {
    const id = String(conf.id || '');
    const shortName = conf.shortName || conf.name || 'Conference';
    conferenceMap[id] = {
      id,
      name: conf.name || shortName,
      shortName,
      abbreviation: conf.abbreviation || shortName
    };

    const groups = [];
    if (conf.standings && Array.isArray(conf.standings.entries)) {
      groups.push({
        name: null,
        entries: normalizeStandingEntries(conf.standings.entries, rankMap)
      });
    } else if (Array.isArray(conf.children)) {
      conf.children.forEach((sub) => {
        if (sub.standings && Array.isArray(sub.standings.entries)) {
          groups.push({
            name: sub.name || sub.shortName || 'Division',
            entries: normalizeStandingEntries(sub.standings.entries, rankMap)
          });
        }
      });
    }

    return {
      id,
      name: conf.name || shortName,
      shortName,
      abbreviation: conf.abbreviation || shortName,
      groups
    };
  });

  if (priorityOrder.length > 0) {
    conferences.sort((a, b) => {
      const ia = priorityOrder.indexOf(a.id);
      const ib = priorityOrder.indexOf(b.id);
      const pa = ia === -1 ? 99 : ia;
      const pb = ib === -1 ? 99 : ib;
      if (pa !== pb) return pa - pb;
      return a.shortName.localeCompare(b.shortName);
    });
  } else {
    conferences.sort((a, b) => a.shortName.localeCompare(b.shortName));
  }

  return { conferences, conferenceMap };
}

export async function getStandingsAndRankings({ force = false } = {}) {
  const [standingsRaw, rankingsRaw] = await Promise.all([
    fetchJson('https://site.api.espn.com/apis/v2/sports/football/college-football/standings', 60000, { force }),
    fetchJson(`${BASE}/rankings`, 60000, { force }).catch(() => ({ rankings: [] }))
  ]);

  const polls = Array.isArray(rankingsRaw?.rankings) ? rankingsRaw.rankings : [];
  const preferredPoll =
    polls.find((p) => /Playoff/i.test(p.name) && Array.isArray(p.ranks) && p.ranks.length > 0) ||
    polls.find((p) => /AP Top 25/i.test(p.name) && Array.isArray(p.ranks) && p.ranks.length > 0) ||
    polls.find((p) => Array.isArray(p.ranks) && p.ranks.length > 0) ||
    null;

  const rankMap = {};
  if (preferredPoll) {
    preferredPoll.ranks.forEach((entry) => {
      const tid = String(entry.team?.id || '');
      const rank = normalizeRank(entry.current);
      if (tid && rank) {
        rankMap[tid] = rank;
      }
    });
  }

  // Sort conferences logically: Power 4 + Pac-12 + American + Mountain West + Sun Belt + MAC + CUSA + Indep
  const priorityOrder = ['8', '5', '1', '4', '9', '151', '17', '37', '15', '12', '18'];
  const { conferences, conferenceMap } = normalizeStandingsConferences(
    standingsRaw?.children,
    rankMap,
    priorityOrder
  );

  return {
    conferences,
    conferenceMap,
    rankMap,
    pollName: preferredPoll?.name || 'Top 25'
  };
}

function normalizeRankingsWeeks(rawWeeks) {
  const seen = new Set();
  const result = [];
  (Array.isArray(rawWeeks) ? rawWeeks : []).forEach((w) => {
    const week = String(w?.week || '');
    const seasonType = String(w?.type || '2');
    if (!week) return;
    const key = `${seasonType}:${week}`;
    if (seen.has(key)) return;
    seen.add(key);

    const label =
      w?.display ||
      (seasonType === '1'
        ? 'Preseason'
        : seasonType === '3'
          ? 'Final Rankings'
          : `Week ${week}`);
    const shortLabel =
      seasonType === '1'
        ? 'Preseason'
        : seasonType === '3'
          ? 'Final'
          : `Week ${week}`;

    result.push({
      key,
      week,
      seasonType,
      label,
      shortLabel
    });
  });
  return result;
}

function normalizePollTeamEntry(entry, { isInitialRelease = false, isDroppedOut = false } = {}) {
  const team = entry?.team || {};
  const { logo, logoDark } = getLogoUrls(team);
  const current = Number(entry?.current || 0);
  const previous = Number(entry?.previous || 0);
  const points = Number(entry?.points || 0);
  const firstPlaceVotes = Number(entry?.firstPlaceVotes || 0);
  const rawRecord = entry?.recordSummary || '';
  const recordSummary = rawRecord === '0-0' && (isDroppedOut || current <= 0) ? '' : rawRecord;
  const firstRoundBye = Boolean(entry?.firstRoundBye);

  const locationName = team.location || '';
  const teamNickname = team.name || '';
  const displayName =
    team.displayName ||
    [locationName, teamNickname].filter(Boolean).join(' ') ||
    team.nickname ||
    team.abbreviation ||
    'Team';
  const shortName =
    team.shortDisplayName ||
    team.nickname ||
    locationName ||
    displayName;

  const conferenceId = team.groups?.id ? String(team.groups.id) : null;
  const conferenceShortName = entry?.conference || team.groups?.shortName || '';

  let movement = 'same';
  let delta = 0;
  let trendDisplay = '—';
  let previousDisplay = previous > 0 ? `#${previous}` : '—';

  if (isDroppedOut) {
    movement = 'dropped';
    trendDisplay = previous > 0 ? `was #${previous}` : 'Dropped';
    previousDisplay = previous > 0 ? `#${previous}` : '—';
  } else if (current <= 0) {
    movement = 'rv';
    trendDisplay = points > 0 ? `${points} pts` : 'RV';
    previousDisplay = previous > 0 ? `#${previous}` : 'NR';
  } else if (isInitialRelease) {
    movement = 'initial';
    trendDisplay = '—';
    previousDisplay = '—';
  } else if (!previous || previous === 0) {
    movement = 'new';
    trendDisplay = 'NEW';
    previousDisplay = 'NR';
  } else if (previous > current) {
    movement = 'up';
    delta = previous - current;
    trendDisplay = `+${delta}`;
    previousDisplay = `#${previous}`;
  } else if (previous < current) {
    movement = 'down';
    delta = current - previous;
    trendDisplay = `-${delta}`;
    previousDisplay = `#${previous}`;
  }

  return {
    id: String(team.id || ''),
    displayName,
    shortName,
    abbreviation: team.abbreviation || shortName.slice(0, 4).toUpperCase(),
    color: team.color ? `#${String(team.color).replace(/^#/, '')}` : null,
    logo,
    logoDark,
    conferenceId,
    conferenceShortName,
    current,
    previous,
    points,
    firstPlaceVotes,
    recordSummary,
    firstRoundBye,
    movement,
    delta,
    trendDisplay,
    previousDisplay
  };
}

function normalizeSinglePoll(rawPoll, { isPreseasonCarryover = false } = {}) {
  if (!rawPoll || !Array.isArray(rawPoll.ranks) || rawPoll.ranks.length === 0) {
    return null;
  }

  const isInitialRelease = rawPoll.ranks.every((r) => !Number(r?.previous));
  const ranks = rawPoll.ranks.map((entry) =>
    normalizePollTeamEntry(entry, { isInitialRelease })
  );
  const others = Array.isArray(rawPoll.others)
    ? rawPoll.others.map((entry) => normalizePollTeamEntry(entry, { isInitialRelease }))
    : [];
  const droppedOut = Array.isArray(rawPoll.droppedOut)
    ? rawPoll.droppedOut.map((entry) => normalizePollTeamEntry(entry, { isDroppedOut: true }))
    : [];

  return {
    id: String(rawPoll.id || ''),
    type: rawPoll.type || '',
    name: rawPoll.name || '',
    shortName: rawPoll.shortName || rawPoll.name || '',
    headline: rawPoll.headline || '',
    date: rawPoll.date || '',
    lastUpdated: rawPoll.lastUpdated || '',
    occurrenceLabel: rawPoll.occurrence?.displayValue || '',
    occurrenceWeek: rawPoll.occurrence?.number ? String(rawPoll.occurrence.number) : '',
    isInitialRelease,
    isPreseasonCarryover,
    ranks,
    others,
    droppedOut
  };
}

export async function getWeeklyRankings({ season = null, week = null, seasonType = null, force = false } = {}) {
  const params = new URLSearchParams();
  if (season) params.set('seasons', String(season));
  if (week) params.set('weeks', String(week));
  if (seasonType) params.set('seasontypes', String(seasonType));

  const qs = params.toString();
  const url = qs ? `${BASE}/rankings?${qs}` : `${BASE}/rankings`;
  const raw = await fetchJson(url, 60000, { force });

  const seasonYear = Number(
    raw?.requestedSeason?.year || raw?.latestSeason?.year || season || new Date().getFullYear()
  );
  const weeks = normalizeRankingsWeeks(raw?.weeks);
  const polls = Array.isArray(raw?.rankings) ? raw.rankings : [];

  const rawCfp =
    polls.find((p) => p.type === 'cfp' || String(p.id) === '21' || /Playoff Committee/i.test(p.name)) ||
    null;
  let rawAp =
    polls.find((p) => p.type === 'ap' || String(p.id) === '1' || /AP Top 25/i.test(p.name)) ||
    null;

  let isPreseasonCarryover = false;
  if (!rawAp && String(week) === '1' && String(seasonType) === '2') {
    const preUrl = `${BASE}/rankings?seasons=${encodeURIComponent(String(seasonYear))}&weeks=1&seasontypes=1`;
    const preRaw = await fetchJson(preUrl, 60000, { force }).catch(() => null);
    const prePolls = Array.isArray(preRaw?.rankings) ? preRaw.rankings : [];
    const preAp =
      prePolls.find((p) => p.type === 'ap' || String(p.id) === '1' || /AP Top 25/i.test(p.name)) ||
      null;
    if (preAp) {
      rawAp = preAp;
      isPreseasonCarryover = true;
    }
  }

  const cfpPoll = normalizeSinglePoll(rawCfp);
  const apPoll = normalizeSinglePoll(rawAp, { isPreseasonCarryover });

  let activeWeekKey = '';
  if (week && seasonType) {
    activeWeekKey = `${String(seasonType)}:${String(week)}`;
  } else {
    const occ = (rawCfp || rawAp)?.occurrence;
    const occDisplay = occ?.displayValue || raw?.latestWeek?.displayValue || '';
    if (/Preseason/i.test(occDisplay)) {
      activeWeekKey = '1:1';
    } else if (/Final/i.test(occDisplay) || (occ?.last && weeks.some((w) => w.seasonType === '3'))) {
      const postEntry = weeks.find((w) => w.seasonType === '3');
      activeWeekKey = postEntry ? postEntry.key : `3:${String(occ?.number || raw?.latestWeek?.number || '1')}`;
    } else {
      const wkNum = String(occ?.number || raw?.latestWeek?.number || '1');
      activeWeekKey = `2:${wkNum}`;
    }

    if (weeks.length > 0 && !weeks.some((w) => w.key === activeWeekKey)) {
      activeWeekKey = weeks[weeks.length - 1].key;
    }
  }

  const matchedWeek = weeks.find((w) => w.key === activeWeekKey);
  const activeWeekLabel =
    matchedWeek?.label ||
    rawCfp?.occurrence?.displayValue ||
    rawAp?.occurrence?.displayValue ||
    (week ? `Week ${week}` : 'Latest');

  return {
    seasonYear,
    activeWeekKey,
    activeWeekLabel,
    weeks,
    cfpPoll,
    apPoll
  };
}

export async function getTeamsDirectory({ force = false } = {}) {
  const [teamsRawRes, fcsStandingsRes] = await Promise.all([
    fetchJson(`${BASE}/teams?limit=1000`, 300000, { force }),
    fetchJson('https://site.api.espn.com/apis/v2/sports/football/college-football/standings?group=81', 300000, { force })
      .catch(() => ({ children: [] }))
  ]);

  const rawEntries = teamsRawRes?.sports?.[0]?.leagues?.[0]?.teams || [];
  const rawTeams = rawEntries
    .map((item) => item?.team || item)
    .filter((t) => t && t.id)
    .map((t) => {
      const { logo, logoDark } = getLogoUrls(t);
      return {
        id: String(t.id),
        displayName: t.displayName || t.location || 'Team',
        shortName: t.shortDisplayName || t.nickname || t.location || t.displayName || 'Team',
        location: t.location || '',
        nickname: t.name || t.nickname || '',
        abbreviation: t.abbreviation || '',
        color: t.color ? `#${String(t.color).replace(/^#/, '')}` : null,
        alternateColor: t.alternateColor ? `#${String(t.alternateColor).replace(/^#/, '')}` : null,
        logo,
        logoDark,
        slug: t.slug || ''
      };
    });

  const { conferences: fcsConferences } = normalizeStandingsConferences(fcsStandingsRes?.children, {});

  return { rawTeams, fcsConferences };
}

export function buildTeamsCatalog(rawTeams = [], fbsConferences = [], fcsConferences = [], rankMap = {}) {
  const metaByTeamId = {};

  const indexConferences = (confs, division) => {
    (confs || []).forEach((conf) => {
      (conf.groups || []).forEach((grp) => {
        (grp.entries || []).forEach((entry) => {
          if (!entry.teamId) return;
          metaByTeamId[entry.teamId] = {
            division,
            conferenceId: conf.id,
            conferenceName: conf.name,
            conferenceShortName: conf.shortName,
            overallRecord: entry.overallRecord || '',
            confRecord: entry.confRecord || '',
            rank: entry.rank || rankMap[entry.teamId] || null
          };
        });
      });
    });
  };

  indexConferences(fcsConferences, 'FCS');
  indexConferences(fbsConferences, 'FBS');

  const divOrder = { FBS: 0, FCS: 1, 'D2/D3': 2 };
  const teamsDirectory = (rawTeams || []).map((t) => {
    const meta = metaByTeamId[t.id];
    const rank = meta?.rank || rankMap[t.id] || null;
    const division = meta?.division || (rank ? 'FBS' : 'D2/D3');
    return {
      ...t,
      division,
      conferenceId: meta?.conferenceId || (division === 'D2/D3' ? 'd2-d3' : ''),
      conferenceName: meta?.conferenceName || (division === 'D2/D3' ? 'Division II / III' : ''),
      conferenceShortName: meta?.conferenceShortName || (division === 'D2/D3' ? 'Div II / III' : division),
      overallRecord: meta?.overallRecord || '',
      confRecord: meta?.confRecord || '',
      rank
    };
  });

  // Ensure any team present in standings but missing from teams list is still reachable
  const seenIds = new Set(teamsDirectory.map((t) => t.id));
  const appendMissingFrom = (confs, division) => {
    (confs || []).forEach((conf) => {
      (conf.groups || []).forEach((grp) => {
        (grp.entries || []).forEach((entry) => {
          if (!entry.teamId || seenIds.has(entry.teamId)) return;
          seenIds.add(entry.teamId);
          teamsDirectory.push({
            id: entry.teamId,
            displayName: entry.name,
            shortName: entry.shortName,
            location: entry.shortName,
            nickname: '',
            abbreviation: entry.abbreviation,
            color: null,
            alternateColor: null,
            logo: entry.logo,
            logoDark: entry.logoDark,
            slug: '',
            division,
            conferenceId: conf.id,
            conferenceName: conf.name,
            conferenceShortName: conf.shortName,
            overallRecord: entry.overallRecord || '',
            confRecord: entry.confRecord || '',
            rank: entry.rank || rankMap[entry.teamId] || null
          });
        });
      });
    });
  };

  appendMissingFrom(fbsConferences, 'FBS');
  appendMissingFrom(fcsConferences, 'FCS');

  teamsDirectory.sort((a, b) => {
    const da = divOrder[a.division] ?? 9;
    const db = divOrder[b.division] ?? 9;
    if (da !== db) return da - db;
    const ra = a.rank || 999;
    const rb = b.rank || 999;
    if (ra !== rb) return ra - rb;
    return a.displayName.localeCompare(b.displayName);
  });

  const teamsById = {};
  teamsDirectory.forEach((t) => {
    teamsById[t.id] = t;
  });

  return { teamsDirectory, teamsById };
}

function mapTeamStatGroupKey(categoryName) {
  switch (categoryName) {
    case 'passing':
      return 'passing';
    case 'rushing':
      return 'rushing';
    case 'receiving':
      return 'receiving';
    case 'defensive':
    case 'defensiveInterceptions':
      return 'defensive';
    case 'miscellaneous':
    case 'general':
      return 'miscellaneous';
    case 'returning':
    case 'kicking':
    case 'punting':
      return 'special';
    case 'scoring':
      return 'scoring';
    default:
      return 'miscellaneous';
  }
}

function normalizeTeamStatistics(statsRaw) {
  const catsRaw = statsRaw?.results?.stats?.categories;
  if (!Array.isArray(catsRaw) || catsRaw.length === 0) {
    return null;
  }

  const oppMap = new Map();
  const oppRaw = Array.isArray(statsRaw?.results?.opponent) ? statsRaw.results.opponent : [];
  oppRaw.forEach((cat) => {
    const statMap = new Map();
    (cat.stats || []).forEach((s) => {
      if (s?.name && !statMap.has(s.name)) {
        statMap.set(s.name, s);
      }
    });
    oppMap.set(cat.name, statMap);
  });

  const statLookup = {};
  const categories = catsRaw.map((cat) => {
    const oppCat = oppMap.get(cat.name) || new Map();
    const seenStatNames = new Set();
    const items = [];

    (cat.stats || []).forEach((s) => {
      const statKey = s?.name || '';
      if (!statKey || seenStatNames.has(statKey)) return;
      seenStatNames.add(statKey);

      const oppStat = oppCat.get(statKey);
      const item = {
        name: statKey,
        label: s.displayName || statKey,
        shortLabel: s.shortDisplayName || s.abbreviation || s.displayName || statKey,
        description: s.description || '',
        teamValue: s.displayValue ?? String(s.value ?? '0'),
        teamNumeric: typeof s.value === 'number' ? s.value : Number(s.value ?? 0),
        oppValue: oppStat ? oppStat.displayValue ?? String(oppStat.value ?? '-') : null,
        oppNumeric: oppStat ? (typeof oppStat.value === 'number' ? oppStat.value : Number(oppStat.value ?? 0)) : null,
        oppRank: oppStat?.rankDisplayValue || ''
      };
      items.push(item);

      if (!statLookup[`${cat.name}:${statKey}`]) {
        statLookup[`${cat.name}:${statKey}`] = item;
      }
    });

    return {
      name: cat.name || 'general',
      displayName: cat.displayName || cat.name || 'Team Stats',
      groupKey: mapTeamStatGroupKey(cat.name),
      items
    };
  });

  const comparisonSpecs = [
    { key: 'passing:netPassingYards', label: 'Passing Yards' },
    { key: 'passing:completionPct', label: 'Completion %' },
    { key: 'rushing:rushingYards', label: 'Rushing Yards' },
    { key: 'rushing:yardsPerRushAttempt', label: 'Yards Per Rush' },
    { key: 'miscellaneous:firstDowns', label: 'Total 1st Downs' },
    { key: 'miscellaneous:thirdDownConvPct', label: '3rd Down %' },
    { key: 'scoring:totalTouchdowns', label: 'Total Touchdowns' },
    { key: 'defensive:sacks', label: 'Sacks' },
    { key: 'defensiveInterceptions:interceptions', label: 'Interceptions' },
    { key: 'kicking:fieldGoalPct', label: 'Field Goal %' }
  ];

  const overviewComparisons = comparisonSpecs
    .map((spec) => {
      const found = statLookup[spec.key];
      if (!found || found.oppValue === null) return null;
      return {
        label: spec.label,
        teamValue: found.teamValue,
        teamNumeric: found.teamNumeric,
        oppValue: found.oppValue,
        oppNumeric: found.oppNumeric,
        oppRank: found.oppRank
      };
    })
    .filter(Boolean);

  return {
    seasonYear: statsRaw?.requestedSeason?.year || statsRaw?.season?.year || null,
    categories,
    overviewComparisons
  };
}

function parseRecordGames(recStr) {
  const parts = String(recStr || '').split('-').map((n) => Number(n));
  if (parts.length < 2 || parts.some((n) => !Number.isFinite(n))) return -1;
  return parts.reduce((sum, n) => sum + n, 0);
}

function computeSeasonSummary(teamId, games) {
  let wins = 0;
  let losses = 0;
  let ties = 0;
  let confWins = 0;
  let confLosses = 0;
  let latestRegularConfRecord = '';
  let latestRegularConfTotal = -1;
  let latestAnyConfRecord = '';
  let latestAnyConfTotal = -1;
  let homeWins = 0;
  let homeLosses = 0;
  let awayWins = 0;
  let awayLosses = 0;
  let pointsFor = 0;
  let pointsAgainst = 0;
  let completedCount = 0;
  const resultsSeq = [];

  games.forEach((g) => {
    if (!g.isPast) return;
    completedCount += 1;
    const pf = Number(g.teamComp.score);
    const pa = Number(g.opponent.score);
    if (Number.isFinite(pf)) pointsFor += pf;
    if (Number.isFinite(pa)) pointsAgainst += pa;

    const compConfRec = String((g.teamComp && g.teamComp.confRecord) || '').trim();
    if (/^\d+-\d+(?:-\d+)?$/.test(compConfRec)) {
      const confTotal = parseRecordGames(compConfRec);
      if (confTotal >= latestAnyConfTotal) {
        latestAnyConfTotal = confTotal;
        latestAnyConfRecord = compConfRec;
      }
      if (String(g.seasonTypeId || '') !== '3' && confTotal >= latestRegularConfTotal) {
        latestRegularConfTotal = confTotal;
        latestRegularConfRecord = compConfRec;
      }
    }

    if (g.result === 'W') {
      wins += 1;
      resultsSeq.push('W');
      if (g.conferenceCompetition) confWins += 1;
      if (!g.neutralSite) {
        if (g.isHome) homeWins += 1;
        else awayWins += 1;
      }
    } else if (g.result === 'L') {
      losses += 1;
      resultsSeq.push('L');
      if (g.conferenceCompetition) confLosses += 1;
      if (!g.neutralSite) {
        if (g.isHome) homeLosses += 1;
        else awayLosses += 1;
      }
    } else {
      ties += 1;
      resultsSeq.push('T');
    }
  });

  let streak = '-';
  if (resultsSeq.length > 0) {
    const last = resultsSeq[resultsSeq.length - 1];
    let count = 0;
    for (let i = resultsSeq.length - 1; i >= 0; i--) {
      if (resultsSeq[i] === last) count += 1;
      else break;
    }
    streak = `${last}${count}`;
  }

  const pointDiff = pointsFor - pointsAgainst;
  const confRecord = latestRegularConfRecord || latestAnyConfRecord || `${confWins}-${confLosses}`;
  return {
    completedCount,
    record: ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`,
    confRecord,
    homeRecord: `${homeWins}-${homeLosses}`,
    awayRecord: `${awayWins}-${awayLosses}`,
    pointsFor,
    pointsAgainst,
    ppg: completedCount > 0 ? (pointsFor / completedCount).toFixed(1) : '-',
    oppPpg: completedCount > 0 ? (pointsAgainst / completedCount).toFixed(1) : '-',
    pointDiff,
    pointDiffDisplay: completedCount > 0 ? (pointDiff > 0 ? `+${pointDiff}` : String(pointDiff)) : '-',
    streak
  };
}

export async function getTeamPageData(teamId, { season = null, force = false } = {}) {
  const id = String(teamId);
  const encodedId = encodeURIComponent(id);
  const seasonYear = Number(season) || new Date().getFullYear();

  const [teamInfoRes, schedRegRes, schedPostRes, statsRes] = await Promise.all([
    fetchJson(`${BASE}/teams/${encodedId}`, 60000, { force }),
    fetchJson(`${BASE}/teams/${encodedId}/schedule?season=${seasonYear}`, 30000, { force }).catch(() => ({ events: [] })),
    fetchOptionalJson(`${BASE}/teams/${encodedId}/schedule?season=${seasonYear}&seasontype=3`, 60000, { force }),
    fetchOptionalJson(`${BASE}/teams/${encodedId}/statistics?season=${seasonYear}`, 60000, { force })
  ]);

  const rawTeam = teamInfoRes?.team || schedRegRes?.team || {};
  const { logo, logoDark } = getLogoUrls(rawTeam);
  const parentGroupId = String(rawTeam.groups?.parent?.id || '');
  const division = parentGroupId === '80' ? 'FBS' : parentGroupId === '81' ? 'FCS' : 'D2/D3';

  const currentSeasonYear =
    schedRegRes?.season?.year ||
    statsRes?.season?.year ||
    new Date().getFullYear();

  const team = {
    id: String(rawTeam.id || id),
    displayName: rawTeam.displayName || rawTeam.location || 'Team',
    shortName: rawTeam.shortDisplayName || rawTeam.nickname || rawTeam.location || 'Team',
    location: rawTeam.location || '',
    nickname: rawTeam.name || rawTeam.nickname || '',
    abbreviation: rawTeam.abbreviation || '',
    color: rawTeam.color ? `#${String(rawTeam.color).replace(/^#/, '')}` : null,
    alternateColor: rawTeam.alternateColor ? `#${String(rawTeam.alternateColor).replace(/^#/, '')}` : null,
    logo,
    logoDark,
    standingSummary: rawTeam.standingSummary || schedRegRes?.team?.standingSummary || '',
    recordSummary: rawTeam.record?.items?.find((r) => r.type === 'total')?.summary || schedRegRes?.team?.recordSummary || '',
    conferenceId: rawTeam.groups?.id ? String(rawTeam.groups.id) : null,
    division
  };

  // Merge Regular Season (seasontype=2) + Postseason (seasontype=3) events uniquely
  const rawEvents = [
    ...(Array.isArray(schedRegRes?.events) ? schedRegRes.events : []),
    ...(Array.isArray(schedPostRes?.events) ? schedPostRes.events : [])
  ];
  const seenEventIds = new Set();
  const mergedEvents = [];

  rawEvents.forEach((rawEv) => {
    const eid = String(rawEv?.id || '');
    if (!eid || seenEventIds.has(eid)) return;
    seenEventIds.add(eid);
    const ev = normalizeEvent(rawEv);
    const isHome = ev.home.id === id;
    const teamComp = isHome ? ev.home : ev.away;
    const opponent = isHome ? ev.away : ev.home;
    const isPast = ev.state === 'post' || ev.completed;
    const isLive = ev.state === 'in';
    const isFuture = !isPast && !isLive;

    let result = '';
    if (isPast) {
      const ts = Number(teamComp.score);
      const os = Number(opponent.score);
      if (teamComp.winner || (Number.isFinite(ts) && Number.isFinite(os) && ts > os)) {
        result = 'W';
      } else if (opponent.winner || (Number.isFinite(ts) && Number.isFinite(os) && ts < os)) {
        result = 'L';
      } else if (Number.isFinite(ts) && Number.isFinite(os)) {
        result = 'T';
      }
    }

    mergedEvents.push({
      ...ev,
      isHome,
      teamComp,
      opponent,
      venuePrefix: ev.neutralSite ? 'vs' : isHome ? 'vs' : '@',
      venueTag: ev.neutralSite ? 'Neutral' : isHome ? 'Home' : 'Away',
      isPast,
      isLive,
      isFuture,
      result
    });
  });

  mergedEvents.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const seasonSummary = computeSeasonSummary(id, mergedEvents);
  const stats = normalizeTeamStatistics(statsRes);

  return {
    team,
    seasonYear,
    currentSeasonYear,
    events: mergedEvents,
    seasonSummary,
    stats
  };
}

// ==================== LIVE STREAMS (PPV.ST & THETVAPP.PLUS) & ESPN MATCHING ====================

export const STREAM_SOURCES = [
  { id: 'ppv', label: 'ppv.st', url: 'https://ppv.st' },
  { id: 'thetvapp', label: 'thetvapp.plus', url: 'https://thetvapp.plus' },
  { id: 'strmfree', label: 'strmfree.pk', url: 'https://strmfree.pk' }
];

const ppvCache = { data: null, expiresAt: 0 };
const tvAppCache = { data: null, expiresAt: 0 };
const strmFreeCache = { data: null, expiresAt: 0 };

const TEAM_MATCH_ALIASES = {
  'ole miss': ['mississippi', 'ole miss rebels'],
  'mississippi': ['ole miss', 'ole miss rebels'],
  'miami fl': ['miami', 'miami hurricanes'],
  'miami': ['miami fl', 'miami hurricanes'],
  'nc state': ['north carolina state', 'nc state wolfpack'],
  'north carolina state': ['nc state'],
  'uconn': ['connecticut', 'uconn huskies'],
  'connecticut': ['uconn', 'uconn huskies'],
  'app state': ['appalachian state', 'appalachian state mountaineers'],
  'appalachian state': ['app state'],
  'pitt': ['pittsburgh', 'pittsburgh panthers'],
  'pittsburgh': ['pitt'],
  'usc': ['southern california', 'southern cal', 'usc trojans'],
  'southern cal': ['usc', 'southern california'],
  'southern california': ['usc', 'southern cal'],
  'utsa': ['texas san antonio', 'utsa roadrunners'],
  'ul monroe': ['louisiana monroe', 'ulm'],
  'ulm': ['ul monroe', 'louisiana monroe'],
  'louisiana monroe': ['ul monroe', 'ulm'],
  'sam houston': ['sam houston state', 'shsu'],
  'usf': ['south florida', 'usf bulls'],
  'south florida': ['usf'],
  'fiu': ['florida international', 'fiu panthers'],
  'florida international': ['fiu'],
  'fau': ['florida atlantic', 'fau owls'],
  'florida atlantic': ['fau'],
  'smu': ['southern methodist', 'smu mustangs'],
  'tcu': ['texas christian', 'tcu horned frogs'],
  'byu': ['brigham young', 'byu cougars'],
  'ucf': ['central florida', 'ucf knights'],
  'unlv': ['nevada las vegas', 'unlv rebels'],
  'uab': ['alabama birmingham', 'uab blazers'],
  'lsu': ['louisiana state', 'lsu tigers'],
  'texas a m': ['texas a&m', 'texas am', 'tamu', 'ta&m', 'texas a m aggies'],
  'tamu': ['texas a m', 'texas a m aggies'],
  'ta m': ['texas a m', 'texas a m aggies'],
  'unc': ['north carolina', 'north carolina tar heels'],
  'north carolina': ['unc'],
  'fsu': ['florida state', 'florida state seminoles'],
  'florida state': ['fsu'],
  'uga': ['georgia', 'georgia bulldogs'],
  'bama': ['alabama', 'alabama crimson tide'],
  'umass': ['massachusetts', 'umass minutemen'],
  'massachusetts': ['umass'],
  'niu': ['northern illinois', 'niu huskies'],
  'bgsu': ['bowling green', 'bowling green falcons'],
  'ecu': ['east carolina', 'ecu pirates'],
  'wsu': ['washington state'],
  'osu': ['ohio state', 'oklahoma state', 'oregon state'],
  'csu': ['colorado state'],
  'sdsu': ['san diego state'],
  'sjsu': ['san jose state'],
  'utep': ['texas el paso']
};

function normalizeTeamMatchText(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\(([^)]*)\)/g, ' $1 ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function expandTeamNameVariants(rawName) {
  const norm = normalizeTeamMatchText(rawName);
  if (!norm) return [];
  const variants = new Set([norm]);
  if (/\bst\b/.test(norm)) {
    variants.add(norm.replace(/\bst\b/g, 'state'));
  }
  if (/\bstate\b/.test(norm)) {
    variants.add(norm.replace(/\bstate\b/g, 'st'));
  }
  Array.from(variants).forEach((v) => {
    const directAliases = TEAM_MATCH_ALIASES[v];
    if (Array.isArray(directAliases)) {
      directAliases.forEach((a) => {
        const na = normalizeTeamMatchText(a);
        if (na) variants.add(na);
      });
    }
  });
  return Array.from(variants);
}

function scoreTeamTextMatch(rawTeamName, comp) {
  if (!rawTeamName || !comp) return 0;
  const targetVariants = expandTeamNameVariants(rawTeamName);
  if (targetVariants.length === 0) return 0;

  const compCandidates = [comp.displayName, comp.shortName, comp.location, comp.abbreviation]
    .flatMap(expandTeamNameVariants)
    .filter(Boolean);

  let bestScore = 0;
  targetVariants.forEach((target) => {
    compCandidates.forEach((cand) => {
      if (target === cand) {
        bestScore = Math.max(bestScore, 3);
      } else if (cand.length >= 4 && target.startsWith(`${cand} `)) {
        bestScore = Math.max(bestScore, 2);
      } else if (target.length >= 4 && cand.startsWith(`${target} `)) {
        bestScore = Math.max(bestScore, 2);
      }
    });
  });

  return bestScore;
}

function splitStreamMatchupParts(streamName) {
  const parts = String(streamName || '').split(/\s+(?:at|vs\.?|@)\s+/i);
  if (parts.length === 2) {
    return [parts[0].trim(), parts[1].trim()];
  }
  return null;
}

export function matchStreamToEspnEvent(stream, events) {
  if (!stream || !stream.name || !Array.isArray(events) || events.length === 0) {
    return null;
  }

  const parts = splitStreamMatchupParts(stream.name);
  if (!parts) return null;

  const [teamA, teamB] = parts;
  let bestEvent = null;
  let bestScore = 0;

  events.forEach((ev) => {
    const fwdA = scoreTeamTextMatch(teamA, ev.away);
    const fwdB = scoreTeamTextMatch(teamB, ev.home);
    const fwdTotal = fwdA > 0 && fwdB > 0 ? fwdA + fwdB : 0;

    const flipA = scoreTeamTextMatch(teamA, ev.home);
    const flipB = scoreTeamTextMatch(teamB, ev.away);
    const flipTotal = flipA > 0 && flipB > 0 ? flipA + flipB : 0;

    const total = Math.max(fwdTotal, flipTotal);
    if (total > bestScore) {
      bestScore = total;
      bestEvent = ev;
    }
  });

  return bestEvent;
}

function findBestStreamInListForEvent(event, streams) {
  if (!event || !event.away || !event.home || !Array.isArray(streams) || streams.length === 0) {
    return null;
  }
  let bestStream = null;
  let bestScore = 0;

  streams.forEach((stream) => {
    if (!stream || !stream.name || !Array.isArray(stream.feeds) || stream.feeds.length === 0) {
      return;
    }
    const parts = splitStreamMatchupParts(stream.name);
    if (!parts) return;

    const [teamA, teamB] = parts;
    const fwdA = scoreTeamTextMatch(teamA, event.away);
    const fwdB = scoreTeamTextMatch(teamB, event.home);
    const fwdTotal = fwdA > 0 && fwdB > 0 ? fwdA + fwdB : 0;

    const flipA = scoreTeamTextMatch(teamA, event.home);
    const flipB = scoreTeamTextMatch(teamB, event.away);
    const flipTotal = flipA > 0 && flipB > 0 ? flipA + flipB : 0;

    const total = Math.max(fwdTotal, flipTotal);
    if (total === 0) return;

    if (
      total > bestScore ||
      (total === bestScore && stream.isLiveNow && bestStream && !bestStream.isLiveNow)
    ) {
      bestScore = total;
      bestStream = stream;
    }
  });

  return bestStream;
}

export function findStreamForEspnEvent(event, state) {
  if (!event || !state) return null;
  const preferred = state.watchSource || 'ppv';
  const orderedSources = [
    preferred,
    ...STREAM_SOURCES.map((s) => s.id).filter((id) => id !== preferred)
  ];
  const getList = (srcId) => {
    if (srcId === 'thetvapp') return state.tvAppStreams || [];
    if (srcId === 'strmfree') return state.strmFreeStreams || [];
    return state.ppvStreams || [];
  };

  for (const srcId of orderedSources) {
    const match = findBestStreamInListForEvent(event, getList(srcId));
    if (match) return match;
  }
  return null;
}

function scoreDirectTeamPairMatch(rawA, rawB) {
  const varsA = expandTeamNameVariants(rawA);
  const varsB = expandTeamNameVariants(rawB);
  let best = 0;
  varsA.forEach((a) => {
    varsB.forEach((b) => {
      if (a === b) {
        best = Math.max(best, 3);
      } else if (a.length >= 4 && b.startsWith(`${a} `)) {
        best = Math.max(best, 2);
      } else if (b.length >= 4 && a.startsWith(`${b} `)) {
        best = Math.max(best, 2);
      }
    });
  });
  return best;
}

export function findMatchingStreamInSource(referenceStreamOrSlot, candidateStreams, allEvents = []) {
  if (!referenceStreamOrSlot || !Array.isArray(candidateStreams) || candidateStreams.length === 0) {
    return null;
  }

  const refEvent = allEvents.length > 0 ? matchStreamToEspnEvent(referenceStreamOrSlot, allEvents) : null;
  if (refEvent) {
    const byEvent = candidateStreams.find((cand) => {
      const candEvent = matchStreamToEspnEvent(cand, allEvents);
      return candEvent && String(candEvent.id) === String(refEvent.id);
    });
    if (byEvent) return byEvent;
  }

  const refParts = splitStreamMatchupParts(referenceStreamOrSlot.name);
  if (refParts) {
    let bestCand = null;
    let bestScore = 0;
    candidateStreams.forEach((cand) => {
      const candParts = splitStreamMatchupParts(cand.name);
      if (!candParts) return;

      const fwdA = scoreDirectTeamPairMatch(refParts[0], candParts[0]);
      const fwdB = scoreDirectTeamPairMatch(refParts[1], candParts[1]);
      const fwdTotal = fwdA > 0 && fwdB > 0 ? fwdA + fwdB : 0;

      const flipA = scoreDirectTeamPairMatch(refParts[0], candParts[1]);
      const flipB = scoreDirectTeamPairMatch(refParts[1], candParts[0]);
      const flipTotal = flipA > 0 && flipB > 0 ? flipA + flipB : 0;

      const total = Math.max(fwdTotal, flipTotal);
      if (total > bestScore) {
        bestScore = total;
        bestCand = cand;
      }
    });
    if (bestCand) return bestCand;
  }

  const refNameNorm = normalizeTeamMatchText(referenceStreamOrSlot.name);
  if (refNameNorm) {
    const exactTitle = candidateStreams.find((c) => normalizeTeamMatchText(c.name) === refNameNorm);
    if (exactTitle) return exactTitle;
  }

  return null;
}

export async function getPpvStreams({ force = false } = {}) {
  if (!force && ppvCache.data && ppvCache.expiresAt > Date.now()) {
    return ppvCache.data;
  }

  const proxyUrl = `/api/ppv/streams${force ? '?force=1' : ''}`;
  let raw;
  try {
    const res = await fetch(proxyUrl);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    raw = await res.json();
  } catch (proxyErr) {
    const directRes = await fetch('https://api.ppv.st/api/streams');
    if (!directRes.ok) {
      throw new Error(proxyErr?.message || `HTTP ${directRes.status}`);
    }
    raw = await directRes.json();
  }

  const nowTs = Number(raw?.timestamp) || Math.floor(Date.now() / 1000);
  const rawCats = Array.isArray(raw?.streams) ? raw.streams : [];
  const categories = [];
  const streams = [];
  const seenIds = new Set();

  rawCats.forEach((cat) => {
    const catName = String(cat?.category || 'Other');
    const catStreams = Array.isArray(cat?.streams) ? cat.streams : [];
    categories.push({
      id: String(cat?.id || catName),
      name: catName,
      alwaysLive: Boolean(cat?.always_live),
      count: catStreams.length
    });

    catStreams.forEach((s) => {
      const sid = String(s?.id || '');
      if (!sid || seenIds.has(sid)) return;
      seenIds.add(sid);

      const primaryFeed = s?.iframe
        ? {
            id: sid,
            label: s.source_tag || s.tag || 'HD | Main',
            iframe: s.iframe,
            uriName: s.uri_name || '',
            source: 'ppv'
          }
        : null;

      const subFeeds = Array.isArray(s?.substreams)
        ? s.substreams
            .filter((sub) => Boolean(sub?.iframe))
            .map((sub) => ({
              id: String(sub.id || `${sid}-${sub.uri_name || sub.uri || Math.random()}`),
              label: sub.source_tag || sub.name || 'Alt Feed',
              iframe: sub.iframe,
              uriName: sub.uri_name || sub.uri || '',
              source: 'ppv'
            }))
        : [];

      const seenFeedUrls = new Set();
      const feeds = [primaryFeed, ...subFeeds].filter((f) => {
        if (!f || !f.iframe || seenFeedUrls.has(f.iframe)) return false;
        seenFeedUrls.add(f.iframe);
        return true;
      });

      if (feeds.length === 0) return;

      const uriName = String(s.uri_name || '');
      const tag = String(s.tag || '');
      const isCfb = tag === 'College Football' || uriName.startsWith('cfb/');
      const isFootball = catName === 'American Football' || isCfb;
      const startsAt = Number(s.starts_at || 0);
      const endsAt = Number(s.ends_at || 0);
      const alwaysLive = Boolean(s.always_live);
      const isLiveNow =
        alwaysLive || (startsAt > 0 && startsAt <= nowTs && (endsAt === 0 || nowTs <= endsAt));
      const viewers = Number(String(s.viewers || '0').replace(/,/g, '')) || 0;
      const externalUrl = uriName ? `https://ppv.st/live/${uriName}` : 'https://ppv.st';

      streams.push({
        id: sid,
        source: 'ppv',
        sourceLabel: 'ppv.st',
        name: String(s.name || 'Live Stream'),
        tag,
        category: catName,
        sourceTag: String(s.source_tag || tag || feeds[0].label || 'HD'),
        broadcast: '',
        poster: String(s.poster || ''),
        colors: Array.isArray(s.colors) && s.colors.length >= 2 ? s.colors : ['#006c47', '#3c6472'],
        uriName,
        ppvUrl: externalUrl,
        externalUrl,
        startsAt,
        endsAt,
        timeLabel: '',
        alwaysLive,
        isLiveNow,
        isCfb,
        isFootball,
        viewers,
        viewersDisplay: String(s.viewers || '0'),
        iframe: feeds[0].iframe,
        feeds
      });
    });
  });

  streams.sort((a, b) => {
    if (a.isCfb !== b.isCfb) return a.isCfb ? -1 : 1;
    if (a.isLiveNow !== b.isLiveNow) return a.isLiveNow ? -1 : 1;
    if (b.viewers !== a.viewers) return b.viewers - a.viewers;
    return (a.startsAt || 0) - (b.startsAt || 0);
  });

  const payload = { timestamp: nowTs, categories, streams };
  ppvCache.data = payload;
  ppvCache.expiresAt = Date.now() + 15000;
  return payload;
}

export async function getTheTvAppStreams({ force = false } = {}) {
  if (!force && tvAppCache.data && tvAppCache.expiresAt > Date.now()) {
    return tvAppCache.data;
  }

  const res = await fetch(`/api/thetvapp/streams${force ? '?force=1' : ''}`);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const raw = await res.json();
  const nowTs = Number(raw?.timestamp) || Math.floor(Date.now() / 1000);
  const rawStreams = Array.isArray(raw?.streams) ? raw.streams : [];
  const categories = Array.isArray(raw?.categories) ? raw.categories : [];

  const streams = rawStreams
    .map((s) => {
      const feeds = (Array.isArray(s.feeds) ? s.feeds : [])
        .filter((f) => Boolean(f?.iframe))
        .map((f) => ({
          id: String(f.id),
          label: String(f.label || 'Server 1'),
          iframe: String(f.iframe),
          uriName: String(f.uriName || s.uriName || ''),
          source: 'thetvapp'
        }));

      if (feeds.length === 0) return null;

      const externalUrl = String(s.externalUrl || 'https://thetvapp.plus');
      return {
        id: String(s.id),
        source: 'thetvapp',
        sourceLabel: 'thetvapp.plus',
        name: String(s.name || 'Live Stream'),
        tag: String(s.tag || 'College Football'),
        category: String(s.category || 'College Football'),
        sourceTag: String(s.sourceTag || 'thetvapp.plus'),
        broadcast: String(s.broadcast || ''),
        poster: String(s.poster || ''),
        colors: ['#006c47', '#265b6e'],
        uriName: String(s.uriName || ''),
        ppvUrl: externalUrl,
        externalUrl,
        startsAt: Number(s.startsAt || 0),
        endsAt: Number(s.endsAt || 0),
        timeLabel: String(s.timeLabel || ''),
        alwaysLive: Boolean(s.alwaysLive),
        isLiveNow: Boolean(s.isLiveNow),
        isCfb: Boolean(s.isCfb),
        isFootball: Boolean(s.isFootball),
        viewers: 0,
        viewersDisplay: '',
        iframe: feeds[0].iframe,
        feeds
      };
    })
    .filter(Boolean);

  streams.sort((a, b) => {
    if (a.isCfb !== b.isCfb) return a.isCfb ? -1 : 1;
    if (a.isLiveNow !== b.isLiveNow) return a.isLiveNow ? -1 : 1;
    return (a.startsAt || Number.MAX_SAFE_INTEGER) - (b.startsAt || Number.MAX_SAFE_INTEGER);
  });

  const payload = { timestamp: nowTs, categories, streams };
  tvAppCache.data = payload;
  tvAppCache.expiresAt = Date.now() + 15000;
  return payload;
}

export async function getStrmFreeStreams({ force = false } = {}) {
  if (!force && strmFreeCache.data && strmFreeCache.expiresAt > Date.now()) {
    return strmFreeCache.data;
  }

  const res = await fetch(`/api/strmfree/streams${force ? '?force=1' : ''}`);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const raw = await res.json();
  const nowTs = Number(raw?.timestamp) || Math.floor(Date.now() / 1000);
  const rawStreams = Array.isArray(raw?.streams) ? raw.streams : [];
  const categories = Array.isArray(raw?.categories) ? raw.categories : [];

  const streams = rawStreams
    .map((s) => {
      const feeds = (Array.isArray(s.feeds) ? s.feeds : [])
        .filter((f) => Boolean(f?.iframe))
        .map((f) => ({
          id: String(f.id),
          label: String(f.label || 'Direct · FHD'),
          iframe: String(f.iframe),
          uriName: String(f.uriName || s.uriName || ''),
          source: 'strmfree'
        }));

      if (feeds.length === 0) return null;

      const externalUrl = String(s.externalUrl || 'https://strmfree.pk');
      const viewers = Number(s.viewers || 0);
      return {
        id: String(s.id),
        source: 'strmfree',
        sourceLabel: 'strmfree.pk',
        name: String(s.name || 'Live Stream'),
        tag: String(s.tag || 'College Football'),
        category: String(s.category || 'College Football'),
        sourceTag: String(s.sourceTag || 'strmfree.pk'),
        broadcast: String(s.broadcast || ''),
        poster: String(s.poster || ''),
        colors: ['#6b3fa0', '#1d4ed8'],
        uriName: String(s.uriName || ''),
        ppvUrl: externalUrl,
        externalUrl,
        startsAt: Number(s.startsAt || 0),
        endsAt: Number(s.endsAt || 0),
        timeLabel: String(s.timeLabel || ''),
        alwaysLive: Boolean(s.alwaysLive),
        isLiveNow: Boolean(s.isLiveNow),
        isCfb: Boolean(s.isCfb),
        isFootball: Boolean(s.isFootball),
        hasActiveSources: Boolean(s.hasActiveSources),
        viewers,
        viewersDisplay: viewers > 0 ? String(viewers) : '',
        iframe: feeds[0].iframe,
        feeds
      };
    })
    .filter(Boolean);

  streams.sort((a, b) => {
    if (a.isCfb !== b.isCfb) return a.isCfb ? -1 : 1;
    if (a.hasActiveSources !== b.hasActiveSources) return a.hasActiveSources ? -1 : 1;
    if (a.isLiveNow !== b.isLiveNow) return a.isLiveNow ? -1 : 1;
    if (b.viewers !== a.viewers) return b.viewers - a.viewers;
    return (a.startsAt || Number.MAX_SAFE_INTEGER) - (b.startsAt || Number.MAX_SAFE_INTEGER);
  });

  const payload = { timestamp: nowTs, categories, streams };
  strmFreeCache.data = payload;
  strmFreeCache.expiresAt = Date.now() + 15000;
  return payload;
}
