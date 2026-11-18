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

const THETVAPP_ORIGIN = 'https://thetvapp.plus';
const THETVAPP_CFB_URL = 'https://thetvapp.plus/watch/cfb-streams';
const THETVAPP_ALL_URL = 'https://thetvapp.plus/v15';
const THETVAPP_CACHE_KEY = 'thetvapp:streams';
const THETVAPP_CACHE_TTL_MS = 30000;
const THETVAPP_EVENT_CACHE_TTL_MS = 5 * 60 * 1000;
const tvAppEventCache = new Map();

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

// ==================== THETVAPP.PLUS DIRECTORY & EMBED PROXY ====================

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

function parseTheTvAppStartTimestamp(timeStr, dateStr) {
  const cleanTime = String(timeStr || '').replace(/\b(ET|EST|EDT)\b/gi, '').trim();
  const cleanDate = String(dateStr || '').trim();
  if (!cleanTime || !cleanDate) return 0;

  const year = new Date().getFullYear();
  const candidate = new Date(cleanDate + ', ' + year + ' ' + cleanTime);
  if (!Number.isNaN(candidate.getTime())) {
    return Math.floor(candidate.getTime() / 1000);
  }
  return 0;
}

function normalizeTheTvAppLeague(rawLeague, eventPath) {
  const stripped = stripHtmlTags(rawLeague)
    .replace(/^[^a-zA-Z0-9]+/, '')
    .trim();
  if (stripped) return stripped;
  const seg = String(eventPath || '').split('/').filter(Boolean)[1] || '';
  return seg ? seg.toUpperCase() : 'Sports';
}

function parseTheTvAppGamesHtml(html, defaultIsCfb) {
  const items = [];
  const seenPaths = new Set();
  const anchorRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = anchorRe.exec(String(html || ''))) !== null) {
    const attrs = match[1] || '';
    const inner = match[2] || '';
    const classAttr = extractAttr(attrs, 'class');
    if (!/\bgame\b/i.test(classAttr)) {
      continue;
    }

    const rawHref = extractAttr(attrs, 'href');
    if (!rawHref) continue;

    let parsedUrl;
    try {
      parsedUrl = new url.URL(rawHref, THETVAPP_ORIGIN);
    } catch (err) {
      continue;
    }
    const eventPath = parsedUrl.pathname || '';
    if (eventPath.indexOf('/tv-live/') === -1 || seenPaths.has(eventPath)) {
      continue;
    }
    seenPaths.add(eventPath);

    const pathParts = eventPath.split('/').filter(Boolean);
    const rawEventId = pathParts[pathParts.length - 1] || eventPath;
    const streamId = 'thetvapp-' + rawEventId;

    const leagueMatch = inner.match(/<span[^>]*class="[^"]*\bleague-tag\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
    const matchupMatch = inner.match(/<span[^>]*class="[^"]*\bmatchup\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
    const liveMatch = inner.match(/<span[^>]*class="[^"]*\blive\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
    const badgeTimeMatch = inner.match(/<span[^>]*class="[^"]*\b(?:badge-time|time)\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
    const dateSmallMatch = inner.match(/<small[^>]*>([\s\S]*?)<\/small>/i);

    const league = normalizeTheTvAppLeague(leagueMatch ? leagueMatch[1] : '', eventPath);
    const name = stripHtmlTags(matchupMatch ? matchupMatch[1] : inner) || 'Live Stream';
    const isLiveNow = Boolean(liveMatch) || /●\s*LIVE/i.test(inner);
    const timeText = stripHtmlTags(badgeTimeMatch ? badgeTimeMatch[1] : '');
    const dateText = stripHtmlTags(dateSmallMatch ? dateSmallMatch[1] : '');
    const timeLabel = [timeText, dateText].filter(Boolean).join(' · ');
    const startsAt = isLiveNow ? Math.floor(Date.now() / 1000) - 60 : parseTheTvAppStartTimestamp(timeText, dateText);

    const isCfb =
      Boolean(defaultIsCfb) ||
      /\b(cfb|ncaaf|college football)\b/i.test(league) ||
      eventPath.indexOf('/tv-live/cfb/') === 0;
    const isFootball =
      isCfb ||
      /\b(nfl|football|cfl|ufl|xfl)\b/i.test(league) ||
      eventPath.indexOf('/tv-live/nfl/') === 0;

    const uriName = eventPath.replace(/^\/tv-live\//, '');
    const externalUrl = parsedUrl.toString();
    const fallbackEmbedPath = '/api/thetvapp/embed?eventPath=' + encodeURIComponent(eventPath);

    items.push({
      id: streamId,
      rawEventId: rawEventId,
      eventPath: eventPath,
      name: name,
      league: league,
      tag: isCfb ? 'College Football' : league,
      category: isCfb ? 'College Football' : isFootball ? 'American Football' : league,
      sourceTag: 'thetvapp.plus',
      broadcast: '',
      timeLabel: timeLabel,
      uriName: uriName,
      externalUrl: externalUrl,
      startsAt: startsAt,
      endsAt: 0,
      alwaysLive: false,
      isLiveNow: isLiveNow,
      isCfb: isCfb,
      isFootball: isFootball,
      viewers: 0,
      viewersDisplay: '',
      iframe: fallbackEmbedPath,
      feeds: [
        {
          id: streamId + '-auto',
          label: 'Server 1',
          iframe: fallbackEmbedPath,
          uriName: uriName
        }
      ]
    });
  }

  return items;
}

function buildTheTvAppEmbedProxyUrl(embedUrl, streamNum, eventPath) {
  const parts = [];
  if (streamNum) {
    parts.push('streamId=' + encodeURIComponent(String(streamNum)));
  }
  if (embedUrl) {
    parts.push('embedUrl=' + encodeURIComponent(String(embedUrl)));
  }
  if (eventPath) {
    parts.push('eventPath=' + encodeURIComponent(String(eventPath)));
  }
  return '/api/thetvapp/embed?' + parts.join('&');
}

function resolveTheTvAppEventFeeds(eventUrl, eventPath, streamId) {
  const cached = tvAppEventCache.get(eventPath);
  if (cached && cached.expiresAt > Date.now()) {
    return Promise.resolve(cached.data);
  }

  return fetchHttpText(
    eventUrl,
    {
      'Referer': THETVAPP_ORIGIN + '/',
      'Origin': THETVAPP_ORIGIN
    },
    10000
  ).then(function (resp) {
    const html = resp.body || '';

    let cxSrc = '';
    const iframeMatch = html.match(/<iframe\b([^>]*)>/gi) || [];
    for (let i = 0; i < iframeMatch.length; i++) {
      const attrs = iframeMatch[i];
      const idVal = extractAttr(attrs, 'id');
      const srcVal = extractAttr(attrs, 'src');
      if (idVal === 'cx-iframe' || (srcVal && srcVal.indexOf('new-stream-embed') !== -1)) {
        cxSrc = srcVal;
        break;
      }
    }
    if (cxSrc && cxSrc.indexOf('//') === 0) {
      cxSrc = 'https:' + cxSrc;
    }

    const servers = [];
    const seenServerIds = new Set();
    const btnRe = /id=["']stream-btn-(\d+)["']([^>]*)>([\s\S]*?)<\/(?:div|button|a|span)>/gi;
    let btnMatch;
    while ((btnMatch = btnRe.exec(html)) !== null) {
      const serverNum = btnMatch[1];
      if (!serverNum || seenServerIds.has(serverNum)) continue;
      seenServerIds.add(serverNum);
      const attrs = btnMatch[2] || '';
      const label = stripHtmlTags(btnMatch[3]) || 'Server ' + (servers.length + 1);
      const isSelected = /\bselected-link\b|\bactive\b/i.test(attrs);
      servers.push({
        serverNum: serverNum,
        label: label,
        selected: isSelected
      });
    }

    const info = {};
    const asideMatch = html.match(/<aside\b[^>]*class="[^"]*\bmatch-info\b[^"]*"[^>]*>([\s\S]*?)<\/aside>/i);
    if (asideMatch) {
      const dtDdRe = /<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/gi;
      let pair;
      while ((pair = dtDdRe.exec(asideMatch[1])) !== null) {
        const key = stripHtmlTags(pair[1]).replace(/:$/, '').trim();
        const val = stripHtmlTags(pair[2]);
        if (key && val) {
          info[key] = val;
        }
      }
    }

    const broadcast = info['Broadcast Channels'] || info['Broadcast Channel'] || '';
    const feeds = [];

    if (cxSrc && servers.length > 0 && /\/new-stream-embed\/\d+/i.test(cxSrc)) {
      servers.forEach(function (srv) {
        const serverEmbedUrl = cxSrc.replace(/\/new-stream-embed\/\d+/i, '/new-stream-embed/' + srv.serverNum);
        const feedLabel = broadcast ? srv.label + ' · ' + broadcast : srv.label;
        feeds.push({
          id: streamId + '-srv-' + srv.serverNum,
          label: feedLabel,
          serverNum: srv.serverNum,
          selected: srv.selected,
          embedUrl: serverEmbedUrl,
          iframe: buildTheTvAppEmbedProxyUrl(serverEmbedUrl, srv.serverNum, eventPath),
          uriName: eventPath.replace(/^\/tv-live\//, '')
        });
      });
      // Ensure the default/selected server comes first
      feeds.sort(function (a, b) {
        if (a.selected !== b.selected) return a.selected ? -1 : 1;
        return 0;
      });
    } else if (cxSrc) {
      const idMatch = cxSrc.match(/\/new-stream-embed\/(\d+)/i);
      const num = idMatch ? idMatch[1] : '';
      feeds.push({
        id: streamId + '-main',
        label: broadcast ? 'Server 1 · ' + broadcast : 'Server 1',
        serverNum: num,
        embedUrl: cxSrc,
        iframe: buildTheTvAppEmbedProxyUrl(cxSrc, num, eventPath),
        uriName: eventPath.replace(/^\/tv-live\//, '')
      });
    } else {
      feeds.push({
        id: streamId + '-pending',
        label: broadcast ? 'Pending · ' + broadcast : 'Pre-game',
        serverNum: '',
        embedUrl: '',
        iframe: buildTheTvAppEmbedProxyUrl('', '', eventPath),
        uriName: eventPath.replace(/^\/tv-live\//, '')
      });
    }

    const resolved = {
      broadcast: broadcast,
      stadium: info['Stadium'] || '',
      dateText: info['Date'] || '',
      cxSrc: cxSrc,
      feeds: feeds
    };

    if (tvAppEventCache.size > 250) {
      tvAppEventCache.clear();
    }
    tvAppEventCache.set(eventPath, {
      expiresAt: Date.now() + THETVAPP_EVENT_CACHE_TTL_MS,
      data: resolved
    });

    return resolved;
  });
}

function mapWithConcurrency(items, limit, workerFn) {
  if (!Array.isArray(items) || items.length === 0) {
    return Promise.resolve([]);
  }
  const results = new Array(items.length);
  let nextIdx = 0;

  function runWorker() {
    if (nextIdx >= items.length) {
      return Promise.resolve();
    }
    const curIdx = nextIdx++;
    return Promise.resolve()
      .then(function () {
        return workerFn(items[curIdx], curIdx);
      })
      .then(
        function (val) {
          results[curIdx] = val;
          return runWorker();
        },
        function () {
          results[curIdx] = null;
          return runWorker();
        }
      );
  }

  const workers = [];
  const workerCount = Math.min(limit, items.length);
  for (let i = 0; i < workerCount; i++) {
    workers.push(runWorker());
  }
  return Promise.all(workers).then(function () {
    return results;
  });
}

function handleTheTvAppStreamsProxy(reqUrl, res) {
  const parsedQuery = reqUrl.query || {};
  const force = parsedQuery.force === '1';
  const cached = proxyCache.get(THETVAPP_CACHE_KEY);
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

  Promise.allSettled([
    fetchHttpText(THETVAPP_CFB_URL, { 'Referer': THETVAPP_ORIGIN + '/' }, 12000),
    fetchHttpText(THETVAPP_ALL_URL, { 'Referer': THETVAPP_ORIGIN + '/' }, 12000)
  ])
    .then(function (settled) {
      const cfbRes = settled[0].status === 'fulfilled' ? settled[0].value : null;
      const allRes = settled[1].status === 'fulfilled' ? settled[1].value : null;

      if (!cfbRes && !allRes) {
        const firstErr = (settled[0].reason || settled[1].reason || new Error('Failed to fetch thetvapp.plus')).message;
        sendJson(res, 502, { error: 'Upstream thetvapp.plus error', details: firstErr });
        return null;
      }

      const cfbItems = cfbRes ? parseTheTvAppGamesHtml(cfbRes.body, true) : [];
      const allItems = allRes ? parseTheTvAppGamesHtml(allRes.body, false) : [];

      const byPath = new Map();
      cfbItems.forEach(function (item) {
        byPath.set(item.eventPath, item);
      });
      allItems.forEach(function (item) {
        if (!byPath.has(item.eventPath)) {
          byPath.set(item.eventPath, item);
        }
      });

      const merged = Array.from(byPath.values());
      const targetsToResolve = merged.filter(function (s) {
        return s.isCfb || (s.isFootball && s.isLiveNow);
      }).slice(0, 40);

      return mapWithConcurrency(targetsToResolve, 10, function (item) {
        return resolveTheTvAppEventFeeds(item.externalUrl, item.eventPath, item.id).then(function (resolved) {
          if (resolved) {
            item.broadcast = resolved.broadcast || '';
            if (resolved.broadcast) {
              item.sourceTag = 'HD | ' + resolved.broadcast;
            }
            if (Array.isArray(resolved.feeds) && resolved.feeds.length > 0) {
              item.feeds = resolved.feeds;
              item.iframe = resolved.feeds[0].iframe;
            }
          }
          return item;
        });
      }).then(function () {
        const catCounts = new Map();
        merged.forEach(function (s) {
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
          timestamp: Math.floor(Date.now() / 1000),
          source: 'thetvapp',
          categories: categories,
          streams: merged
        });

        pruneCacheIfNeeded();
        proxyCache.set(THETVAPP_CACHE_KEY, {
          statusCode: 200,
          body: payload,
          expiresAt: Date.now() + THETVAPP_CACHE_TTL_MS
        });

        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
          'X-Proxy-Cache': 'MISS',
          'Cache-Control': 'no-cache'
        });
        res.end(payload);
      });
    })
    .catch(function (err) {
      if (!res.headersSent) {
        sendJson(res, 502, { error: 'thetvapp.plus stream directory error', details: err.message });
      }
    });
}

function buildTheTvAppBridgeScript(embedOrigin) {
  return [
    '(function(){',
    'var BASE_ORIGIN=' + JSON.stringify(embedOrigin) + ';',
    'function maybeRewritePlaylistUrl(rawUrl){',
    '  if(!rawUrl||typeof rawUrl!=="string")return rawUrl;',
    '  if(rawUrl.indexOf("/api/thetvapp/playlist")!==-1)return rawUrl;',
    '  try{',
    '    var resolved=new URL(rawUrl,BASE_ORIGIN);',
    '    if(resolved.hostname.indexOf("hereisman.net")!==-1||/\\/load-playlist(?:\\?|$|\\b)/i.test(resolved.pathname)){',
    '      return window.location.origin+"/api/thetvapp/playlist?target="+encodeURIComponent(resolved.toString())+"&origin="+encodeURIComponent(BASE_ORIGIN);',
    '    }',
    '  }catch(e){}',
    '  return rawUrl;',
    '}',
    'if(typeof window.fetch==="function"){',
    '  var origFetch=window.fetch;',
    '  window.fetch=function(input,init){',
    '    if(typeof input==="string"){input=maybeRewritePlaylistUrl(input);}',
    '    return origFetch.call(this,input,init);',
    '  };',
    '}',
    'if(window.XMLHttpRequest&&window.XMLHttpRequest.prototype&&window.XMLHttpRequest.prototype.open){',
    '  var origOpen=window.XMLHttpRequest.prototype.open;',
    '  window.XMLHttpRequest.prototype.open=function(method,u){',
    '    var args=Array.prototype.slice.call(arguments);',
    '    if(typeof u==="string"){args[1]=maybeRewritePlaylistUrl(u);}',
    '    return origOpen.apply(this,args);',
    '  };',
    '}',
    '})();'
  ].join('');
}

function sendPreGameEmbedHtml(res, eventUrl) {
  const safeHref = String(eventUrl || THETVAPP_ORIGIN)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
  const html =
    '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' +
    'html,body{margin:0;height:100%;background:#0a0f0d;color:#e6ebe9;font-family:system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;text-align:center;}' +
    '.box{max-width:340px;padding:24px;}h3{margin:0 0 8px;font-size:16px;}p{margin:0 0 14px;font-size:13px;color:#9ba8a3;line-height:1.45;}' +
    'a{display:inline-block;padding:8px 14px;border-radius:999px;background:#006c47;color:#fff;text-decoration:none;font-size:12px;font-weight:600;}' +
    '</style></head><body><div class="box"><h3>Stream Not Live Yet</h3>' +
    '<p>thetvapp.plus has not published an active video embed for this matchup yet. Streams typically activate shortly before kickoff.</p>' +
    '<a href="' + safeHref + '" target="_blank" rel="noopener noreferrer">Open on thetvapp.plus</a>' +
    '</div></body></html>';
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-cache'
  });
  res.end(html);
}

function handleTheTvAppEmbedProxy(reqUrl, res) {
  const q = reqUrl.query || {};
  const rawEmbedUrl = typeof q.embedUrl === 'string' ? q.embedUrl.trim() : '';
  const eventPath = typeof q.eventPath === 'string' ? q.eventPath.trim() : '';

  let resolvePromise;
  if (rawEmbedUrl) {
    resolvePromise = Promise.resolve(rawEmbedUrl);
  } else if (eventPath && eventPath.indexOf('/tv-live/') === 0) {
    const fullEventUrl = THETVAPP_ORIGIN + eventPath;
    resolvePromise = resolveTheTvAppEventFeeds(fullEventUrl, eventPath, 'thetvapp-event').then(function (resolved) {
      return resolved && resolved.cxSrc ? resolved.cxSrc : '';
    });
  } else {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Missing embedUrl or eventPath parameter');
    return;
  }

  resolvePromise
    .then(function (targetEmbedUrl) {
      if (!targetEmbedUrl) {
        sendPreGameEmbedHtml(res, eventPath ? THETVAPP_ORIGIN + eventPath : THETVAPP_ORIGIN);
        return null;
      }

      let parsedEmbed;
      try {
        parsedEmbed = new url.URL(targetEmbedUrl);
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Invalid embed URL');
        return null;
      }

      if (parsedEmbed.protocol !== 'https:') {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Only https embed URLs are supported');
        return null;
      }

      return fetchHttpText(
        parsedEmbed.toString(),
        {
          'Referer': THETVAPP_ORIGIN + '/',
          'Origin': THETVAPP_ORIGIN
        },
        12000
      ).then(function (embedRes) {
        const embedOrigin = parsedEmbed.origin;
        let html = embedRes.body || '';
        const headInject =
          '<base href="' + embedOrigin + '/">\n' +
          '<style>html,body,#player,#playerWrapper{margin:0!important;padding:0!important;width:100%!important;height:100%!important;overflow:hidden!important;background:#000!important;}</style>\n' +
          '<script>' + buildTheTvAppBridgeScript(embedOrigin) + '</script>';

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
      });
    })
    .catch(function (err) {
      if (!res.headersSent) {
        res.writeHead(err && err.isTimeout ? 504 : 502, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Upstream thetvapp.plus embed error: ' + err.message);
      }
    });
}

function handleTheTvAppPlaylistProxy(reqUrl, res) {
  const q = reqUrl.query || {};
  const target = typeof q.target === 'string' ? q.target.trim() : '';
  const originParam = typeof q.origin === 'string' ? q.origin.trim() : 'https://gooz.aapmains.net';
  if (!target) {
    sendJson(res, 400, { error: 'Missing target parameter' });
    return;
  }

  let parsedTarget;
  let parsedOrigin;
  try {
    parsedTarget = new url.URL(target);
    parsedOrigin = new url.URL(originParam);
  } catch (err) {
    sendJson(res, 400, { error: 'Invalid target or origin URL' });
    return;
  }

  if (parsedTarget.protocol !== 'https:' || parsedOrigin.protocol !== 'https:') {
    sendJson(res, 403, { error: 'Only https URLs are permitted' });
    return;
  }

  fetchHttpText(
    parsedTarget.toString(),
    {
      'Accept': '*/*',
      'Origin': parsedOrigin.origin,
      'Referer': parsedOrigin.origin + '/'
    },
    12000
  )
    .then(function (upstreamRes) {
      const contentType = (upstreamRes.headers && upstreamRes.headers['content-type']) || 'text/plain; charset=utf-8';
      res.writeHead(upstreamRes.statusCode || 200, {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store'
      });
      res.end(upstreamRes.body || '');
    })
    .catch(function (err) {
      if (!res.headersSent) {
        sendJson(res, err && err.isTimeout ? 504 : 502, {
          error: 'Upstream playlist proxy error',
          details: err.message
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
  if (reqUrl.pathname === '/api/ppv/streams') {
    handlePpvProxy(reqUrl, res);
    return;
  }
  if (reqUrl.pathname === '/api/thetvapp/streams') {
    handleTheTvAppStreamsProxy(reqUrl, res);
    return;
  }
  if (reqUrl.pathname === '/api/thetvapp/embed') {
    handleTheTvAppEmbedProxy(reqUrl, res);
    return;
  }
  if (reqUrl.pathname === '/api/thetvapp/playlist') {
    handleTheTvAppPlaylistProxy(reqUrl, res);
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

module.exports = {
  server: server,
  handleServerRequest: handleServerRequest,
  dispatchApiRequest: dispatchApiRequest
};
