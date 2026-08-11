import type { ShipDto, ShipListResponse } from '@kinvo/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { shipsApi } from '../ships/api';
import { RecruitmentPage } from './RecruitmentPage';

// Mocks the same shipsApi ShipsPage/DriversPage already use — this page
// deliberately has no API module or backend endpoint of its own (see the
// module comment): it's a re-slice of ship data everything else already
// fetches, so exercising it means mocking exactly the one boundary that
// exists.
vi.mock('../ships/api', () => ({
  shipsApi: { list: vi.fn() },
}));

const mockedShipsApi = vi.mocked(shipsApi);

const shipWithShortage: ShipDto = {
  id: 's1',
  shipName: 'MSC Aurora',
  company: null,
  eta: null,
  reportingTime: null,
  berth: null,
  gate: null,
  cargoType: null,
  status: 'RECRUITING',
  notes: null,
  truckRequirements: [
    {
      id: 'tr1',
      destination: 'Salalah, Oman',
      truckType: 'Flatbed',
      quantityNeeded: 5,
      rate: 30,
      rateCurrency: 'OMR',
      notes: null,
      confirmedCount: 2,
      pendingCount: 1,
      rejectedCount: 1,
    },
  ],
  documentRequirements: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

function shipList(items: ShipDto[]): ShipListResponse {
  return { items, page: 1, pageSize: 50, total: items.length, totalPages: 1 };
}

function renderPage(onNavigate = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <RecruitmentPage onNavigate={onNavigate} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockedShipsApi.list.mockResolvedValue(shipList([shipWithShortage]));
});

afterEach(() => {
  vi.resetAllMocks();
});

describe('RecruitmentPage', () => {
  it('only requests RECRUITING ships — a CONFIRMED ship never has an open shortage by construction', async () => {
    renderPage();
    await screen.findByText(/MSC Aurora/);
    expect(mockedShipsApi.list).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'RECRUITING' }),
    );
  });

  it('shows needed/confirmed/pending/rejected for a destination still short of its target', async () => {
    renderPage();
    // "Salalah, Oman" is a sibling text node next to a nested <span>→</span>,
    // not the sole textContent of any one element — a plain-string
    // getByText only matches an element's full, exact text, so this uses
    // the same substring/regex approach already needed for "MSC Aurora".
    expect(await screen.findByText(/MSC Aurora/)).toBeInTheDocument();
    expect(await screen.findByText(/Salalah, Oman/)).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument(); // needed
    expect(screen.getByText('2')).toBeInTheDocument(); // confirmed
    expect(screen.getAllByText('1')).toHaveLength(2); // pending + rejected
  });

  it('a fully-staffed destination on a RECRUITING ship is excluded — only real shortages show', async () => {
    mockedShipsApi.list.mockResolvedValue(
      shipList([
        {
          ...shipWithShortage,
          truckRequirements: [
            { ...shipWithShortage.truckRequirements[0]!, confirmedCount: 5, quantityNeeded: 5 },
          ],
        },
      ]),
    );
    renderPage();
    expect(await screen.findByText('No open recruitment campaigns')).toBeInTheDocument();
  });

  it('clicking a campaign navigates to Ships — reuses the existing ship detail/invite flow instead of a second one', async () => {
    const onNavigate = vi.fn();
    renderPage(onNavigate);
    fireEvent.click(await screen.findByText(/MSC Aurora/));
    expect(onNavigate).toHaveBeenCalledWith('ships');
  });

  it('shows an honest empty state when there are no ships at all', async () => {
    mockedShipsApi.list.mockResolvedValue(shipList([]));
    renderPage();
    expect(await screen.findByText('No open recruitment campaigns')).toBeInTheDocument();
  });
});
