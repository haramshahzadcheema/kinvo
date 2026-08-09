import type { NotificationDto } from '@kinvo/contracts';
import { useEffect, useRef, useState } from 'react';
import { formatRelativeTime } from '../lib/format';
import {
  useNotificationMutations,
  useNotifications,
  useUnreadCount,
} from '../features/notifications/useNotifications';
import { BellIcon } from './icons';

const PREVIEW_SIZE = 6;

// Mirrors NotificationsPage's own handleOpen exactly (mark-read is
// best-effort, navigation proceeds regardless) — this is a second surface
// for the same data, not a second implementation of the read/navigate
// behavior.
export function NotificationDropdown({
  onNavigate,
}: {
  onNavigate: (tab: 'yellow-zone' | 'notifications') => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const { data: unreadCount } = useUnreadCount();
  const { data, isLoading } = useNotifications({ pageSize: PREVIEW_SIZE });
  const mutations = useNotificationMutations();

  const count = unreadCount?.count ?? 0;
  const items = data?.items ?? [];

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  async function handleOpen(notification: NotificationDto) {
    if (!notification.readAt) {
      try {
        await mutations.markRead.mutateAsync(notification.id);
      } catch {
        // Best-effort, matches NotificationsPage — navigation still
        // proceeds even if the mark-read call fails.
      }
    }
    setOpen(false);
    onNavigate('yellow-zone');
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Notifications"
        aria-expanded={open}
        className="relative flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-[var(--surface-neutral-chip)] text-[var(--text-secondary)] hover:bg-[var(--surface-card-alt)]"
      >
        <BellIcon />
        {count > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-[var(--danger)] px-1 font-mono text-[9px] font-bold text-white">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-20 w-80 animate-[tideIn_0.15s_ease] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] shadow-xl">
          <div className="border-b border-[var(--border)] px-4 py-3 text-[length:var(--text-7)] font-semibold text-[var(--text-strong)]">
            Notifications
          </div>
          <div className="max-h-80 overflow-y-auto">
            {isLoading && (
              <div className="px-4 py-6 text-center text-[length:var(--text-5)] text-[var(--text-muted)]">
                Loading…
              </div>
            )}
            {!isLoading && items.length === 0 && (
              <div className="px-4 py-8 text-center text-[length:var(--text-6)] text-[var(--text-muted)]">
                You're all caught up.
              </div>
            )}
            {items.map((notification) => {
              const isUnread = !notification.readAt;
              return (
                <button
                  key={notification.id}
                  onClick={() => void handleOpen(notification)}
                  className="flex w-full items-start gap-2.5 border-b border-[var(--surface-muted)] px-4 py-3 text-left transition last:border-b-0 hover:bg-[var(--surface-page-1)]"
                >
                  <span
                    className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full"
                    style={{ background: isUnread ? 'var(--accent)' : 'transparent' }}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-[length:var(--text-6)] text-[var(--text-strong)]">
                      {notification.message}
                    </div>
                    <div className="mt-0.5 text-[length:var(--text-3)] text-[var(--text-muted)]">
                      {formatRelativeTime(notification.createdAt)}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
          <button
            onClick={() => {
              setOpen(false);
              onNavigate('notifications');
            }}
            className="w-full border-t border-[var(--border)] py-2.5 text-center text-[length:var(--text-5)] font-semibold text-[var(--accent)] hover:bg-[var(--surface-page-1)]"
          >
            View all
          </button>
        </div>
      )}
    </div>
  );
}
