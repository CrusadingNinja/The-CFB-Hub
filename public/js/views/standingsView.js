import { getState, setState } from '../store.js';
import { escapeHtml, renderTeamLogo, renderRankBadge } from '../ui.js';

function sortEntries(entries, { key, dir }) {
  const mult = dir === 'asc' ? 1 : -1;
  return [...entries].sort((a, b) => {
    let cmp = 0;
    switch (key) {
      case 'confWinPct':
        cmp = a.confWinPct - b.confWinPct;
        break;
      case 'overallWins':
        cmp = a.overallWinPct - b.overallWinPct || a.overallWins - b.overallWins;
        break;
      case 'pointsFor':
        cmp = a.pointsFor - b.pointsFor;
        break;
      case 'pointsAgainst':
        cmp = a.pointsAgainst - b.pointsAgainst;
        break;
      case 'pointDiff':
        cmp = a.pointDiff - b.pointDiff;
        break;
      case 'seed':
      default:
        cmp = a.seed - b.seed || b.confWinPct - a.confWinPct || b.overallWins - a.overallWins;
        break;
    }
    if (cmp !== 0) return cmp * mult;
    return a.name.localeCompare(b.name);
  });
}

function renderSortHeader(label, sortKey, currentSort) {
  const active = currentSort.key === sortKey;
  const icon = active ? (currentSort.dir === 'asc' ? 'arrow_upward' : 'arrow_downward') : '';
  return `
    <button class="standings-sort-btn${active ? ' active' : ''}" type="button" data-sort-key="${escapeHtml(sortKey)}">
      <span>${escapeHtml(label)}</span>
      ${icon ? `<span class="material-symbols-rounded" style="font-size:14px;">${icon}</span>` : ''}
    </button>
  `;
}

function renderGroupTable(entries, currentSort, theme) {
  const sorted = sortEntries(entries, currentSort);
  return `
    <div class="standings-table-wrap">
      <table class="standings-table">
        <thead>
          <tr>
            <th>${renderSortHeader('#', 'seed', currentSort)}</th>
            <th>Team</th>
            <th>Conf</th>
            <th>${renderSortHeader('Pct', 'confWinPct', currentSort)}</th>
            <th>${renderSortHeader('Overall', 'overallWins', currentSort)}</th>
            <th>Home</th>
            <th>Away</th>
            <th>${renderSortHeader('PF', 'pointsFor', currentSort)}</th>
            <th>${renderSortHeader('PA', 'pointsAgainst', currentSort)}</th>
            <th>${renderSortHeader('Diff', 'pointDiff', currentSort)}</th>
            <th>Streak</th>
          </tr>
        </thead>
        <tbody>
          ${sorted
            .map((row) => {
              const diffClass = row.pointDiff > 0 ? 'diff-pos' : row.pointDiff < 0 ? 'diff-neg' : '';
              const streakClass = row.streak.startsWith('W')
                ? 'win'
                : row.streak.startsWith('L')
                  ? 'loss'
                  : '';
              return `
                <tr class="standings-row" data-team-id="${escapeHtml(row.teamId)}" title="Open ${escapeHtml(row.name)} team page">
                  <td class="muted"><strong>${escapeHtml(row.seedDisplay)}</strong></td>
                  <td>
                    <div class="standings-team-cell">
                      ${renderTeamLogo({ logo: row.logo, logoDark: row.logoDark, abbreviation: row.abbreviation, displayName: row.name }, { size: 'sm', theme })}
                      ${renderRankBadge(row.rank)}
                      <span class="team-page-link" style="font-weight:600;">${escapeHtml(row.name)}</span>
                    </div>
                  </td>
                  <td><strong>${escapeHtml(row.confRecord)}</strong></td>
                  <td class="muted">${escapeHtml(row.confWinPctDisplay)}</td>
                  <td><strong>${escapeHtml(row.overallRecord)}</strong></td>
                  <td class="muted">${escapeHtml(row.homeRecord)}</td>
                  <td class="muted">${escapeHtml(row.awayRecord)}</td>
                  <td>${escapeHtml(row.pointsFor)}</td>
                  <td>${escapeHtml(row.pointsAgainst)}</td>
                  <td class="${diffClass}">${escapeHtml(row.pointDiffDisplay)}</td>
                  <td><span class="streak-pill ${streakClass}">${escapeHtml(row.streak)}</span></td>
                </tr>
              `;
            })
            .join('')}
        </tbody>
      </table>
    </div>
  `;
}

export function renderStandingsView(container, callbacks) {
  const state = getState();
  const {
    theme,
    conferences,
    pollName,
    standingsLoading,
    standingsError,
    selectedConferenceId,
    standingsSort,
    searchQuery
  } = state;

  const q = searchQuery.trim().toLowerCase();

  let visibleConferences =
    selectedConferenceId === 'all'
      ? conferences
      : conferences.filter((c) => c.id === selectedConferenceId);

  if (q) {
    visibleConferences = visibleConferences
      .map((conf) => {
        const confMatch =
          conf.name.toLowerCase().includes(q) || conf.shortName.toLowerCase().includes(q);
        if (confMatch) return conf;
        const filteredGroups = conf.groups
          .map((g) => ({
            ...g,
            entries: g.entries.filter(
              (e) =>
                e.name.toLowerCase().includes(q) ||
                e.shortName.toLowerCase().includes(q) ||
                e.abbreviation.toLowerCase().includes(q)
            )
          }))
          .filter((g) => g.entries.length > 0);
        if (filteredGroups.length === 0) return null;
        return { ...conf, groups: filteredGroups };
      })
      .filter(Boolean);
  }

  container.innerHTML = `
    <section class="md-card md-card-filled standings-header-card">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">
        <div>
          <h2 class="section-heading">FBS Conference Standings</h2>
          <div class="muted" style="font-size:12px;">Sorted by official conference tiebreak seed · Click column headers to sort · Click any team to view its team page</div>
        </div>
        ${pollName ? `<span class="status-pill pre">Ranks: ${escapeHtml(pollName)}</span>` : ''}
      </div>

      <div class="md-chip-row">
        <button class="md-chip${selectedConferenceId === 'all' ? ' selected' : ''}" type="button" data-conf-chip="all">
          All Conferences (${conferences.length})
        </button>
        ${conferences
          .map(
            (c) => `
          <button class="md-chip${selectedConferenceId === c.id ? ' selected' : ''}" type="button" data-conf-chip="${escapeHtml(c.id)}">
            ${escapeHtml(c.shortName)}
          </button>
        `
          )
          .join('')}
      </div>
    </section>

    ${
      standingsLoading && conferences.length === 0
        ? `
      <div class="standings-grid">
        <div class="skeleton" style="height:300px;border-radius:16px;"></div>
        <div class="skeleton" style="height:300px;border-radius:16px;"></div>
      </div>
    `
        : standingsError
          ? `
      <div class="md-card empty-state-card">
        <span class="material-symbols-rounded">cloud_off</span>
        <p class="empty-state-title">Unable to load standings</p>
        <p class="empty-state-desc">${escapeHtml(standingsError)}</p>
        <button class="md-btn md-btn-filled" type="button" id="retry-standings-btn">Retry</button>
      </div>
    `
          : visibleConferences.length === 0
            ? `
      <div class="md-card empty-state-card">
        <span class="material-symbols-rounded">search_off</span>
        <p class="empty-state-title">No teams or conferences match "${escapeHtml(searchQuery)}"</p>
        <button class="md-btn md-btn-tonal" type="button" id="clear-standings-search-btn">Clear Search</button>
      </div>
    `
            : `
      <div class="standings-grid">
        ${visibleConferences
          .map(
            (conf) => `
          <article class="md-card md-card-elevated conf-card">
            <div class="conf-card-header">
              <h3 class="conf-title">${escapeHtml(conf.name)}</h3>
              <span class="muted" style="font-size:12px;font-weight:600;">${escapeHtml(conf.shortName)}</span>
            </div>
            ${conf.groups
              .map(
                (grp) => `
              ${grp.name ? `<div class="division-banner">${escapeHtml(grp.name)}</div>` : ''}
              ${renderGroupTable(grp.entries, standingsSort, theme)}
            `
              )
              .join('')}
          </article>
        `
          )
          .join('')}
      </div>
    `
    }
  `;

  container.querySelectorAll('[data-conf-chip]').forEach((btn) => {
    btn.addEventListener('click', () => {
      setState({ selectedConferenceId: btn.dataset.confChip });
    });
  });

  container.querySelectorAll('[data-sort-key]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.sortKey;
      setState((prev) => {
        const sameKey = prev.standingsSort.key === key;
        const defaultDir = key === 'seed' || key === 'pointsAgainst' ? 'asc' : 'desc';
        const nextDir = sameKey ? (prev.standingsSort.dir === 'asc' ? 'desc' : 'asc') : defaultDir;
        return {
          standingsSort: { key, dir: nextDir }
        };
      });
    });
  });

  const retryBtn = container.querySelector('#retry-standings-btn');
  if (retryBtn) {
    retryBtn.addEventListener('click', () => callbacks.onRetryStandings());
  }

  const clearBtn = container.querySelector('#clear-standings-search-btn');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      setState({ searchQuery: '' });
      const searchInput = document.getElementById('global-search');
      if (searchInput) searchInput.value = '';
    });
  }
}
