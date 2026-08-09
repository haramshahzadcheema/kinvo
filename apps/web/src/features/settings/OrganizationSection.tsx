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

// Read-only, on purpose — this codebase has no organization-level
// settings endpoint today (name/slug are set once at registration, with
// no rename route in organizations.service.ts), so there is nothing
// genuinely editable to expose here yet, for any role. Rather than build
// a member/invitation-management UI as part of this Settings pass (a
// materially different, larger feature — organizations.routes.ts already
// has the backend RBAC-gated endpoints for it, just no frontend page),
// this section stays informational. The one role-conditional line is
// display-only (which role you are), never a gate on a mutation that
// doesn't exist — see docs/ARCHITECTURE.md's Settings section.
export function OrganizationSection() {
  const { auth } = useAuth();
  const canManageMembers = auth?.membership.role === 'OWNER' || auth?.membership.role === 'ADMIN';

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] px-4 py-1 sm:px-5">
      <ReadOnlyField label="Organization name" value={auth?.organization.name ?? ''} />
      <ReadOnlyField label="Your role" value={auth?.membership.role ?? ''} />

      {canManageMembers && (
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
