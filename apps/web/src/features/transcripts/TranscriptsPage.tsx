import type { ResolvedVoiceCallDto, TranscriptTurnDto } from '@kinvo/contracts';
import { useEffect, useState } from 'react';
import { ATTEMPT_OUTCOME_LABEL } from '../assignments/statusStyles';
import { CALL_STATUS_STYLE } from '../calls/statusStyles';
import { useCalls } from '../calls/useCalls';
import { formatDateTime } from '../../lib/format';

const PAGE_SIZE = 100;

function formatOffset(seconds: number | null): string | null {
  if (seconds === null) return null;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Phase E (Intelligence — Transcripts): real conversation content CALL-E's
// own API already returns on every completed call
// (`recipients[].attempts[].transcriptTurns`/`.summary` via
// CalleCalls.get(callId)) — see core/voice/outcomeTranslation.ts's
// extractTranscript. No dedicated API module here: this reuses
// calls/useCalls exactly like RecruitmentPage reuses ships/useShips —
// a transcript is a property of a resolved call, not a new domain
// entity, so a second parallel endpoint would just duplicate
// voice.service.ts's listCalls.
export function TranscriptsPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data, isLoading, isError } = useCalls({ pageSize: PAGE_SIZE });

  const withTranscripts = (data?.items ?? []).filter((call) => call.transcriptTurns.length > 0);
  const selected = withTranscripts.find((call) => call.id === selectedId) ?? withTranscripts[0] ?? null;

  useEffect(() => {
    if (selectedId && !withTranscripts.some((call) => call.id === selectedId)) {
      setSelectedId(null);
    }
    // Only re-check when the underlying list changes, not on every
    // selection — re-running per selectedId change would fight the
    // click handler that just set it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [withTranscripts]);

  if (isLoading) {
    return <TranscriptsSkeleton />;
  }

  if (isError) {
    return <p className="text-sm text-[var(--danger)]">Could not load transcripts.</p>;
  }

  if (withTranscripts.length === 0) {
    return (
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] py-10 text-center">
        <div className="mb-1 text-[length:var(--text-10)] font-semibold text-[var(--text-strong)]">
          No transcripts yet
        </div>
        <p className="text-xs text-[var(--text-muted)]">
          CALL-E stores a transcript for calls that reach a driver — none of the resolved calls so
          far have one.
        </p>
      </div>
    );
  }

  return (
    <div className="grid h-full animate-[tideIn_0.2s_ease] grid-cols-1 gap-3.5 md:grid-cols-[320px_minmax(0,1fr)]">
      <div className="flex flex-col gap-1.5 overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-2">
        {withTranscripts.map((call) => (
          <TranscriptListRow
            key={call.id}
            call={call}
            isSelected={selected?.id === call.id}
            onSelect={() => setSelectedId(call.id)}
          />
        ))}
      </div>
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-5">
        {selected && <TranscriptDetail call={selected} />}
      </div>
    </div>
  );
}

function TranscriptListRow({
  call,
  isSelected,
  onSelect,
}: {
  call: ResolvedVoiceCallDto;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const style = CALL_STATUS_STYLE[call.outcome];
  return (
    <button
      onClick={onSelect}
      className="rounded-xl px-3 py-2.5 text-left transition"
      style={{ background: isSelected ? 'var(--accent-tint)' : 'transparent' }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[length:var(--text-7)] font-semibold text-[var(--text-strong)]">
          {call.driverName}
        </span>
        <span
          className="flex-shrink-0 rounded-full px-2 py-0.5 text-[length:var(--text-1)] font-semibold"
          style={{ background: style.bg, color: style.color }}
        >
          {ATTEMPT_OUTCOME_LABEL[call.outcome]}
        </span>
      </div>
      <div className="mt-0.5 truncate text-[length:var(--text-4)] text-[var(--text-muted)]">
        {call.shipName} · {call.destination}
      </div>
    </button>
  );
}

function TranscriptDetail({ call }: { call: ResolvedVoiceCallDto }) {
  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[var(--surface-muted)] pb-3.5">
        <div>
          <h3 className="text-[length:var(--text-10)] font-bold text-[var(--text-strong)]">{call.driverName}</h3>
          <p className="mt-0.5 text-[length:var(--text-5)] text-[var(--text-muted)]">
            {call.shipName} · {call.destination} · {formatDateTime(call.attemptedAt)}
          </p>
        </div>
      </div>

      {call.transcriptSummary && (
        <p className="mt-3.5 rounded-xl bg-[var(--surface-card-alt)] p-3 text-[length:var(--text-6)] text-[var(--text-secondary)]">
          {call.transcriptSummary}
        </p>
      )}

      <div className="mt-3.5 flex flex-col gap-2.5">
        {call.transcriptTurns.map((turn, index) => (
          <TranscriptTurnRow key={index} turn={turn} />
        ))}
      </div>
    </div>
  );
}

function TranscriptTurnRow({ turn }: { turn: TranscriptTurnDto }) {
  const isBot = turn.speaker === 'bot';
  const offset = formatOffset(turn.offsetSeconds);
  return (
    <div className={`flex ${isBot ? 'justify-start' : 'justify-end'}`}>
      <div
        className="max-w-[80%] rounded-2xl px-3.5 py-2 text-[length:var(--text-6)]"
        style={{
          background: isBot ? 'var(--surface-card-alt)' : 'var(--accent-tint)',
          color: 'var(--text-strong)',
        }}
      >
        <div className="mb-0.5 flex items-center gap-1.5 text-[length:var(--text-1)] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          {turn.speaker === 'bot' ? 'CALL-E' : turn.speaker === 'user' ? 'Driver' : 'Unknown'}
          {offset && <span className="font-mono normal-case">{offset}</span>}
        </div>
        {turn.text}
      </div>
    </div>
  );
}

function TranscriptsSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3.5 md:grid-cols-[320px_minmax(0,1fr)]">
      <div className="animate-pulse rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="mb-1.5 h-12 rounded-xl bg-[var(--surface-muted-2)]" />
        ))}
      </div>
      <div className="animate-pulse rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-5">
        <div className="h-4 w-1/3 rounded bg-[var(--surface-muted-3)]" />
        <div className="mt-3 h-3 w-1/2 rounded bg-[var(--surface-muted-2)]" />
      </div>
    </div>
  );
}
