import type { TimelineEntryDto } from '@kinvo/contracts';
import type { ComponentType, SVGProps } from 'react';
import { useState } from 'react';
import {
  AlertIcon,
  AssignmentIcon,
  DocumentIcon,
  PhoneIcon,
  RecruitIcon,
  ReminderIcon,
  ShipIcon,
} from '../../components/icons';
import { formatDateTime } from '../../lib/format';
import { useTimeline } from './useTimeline';

const PAGE_SIZE = 25;

// Purely a visual category per event type — matches the Kinvo.dc.html
// mockup's icon set (ship/recruit/check/doc/alert/call). Decorative only:
// it doesn't imply anything about the event beyond what its real
// title/detail text (server-resolved, see timeline.service.ts) already
// says — e.g. reminder_campaign.* gets the phone icon as its closest
// visual category even though approving a reminder never places a real
// call (see ReminderCampaign's own honesty comment in schema.prisma).
function eventVisual(type: string): { Icon: ComponentType<SVGProps<SVGSVGElement>>; color: string } {
  if (type.startsWith('ship.')) return { Icon: ShipIcon, color: 'var(--accent)' };
  if (type.startsWith('document.')) return { Icon: DocumentIcon, color: 'var(--accent)' };
  if (type.startsWith('driver.')) return { Icon: RecruitIcon, color: 'var(--accent)' };
  if (type === 'assignment.created') return { Icon: RecruitIcon, color: 'var(--accent)' };
  if (type === 'assignment.confirmed' || type === 'assignment.completed') {
    return { Icon: AssignmentIcon, color: 'var(--success)' };
  }
  if (type === 'assignment.attempt_logged') return { Icon: PhoneIcon, color: 'var(--accent)' };
  if (type.startsWith('assignment.')) return { Icon: AlertIcon, color: 'var(--warning)' };
  if (type.startsWith('yellow_zone.')) return { Icon: AlertIcon, color: 'var(--warning)' };
  if (type.startsWith('reminder_campaign.')) return { Icon: ReminderIcon, color: 'var(--accent)' };
  return { Icon: AssignmentIcon, color: 'var(--text-muted)' };
}

// Phase E (Kinvo UI redesign, Intelligence group): a read-only feed over
// the org's real operational history — every entry is a genuine
// AuditLogEntry row (see timeline.service.ts), nothing synthesized for
// display. Deliberately global across all ships, matching the
// Kinvo.dc.html mockup's single "Operations Timeline" rather than a
// per-ship drill-down.
export function TimelinePage() {
  const [page, setPage] = useState(1);
  const { data, isLoading, isError } = useTimeline({ page, pageSize: PAGE_SIZE });

  const items = data?.items ?? [];
  const hasMore = data ? page < data.totalPages : false;

  return (
    <div className="animate-[tideIn_0.2s_ease] max-w-[640px]">
      {isLoading && page === 1 && <ListSkeleton />}
      {isError && <p className="text-sm text-[var(--danger)]">Could not load the timeline.</p>}

      {!isLoading && !isError && items.length === 0 && (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] py-10 text-center">
          <div className="mb-1 text-[length:var(--text-10)] font-semibold text-[var(--text-strong)]">
            No activity yet
          </div>
          <p className="text-xs text-[var(--text-muted)]">
            Ship, driver, and dispatch activity will show up here as it happens.
          </p>
        </div>
      )}

      {items.length > 0 && (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] px-7 py-6">
          {items.map((entry, index) => (
            <TimelineRow key={entry.id} entry={entry} isLast={index === items.length - 1} />
          ))}
        </div>
      )}

      {hasMore && (
        <div className="mt-3.5 flex justify-center">
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={isLoading}
            className="rounded-full border border-[var(--border)] px-4 py-2 text-xs font-semibold text-[var(--text-secondary)] hover:bg-[var(--surface-card-alt)] disabled:opacity-50"
          >
            {isLoading ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}

function TimelineRow({ entry, isLast }: { entry: TimelineEntryDto; isLast: boolean }) {
  const { Icon, color } = eventVisual(entry.type);
  return (
    <div className="flex gap-4">
      <div className="flex flex-shrink-0 flex-col items-center">
        <div
          className="flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-full"
          style={{ background: 'var(--accent-tint)' }}
        >
          <Icon width={14} height={14} style={{ color }} />
        </div>
        {!isLast && <span className="min-h-[22px] w-px flex-1 bg-[var(--border)]" />}
      </div>
      <div className={isLast ? 'min-w-0 flex-1' : 'min-w-0 flex-1 pb-[22px]'}>
        <div className="font-mono text-[length:var(--text-2)] text-[var(--text-muted)]">
          {formatDateTime(entry.createdAt)} · {entry.actorName}
        </div>
        <div className="mt-0.5 text-[length:var(--text-8)] font-semibold text-[var(--text-strong)]">
          {entry.title}
        </div>
        {entry.detail && (
          <div className="mt-0.5 text-[length:var(--text-5)] text-[var(--text-muted)]">{entry.detail}</div>
        )}
      </div>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="animate-pulse rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] px-7 py-6">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex gap-4 pb-6 last:pb-0">
          <div className="h-[30px] w-[30px] flex-shrink-0 rounded-full bg-[var(--surface-muted-3)]" />
          <div className="min-w-0 flex-1">
            <div className="h-2.5 w-1/4 rounded bg-[var(--surface-muted-2)]" />
            <div className="mt-2 h-3 w-1/2 rounded bg-[var(--surface-muted-3)]" />
          </div>
        </div>
      ))}
    </div>
  );
}
