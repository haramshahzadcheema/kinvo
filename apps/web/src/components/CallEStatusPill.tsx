import { useActiveCalls } from '../features/calls/useCalls';

// Real active-call count from voiceCallsApi.listActive() (already
// 4s-polled while non-empty by useActiveCalls) — never a hardcoded
// placeholder number. Shows an idle state honestly rather than always
// claiming CALL-E is "active".
export function CallEStatusPill() {
  const { data } = useActiveCalls();
  const count = data?.items.length ?? 0;
  const active = count > 0;

  return (
    <div
      className="hidden flex-shrink-0 items-center gap-2 rounded-full px-3.5 py-1.5 sm:flex"
      style={{
        background: active ? 'var(--warning-bg)' : 'var(--surface-neutral-chip)',
      }}
    >
      <span className="relative flex h-1.5 w-1.5 flex-shrink-0">
        {active && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--warning)] opacity-75" />
        )}
        <span
          className="relative inline-flex h-1.5 w-1.5 rounded-full"
          style={{ background: active ? 'var(--warning)' : 'var(--text-muted)' }}
        />
      </span>
      <span
        className="whitespace-nowrap text-[length:var(--text-5)] font-semibold"
        style={{ color: active ? 'var(--warning)' : 'var(--text-muted)' }}
      >
        {active
          ? `CALL-E active — ${count} call${count === 1 ? '' : 's'} in progress`
          : 'CALL-E idle — no active calls'}
      </span>
    </div>
  );
}
