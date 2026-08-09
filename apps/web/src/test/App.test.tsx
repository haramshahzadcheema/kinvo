import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../App';

function renderWithClient() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );
}

const authResponse = {
  accessToken: 'fake-access-token',
  user: { id: 'u1', email: 'owner@example.com', firstName: 'Sara', lastName: 'Al-Farsi' },
  organization: { id: 'o1', name: 'Jebel Ali Dispatch', slug: 'jebel-ali-dispatch' },
  membership: { id: 'm1', role: 'OWNER' },
};

describe('App', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the sign-up screen when there is no existing session (silent refresh fails)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: { code: 'UNAUTHORIZED', message: 'Missing refresh token.' } }),
      }),
    );

    renderWithClient();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /create your portal/i })).toBeInTheDocument();
    });
  });

  it('shows the dispatch shell once a session is recovered (silent refresh succeeds)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes('/auth/refresh')) {
          return Promise.resolve({ ok: true, status: 200, json: async () => authResponse });
        }
        // Ships list, called once the shell renders — return an empty page.
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ items: [], page: 1, pageSize: 50, total: 0, totalPages: 1 }),
        });
      }),
    );

    renderWithClient();

    await waitFor(() => {
      expect(screen.getByText('Jebel Ali Dispatch')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Ships' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Drivers' })).toBeInTheDocument();
  });

  // Settings feature: a first-class, always-enabled nav destination (no
  // "Soon" badge, unlike its stub before this feature existed) — clicking
  // it must actually navigate, proven end to end through the real nav
  // shell, not just by rendering <SettingsPage /> in isolation (see
  // features/settings/SettingsPage.test.tsx for that half).
  it('navigates to Settings from the main navigation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes('/auth/refresh')) {
          return Promise.resolve({ ok: true, status: 200, json: async () => authResponse });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ items: [], page: 1, pageSize: 50, total: 0, totalPages: 1 }),
        });
      }),
    );

    renderWithClient();

    // jsdom doesn't apply the responsive CSS that hides the mobile nav at
    // desktop width, so both the desktop sidebar and mobile nav's
    // "Settings" buttons are present at once — findAllByRole would throw
    // if neither existed, so index 0 is always the desktop one.
    const settingsButtons = await screen.findAllByRole('button', { name: 'Settings' });
    fireEvent.click(settingsButtons[0]!);

    expect(await screen.findByText('How Kinvo looks and behaves for you.')).toBeInTheDocument();
  });
});
