import { getGameSummary, findStreamForEspnEvent } from '../api.js';
import { getState } from '../store.js';
import {
  escapeHtml,
  renderTeamLogo,
  renderRankBadge,
  formatKickoffTime,
  formatDayHeading,
  quarterLabel
} from '../ui.js';

// Per-event UI state preserved across 15s live refreshes
const uiStateByEvent = new Map();

function getUiState(eventId) {
  const key = String(eventId);
  if (!uiStateByEvent.has(key)) {
    uiStateByEvent.set(key, {
      activeTab: 'pbp',
      pbpFilter: 'all', // 'all' | 'scoring'
      latestFirst: true,
      expandedDrives: new Set(),
      initializedDrives: false
    });
  }
  return uiStateByEvent.get(key);
}

function getDrivePillClass(drive) {
  if (drive.isCurrent) return 'live';
  if (drive.isScore) return 'score';
  const r = `${drive.result} ${drive.displayResult}`.toLowerCase();
  if (r.includes('interception') || r.includes('fumble') || r.includes('turnover') || r.includes('safety')) {
    return 'turnover';
  }
  return '';
}

function formatYardSpot(pct, awayAbbr, homeAbbr) {
  if (pct === null || pct === undefined || Number.isNaN(pct)) return '';
  if (pct <= 0.5 || pct >= 99.5) return 'Goal Line';
  const rounded = Math.round(pct);
  if (rounded === 50) return '50';
  if (rounded < 50) return `${awayAbbr} ${rounded}`;
  return `${homeAbbr} ${100 - rounded}`;
}

function parseYardFromText(text, awayAbbr, homeAbbr) {
  if (!text) return null;
  const trimmed = String(text).trim();
  if (trimmed === '50') return 50;
  const match = trimmed.match(/^([A-Za-z0-9&.]+)\s+(\d+)/);
  if (!match) return null;
  const sideAbbr = match[1].toUpperCase();
  const yard = Math.max(0, Math.min(50, Number(match[2])));
  if (sideAbbr === (awayAbbr || '').toUpperCase()) return yard;
  if (sideAbbr === (homeAbbr || '').toUpperCase()) return 100 - yard;
  return null;
}

function computeFieldState(summary, eventPreview) {
  const away = summary.away;
  const home = summary.home;
  const sit = eventPreview?.situation || null;
  const lastPlay = summary.currentDrive?.plays?.length
    ? summary.currentDrive.plays[summary.currentDrive.plays.length - 1]
    : null;
  const lastPlayEnd = lastPlay?.end || null;

  const sitHasScrimmage = sit && typeof sit.down === 'number' && sit.down >= 1 && sit.down <= 4;
  const endHasScrimmage = lastPlayEnd && typeof lastPlayEnd.down === 'number' && lastPlayEnd.down >= 1 && lastPlayEnd.down <= 4;
  const active = sitHasScrimmage ? sit : endHasScrimmage ? lastPlayEnd : sit || lastPlayEnd;

  const possId =
    (sitHasScrimmage ? sit.possession : null) ||
    active?.possession ||
    active?.teamId ||
    sit?.possession ||
    summary.currentDrive?.team?.id ||
    (away.possession ? away.id : home.possession ? home.id : null);

  const possTeam = String(possId) === away.id ? away : String(possId) === home.id ? home : null;
  const possIsAway = possTeam ? possTeam.id === away.id : null;

  const downText = active?.downDistanceText || active?.shortDownDistanceText || sit?.downDistanceText || sit?.shortDownDistanceText || '';
  const possText = active?.possessionText || sit?.possessionText || '';

  let losPct = parseYardFromText(possText, away.abbreviation, home.abbreviation);
  if (losPct === null && typeof active?.yardsToEndzone === 'number' && possIsAway !== null) {
    losPct = possIsAway ? 100 - active.yardsToEndzone : active.yardsToEndzone;
  }
  if (losPct === null && typeof active?.yardLine === 'number') {
    losPct = 100 - active.yardLine;
  }
  if (losPct !== null) {
    losPct = Math.max(0, Math.min(100, losPct));
  }

  const down = typeof active?.down === 'number' ? active.down : null;
  const distance = typeof active?.distance === 'number' ? active.distance : null;
  const isScrimmage = down !== null && down >= 1 && down <= 4 && distance !== null && distance > 0;

  let ltgPct = null;
  let isGoalToGo = false;
  if (losPct !== null && isScrimmage && possIsAway !== null) {
    if (/goal/i.test(downText)) {
      ltgPct = possIsAway ? 100 : 0;
      isGoalToGo = true;
    } else if (possIsAway) {
      ltgPct = Math.min(100, losPct + distance);
      isGoalToGo = ltgPct >= 100;
    } else {
      ltgPct = Math.max(0, losPct - distance);
      isGoalToGo = ltgPct <= 0;
    }
  }

  const losLabel = possText || formatYardSpot(losPct, away.abbreviation, home.abbreviation);
  const ltgLabel =
    ltgPct !== null
      ? isGoalToGo
        ? 'Goal Line'
        : formatYardSpot(ltgPct, away.abbreviation, home.abbreviation)
      : '';

  const isRedZone =
    Boolean(sit?.isRedZone) ||
    (losPct !== null && possIsAway !== null && (possIsAway ? losPct >= 80 : losPct <= 20));

  const lastPlayText = sit?.lastPlay || lastPlay?.text || '';

  return {
    possTeam,
    possIsAway,
    downText,
    possText,
    losPct,
    ltgPct,
    isGoalToGo,
    isScrimmage,
    losLabel,
    ltgLabel,
    isRedZone,
    lastPlayText
  };
}

export function parseBarShare(awayVal, homeVal) {
  const parseNumeric = (v) => {
    if (typeof v !== 'string') return Number(v) || 0;
    if (v.includes(':')) {
      const [m, s] = v.split(':').map(Number);
      return (m || 0) * 60 + (s || 0);
    }
    if (v.includes('-') || v.includes('/')) {
      const parts = v.split(/[-/]/).map(Number);
      return Number.isFinite(parts[0]) ? parts[0] : 0;
    }
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  };
  const a = Math.max(0, parseNumeric(awayVal));
  const h = Math.max(0, parseNumeric(homeVal));
  const total = a + h;
  if (total <= 0) return { awayPct: 50, homePct: 50 };
  return {
    awayPct: Math.round((a / total) * 100),
    homePct: 100 - Math.round((a / total) * 100)
  };
}

function hexToRgb(hex) {
  if (typeof hex !== 'string') return null;
  const cleaned = hex.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) return null;
  return {
    r: parseInt(cleaned.slice(0, 2), 16),
    g: parseInt(cleaned.slice(2, 4), 16),
    b: parseInt(cleaned.slice(4, 6), 16)
  };
}

function rgbToHex(r, g, b) {
  const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)));
  return (
    '#' +
    [clamp(r), clamp(g), clamp(b)]
      .map((n) => n.toString(16).padStart(2, '0'))
      .join('')
  );
}

function rgbToHsl(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn:
        h = (gn - bn) / d + (gn < bn ? 6 : 0);
        break;
      case gn:
        h = (bn - rn) / d + 2;
        break;
      default:
        h = (rn - gn) / d + 4;
        break;
    }
    h /= 6;
  }

  return { h: h * 360, s: s * 100, l: l * 100 };
}

function hslToRgb(h, s, l) {
  const hn = ((h % 360) + 360) % 360 / 360;
  const sn = Math.max(0, Math.min(100, s)) / 100;
  const ln = Math.max(0, Math.min(100, l)) / 100;

  if (sn === 0) {
    const v = Math.round(ln * 255);
    return { r: v, g: v, b: v };
  }

  const hue2rgb = (p, q, t) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };

  const q = ln < 0.5 ? ln * (1 + sn) : ln + sn - ln * sn;
  const p = 2 * ln - q;
  return {
    r: Math.round(hue2rgb(p, q, hn + 1 / 3) * 255),
    g: Math.round(hue2rgb(p, q, hn) * 255),
    b: Math.round(hue2rgb(p, q, hn - 1 / 3) * 255)
  };
}

function relativeLuminance({ r, g, b }) {
  const linearize = (v) => {
    const srgb = v / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

function contrastRatio(rgb1, rgb2) {
  const l1 = relativeLuminance(rgb1);
  const l2 = relativeLuminance(rgb2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function colorDistance(hex1, hex2) {
  const c1 = hexToRgb(hex1);
  const c2 = hexToRgb(hex2);
  if (!c1 || !c2) return 0;
  const rMean = (c1.r + c2.r) / 2;
  const dR = c1.r - c2.r;
  const dG = c1.g - c2.g;
  const dB = c1.b - c2.b;
  return Math.sqrt(
    (2 + rMean / 256) * dR * dR +
      4 * dG * dG +
      (2 + (255 - rMean) / 256) * dB * dB
  );
}

function isChromaticColor(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return false;
  const { s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b);
  return s >= 16 && l >= 10 && l <= 88;
}

function isDarkAchromatic(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return false;
  const { s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b);
  return s < 14 && l < 38;
}

export function adaptColorForTheme(hex, theme) {
  const rgb = hexToRgb(hex);
  if (!rgb) return theme === 'dark' ? '#6cdbac' : '#006c47';

  let { h, s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b);
  const darkSurface = { r: 23, g: 29, b: 26 };
  const lightSurface = { r: 239, g: 245, b: 239 };

  if (theme === 'dark') {
    if (s < 14 && l < 38) return '#b8c4c0';
    let currentRgb = rgb;
    let guard = 0;
    const boostedS = Math.max(s, 52);
    while (contrastRatio(currentRgb, darkSurface) < 3.8 && l < 78 && guard < 30) {
      l = Math.min(78, l + 3);
      currentRgb = hslToRgb(h, boostedS, l);
      guard += 1;
    }
    return rgbToHex(currentRgb.r, currentRgb.g, currentRgb.b);
  }

  if (s < 14 && l > 82) return '#37423e';
  let currentRgb = rgb;
  let guard = 0;
  while (contrastRatio(currentRgb, lightSurface) < 3.4 && l > 22 && guard < 30) {
    l = Math.max(22, l - 3);
    currentRgb = hslToRgb(h, s, l);
    guard += 1;
  }
  return rgbToHex(currentRgb.r, currentRgb.g, currentRgb.b);
}

function resolveMatchupColors(away, home, eventPreview, theme) {
  const awayPri = away.color || eventPreview?.away?.color || '#1d4ed8';
  const awayAlt = away.alternateColor || eventPreview?.away?.alternateColor || null;
  const homePri = home.color || eventPreview?.home?.color || '#c2410c';
  const homeAlt = home.alternateColor || eventPreview?.home?.alternateColor || null;

  const candidates = [];
  if (theme === 'dark' && isDarkAchromatic(awayPri) && isChromaticColor(awayAlt)) {
    candidates.push([awayAlt, homePri]);
  }
  candidates.push([awayPri, homePri]);
  if (isChromaticColor(awayAlt)) {
    candidates.push([awayAlt, homePri]);
  }
  if (isChromaticColor(homeAlt)) {
    candidates.push([awayPri, homeAlt]);
  }
  if (isChromaticColor(awayAlt) && isChromaticColor(homeAlt)) {
    candidates.push([awayAlt, homeAlt]);
  }

  for (const [rawAway, rawHome] of candidates) {
    const adaptedAway = adaptColorForTheme(rawAway, theme);
    const adaptedHome = adaptColorForTheme(rawHome, theme);
    if (colorDistance(adaptedAway, adaptedHome) >= 135) {
      return { awayColor: adaptedAway, homeColor: adaptedHome };
    }
  }

  const adaptedHome = adaptColorForTheme(homePri, theme);
  const homeRgb = hexToRgb(adaptedHome);
  const homeHsl = homeRgb ? rgbToHsl(homeRgb.r, homeRgb.g, homeRgb.b) : { s: 50 };
  const roadFallback =
    homeHsl.s < 15
      ? theme === 'dark'
        ? '#60a5fa'
        : '#2563eb'
      : theme === 'dark'
        ? '#cbd5e1'
        : '#475569';

  return { awayColor: roadFallback, homeColor: adaptedHome };
}

function renderLinescore(away, home) {
  const cols = Math.max(away.linescores.length, home.linescores.length);
  if (cols === 0) return '';

  const headers = [];
  for (let i = 0; i < cols; i++) {
    headers.push(i < 4 ? String(i + 1) : `OT${i - 3}`);
  }

  return `
    <div class="linescore-table-wrap">
      <table class="linescore-table">
        <thead>
          <tr>
            <th>Team</th>
            ${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}
            <th>T</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>${away.id ? `<span class="team-page-link" data-team-id="${escapeHtml(away.id)}" role="link" tabindex="0">${escapeHtml(away.abbreviation)}</span>` : escapeHtml(away.abbreviation)}</td>
            ${headers.map((_, i) => `<td>${escapeHtml(away.linescores[i] ?? '-')}</td>`).join('')}
            <td>${escapeHtml(away.score || '0')}</td>
          </tr>
          <tr>
            <td>${home.id ? `<span class="team-page-link" data-team-id="${escapeHtml(home.id)}" role="link" tabindex="0">${escapeHtml(home.abbreviation)}</span>` : escapeHtml(home.abbreviation)}</td>
            ${headers.map((_, i) => `<td>${escapeHtml(home.linescores[i] ?? '-')}</td>`).join('')}
            <td>${escapeHtml(home.score || '0')}</td>
          </tr>
        </tbody>
      </table>
    </div>
  `;
}

function renderFieldBar(summary, eventPreview) {
  const sit = eventPreview?.situation;
  if (summary.state !== 'in' && !summary.currentDrive) {
    return '';
  }

  const away = summary.away;
  const home = summary.home;
  const field = computeFieldState(summary, eventPreview);
  const {
    possTeam,
    possIsAway,
    downText,
    possText,
    losPct,
    ltgPct,
    isGoalToGo,
    isScrimmage,
    losLabel,
    ltgLabel,
    isRedZone,
    lastPlayText
  } = field;

  const yardLabels = ['10', '20', '30', '40', '50', '40', '30', '20', '10', ''];
  const clampLine = (pct) => Math.max(0.4, Math.min(99.6, pct));
  const tagEdgeClass = (pct) => (pct < 6 ? ' edge-left' : pct > 94 ? ' edge-right' : '');
  const ltgStaggerClass =
    losPct !== null && ltgPct !== null && Math.abs(losPct - ltgPct) < 8 ? ' staggered' : '';

  const gainLeft = losPct !== null && ltgPct !== null ? Math.min(losPct, ltgPct) : 0;
  const gainWidth = losPct !== null && ltgPct !== null ? Math.abs(ltgPct - losPct) : 0;

  return `
    <div class="md-card field-card">
      <div class="field-situation-header">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          ${possTeam ? `<span class="status-pill live"><span class="possession-dot" style="background:currentColor;"></span>${escapeHtml(possTeam.abbreviation)} Ball</span>` : ''}
          ${downText ? `<strong>${escapeHtml(downText)}</strong>` : ''}
          ${possText ? `<span class="muted">(${escapeHtml(possText)})</span>` : ''}
        </div>
        ${isRedZone ? `<span class="status-pill live">RED ZONE</span>` : ''}
      </div>

      <div class="field-visual-bar" aria-label="Field position visualization">
        <div class="field-endzone">${escapeHtml(away.abbreviation)}</div>
        <div class="field-turf-grid">
          ${yardLabels
            .map((lbl, idx) => {
              const rzClass =
                isRedZone && ((possIsAway && idx >= 8) || (possIsAway === false && idx <= 1)) ? ' redzone' : '';
              return `<div class="field-stripe${rzClass}">${lbl}</div>`;
            })
            .join('')}
          ${
            losPct !== null && ltgPct !== null && gainWidth > 0
              ? `<div class="field-gain-zone" style="left:${gainLeft}%;width:${gainWidth}%;" title="Yards to gain"></div>`
              : ''
          }
          ${
            ltgPct !== null
              ? `<div class="field-ltg-line" style="left:${clampLine(ltgPct)}%" title="Line to Gain: ${escapeHtml(ltgLabel)}"><span class="field-line-tag ltg${tagEdgeClass(ltgPct)}${ltgStaggerClass}">${isGoalToGo ? 'GOAL' : '1ST'}</span></div>`
              : ''
          }
          ${
            losPct !== null
              ? `<div class="field-los-line" style="left:${clampLine(losPct)}%" title="Line of Scrimmage: ${escapeHtml(losLabel)}"><span class="field-line-tag los${tagEdgeClass(losPct)}">LOS</span><div class="field-ball-marker"><span class="material-symbols-rounded" style="font-size:13px;">sports_football</span>${possIsAway !== null ? `<span class="field-dir-arrow">${possIsAway ? '→' : '←'}</span>` : ''}</div></div>`
              : ''
          }
        </div>
        <div class="field-endzone">${escapeHtml(home.abbreviation)}</div>
      </div>

      ${
        losPct !== null
          ? `
        <div class="field-legend-row">
          <div class="field-legend-items">
            <span class="field-legend-item">
              <span class="field-legend-swatch los"></span>
              <span>Line of Scrimmage: <strong>${escapeHtml(losLabel)}</strong></span>
            </span>
            ${
              ltgPct !== null
                ? `
              <span class="field-legend-item">
                <span class="field-legend-swatch ltg"></span>
                <span>Line to Gain: <strong>${escapeHtml(ltgLabel)}</strong></span>
              </span>
            `
                : `<span class="field-legend-item muted">${isScrimmage ? '' : 'Kickoff / Extra Point Attempt'}</span>`
            }
          </div>
          ${
            possTeam && possIsAway !== null
              ? `<span class="field-drive-dir muted">${escapeHtml(possTeam.abbreviation)} driving ${possIsAway ? '→' : '←'}</span>`
              : ''
          }
        </div>
      `
          : ''
      }

      ${
        lastPlayText
          ? `<div class="muted" style="font-size:12px;"><strong>Last play:</strong> ${escapeHtml(lastPlayText)}</div>`
          : ''
      }
    </div>
  `;
}

function renderDriveCard(drive, summary, uiState, theme) {
  const isExpanded = drive.isCurrent || uiState.expandedDrives.has(drive.id);
  const pillClass = getDrivePillClass(drive);
  const plays = uiState.latestFirst ? [...drive.plays].reverse() : drive.plays;
  const driveScoreText = `${summary.away.abbreviation} ${drive.awayScore ?? 0} - ${summary.home.abbreviation} ${drive.homeScore ?? 0}`;

  return `
    <article class="drive-card${drive.isCurrent ? ' is-current' : ''}">
      <button class="drive-header-btn" type="button" data-drive-toggle="${escapeHtml(drive.id)}" aria-expanded="${isExpanded}">
        <div class="drive-header-left">
          ${renderTeamLogo(drive.team, { size: 'sm', theme })}
          <div class="drive-title-stack">
            <div class="drive-title-row">
              <span class="drive-team-abbr${drive.team?.id ? ' team-page-link' : ''}"${drive.team?.id ? ` data-team-id="${escapeHtml(drive.team.id)}" role="link" tabindex="0"` : ''}>${escapeHtml(drive.team.abbreviation || drive.team.displayName)}</span>
              <span class="drive-result-pill ${pillClass}">${escapeHtml(drive.displayResult)}</span>
            </div>
            <span class="drive-meta-text">${escapeHtml(drive.description || `${drive.offensivePlays} plays, ${drive.yards} yards`)}</span>
          </div>
        </div>
        <div class="drive-header-right">
          <span class="drive-score-text tabular${drive.isScore ? ' is-score' : ''}" title="Score at this series">${escapeHtml(driveScoreText)}</span>
          <span class="material-symbols-rounded muted">${isExpanded ? 'expand_less' : 'expand_more'}</span>
        </div>
      </button>
      ${
        isExpanded
          ? `
        <div class="drive-plays-body">
          ${
            plays.length > 0
              ? plays
                  .map((p) => {
                    const rowClass = p.scoringPlay
                      ? ' is-scoring'
                      : p.isTurnover
                        ? ' is-turnover'
                        : '';
                    const yardChip =
                      p.statYardage !== null && p.statYardage !== 0
                        ? `<span class="play-yard-chip ${p.statYardage > 0 ? 'gain' : 'loss'}">${p.statYardage > 0 ? '+' : ''}${p.statYardage} yds</span>`
                        : '';
                    return `
                      <div class="play-row${rowClass}">
                        <div class="play-meta-line">
                          <div class="play-badges-left">
                            <span class="play-clock">Q${escapeHtml(p.period)} · ${escapeHtml(p.clock || '')}</span>
                            ${p.downDistanceText ? `<span>${escapeHtml(p.downDistanceText)}</span>` : ''}
                            ${p.possessionText ? `<span>@ ${escapeHtml(p.possessionText)}</span>` : ''}
                            ${yardChip}
                            ${p.isPenalty ? `<span class="play-yard-chip">PENALTY</span>` : ''}
                          </div>
                          <span class="tabular">${escapeHtml(summary.away.abbreviation)} ${escapeHtml(p.awayScore)} - ${escapeHtml(summary.home.abbreviation)} ${escapeHtml(p.homeScore)}</span>
                        </div>
                        <div class="play-text">${escapeHtml(p.text)}</div>
                      </div>
                    `;
                  })
                  .join('')
              : `<div class="play-row"><span class="muted">Play details pending from ESPN feed.</span></div>`
          }
        </div>
      `
          : ''
      }
    </article>
  `;
}

function renderPreGamePreview(summary, eventPreview, theme) {
  const awayLeaders = eventPreview?.away?.leaders || [];
  const homeLeaders = eventPreview?.home?.leaders || [];
  const allLeaders = [
    ...awayLeaders.map((l) => ({ ...l, team: summary.away })),
    ...homeLeaders.map((l) => ({ ...l, team: summary.home }))
  ];
  const odds = summary.odds || eventPreview?.odds;

  return `
    <div class="md-card md-card-filled" style="padding:16px;margin-top:14px;">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
        <div>
          <strong style="font-size:15px;">Matchup Preview</strong>
          <div class="muted" style="font-size:12px;">Play-by-play drives will stream live once kickoff begins.</div>
        </div>
        ${
          odds?.details
            ? `<span class="status-pill pre">${escapeHtml(odds.details)}${odds.overUnder ? ` · O/U ${escapeHtml(odds.overUnder)}` : ''}</span>`
            : ''
        }
      </div>

      ${
        allLeaders.length > 0
          ? `
        <div class="leaders-grid">
          ${allLeaders
            .map(
              (l) => `
            <div class="md-card leader-card">
              ${
                l.headshot
                  ? `<img class="leader-avatar" src="${escapeHtml(l.headshot)}" alt="${escapeHtml(l.athleteName)}" loading="lazy" onerror="this.style.display='none'">`
                  : renderTeamLogo(l.team, { theme })
              }
              <div style="min-width:0;">
                <div style="font-size:11px;font-weight:700;color:var(--md-sys-color-primary);">
                  <span${l.team?.id ? ` class="team-page-link" data-team-id="${escapeHtml(l.team.id)}" role="link" tabindex="0"` : ''}>${escapeHtml(l.team.abbreviation)}</span> · ${escapeHtml(l.category)}
                </div>
                <div style="font-weight:700;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(l.athleteName)}</div>
                <div class="muted" style="font-size:12px;">${escapeHtml(l.displayValue)}</div>
              </div>
            </div>
          `
            )
            .join('')}
        </div>
      `
          : `<p class="muted" style="margin:12px 0 0;">Season stat leaders will populate closer to kickoff.</p>`
      }
    </div>
  `;
}

function renderPlayByPlayTab(summary, eventPreview, uiState, theme) {
  const prev = (summary.previousDrives || []).filter(
    (d) => !summary.currentDrive || String(d.id) !== String(summary.currentDrive.id)
  );
  const allDrives = uiState.latestFirst
    ? [...(summary.currentDrive ? [summary.currentDrive] : []), ...[...prev].reverse()]
    : [...prev, ...(summary.currentDrive ? [summary.currentDrive] : [])];

  if (allDrives.length === 0) {
    return renderPreGamePreview(summary, eventPreview, theme);
  }

  const filteredDrives =
    uiState.pbpFilter === 'scoring' ? allDrives.filter((d) => d.isScore || d.isCurrent) : allDrives;

  return `
    <div class="pbp-toolbar">
      <div class="md-chip-row">
        <button class="md-chip${uiState.pbpFilter === 'all' ? ' selected' : ''}" type="button" data-pbp-filter="all">
          All Drives (${allDrives.length})
        </button>
        <button class="md-chip${uiState.pbpFilter === 'scoring' ? ' selected' : ''}" type="button" data-pbp-filter="scoring">
          Scoring Drives (${allDrives.filter((d) => d.isScore).length})
        </button>
      </div>
      <button class="md-chip${uiState.latestFirst ? ' selected' : ''}" type="button" data-pbp-order>
        <span class="material-symbols-rounded">swap_vert</span>
        ${uiState.latestFirst ? 'Latest First' : '1st Drive First'}
      </button>
    </div>

    <div class="drives-list">
      ${
        filteredDrives.length > 0
          ? filteredDrives.map((d) => renderDriveCard(d, summary, uiState, theme)).join('')
          : `<div class="md-card empty-state-card"><p class="empty-state-desc">No scoring drives yet in this game.</p></div>`
      }
    </div>
  `;
}

function renderScoringTab(summary, theme) {
  const plays = summary.scoringPlays || [];
  if (plays.length === 0) {
    return `
      <div class="md-card empty-state-card" style="margin-top:14px;">
        <span class="material-symbols-rounded">scoreboard</span>
        <p class="empty-state-title">No Scoring Plays Yet</p>
        <p class="empty-state-desc">Scoring drives and quarter summaries will appear here once points are on the board.</p>
      </div>
    `;
  }

  const byQuarter = new Map();
  plays.forEach((sp) => {
    const q = sp.period || 1;
    if (!byQuarter.has(q)) byQuarter.set(q, []);
    byQuarter.get(q).push(sp);
  });

  return `
    <div style="margin-top:14px;">
      ${Array.from(byQuarter.entries())
        .map(
          ([period, items]) => `
        <div class="scoring-quarter-group">
          <h4 class="scoring-quarter-title">${escapeHtml(quarterLabel(period))}</h4>
          ${items
            .map(
              (sp) => `
            <div class="md-card scoring-play-card">
              <div style="display:flex;align-items:center;gap:10px;min-width:0;flex:1;">
                ${renderTeamLogo({ logo: sp.teamLogo, logoDark: sp.teamLogoDark, abbreviation: sp.teamAbbr, displayName: sp.teamName }, { size: 'sm', theme })}
                <div style="min-width:0;">
                  <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:2px;">
                    <span class="drive-result-pill score">${escapeHtml(sp.scoringType)}</span>
                    <strong${sp.teamId ? ` class="team-page-link" data-team-id="${escapeHtml(sp.teamId)}" role="link" tabindex="0"` : ''}>${escapeHtml(sp.teamAbbr)}</strong>
                    <span class="muted tabular" style="font-size:12px;">${escapeHtml(sp.clock)}</span>
                  </div>
                  <div style="font-size:13px;">${escapeHtml(sp.text)}</div>
                </div>
              </div>
              <div class="scoring-play-score">
                ${escapeHtml(summary.away.abbreviation)} ${escapeHtml(sp.awayScore)} - ${escapeHtml(summary.home.abbreviation)} ${escapeHtml(sp.homeScore)}
              </div>
            </div>
          `
            )
            .join('')}
        </div>
      `
        )
        .join('')}
    </div>
  `;
}

function renderStatsTab(summary, eventPreview, theme) {
  const rows = summary.boxscoreRows;
  const leaders = summary.leaders || [];

  if (!rows || rows.length === 0) {
    return `
      <div class="md-card empty-state-card" style="margin-top:14px;">
        <span class="material-symbols-rounded">analytics</span>
        <p class="empty-state-title">Boxscore Stats Not Available Yet</p>
        <p class="empty-state-desc">Team yardage, efficiency, and player game leaders appear once kickoff begins.</p>
      </div>
    `;
  }

  const { awayColor, homeColor } = resolveMatchupColors(summary.away, summary.home, eventPreview, theme);

  return `
    <div class="md-card" style="padding:16px;margin-top:14px;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px;">
        <div style="display:flex;align-items:center;gap:6px;">
          ${renderTeamLogo(summary.away, { size: 'sm', theme })}
          <span class="team-color-swatch" style="background:${awayColor}"></span>
          <strong class="team-page-link" style="color:${awayColor};"${summary.away.id ? ` data-team-id="${escapeHtml(summary.away.id)}" role="link" tabindex="0"` : ''}>${escapeHtml(summary.away.abbreviation)}</strong>
        </div>
        <span class="muted" style="font-size:12px;font-weight:700;">TEAM COMPARISON</span>
        <div style="display:flex;align-items:center;gap:6px;">
          <strong class="team-page-link" style="color:${homeColor};"${summary.home.id ? ` data-team-id="${escapeHtml(summary.home.id)}" role="link" tabindex="0"` : ''}>${escapeHtml(summary.home.abbreviation)}</strong>
          <span class="team-color-swatch" style="background:${homeColor}"></span>
          ${renderTeamLogo(summary.home, { size: 'sm', theme })}
        </div>
      </div>
      <div class="stats-comparison-list">
        ${rows
          .map((r) => {
            const { awayPct, homePct } = parseBarShare(r.awayValue, r.homeValue);
            return `
              <div class="stat-compare-item">
                <div class="stat-compare-labels">
                  <strong>${escapeHtml(r.awayValue)}</strong>
                  <span class="muted">${escapeHtml(r.label)}</span>
                  <strong>${escapeHtml(r.homeValue)}</strong>
                </div>
                <div class="stat-compare-bar">
                  <div class="stat-bar-away" style="width:${awayPct}%;background-color:${awayColor};${awayPct === 0 ? 'display:none;' : ''}"></div>
                  <div class="stat-bar-home" style="width:${homePct}%;background-color:${homeColor};${homePct === 0 ? 'display:none;' : ''}"></div>
                </div>
              </div>
            `;
          })
          .join('')}
      </div>
    </div>

    ${
      leaders.length > 0
        ? `
      <div class="leaders-grid">
        ${leaders
          .flatMap((teamBlock) =>
            teamBlock.categories.map((c) => ({
              ...c,
              teamId: teamBlock.teamId,
              teamAbbr: teamBlock.teamAbbr
            }))
          )
          .map((l) => {
            const isAwayLeader = l.teamId ? l.teamId === summary.away.id : l.teamAbbr === summary.away.abbreviation;
            const leaderColor = isAwayLeader ? awayColor : homeColor;
            return `
          <div class="md-card leader-card">
            ${
              l.headshot
                ? `<img class="leader-avatar" src="${escapeHtml(l.headshot)}" alt="${escapeHtml(l.athleteName)}" loading="lazy" onerror="this.style.display='none'">`
                : renderTeamLogo(
                    isAwayLeader ? summary.away : summary.home,
                    { theme }
                  )
            }
            <div style="min-width:0;">
              <div style="font-size:11px;font-weight:700;color:${leaderColor};">
                <span${l.teamId ? ` class="team-page-link" data-team-id="${escapeHtml(l.teamId)}" role="link" tabindex="0"` : ''}>${escapeHtml(l.teamAbbr)}</span> · ${escapeHtml(l.category)}
              </div>
              <div style="font-weight:700;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(l.athleteName)}</div>
              <div class="muted" style="font-size:12px;">${escapeHtml(l.displayValue)}</div>
            </div>
          </div>
        `;
          })
          .join('')}
      </div>
    `
        : ''
    }
  `;
}

function renderGameDetailMarkup(summary, eventPreview, uiState, theme) {
  const away = summary.away;
  const home = summary.home;
  const isPre = summary.state === 'pre';
  const isLive = summary.state === 'in';
  const pillClass = isLive ? 'live' : isPre ? 'pre' : 'post';

  const statusText = isPre
    ? `${formatDayHeading(summary.date)} · ${formatKickoffTime(summary.date)}`
    : summary.statusDetail || (isLive ? 'LIVE' : 'Final');

  const venueParts = [summary.venue.name, summary.venue.city, summary.venue.state].filter(Boolean);
  const broadcast = summary.broadcast || eventPreview?.broadcast || '';
  const state = getState();
  const matchedStream = isLive
    ? findStreamForEspnEvent(summary, state) ||
      (eventPreview ? findStreamForEspnEvent(eventPreview, state) : null)
    : null;
  const eventIdVal = summary.id || eventPreview?.id || '';

  return `
    <div class="md-card md-card-elevated detail-hero-card">
      <div class="detail-hero-meta">
        <span class="status-pill ${pillClass}">
          ${isLive ? '<span class="pulse-dot live"></span>' : ''}
          ${escapeHtml(statusText)}
        </span>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          ${
            isLive && eventIdVal
              ? `
            <button
              class="watch-stream-link detail-watch-btn"
              type="button"
              data-watch-event="${escapeHtml(eventIdVal)}"
              ${matchedStream ? `data-watch-stream-id="${escapeHtml(matchedStream.id)}" data-watch-stream-source="${escapeHtml(matchedStream.source)}"` : ''}
              title="${matchedStream ? `Watch ${escapeHtml(matchedStream.name)} on ${escapeHtml(matchedStream.sourceLabel)}` : 'Watch live game stream'}"
            >
              <span class="material-symbols-rounded" style="font-size:15px;">live_tv</span>
              <span>Watch Stream</span>
            </button>
          `
              : ''
          }
          ${broadcast ? `<span class="broadcast-tag">${escapeHtml(broadcast)}</span>` : ''}
          ${venueParts.length ? `<span class="muted" style="font-size:12px;">${escapeHtml(venueParts.join(', '))}</span>` : ''}
        </div>
      </div>

      <div class="detail-matchup-grid">
        <div class="detail-team-col away">
          ${renderTeamLogo(away, { size: 'lg', theme })}
          <div style="min-width:0;">
            <div class="detail-team-name-row">
              ${renderRankBadge(away.rank || eventPreview?.away?.rank)}
              <span class="detail-team-title${away.id ? ' team-page-link' : ''}"${away.id ? ` data-team-id="${escapeHtml(away.id)}" role="link" tabindex="0" title="View ${escapeHtml(away.displayName)} team page"` : ''}>${escapeHtml(away.displayName)}</span>
              ${away.possession ? '<span class="possession-dot" title="Possession"></span>' : ''}
            </div>
            <div class="muted" style="font-size:12px;">${escapeHtml(away.overallRecord || eventPreview?.away?.overallRecord || '')}</div>
          </div>
        </div>

        <div class="detail-score-center">
          ${
            isPre
              ? `<span class="muted" style="font-size:16px;font-weight:700;">@</span>`
              : `
            <span class="${away.winner ? 'diff-pos' : ''}">${escapeHtml(away.score || '0')}</span>
            <span class="score-divider">-</span>
            <span class="${home.winner ? 'diff-pos' : ''}">${escapeHtml(home.score || '0')}</span>
          `
          }
        </div>

        <div class="detail-team-col home">
          ${renderTeamLogo(home, { size: 'lg', theme })}
          <div style="min-width:0;">
            <div class="detail-team-name-row">
              ${home.possession ? '<span class="possession-dot" title="Possession"></span>' : ''}
              <span class="detail-team-title${home.id ? ' team-page-link' : ''}"${home.id ? ` data-team-id="${escapeHtml(home.id)}" role="link" tabindex="0" title="View ${escapeHtml(home.displayName)} team page"` : ''}>${escapeHtml(home.displayName)}</span>
              ${renderRankBadge(home.rank || eventPreview?.home?.rank)}
            </div>
            <div class="muted" style="font-size:12px;">${escapeHtml(home.overallRecord || eventPreview?.home?.overallRecord || '')}</div>
          </div>
        </div>
      </div>

      ${renderLinescore(away, home)}
    </div>

    ${renderFieldBar(summary, eventPreview)}

    <div class="md-tabs" role="tablist">
      <button class="md-tab${uiState.activeTab === 'pbp' ? ' active' : ''}" type="button" role="tab" data-detail-tab="pbp">
        <span class="material-symbols-rounded" style="font-size:18px;">sports_football</span>
        Play-by-Play
      </button>
      <button class="md-tab${uiState.activeTab === 'scoring' ? ' active' : ''}" type="button" role="tab" data-detail-tab="scoring">
        <span class="material-symbols-rounded" style="font-size:18px;">scoreboard</span>
        Scoring (${summary.scoringPlays.length})
      </button>
      <button class="md-tab${uiState.activeTab === 'stats' ? ' active' : ''}" type="button" role="tab" data-detail-tab="stats">
        <span class="material-symbols-rounded" style="font-size:18px;">analytics</span>
        Team Stats
      </button>
    </div>

    <div class="detail-tab-panel">
      ${
        uiState.activeTab === 'pbp'
          ? renderPlayByPlayTab(summary, eventPreview, uiState, theme)
          : uiState.activeTab === 'scoring'
            ? renderScoringTab(summary, theme)
            : renderStatsTab(summary, eventPreview, theme)
      }
    </div>
  `;
}

export async function mountGameDetail(container, eventId, { eventPreview = null, force = false, showSkeleton = true } = {}) {
  if (!container || !eventId) return;

  if (showSkeleton && container.dataset.loadedEventId !== String(eventId)) {
    container.innerHTML = `
      <div class="skeleton" style="height:170px;margin-bottom:14px;"></div>
      <div class="skeleton" style="height:48px;margin-bottom:14px;"></div>
      <div class="skeleton" style="height:240px;"></div>
    `;
  }

  try {
    const summary = await getGameSummary(eventId, { force });
    // Guard against stale async arrival if user clicked a different game meanwhile
    if (container.dataset.targetEventId && container.dataset.targetEventId !== String(eventId)) {
      return;
    }

    const uiState = getUiState(eventId);
    if (!uiState.initializedDrives) {
      uiState.initializedDrives = true;
      if (summary.currentDrive) {
        uiState.expandedDrives.add(summary.currentDrive.id);
      } else if (summary.previousDrives.length > 0) {
        const latestDrive = summary.previousDrives[summary.previousDrives.length - 1];
        uiState.expandedDrives.add(latestDrive.id);
      }
    }

    const draw = () => {
      const { theme } = getState();
      const isSameEvent = container.dataset.loadedEventId === String(eventId);
      const prevContainerScrollTop = isSameEvent ? container.scrollTop : 0;
      const prevWinX = window.scrollX || window.pageXOffset || 0;
      const prevWinY = window.scrollY || window.pageYOffset || 0;
      container.dataset.loadedEventId = String(eventId);
      container.innerHTML = renderGameDetailMarkup(summary, eventPreview, uiState, theme);
      if (isSameEvent) {
        container.scrollTop = prevContainerScrollTop;
        if (
          (window.scrollX || window.pageXOffset || 0) !== prevWinX ||
          (window.scrollY || window.pageYOffset || 0) !== prevWinY
        ) {
          window.scrollTo(prevWinX, prevWinY);
        }
      }

      container.querySelectorAll('[data-detail-tab]').forEach((btn) => {
        btn.addEventListener('click', () => {
          uiState.activeTab = btn.dataset.detailTab;
          draw();
        });
      });

      container.querySelectorAll('[data-pbp-filter]').forEach((btn) => {
        btn.addEventListener('click', () => {
          uiState.pbpFilter = btn.dataset.pbpFilter;
          draw();
        });
      });

      const orderBtn = container.querySelector('[data-pbp-order]');
      if (orderBtn) {
        orderBtn.addEventListener('click', () => {
          uiState.latestFirst = !uiState.latestFirst;
          draw();
        });
      }

      container.querySelectorAll('[data-drive-toggle]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          if (e.target.closest('[data-team-id]')) return;
          const id = btn.dataset.driveToggle;
          if (uiState.expandedDrives.has(id)) {
            uiState.expandedDrives.delete(id);
          } else {
            uiState.expandedDrives.add(id);
          }
          draw();
        });
      });
    };

    draw();
  } catch (err) {
    container.innerHTML = `
      <div class="md-card empty-state-card">
        <span class="material-symbols-rounded">error_outline</span>
        <p class="empty-state-title">Unable to load Game Center</p>
        <p class="empty-state-desc">${escapeHtml(err.message)}</p>
      </div>
    `;
  }
}
