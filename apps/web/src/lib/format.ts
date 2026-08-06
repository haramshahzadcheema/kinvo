export function formatDateTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

// Used to flag ships arriving soon on the list/dashboard — the "what needs
// attention right now" signal a dispatcher scans for first.
export function isWithinHours(iso: string | null | undefined, hours: number): boolean {
  if (!iso) return false;
  const diffMs = new Date(iso).getTime() - Date.now();
  return diffMs >= 0 && diffMs <= hours * 60 * 60 * 1000;
}

export function formatRate(rate: number | null, currency: string | null): string {
  if (rate == null) return 'Rate not set';
  return `${currency ?? ''} ${rate.toLocaleString()}`.trim();
}

export function isToday(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

// Coarse "2h ago" / "3d ago" label for the dashboard's recently-updated
// list — not a full audit trail (see the Decisions log: that needs the
// AuditLog table, deferred), just a timestamp read honestly.
export function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}
