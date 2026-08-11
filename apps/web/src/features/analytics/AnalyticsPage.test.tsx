import type { AnalyticsSummaryDto } from '@kinvo/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyticsApi } from './api';
import { AnalyticsPage } from './AnalyticsPage';

vi.mock('./api', () => ({
  analyticsApi: { getSummary: vi.fn() },
}));

const mockedAnalyticsApi = vi.mocked(analyticsApi);

const baseSummary: AnalyticsSummaryDto = {
  days: 7,
  stats: [
    { key: 'calls_automated', label: 'Calls Automated', value: '12', spark: [1, 2, 1, 3, 2, 2, 1], deltaPct: 20 },
    { key: 'resolution_rate', label: 'Resolution Rate', value: '83%', spark: [70, 75, 80, 82, 83, 83, 83], deltaPct: -5 },
    { key: 'avg_time_to_resolve', label: 'Avg Time to Resolve', value: '1m 30s', spark: [100, 95, 92, 90, 88, 87, 90], deltaPct: null },
    { key: 'yellow_zone_escalations', label: 'Yellow Zone Escalations', value: '2', spark: [0, 1, 0, 0, 1, 0, 0], deltaPct: null },
  ],
  dailyCallVolume: [
    { date: '2026-08-05', automated: 1, escalated: 0 },
    { date: '2026-08-06', automated: 2, escalated: 1 },
    { date: '2026-08-07', automated: 1, escalated: 0 },
    { date: '2026-08-08', automated: 3, escalated: 0 },
    { date: '2026-08-09', automated: 2, escalated: 1 },
    { date: '2026-08-10', automated: 2, escalated: 0 },
    { date: '2026-08-11', automated: 1, escalated: 0 },
  ],
  yellowZoneByPriority: [
    { priority: 'HIGH', count: 1 },
    { priority: 'MEDIUM', count: 1 },
    { priority: 'LOW', count: 0 },
  ],
};

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AnalyticsPage />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.resetAllMocks();
});

describe('AnalyticsPage', () => {
  it('shows all four real stat cards with their values', async () => {
    mockedAnalyticsApi.getSummary.mockResolvedValue(baseSummary);
    renderPage();

    expect(await screen.findByText('Calls Automated')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('Resolution Rate')).toBeInTheDocument();
    expect(screen.getByText('83%')).toBeInTheDocument();
    expect(screen.getByText('Avg Time to Resolve')).toBeInTheDocument();
    expect(screen.getByText('1m 30s')).toBeInTheDocument();
    expect(screen.getByText('Yellow Zone Escalations')).toBeInTheDocument();
  });

  it('shows a delta when present, and omits it when null (no fabricated comparison)', async () => {
    mockedAnalyticsApi.getSummary.mockResolvedValue(baseSummary);
    renderPage();

    await screen.findByText('Calls Automated');
    expect(screen.getByText('+20% vs prior period')).toBeInTheDocument();
    expect(screen.getByText('-5% vs prior period')).toBeInTheDocument();
    // avg_time_to_resolve and yellow_zone_escalations both have
    // deltaPct: null — there must be exactly the two delta lines above,
    // not four.
    expect(screen.getAllByText(/vs prior period/)).toHaveLength(2);
  });

  it('shows the real Yellow Zone priority breakdown', async () => {
    mockedAnalyticsApi.getSummary.mockResolvedValue(baseSummary);
    renderPage();

    expect(await screen.findByText('High priority')).toBeInTheDocument();
    expect(screen.getByText('Medium priority')).toBeInTheDocument();
    expect(screen.getByText('Low priority')).toBeInTheDocument();
  });

  it('shows an honest empty state for the calls chart when there is no data in the period', async () => {
    mockedAnalyticsApi.getSummary.mockResolvedValue({
      ...baseSummary,
      dailyCallVolume: baseSummary.dailyCallVolume.map((d) => ({ ...d, automated: 0, escalated: 0 })),
    });
    renderPage();

    expect(await screen.findByText('No automated calls in this period yet.')).toBeInTheDocument();
  });

  it('shows an honest empty state for Yellow Zone when there are no escalations', async () => {
    mockedAnalyticsApi.getSummary.mockResolvedValue({
      ...baseSummary,
      yellowZoneByPriority: baseSummary.yellowZoneByPriority.map((p) => ({ ...p, count: 0 })),
    });
    renderPage();

    expect(await screen.findByText('No escalations in this period.')).toBeInTheDocument();
  });

  it('shows an error state when the request fails', async () => {
    mockedAnalyticsApi.getSummary.mockRejectedValue(new Error('network error'));
    renderPage();

    expect(await screen.findByText('Could not load analytics.')).toBeInTheDocument();
  });
});
