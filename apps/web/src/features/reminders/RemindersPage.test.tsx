import type { ReminderCampaignDto, ReminderCampaignListResponse, ShipDto, ShipListResponse } from '@kinvo/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { remindersApi } from './api';
import { RemindersPage } from './RemindersPage';

// Two API modules mocked, not fetch — RemindersPage's own hooks
// (useReminders.ts) call through remindersApi.*, and the create form's
// ship picker reuses the existing useShips hook, which calls through
// shipsApi.* — same reasoning as YellowZonePage.test.tsx's own mocking
// boundary.
vi.mock('./api', () => ({
  remindersApi: {
    list: vi.fn(),
    create: vi.fn(),
    approve: vi.fn(),
    cancel: vi.fn(),
  },
}));
vi.mock('../ships/api', () => ({
  shipsApi: {
    list: vi.fn(),
  },
}));

const mockedRemindersApi = vi.mocked(remindersApi);

const baseShip: ShipDto = {
  id: 's1',
  shipName: 'MSC Aurora',
  company: null,
  eta: null,
  reportingTime: null,
  berth: null,
  gate: 'Gate 3',
  cargoType: null,
  status: 'RECRUITING',
  notes: null,
  truckRequirements: [],
  documentRequirements: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const baseCampaign: ReminderCampaignDto = {
  id: 'rc1',
  shipId: 's1',
  shipName: 'MSC Aurora',
  shipGate: 'Gate 3',
  shipReportingTime: null,
  status: 'PENDING_APPROVAL',
  notes: 'Report 30 minutes early.',
  currentConfirmedDriverCount: 4,
  createdByUserId: 'u1',
  createdByUserName: 'Dee Ispatcher',
  approvedByUserId: null,
  approvedByUserName: null,
  approvedAt: null,
  confirmedDriverCountAtApproval: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

function campaignList(items: ReminderCampaignDto[]): ReminderCampaignListResponse {
  return { items, page: 1, pageSize: 50, total: items.length, totalPages: 1 };
}

function shipList(items: ShipDto[]): ShipListResponse {
  return { items, page: 1, pageSize: 50, total: items.length, totalPages: 1 };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <RemindersPage />
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  const { shipsApi } = await import('../ships/api');
  vi.mocked(shipsApi.list).mockResolvedValue(shipList([baseShip]));
  mockedRemindersApi.list.mockResolvedValue(campaignList([baseCampaign]));
});

afterEach(() => {
  vi.resetAllMocks();
});

describe('RemindersPage — rendering', () => {
  it('shows a campaign with its ship, gate, notes, and confirmed-driver count', async () => {
    renderPage();
    expect(await screen.findByText('MSC Aurora')).toBeInTheDocument();
    expect(screen.getByText(/Gate 3/)).toBeInTheDocument();
    expect(screen.getByText('Report 30 minutes early.')).toBeInTheDocument();
    expect(screen.getByText(/4 confirmed drivers on this ship/)).toBeInTheDocument();
    expect(screen.getByText('Awaiting approval')).toBeInTheDocument();
  });

  it('shows an honest empty state when there are no campaigns', async () => {
    mockedRemindersApi.list.mockResolvedValue(campaignList([]));
    renderPage();
    expect(await screen.findByText('No reminder campaigns yet')).toBeInTheDocument();
  });

  it('a SENT campaign shows who approved it and the frozen snapshot count, not the live one', async () => {
    mockedRemindersApi.list.mockResolvedValue(
      campaignList([
        {
          ...baseCampaign,
          status: 'SENT',
          approvedByUserName: 'Sara Al-Farsi',
          confirmedDriverCountAtApproval: 3,
          currentConfirmedDriverCount: 5, // live count has since changed — must not be shown here
        },
      ]),
    );
    renderPage();
    expect(await screen.findByText(/Approved by Sara Al-Farsi for 3 confirmed drivers/)).toBeInTheDocument();
    expect(screen.queryByText(/5 confirmed drivers/)).not.toBeInTheDocument();
  });
});

describe('RemindersPage — approve / cancel', () => {
  it('approving a campaign calls the mutation with its id', async () => {
    mockedRemindersApi.approve.mockResolvedValue({ ...baseCampaign, status: 'SENT' });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(mockedRemindersApi.approve).toHaveBeenCalledWith('rc1'));
  });

  it('cancelling a campaign calls the mutation with its id', async () => {
    mockedRemindersApi.cancel.mockResolvedValue({ ...baseCampaign, status: 'CANCELLED' });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(mockedRemindersApi.cancel).toHaveBeenCalledWith('rc1'));
  });

  it('a SENT campaign has no Approve/Cancel actions — it is already resolved', async () => {
    mockedRemindersApi.list.mockResolvedValue(campaignList([{ ...baseCampaign, status: 'SENT' }]));
    renderPage();
    await screen.findByText('MSC Aurora');
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });
});

describe('RemindersPage — create', () => {
  it('creating a campaign requires picking a ship first', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '+ New Reminder' }));
    expect(await screen.findByRole('button', { name: 'Create Reminder' })).toBeDisabled();
  });

  it('submits the selected ship and optional notes', async () => {
    mockedRemindersApi.create.mockResolvedValue({ ...baseCampaign, id: 'rc2' });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '+ New Reminder' }));

    // Waits for the ship's own option to exist, not just the select itself
    // — the select renders immediately with only the placeholder option
    // while useShips is still loading, and setting .value to an option
    // that doesn't exist yet is silently a no-op in jsdom (same as a real
    // browser), leaving the form looking correct but never actually armed.
    await screen.findByRole('option', { name: 'MSC Aurora' });
    const select = screen.getByDisplayValue('Select a ship…');
    fireEvent.change(select, { target: { value: 's1' } });
    const notesInput = screen.getByPlaceholderText('e.g. Report 30 minutes early');
    fireEvent.change(notesInput, { target: { value: 'Early gate today.' } });

    fireEvent.click(screen.getByRole('button', { name: 'Create Reminder' }));
    await waitFor(() =>
      expect(mockedRemindersApi.create).toHaveBeenCalledWith({
        shipId: 's1',
        notes: 'Early gate today.',
      }),
    );
  });
});
