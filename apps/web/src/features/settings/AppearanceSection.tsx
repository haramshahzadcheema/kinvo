import type { AccentValue, DensityValue, FontFamilyValue, FontSizeValue, ThemeValue } from '@kinvo/contracts';
import { useUpdateSettings } from './useSettings';
import type { SettingsSectionProps } from './types';

// Preview-only — the real theming mechanism never reads this map; every
// actual color in the app comes from index.css's [data-accent] blocks via
// var(--accent). This exists purely to paint five accurate little swatch
// dots without wrapping five real DOM subtrees in five different
// [data-accent] scopes just to ask CSS what their color is. Keep it in
// sync with index.css by hand if a swatch value ever changes there.
const ACCENT_SWATCH: Record<AccentValue, string> = {
  OCEAN: '#1e7a8c',
  DEEP_BLUE: '#1d4e89',
  ELECTRIC_BLUE: '#1f6feb',
  TEAL: '#0f9b8e',
  SLATE: '#4a5a6a',
};

const ACCENT_LABEL: Record<AccentValue, string> = {
  OCEAN: 'Ocean',
  DEEP_BLUE: 'Deep Blue',
  ELECTRIC_BLUE: 'Electric Blue',
  TEAL: 'Teal',
  SLATE: 'Slate',
};

const THEME_OPTIONS: { value: ThemeValue; label: string }[] = [
  { value: 'LIGHT', label: 'Light' },
  { value: 'DARK', label: 'Dark' },
  { value: 'SYSTEM', label: 'System' },
];

const FONT_FAMILY_OPTIONS: { value: FontFamilyValue; label: string }[] = [
  { value: 'SYSTEM', label: 'System default' },
  { value: 'INTER', label: 'Inter' },
  { value: 'PLUS_JAKARTA_SANS', label: 'Plus Jakarta Sans' },
  { value: 'DM_SANS', label: 'DM Sans' },
];

const FONT_SIZE_OPTIONS: { value: FontSizeValue; label: string }[] = [
  { value: 'SMALL', label: 'Small' },
  { value: 'DEFAULT', label: 'Default' },
  { value: 'LARGE', label: 'Large' },
  { value: 'EXTRA_LARGE', label: 'Extra Large' },
];

const DENSITY_OPTIONS: { value: DensityValue; label: string; hint: string }[] = [
  { value: 'COMPACT', label: 'Compact', hint: 'Tighter rows, higher density' },
  { value: 'COMFORTABLE', label: 'Comfortable', hint: 'Default' },
  { value: 'SPACIOUS', label: 'Spacious', hint: 'More breathing room' },
];

function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  disabled,
  ariaLabel,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  disabled: boolean;
  ariaLabel: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="flex flex-wrap gap-1.5"
    >
      {options.map((option) => {
        const isActive = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isActive}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={`rounded-lg border px-3 py-1.5 text-[length:var(--text-7)] font-semibold transition disabled:opacity-50 ${
              isActive
                ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
                : 'border-[var(--border)] bg-[var(--surface-card)] text-[var(--text-secondary)] hover:bg-[var(--surface-card-alt)]'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function ToggleSwitch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled: boolean;
  label: string;
}) {
  return (
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
  );
}

function FieldRow({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-[var(--border)] py-4 first:pt-0 last:border-b-0 last:pb-0">
      <div className="mb-2">
        <div className="text-[length:var(--text-7)] font-semibold text-[var(--text-strong)]">{label}</div>
        {description && (
          <p className="mt-0.5 text-[length:var(--text-5)] text-[var(--text-muted)]">{description}</p>
        )}
      </div>
      {children}
    </div>
  );
}

export function AppearanceSection({ settings }: SettingsSectionProps) {
  const updateSettings = useUpdateSettings();
  const disabled = updateSettings.isPending;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] px-4 py-1 sm:px-5">
        {updateSettings.isError && (
          <div className="mt-4 rounded-lg border border-[var(--danger-bg-strong)] bg-[var(--danger-bg)] px-3 py-2 text-[length:var(--text-6)] font-medium text-[var(--danger)]">
            Couldn't save that change — reverted to your last saved appearance. Try again.
          </div>
        )}

        <FieldRow label="Theme" description="Light for a clean operational dashboard, Dark for the default Kinvo experience.">
          <SegmentedControl
            ariaLabel="Theme"
            options={THEME_OPTIONS}
            value={settings.theme}
            disabled={disabled}
            onChange={(theme) => updateSettings.mutate({ theme })}
          />
        </FieldRow>

        <FieldRow label="Accent" description="Colors buttons, active navigation, focus rings, and selected states. Never changes error/warning/success colors.">
          <div role="radiogroup" aria-label="Accent color" className="flex flex-wrap gap-2.5">
            {(Object.keys(ACCENT_SWATCH) as AccentValue[]).map((accent) => {
              const isActive = accent === settings.accent;
              return (
                <button
                  key={accent}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  aria-label={ACCENT_LABEL[accent]}
                  title={ACCENT_LABEL[accent]}
                  disabled={disabled}
                  onClick={() => updateSettings.mutate({ accent })}
                  className={`flex h-9 w-9 items-center justify-center rounded-full border-2 transition disabled:opacity-50 ${
                    isActive ? 'border-[var(--text-strong)]' : 'border-transparent'
                  }`}
                >
                  <span
                    className="h-6 w-6 rounded-full"
                    style={{ background: ACCENT_SWATCH[accent] }}
                    aria-hidden="true"
                  />
                </button>
              );
            })}
          </div>
        </FieldRow>

        <FieldRow label="Font">
          <label className="sr-only" htmlFor="settings-font-family">
            Font
          </label>
          <select
            id="settings-font-family"
            value={settings.fontFamily}
            disabled={disabled}
            onChange={(e) => updateSettings.mutate({ fontFamily: e.target.value as FontFamilyValue })}
            className="w-full max-w-xs rounded-lg border border-[var(--border)] bg-[var(--surface-card)] px-3 py-2 text-[length:var(--text-7)] font-medium text-[var(--text-strong)] disabled:opacity-50"
          >
            {FONT_FAMILY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </FieldRow>

        <FieldRow label="Font size">
          <SegmentedControl
            ariaLabel="Font size"
            options={FONT_SIZE_OPTIONS}
            value={settings.fontSize}
            disabled={disabled}
            onChange={(fontSize) => updateSettings.mutate({ fontSize })}
          />
        </FieldRow>

        <FieldRow label="Density" description="How tightly packed tables, cards, and navigation are.">
          <SegmentedControl
            ariaLabel="Density"
            options={DENSITY_OPTIONS}
            value={settings.density}
            disabled={disabled}
            onChange={(density) => updateSettings.mutate({ density })}
          />
        </FieldRow>

        <FieldRow label="Reduced motion" description="Disables transitions and animations app-wide.">
          <ToggleSwitch
            label="Reduced motion"
            checked={settings.reducedMotion}
            disabled={disabled}
            onChange={(reducedMotion) => updateSettings.mutate({ reducedMotion })}
          />
        </FieldRow>
      </div>

      <AppearancePreview />
    </div>
  );
}

// A real, live preview using the exact same token classes as
// DashboardPage's own stat cards — not a screenshot or an iframe. Because
// theme/accent/font/density are all applied as data-* attributes on
// <html> the instant a control above is touched (see useUpdateSettings'
// optimistic onMutate), this panel repaints in lockstep with every
// change above it with zero extra wiring: it inherits the same CSS
// variables the rest of the app does.
function AppearancePreview() {
  return (
    <div className="h-fit rounded-2xl border border-[var(--border)] bg-[var(--surface-page-1)] p-4">
      <div className="mb-2 text-[length:var(--text-4)] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
        Preview
      </div>
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-3.5">
        <div className="text-[length:var(--text-7)] font-bold text-[var(--text-strong)]">
          Kinvo Operations
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-page-1)] px-2.5 py-2">
            <div className="text-[length:var(--text-2)] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              Active Drivers
            </div>
            <div className="mt-0.5 text-base font-bold text-[var(--text-strong)]">24</div>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-page-1)] px-2.5 py-2">
            <div className="text-[length:var(--text-2)] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              Pending Calls
            </div>
            <div className="mt-0.5 text-base font-bold text-[var(--warning)]">7</div>
          </div>
        </div>
        <button
          type="button"
          disabled
          className="mt-3 w-full rounded-lg bg-[var(--accent)] py-2 text-[length:var(--text-6)] font-semibold text-white"
        >
          View Yellow Zone
        </button>
      </div>
    </div>
  );
}
