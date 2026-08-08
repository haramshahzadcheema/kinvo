import type { NotificationDto, NotificationListResponse } from '@kinvo/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RealtimeContext } from '../../lib/RealtimeContext';
import { notificationsApi } from './api';
import { NotificationsPage } from './NotificationsPage';

vi.mock('./api', () => ({
  notificationsApi: {
    list: vi.fn(),
    unreadCount: vi.fn(),
    markRead: vi.fn(),
    markAllRead: vi.fn(),
  },
}));

const mockedApi = vi.mocked(notificationsApi);

const baseNotification: NotificationDto = {
  id: 'n1',
  type: 'YELLOW_ZONE_ESCALATED',
  title: 'New escalation: Ahsan Raza',
  message: 'MSC Aurora · Salalah, Oman — CALL-E reported the call as failed.',
  targetType: 'YELLOW_ZONE_ITEM',
  targetId: 'yz1',
  readAt: null,
  createdAt: new Date().toISOString(),
};

function listResponse(items: NotificationDto[]): NotificationListResponse {
  return { items, page: 1, pageSize: 20, total: items.length, totalPages: 1 };
}

function renderPage(onNavigate = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <RealtimeContext.Provider value="connected">
        <NotificationsPage onNavigate={onNavigate} />
      </RealtimeContext.Provider>
    </QueryClientProvider>,
  );
  return { ...utils, queryClient, onNavigate };
}

beforeEach(() => {
  mockedApi.unreadCount.mockResolvedValue({ count: 1 });
  mockedApi.list.mockResolvedValue(listResponse([baseNotification]));
});

afterEach(() => {
  vi.resetAllMocks();
});

describe('NotificationsPage — list states', () => {
  it('shows an unread notification with title and message', async () => {
    renderPage();
    expect(await screen.findByText('New escalation: Ahsan Raza')).toBeInTheDocument();
    expect(
      screen.getByText('MSC Aurora · Salalah, Oman — CALL-E reported the call as failed.'),
    ).toBeInTheDocument();
  });

  it('shows a loading skeleton while fetching', async () => {
    let resolveList!: (value: NotificationListResponse) => void;
    mockedApi.list.mockReturnValue(new Promise((resolve) => (resolveList = resolve)));
    const { container } = renderPage();
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
    resolveList(listResponse([baseNotification]));
    expect(await screen.findByText('New escalation: Ahsan Raza')).toBeInTheDocument();
  });

  it('shows an error message when the list request fails', async () => {
    mockedApi.list.mockRejectedValue(new Error('boom'));
    renderPage();
    expect(await screen.findByText('Could not load notifications.')).toBeInTheDocument();
  });

  it('shows the positive empty state when there is nothing to see', async () => {
    mockedApi.list.mockResolvedValue(listResponse([]));
    mockedApi.unreadCount.mockResolvedValue({ count: 0 });
    renderPage();
    expect(await screen.findByText("You're all caught up.")).toBeInTheDocument();
  });
});

describe('NotificationsPage — read state and navigation', () => {
  it('marks an unread notification read and navigates to Yellow Zone on click', async () => {
    mockedApi.markRead.mockResolvedValue(undefined);
    const { onNavigate } = renderPage();

    fireEvent.click(await screen.findByText('New escalation: Ahsan Raza'));

    await waitFor(() => expect(mockedApi.markRead).toHaveBeenCalledWith('n1'));
    expect(onNavigate).toHaveBeenCalledWith('yellow-zone');
  });

  it('navigates without calling markRead again for an already-read notification', async () => {
    mockedApi.list.mockResolvedValue(
      listResponse([{ ...baseNotification, readAt: new Date().toISOString() }]),
    );
    const { onNavigate } = renderPage();

    fireEvent.click(await screen.findByText('New escalation: Ahsan Raza'));

    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith('yellow-zone'));
    expect(mockedApi.markRead).not.toHaveBeenCalled();
  });

  it('shows Mark all read only when there is at least one unread notification', async () => {
    renderPage();
    expect(await screen.findByRole('button', { name: 'Mark all read' })).toBeInTheDocument();
  });

  it('hides Mark all read when the unread count is zero', async () => {
    mockedApi.unreadCount.mockResolvedValue({ count: 0 });
    renderPage();
    await screen.findByText('New escalation: Ahsan Raza');
    expect(screen.queryByRole('button', { name: 'Mark all read' })).not.toBeInTheDocument();
  });

  it('calls markAllRead when the button is clicked', async () => {
    mockedApi.markAllRead.mockResolvedValue({ count: 1 });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Mark all read' }));

    await waitFor(() => expect(mockedApi.markAllRead).toHaveBeenCalled());
  });
});

describe('NotificationsPage — realtime-triggered refresh', () => {
  // Mirrors YellowZonePage's own realtime test: RealtimeProvider's job is
  // just invalidating ['notifications'] on any notification.* socket
  // event — this exercises that exact query-key invalidation -> refetch
  // chain directly rather than also standing up a real socket connection.
  it('re-renders with fresh data when the notifications query is invalidated', async () => {
    const { queryClient } = renderPage();
    expect(await screen.findByText('New escalation: Ahsan Raza')).toBeInTheDocument();

    const second: NotificationDto = { ...baseNotification, id: 'n2', title: 'Second escalation' };
    mockedApi.list.mockResolvedValue(listResponse([second, baseNotification]));
    mockedApi.unreadCount.mockResolvedValue({ count: 2 });

    await queryClient.invalidateQueries({ queryKey: ['notifications'] });

    expect(await screen.findByText('Second escalation')).toBeInTheDocument();
  });
});
