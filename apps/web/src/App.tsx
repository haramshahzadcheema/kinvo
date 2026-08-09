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
  SettingsIcon,
  ShipIcon,
  TruckIcon,
} from './components/icons';
import { AssignmentsPage } from './features/assignments/AssignmentsPage';
import { AuthScreen } from './features/auth/AuthScreen';
import { CallsPage } from './features/calls/CallsPage';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { DriversPage } from './features/drivers/DriversPage';
import { NotificationsPage } from './features/notifications/NotificationsPage';
import { useUnreadCount } from './features/notifications/useNotifications';
import { SettingsPage } from './features/settings/SettingsPage';
import { ShipsPage } from './features/ships/ShipsPage';
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
  | 'notifications'
  | 'settings';

interface NavItem {
  key: Tab;
  label: string;
  icon: (props: { className?: string }) => React.ReactElement;
  comingSoon?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { key: 'dashboard', label: 'Dashboard', icon: DashboardIcon },
  { key: 'ships', label: 'Ships', icon: ShipIcon },
  { key: 'drivers', label: 'Drivers', icon: TruckIcon },
  { key: 'assignments', label: 'Assignments', icon: AssignmentIcon },
  { key: 'calls', label: 'Calls', icon: PhoneIcon },
  { key: 'yellow-zone', label: 'Yellow Zone', icon: AlertIcon },
  { key: 'notifications', label: 'Notifications', icon: BellIcon },
  { key: 'settings', label: 'Settings', icon: SettingsIcon },
];

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

  return (
    <div className="flex min-h-screen bg-gradient-to-b from-[var(--surface-page-1)] via-[var(--surface-page-2)] to-[var(--surface-page-3)] text-[var(--text-strong)]">
      {/* Desktop sidebar */}
      <aside
        className={`hidden flex-shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface-card)]/70 backdrop-blur transition-all duration-200 md:flex ${
          collapsed ? 'w-16' : 'w-56'
        }`}
      >
        <div className="flex h-14 items-center gap-2 border-b border-[var(--border)] px-4">
          <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-xs font-bold text-white">
            K
          </div>
          {!collapsed && <span className="text-sm font-bold text-[var(--text-strong)]">Kinvo</span>}
        </div>

        <nav className="flex flex-1 flex-col gap-1 p-2.5">
          {NAV_ITEMS.map((item) => {
            const isActive = tab === item.key;
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                onClick={() => selectNav(item.key)}
                disabled={item.comingSoon}
                title={collapsed ? item.label : undefined}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-[length:var(--text-7)] font-semibold transition ${
                  isActive
                    ? 'bg-[var(--accent)] text-white'
                    : item.comingSoon
                      ? 'cursor-default text-[var(--text-muted)]'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--surface-card-alt)]'
                }`}
              >
                <Icon className="flex-shrink-0" />
                {!collapsed && <span className="flex-1 text-left">{item.label}</span>}
                {!collapsed && item.comingSoon && (
                  <span className="rounded-full bg-[var(--surface-card-alt)] px-1.5 py-0.5 text-[length:var(--text-1)] font-semibold text-[var(--text-muted)]">
                    Soon
                  </span>
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
        </nav>

        <button
          onClick={() => setCollapsed((v) => !v)}
          className="flex items-center justify-center gap-2 border-t border-[var(--border)] px-3 py-3 text-[length:var(--text-4)] font-semibold text-[var(--text-muted)] hover:bg-[var(--surface-card-alt)]"
        >
          {collapsed ? <ChevronRightIcon /> : <ChevronLeftIcon />}
          {!collapsed && 'Collapse'}
        </button>
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
            <nav className="flex flex-1 flex-col gap-1 p-2.5">
              {NAV_ITEMS.map((item) => {
                const isActive = tab === item.key;
                const Icon = item.icon;
                return (
                  <button
                    key={item.key}
                    onClick={() => selectNav(item.key)}
                    disabled={item.comingSoon}
                    className={`flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-[length:var(--text-8)] font-semibold transition ${
                      isActive
                        ? 'bg-[var(--accent)] text-white'
                        : item.comingSoon
                          ? 'cursor-default text-[var(--text-muted)]'
                          : 'text-[var(--text-secondary)] hover:bg-[var(--surface-card-alt)]'
                    }`}
                  >
                    <Icon className="flex-shrink-0" />
                    <span className="flex-1 text-left">{item.label}</span>
                    {item.comingSoon && (
                      <span className="rounded-full bg-[var(--surface-card-alt)] px-1.5 py-0.5 text-[length:var(--text-1)] font-semibold text-[var(--text-muted)]">
                        Soon
                      </span>
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
            </nav>
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--surface-card)]/70 px-4 py-3 backdrop-blur sm:px-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open navigation"
              className="text-[var(--text-secondary)] md:hidden"
            >
              <MenuIcon />
            </button>
            <div>
              <div className="text-sm font-bold tracking-wide text-[var(--text-strong)] md:hidden">Kinvo</div>
              <div className="hidden text-[length:var(--text-3)] text-[var(--text-muted)] sm:block">
                {auth?.organization.name}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-[length:var(--text-6)] text-[var(--text-secondary)] sm:inline">
              {auth?.user.firstName} · {auth?.membership.role}
            </span>
            <button
              onClick={() => void logout()}
              className="rounded-full border border-[var(--border)] px-3 py-1.5 text-[length:var(--text-5)] font-semibold text-[var(--text-secondary)] hover:bg-[var(--surface-card-alt)]"
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
