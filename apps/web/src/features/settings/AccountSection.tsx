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

// Name is the one genuinely editable field here — PATCH /api/v1/auth/me
// is real and backend-persisted (see auth.service.ts's updateMe). Email
// stays read-only, deliberately: an email change would need a real
// verification flow this app doesn't have, so it's left out of the
// request shape entirely rather than becoming a free, unverified edit —
// see updateMeRequestSchema's own comment. Role/Organization stay
// read-only too — a member doesn't set their own role, and the
// organization's name is edited from OrganizationSection, not here.
export function AccountSection() {
  const { auth, logout, updateMe } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  const [firstName, setFirstName] = useState(auth?.user.firstName ?? '');
  const [lastName, setLastName] = useState(auth?.user.lastName ?? '');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  function startEditing() {
    setFirstName(auth?.user.firstName ?? '');
    setLastName(auth?.user.lastName ?? '');
    setError(null);
    setIsEditing(true);
  }

  async function save() {
    setError(null);
    setIsSaving(true);
    try {
      await updateMe({ firstName, lastName });
      setIsEditing(false);
    } catch (err) {
      setError(isApiError(err) ? err.message : 'Could not update your name.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] px-4 py-1 sm:px-5">
      {isEditing ? (
        <div className="border-b border-[var(--border)] py-3.5 first:pt-0">
          <div className="text-[length:var(--text-4)] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            Name
          </div>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <input
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="First name"
              className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-[length:var(--text-7)] outline-none"
            />
            <input
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Last name"
              className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-[length:var(--text-7)] outline-none"
            />
          </div>
          {error && <p className="mt-2 text-[length:var(--text-4)] text-[var(--danger)]">{error}</p>}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => void save()}
              disabled={isSaving || !firstName.trim() || !lastName.trim()}
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
              Name
            </div>
            <div className="mt-1 text-[length:var(--text-8)] font-medium text-[var(--text-strong)]">
              {`${auth?.user.firstName ?? ''} ${auth?.user.lastName ?? ''}`.trim()}
            </div>
          </div>
          <button
            type="button"
            onClick={startEditing}
            className="flex-shrink-0 text-[length:var(--text-5)] font-semibold text-[var(--accent)] hover:underline"
          >
            Edit
          </button>
        </div>
      )}
      <ReadOnlyField label="Email" value={auth?.user.email ?? ''} />
      <ReadOnlyField label="Role" value={auth?.membership.role ?? ''} />
      <ReadOnlyField label="Organization" value={auth?.organization.name ?? ''} />

      <div className="py-4 first:pt-0">
        <button
          type="button"
          onClick={() => void logout()}
          className="rounded-full border border-[var(--border)] px-4 py-2 text-[length:var(--text-7)] font-semibold text-[var(--text-secondary)] hover:bg-[var(--surface-card-alt)]"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
