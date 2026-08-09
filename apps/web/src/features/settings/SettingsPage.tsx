import { useState } from 'react';
import { AccountSection } from './AccountSection';
import { AppearanceSection } from './AppearanceSection';
import { NotificationsSection } from './NotificationsSection';
import { OrganizationSection } from './OrganizationSection';
import { useSettings } from './useSettings';

type SettingsSection = 'appearance' | 'notifications' | 'account' | 'organization';

const SECTIONS: { key: SettingsSection; label: string; description: string }[] = [
  { key: 'appearance', label: 'Appearance', description: 'Theme, accent, typography, density' },
  { key: 'notifications', label: 'Notifications', description: 'What Kinvo notifies you about' },
  { key: 'account', label: 'Account', description: 'Your identity and session' },
  { key: 'organization', label: 'Organization', description: 'Where you work' },
];

// Desktop: a persistent sidebar + content, side by side (matches every
// detail-view pattern already in this app — ShipDetailDrawer/
// DriverDetailDrawer). Mobile: a section list first, tap to drill into
// content, then a Back control — never a fixed-width sidebar squeezed
// onto a narrow viewport. Both are the same `section` state; only the
// layout (and, on mobile, whether the list or the content is currently
// shown) differs.
export function SettingsPage() {
  const [section, setSection] = useState<SettingsSection>('appearance');
  const [mobileShowingContent, setMobileShowingContent] = useState(false);
  const { data: settings, isLoading, isError } = useSettings();

  function selectSection(next: SettingsSection) {
    setSection(next);
    setMobileShowingContent(true);
  }

  return (
    <div className="animate-[tideIn_0.2s_ease]">
      <div className="mb-5">
        <h1 className="text-lg font-bold text-[var(--text-strong)]">Settings</h1>
        <p className="mt-0.5 text-[length:var(--text-6)] text-[var(--text-muted)]">
          How Kinvo looks and behaves for you.
        </p>
      </div>

      {isLoading && (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-2xl border border-[var(--border)] bg-[var(--surface-card-alt)]" />
          ))}
        </div>
      )}

      {isError && (
        <p className="text-[length:var(--text-7)] text-[var(--danger)]">Could not load settings.</p>
      )}

      {settings && (
        <div className="md:grid md:grid-cols-[200px_minmax(0,1fr)] md:gap-5">
          {/* Desktop sidebar — always visible at md+. */}
          <nav aria-label="Settings sections" className="hidden md:flex md:flex-col md:gap-1">
            {SECTIONS.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setSection(item.key)}
                aria-current={section === item.key ? 'page' : undefined}
                className={`rounded-lg px-3 py-2 text-left text-[length:var(--text-7)] font-semibold transition ${
                  section === item.key
                    ? 'bg-[var(--accent)] text-white'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--surface-card-alt)]'
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>

          {/* Mobile section selector — replaced by the content once a
              section is tapped, with a Back control to return. */}
          <div className="md:hidden">
            {!mobileShowingContent ? (
              <div className="flex flex-col gap-2">
                {SECTIONS.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => selectSection(item.key)}
                    className="flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--surface-card)] px-4 py-3 text-left"
                  >
                    <span>
                      <span className="block text-[length:var(--text-7)] font-semibold text-[var(--text-strong)]">
                        {item.label}
                      </span>
                      <span className="mt-0.5 block text-[length:var(--text-5)] text-[var(--text-muted)]">
                        {item.description}
                      </span>
                    </span>
                    <span aria-hidden="true" className="text-[var(--text-muted)]">
                      ›
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div>
                <button
                  type="button"
                  onClick={() => setMobileShowingContent(false)}
                  className="mb-3 text-[length:var(--text-7)] font-semibold text-[var(--accent)]"
                >
                  ‹ Settings
                </button>
                <SettingsSectionContent section={section} settings={settings} />
              </div>
            )}
          </div>

          {/* Desktop content — always visible at md+, next to the sidebar. */}
          <div className="hidden md:block">
            <SettingsSectionContent section={section} settings={settings} />
          </div>
        </div>
      )}
    </div>
  );
}

function SettingsSectionContent({
  section,
  settings,
}: {
  section: SettingsSection;
  settings: NonNullable<ReturnType<typeof useSettings>['data']>;
}) {
  switch (section) {
    case 'appearance':
      return <AppearanceSection settings={settings} />;
    case 'notifications':
      return <NotificationsSection settings={settings} />;
    case 'account':
      return <AccountSection />;
    case 'organization':
      return <OrganizationSection />;
  }
}
