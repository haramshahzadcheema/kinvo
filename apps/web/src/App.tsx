import { useEffect, useState } from 'react';
import {
  AlertIcon,
  AssignmentIcon,
  BellIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  DashboardIcon,
  MenuIcon,
  PhoneIcon,
  RecruitIcon,
  ReminderIcon,
  SettingsIcon,
  ShipIcon,
  TimelineIcon,
  TranscriptIcon,
  TruckIcon,
} from './components/icons';
import { CallEStatusPill } from './components/CallEStatusPill';
import { GlobalSearch } from './components/GlobalSearch';
import { NotificationDropdown } from './components/NotificationDropdown';
import { AssignmentsPage } from './features/assignments/AssignmentsPage';
import { AuthScreen } from './features/auth/AuthScreen';
import { CallsPage } from './features/calls/CallsPage';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { DriversPage } from './features/drivers/DriversPage';
import { NotificationsPage } from './features/notifications/NotificationsPage';
import { useUnreadCount } from './features/notifications/useNotifications';
import { RecruitmentPage } from './features/recruitment/RecruitmentPage';
import { RemindersPage } from './features/reminders/RemindersPage';
import { SettingsPage } from './features/settings/SettingsPage';
import { ShipsPage } from './features/ships/ShipsPage';
import { TimelinePage } from './features/timeline/TimelinePage';
import { TranscriptsPage } from './features/transcripts/TranscriptsPage';
import { useYellowZoneStatusCounts } from './features/yellow-zone/useYellowZone';
import { YellowZonePage } from './features/yellow-zone/YellowZonePage';
import { AuthProvider } from './lib/auth';
import { RealtimeProvider } from './lib/RealtimeProvider';
import { SettingsProvider } from './lib/SettingsProvider';
import { useAuth } from './lib/useAuth';

type Tab =
  | 'dashboard'
  | 'ships'
  | 'drivers'
  | 'assignments'
  | 'calls'
  | 'yellow-zone'
  | 'recruitment'
  | 'reminders'
  | 'timeline'
  | 'transcripts'
  | 'notifications'
  | 'settings';

interface NavItem {
  key: Tab;
  label: string;
  icon: (props: { className?: string }) => React.ReactElement;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

// Grouped to match the Operations/Fleet/Campaigns/Intelligence/System
// structure of the reference design (docs: see the "Kinvo UI redesign
// plan" memory). Intelligence currently carries Timeline and
// Transcripts — the first two of its four planned pages (Analytics/AI
// Insights are later Phase E work) — so the group appears with what
// exists rather than waiting for all four, the same way Campaigns
// appeared with Recruitment+Reminders alone.
const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Operations',
    items: [
      { key: 'dashboard', label: 'Dashboard', icon: DashboardIcon },
      { key: 'calls', label: 'Calls', icon: PhoneIcon },
      { key: 'yellow-zone', label: 'Yellow Zone', icon: AlertIcon },
    ],
  },
  {
    title: 'Fleet',
    items: [
      { key: 'ships', label: 'Ships', icon: ShipIcon },
      { key: 'drivers', label: 'Drivers', icon: TruckIcon },
      { key: 'assignments', label: 'Assignments', icon: AssignmentIcon },
    ],
  },
  {
    title: 'Campaigns',
    items: [
      { key: 'recruitment', label: 'Recruitment', icon: RecruitIcon },
      { key: 'reminders', label: 'Reminders', icon: ReminderIcon },
    ],
  },
  {
    title: 'Intelligence',
    items: [
      { key: 'timeline', label: 'Timeline', icon: TimelineIcon },
      { key: 'transcripts', label: 'Transcripts', icon: TranscriptIcon },
    ],
  },
  {
    title: 'System',
    items: [
      { key: 'notifications', label: 'Notifications', icon: BellIcon },
      { key: 'settings', label: 'Settings', icon: SettingsIcon },
    ],
  },
];

const NAV_ITEMS = NAV_GROUPS.flatMap((group) => group.items);

function roleLabel(role: string): string {
  return role.charAt(0) + role.slice(1).toLowerCase();
}

function initialsOf(firstName: string, lastName: string): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}

function Shell() {
  const { auth, logout } = useAuth();
  const [tab, setTab] = useState<Tab>('dashboard');
  const [collapsed, setCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [shipAutoOpen, setShipAutoOpen] = useState(false);
  const [driverAutoOpen, setDriverAutoOpen] = useState(false);

  // Reset the one-shot auto-open flags right after the render that used
  // them — ShipsPage/DriversPage only read this as their useState initial
  // value at mount, so this doesn't retrigger the form on a later manual
  // tab switch back to the same page.
  useEffect(() => {
    if (shipAutoOpen) setShipAutoOpen(false);
  }, [shipAutoOpen]);
  useEffect(() => {
    if (driverAutoOpen) setDriverAutoOpen(false);
  }, [driverAutoOpen]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setMobileNavOpen(false);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [mobileNavOpen]);

  function navigate(target: Tab, autoOpenCreate?: boolean) {
    setTab(target);
    if (target === 'ships' && autoOpenCreate) setShipAutoOpen(true);
    if (target === 'drivers' && autoOpenCreate) setDriverAutoOpen(true);
    setMobileNavOpen(false);
  }

  function selectNav(key: NavItem['key']) {
    navigate(key);
  }

  const { data: yellowZoneCounts } = useYellowZoneStatusCounts();
  const yellowZonePendingCount = yellowZoneCounts?.PENDING ?? 0;
  const { data: unreadNotifications } = useUnreadCount();
  const unreadNotificationCount = unreadNotifications?.count ?? 0;

  function navBadgeCount(key: NavItem['key']): number {
    if (key === 'yellow-zone') return yellowZonePendingCount;
    if (key === 'notifications') return unreadNotificationCount;
    return 0;
  }

  const pageTitle = NAV_ITEMS.find((item) => item.key === tab)?.label ?? '';

  function renderNavGroups(variant: 'desktop' | 'mobile') {
    return NAV_GROUPS.map((group) => (
      <div key={group.title}>
        {(variant === 'mobile' || !collapsed) && (
          <div className="mb-1 px-2.5 text-[length:var(--text-1)] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            {group.title}
          </div>
        )}
        <div className="flex flex-col gap-0.5">
          {group.items.map((item) => {
            const isActive = tab === item.key;
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                onClick={() => selectNav(item.key)}
                title={variant === 'desktop' && collapsed ? item.label : undefined}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2 font-semibold transition ${
                  variant === 'mobile' ? 'text-[length:var(--text-8)] py-2.5' : 'text-[length:var(--text-7)]'
                } ${
                  isActive
                    ? 'bg-[var(--accent)] text-white'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--surface-card-alt)]'
                }`}
              >
                <Icon className="flex-shrink-0" />
                {(variant === 'mobile' || !collapsed) && (
                  <span className="flex-1 text-left">{item.label}</span>
                )}
                {navBadgeCount(item.key) > 0 && (
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[length:var(--text-1)] font-semibold ${
                      isActive ? 'bg-white/25 text-white' : 'bg-[var(--danger-bg)] text-[var(--danger)]'
                    }`}
                  >
                    {navBadgeCount(item.key)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    ));
  }

  return (
    <div className="flex min-h-screen bg-gradient-to-b from-[var(--surface-page-1)] via-[var(--surface-page-2)] to-[var(--surface-page-3)] text-[var(--text-strong)]">
      {/* Desktop sidebar */}
      <aside
        className={`hidden flex-shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface-card)]/70 backdrop-blur transition-all duration-200 md:flex ${
          collapsed ? 'w-16' : 'w-56'
        }`}
      >
        <div className="flex items-center gap-2.5 border-b border-[var(--border)] px-3.5 py-4">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[11px] bg-gradient-to-br from-[var(--accent)] to-[var(--accent-hover)] text-[length:var(--text-6)] font-bold text-white">
            K
          </div>
          {!collapsed && (
            <div className="flex min-w-0 flex-col leading-tight">
              <span className="text-[length:var(--text-7)] font-bold tracking-wide text-[var(--text-strong)]">
                KINVO
              </span>
              <span className="truncate text-[length:var(--text-2)] text-[var(--text-muted)]">
                {auth?.organization.name}
              </span>
            </div>
          )}
        </div>

        <nav className="flex flex-1 flex-col gap-3.5 overflow-y-auto p-2.5">
          {renderNavGroups('desktop')}
        </nav>

        <button
          onClick={() => setCollapsed((v) => !v)}
          className="flex items-center justify-center gap-2 border-t border-[var(--border)] px-3 py-2.5 text-[length:var(--text-4)] font-semibold text-[var(--text-muted)] hover:bg-[var(--surface-card-alt)]"
        >
          {collapsed ? <ChevronRightIcon /> : <ChevronLeftIcon />}
          {!collapsed && 'Collapse'}
        </button>

        {auth && (
          <div className="flex items-center gap-2.5 border-t border-[var(--border)] px-3 py-3">
            <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-[length:var(--text-3)] font-bold text-white">
              {initialsOf(auth.user.firstName, auth.user.lastName)}
            </div>
            {!collapsed && (
              <div className="min-w-0 flex-1 leading-tight">
                <div className="truncate text-[length:var(--text-5)] font-semibold text-[var(--text-strong)]">
                  {auth.user.firstName} {auth.user.lastName}
                </div>
                <div className="truncate text-[length:var(--text-2)] text-[var(--text-muted)]">
                  {roleLabel(auth.membership.role)}
                </div>
              </div>
            )}
          </div>
        )}
      </aside>

      {/* Mobile slide-out nav */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-30 md:hidden">
          <div
            onClick={() => setMobileNavOpen(false)}
            className="absolute inset-0 bg-[var(--surface-overlay)]"
          />
          <div className="absolute inset-y-0 left-0 flex w-64 animate-[slideIn_0.2s_ease] flex-col bg-[var(--surface-card)]">
            <div className="flex h-14 items-center justify-between border-b border-[var(--border)] px-4">
              <span className="text-sm font-bold text-[var(--text-strong)]">Kinvo</span>
              <button
                onClick={() => setMobileNavOpen(false)}
                aria-label="Close navigation"
                className="text-[var(--text-muted)]"
              >
                <CloseIcon />
              </button>
            </div>
            <nav className="flex flex-1 flex-col gap-3.5 overflow-y-auto p-2.5">
              {renderNavGroups('mobile')}
            </nav>
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--surface-card)]/70 px-4 py-3 backdrop-blur sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open navigation"
              className="text-[var(--text-secondary)] md:hidden"
            >
              <MenuIcon />
            </button>
            <div className="text-sm font-bold tracking-wide text-[var(--text-strong)] md:hidden">Kinvo</div>
            <div className="hidden truncate text-[length:var(--text-9)] font-bold text-[var(--text-strong)] md:block">
              {pageTitle}
            </div>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2 sm:gap-3">
            <CallEStatusPill />
            <GlobalSearch onNavigate={navigate} />
            <NotificationDropdown onNavigate={navigate} />
            <button
              onClick={() => void logout()}
              className="whitespace-nowrap rounded-full border border-[var(--border)] px-3 py-1.5 text-[length:var(--text-5)] font-semibold text-[var(--text-secondary)] hover:bg-[var(--surface-card-alt)]"
            >
              Sign out
            </button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-4 sm:px-6 sm:py-6">
          {tab === 'dashboard' && <DashboardPage onNavigate={navigate} />}
          {tab === 'ships' && <ShipsPage autoOpenCreate={shipAutoOpen} />}
          {tab === 'drivers' && <DriversPage autoOpenCreate={driverAutoOpen} />}
          {tab === 'assignments' && <AssignmentsPage />}
          {tab === 'calls' && <CallsPage onNavigate={navigate} />}
          {tab === 'yellow-zone' && <YellowZonePage onNavigate={navigate} />}
          {tab === 'recruitment' && <RecruitmentPage onNavigate={navigate} />}
          {tab === 'reminders' && <RemindersPage />}
          {tab === 'timeline' && <TimelinePage />}
          {tab === 'transcripts' && <TranscriptsPage />}
          {tab === 'notifications' && <NotificationsPage onNavigate={navigate} />}
          {tab === 'settings' && <SettingsPage />}
        </main>
      </div>
    </div>
  );
}

function AppInner() {
  const { status } = useAuth();

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--surface-page-1)] text-sm text-[var(--text-muted)]">
        Loading…
      </div>
    );
  }

  if (status === 'unauthenticated') {
    return <AuthScreen />;
  }

  return <Shell />;
}

export default function App() {
  return (
    <AuthProvider>
      <SettingsProvider>
        <RealtimeProvider>
          <AppInner />
        </RealtimeProvider>
      </SettingsProvider>
    </AuthProvider>
  );
}
