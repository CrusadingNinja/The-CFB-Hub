// Shared UI helpers (safe HTML escaping, logo rendering, date/countdown formatting, snackbar)

export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function getThemedLogo(team, _theme = 'light') {
  if (!team) return '';
  // Preserve original school logo colors regardless of light/dark theme
  return team.logo || team.logoDark || '';
}

export function renderTeamLogo(team, { size = '', theme = 'light' } = {}) {
  const src = getThemedLogo(team, theme);
  const abbr = escapeHtml((team?.abbreviation || 'CFB').slice(0, 4));
  const bg = escapeHtml(team?.color || '#006c47');
  const sizeClass = size ? ` ${size}` : '';

  if (!src) {
    return `<span class="team-logo-wrap${sizeClass}"><span class="team-logo-fallback" style="background:${bg}">${abbr}</span></span>`;
  }

  return `
    <span class="team-logo-wrap${sizeClass}">
      <img
        class="team-logo-img"
        src="${escapeHtml(src)}"
        alt="${escapeHtml(team?.displayName || abbr)}"
        loading="lazy"
        onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"
      >
      <span class="team-logo-fallback" style="display:none;background:${bg}">${abbr}</span>
    </span>
  `;
}

export function renderRankBadge(rank) {
  if (!rank || rank < 1 || rank > 25) return '';
  return `<span class="rank-badge">#${rank}</span>`;
}

export function formatKickoffTime(isoDate) {
  if (!isoDate) return 'TBD';
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return 'TBD';
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit'
  }).format(d);
}

export function formatDayHeading(isoDate) {
  if (!isoDate) return 'Scheduled';
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return 'Scheduled';
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric'
  }).format(d);
}

export function getLocalDateKey(isoDate) {
  if (!isoDate) return 'tbd';
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return 'tbd';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function formatCountdown(isoDate) {
  if (!isoDate) return '';
  const diffMs = new Date(isoDate).getTime() - Date.now();
  if (Number.isNaN(diffMs)) return '';
  if (diffMs <= 0) return 'Starting soon';
  const totalMins = Math.floor(diffMs / 60000);
  const days = Math.floor(totalMins / (60 * 24));
  const hours = Math.floor((totalMins % (60 * 24)) / 60);
  const mins = totalMins % 60;
  if (days > 0) return `In ${days}d ${hours}h`;
  if (hours > 0) return `In ${hours}h ${mins}m`;
  return `In ${mins}m`;
}

export function quarterLabel(period) {
  const p = Number(period);
  if (p === 1) return '1st Quarter';
  if (p === 2) return '2nd Quarter';
  if (p === 3) return '3rd Quarter';
  if (p === 4) return '4th Quarter';
  if (p > 4) return `OT ${p - 4}`;
  return `Period ${p}`;
}

let snackbarTimer = null;
export function showSnackbar(message) {
  const el = document.getElementById('snackbar');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(snackbarTimer);
  snackbarTimer = setTimeout(() => {
    el.classList.remove('show');
  }, 3200);
}
