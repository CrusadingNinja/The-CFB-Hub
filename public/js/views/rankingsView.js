import { getState, setState } from '../store.js';
import { POWER_4_CONFERENCE_IDS } from './scheduleView.js';
import { escapeHtml, renderTeamLogo } from '../ui.js';

// ESPN Group of 6 Conference IDs:
// 9 = Pac-12, 12 = Conference USA, 15 = MAC, 17 = Mountain West, 37 = Sun Belt, 151 = American
const GROUP_OF_6_CONFERENCE_IDS = new Set(['9', '12', '15', '17', '37', '151']);
const FBS_INDEPENDENT_CONFERENCE_ID = '18';

function isGroupOf6Team(row, conferenceMap) {
  const cid = String(row?.conferenceId || '').trim();
  if (cid) {
    if (GROUP_OF_6_CONFERENCE_IDS.has(cid)) return true;
    if (!POWER_4_CONFERENCE_IDS.has(cid) && cid !== FBS_INDEPENDENT_CONFERENCE_ID) {
      return true;
    }
    return false;
  }

  const confLabel = String(row?.conferenceShortName || conferenceMap?.[cid]?.shortName || '').trim();
  return /^(Pac-12|American|AAC|Mountain West|MWC|Sun Belt|SBC|MAC|Mid-American|CUSA|Conf\.?\s*USA)$/i.test(
    confLabel
  );
}

function computeCfpPlayoffInfo(allRanks, conferenceMap) {
  const ranked = (allRanks || [])
    .filter((r) => Number(r.current) > 0)
    .slice()
    .sort((a, b) => a.current - b.current);
  const topG6Team = ranked.find((r) => isGroupOf6Team(r, conferenceMap)) || null;
  const g6OutsideTop12 = Boolean(topG6Team && topG6Team.current > 12);
  const cutoffRank = g6OutsideTop12 ? 11 : 12;
  return {
    topG6Team,
    g6OutsideTop12,
    cutoffRank
  };
}

function formatPollDate(isoDate) {
  if (!isoDate) return '';
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(d);
}

function getWeekDetailText(weekObj, seasonYear) {
  if (!weekObj) return '';
  if (weekObj.seasonType === '1') return 'Initial Poll';
  if (weekObj.seasonType === '3') return 'Postseason';
  const wkNum = Number(weekObj.week || 0);
  const yrNum = Number(seasonYear || 0);
  if (yrNum >= 2026 && wkNum >= 10) return 'CFP + AP';
  return 'Regular';
}

function matchesFilters(row, confFilter, searchQuery, conferenceMap) {
  if (confFilter === 'power4') {
    if (!POWER_4_CONFERENCE_IDS.has(String(row.conferenceId || ''))) {
      return false;
    }
  } else if (confFilter !== 'all') {
    if (String(row.conferenceId || '') !== String(confFilter)) {
      return false;
    }
  }

  const q = searchQuery.trim().toLowerCase();
  if (q) {
    const confName = conferenceMap[row.conferenceId]?.name || '';
    const confShort = row.conferenceShortName || conferenceMap[row.conferenceId]?.shortName || '';
    const haystack = [
      row.displayName,
      row.shortName,
      row.abbreviation,
      confShort,
      confName
    ]
      .join(' ')
      .toLowerCase();
    if (!haystack.includes(q)) {
      return false;
    }
  }

  return true;
}

function renderTrendCell(row) {
  let pill = `<span class="rank-trend-pill same">${escapeHtml(row.trendDisplay || '—')}</span>`;
  if (row.movement === 'up') {
    pill = `
      <span class="rank-trend-pill up" title="Up ${row.delta} spot${row.delta === 1 ? '' : 's'} from ${escapeHtml(row.previousDisplay)}">
        <span class="material-symbols-rounded" style="font-size:15px;">arrow_drop_up</span>
        <span>${escapeHtml(row.trendDisplay)}</span>
      </span>
    `;
  } else if (row.movement === 'down') {
    pill = `
      <span class="rank-trend-pill down" title="Down ${row.delta} spot${row.delta === 1 ? '' : 's'} from ${escapeHtml(row.previousDisplay)}">
        <span class="material-symbols-rounded" style="font-size:15px;">arrow_drop_down</span>
        <span>${escapeHtml(row.trendDisplay)}</span>
      </span>
    `;
  } else if (row.movement === 'new') {
    pill = `<span class="rank-trend-pill new" title="Entered Top 25 (Previously Unranked)">NEW</span>`;
  }

  const prevMeta =
    row.previousDisplay && row.previousDisplay !== '—'
      ? `<span class="rank-prev-text">Prev ${escapeHtml(row.previousDisplay)}</span>`
      : '';

  return `
    <div class="rank-trend-cell">
      ${pill}
      ${prevMeta}
    </div>
  `;
}

function renderExtraSection(title, items, type, { theme, confFilter, searchQuery, conferenceMap }) {
  const filtered = (items || []).filter((item) =>
    matchesFilters(item, confFilter, searchQuery, conferenceMap)
  );
  if (filtered.length === 0) return '';

  return `
    <div class="rankings-extra-section">
      <div class="rankings-extra-title">${escapeHtml(title)} (${filtered.length})</div>
      <div class="rankings-extra-chips">
        ${filtered
          .map((item) => {
            const detail =
              type === 'others'
                ? item.points > 0
                  ? `${item.points} pts`
                  : 'RV'
                : item.previous > 0
                  ? `was #${item.previous}`
                  : 'Dropped';
            return `
              <span
                class="rankings-extra-chip team-page-link"
                data-team-id="${escapeHtml(item.id)}"
                role="link"
                tabindex="0"
                title="Open ${escapeHtml(item.displayName)} team page"
              >
                ${renderTeamLogo(item, { size: 'sm', theme })}
                <span class="rankings-extra-name">${escapeHtml(item.shortName)}</span>
                <span class="rankings-extra-meta tabular">${escapeHtml(detail)}</span>
              </span>
            `;
          })
          .join('')}
      </div>
    </div>
  `;
}

function renderPollCard(
  poll,
  pollType,
  {
    theme,
    confFilter,
    searchQuery,
    conferenceMap,
    activeWeekLabel,
    activeWeekKey,
    latestWeekKey,
    weeks,
    viewMode
  }
) {
  const isCfp = pollType === 'cfp';
  const badgeText = isCfp ? 'CFP SELECTION COMMITTEE' : 'ASSOCIATED PRESS';
  const titleText = isCfp ? 'College Football Playoff Rankings' : 'AP Top 25 Poll';
  const iconName = isCfp ? 'trophy' : 'format_list_numbered';

  if (!poll) {
    const hasCfpWeek10 = weeks.some((w) => w.key === '2:10');
    const canJumpLatest = Boolean(latestWeekKey && activeWeekKey !== latestWeekKey);
    return `
      <section class="md-card rankings-poll-card ${pollType}">
        <header class="rankings-poll-header">
          <div>
            <span class="rankings-poll-badge ${pollType}">${escapeHtml(badgeText)}</span>
            <h3 class="rankings-poll-title">${escapeHtml(titleText)}</h3>
          </div>
          <span class="material-symbols-rounded muted" style="font-size:24px;">${iconName}</span>
        </header>
        <div class="rankings-unavailable-box">
          <span class="material-symbols-rounded muted" style="font-size:38px;">event_upcoming</span>
          <p class="empty-state-title">${escapeHtml(
            isCfp
              ? `CFP Committee Rankings Not Yet Released for ${activeWeekLabel}`
              : `No ${titleText} published for ${activeWeekLabel}`
          )}</p>
          <p class="empty-state-desc">${escapeHtml(
            isCfp
              ? 'The College Football Playoff Selection Committee begins releasing weekly Top 25 rankings later in the regular season (starting Week 10).'
              : 'No Associated Press Top 25 ballot was published for this week.'
          )}</p>
          <div class="rankings-unavailable-actions">
            ${
              isCfp && hasCfpWeek10 && activeWeekKey !== '2:10'
                ? `<button class="md-btn md-btn-tonal" type="button" data-jump-cfp-week>View First CFP Rankings (Week 10)</button>`
                : ''
            }
            ${
              canJumpLatest
                ? `<button class="md-btn md-btn-filled" type="button" data-jump-latest-rankings>Jump to Latest Week</button>`
                : ''
            }
            ${
              isCfp && viewMode === 'cfp'
                ? `<button class="md-btn md-btn-outlined" type="button" data-switch-mode-ap>Focus AP Top 25 Only</button>`
                : ''
            }
          </div>
        </div>
      </section>
    `;
  }

  const allRanks = poll.ranks || [];
  const filteredRanks = allRanks.filter((row) =>
    matchesFilters(row, confFilter, searchQuery, conferenceMap)
  );
  const cfpInfo = isCfp ? computeCfpPlayoffInfo(allRanks, conferenceMap) : null;
  const showCutline =
    isCfp &&
    confFilter === 'all' &&
    !searchQuery.trim() &&
    filteredRanks.some((r) => r.current === cfpInfo.cutoffRank);

  let cfpLegendText = 'Top 12 Playoff Field';
  let cfpLegendTitle = 'Top 12 CFP Rankings Field';
  if (isCfp && cfpInfo?.topG6Team) {
    if (cfpInfo.g6OutsideTop12) {
      cfpLegendText = `Cutoff: Top 11 + #${cfpInfo.topG6Team.current} ${cfpInfo.topG6Team.shortName} (G6)`;
      cfpLegendTitle = `Top-ranked Group of 6 team (#${cfpInfo.topG6Team.current} ${cfpInfo.topG6Team.displayName}) claims an automatic Playoff slot, setting the at-large cutoff at Top 11`;
    } else {
      cfpLegendText = `Top 12 Playoff Field (#${cfpInfo.topG6Team.current} ${cfpInfo.topG6Team.shortName} G6)`;
      cfpLegendTitle = `Top 12 CFP Rankings Field includes top-ranked Group of 6 team (#${cfpInfo.topG6Team.current} ${cfpInfo.topG6Team.displayName})`;
    }
  }

  const dateText = formatPollDate(poll.date);
  const occText = poll.isPreseasonCarryover
    ? 'Preseason Poll · Active entering Week 1'
    : poll.occurrenceLabel || activeWeekLabel;
  const subParts = [occText, dateText].filter(Boolean);

  return `
    <section class="md-card rankings-poll-card ${pollType}">
      <header class="rankings-poll-header">
        <div>
          <div class="rankings-poll-badge-row">
            <span class="rankings-poll-badge ${pollType}">${escapeHtml(badgeText)}</span>
            ${
              poll.isPreseasonCarryover
                ? `<span class="status-pill pre">Preseason Carryover</span>`
                : ''
            }
          </div>
          <h3 class="rankings-poll-title">${escapeHtml(titleText)}</h3>
          <div class="rankings-poll-subtitle">${escapeHtml(subParts.join(' · '))}</div>
        </div>
        ${
          isCfp
            ? `<span class="rankings-legend-pill" title="${escapeHtml(cfpLegendTitle)}">${escapeHtml(cfpLegendText)}</span>`
            : `<span class="rankings-legend-pill">${filteredRanks.length} of ${allRanks.length}</span>`
        }
      </header>

      ${
        filteredRanks.length === 0
          ? `
        <div class="rankings-unavailable-box" style="padding:28px 18px;">
          <span class="material-symbols-rounded muted" style="font-size:32px;">filter_alt_off</span>
          <p class="empty-state-title">No ranked teams match the current filters</p>
          <button class="md-btn md-btn-tonal" type="button" data-reset-rankings-filters>Clear Filters</button>
        </div>
      `
          : `
        <div class="rankings-table-wrap">
          <table class="rankings-table">
            <thead>
              <tr>
                <th style="width:52px;text-align:center;">Rank</th>
                <th>Team</th>
                <th style="text-align:right;">Record</th>
                ${!isCfp ? '<th style="text-align:right;">Pts</th>' : ''}
                <th style="text-align:right;">Trend</th>
              </tr>
            </thead>
            <tbody>
              ${filteredRanks
                .map((row) => {
                  const isTopG6 = Boolean(
                    isCfp && cfpInfo?.topG6Team && String(row.id) === String(cfpInfo.topG6Team.id)
                  );
                  const inPlayoffField =
                    isCfp && (row.current <= cfpInfo.cutoffRank || isTopG6);
                  const isBumpedOut = Boolean(
                    isCfp && cfpInfo?.g6OutsideTop12 && row.current === 12 && !isTopG6
                  );
                  const tierClass = isCfp
                    ? row.current <= 4
                      ? ' top-4'
                      : inPlayoffField
                        ? ' top-12'
                        : ''
                    : row.current <= 4
                      ? ' top-4'
                      : '';
                  const isCutlineRow = showCutline && row.current === cfpInfo.cutoffRank;
                  const confLabel =
                    row.conferenceShortName || conferenceMap[row.conferenceId]?.shortName || '';
                  return `
                    <tr class="rankings-row${isCutlineRow ? ' cfp-cutline-row' : ''}${isTopG6 ? ' cfp-g6-playoff-row' : ''}">
                      <td style="text-align:center;">
                        <span class="rank-number-pill${tierClass} tabular">${row.current}</span>
                      </td>
                      <td>
                        <div class="rankings-team-cell">
                          ${renderTeamLogo(row, { size: 'sm', theme })}
                          <div class="rankings-team-meta">
                            <div class="rankings-team-name-line">
                              <span
                                class="rankings-team-name team-page-link"
                                data-team-id="${escapeHtml(row.id)}"
                                role="link"
                                tabindex="0"
                                title="Open ${escapeHtml(row.displayName)} team page"
                              >${escapeHtml(row.shortName)}</span>
                              ${
                                isTopG6
                                  ? `<span class="cfp-bid-pill g6-bid" title="Top-ranked Group of 6 team — guaranteed College Football Playoff slot">G6 Playoff Slot</span>`
                                  : ''
                              }
                              ${
                                isBumpedOut
                                  ? `<span class="cfp-bid-pill first-out" title="Outside playoff cutoff because #${cfpInfo.topG6Team.current} ${escapeHtml(cfpInfo.topG6Team.displayName)} claims the Group of 6 automatic slot">Bumped by G6 Bid</span>`
                                  : ''
                              }
                              ${
                                !isCfp && row.firstPlaceVotes > 0
                                  ? `<span class="fpv-pill tabular" title="${row.firstPlaceVotes} first-place vote${row.firstPlaceVotes === 1 ? '' : 's'}">(${row.firstPlaceVotes})</span>`
                                  : ''
                              }
                            </div>
                            ${confLabel ? `<span class="rankings-team-conf">${escapeHtml(confLabel)}</span>` : ''}
                          </div>
                        </div>
                      </td>
                      <td style="text-align:right;" class="tabular">
                        <strong>${escapeHtml(row.recordSummary || '—')}</strong>
                      </td>
                      ${
                        !isCfp
                          ? `<td style="text-align:right;" class="tabular muted">${row.points > 0 ? escapeHtml(row.points.toLocaleString()) : '—'}</td>`
                          : ''
                      }
                      <td style="text-align:right;">
                        ${renderTrendCell(row)}
                      </td>
                    </tr>
                    ${
                      isCutlineRow
                        ? `
                      <tr class="cfp-cutline-banner-row">
                        <td colspan="${isCfp ? 4 : 5}">
                          <div class="cfp-cutline-banner-inner">
                            <span class="material-symbols-rounded" style="font-size:15px;">horizontal_rule</span>
                            <span>${
                              cfpInfo.g6OutsideTop12 && cfpInfo.topG6Team
                                ? `Playoff Cutoff (Top 11) · #${cfpInfo.topG6Team.current} ${escapeHtml(cfpInfo.topG6Team.shortName)} claims the 12th Playoff slot as Top Group of 6 team`
                                : '12-Team Playoff Cutoff'
                            }</span>
                          </div>
                        </td>
                      </tr>
                    `
                        : ''
                    }
                  `;
                })
                .join('')}
            </tbody>
          </table>
        </div>
      `
      }

      ${renderExtraSection('Others Receiving Votes', poll.others, 'others', {
        theme,
        confFilter,
        searchQuery,
        conferenceMap
      })}
      ${renderExtraSection('Dropped Out', poll.droppedOut, 'droppedOut', {
        theme,
        confFilter,
        searchQuery,
        conferenceMap
      })}
    </section>
  `;
}

export function renderRankingsView(container, callbacks) {
  const state = getState();
  const {
    theme,
    currentSeasonYear,
    conferences,
    conferenceMap,
    searchQuery,
    rankingsSeason,
    rankingsWeekKey,
    rankingsLatestWeekKey,
    rankingsWeeks,
    rankingsData,
    rankingsLoading,
    rankingsError,
    rankingsViewMode,
    rankingsConferenceFilter
  } = state;

  const activeSeasonYear = Number(
    rankingsSeason || rankingsData?.seasonYear || currentSeasonYear || new Date().getFullYear()
  );
  const baseYear = Number(currentSeasonYear || new Date().getFullYear());
  const seasonOptions = Array.from(
    new Set([baseYear, baseYear - 1, baseYear - 2, baseYear - 3, activeSeasonYear])
  ).sort((a, b) => b - a);

  const weeks = rankingsWeeks || [];
  const activeWeekKey = rankingsWeekKey || rankingsData?.activeWeekKey || '';
  const activeWeekObj = weeks.find((w) => w.key === activeWeekKey) || null;
  const activeWeekIdx = weeks.findIndex((w) => w.key === activeWeekKey);
  const activeWeekLabel = activeWeekObj?.label || rankingsData?.activeWeekLabel || 'Latest Week';
  const showJumpLatest = Boolean(
    rankingsLatestWeekKey && activeWeekKey && rankingsLatestWeekKey !== activeWeekKey
  );

  const stripKey = `${activeSeasonYear}:${activeWeekKey}`;
  const prevWeekStrip = container.querySelector('#rankings-week-strip');
  const prevStripKey = prevWeekStrip?.dataset.stripKey || '';
  const prevStripScrollLeft = prevWeekStrip ? prevWeekStrip.scrollLeft : null;

  container.innerHTML = `
    <section class="md-card md-card-filled rankings-controls-card">
      <div class="controls-top-row">
        <div>
          <h2 class="section-heading">College Football Top 25 Rankings</h2>
          <div class="muted" style="font-size:12px;">
            ${escapeHtml(String(activeSeasonYear))} Season · ${escapeHtml(activeWeekLabel)} · CFP Committee &amp; AP Poll · Click any team to view its team page
          </div>
        </div>

        <div class="rankings-controls-right">
          <div class="md-segmented" role="group" aria-label="Poll View Mode">
            <button class="md-seg-btn${rankingsViewMode === 'both' ? ' selected' : ''}" type="button" data-rankings-mode="both">
              <span class="material-symbols-rounded seg-check">check</span>
              Both Polls
            </button>
            <button class="md-seg-btn${rankingsViewMode === 'cfp' ? ' selected' : ''}" type="button" data-rankings-mode="cfp">
              <span class="material-symbols-rounded seg-check">check</span>
              CFP Committee
            </button>
            <button class="md-seg-btn${rankingsViewMode === 'ap' ? ' selected' : ''}" type="button" data-rankings-mode="ap">
              <span class="material-symbols-rounded seg-check">check</span>
              AP Top 25
            </button>
          </div>

          <select class="md-select" id="rankings-season-select" aria-label="Rankings season">
            ${seasonOptions
              .map(
                (yr) =>
                  `<option value="${yr}"${yr === activeSeasonYear ? ' selected' : ''}>${yr} Season</option>`
              )
              .join('')}
          </select>

          <select class="md-select" id="rankings-conf-select" aria-label="Filter rankings by conference">
            <option value="all"${rankingsConferenceFilter === 'all' ? ' selected' : ''}>All Conferences</option>
            <option value="power4"${rankingsConferenceFilter === 'power4' ? ' selected' : ''}>Power 4 Conferences</option>
            ${conferences
              .map(
                (c) =>
                  `<option value="${escapeHtml(c.id)}"${rankingsConferenceFilter === c.id ? ' selected' : ''}>${escapeHtml(c.shortName)}</option>`
              )
              .join('')}
          </select>

          ${
            showJumpLatest
              ? `
            <button class="md-btn md-btn-tonal" type="button" id="rankings-jump-latest-btn" style="height:34px;padding:0 14px;">
              <span class="material-symbols-rounded" style="font-size:17px;">today</span>
              Latest Week
            </button>
          `
              : ''
          }
        </div>
      </div>

      ${
        weeks.length > 0
          ? `
        <div class="week-strip-row">
          <button
            class="md-icon-btn"
            type="button"
            id="rankings-prev-week-btn"
            ${activeWeekIdx <= 0 ? 'disabled style="opacity:0.4;cursor:default;"' : ''}
            aria-label="Previous rankings week"
          >
            <span class="material-symbols-rounded">chevron_left</span>
          </button>
          <div class="week-scroll-strip" id="rankings-week-strip" data-strip-key="${escapeHtml(stripKey)}">
            ${weeks
              .map(
                (w) => `
              <button
                class="week-pill${w.key === activeWeekKey ? ' active' : ''}"
                type="button"
                data-rankings-week-key="${escapeHtml(w.key)}"
                data-rankings-season-type="${escapeHtml(w.seasonType)}"
                data-rankings-week-num="${escapeHtml(w.week)}"
              >
                <span class="week-pill-label">${escapeHtml(w.label)}</span>
                <span class="week-pill-detail">${escapeHtml(getWeekDetailText(w, activeSeasonYear))}</span>
              </button>
            `
              )
              .join('')}
          </div>
          <button
            class="md-icon-btn"
            type="button"
            id="rankings-next-week-btn"
            ${activeWeekIdx === -1 || activeWeekIdx >= weeks.length - 1 ? 'disabled style="opacity:0.4;cursor:default;"' : ''}
            aria-label="Next rankings week"
          >
            <span class="material-symbols-rounded">chevron_right</span>
          </button>
        </div>
      `
          : ''
      }
    </section>

    ${
      rankingsLoading && !rankingsData
        ? `
      <div class="rankings-polls-grid mode-both">
        <div class="skeleton" style="height:540px;border-radius:16px;"></div>
        <div class="skeleton" style="height:540px;border-radius:16px;"></div>
      </div>
    `
        : rankingsError && !rankingsData
          ? `
      <div class="md-card empty-state-card">
        <span class="material-symbols-rounded">cloud_off</span>
        <p class="empty-state-title">Unable to load rankings</p>
        <p class="empty-state-desc">${escapeHtml(rankingsError)}</p>
        <button class="md-btn md-btn-filled" type="button" id="retry-rankings-btn">Retry</button>
      </div>
    `
          : `
      <div class="rankings-polls-grid mode-${escapeHtml(rankingsViewMode)}${rankingsLoading ? ' is-loading' : ''}">
        ${
          rankingsViewMode === 'both' || rankingsViewMode === 'cfp'
            ? renderPollCard(rankingsData?.cfpPoll || null, 'cfp', {
                theme,
                confFilter: rankingsConferenceFilter,
                searchQuery,
                conferenceMap,
                activeWeekLabel,
                activeWeekKey,
                latestWeekKey: rankingsLatestWeekKey,
                weeks,
                viewMode: rankingsViewMode
              })
            : ''
        }
        ${
          rankingsViewMode === 'both' || rankingsViewMode === 'ap'
            ? renderPollCard(rankingsData?.apPoll || null, 'ap', {
                theme,
                confFilter: rankingsConferenceFilter,
                searchQuery,
                conferenceMap,
                activeWeekLabel,
                activeWeekKey,
                latestWeekKey: rankingsLatestWeekKey,
                weeks,
                viewMode: rankingsViewMode
              })
            : ''
        }
      </div>
    `
    }
  `;

  // Preserve horizontal scroll position or center active week pill without triggering page vertical scroll
  const weekStripEl = container.querySelector('#rankings-week-strip');
  const activePillEl = weekStripEl?.querySelector('.week-pill.active');
  if (weekStripEl) {
    if (prevStripKey === stripKey && prevStripScrollLeft !== null) {
      weekStripEl.scrollLeft = prevStripScrollLeft;
    } else if (activePillEl) {
      const targetLeft =
        activePillEl.offsetLeft - weekStripEl.clientWidth / 2 + activePillEl.clientWidth / 2;
      weekStripEl.scrollLeft = Math.max(0, targetLeft);
    }
  }

  // Mode toggle
  container.querySelectorAll('[data-rankings-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      setState({ rankingsViewMode: btn.dataset.rankingsMode });
    });
  });

  // Week pills
  container.querySelectorAll('[data-rankings-week-key]').forEach((btn) => {
    btn.addEventListener('click', () => {
      callbacks.onSelectWeek(btn.dataset.rankingsSeasonType, btn.dataset.rankingsWeekNum);
    });
  });

  const prevBtn = container.querySelector('#rankings-prev-week-btn');
  if (prevBtn && activeWeekIdx > 0) {
    prevBtn.addEventListener('click', () => {
      const target = weeks[activeWeekIdx - 1];
      if (target) callbacks.onSelectWeek(target.seasonType, target.week);
    });
  }

  const nextBtn = container.querySelector('#rankings-next-week-btn');
  if (nextBtn && activeWeekIdx >= 0 && activeWeekIdx < weeks.length - 1) {
    nextBtn.addEventListener('click', () => {
      const target = weeks[activeWeekIdx + 1];
      if (target) callbacks.onSelectWeek(target.seasonType, target.week);
    });
  }

  const seasonSelect = container.querySelector('#rankings-season-select');
  if (seasonSelect) {
    seasonSelect.addEventListener('change', () => {
      const yr = Number(seasonSelect.value);
      if (yr) callbacks.onChangeSeason(yr);
    });
  }

  const confSelect = container.querySelector('#rankings-conf-select');
  if (confSelect) {
    confSelect.addEventListener('change', () => {
      setState({ rankingsConferenceFilter: confSelect.value || 'all' });
    });
  }

  const jumpLatestBtn = container.querySelector('#rankings-jump-latest-btn');
  if (jumpLatestBtn) {
    jumpLatestBtn.addEventListener('click', () => callbacks.onJumpLatest());
  }

  container.querySelectorAll('[data-jump-latest-rankings]').forEach((btn) => {
    btn.addEventListener('click', () => callbacks.onJumpLatest());
  });

  container.querySelectorAll('[data-jump-cfp-week]').forEach((btn) => {
    btn.addEventListener('click', () => callbacks.onSelectWeek('2', '10'));
  });

  container.querySelectorAll('[data-switch-mode-ap]').forEach((btn) => {
    btn.addEventListener('click', () => setState({ rankingsViewMode: 'ap' }));
  });

  container.querySelectorAll('[data-reset-rankings-filters]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const searchEl = document.getElementById('global-search');
      const clearBtn = document.getElementById('search-clear-btn');
      if (searchEl) searchEl.value = '';
      if (clearBtn) clearBtn.style.display = 'none';
      setState({ rankingsConferenceFilter: 'all', searchQuery: '' });
    });
  });

  const retryBtn = container.querySelector('#retry-rankings-btn');
  if (retryBtn) {
    retryBtn.addEventListener('click', () => callbacks.onRetryRankings());
  }
}
