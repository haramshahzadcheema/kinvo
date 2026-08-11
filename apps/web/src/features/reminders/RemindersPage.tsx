import type { ReminderCampaignDto } from '@kinvo/contracts';
import { useState } from 'react';
import { formatDateTime } from '../../lib/format';
import { isApiError } from '../../lib/useAuth';
import { useShips } from '../ships/useShips';
import { useReminderCampaignMutations, useReminderCampaigns } from './useReminders';

const STATUS_STYLE: Record<
  ReminderCampaignDto['status'],
  { bg: string; color: string; label: string }
> = {
  PENDING_APPROVAL: { bg: 'var(--warning-bg)', color: 'var(--warning)', label: 'Awaiting approval' },
  SENT: { bg: 'var(--success)', color: 'white', label: 'Approved' },
  CANCELLED: { bg: 'var(--surface-neutral-chip)', color: 'var(--text-muted)', label: 'Cancelled' },
};

// Campaigns group, Phase D — a pre-gate reminder call request for a ship's
// already-confirmed drivers, gated by an explicit approval step. See the
// ReminderCampaign comment in schema.prisma for why approving this never
// claims a call was actually placed — it's an honest, real approval
// record, not a telephony feature.
export function RemindersPage() {
  const [showCreate, setShowCreate] = useState(false);
  const { data, isLoading, isError } = useReminderCampaigns({ pageSize: 50 });
  const mutations = useReminderCampaignMutations();

  const items = data?.items ?? [];

  return (
    <div className="animate-[tideIn_0.2s_ease]">
      <div className="mb-3.5 flex items-center justify-end">
        <button
          onClick={() => setShowCreate((v) => !v)}
          className="whitespace-nowrap rounded-full bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--accent-hover)]"
        >
          + New Reminder
        </button>
      </div>

      {showCreate && (
        <CreateReminderForm
          onCreated={() => setShowCreate(false)}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {isLoading && <ListSkeleton />}
      {isError && <p className="text-sm text-[var(--danger)]">Could not load reminder campaigns.</p>}

      {!isLoading && !isError && items.length === 0 && (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] py-10 text-center">
          <div className="mb-1 text-[length:var(--text-10)] font-semibold text-[var(--text-strong)]">
            No reminder campaigns yet
          </div>
          <p className="text-xs text-[var(--text-muted)]">
            Create one to ask confirmed drivers on a ship to report early.
          </p>
        </div>
      )}

      {!isLoading && items.length > 0 && (
        <div className="flex flex-col gap-3">
          {items.map((campaign) => (
            <CampaignCard
              key={campaign.id}
              campaign={campaign}
              onApprove={() => mutations.approve.mutate(campaign.id)}
              onCancel={() => mutations.cancel.mutate(campaign.id)}
              isMutating={mutations.approve.isPending || mutations.cancel.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CampaignCard({
  campaign,
  onApprove,
  onCancel,
  isMutating,
}: {
  campaign: ReminderCampaignDto;
  onApprove: () => void;
  onCancel: () => void;
  isMutating: boolean;
}) {
  const style = STATUS_STYLE[campaign.status];
  return (
    <div className="flex flex-col gap-2.5 rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[length:var(--text-10)] font-bold text-[var(--text-strong)]">
            {campaign.shipName}
          </span>
          <span
            className="rounded-full px-2.5 py-0.5 text-[length:var(--text-2)] font-semibold"
            style={{ background: style.bg, color: style.color }}
          >
            {style.label}
          </span>
        </div>
        <div className="mt-1 font-mono text-[length:var(--text-5)] text-[var(--text-muted)]">
          {campaign.shipGate ? `${campaign.shipGate} · ` : ''}
          {campaign.shipReportingTime ? `Reporting ${formatDateTime(campaign.shipReportingTime)}` : 'No reporting time set'}
        </div>
        {campaign.notes && (
          <p className="mt-1.5 text-[length:var(--text-6)] text-[var(--text-secondary)]">{campaign.notes}</p>
        )}
        <p className="mt-1.5 text-[length:var(--text-5)] text-[var(--text-secondary)]">
          {campaign.status === 'PENDING_APPROVAL'
            ? `${campaign.currentConfirmedDriverCount} confirmed driver${campaign.currentConfirmedDriverCount === 1 ? '' : 's'} on this ship`
            : campaign.status === 'SENT'
              ? `Approved by ${campaign.approvedByUserName} for ${campaign.confirmedDriverCountAtApproval} confirmed driver${campaign.confirmedDriverCountAtApproval === 1 ? '' : 's'}`
              : 'This request was cancelled before approval.'}
        </p>
      </div>

      {campaign.status === 'PENDING_APPROVAL' && (
        <div className="flex flex-shrink-0 gap-2">
          <button
            onClick={onApprove}
            disabled={isMutating}
            className="rounded-full bg-[var(--accent)] px-4 py-2 text-[length:var(--text-5)] font-semibold text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
          >
            Approve
          </button>
          <button
            onClick={onCancel}
            disabled={isMutating}
            className="rounded-full border border-[var(--border)] px-4 py-2 text-[length:var(--text-5)] font-semibold text-[var(--text-secondary)] hover:bg-[var(--surface-card-alt)] disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

function CreateReminderForm({
  onCreated,
  onCancel,
}: {
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [shipId, setShipId] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { data: shipsData } = useShips({ pageSize: 50, sortBy: 'eta', sortOrder: 'asc' });
  const mutations = useReminderCampaignMutations();

  // Reminders only make sense for ships that still have an active
  // operation — a COMPLETED/CANCELLED ship has nothing left to remind
  // anyone about.
  const eligibleShips = (shipsData?.items ?? []).filter(
    (s) => s.status !== 'COMPLETED' && s.status !== 'CANCELLED',
  );

  async function submit() {
    setError(null);
    try {
      await mutations.create.mutateAsync({ shipId, notes: notes || undefined });
      onCreated();
    } catch (err) {
      setError(isApiError(err) ? err.message : 'Could not create this reminder campaign.');
    }
  }

  return (
    <div className="mb-3.5 rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <div className="mb-1.5 text-[length:var(--text-3)] text-[var(--text-muted)]">Ship</div>
          <select
            value={shipId}
            onChange={(e) => setShipId(e.target.value)}
            className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-[length:var(--text-7)] outline-none"
          >
            <option value="">Select a ship…</option>
            {eligibleShips.map((ship) => (
              <option key={ship.id} value={ship.id}>
                {ship.shipName}
              </option>
            ))}
          </select>
        </div>
        <div>
          <div className="mb-1.5 text-[length:var(--text-3)] text-[var(--text-muted)]">Notes (optional)</div>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. Report 30 minutes early"
            className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-[length:var(--text-7)] outline-none"
          />
        </div>
      </div>
      {error && <p className="mt-3 text-xs text-[var(--danger)]">{error}</p>}
      <div className="mt-4 flex gap-2">
        <button
          onClick={() => void submit()}
          disabled={!shipId || mutations.create.isPending}
          className="rounded-full bg-[var(--accent)] px-4 py-2 text-[length:var(--text-7)] font-semibold text-white disabled:opacity-50"
        >
          {mutations.create.isPending ? 'Creating…' : 'Create Reminder'}
        </button>
        <button
          onClick={onCancel}
          className="rounded-full border border-[var(--border)] px-4 py-2 text-[length:var(--text-7)] font-semibold text-[var(--text-secondary)] hover:bg-[var(--surface-card-alt)]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      {[0, 1].map((i) => (
        <div key={i} className="animate-pulse rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-5">
          <div className="h-3.5 w-1/3 rounded bg-[var(--surface-muted-3)]" />
          <div className="mt-2.5 h-2.5 w-1/2 rounded bg-[var(--surface-muted-2)]" />
        </div>
      ))}
    </div>
  );
}
