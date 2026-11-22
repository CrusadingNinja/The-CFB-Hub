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

function isTimeWindowNote(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (/^(?:flex|early|afternoon|night|late|prime|midday|window)\s*:/i.test(t)) return true;
  if (/\b(?:am|pm|noon)\b.*\b(?:et|ct|mt|pt|est|edt|start|kickoff|window)\b/i.test(t)) return true;
  if (/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*[-–/]\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i.test(t)) return true;
  return false;
}

function cleanFlexTimeSlot(text) {
  return String(text || '')
    .trim()
    .replace(/\s+start\s*$/i, '')
    .trim();
}

export function parseGameNotes(notes, fallbackGameNote = '') {
  const candidates = [];
  if (Array.isArray(notes)) {
    notes.forEach((n) => {
      const text = String(n?.headline || '').trim();
      if (text) candidates.push(text);
    });
  }
  const extra = String(fallbackGameNote || '').trim();
  if (extra && !candidates.includes(extra)) {
    candidates.push(extra);
  }

  let flexTimeSlot = '';
  let headline = '';
  for (const text of candidates) {
    if (isTimeWindowNote(text)) {
      if (!flexTimeSlot) flexTimeSlot = cleanFlexTimeSlot(text);
    } else if (!headline) {
      headline = text;
    }
  }
  return { flexTimeSlot, headline };
}

export function isKickoffTimeTbd(ev) {
  if (!ev) return true;
  if (ev.timeValid === false) return true;
  if (/\b(?:tbd|tba)\b/i.test(String(ev.statusDetail || ''))) return true;
  if (!ev.date) return true;
  const d = new Date(ev.date);
  return Number.isNaN(d.getTime());
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

export function formatEventKickoff(ev) {
  if (isKickoffTimeTbd(ev)) {
    return ev?.flexTimeSlot || 'TBD';
  }
  return formatKickoffTime(ev.date);
}

export function formatDayHeading(isoDate, { timeValid = true } = {}) {
  if (!isoDate) return 'Scheduled';
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return 'Scheduled';
  const opts = {
    weekday: 'long',
    month: 'short',
    day: 'numeric'
  };
  if (timeValid === false) {
    opts.timeZone = 'America/New_York';
  }
  return new Intl.DateTimeFormat(undefined, opts).format(d);
}

export function getLocalDateKey(isoDate, { timeValid = true } = {}) {
  if (!isoDate) return 'tbd';
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return 'tbd';
  if (timeValid === false) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(d);
    const y = parts.find((p) => p.type === 'year')?.value;
    const m = parts.find((p) => p.type === 'month')?.value;
    const day = parts.find((p) => p.type === 'day')?.value;
    if (y && m && day) return `${y}-${m}-${day}`;
  }
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
