import type { Settings } from '@kinvo/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '../../lib/AuthContext';
import { settingsApi } from './api';
import { SettingsPage } from './SettingsPage';

vi.mock('./api', () => ({
  settingsApi: {
    get: vi.fn(),
    update: vi.fn(),
  },
}));

const mockedApi = vi.mocked(settingsApi);

const baseSettings: Settings = {
  theme: 'SYSTEM',
  accent: 'OCEAN',
  fontFamily: 'SYSTEM',
  fontSize: 'DEFAULT',
  density: 'COMFORTABLE',
  reducedMotion: false,
  yellowZoneEscalationNotifications: true,
  notificationSound: false,
};

const authValue: AuthContextValue = {
  status: 'authenticated',
  auth: {
    user: { id: 'u1', email: 'dispatcher@example.com', firstName: 'Dee', lastName: 'Ispatcher' },
    organization: { id: 'o1', name: 'Jebel Ali Dispatch', slug: 'jebel-ali-dispatch' },
    membership: { id: 'm1', role: 'OWNER' },
  },
  login: vi.fn(),
  register: vi.fn(),
  logout: vi.fn(),
};

// Clicks the DESKTOP sidebar button for a section — see the rendering
// test's comment for why this, not the mobile list item, is the
// unambiguous way to navigate sections under jsdom.
async function openSection(name: string) {
  const sidebar = await screen.findByRole('navigation', { name: 'Settings sections' });
  fireEvent.click(within(sidebar).getByRole('button', { name }));
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={authValue}>
        <SettingsPage />
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
  return { ...utils, queryClient };
}

beforeEach(() => {
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-accent');
  mockedApi.get.mockResolvedValue(baseSettings);
  mockedApi.update.mockImplementation((input) =>
    Promise.resolve({ ...baseSettings, ...input }),
  );
});

afterEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
});

describe('SettingsPage — rendering', () => {
  it('shows a loading state, then the section list', async () => {
    let resolveGet!: (value: Settings) => void;
    mockedApi.get.mockReturnValue(new Promise((resolve) => (resolveGet = resolve)));
    const { container } = renderPage();
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();

    resolveGet(baseSettings);
    // jsdom doesn't apply the responsive `hidden md:flex`/`md:hidden`
    // CSS, so the desktop sidebar AND the mobile section list are both
    // literally in the DOM at once — querying the sidebar `nav`
    // specifically (its accessible name is just the label, unlike the
    // mobile list buttons which also fold in the description text) is
    // what makes these queries resolve to exactly one match, matching
    // real single-viewport behavior.
    const sidebar = await screen.findByRole('navigation', { name: 'Settings sections' });
    expect(within(sidebar).getByRole('button', { name: 'Appearance' })).toBeInTheDocument();
    expect(within(sidebar).getByRole('button', { name: 'Notifications' })).toBeInTheDocument();
    expect(within(sidebar).getByRole('button', { name: 'Account' })).toBeInTheDocument();
    expect(within(sidebar).getByRole('button', { name: 'Organization' })).toBeInTheDocument();
  });

  it('shows an error state when settings fail to load', async () => {
    mockedApi.get.mockRejectedValue(new Error('boom'));
    renderPage();
    expect(await screen.findByText('Could not load settings.')).toBeInTheDocument();
  });
});

describe('SettingsPage — appearance', () => {
  it('selecting Dark theme calls the update mutation and applies data-theme to the document', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('radio', { name: 'Dark' }));

    await waitFor(() => expect(mockedApi.update).toHaveBeenCalledWith({ theme: 'DARK' }));
    // Optimistic — applied to the DOM before the mocked network call
    // resolves, per useUpdateSettings' onMutate.
    expect(document.documentElement.getAttribute('data-theme')).toBe('DARK');
  });

  it('selecting an accent calls the update mutation with the correct value', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('radio', { name: 'Teal' }));

    await waitFor(() => expect(mockedApi.update).toHaveBeenCalledWith({ accent: 'TEAL' }));
    expect(document.documentElement.getAttribute('data-accent')).toBe('TEAL');
  });

  it('changing the font family select calls the update mutation', async () => {
    renderPage();
    const select = await screen.findByLabelText('Font');
    fireEvent.change(select, { target: { value: 'INTER' } });

    await waitFor(() => expect(mockedApi.update).toHaveBeenCalledWith({ fontFamily: 'INTER' }));
  });

  it('selecting a font size calls the update mutation', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('radio', { name: 'Large' }));

    await waitFor(() => expect(mockedApi.update).toHaveBeenCalledWith({ fontSize: 'LARGE' }));
  });

  it('selecting a density calls the update mutation', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('radio', { name: 'Compact' }));

    await waitFor(() => expect(mockedApi.update).toHaveBeenCalledWith({ density: 'COMPACT' }));
  });

  it('toggling reduced motion calls the update mutation and sets data-reduced-motion', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('switch', { name: 'Reduced motion' }));

    await waitFor(() =>
      expect(mockedApi.update).toHaveBeenCalledWith({ reducedMotion: true }),
    );
    expect(document.documentElement.getAttribute('data-reduced-motion')).toBe('true');
  });

  it('renders a live preview that is real markup, not a screenshot', async () => {
    renderPage();
    expect(await screen.findByText('Preview')).toBeInTheDocument();
    expect(screen.getByText('Kinvo Operations')).toBeInTheDocument();
    expect(screen.getByText('Active Drivers')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View Yellow Zone' })).toBeInTheDocument();
  });
});

describe('SettingsPage — persistence failure', () => {
  it('reverts the DOM and shows an error message when the update fails', async () => {
    mockedApi.update.mockRejectedValue(new Error('network down'));
    renderPage();

    fireEvent.click(await screen.findByRole('radio', { name: 'Dark' }));
    // Optimistic apply happens immediately...
    await waitFor(() => expect(document.documentElement.getAttribute('data-theme')).toBe('DARK'));
    // ...then reverts once the mutation actually fails. baseSettings.theme
    // is 'SYSTEM', which the DOM never stores literally — it always holds
    // the RESOLVED value (see lib/appearance.ts), 'LIGHT' here since the
    // matchMedia shim in test/setup.ts defaults matches to false.
    await waitFor(() =>
      expect(document.documentElement.getAttribute('data-theme')).toBe('LIGHT'),
    );
    expect(
      await screen.findByText(/Couldn't save that change/i),
    ).toBeInTheDocument();
  });
});

describe('SettingsPage — notifications', () => {
  it('toggling Yellow Zone escalations calls the update mutation with that field', async () => {
    renderPage();
    await openSection('Notifications');

    fireEvent.click(
      await screen.findByRole('switch', { name: 'Yellow Zone escalations' }),
    );
    await waitFor(() =>
      expect(mockedApi.update).toHaveBeenCalledWith({ yellowZoneEscalationNotifications: false }),
    );
  });

  it('toggling notification sound calls the update mutation with that field, independent of the other toggle', async () => {
    renderPage();
    await openSection('Notifications');

    fireEvent.click(await screen.findByRole('switch', { name: 'Notification sound' }));
    await waitFor(() =>
      expect(mockedApi.update).toHaveBeenCalledWith({ notificationSound: true }),
    );
    expect(mockedApi.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ yellowZoneEscalationNotifications: expect.anything() }),
    );
  });
});

describe('SettingsPage — account', () => {
  it('shows the real, current identity as read-only fields', async () => {
    renderPage();
    await openSection('Account');

    expect(await screen.findByText('Dee Ispatcher')).toBeInTheDocument();
    expect(screen.getByText('dispatcher@example.com')).toBeInTheDocument();
    expect(screen.getByText('OWNER')).toBeInTheDocument();
    expect(screen.getByText('Jebel Ali Dispatch')).toBeInTheDocument();
    // Two "Sign out" buttons legitimately exist at once here — App.tsx's
    // own header button (not rendered by SettingsPage, so not present in
    // this test) and this section's — not applicable in this isolated
    // render, so a single unambiguous match is expected.
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('signing out calls the real logout(), not a second implementation', async () => {
    renderPage();
    await openSection('Account');
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(authValue.logout).toHaveBeenCalledTimes(1);
  });
});

describe('SettingsPage — accessibility', () => {
  it('exposes theme, accent, font size, and density as accessible radio groups', async () => {
    renderPage();
    await screen.findByRole('navigation', { name: 'Settings sections' });

    expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Accent color' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Font size' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Density' })).toBeInTheDocument();
    // Every option is a real radio with aria-checked, not a div styled to
    // look selected — screen readers get the actual selection state.
    expect(screen.getByRole('radio', { name: 'System', checked: true })).toBeInTheDocument();
  });

  it('exposes toggles with role="switch" and a real accessible name', async () => {
    renderPage();
    const toggle = await screen.findByRole('switch', { name: 'Reduced motion' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  });
});
