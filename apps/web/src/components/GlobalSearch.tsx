import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { driversApi } from '../features/drivers/api';
import { shipsApi } from '../features/ships/api';
import { SearchIcon } from './icons';

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 250;
const RESULT_LIMIT = 5;

type SearchTab = 'drivers' | 'ships';

// Real backend search over the same driversApi/shipsApi.list({ search })
// endpoints DriversPage/ShipsPage already use — not a mocked result list.
// Deliberately scoped to drivers + ships only for now: calls/issues aren't
// indexed by any endpoint yet, and this shouldn't grow ahead of what's
// actually searchable (see docs/ARCHITECTURE.md's Settings section for the
// same "don't build a control that does nothing" principle applied here).
export function GlobalSearch({ onNavigate }: { onNavigate: (tab: SearchTab) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => setDebounced(query.trim()), DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [open, query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setDebounced('');
      const id = window.setTimeout(() => inputRef.current?.focus(), 30);
      return () => window.clearTimeout(id);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const searchActive = debounced.length >= MIN_QUERY_LENGTH;

  const { data: driverResults, isFetching: driversFetching } = useQuery({
    queryKey: ['global-search', 'drivers', debounced],
    queryFn: () => driversApi.list({ search: debounced, pageSize: RESULT_LIMIT }),
    enabled: searchActive,
  });
  const { data: shipResults, isFetching: shipsFetching } = useQuery({
    queryKey: ['global-search', 'ships', debounced],
    queryFn: () => shipsApi.list({ search: debounced, pageSize: RESULT_LIMIT }),
    enabled: searchActive,
  });

  const isFetching = driversFetching || shipsFetching;
  const drivers = driverResults?.items ?? [];
  const ships = shipResults?.items ?? [];
  const noResults = searchActive && !isFetching && drivers.length === 0 && ships.length === 0;

  function go(tab: SearchTab) {
    setOpen(false);
    onNavigate(tab);
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Search"
        className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-[var(--surface-neutral-chip)] text-[var(--text-secondary)] hover:bg-[var(--surface-card-alt)]"
      >
        <SearchIcon />
      </button>

      {open && (
        <div
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-30 flex items-start justify-center bg-[var(--surface-overlay)] px-4 pt-24 animate-[tideIn_0.15s_ease]"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[70vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-[var(--surface-card)] shadow-2xl"
          >
            <div className="flex items-center gap-2.5 border-b border-[var(--border)] px-4 py-3">
              <SearchIcon className="flex-shrink-0 text-[var(--text-muted)]" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search drivers or ships…"
                className="flex-1 border-none bg-transparent text-[length:var(--text-8)] text-[var(--text-strong)] outline-none"
              />
            </div>
            <div className="overflow-y-auto p-1.5">
              {!searchActive && (
                <div className="px-3 py-8 text-center text-[length:var(--text-6)] text-[var(--text-muted)]">
                  Type at least {MIN_QUERY_LENGTH} characters to search.
                </div>
              )}
              {searchActive && isFetching && (
                <div className="px-3 py-8 text-center text-[length:var(--text-6)] text-[var(--text-muted)]">
                  Searching…
                </div>
              )}
              {noResults && (
                <div className="px-3 py-8 text-center text-[length:var(--text-6)] text-[var(--text-muted)]">
                  No matches for &quot;{debounced}&quot;.
                </div>
              )}
              {searchActive &&
                !isFetching &&
                drivers.map((driver) => (
                  <button
                    key={driver.id}
                    onClick={() => go('drivers')}
                    className="flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left hover:bg-[var(--surface-page-1)]"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[length:var(--text-7)] font-semibold text-[var(--text-strong)]">
                        {driver.fullName}
                      </span>
                      <span className="block truncate text-[length:var(--text-4)] text-[var(--text-muted)]">
                        {driver.truckPlate ?? '—'} · {driver.phone}
                      </span>
                    </span>
                    <span className="flex-shrink-0 font-mono text-[length:var(--text-2)] uppercase tracking-wide text-[var(--text-muted)]">
                      Driver
                    </span>
                  </button>
                ))}
              {searchActive &&
                !isFetching &&
                ships.map((ship) => (
                  <button
                    key={ship.id}
                    onClick={() => go('ships')}
                    className="flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left hover:bg-[var(--surface-page-1)]"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[length:var(--text-7)] font-semibold text-[var(--text-strong)]">
                        {ship.shipName}
                      </span>
                      <span className="block truncate text-[length:var(--text-4)] text-[var(--text-muted)]">
                        {ship.company ?? '—'}
                        {ship.berth ? ` · Berth ${ship.berth}` : ''}
                      </span>
                    </span>
                    <span className="flex-shrink-0 font-mono text-[length:var(--text-2)] uppercase tracking-wide text-[var(--text-muted)]">
                      Ship
                    </span>
                  </button>
                ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
