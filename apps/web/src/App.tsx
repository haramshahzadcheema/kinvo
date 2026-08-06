import { useEffect, useState } from 'react';
import {
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
import { AuthScreen } from './features/auth/AuthScreen';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { DriversPage } from './features/drivers/DriversPage';
import { ShipsPage } from './features/ships/ShipsPage';
import { AuthProvider } from './lib/auth';
import { useAuth } from './lib/useAuth';

type Tab = 'dashboard' | 'ships' | 'drivers';

interface NavItem {
  key: Tab | 'assignments' | 'calls' | 'notifications' | 'settings';
  label: string;
  icon: (props: { className?: string }) => React.ReactElement;
  comingSoon?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { key: 'dashboard', label: 'Dashboard', icon: DashboardIcon },
  { key: 'ships', label: 'Ships', icon: ShipIcon },
  { key: 'drivers', label: 'Drivers', icon: TruckIcon },
  { key: 'assignments', label: 'Assignments', icon: AssignmentIcon, comingSoon: true },
  { key: 'calls', label: 'Calls', icon: PhoneIcon, comingSoon: true },
  { key: 'notifications', label: 'Notifications', icon: BellIcon, comingSoon: true },
  { key: 'settings', label: 'Settings', icon: SettingsIcon, comingSoon: true },
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
    if (key === 'dashboard' || key === 'ships' || key === 'drivers') {
      navigate(key);
    }
  }

  return (
    <div className="flex min-h-screen bg-gradient-to-b from-[#FBF6EE] via-[#F6EFE1] to-[#EFE6D2] text-[#1E2A33]">
      {/* Desktop sidebar */}
      <aside
        className={`hidden flex-shrink-0 flex-col border-r border-[#ECE1CC] bg-white/70 backdrop-blur transition-all duration-200 md:flex ${
          collapsed ? 'w-16' : 'w-56'
        }`}
      >
        <div className="flex h-14 items-center gap-2 border-b border-[#ECE1CC] px-4">
          <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-[#1E7A8C] text-xs font-bold text-white">
            K
          </div>
          {!collapsed && <span className="text-sm font-bold text-[#0F2A38]">Kinvo</span>}
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
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-[12.5px] font-semibold transition ${
                  isActive
                    ? 'bg-[#1E7A8C] text-white'
                    : item.comingSoon
                      ? 'cursor-default text-[#B3A98F]'
                      : 'text-[#5C6B75] hover:bg-[#F3EDDD]'
                }`}
              >
                <Icon className="flex-shrink-0" />
                {!collapsed && <span className="flex-1 text-left">{item.label}</span>}
                {!collapsed && item.comingSoon && (
                  <span className="rounded-full bg-[#F3EDDD] px-1.5 py-0.5 text-[9px] font-semibold text-[#8B9AA3]">
                    Soon
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <button
          onClick={() => setCollapsed((v) => !v)}
          className="flex items-center justify-center gap-2 border-t border-[#ECE1CC] px-3 py-3 text-[11px] font-semibold text-[#8B9AA3] hover:bg-[#F3EDDD]"
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
            className="absolute inset-0 bg-[rgba(15,42,56,0.4)]"
          />
          <div className="absolute inset-y-0 left-0 flex w-64 animate-[slideIn_0.2s_ease] flex-col bg-white">
            <div className="flex h-14 items-center justify-between border-b border-[#ECE1CC] px-4">
              <span className="text-sm font-bold text-[#0F2A38]">Kinvo</span>
              <button
                onClick={() => setMobileNavOpen(false)}
                aria-label="Close navigation"
                className="text-[#8B9AA3]"
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
                    className={`flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-[13px] font-semibold transition ${
                      isActive
                        ? 'bg-[#1E7A8C] text-white'
                        : item.comingSoon
                          ? 'cursor-default text-[#B3A98F]'
                          : 'text-[#5C6B75] hover:bg-[#F3EDDD]'
                    }`}
                  >
                    <Icon className="flex-shrink-0" />
                    <span className="flex-1 text-left">{item.label}</span>
                    {item.comingSoon && (
                      <span className="rounded-full bg-[#F3EDDD] px-1.5 py-0.5 text-[9px] font-semibold text-[#8B9AA3]">
                        Soon
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
        <header className="flex items-center justify-between gap-2 border-b border-[#ECE1CC] bg-white/70 px-4 py-3 backdrop-blur sm:px-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open navigation"
              className="text-[#5C6B75] md:hidden"
            >
              <MenuIcon />
            </button>
            <div>
              <div className="text-sm font-bold tracking-wide text-[#0F2A38] md:hidden">Kinvo</div>
              <div className="hidden text-[10.5px] text-[#8B9AA3] sm:block">
                {auth?.organization.name}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-[12px] text-[#5C6B75] sm:inline">
              {auth?.user.firstName} · {auth?.membership.role}
            </span>
            <button
              onClick={() => void logout()}
              className="rounded-full border border-[#ECE1CC] px-3 py-1.5 text-[11.5px] font-semibold text-[#5C6B75] hover:bg-[#F3EDDD]"
            >
              Sign out
            </button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-4 sm:px-6 sm:py-6">
          {tab === 'dashboard' && <DashboardPage onNavigate={navigate} />}
          {tab === 'ships' && <ShipsPage autoOpenCreate={shipAutoOpen} />}
          {tab === 'drivers' && <DriversPage autoOpenCreate={driverAutoOpen} />}
        </main>
      </div>
    </div>
  );
}

function AppInner() {
  const { status } = useAuth();

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#FBF6EE] text-sm text-[#8B9AA3]">
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
      <AppInner />
    </AuthProvider>
  );
}
