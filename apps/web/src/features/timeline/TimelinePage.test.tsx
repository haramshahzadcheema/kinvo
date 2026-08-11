import type { TimelineEntryDto, TimelineListResponse } from '@kinvo/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { timelineApi } from './api';
import { TimelinePage } from './TimelinePage';

// Mocks the same boundary as RemindersPage/RecruitmentPage's own tests —
// this page has no other API surface of its own.
vi.mock('./api', () => ({
  timelineApi: { list: vi.fn() },
}));

const mockedTimelineApi = vi.mocked(timelineApi);

const baseEntry: TimelineEntryDto = {
  id: 'e1',
  type: 'ship.created',
  title: 'Ship Created',
  detail: 'MSC Aurora',
  actorUserId: 'u1',
  actorName: 'Ada Lovelace',
  createdAt: new Date('2026-08-11T10:13:00Z').toISOString(),
};

function timelineList(items: TimelineEntryDto[], overrides: Partial<TimelineListResponse> = {}): TimelineListResponse {
  return { items, page: 1, pageSize: 25, total: items.length, totalPages: 1, ...overrides };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <TimelinePage />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.resetAllMocks();
});

describe('TimelinePage — rendering', () => {
  it('shows a real event with its title, detail, and actor', async () => {
    mockedTimelineApi.list.mockResolvedValue(timelineList([baseEntry]));
    renderPage();

    expect(await screen.findByText('Ship Created')).toBeInTheDocument();
    expect(screen.getByText('MSC Aurora')).toBeInTheDocument();
    expect(screen.getByText(/Ada Lovelace/)).toBeInTheDocument();
  });

  it('shows an honest empty state when there is no activity yet', async () => {
    mockedTimelineApi.list.mockResolvedValue(timelineList([]));
    renderPage();

    expect(await screen.findByText('No activity yet')).toBeInTheDocument();
  });

  it('renders a null detail (a sparse event with nothing resolvable) without a stray blank line', async () => {
    mockedTimelineApi.list.mockResolvedValue(
      timelineList([{ ...baseEntry, detail: null }]),
    );
    renderPage();

    expect(await screen.findByText('Ship Created')).toBeInTheDocument();
    expect(screen.queryByText('null')).not.toBeInTheDocument();
  });

  it('shows a real event triggered by CALL-E, not a human dispatcher', async () => {
    mockedTimelineApi.list.mockResolvedValue(
      timelineList([
        {
          ...baseEntry,
          id: 'e2',
          type: 'assignment.attempt_logged',
          title: 'Confirmation Call Attempted',
          actorUserId: 'system:call-e',
          actorName: 'CALL-E',
        },
      ]),
    );
    renderPage();

    expect(await screen.findByText(/CALL-E/)).toBeInTheDocument();
  });
});

describe('TimelinePage — pagination', () => {
  it('requests page 1 first and shows a Load more button when more pages exist', async () => {
    mockedTimelineApi.list.mockResolvedValue(
      timelineList([baseEntry], { page: 1, totalPages: 2, total: 30 }),
    );
    renderPage();

    await screen.findByText('Ship Created');
    expect(mockedTimelineApi.list).toHaveBeenCalledWith({ page: 1, pageSize: 25 });
    expect(screen.getByRole('button', { name: 'Load more' })).toBeInTheDocument();
  });

  it('has no Load more button once every page has been fetched', async () => {
    mockedTimelineApi.list.mockResolvedValue(
      timelineList([baseEntry], { page: 1, totalPages: 1 }),
    );
    renderPage();

    await screen.findByText('Ship Created');
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('clicking Load more requests the next page', async () => {
    mockedTimelineApi.list.mockResolvedValue(
      timelineList([baseEntry], { page: 1, totalPages: 2, total: 30 }),
    );
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }));
    await waitFor(() =>
      expect(mockedTimelineApi.list).toHaveBeenCalledWith({ page: 2, pageSize: 25 }),
    );
  });
});
