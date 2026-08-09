import { useUpdateSettings } from './useSettings';
import type { SettingsSectionProps } from './types';

function ToggleRow({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] py-4 first:pt-0 last:border-b-0 last:pb-0">
      <div className="min-w-0">
        <div className="text-[length:var(--text-7)] font-semibold text-[var(--text-strong)]">{label}</div>
        <p className="mt-0.5 text-[length:var(--text-5)] text-[var(--text-muted)]">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 flex-shrink-0 rounded-full transition disabled:opacity-50 ${
          checked ? 'bg-[var(--accent)]' : 'bg-[var(--surface-muted-3)]'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0 h-5 w-5 rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-[22px]' : 'translate-x-0.5'
          }`}
        />
      </button>
    </div>
  );
}

// Deliberately two toggles, not a "realtime notification updates" third
// one — see docs/ARCHITECTURE.md's Settings section for why: the only
// thing a "realtime updates" toggle could safely gate without either
// faking it or degrading the core Phase 6 notification system (the
// unread badge/list itself) is exactly what notificationSound already
// covers. The socket connection and Yellow Zone/notification cache
// invalidation are never affected by anything on this page — see
// RealtimeProvider.tsx, unchanged by this feature.
export function NotificationsSection({ settings }: SettingsSectionProps) {
  const updateSettings = useUpdateSettings();
  const disabled = updateSettings.isPending;

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] px-4 py-1 sm:px-5">
      {updateSettings.isError && (
        <div className="mt-4 rounded-lg border border-[var(--danger-bg-strong)] bg-[var(--danger-bg)] px-3 py-2 text-[length:var(--text-6)] font-medium text-[var(--danger)]">
          Couldn't save that change. Try again.
        </div>
      )}

      <ToggleRow
        label="Yellow Zone escalations"
        description="Get notified when an automated call CALL-E couldn't resolve needs your review."
        checked={settings.yellowZoneEscalationNotifications}
        disabled={disabled}
        onChange={(yellowZoneEscalationNotifications) =>
          updateSettings.mutate({ yellowZoneEscalationNotifications })
        }
      />
      <ToggleRow
        label="Notification sound"
        description="Play a short sound when a new notification arrives live."
        checked={settings.notificationSound}
        disabled={disabled}
        onChange={(notificationSound) => updateSettings.mutate({ notificationSound })}
      />
    </div>
  );
}
