import { useState } from 'react';
import { isApiError, useAuth } from '../../lib/useAuth';

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-[var(--border)] py-3.5 first:pt-0 last:border-b-0 last:pb-0">
      <div className="text-[length:var(--text-4)] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
        {label}
      </div>
      <div className="mt-1 text-[length:var(--text-8)] font-medium text-[var(--text-strong)]">{value}</div>
    </div>
  );
}

// Organization name is the one genuinely editable field here —
// PATCH /api/v1/organizations is real and backend-persisted (see
// organizations.service.ts's updateOrganization), gated to OWNER/ADMIN
// (organization:manage). The slug is deliberately never re-derived from
// a rename (see updateOrganizationRequestSchema's own comment), so it
// isn't shown as something this edit touches. Member and invitation
// management still isn't part of Settings — that's a materially larger
// feature with its own backend endpoints already but no frontend page
// yet.
export function OrganizationSection() {
  const { auth, updateOrganization } = useAuth();
  const canManage = auth?.membership.role === 'OWNER' || auth?.membership.role === 'ADMIN';
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(auth?.organization.name ?? '');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  function startEditing() {
    setName(auth?.organization.name ?? '');
    setError(null);
    setIsEditing(true);
  }

  async function save() {
    setError(null);
    setIsSaving(true);
    try {
      await updateOrganization({ name });
      setIsEditing(false);
    } catch (err) {
      setError(isApiError(err) ? err.message : 'Could not rename the organization.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] px-4 py-1 sm:px-5">
      {isEditing ? (
        <div className="border-b border-[var(--border)] py-3.5 first:pt-0">
          <div className="text-[length:var(--text-4)] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            Organization name
          </div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Organization name"
            className="mt-2 w-full rounded-lg border border-[var(--border)] px-3 py-2 text-[length:var(--text-7)] outline-none"
          />
          {error && <p className="mt-2 text-[length:var(--text-4)] text-[var(--danger)]">{error}</p>}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => void save()}
              disabled={isSaving || name.trim().length < 2}
              className="rounded-full bg-[var(--accent)] px-4 py-2 text-[length:var(--text-5)] font-semibold text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
            >
              {isSaving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => setIsEditing(false)}
              disabled={isSaving}
              className="rounded-full border border-[var(--border)] px-4 py-2 text-[length:var(--text-5)] font-semibold text-[var(--text-secondary)] hover:bg-[var(--surface-card-alt)]"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] py-3.5 first:pt-0">
          <div>
            <div className="text-[length:var(--text-4)] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              Organization name
            </div>
            <div className="mt-1 text-[length:var(--text-8)] font-medium text-[var(--text-strong)]">
              {auth?.organization.name ?? ''}
            </div>
          </div>
          {canManage && (
            <button
              type="button"
              onClick={startEditing}
              className="flex-shrink-0 text-[length:var(--text-5)] font-semibold text-[var(--accent)] hover:underline"
            >
              Edit
            </button>
          )}
        </div>
      )}
      <ReadOnlyField label="Your role" value={auth?.membership.role ?? ''} />

      {canManage && (
        <div className="py-4 first:pt-0">
          <p className="text-[length:var(--text-6)] text-[var(--text-muted)]">
            Member and invitation management for {auth?.organization.name} isn't part of Settings
            yet.
          </p>
        </div>
      )}
    </div>
  );
}
