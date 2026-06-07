// ==================== SHARED UTILITIES ====================
// Extracted from scripts/replay.js when it was replaced by the team analysis module.
// Used by scripts/team.js and any future modules.

function escapeHtml(s) {
  if (s === undefined || s === null) return '';
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function formatDuration(seconds) {
  if (seconds === undefined || seconds === null) return '-';
  if (typeof seconds !== 'number') return '-';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// setStatus(elId, text, kind) — kind ∈ {undefined | 'loading' | 'error' | 'success'}
function setStatus(elId, text, kind) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = text || '';
  el.className = (kind === 'loading' || kind === 'error' || kind === 'success')
    ? 'replay-status ' + kind
    : 'replay-status';
}

window.escapeHtml = escapeHtml;
window.formatDuration = formatDuration;
window.setStatus = setStatus;
