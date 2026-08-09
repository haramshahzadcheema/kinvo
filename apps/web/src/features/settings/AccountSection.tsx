import { useAuth } from '../../lib/useAuth';

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

// Every field here is read-only, deliberately — there is no
// name/email-change endpoint in this codebase today (an email change in
// particular would need a real verification flow this app doesn't have),
// so this section shows the real, current identity rather than inventing
// editable fields with nothing behind them. Sign out reuses AuthProvider's
// existing logout() — the same call App.tsx's header button already
// makes — not a second implementation.
export function AccountSection() {
  const { auth, logout } = useAuth();

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] px-4 py-1 sm:px-5">
      <ReadOnlyField label="Name" value={`${auth?.user.firstName ?? ''} ${auth?.user.lastName ?? ''}`.trim()} />
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
