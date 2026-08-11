import type { YellowZoneItemDto, YellowZoneListResponse } from '@kinvo/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '../../lib/AuthContext';
import { ApiError } from '../../lib/apiClient';
import { RealtimeContext } from '../../lib/RealtimeContext';
import { yellowZoneApi } from './api';
import { YellowZonePage } from './YellowZonePage';

// The whole api.ts module is mocked, not fetch — YellowZonePage's own
// query/mutation hooks (useYellowZone.ts) call through yellowZoneApi.*
// exclusively, so mocking at that boundary exercises the real component
// tree (real TanStack Query hooks, real state machine, real modal) without
// needing to also fake the HTTP layer underneath it.
vi.mock('./api', () => ({
  yellowZoneApi: {
    list: vi.fn(),
    stats: vi.fn(),
    get: vi.fn(),
    claim: vi.fn(),
    unclaim: vi.fn(),
    resolve: vi.fn(),
    dismiss: vi.fn(),
  },
}));

const mockedApi = vi.mocked(yellowZoneApi);

const baseItem: YellowZoneItemDto = {
  id: 'yz1',
  assignmentId: 'a1',
  assignmentAttemptId: 'att1',
  driverId: 'd1',
  driverName: 'Ahsan Raza',
  driverPhone: '+92 300 1234567',
  shipId: 's1',
  shipName: 'MSC Aurora',
  destination: 'Salalah, Oman',
  truckType: 'Flatbed',
  reason: 'CALL-E reported the call as failed.',
  priority: 'HIGH',
  status: 'PENDING',
  assignmentStatus: 'PENDING',
  assignedToUserId: null,
  assignedToUserName: null,
  resolutionNotes: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  resolvedAt: null,
};

function listResponse(items: YellowZoneItemDto[]): YellowZoneListResponse {
  return { items, page: 1, pageSize: 20, total: items.length, totalPages: 1 };
}

const CURRENT_USER_ID = 'u1';
const OTHER_USER_ID = 'u2';

function authValue(): AuthContextValue {
  return {
    status: 'authenticated',
    auth: {
      user: { id: CURRENT_USER_ID, email: 'dispatcher@example.com', firstName: 'Dee', lastName: 'Ispatcher' },
      organization: { id: 'org1', name: 'Jebel Ali Dispatch', slug: 'jebel-ali-dispatch' },
      membership: { id: 'm1', role: 'DISPATCHER' },
    },
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    updateMe: vi.fn(),
    updateOrganization: vi.fn(),
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={authValue()}>
        <RealtimeContext.Provider value="connected">
          <YellowZonePage onNavigate={vi.fn()} />
        </RealtimeContext.Provider>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
  return { ...utils, queryClient };
}

async function openDetailModal(driverName = baseItem.driverName) {
  fireEvent.click(await screen.findByText(driverName));
}

beforeEach(() => {
  mockedApi.stats.mockResolvedValue({ PENDING: 1, IN_REVIEW: 0, RESOLVED: 0, DISMISSED: 0 });
  mockedApi.list.mockResolvedValue(listResponse([baseItem]));
});

afterEach(() => {
  vi.resetAllMocks();
});

describe('YellowZonePage — list states', () => {
  // A. Initial PENDING state
  it('shows a pending item in the default (PENDING) filtered view', async () => {
    renderPage();
    expect(await screen.findByText('Ahsan Raza')).toBeInTheDocument();
    expect(screen.getByText('MSC Aurora · Salalah, Oman')).toBeInTheDocument();
  });

  // M. Loading state
  it('shows a loading skeleton while the list is still fetching', async () => {
    let resolveList!: (value: YellowZoneListResponse) => void;
    mockedApi.list.mockReturnValue(new Promise((resolve) => (resolveList = resolve)));

    const { container } = renderPage();
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();

    resolveList(listResponse([baseItem]));
    expect(await screen.findByText('Ahsan Raza')).toBeInTheDocument();
  });

  // N. Error state
  it('shows an error message when the list request fails', async () => {
    mockedApi.list.mockRejectedValue(new ApiError('Server exploded', 500));
    renderPage();
    expect(await screen.findByText('Could not load the Yellow Zone queue.')).toBeInTheDocument();
  });

  // O. Empty queue state
  it('shows the positive empty state when there is nothing pending', async () => {
    mockedApi.list.mockResolvedValue(listResponse([]));
    mockedApi.stats.mockResolvedValue({ PENDING: 0, IN_REVIEW: 0, RESOLVED: 0, DISMISSED: 0 });
    renderPage();
    expect(await screen.findByText('Good — nothing needs your attention.')).toBeInTheDocument();
  });
});

describe('YellowZonePage — claim flow and the modal-staleness regression', () => {
  // B. Claim button visibility
  it('shows a Claim button for a PENDING item and no Resolve/Dismiss yet', async () => {
    renderPage();
    await openDetailModal();
    expect(screen.getByRole('button', { name: 'Claim' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resolve' })).not.toBeInTheDocument();
  });

  // C, D, Q. Claim success updates the STILL-OPEN modal (the exact
  // regression: the modal used to keep showing "Unclaimed"/"Claim" after a
  // successful claim because it held a stale snapshot instead of the
  // mutation's own response).
  it('updates the open modal from PENDING to IN_REVIEW immediately after claiming — no close/reopen required', async () => {
    const claimed: YellowZoneItemDto = {
      ...baseItem,
      status: 'IN_REVIEW',
      assignedToUserId: CURRENT_USER_ID,
      assignedToUserName: 'Dee Ispatcher',
    };
    mockedApi.claim.mockResolvedValue(claimed);

    renderPage();
    await openDetailModal();
    fireEvent.click(screen.getByRole('button', { name: 'Claim' }));

    await waitFor(() => expect(screen.getByText('In review')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Claim' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resolve' })).toBeInTheDocument();
    expect(screen.getByText('Dee Ispatcher')).toBeInTheDocument(); // Owner row
  });

  // K, L. 409 claim race — a friendlier message, and the modal self-heals
  // to the item's real current state instead of dead-ending on a stale
  // "Claim" button for an item someone else already took.
  it('handles a 409 claim race by showing a friendly message and the item\'s current claimed state', async () => {
    mockedApi.claim.mockRejectedValue(new ApiError('Conflict', 409));
    const currentState: YellowZoneItemDto = {
      ...baseItem,
      status: 'IN_REVIEW',
      assignedToUserId: OTHER_USER_ID,
      assignedToUserName: 'Someone Else',
    };
    mockedApi.get.mockResolvedValue(currentState);

    renderPage();
    await openDetailModal();
    fireEvent.click(screen.getByRole('button', { name: 'Claim' }));

    expect(
      await screen.findByText('Someone else just claimed this item — showing its current status.'),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Someone Else')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Claim' })).not.toBeInTheDocument();
  });
});

describe('YellowZonePage — resolve', () => {
  const claimedByMe: YellowZoneItemDto = {
    ...baseItem,
    status: 'IN_REVIEW',
    assignedToUserId: CURRENT_USER_ID,
    assignedToUserName: 'Dee Ispatcher',
  };

  beforeEach(() => {
    mockedApi.list.mockResolvedValue(listResponse([claimedByMe]));
    mockedApi.stats.mockResolvedValue({ PENDING: 0, IN_REVIEW: 1, RESOLVED: 0, DISMISSED: 0 });
  });

  // E. Resolve button only available when appropriate (IN_REVIEW)
  it('shows Resolve and Release for an item claimed by the current user, not Claim', async () => {
    renderPage();
    await openDetailModal();
    expect(screen.getByRole('button', { name: 'Resolve' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Release' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Claim' })).not.toBeInTheDocument();
  });

  // F. Resolve requires non-empty resolutionNotes
  it('keeps Confirm resolve disabled until notes are entered', async () => {
    renderPage();
    await openDetailModal();
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));

    const confirmButton = screen.getByRole('button', { name: 'Confirm resolve' });
    expect(confirmButton).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText('What did you do? (required)'), {
      target: { value: 'Called the driver directly.' },
    });
    expect(confirmButton).not.toBeDisabled();
  });

  // G. Resolve success
  it('resolves and closes the modal on success', async () => {
    mockedApi.resolve.mockResolvedValue({ ...claimedByMe, status: 'RESOLVED', resolvedAt: new Date().toISOString() });
    renderPage();
    await openDetailModal();
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    fireEvent.change(screen.getByPlaceholderText('What did you do? (required)'), {
      target: { value: 'Called the driver directly.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm resolve' }));

    await waitFor(() =>
      expect(mockedApi.resolve).toHaveBeenCalledWith('yz1', {
        resolutionNotes: 'Called the driver directly.',
      }),
    );
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Confirm resolve' })).not.toBeInTheDocument());
  });
});

describe('YellowZonePage — dismiss', () => {
  // H. Dismiss from PENDING
  it('dismisses a PENDING item without requiring a claim first', async () => {
    mockedApi.dismiss.mockResolvedValue({ ...baseItem, status: 'DISMISSED', resolvedAt: new Date().toISOString() });
    renderPage();
    await openDetailModal();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm dismiss' }));

    await waitFor(() => expect(mockedApi.dismiss).toHaveBeenCalledWith('yz1', {}));
  });

  // I. Dismiss from IN_REVIEW
  it('dismisses an IN_REVIEW item', async () => {
    const claimed: YellowZoneItemDto = {
      ...baseItem,
      status: 'IN_REVIEW',
      assignedToUserId: CURRENT_USER_ID,
      assignedToUserName: 'Dee Ispatcher',
    };
    mockedApi.list.mockResolvedValue(listResponse([claimed]));
    mockedApi.dismiss.mockResolvedValue({ ...claimed, status: 'DISMISSED', resolvedAt: new Date().toISOString() });

    renderPage();
    await openDetailModal();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm dismiss' }));

    await waitFor(() => expect(mockedApi.dismiss).toHaveBeenCalledWith('yz1', {}));
  });
});

describe('YellowZonePage — terminal states', () => {
  // J. Terminal states avoid illegal actions
  it('shows no Claim/Resolve/Dismiss/Release actions for a RESOLVED item', async () => {
    const resolved: YellowZoneItemDto = {
      ...baseItem,
      status: 'RESOLVED',
      assignedToUserId: CURRENT_USER_ID,
      assignedToUserName: 'Dee Ispatcher',
      resolutionNotes: 'Handled manually.',
      resolvedAt: new Date().toISOString(),
    };
    mockedApi.list.mockResolvedValue(listResponse([resolved]));
    mockedApi.stats.mockResolvedValue({ PENDING: 0, IN_REVIEW: 0, RESOLVED: 1, DISMISSED: 0 });

    renderPage();
    await openDetailModal();
    expect(screen.queryByRole('button', { name: 'Claim' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resolve' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Release' })).not.toBeInTheDocument();
    // View in Assignments and Close remain available regardless of status.
    expect(screen.getByRole('button', { name: 'View in Assignments' })).toBeInTheDocument();
  });
});

describe('YellowZonePage — unclaim (release)', () => {
  it('shows Release only to the claimant, not to other dispatchers', async () => {
    const claimedBySomeoneElse: YellowZoneItemDto = {
      ...baseItem,
      status: 'IN_REVIEW',
      assignedToUserId: OTHER_USER_ID,
      assignedToUserName: 'Someone Else',
    };
    mockedApi.list.mockResolvedValue(listResponse([claimedBySomeoneElse]));
    mockedApi.stats.mockResolvedValue({ PENDING: 0, IN_REVIEW: 1, RESOLVED: 0, DISMISSED: 0 });

    renderPage();
    await openDetailModal();
    // Any authorized dispatcher can still Resolve/Dismiss it (shared
    // ownership — see the backend's own decision), just not Release it.
    expect(screen.getByRole('button', { name: 'Resolve' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Release' })).not.toBeInTheDocument();
  });

  it('releases a claimed item back to PENDING', async () => {
    const claimedByMe: YellowZoneItemDto = {
      ...baseItem,
      status: 'IN_REVIEW',
      assignedToUserId: CURRENT_USER_ID,
      assignedToUserName: 'Dee Ispatcher',
    };
    mockedApi.list.mockResolvedValue(listResponse([claimedByMe]));
    mockedApi.stats.mockResolvedValue({ PENDING: 0, IN_REVIEW: 1, RESOLVED: 0, DISMISSED: 0 });
    mockedApi.unclaim.mockResolvedValue({ ...baseItem, status: 'PENDING', assignedToUserId: null, assignedToUserName: null });

    renderPage();
    await openDetailModal();
    fireEvent.click(screen.getByRole('button', { name: 'Release' }));

    await waitFor(() => expect(mockedApi.unclaim).toHaveBeenCalledWith('yz1'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Claim' })).toBeInTheDocument());
  });
});

describe('YellowZonePage — assignment linkage hint', () => {
  it('shows an informative hint when the underlying assignment is already resolved elsewhere', async () => {
    const staleItem: YellowZoneItemDto = { ...baseItem, assignmentStatus: 'CONFIRMED' };
    mockedApi.list.mockResolvedValue(listResponse([staleItem]));

    renderPage();
    await openDetailModal();
    expect(
      await screen.findByText(/already/i, { selector: 'p' }),
    ).toHaveTextContent('The underlying assignment is already Confirmed — this item may just need dismissing.');
  });

  it('shows no hint when the assignment is still PENDING (the normal case)', async () => {
    renderPage();
    await openDetailModal();
    expect(screen.queryByText(/already/i)).not.toBeInTheDocument();
  });
});

describe('YellowZonePage — realtime-triggered refresh', () => {
  // P. Realtime update causes expected UI refresh. RealtimeProvider's own
  // job is just `queryClient.invalidateQueries({queryKey: ['yellow-zone']})`
  // on any yellow_zone.* socket event (see RealtimeProvider.tsx) — this
  // test exercises that exact mechanism directly (the query key
  // invalidation → refetch → re-render chain) rather than also standing up
  // a real socket connection, which is a separate concern already covered
  // by the backend's realtime.test.ts.
  it('re-renders with fresh data when the yellow-zone query is invalidated', async () => {
    const { queryClient } = renderPage();
    expect(await screen.findByText('Ahsan Raza')).toBeInTheDocument();

    const secondDriver: YellowZoneItemDto = { ...baseItem, id: 'yz2', driverName: 'Zara Khan' };
    mockedApi.list.mockResolvedValue(listResponse([baseItem, secondDriver]));

    await queryClient.invalidateQueries({ queryKey: ['yellow-zone'] });

    expect(await screen.findByText('Zara Khan')).toBeInTheDocument();
  });
});
