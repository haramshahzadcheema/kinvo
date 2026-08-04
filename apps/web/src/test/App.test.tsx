import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('App', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: 'ok',
          dependencies: [
            { name: 'postgres', status: 'ok', latencyMs: 3 },
            { name: 'redis', status: 'ok', latencyMs: 1 },
          ],
          timestamp: new Date().toISOString(),
        }),
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the Kinvo heading', () => {
    renderWithClient();
    expect(screen.getByRole('heading', { name: 'Kinvo' })).toBeInTheDocument();
  });

  it('renders dependency status once the health check resolves', async () => {
    renderWithClient();

    await waitFor(() => {
      expect(screen.getByText('postgres')).toBeInTheDocument();
      expect(screen.getByText('redis')).toBeInTheDocument();
    });
  });

  it('renders an error state when the API is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
    renderWithClient();

    await waitFor(() => {
      expect(screen.getByText(/could not reach the api/i)).toBeInTheDocument();
    });
  });
});
