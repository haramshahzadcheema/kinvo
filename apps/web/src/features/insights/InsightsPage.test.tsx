import type { InsightsSummaryDto } from '@kinvo/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { insightsApi } from './api';
import { InsightsPage } from './InsightsPage';

vi.mock('./api', () => ({
  insightsApi: { getSummary: vi.fn() },
}));

const mockedInsightsApi = vi.mocked(insightsApi);

const summaryWithInsights: InsightsSummaryDto = {
  days: 30,
  insights: [
    {
      id: 'driver_reliability',
      title: 'Driver Reliability',
      observation: 'Ahmed Ali has 3 rejected, cancelled, or no-show assignments in the last 30 days.',
      recommendation: 'Consider avoiding Ahmed Ali for urgent or time-critical loads.',
      basis: 'Based on 3 negative assignment outcomes across 1 driver in the period.',
    },
  ],
};

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <InsightsPage />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.resetAllMocks();
});

describe('InsightsPage', () => {
  it('shows a real insight with its observation, recommendation, and basis', async () => {
    mockedInsightsApi.getSummary.mockResolvedValue(summaryWithInsights);
    renderPage();

    expect(await screen.findByText('Driver Reliability')).toBeInTheDocument();
    expect(
      screen.getByText(/Ahmed Ali has 3 rejected, cancelled, or no-show assignments/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Consider avoiding Ahmed Ali/)).toBeInTheDocument();
    expect(screen.getByText(/Based on 3 negative assignment outcomes/)).toBeInTheDocument();
  });

  it('states plainly that this is rule-based, not AI-generated', async () => {
    mockedInsightsApi.getSummary.mockResolvedValue(summaryWithInsights);
    renderPage();

    await screen.findByText('Driver Reliability');
    expect(screen.getByText(/not AI-generated/)).toBeInTheDocument();
  });

  it('shows an honest empty state when there is not enough real activity yet', async () => {
    mockedInsightsApi.getSummary.mockResolvedValue({ days: 30, insights: [] });
    renderPage();

    expect(await screen.findByText('Nothing stands out yet')).toBeInTheDocument();
  });

  it('shows an error state when the request fails', async () => {
    mockedInsightsApi.getSummary.mockRejectedValue(new Error('network error'));
    renderPage();

    expect(await screen.findByText('Could not load insights.')).toBeInTheDocument();
  });
});
