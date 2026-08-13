import type {
  DriverListResponse,
  ShipListResponse,
  YellowZoneListResponse,
  YellowZoneStatusCounts,
} from '@kinvo/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { driversApi } from '../drivers/api';
import { shipsApi } from '../ships/api';
import { yellowZoneApi } from '../yellow-zone/api';
import { DashboardPage } from './DashboardPage';

// DashboardPage has no API module of its own — it composes shipsApi/
// driversApi/yellowZoneApi through their existing hooks (same reasoning as
// every other feature page's own test file: mock exactly the boundaries
// that exist).
vi.mock('../ships/api', () => ({ shipsApi: { list: vi.fn() } }));
vi.mock('../drivers/api', () => ({ driversApi: { list: vi.fn() } }));
vi.mock('../yellow-zone/api', () => ({ yellowZoneApi: { list: vi.fn(), stats: vi.fn() } }));

const mockedShipsApi = vi.mocked(shipsApi);
const mockedDriversApi = vi.mocked(driversApi);
const mockedYellowZoneApi = vi.mocked(yellowZoneApi);

function emptyShipList(overrides: Partial<ShipListResponse> = {}): ShipListResponse {
  return { items: [], page: 1, pageSize: 50, total: 0, totalPages: 1, ...overrides };
}

function emptyDriverList(overrides: Partial<DriverListResponse> = {}): DriverListResponse {
  return { items: [], page: 1, pageSize: 5, total: 0, totalPages: 1, ...overrides };
}

function emptyYellowZoneList(): YellowZoneListResponse {
  return { items: [], page: 1, pageSize: 4, total: 0, totalPages: 1 };
}

function zeroYellowZoneCounts(): YellowZoneStatusCounts {
  return { PENDING: 0, IN_REVIEW: 0, RESOLVED: 0, DISMISSED: 0 };
}

function renderDashboard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <DashboardPage onNavigate={vi.fn()} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.resetAllMocks();
});

describe('DashboardPage — honest loading/error/empty/success states', () => {
  it('renders real success-state data once every query resolves', async () => {
    mockedShipsApi.list.mockResolvedValue(emptyShipList());
    mockedDriversApi.list.mockResolvedValue(emptyDriverList());
    mockedYellowZoneApi.stats.mockResolvedValue(zeroYellowZoneCounts());
    mockedYellowZoneApi.list.mockResolvedValue(emptyYellowZoneList());

    renderDashboard();

    // A genuinely empty (not failed) Yellow Zone panel still shows the
    // reassuring copy — this is the SUCCESS+EMPTY case, distinct from the
    // ERROR case covered below.
    expect(await screen.findByText('Good — nothing needs your attention.')).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load this data.")).not.toBeInTheDocument();
  });

  // The audit's named example: a failed Yellow Zone stats fetch must never
  // render the same "Good — nothing needs your attention" copy a genuine
  // zero-count does — that's a false "all clear" from a request that
  // actually failed.
  it('shows an honest error state on the Yellow Zone panel when its query fails, not a false "all clear"', async () => {
    mockedShipsApi.list.mockResolvedValue(emptyShipList());
    mockedDriversApi.list.mockResolvedValue(emptyDriverList());
    mockedYellowZoneApi.stats.mockRejectedValue(new Error('Network error'));
    mockedYellowZoneApi.list.mockResolvedValue(emptyYellowZoneList());

    renderDashboard();

    expect(await screen.findByText("Couldn't load this data.")).toBeInTheDocument();
    expect(screen.queryByText('Good — nothing needs your attention.')).not.toBeInTheDocument();
  });

  it('retrying a failed panel refetches its underlying query', async () => {
    mockedShipsApi.list.mockResolvedValue(emptyShipList());
    mockedDriversApi.list.mockResolvedValue(emptyDriverList());
    mockedYellowZoneApi.stats.mockRejectedValueOnce(new Error('Network error'));
    mockedYellowZoneApi.list.mockResolvedValue(emptyYellowZoneList());

    renderDashboard();
    const retry = await screen.findByRole('button', { name: 'Retry' });

    mockedYellowZoneApi.stats.mockResolvedValueOnce({ ...zeroYellowZoneCounts(), PENDING: 2 });
    retry.click();

    // The retry re-fetched and the panel moved off both the error state
    // and the stale "nothing needs attention" copy — proving the button
    // actually triggers TanStack Query's refetch, not just a visual reset.
    await waitFor(() => {
      expect(screen.queryByText("Couldn't load this data.")).not.toBeInTheDocument();
      expect(screen.queryByText('Good — nothing needs your attention.')).not.toBeInTheDocument();
    });
  });

  it('shows an honest error state (not a false "fully staffed"/"nothing scheduled") when the ships query fails', async () => {
    mockedShipsApi.list.mockRejectedValue(new Error('Network error'));
    mockedDriversApi.list.mockResolvedValue(emptyDriverList());
    mockedYellowZoneApi.stats.mockResolvedValue(zeroYellowZoneCounts());
    mockedYellowZoneApi.list.mockResolvedValue(emptyYellowZoneList());

    renderDashboard();

    // Shortages, Incoming vessels, and Today's operations all derive from
    // the same failed ships query — every one of them must show the error
    // state, none of them may fall back to their normal empty-state copy.
    const errors = await screen.findAllByText("Couldn't load this data.");
    expect(errors.length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByText('Every active destination is fully staffed.')).not.toBeInTheDocument();
    expect(screen.queryByText('No ships with a scheduled ETA yet.')).not.toBeInTheDocument();
    expect(screen.queryByText('Nothing scheduled to arrive or report today.')).not.toBeInTheDocument();
  });

  it('shows "—" instead of a misleading "0" on a stat card whose count query failed', async () => {
    mockedShipsApi.list.mockRejectedValue(new Error('Network error'));
    mockedDriversApi.list.mockResolvedValue(emptyDriverList());
    mockedYellowZoneApi.stats.mockResolvedValue(zeroYellowZoneCounts());
    mockedYellowZoneApi.list.mockResolvedValue(emptyYellowZoneList());

    renderDashboard();

    await waitFor(() => {
      expect(screen.getAllByTitle("Couldn't load this count.").length).toBeGreaterThan(0);
    });
  });
});
