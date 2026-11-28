'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');
const zlib = require('zlib');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const ALLOWED_HOSTS = {
  'site.api.espn.com': true,
  'site.web.api.espn.com': true
};
const PPV_STREAMS_URL = 'https://api.ppv.st/api/streams';
const PPV_CACHE_KEY = 'ppv:streams';
const PPV_CACHE_TTL_MS = 15000;

const TIMSTREAMS_ORIGIN = 'https://tim-streams.com';
const TIMSTREAMS_API_URL = 'https://tim-streams.com/api/live-upcoming';
const TIMSTREAMS_CACHE_KEY = 'timstreams:streams';
const TIMSTREAMS_CACHE_TTL_MS = 30 * 1000;

const STRMFREE_ORIGIN = 'https://strmfree.pk';
const STRMFREE_API_STREAMS_URL = 'https://strmfree.pk/api/v1/streams';
const STRMFREE_LEGACY_STREAMS_URL = 'https://strmfree.pk/streams';
const STRMFREE_CACHE_KEY = 'strmfree:streams';
const STRMFREE_CACHE_TTL_MS = 30 * 1000;
const STRMFREE_MIRROR_HOSTS = new Set(['strmfree.pk', 'strmfree.st', 'streamfree.top']);

const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

const SEASON_RESULTS_TTL_MS = 300000;
const espnKeepAliveAgent = new https.Agent({ keepAlive: true, maxSockets: 16 });
const seasonResultsCache = new Map();
const seasonResultsInFlight = new Map();

const CFP_ORIGIN = 'https://collegefootballplayoff.com';
const CFP_G6_FOUND_TTL_MS = 30 * 60 * 1000;
const CFP_G6_MISS_TTL_MS = 5 * 60 * 1000;
const cfpG6Cache = new Map();
const cfpG6InFlight = new Map();

// Simple in-memory GET cache: url -> { expiresAt, body, statusCode }
const proxyCache = new Map();

function getProxyTtlMs(targetUrl) {
  if (
    targetUrl.indexOf('/standings') !== -1 ||
    targetUrl.indexOf('/rankings') !== -1 ||
    targetUrl.indexOf('/teams') !== -1
  ) {
    return 60000;
  }
  return 10000;
}

function pruneCacheIfNeeded() {
  if (proxyCache.size <= 200) {
    return;
  }
  const now = Date.now();
  proxyCache.forEach(function (entry, key) {
    if (entry.expiresAt <= now) {
      proxyCache.delete(key);
    }
  });
  if (proxyCache.size > 200) {
    proxyCache.clear();
  }
}

function sendJson(res, statusCode, payload) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-cache'
  });
  res.end(body);
}

function decodeHttpBodyBuffer(rawBuffer, contentEncoding) {
  if (!rawBuffer || rawBuffer.length === 0) return rawBuffer;
  const enc = String(contentEncoding || '').toLowerCase().trim();
  if (enc.indexOf('gzip') !== -1 || (!enc && rawBuffer.length >= 2 && rawBuffer[0] === 0x1f && rawBuffer[1] === 0x8b)) {
    try {
      return zlib.gunzipSync(rawBuffer);
    } catch (err) {
      return rawBuffer;
    }
  }
  if (enc.indexOf('deflate') !== -1) {
    try {
      return zlib.inflateSync(rawBuffer);
    } catch (err) {
      return rawBuffer;
    }
  }
  if (enc.indexOf('br') !== -1 && typeof zlib.brotliDecompressSync === 'function') {
    try {
      return zlib.brotliDecompressSync(rawBuffer);
    } catch (err) {
      return rawBuffer;
    }
  }
  return rawBuffer;
}

function fetchEspnJsonWithAgent(targetUrl, timeoutMs) {
  return new Promise(function (resolve, reject) {
    let parsedTarget;
    try {
      parsedTarget = new url.URL(targetUrl);
    } catch (err) {
      reject(new Error('Invalid ESPN URL: ' + targetUrl));
      return;
    }
    const req = https.get(
      {
        protocol: parsedTarget.protocol,
        hostname: parsedTarget.hostname,
        port: parsedTarget.port || 443,
        path: parsedTarget.pathname + parsedTarget.search,
        agent: espnKeepAliveAgent,
        headers: {
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip, deflate',
          'User-Agent': 'CFB-Tracker/1.0'
        },
        timeout: timeoutMs || 15000
      },
      function (upstreamRes) {
        const chunks = [];
        upstreamRes.on('data', function (chunk) {
          chunks.push(chunk);
        });
        upstreamRes.on('end', function () {
          const statusCode = upstreamRes.statusCode || 502;
          const enc = upstreamRes.headers && upstreamRes.headers['content-encoding'];
          const text = decodeHttpBodyBuffer(Buffer.concat(chunks), enc).toString('utf8');
          if (statusCode < 200 || statusCode >= 300) {
            reject(new Error('ESPN HTTP ' + statusCode));
            return;
          }
          try {
            resolve(JSON.parse(text));
          } catch (parseErr) {
            reject(new Error('Invalid ESPN JSON response'));
          }
        });
      }
    );
    req.on('timeout', function () {
      req.abort();
      const timeoutErr = new Error('Upstream ESPN API request timed out');
      timeoutErr.isTimeout = true;
      reject(timeoutErr);
    });
    req.on('error', reject);
  });
}

function extractServerTeamLogo(team) {
  if (!team || typeof team !== 'object') return '';
  const logos = Array.isArray(team.logos) ? team.logos : [];
  let chosen = '';
  for (let i = 0; i < logos.length; i++) {
    const l = logos[i];
    if (l && Array.isArray(l.rel) && l.rel.indexOf('default') !== -1 && l.rel.indexOf('dark') === -1 && l.href) {
      chosen = l.href;
      break;
    }
  }
  if (!chosen && typeof team.logo === 'string' && team.logo) {
    chosen = team.logo;
  }
  if (!chosen) {
    for (let i = 0; i < logos.length; i++) {
      const l = logos[i];
      if (l && (!Array.isArray(l.rel) || l.rel.indexOf('dark') === -1) && l.href) {
        chosen = l.href;
        break;
      }
    }
  }
  if (!chosen && logos[0] && logos[0].href) {
    chosen = logos[0].href;
  }
  return String(chosen || '').replace(/\/500-dark\//gi, '/500/');
}

function parseCompetitorScore(rawScore) {
  if (rawScore === undefined || rawScore === null || rawScore === '') return NaN;
  if (typeof rawScore === 'object') {
    if (rawScore.value !== undefined && rawScore.value !== null) return Number(rawScore.value);
    if (rawScore.displayValue !== undefined && rawScore.displayValue !== null) return Number(rawScore.displayValue);
    return NaN;
  }
  return Number(rawScore);
}

function collectElapsedWeekTasks(calPayload, groupId, cutoffMs) {
  const tasks = [];
  const league = calPayload && Array.isArray(calPayload.leagues) ? calPayload.leagues[0] : null;
  const calendar = league && Array.isArray(league.calendar) ? league.calendar : [];

  for (let i = 0; i < calendar.length; i++) {
    const sec = calendar[i];
    const st = sec && sec.value !== undefined ? String(sec.value) : '';
    if (st !== '2' && st !== '3') continue;
    const entries = Array.isArray(sec.entries) ? sec.entries : [];
    for (let j = 0; j < entries.length; j++) {
      const en = entries[j];
      if (!en || en.value === undefined) continue;
      const startMs = en.startDate ? new Date(en.startDate).getTime() : 0;
      if (!startMs || Number.isNaN(startMs) || startMs <= cutoffMs) {
        tasks.push({
          grp: String(groupId),
          st: st,
          wk: String(en.value),
          label: en.label || en.alternateLabel || ('Week ' + en.value)
        });
      }
    }
  }

  if (tasks.length === 0) {
    for (let wk = 1; wk <= 16; wk++) {
      tasks.push({
        grp: String(groupId),
        st: '2',
        wk: String(wk),
        label: 'Week ' + wk
      });
    }
  }
  return tasks;
}

async function fetchSeasonResultsPayload(requestedSeason) {
  const validSeason = /^\d{4}$/.test(String(requestedSeason || '')) ? String(requestedSeason) : '';
  const seasonSuffix = validSeason ? '&dates=' + validSeason : '';

  const [s80, s81] = await Promise.all([
    fetchEspnJsonWithAgent(
      'https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=80&limit=5' + seasonSuffix,
      15000
    ),
    fetchEspnJsonWithAgent(
      'https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=81&limit=5' + seasonSuffix,
      15000
    ).catch(function () {
      return {};
    })
  ]);

  const seasonYear = Number(
    validSeason ||
      (s80 && s80.season && s80.season.year) ||
      (s80 && s80.leagues && s80.leagues[0] && s80.leagues[0].season && s80.leagues[0].season.year) ||
      new Date().getFullYear()
  );

  const cutoffMs = Date.now() + 86400000;
  const tasks80 = collectElapsedWeekTasks(s80, '80', cutoffMs);
  const tasks81 = collectElapsedWeekTasks(s81, '81', cutoffMs);
  const allTasks = tasks80.concat(tasks81);

  const pages = await Promise.all(
    allTasks.map(function (tk) {
      const pageUrl =
        'https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=' +
        tk.grp +
        '&dates=' +
        seasonYear +
        '&seasontype=' +
        tk.st +
        '&week=' +
        tk.wk +
        '&limit=300';
      return fetchEspnJsonWithAgent(pageUrl, 15000)
        .then(function (data) {
          return { tk: tk, events: Array.isArray(data && data.events) ? data.events : [] };
        })
        .catch(function () {
          return { tk: tk, events: [] };
        });
    })
  );

  const seenEventIds = new Set();
  const teams = {};
  const games = [];

  for (let p = 0; p < pages.length; p++) {
    const page = pages[p];
    const events = page.events;
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (!ev || !ev.id) continue;
      const evId = String(ev.id);
      if (seenEventIds.has(evId)) continue;
      seenEventIds.add(evId);

      const comp = Array.isArray(ev.competitions) ? ev.competitions[0] : null;
      const statusObj = ev.status || (comp && comp.status) || {};
      const stType = statusObj.type || {};
      if (stType.name === 'STATUS_CANCELED' || stType.name === 'STATUS_POSTPONED') continue;
      if (!stType.completed && stType.state !== 'post') continue;

      const competitors = comp && Array.isArray(comp.competitors) ? comp.competitors : [];
      if (competitors.length < 2) continue;

      const cAway = competitors.find(function (c) { return c && c.homeAway === 'away'; }) || competitors[1];
      const cHome = competitors.find(function (c) { return c && c.homeAway === 'home'; }) || competitors[0];
      if (!cAway || !cHome) continue;

      const awayTeam = cAway.team || {};
      const homeTeam = cHome.team || {};
      const awayId = String(cAway.id || awayTeam.id || '');
      const homeId = String(cHome.id || homeTeam.id || '');
      if (!awayId || !homeId || awayId === homeId || /^-\d+$/.test(awayId) || /^-\d+$/.test(homeId)) continue;

      const awayScore = parseCompetitorScore(cAway.score);
      const homeScore = parseCompetitorScore(cHome.score);
      if (!Number.isFinite(awayScore) || !Number.isFinite(homeScore) || awayScore === homeScore) continue;

      const homeWon = cHome.winner === true ? true : cAway.winner === true ? false : homeScore > awayScore;
      const winnerId = homeWon ? homeId : awayId;
      const loserId = homeWon ? awayId : homeId;
      const winnerScore = homeWon ? homeScore : awayScore;
      const loserScore = homeWon ? awayScore : homeScore;

      [
        { id: awayId, raw: awayTeam },
        { id: homeId, raw: homeTeam }
      ].forEach(function (item) {
        const existing = teams[item.id];
        const logo = extractServerTeamLogo(item.raw);
        if (!existing || (!existing.logo && logo)) {
          teams[item.id] = {
            id: item.id,
            displayName: item.raw.displayName || item.raw.location || 'Team',
            shortName: item.raw.shortDisplayName || item.raw.nickname || item.raw.location || 'Team',
            location: item.raw.location || '',
            abbreviation: item.raw.abbreviation || item.raw.shortDisplayName || '',
            color: item.raw.color ? '#' + String(item.raw.color).replace(/^#/, '') : null,
            alternateColor: item.raw.alternateColor ? '#' + String(item.raw.alternateColor).replace(/^#/, '') : null,
            logo: logo || (existing ? existing.logo : '')
          };
        }
      });

      const weekNum = ev.week && ev.week.number ? Number(ev.week.number) : Number(page.tk.wk) || null;
      const seasonType = String(
        (ev.seasonType && (ev.seasonType.id || ev.seasonType.type)) ||
          (ev.season && ev.season.type) ||
          page.tk.st ||
          '2'
      );
      const weekLabel =
        (ev.week && (ev.week.text || (ev.week.number ? 'Week ' + ev.week.number : ''))) ||
        page.tk.label ||
        (seasonType === '3' ? 'Postseason' : weekNum ? 'Week ' + weekNum : '');

      const awayAbbr = teams[awayId].abbreviation || teams[awayId].shortName || 'AWAY';
      const homeAbbr = teams[homeId].abbreviation || teams[homeId].shortName || 'HOME';

      games.push({
        id: evId,
        date: ev.date || (comp && comp.date) || '',
        seasonType: seasonType,
        weekNumber: weekNum,
        weekLabel: weekLabel,
        shortName: ev.shortName || (awayAbbr + ' @ ' + homeAbbr),
        neutralSite: Boolean(comp && comp.neutralSite),
        winnerId: winnerId,
        loserId: loserId,
        winnerScore: winnerScore,
        loserScore: loserScore,
        margin: winnerScore - loserScore,
        homeId: homeId,
        awayId: awayId,
        homeScore: homeScore,
        awayScore: awayScore
      });
    }
  }

  return {
    seasonYear: seasonYear,
    generatedAt: Date.now(),
    completedCount: games.length,
    teamCount: Object.keys(teams).length,
    games: games,
    teams: teams
  };
}

function handleSeasonResultsProxy(reqUrl, res) {
  const parsedQuery = reqUrl.query || {};
  const requestedSeason = /^\d{4}$/.test(String(parsedQuery.season || '')) ? String(parsedQuery.season) : '';
  const force = parsedQuery.force === '1';
  const cacheKey = requestedSeason || 'current';

  if (!force) {
    const cached = seasonResultsCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Proxy-Cache': 'HIT',
        'Cache-Control': 'no-cache'
      });
      res.end(cached.body);
      return;
    }
  }

  let promise = seasonResultsInFlight.get(cacheKey);
  if (!promise) {
    promise = fetchSeasonResultsPayload(requestedSeason).then(
      function (data) {
        const body = JSON.stringify(data);
        seasonResultsCache.set(cacheKey, {
          body: body,
          expiresAt: Date.now() + SEASON_RESULTS_TTL_MS
        });
        seasonResultsInFlight.delete(cacheKey);
        return body;
      },
      function (err) {
        seasonResultsInFlight.delete(cacheKey);
        throw err;
      }
    );
    seasonResultsInFlight.set(cacheKey, promise);
  }

  promise
    .then(function (body) {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Proxy-Cache': 'MISS',
        'Cache-Control': 'no-cache'
      });
      res.end(body);
    })
    .catch(function (err) {
      if (!res.headersSent) {
        sendJson(res, err && err.isTimeout ? 504 : 502, {
          error: 'Failed to aggregate season results from ESPN',
          details: err && err.message ? err.message : 'Unknown error'
        });
      }
    });
}

function handleEspnProxy(reqUrl, res) {
  const parsedQuery = reqUrl.query || {};
  const target = parsedQuery.target;
  const isOptional = parsedQuery.optional === '1';
  if (!target || typeof target !== 'string') {
    sendJson(res, 400, { error: 'Missing target query parameter' });
    return;
  }

  let parsedTarget;
  try {
    parsedTarget = new url.URL(target);
  } catch (err) {
    sendJson(res, 400, { error: 'Invalid target URL' });
    return;
  }

  if (parsedTarget.protocol !== 'https:' || !ALLOWED_HOSTS[parsedTarget.hostname]) {
    sendJson(res, 403, { error: 'Host not permitted by ESPN proxy' });
    return;
  }

  const normalizedTarget = parsedTarget.toString();
  const cached = proxyCache.get(normalizedTarget);
  if (cached && cached.expiresAt > Date.now()) {
    res.writeHead(cached.statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Proxy-Cache': 'HIT',
      'Cache-Control': 'no-cache'
    });
    res.end(cached.body);
    return;
  }

  const upstreamReq = https.get(
    normalizedTarget,
    {
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'User-Agent': 'CFB-Tracker/1.0'
      },
      timeout: 12000
    },
    function (upstreamRes) {
      const chunks = [];
      upstreamRes.on('data', function (chunk) {
        chunks.push(chunk);
      });
      upstreamRes.on('end', function () {
        const rawBuf = Buffer.concat(chunks);
        const contentEncoding = upstreamRes.headers && upstreamRes.headers['content-encoding'];
        let body = decodeHttpBodyBuffer(rawBuf, contentEncoding).toString('utf8');
        let statusCode = upstreamRes.statusCode || 502;
        if (isOptional && (statusCode === 404 || statusCode === 400)) {
          statusCode = 200;
          body = '{"empty":true}';
        }
        if (statusCode >= 200 && statusCode < 300) {
          pruneCacheIfNeeded();
          proxyCache.set(normalizedTarget, {
            statusCode: statusCode,
            body: body,
            expiresAt: Date.now() + getProxyTtlMs(normalizedTarget)
          });
        }
        res.writeHead(statusCode, {
          'Content-Type': 'application/json; charset=utf-8',
          'X-Proxy-Cache': 'MISS',
          'Cache-Control': 'no-cache'
        });
        res.end(body);
      });
    }
  );

  upstreamReq.on('timeout', function () {
    upstreamReq.abort();
    if (!res.headersSent) {
      sendJson(res, 504, { error: 'Upstream ESPN API request timed out' });
    }
  });

  upstreamReq.on('error', function (err) {
    if (!res.headersSent) {
      sendJson(res, 502, { error: 'Upstream ESPN API error', details: err.message });
    }
  });
}

function handlePpvProxy(reqUrl, res) {
  const parsedQuery = reqUrl.query || {};
  const force = parsedQuery.force === '1';
  const cached = proxyCache.get(PPV_CACHE_KEY);
  if (!force && cached && cached.expiresAt > Date.now()) {
    res.writeHead(cached.statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'X-Proxy-Cache': 'HIT',
      'Cache-Control': 'no-cache'
    });
    res.end(cached.body);
    return;
  }

  const upstreamReq = https.get(
    PPV_STREAMS_URL,
    {
      headers: {
        'Accept': 'application/json',
        'User-Agent': BROWSER_USER_AGENT,
        'Origin': 'https://ppv.st',
        'Referer': 'https://ppv.st/'
      },
      timeout: 12000
    },
    function (upstreamRes) {
      const chunks = [];
      upstreamRes.on('data', function (chunk) {
        chunks.push(chunk);
      });
      upstreamRes.on('end', function () {
        const body = Buffer.concat(chunks).toString('utf8');
        const statusCode = upstreamRes.statusCode || 502;
        if (statusCode >= 200 && statusCode < 300) {
          pruneCacheIfNeeded();
          proxyCache.set(PPV_CACHE_KEY, {
            statusCode: statusCode,
            body: body,
            expiresAt: Date.now() + PPV_CACHE_TTL_MS
          });
        }
        res.writeHead(statusCode, {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
          'X-Proxy-Cache': 'MISS',
          'Cache-Control': 'no-cache'
        });
        res.end(body);
      });
    }
  );

  upstreamReq.on('timeout', function () {
    upstreamReq.abort();
    if (!res.headersSent) {
      sendJson(res, 504, { error: 'Upstream PPV API request timed out' });
    }
  });

  upstreamReq.on('error', function (err) {
    if (!res.headersSent) {
      sendJson(res, 502, { error: 'Upstream PPV API error', details: err.message });
    }
  });
}

// ==================== HTTP TEXT & HTML HELPERS ====================

function decompressBuffer(buf, encoding) {
  return new Promise(function (resolve, reject) {
    const enc = String(encoding || '').toLowerCase().trim();
    if (enc.indexOf('gzip') !== -1) {
      zlib.gunzip(buf, function (err, out) {
        if (err) reject(err);
        else resolve(out);
      });
      return;
    }
    if (enc.indexOf('deflate') !== -1) {
      zlib.inflate(buf, function (err, out) {
        if (err) reject(err);
        else resolve(out);
      });
      return;
    }
    if (enc.indexOf('br') !== -1 && typeof zlib.brotliDecompress === 'function') {
      zlib.brotliDecompress(buf, function (err, out) {
        if (err) reject(err);
        else resolve(out);
      });
      return;
    }
    resolve(buf);
  });
}

function fetchHttpText(targetUrl, extraHeaders, timeoutMs, redirectsLeft) {
  const remaining = typeof redirectsLeft === 'number' ? redirectsLeft : 4;
  return new Promise(function (resolve, reject) {
    let parsedTarget;
    try {
      parsedTarget = new url.URL(targetUrl);
    } catch (err) {
      reject(new Error('Invalid URL: ' + targetUrl));
      return;
    }

    if (parsedTarget.protocol !== 'https:' && parsedTarget.protocol !== 'http:') {
      reject(new Error('Unsupported protocol: ' + parsedTarget.protocol));
      return;
    }

    const transport = parsedTarget.protocol === 'http:' ? http : https;
    const headers = Object.assign(
      {
        'User-Agent': BROWSER_USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      extraHeaders || {}
    );

    const req = transport.get(
      {
        protocol: parsedTarget.protocol,
        hostname: parsedTarget.hostname,
        port: parsedTarget.port || (parsedTarget.protocol === 'http:' ? 80 : 443),
        path: parsedTarget.pathname + parsedTarget.search,
        headers: headers,
        timeout: timeoutMs || 12000
      },
      function (upstreamRes) {
        const statusCode = upstreamRes.statusCode || 502;
        const location = upstreamRes.headers && upstreamRes.headers.location;
        if (
          remaining > 0 &&
          location &&
          (statusCode === 301 || statusCode === 302 || statusCode === 303 || statusCode === 307 || statusCode === 308)
        ) {
          upstreamRes.resume();
          let nextUrl;
          try {
            nextUrl = new url.URL(location, parsedTarget).toString();
          } catch (err) {
            reject(err);
            return;
          }
          fetchHttpText(nextUrl, extraHeaders, timeoutMs, remaining - 1).then(resolve, reject);
          return;
        }

        const chunks = [];
        upstreamRes.on('data', function (chunk) {
          chunks.push(chunk);
        });
        upstreamRes.on('end', function () {
          const rawBuf = Buffer.concat(chunks);
          decompressBuffer(rawBuf, upstreamRes.headers && upstreamRes.headers['content-encoding'])
            .then(function (plainBuf) {
              resolve({
                statusCode: statusCode,
                headers: upstreamRes.headers || {},
                finalUrl: parsedTarget.toString(),
                body: plainBuf.toString('utf8')
              });
            })
            .catch(reject);
        });
      }
    );

    req.on('timeout', function () {
      req.abort();
      const timeoutErr = new Error('Upstream request timed out');
      timeoutErr.isTimeout = true;
      reject(timeoutErr);
    });

    req.on('error', reject);
  });
}

function decodeHtmlEntities(str) {
  return String(str || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&#x0*27;/gi, "'")
    .replace(/&#(\d+);/g, function (_, dec) {
      const code = Number(dec);
      return Number.isFinite(code) ? String.fromCharCode(code) : _;
    });
}

function stripHtmlTags(str) {
  return decodeHtmlEntities(String(str || '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function extractAttr(attrsStr, attrName) {
  const re = new RegExp('\\b' + attrName + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i');
  const m = String(attrsStr || '').match(re);
  if (!m) return '';
  return decodeHtmlEntities(m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3] || '');
}

// ==================== TIM-STREAMS.COM DIRECTORY PROXY ====================

function getEasternDstBoundsUtcMs(year) {
  const marFirstDow = new Date(Date.UTC(year, 2, 1)).getUTCDay();
  const marSecondSunday = 1 + ((7 - marFirstDow) % 7) + 7;
  const dstStartUtcMs = Date.UTC(year, 2, marSecondSunday, 7, 0, 0);

  const novFirstDow = new Date(Date.UTC(year, 10, 1)).getUTCDay();
  const novFirstSunday = 1 + ((7 - novFirstDow) % 7);
  const dstEndUtcMs = Date.UTC(year, 10, novFirstSunday, 6, 0, 0);

  return { dstStartUtcMs: dstStartUtcMs, dstEndUtcMs: dstEndUtcMs };
}

function parseEasternLocalTimestamp(timeStr) {
  const m = String(timeStr || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return 0;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6] || 0);
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    !Number.isFinite(hour) ||
    !Number.isFinite(minute)
  ) {
    return 0;
  }

  const naiveUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const bounds = getEasternDstBoundsUtcMs(year);
  const edtCandidateMs = naiveUtcMs + 4 * 3600 * 1000;
  const isEdt = edtCandidateMs >= bounds.dstStartUtcMs && edtCandidateMs < bounds.dstEndUtcMs;
  const offsetHours = isEdt ? 4 : 5;
  return Math.floor((naiveUtcMs + offsetHours * 3600 * 1000) / 1000);
}

function normalizeTimStreamsLogoUrl(rawLogo) {
  const trimmed = String(rawLogo || '').trim();
  if (!trimmed) return '';
  if (trimmed.indexOf('//') === 0) {
    return 'https:' + trimmed;
  }
  if (trimmed.charAt(0) === '/') {
    return TIMSTREAMS_ORIGIN + trimmed;
  }
  return trimmed;
}

function normalizeTimStreamsList(rawJson, nowSec) {
  const data = rawJson && typeof rawJson === 'object' ? rawJson : {};
  const rawEvents = Array.isArray(data.events) ? data.events : [];
  const rawGenres = Array.isArray(data.genres) ? data.genres : [];
  const curNowSec = Number.isFinite(Number(nowSec)) ? Number(nowSec) : Math.floor(Date.now() / 1000);

  const genreNameById = new Map();
  const subGenreNameByKey = new Map();
  rawGenres.forEach(function (g) {
    if (!g || g.id === undefined || g.id === null) return;
    const gid = String(g.id);
    genreNameById.set(gid, String(g.name || 'Sports'));
    const subs = Array.isArray(g.sub_categories) ? g.sub_categories : [];
    subs.forEach(function (sub) {
      if (!sub || sub.id === undefined || sub.id === null) return;
      subGenreNameByKey.set(gid + ':' + String(sub.id), String(sub.name || ''));
    });
  });

  const seenSlugs = new Set();
  const streams = [];

  rawEvents.forEach(function (item) {
    if (!item || typeof item !== 'object') return;
    const slug = String(item.url || '').trim();
    if (!slug || seenSlugs.has(slug)) return;
    seenSlugs.add(slug);

    const rawStreams = Array.isArray(item.streams) ? item.streams : [];
    const usableStreams = rawStreams.filter(function (s) {
      const u = s && typeof s.url === 'string' ? s.url.trim() : '';
      return /^https?:\/\//i.test(u);
    });
    if (usableStreams.length === 0) return;

    const freeStreams = usableStreams.filter(function (s) {
      return !s.vip;
    });
    const chosenStreams = freeStreams.length > 0 ? freeStreams : usableStreams;

    const feeds = [];
    const seenFeedUrls = new Set();
    chosenStreams.forEach(function (s, idx) {
      const feedUrl = String(s.url || '').trim();
      if (!feedUrl || seenFeedUrls.has(feedUrl)) return;
      seenFeedUrls.add(feedUrl);
      const rawLabel = String(s.name || '').trim() || 'Stream ' + (feeds.length + 1);
      feeds.push({
        id: 'timstreams-' + slug + '-' + (idx + 1),
        label: rawLabel,
        iframe: feedUrl,
        uriName: slug,
        source: 'timstreams'
      });
    });
    if (feeds.length === 0) return;

    const gid = item.genre !== undefined && item.genre !== null ? String(item.genre) : '';
    const sgid = item.sub_genre !== undefined && item.sub_genre !== null ? String(item.sub_genre) : '';
    const genreName = genreNameById.get(gid) || 'Sports';
    const subGenreName = sgid ? subGenreNameByKey.get(gid + ':' + sgid) || '' : '';

    const isFootball = gid === '8' || /football|ncaaf|nfl/i.test(genreName + ' ' + subGenreName);
    const isCfb =
      (gid === '8' && sgid === '2') ||
      /ncaa\s*football|college\s*football|\bncaaf\b|\bcfb\b/i.test(subGenreName);

    const category = isCfb ? 'College Football' : isFootball ? 'American Football' : subGenreName || genreName || 'Sports';
    const tag = isCfb
      ? 'NCAAF'
      : gid === '8' && sgid === '1'
        ? 'NFL'
        : subGenreName || genreName || 'Sports';

    const espnMatch = slug.match(/-(\d{8,10})$/);
    const espnEventId = espnMatch ? espnMatch[1] : '';

    const startsAt = parseEasternLocalTimestamp(item.time);
    const endsAt = startsAt > 0 ? startsAt + 4 * 3600 : 0;
    const isLiveNow = Boolean(startsAt > 0 && startsAt <= curNowSec + 900 && endsAt > curNowSec);
    const viewers = Number(item.viewers || 0) || 0;
    const primaryLabel = feeds[0].label || '';
    const broadcast = feeds
      .map(function (f) { return f.label; })
      .filter(Boolean)
      .slice(0, 2)
      .join(' / ');

    streams.push({
      id: 'timstreams-' + slug,
      source: 'timstreams',
      sourceLabel: 'tim-streams.com',
      name: String(item.name || 'Live Stream').trim(),
      tag: tag,
      category: category,
      sourceTag: primaryLabel ? 'HD | ' + primaryLabel : tag,
      broadcast: broadcast,
      poster: normalizeTimStreamsLogoUrl(item.logo),
      uriName: slug,
      espnEventId: espnEventId,
      externalUrl: TIMSTREAMS_ORIGIN + '/watch/' + encodeURIComponent(slug),
      startsAt: startsAt,
      endsAt: endsAt,
      timeLabel: '',
      alwaysLive: false,
      isLiveNow: isLiveNow,
      isCfb: isCfb,
      isFootball: isFootball,
      viewers: viewers,
      viewersDisplay: viewers > 0 ? String(viewers) : '',
      iframe: feeds[0].iframe,
      feeds: feeds
    });
  });

  streams.sort(function (a, b) {
    if (a.isCfb !== b.isCfb) return a.isCfb ? -1 : 1;
    if (a.isLiveNow !== b.isLiveNow) return a.isLiveNow ? -1 : 1;
    return (a.startsAt || Number.MAX_SAFE_INTEGER) - (b.startsAt || Number.MAX_SAFE_INTEGER);
  });

  const catCounts = new Map();
  streams.forEach(function (s) {
    const catName = s.category || 'Sports';
    catCounts.set(catName, (catCounts.get(catName) || 0) + 1);
  });
  const categories = Array.from(catCounts.entries()).map(function (entry) {
    return {
      id: entry[0],
      name: entry[0],
      alwaysLive: false,
      count: entry[1]
    };
  });

  return {
    timestamp: curNowSec,
    source: 'timstreams',
    categories: categories,
    streams: streams
  };
}

function handleTimStreamsProxy(reqUrl, res) {
  const parsedQuery = reqUrl.query || {};
  const force = parsedQuery.force === '1';
  const cached = proxyCache.get(TIMSTREAMS_CACHE_KEY);
  if (!force && cached && cached.expiresAt > Date.now()) {
    res.writeHead(cached.statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'X-Proxy-Cache': 'HIT',
      'Cache-Control': 'no-cache'
    });
    res.end(cached.body);
    return;
  }

  fetchHttpText(
    TIMSTREAMS_API_URL,
    {
      'Accept': 'application/json, text/plain, */*',
      'Referer': TIMSTREAMS_ORIGIN + '/',
      'Origin': TIMSTREAMS_ORIGIN
    },
    12000
  )
    .then(function (upstreamRes) {
      if (upstreamRes.statusCode < 200 || upstreamRes.statusCode >= 300) {
        sendJson(res, upstreamRes.statusCode || 502, {
          error: 'Upstream tim-streams.com HTTP ' + upstreamRes.statusCode
        });
        return;
      }

      let rawJson;
      try {
        rawJson = JSON.parse(upstreamRes.body || '{}');
      } catch (parseErr) {
        sendJson(res, 502, {
          error: 'Invalid JSON from tim-streams.com',
          details: parseErr.message
        });
        return;
      }

      const nowSec = Math.floor(Date.now() / 1000);
      const normalized = normalizeTimStreamsList(rawJson, nowSec);
      const payload = JSON.stringify(normalized);

      pruneCacheIfNeeded();
      proxyCache.set(TIMSTREAMS_CACHE_KEY, {
        statusCode: 200,
        body: payload,
        expiresAt: Date.now() + TIMSTREAMS_CACHE_TTL_MS
      });

      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'X-Proxy-Cache': 'MISS',
        'Cache-Control': 'no-cache'
      });
      res.end(payload);
    })
    .catch(function (err) {
      if (!res.headersSent) {
        sendJson(res, err && err.isTimeout ? 504 : 502, {
          error: 'tim-streams.com stream directory error',
          details: err && err.message ? err.message : 'Unknown error'
        });
      }
    });
}

// ==================== STRMFREE.PK DIRECTORY PROXY ====================

function normalizeStrmFreeEmbedUrl(rawUrl) {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) return '';
  try {
    const parsed = new url.URL(trimmed, STRMFREE_ORIGIN);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return '';
    }
    const host = String(parsed.hostname || '').toLowerCase();
    if (STRMFREE_MIRROR_HOSTS.has(host) && parsed.pathname.indexOf('/embed/') === 0) {
      return STRMFREE_ORIGIN + parsed.pathname + parsed.search;
    }
    return parsed.toString();
  } catch (err) {
    return '';
  }
}

function toProxiedStrmFreeEmbed(rawUrl) {
  const normalized = normalizeStrmFreeEmbedUrl(rawUrl);
  if (!normalized) return '';
  if (normalized.indexOf(STRMFREE_ORIGIN + '/embed/') === 0) {
    return '/api/strmfree/embed?embedUrl=' + encodeURIComponent(normalized);
  }
  return normalized;
}

function normalizeStrmFreePosterUrl(rawUrl, item) {
  const trimmed = String(rawUrl || '').trim();
  if (trimmed) {
    if (trimmed.indexOf('//') === 0) {
      return 'https:' + trimmed;
    }
    if (trimmed.charAt(0) === '/') {
      return STRMFREE_ORIGIN + trimmed;
    }
    return trimmed;
  }
  return (item && ((item.team1 && item.team1.logo) || (item.team2 && item.team2.logo))) || '';
}

function normalizeBackupMatchText(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const BACKUP_TEAM_STOP_WORDS = new Set([
  'the', 'of', 'at', 'vs', 'and', 'football', 'state', 'university', 'college'
]);

const BACKUP_MASCOT_ALIASES = {
  'brigham young': ['byu'],
  'byu': ['brigham young'],
  'louisiana state': ['lsu'],
  'lsu': ['louisiana state'],
  'central florida': ['ucf'],
  'ucf': ['central florida'],
  'southern methodist': ['smu'],
  'smu': ['southern methodist'],
  'texas christian': ['tcu'],
  'tcu': ['texas christian'],
  'ole miss': ['mississippi'],
  'mississippi': ['ole miss'],
  'north carolina': ['unc'],
  'unc': ['north carolina'],
  'nc state': ['north carolina state'],
  'north carolina state': ['nc state'],
  'florida state': ['fsu'],
  'fsu': ['florida state'],
  'app state': ['appalachian state'],
  'appalachian state': ['app state'],
  'utsa': ['texas san antonio'],
  'utep': ['texas el paso'],
  'unlv': ['nevada las vegas']
};

function buildTeamTokenCandidates(rawTeamName) {
  const norm = normalizeBackupMatchText(rawTeamName);
  if (!norm) return [];
  const words = norm.split(' ').filter(Boolean);
  const candidates = new Set([norm]);
  if (words.length > 1) {
    candidates.add(words.slice(0, -1).join(' '));
  }
  if (words.length > 2) {
    candidates.add(words.slice(0, 2).join(' '));
  }
  const firstMeaningful = words.find(function (w) {
    return w.length >= 3 && !BACKUP_TEAM_STOP_WORDS.has(w);
  });
  if (firstMeaningful) {
    candidates.add(firstMeaningful);
  }
  Array.from(candidates).forEach(function (c) {
    const extra = BACKUP_MASCOT_ALIASES[c];
    if (Array.isArray(extra)) {
      extra.forEach(function (alias) {
        candidates.add(alias);
      });
    }
  });
  return Array.from(candidates).filter(function (c) {
    return c.length >= 3;
  });
}

function teamMatchesText(teamCandidates, textNorm) {
  if (!textNorm || !teamCandidates.length) return false;
  return teamCandidates.some(function (cand) {
    return (' ' + textNorm + ' ').indexOf(' ' + cand + ' ') !== -1;
  });
}

function extractPpvFootballStreamsFromJson(rawBody) {
  let parsed;
  try {
    parsed = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;
  } catch (err) {
    return [];
  }
  const cats = Array.isArray(parsed && parsed.streams) ? parsed.streams : [];
  const flat = [];
  cats.forEach(function (cat) {
    const catLabel = String((cat && cat.category) || '');
    if (!/football|cfb|ncaa|nfl/i.test(catLabel)) return;
    const list = Array.isArray(cat && cat.streams) ? cat.streams : [];
    list.forEach(function (entry) {
      if (entry && entry.iframe) {
        flat.push(entry);
      }
    });
  });
  return flat;
}

function getPpvStreamsForBackupMatch() {
  const cached = proxyCache.get(PPV_CACHE_KEY);
  if (cached && cached.expiresAt > Date.now() && cached.body) {
    return Promise.resolve(extractPpvFootballStreamsFromJson(cached.body));
  }
  return fetchHttpText(PPV_STREAMS_URL, { 'Accept': 'application/json' }, 8000).then(function (upstreamRes) {
    if (upstreamRes.statusCode >= 200 && upstreamRes.statusCode < 300 && upstreamRes.body) {
      pruneCacheIfNeeded();
      proxyCache.set(PPV_CACHE_KEY, {
        statusCode: upstreamRes.statusCode,
        body: upstreamRes.body,
        expiresAt: Date.now() + PPV_CACHE_TTL_MS
      });
      return extractPpvFootballStreamsFromJson(upstreamRes.body);
    }
    return [];
  });
}

function matchStrmFreeToPpvBackupFeeds(item, ppvFootballStreams, streamKey) {
  if (!Array.isArray(ppvFootballStreams) || ppvFootballStreams.length === 0) return [];
  const rawName = String((item && item.name) || '');
  const parts = rawName.split(/\s+(?:vs\.?|at|@)\s+/i);
  const t1Raw = (item && item.team1 && item.team1.name) || parts[0] || '';
  const t2Raw = (item && item.team2 && item.team2.name) || parts[1] || '';
  const t1Candidates = buildTeamTokenCandidates(t1Raw);
  const t2Candidates = buildTeamTokenCandidates(t2Raw);
  if (!t1Candidates.length || !t2Candidates.length) return [];

  const matched = ppvFootballStreams.find(function (ppvItem) {
    const candNorm = normalizeBackupMatchText(ppvItem && ppvItem.name);
    if (!candNorm) return false;
    return teamMatchesText(t1Candidates, candNorm) && teamMatchesText(t2Candidates, candNorm);
  });
  if (!matched) return [];

  const feeds = [];
  const seenUrls = new Set();
  function pushFeed(rawFeed, idx) {
    const iframeUrl = normalizeStrmFreeEmbedUrl(rawFeed && rawFeed.iframe);
    if (!iframeUrl || seenUrls.has(iframeUrl)) return;
    seenUrls.add(iframeUrl);
    const rawLabel = String((rawFeed && (rawFeed.source_tag || rawFeed.name || rawFeed.tag)) || 'HD').trim();
    feeds.push({
      id: 'strmfree-' + streamKey + '-backup-' + (idx + 1),
      label: 'Backup · ' + rawLabel,
      iframe: iframeUrl,
      uriName: streamKey,
      source: 'strmfree'
    });
  }

  pushFeed(matched, 0);
  if (Array.isArray(matched.substreams)) {
    matched.substreams.forEach(function (sub, idx) {
      pushFeed(sub, idx + 1);
    });
  }
  return feeds;
}

function buildStrmFreeBridgeScript(embedOrigin) {
  return [
    '(function(){',
    'var BASE_ORIGIN=' + JSON.stringify(embedOrigin) + ';',
    'window.open=function(){return null;};',
    'function rewriteStrmFreeUrl(rawUrl){',
    '  if(!rawUrl||typeof rawUrl!=="string")return rawUrl;',
    '  if(rawUrl.charAt(0)==="/"&&rawUrl.charAt(1)!=="/"&&rawUrl.indexOf("/api/strmfree/")!==0){',
    '    return BASE_ORIGIN+rawUrl;',
    '  }',
    '  return rawUrl;',
    '}',
    'if(typeof window.fetch==="function"){',
    '  var origFetch=window.fetch;',
    '  window.fetch=function(input,init){',
    '    if(typeof input==="string"){input=rewriteStrmFreeUrl(input);}',
    '    else if(input&&typeof Request!=="undefined"&&input instanceof Request){',
    '      var rew=rewriteStrmFreeUrl(input.url);',
    '      if(rew!==input.url){input=new Request(rew,input);}',
    '    }',
    '    return origFetch.call(this,input,init);',
    '  };',
    '}',
    'if(window.XMLHttpRequest&&window.XMLHttpRequest.prototype&&window.XMLHttpRequest.prototype.open){',
    '  var origOpen=window.XMLHttpRequest.prototype.open;',
    '  window.XMLHttpRequest.prototype.open=function(method,u){',
    '    var args=Array.prototype.slice.call(arguments);',
    '    if(typeof u==="string"){args[1]=rewriteStrmFreeUrl(u);}',
    '    return origOpen.apply(this,args);',
    '  };',
    '}',
    'function removeAdOverlays(){',
    '  var el=document.getElementById("dontfoid");',
    '  if(el&&el.parentNode){el.parentNode.removeChild(el);}',
    '}',
    'try{',
    '  var mo=new MutationObserver(function(){removeAdOverlays();});',
    '  mo.observe(document.documentElement||document,{childList:true,subtree:true});',
    '}catch(e){}',
    '})();'
  ].join('\n');
}

function handleStrmFreeEmbedProxy(reqUrl, res) {
  const q = reqUrl.query || {};
  const rawEmbedUrl = typeof q.embedUrl === 'string' ? q.embedUrl.trim() : '';
  if (!rawEmbedUrl) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Missing embedUrl parameter');
    return;
  }

  let parsedEmbed;
  try {
    parsedEmbed = new url.URL(rawEmbedUrl, STRMFREE_ORIGIN);
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Invalid embedUrl parameter');
    return;
  }

  const host = String(parsedEmbed.hostname || '').toLowerCase();
  if (parsedEmbed.protocol !== 'https:' || !STRMFREE_MIRROR_HOSTS.has(host)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Unsupported embed host or protocol');
    return;
  }

  const targetUrl = STRMFREE_ORIGIN + parsedEmbed.pathname + parsedEmbed.search;
  fetchHttpText(targetUrl, { 'Referer': STRMFREE_ORIGIN + '/' }, 12000)
    .then(function (embedRes) {
      let html = String(embedRes.body || '');
      html = html.replace(
        /<script\b[^>]*src\s*=\s*["'][^"']*(?:adexchangerapid|suurl5|ad\.html|analytics\.js)[^"']*["'][^>]*>\s*<\/script>/gi,
        ''
      );
      html = html.replace(/<iframe\b[^>]*src\s*=\s*["'][^"']*ad\.html[^"']*["'][^>]*>\s*<\/iframe>/gi, '');
      html = html.replace(/<div\b[^>]*id\s*=\s*["']dontfoid["'][^>]*>[\s\S]*?<\/div>/gi, '');

      const headInject =
        '<base href="' + STRMFREE_ORIGIN + '/">\n' +
        '<style>html,body,#playerWrapper,#player-container,#jwplayer{margin:0!important;padding:0!important;width:100%!important;height:100%!important;overflow:hidden!important;background:#000!important;}#dontfoid,.afs_ads,.ad-placement{display:none!important;pointer-events:none!important;}</style>\n' +
        '<script>' + buildStrmFreeBridgeScript(STRMFREE_ORIGIN) + '</script>';

      if (/<head[^>]*>/i.test(html)) {
        html = html.replace(/<head[^>]*>/i, function (match) {
          return match + '\n' + headInject;
        });
      } else {
        html = headInject + '\n' + html;
      }

      res.writeHead(embedRes.statusCode >= 200 && embedRes.statusCode < 400 ? 200 : embedRes.statusCode, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache'
      });
      res.end(html);
    })
    .catch(function (err) {
      if (!res.headersSent) {
        res.writeHead(err && err.isTimeout ? 504 : 502, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Unable to load strmfree.pk embed: ' + err.message);
      }
    });
}

function extractRawStrmFreeList(parsedJson) {
  if (!parsedJson || typeof parsedJson !== 'object') return [];
  if (Array.isArray(parsedJson.streams)) {
    return parsedJson.streams;
  }
  if (parsedJson.streams && typeof parsedJson.streams === 'object') {
    const combined = [];
    Object.keys(parsedJson.streams).forEach(function (catKey) {
      const arr = parsedJson.streams[catKey];
      if (Array.isArray(arr)) {
        arr.forEach(function (entry) {
          if (entry && typeof entry === 'object') {
            combined.push(Object.assign({ category: entry.category || catKey }, entry));
          }
        });
      }
    });
    return combined;
  }
  return [];
}

function fetchStrmFreeRawStreams() {
  const headers = {
    'Accept': 'application/json, text/plain, */*',
    'Referer': STRMFREE_ORIGIN + '/'
  };
  return fetchHttpText(STRMFREE_API_STREAMS_URL, headers, 12000)
    .then(function (apiRes) {
      if (apiRes.statusCode >= 200 && apiRes.statusCode < 300) {
        const parsed = JSON.parse(apiRes.body);
        const list = extractRawStrmFreeList(parsed);
        if (list.length > 0 || Array.isArray(parsed && parsed.streams)) {
          return list;
        }
      }
      throw new Error('Unexpected status ' + apiRes.statusCode + ' from /api/v1/streams');
    })
    .catch(function (primaryErr) {
      return fetchHttpText(STRMFREE_LEGACY_STREAMS_URL, headers, 12000).then(function (legacyRes) {
        if (legacyRes.statusCode < 200 || legacyRes.statusCode >= 300) {
          throw primaryErr || new Error('Upstream strmfree.pk status ' + legacyRes.statusCode);
        }
        const parsed = JSON.parse(legacyRes.body);
        return extractRawStrmFreeList(parsed);
      });
    });
}

function isStrmFreeFootballItem(item) {
  const categoryRaw = String((item && item.category) || 'sports').toLowerCase();
  const leagueRaw = String((item && item.league) || '').toUpperCase();
  return (
    categoryRaw === 'football' ||
    leagueRaw === 'NCAAF' ||
    leagueRaw === 'NFL' ||
    /ncaaf|college football|nfl/i.test(leagueRaw)
  );
}

function buildStrmFreeNormalizedStream(item, backupFeeds, nowSec) {
  const categoryRaw = String((item && item.category) || 'sports').toLowerCase();
  const leagueRaw = String((item && item.league) || '').toUpperCase();
  const rawName = String((item && item.name) || 'Live Stream').trim();
  const streamKey = String((item && (item.stream_key || item.id)) || '').trim();
  if (!streamKey) return null;

  const isFootball = isStrmFreeFootballItem(item);
  const isCfb =
    leagueRaw === 'NCAAF' ||
    (isFootball && !/\bnfl\b|redzone/i.test(rawName + ' ' + leagueRaw));

  const apiFeeds = [];
  const seenIframes = new Set();

  if (Array.isArray(item.sources)) {
    item.sources.forEach(function (src, idx) {
      const iframeUrl = toProxiedStrmFreeEmbed(src && src.url);
      if (!iframeUrl || seenIframes.has(iframeUrl)) return;
      seenIframes.add(iframeUrl);
      const quality = src && src.quality ? String(src.quality).trim() : 'FHD';
      apiFeeds.push({
        id: 'strmfree-' + streamKey + '-api-' + (idx + 1),
        label: 'Direct · ' + quality,
        iframe: iframeUrl,
        uriName: streamKey,
        source: 'strmfree'
      });
    });
  }

  const dedupedBackups = [];
  if (Array.isArray(backupFeeds)) {
    backupFeeds.forEach(function (feed) {
      if (!feed || !feed.iframe || seenIframes.has(feed.iframe)) return;
      seenIframes.add(feed.iframe);
      dedupedBackups.push(feed);
    });
  }

  const defaultEmbed = toProxiedStrmFreeEmbed(
    STRMFREE_ORIGIN +
      '/embed/' +
      encodeURIComponent(categoryRaw) +
      '/' +
      encodeURIComponent(streamKey) +
      '1080p'
  );

  let feeds;
  if (apiFeeds.length > 0) {
    feeds = apiFeeds.concat(dedupedBackups);
  } else if (dedupedBackups.length > 0) {
    feeds = dedupedBackups.concat([
      {
        id: 'strmfree-' + streamKey + '-default',
        label: 'Direct · FHD (Standby)',
        iframe: defaultEmbed,
        uriName: streamKey,
        source: 'strmfree'
      }
    ]);
  } else {
    feeds = [
      {
        id: 'strmfree-' + streamKey + '-default',
        label: 'Direct · FHD',
        iframe: defaultEmbed,
        uriName: streamKey,
        source: 'strmfree'
      }
    ];
  }

  const hasActiveSources = apiFeeds.length > 0 || dedupedBackups.length > 0;

  const startsAt = Number(item.match_timestamp || 0);
  const endsAt = startsAt ? startsAt + 4 * 3600 : 0;
  const alwaysLive = /redzone|24\/7/i.test(rawName);
  const viewers = Number(item.viewers || 0);
  const isLiveNow = Boolean(
    alwaysLive ||
      hasActiveSources ||
      viewers > 0 ||
      (startsAt > 0 && startsAt <= nowSec + 900 && endsAt > nowSec)
  );

  const fallbackCat = categoryRaw.charAt(0).toUpperCase() + categoryRaw.slice(1);
  const categoryLabel = isCfb ? 'College Football' : isFootball ? 'Football' : item.league || fallbackCat;
  const externalUrl =
    STRMFREE_ORIGIN +
    '/player/' +
    encodeURIComponent(categoryRaw) +
    '/' +
    encodeURIComponent(streamKey);

  return {
    id: 'strmfree-' + streamKey,
    source: 'strmfree',
    sourceLabel: 'strmfree.pk',
    name: rawName,
    tag: isCfb ? 'NCAAF' : item.league || fallbackCat,
    category: categoryLabel,
    sourceTag: feeds[0].label || (leagueRaw ? 'HD | ' + leagueRaw : 'HD | Direct'),
    broadcast: item.league ? String(item.league) : '',
    poster: normalizeStrmFreePosterUrl(item.thumbnail_url, item),
    uriName: streamKey,
    externalUrl: externalUrl,
    startsAt: startsAt,
    endsAt: endsAt,
    timeLabel: '',
    alwaysLive: alwaysLive,
    isLiveNow: isLiveNow,
    isCfb: isCfb,
    isFootball: isFootball,
    hasActiveSources: hasActiveSources,
    viewers: viewers,
    viewersDisplay: viewers > 0 ? String(viewers) : '',
    iframe: feeds[0].iframe,
    feeds: feeds
  };
}

function handleStrmFreeStreamsProxy(reqUrl, res) {
  const parsedQuery = reqUrl.query || {};
  const force = parsedQuery.force === '1';
  const cached = proxyCache.get(STRMFREE_CACHE_KEY);
  if (!force && cached && cached.expiresAt > Date.now()) {
    res.writeHead(cached.statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'X-Proxy-Cache': 'HIT',
      'Cache-Control': 'no-cache'
    });
    res.end(cached.body);
    return;
  }

  Promise.all([
    fetchStrmFreeRawStreams(),
    getPpvStreamsForBackupMatch().catch(function () {
      return [];
    })
  ])
    .then(function (results) {
      const rawItems = results[0] || [];
      const ppvFootballStreams = results[1] || [];
      const nowSec = Math.floor(Date.now() / 1000);
      const seenIds = new Set();
      const normalized = [];

      rawItems.forEach(function (item) {
        const streamKey = String((item && (item.stream_key || item.id)) || '').trim();
        const backupFeeds =
          streamKey && isStrmFreeFootballItem(item)
            ? matchStrmFreeToPpvBackupFeeds(item, ppvFootballStreams, streamKey)
            : [];
        const mapped = buildStrmFreeNormalizedStream(item, backupFeeds, nowSec);
        if (!mapped || seenIds.has(mapped.id)) return;
        seenIds.add(mapped.id);
        normalized.push(mapped);
      });

      normalized.sort(function (a, b) {
        if (a.isCfb !== b.isCfb) return a.isCfb ? -1 : 1;
        if (a.hasActiveSources !== b.hasActiveSources) return a.hasActiveSources ? -1 : 1;
        if (a.isLiveNow !== b.isLiveNow) return a.isLiveNow ? -1 : 1;
        if (b.viewers !== a.viewers) return b.viewers - a.viewers;
        return (a.startsAt || Number.MAX_SAFE_INTEGER) - (b.startsAt || Number.MAX_SAFE_INTEGER);
      });

      const catCounts = new Map();
      normalized.forEach(function (s) {
        const catName = s.category || 'Sports';
        catCounts.set(catName, (catCounts.get(catName) || 0) + 1);
      });
      const categories = Array.from(catCounts.entries()).map(function (entry) {
        return {
          id: entry[0],
          name: entry[0],
          alwaysLive: false,
          count: entry[1]
        };
      });

      const payload = JSON.stringify({
        timestamp: nowSec,
        source: 'strmfree',
        categories: categories,
        streams: normalized
      });

      pruneCacheIfNeeded();
      proxyCache.set(STRMFREE_CACHE_KEY, {
        statusCode: 200,
        body: payload,
        expiresAt: Date.now() + STRMFREE_CACHE_TTL_MS
      });

      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'X-Proxy-Cache': 'MISS',
        'Cache-Control': 'no-cache'
      });
      res.end(payload);
    })
    .catch(function (err) {
      if (!res.headersSent) {
        sendJson(res, err && err.isTimeout ? 504 : 502, {
          error: 'strmfree.pk stream directory error',
          details: err.message
        });
      }
    });
}

function handleStaticFile(pathname, res) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname || '/');
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad Request');
    return;
  }

  if (decodedPath === '/') {
    decodedPath = '/index.html';
  }

  const resolvedPath = path.resolve(PUBLIC_DIR, '.' + decodedPath);
  if (resolvedPath !== PUBLIC_DIR && resolvedPath.indexOf(PUBLIC_DIR + path.sep) !== 0) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  fs.stat(resolvedPath, function (statErr, stats) {
    if (statErr || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }

    const ext = path.extname(resolvedPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(resolvedPath, function (readErr, data) {
      if (readErr) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Internal Server Error');
        return;
      }
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache'
      });
      res.end(data);
    });
  });
}

function handleServerRequest(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Method Not Allowed');
    return;
  }

  const reqUrl = url.parse(req.url, true);
  if (reqUrl.pathname === '/api/espn') {
    handleEspnProxy(reqUrl, res);
    return;
  }
  if (reqUrl.pathname === '/api/season-results') {
    handleSeasonResultsProxy(reqUrl, res);
    return;
  }
  if (reqUrl.pathname === '/api/cfp-g6-selection') {
    handleCfpG6SelectionProxy(reqUrl, res);
    return;
  }
  if (reqUrl.pathname === '/api/ppv/streams') {
    handlePpvProxy(reqUrl, res);
    return;
  }
  if (reqUrl.pathname === '/api/timstreams/streams') {
    handleTimStreamsProxy(reqUrl, res);
    return;
  }
  if (reqUrl.pathname === '/api/strmfree/streams') {
    handleStrmFreeStreamsProxy(reqUrl, res);
    return;
  }
  if (reqUrl.pathname === '/api/strmfree/embed') {
    handleStrmFreeEmbedProxy(reqUrl, res);
    return;
  }

  handleStaticFile(reqUrl.pathname, res);
}

/**
 * Dispatches an in-process HTTP-like request to handleServerRequest for serverless adapters.
 */
function dispatchApiRequest(method, urlString) {
  return new Promise(function (resolve) {
    let settled = false;
    let statusCode = 200;
    const responseHeaders = {};
    const chunks = [];

    const mockReq = {
      method: method || 'GET',
      url: urlString || '/'
    };

    const mockRes = {
      headersSent: false,
      writeHead: function (code, headers) {
        statusCode = code;
        mockRes.headersSent = true;
        if (headers && typeof headers === 'object') {
          Object.keys(headers).forEach(function (key) {
            if (headers[key] !== undefined && headers[key] !== null) {
              responseHeaders[key] = String(headers[key]);
            }
          });
        }
      },
      end: function (chunk) {
        if (settled) return;
        settled = true;
        mockRes.headersSent = true;
        if (chunk !== undefined && chunk !== null) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        }
        const body = chunks.length > 0 ? Buffer.concat(chunks).toString('utf8') : '';
        resolve({
          statusCode: statusCode,
          headers: responseHeaders,
          body: body
        });
      }
    };

    try {
      handleServerRequest(mockReq, mockRes);
    } catch (err) {
      if (!settled) {
        settled = true;
        resolve({
          statusCode: 500,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify({ error: err && err.message ? err.message : 'Internal Server Error' })
        });
      }
    }
  });
}

const server = http.createServer(handleServerRequest);

if (require.main === module && !process.env.NETLIFY && !process.env.AWS_LAMBDA_FUNCTION_NAME) {
  server.listen(PORT, function () {
    console.log('College Football Tracker listening at http://localhost:' + PORT);
  });
}

// ==================== CFP COMMITTEE UNRANKED G6 SELECTION ====================

function extractCfpArticlePlainText(html) {
  const rawHtml = String(html || '');
  const parts = [];
  const nuxtMatch = rawHtml.match(/<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (nuxtMatch && nuxtMatch[1]) {
    try {
      const arr = JSON.parse(nuxtMatch[1]);
      if (Array.isArray(arr)) {
        for (let i = 0; i < arr.length; i++) {
          if (typeof arr[i] === 'string' && arr[i].length > 40) {
            parts.push(stripHtmlTags(arr[i]));
          }
        }
      }
    } catch (err) {
      // Ignore malformed __NUXT_DATA__ and fall back to HTML body text
    }
  }
  parts.push(stripHtmlTags(rawHtml));
  return parts.join('\n');
}

function cleanCommitteeTeamName(rawName) {
  let cleaned = decodeHtmlEntities(String(rawName || ''))
    .replace(/\u00a0/g, ' ')
    .replace(/^[\s"'“‘(\[]+/, '')
    .replace(/[\s"'”’)\],.;:!?]+$/, '')
    .replace(/^the\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned || cleaned.length > 45) return '';
  if (cleaned.split(' ').length > 5) return '';
  if (/^(team|club|squad|school|program|conference|group|winner|champion|best|top|remaining)\b/i.test(cleaned)) {
    return '';
  }
  return cleaned;
}

function parseCommitteeG6SelectionFromText(plainText) {
  const text = String(plainText || '').replace(/\s+/g, ' ').trim();
  if (!text) return null;

  const patterns = [
    /\b(?:The\s+)?CFP\s+selection\s+committee\s+selected\s+([A-Za-z0-9.&'’\-\s]{2,45}?)\s+as\s+the\s+(?:best|highest[- ]ranked|top)\s+team\s+from\s+the\s+(?:remaining|Group\s+of\s+(?:Five|Six|5|6))\s+conferences\b/i,
    /\b([A-Za-z0-9.&'’\-\s]{2,45}?)\s+(?:remained|remains|is|was\s+selected\s+as|holds(?:\s+on)?\s+as|earned\s+the\s+spot\s+as)\s+the\s+(?:highest[- ]ranked|top|best)\s+team\s+from\s+the\s+(?:Group\s+of\s+(?:Six|Five|6|5)|remaining\s+conferences)\b/i,
    /\bprojected\s+No\.?\s*12\s+seed\s+(?:is\s+)?([A-Za-z0-9.&'’\-\s]{2,45}?)(?:\s*\(|[.,;])/i
  ];

  for (let i = 0; i < patterns.length; i++) {
    const m = text.match(patterns[i]);
    if (m && m[1]) {
      const candidate = cleanCommitteeTeamName(m[1]);
      if (candidate) {
        return {
          teamName: candidate,
          excerpt: m[0].replace(/\s+/g, ' ').trim()
        };
      }
    }
  }
  return null;
}

function buildCfpDateCandidates(dateStr) {
  const urls = [];
  const seen = new Set();
  const parsed = dateStr ? new Date(dateStr) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) {
    return urls;
  }

  const tuples = [];
  const tupleKeys = new Set();
  const pushTuple = function (d) {
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    const k = y + '-' + m + '-' + day;
    if (!tupleKeys.has(k)) {
      tupleKeys.add(k);
      tuples.push({
        y: String(y),
        m: String(m),
        d: String(day),
        mm: String(m < 10 ? '0' + m : m),
        dd: String(day < 10 ? '0' + day : day),
        iso: String(y) + '-' + String(m < 10 ? '0' + m : m) + '-' + String(day < 10 ? '0' + day : day)
      });
    }
  };

  pushTuple(parsed);
  pushTuple(new Date(parsed.getTime() - 5 * 3600 * 1000));

  const addSlug = function (slug) {
    for (let i = 0; i < tuples.length; i++) {
      const t = tuples[i];
      const rawPath = '/news/' + t.y + '/' + t.m + '/' + t.d + '/' + slug;
      if (!seen.has(rawPath)) {
        seen.add(rawPath);
        urls.push({ url: CFP_ORIGIN + rawPath, isMain: slug === 'rankings', releaseDate: t.iso });
      }
      const paddedPath = '/news/' + t.y + '/' + t.mm + '/' + t.dd + '/' + slug;
      if (!seen.has(paddedPath)) {
        seen.add(paddedPath);
        urls.push({ url: CFP_ORIGIN + paddedPath, isMain: slug === 'rankings', releaseDate: t.iso });
      }
    }
  };

  addSlug('rankings');
  addSlug('inside-rankings');
  return urls;
}

function extractReleaseDateFromUrl(urlStr) {
  const m = String(urlStr || '').match(/\/news\/(\d{4})\/(\d{1,2})\/(\d{1,2})\//);
  if (!m) return null;
  const mm = m[2].length === 1 ? '0' + m[2] : m[2];
  const dd = m[3].length === 1 ? '0' + m[3] : m[3];
  return m[1] + '-' + mm + '-' + dd;
}

async function fetchCfpCommitteeG6Selection(season, week, dateStr) {
  const emptyResult = {
    found: false,
    teamName: null,
    sourceUrl: null,
    releaseDate: null,
    excerpt: '',
    sourceLabel: 'CFP Selection Committee'
  };

  const candidates = buildCfpDateCandidates(dateStr);
  let sawDirectMainPage = false;

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    try {
      const resp = await fetchHttpText(c.url, {}, 10000);
      if (resp && resp.statusCode >= 200 && resp.statusCode < 300 && resp.body) {
        if (c.isMain) sawDirectMainPage = true;
        const plain = extractCfpArticlePlainText(resp.body);
        const parsed = parseCommitteeG6SelectionFromText(plain);
        if (parsed && parsed.teamName) {
          const finalUrl = resp.finalUrl || c.url;
          return {
            found: true,
            teamName: parsed.teamName,
            sourceUrl: finalUrl,
            releaseDate: extractReleaseDateFromUrl(finalUrl) || c.releaseDate,
            excerpt: parsed.excerpt,
            sourceLabel: 'CFP Selection Committee'
          };
        }
      }
    } catch (err) {
      // Try next candidate URL
    }
  }

  if (sawDirectMainPage) {
    return emptyResult;
  }

  const targetMs = dateStr ? new Date(dateStr).getTime() : NaN;
  const seasonStr = /^\d{4}$/.test(String(season || '')) ? String(season) : '';
  const triedUrls = new Set(candidates.map(function (c) { return c.url; }));
  const discovered = [];
  const discoveredSeen = new Set();

  const indexPages = await Promise.all([
    fetchHttpText(CFP_ORIGIN + '/', {}, 10000).catch(function () { return null; }),
    fetchHttpText(CFP_ORIGIN + '/rankings', {}, 10000).catch(function () { return null; })
  ]);

  const linkRe = /\/news\/(\d{4})\/(\d{1,2})\/(\d{1,2})\/([a-z0-9\-]*rankings[a-z0-9\-]*)/gi;
  for (let p = 0; p < indexPages.length; p++) {
    const page = indexPages[p];
    if (!page || page.statusCode < 200 || page.statusCode >= 300 || !page.body) continue;
    let m;
    while ((m = linkRe.exec(page.body)) !== null) {
      const yr = m[1];
      if (seasonStr && yr !== seasonStr) continue;
      const mo = Number(m[2]);
      const da = Number(m[3]);
      const slug = m[4].toLowerCase();
      const fullUrl = CFP_ORIGIN + m[0];
      if (triedUrls.has(fullUrl) || discoveredSeen.has(fullUrl)) continue;
      const linkMs = Date.UTC(Number(yr), mo - 1, da, 12, 0, 0);
      const dayDelta = Number.isFinite(targetMs)
        ? Math.abs(linkMs - targetMs) / 86400000
        : 0;
      if (Number.isFinite(targetMs) && dayDelta > 4.5) continue;
      discoveredSeen.add(fullUrl);
      discovered.push({
        url: fullUrl,
        isMain: slug === 'rankings' ? 0 : 1,
        dayDelta: dayDelta
      });
    }
  }

  discovered.sort(function (a, b) {
    if (Math.abs(a.dayDelta - b.dayDelta) > 0.2) return a.dayDelta - b.dayDelta;
    return a.isMain - b.isMain;
  });

  const maxToCheck = Math.min(discovered.length, 2);
  for (let i = 0; i < maxToCheck; i++) {
    const item = discovered[i];
    try {
      const resp = await fetchHttpText(item.url, {}, 10000);
      if (resp && resp.statusCode >= 200 && resp.statusCode < 300 && resp.body) {
        const plain = extractCfpArticlePlainText(resp.body);
        const parsed = parseCommitteeG6SelectionFromText(plain);
        if (parsed && parsed.teamName) {
          const finalUrl = resp.finalUrl || item.url;
          return {
            found: true,
            teamName: parsed.teamName,
            sourceUrl: finalUrl,
            releaseDate: extractReleaseDateFromUrl(finalUrl),
            excerpt: parsed.excerpt,
            sourceLabel: 'CFP Selection Committee'
          };
        }
      }
    } catch (err) {
      // Ignore failed discovered article
    }
  }

  return emptyResult;
}

function handleCfpG6SelectionProxy(reqUrl, res) {
  const parsedQuery = reqUrl.query || {};
  const season = /^\d{4}$/.test(String(parsedQuery.season || '')) ? String(parsedQuery.season) : '';
  const week = String(parsedQuery.week || '').trim();
  const dateStr = String(parsedQuery.date || '').trim();
  const force = parsedQuery.force === '1';
  const cacheKey = season + ':' + week + ':' + dateStr;

  if (!force) {
    const cached = cfpG6Cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'X-Proxy-Cache': 'HIT',
        'Cache-Control': 'no-cache'
      });
      res.end(cached.body);
      return;
    }
  }

  let promise = cfpG6InFlight.get(cacheKey);
  if (!promise) {
    promise = fetchCfpCommitteeG6Selection(season, week, dateStr)
      .then(function (data) {
        const ttl = data && data.found ? CFP_G6_FOUND_TTL_MS : CFP_G6_MISS_TTL_MS;
        const body = JSON.stringify(data);
        if (cfpG6Cache.size > 100) cfpG6Cache.clear();
        cfpG6Cache.set(cacheKey, {
          body: body,
          expiresAt: Date.now() + ttl
        });
        cfpG6InFlight.delete(cacheKey);
        return body;
      })
      .catch(function (err) {
        cfpG6InFlight.delete(cacheKey);
        return JSON.stringify({
          found: false,
          teamName: null,
          sourceUrl: null,
          releaseDate: null,
          excerpt: '',
          sourceLabel: 'CFP Selection Committee',
          error: err && err.message ? err.message : 'Lookup failed'
        });
      });
    cfpG6InFlight.set(cacheKey, promise);
  }

  promise.then(function (body) {
    if (!res.headersSent) {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'X-Proxy-Cache': 'MISS',
        'Cache-Control': 'no-cache'
      });
      res.end(body);
    }
  });
}

module.exports = {
  server: server,
  handleServerRequest: handleServerRequest,
  dispatchApiRequest: dispatchApiRequest,
  extractCfpArticlePlainText: extractCfpArticlePlainText,
  parseCommitteeG6SelectionFromText: parseCommitteeG6SelectionFromText,
  parseEasternLocalTimestamp: parseEasternLocalTimestamp,
  normalizeTimStreamsList: normalizeTimStreamsList
};
