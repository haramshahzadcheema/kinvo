import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
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
});
