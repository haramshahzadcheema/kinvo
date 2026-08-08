import type { NotificationDto } from '@kinvo/contracts';
import { useState } from 'react';
import { formatRelativeTime } from '../../lib/format';
import { useRealtimeConnection } from '../../lib/useRealtimeConnection';
import { useNotificationMutations, useNotifications, useUnreadCount } from './useNotifications';

const PAGE_SIZE = 20;

// Phase 6's notification inbox — realtime-driven exactly like Yellow
// Zone's own page (RealtimeProvider invalidates ['notifications'] on every
// notification.* socket event), no polling here either. Every current
// notification targets a Yellow Zone item, so opening one marks it read
// and navigates to the Yellow Zone page — not deep-linked to the specific
// item, matching the same "navigate to the tab, not a specific row"
// pattern Yellow Zone's own "View in Assignments" button already
// establishes (App.tsx's navigate() has no per-item deep-link parameter
// today, and adding one is a bigger change than this phase needs).
export function NotificationsPage({ onNavigate }: { onNavigate: (tab: 'yellow-zone') => void }) {
  const [page, setPage] = useState(1);
  const connectionStatus = useRealtimeConnection();
  const { data, isLoading, isError } = useNotifications({ page, pageSize: PAGE_SIZE });
  const { data: unreadCount } = useUnreadCount();
  const mutations = useNotificationMutations();

  const items = data?.items ?? [];
  const hasUnread = (unreadCount?.count ?? 0) > 0;

  async function handleOpen(notification: NotificationDto) {
    if (!notification.readAt) {
      try {
        await mutations.markRead.mutateAsync(notification.id);
      } catch {
        // Best-effort — navigation still proceeds even if the mark-read
        // call fails; the notification just stays visibly unread, which
        // is a safe, honest failure mode (never silently claims something
        // is read when the server didn't confirm it).
      }
    }
    onNavigate('yellow-zone');
  }

  return (
    <div className="animate-[tideIn_0.2s_ease]">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-[#0F2A38]">Notifications</h1>
          <p className="mt-0.5 text-xs text-[#8B9AA3]">Things that need your awareness or action.</p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          {connectionStatus === 'connecting' && (
            <span className="flex items-center gap-1.5 rounded-full bg-[#F1F1EE] px-2.5 py-1 text-[10.5px] font-semibold text-[#8B9AA3]">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
              Reconnecting…
            </span>
          )}
          {hasUnread && (
            <button
              onClick={() => mutations.markAllRead.mutate()}
              disabled={mutations.markAllRead.isPending}
              className="rounded-full border border-[#ECE1CC] px-2.5 py-1 text-[11px] font-semibold text-[#5C6B75] hover:bg-[#F3EDDD] disabled:opacity-50"
            >
              Mark all read
            </button>
          )}
        </div>
      </div>

      {isLoading && <NotificationListSkeleton />}
      {isError && <p className="text-sm text-[#C1503B]">Could not load notifications.</p>}

      {!isLoading && !isError && items.length === 0 && (
        <div className="rounded-2xl border border-[#ECE1CC] bg-white py-10 text-center">
          <div className="mb-1 text-[15px] font-semibold text-[#0F2A38]">You're all caught up.</div>
          <p className="text-xs text-[#8B9AA3]">Nothing needs your attention right now.</p>
        </div>
      )}

      {!isLoading && items.length > 0 && (
        <div className="flex flex-col gap-2">
          {items.map((notification) => (
            <NotificationRow
              key={notification.id}
              notification={notification}
              onOpen={() => void handleOpen(notification)}
            />
          ))}
        </div>
      )}

      {data && data.totalPages > 1 && (
        <div className="mt-3.5 flex items-center justify-between text-[11.5px] text-[#5C6B75]">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="rounded-lg border border-[#ECE1CC] px-3 py-1.5 font-semibold hover:bg-[#F3EDDD] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Previous
          </button>
          <span>
            Page {data.page} of {data.totalPages} · {data.total} total
          </span>
          <button
            onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
            disabled={page >= data.totalPages}
            className="rounded-lg border border-[#ECE1CC] px-3 py-1.5 font-semibold hover:bg-[#F3EDDD] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

function NotificationRow({
  notification,
  onOpen,
}: {
  notification: NotificationDto;
  onOpen: () => void;
}) {
  const isUnread = !notification.readAt;
  return (
    <div
      onClick={onOpen}
      className="flex cursor-pointer items-start gap-2.5 rounded-lg border px-3.5 py-3 transition hover:bg-[#FBF6EE]"
      style={{
        borderColor: isUnread ? '#1E7A8C' : '#ECE1CC',
        background: isUnread ? '#EAF3F1' : '#FFFFFF',
      }}
    >
      <span
        className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full"
        style={{ background: isUnread ? '#1E7A8C' : 'transparent' }}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[12.5px] font-semibold text-[#0F2A38]">{notification.title}</span>
          <span className="flex-shrink-0 text-[11px] text-[#8B9AA3]">
            {formatRelativeTime(notification.createdAt)}
          </span>
        </div>
        <p className="mt-1 text-[11.5px] text-[#5C6B75]">{notification.message}</p>
      </div>
    </div>
  );
}

function NotificationListSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {[0, 1, 2].map((i) => (
        <div key={i} className="animate-pulse rounded-lg border border-[#ECE1CC] p-3">
          <div className="h-3 w-1/3 rounded bg-[#F0EADC]" />
          <div className="mt-2 h-2.5 w-1/2 rounded bg-[#F5F0E6]" />
        </div>
      ))}
    </div>
  );
}
