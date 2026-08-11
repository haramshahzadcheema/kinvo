import type { ResolvedVoiceCallDto, VoiceCallListResponse } from '@kinvo/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { voiceCallsApi } from '../calls/api';
import { TranscriptsPage } from './TranscriptsPage';

// TranscriptsPage has no API module of its own — it reuses calls/useCalls,
// which calls through voiceCallsApi.* (same reasoning as RecruitmentPage's
// own test file: mock exactly the one boundary that exists).
vi.mock('../calls/api', () => ({
  voiceCallsApi: { list: vi.fn(), listActive: vi.fn() },
}));

const mockedVoiceCallsApi = vi.mocked(voiceCallsApi);

const callWithTranscript: ResolvedVoiceCallDto = {
  id: 'att1',
  assignmentId: 'a1',
  driverId: 'd1',
  driverName: 'Ahsan Raza',
  driverPhone: '+92 300 1234567',
  shipId: 's1',
  shipName: 'MSC Aurora',
  destination: 'Salalah, Oman',
  truckType: 'Flatbed',
  provider: 'call-e',
  externalCallId: 'call-1',
  outcome: 'CONFIRMED',
  notes: null,
  attemptedAt: new Date('2026-08-11T10:18:00Z').toISOString(),
  transcriptSummary: 'Driver confirmed the job.',
  transcriptTurns: [
    { speaker: 'bot', text: 'Can you take this job?', offsetSeconds: 0 },
    { speaker: 'user', text: 'Yes, I can.', offsetSeconds: 3.5 },
  ],
};

const callWithoutTranscript: ResolvedVoiceCallDto = {
  ...callWithTranscript,
  id: 'att2',
  driverName: 'Bilal Khan',
  transcriptSummary: null,
  transcriptTurns: [],
};

function callList(items: ResolvedVoiceCallDto[]): VoiceCallListResponse {
  return { items, page: 1, pageSize: 100, total: items.length, totalPages: 1 };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <TranscriptsPage />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.resetAllMocks();
});

describe('TranscriptsPage', () => {
  it('lists only calls that have a transcript — a resolved call with none is excluded', async () => {
    mockedVoiceCallsApi.list.mockResolvedValue(callList([callWithTranscript, callWithoutTranscript]));
    renderPage();

    // "Ahsan Raza" legitimately appears twice once selected — the list row
    // and the detail pane heading — so this asserts presence via
    // findAllByText rather than the single-match findByText.
    expect((await screen.findAllByText('Ahsan Raza')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Bilal Khan')).not.toBeInTheDocument();
  });

  it('shows an honest empty state when no resolved call has a transcript', async () => {
    mockedVoiceCallsApi.list.mockResolvedValue(callList([callWithoutTranscript]));
    renderPage();

    expect(await screen.findByText('No transcripts yet')).toBeInTheDocument();
  });

  it('selects the first transcript by default and shows its summary and turns', async () => {
    mockedVoiceCallsApi.list.mockResolvedValue(callList([callWithTranscript]));
    renderPage();

    expect(await screen.findByText('Driver confirmed the job.')).toBeInTheDocument();
    expect(screen.getByText('Can you take this job?')).toBeInTheDocument();
    expect(screen.getByText('Yes, I can.')).toBeInTheDocument();
  });

  it('formats a turn offset as m:ss', async () => {
    mockedVoiceCallsApi.list.mockResolvedValue(callList([callWithTranscript]));
    renderPage();

    expect(await screen.findByText('0:03')).toBeInTheDocument();
  });

  it('switching the selected call in the list swaps the detail pane', async () => {
    const second: ResolvedVoiceCallDto = {
      ...callWithTranscript,
      id: 'att3',
      driverName: 'Zara Ahmed',
      transcriptSummary: 'Driver declined.',
      transcriptTurns: [{ speaker: 'user', text: 'No, sorry.', offsetSeconds: 1 }],
    };
    mockedVoiceCallsApi.list.mockResolvedValue(callList([callWithTranscript, second]));
    renderPage();

    await screen.findByText('Driver confirmed the job.');
    fireEvent.click(screen.getByText('Zara Ahmed'));
    expect(await screen.findByText('Driver declined.')).toBeInTheDocument();
    expect(screen.queryByText('Driver confirmed the job.')).not.toBeInTheDocument();
  });
});
