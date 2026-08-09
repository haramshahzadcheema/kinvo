import type { DriverAvailabilityValue } from '@kinvo/contracts';
import { useState } from 'react';
import { isApiError } from '../../lib/useAuth';
import { DriverDetailDrawer } from './DriverDetailDrawer';
import { AVAILABILITY_LABEL, AVAILABILITY_STYLE } from './statusStyles';
import { useDriverMutations, useDrivers, useDriverStats } from './useDrivers';

const AVAILABILITY_FILTERS: DriverAvailabilityValue[] = [
  'IDLE',
  'ON_CALL',
  'CONFIRMED',
  'ESCALATED',
];

export function DriversPage({ autoOpenCreate = false }: { autoOpenCreate?: boolean }) {
  const [search, setSearch] = useState('');
  const [availabilityFilter, setAvailabilityFilter] = useState<DriverAvailabilityValue | ''>('');
  const [truckTypeFilter, setTruckTypeFilter] = useState('');
  const [showAddDriver, setShowAddDriver] = useState(autoOpenCreate);
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, isError } = useDrivers({
    search: search || undefined,
    availability: availabilityFilter || undefined,
    truckType: truckTypeFilter || undefined,
    pageSize: 50,
  });
  const { counts: stats } = useDriverStats();
  const { createDriver } = useDriverMutations();

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [truckPlate, setTruckPlate] = useState('');
  const [truckType, setTruckType] = useState('');

  async function submitAddDriver() {
    setError(null);
    try {
      await createDriver.mutateAsync({
        fullName,
        phone,
        truckPlate: truckPlate || undefined,
        truckType: truckType || undefined,
      });
      setFullName('');
      setPhone('');
      setTruckPlate('');
      setTruckType('');
      setShowAddDriver(false);
    } catch (err) {
      setError(isApiError(err) ? err.message : 'Could not add this driver.');
    }
  }

  const hasFilters = Boolean(search || availabilityFilter || truckTypeFilter);

  return (
    <div className="animate-[tideIn_0.2s_ease]">
      <div className="mb-3.5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {AVAILABILITY_FILTERS.map((availability) => (
          <button
            key={availability}
            onClick={() =>
              setAvailabilityFilter((current) => (current === availability ? '' : availability))
            }
            className="rounded-2xl border px-3.5 py-3 text-left transition"
            style={{
              borderColor:
                availabilityFilter === availability
                  ? AVAILABILITY_STYLE[availability].color
                  : 'var(--border)',
              background:
                availabilityFilter === availability
                  ? AVAILABILITY_STYLE[availability].bg
                  : 'var(--surface-card)',
            }}
          >
            <div className="text-[length:var(--text-2)] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              {AVAILABILITY_LABEL[availability]}
            </div>
            <div
              className="mt-0.5 font-mono text-xl font-bold"
              style={{ color: AVAILABILITY_STYLE[availability].color }}
            >
              {stats[availability]}
            </div>
          </button>
        ))}
      </div>

      <div className="mb-3.5 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-col gap-2 sm:flex-row">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search driver, truck, or phone"
            className="w-full rounded-full border border-[var(--border)] bg-[var(--surface-card)] py-2.5 pl-4 pr-4 text-[length:var(--text-7)] text-[var(--text-strong)] outline-none sm:max-w-[280px]"
          />
          <input
            value={truckTypeFilter}
            onChange={(e) => setTruckTypeFilter(e.target.value)}
            placeholder="Filter by truck type"
            className="w-full rounded-full border border-[var(--border)] bg-[var(--surface-card)] py-2.5 pl-4 pr-4 text-[length:var(--text-7)] text-[var(--text-strong)] outline-none sm:max-w-[200px]"
          />
          {hasFilters && (
            <button
              onClick={() => {
                setSearch('');
                setAvailabilityFilter('');
                setTruckTypeFilter('');
              }}
              className="whitespace-nowrap rounded-full px-3 py-2.5 text-[length:var(--text-5)] font-semibold text-[var(--text-muted)] hover:text-[var(--text-strong)]"
            >
              Clear filters
            </button>
          )}
        </div>
        <button
          onClick={() => setShowAddDriver((v) => !v)}
          className="whitespace-nowrap rounded-full bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--accent-hover)]"
        >
          + Add Driver
        </button>
      </div>

      {showAddDriver && (
        <div className="mb-3.5 grid grid-cols-1 gap-2.5 rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-4.5 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1fr_auto] lg:items-end">
          <LabeledInput
            label="Name"
            value={fullName}
            onChange={setFullName}
            placeholder="Full name"
          />
          <LabeledInput label="Phone" value={phone} onChange={setPhone} placeholder="+92…" />
          <LabeledInput
            label="Truck"
            value={truckPlate}
            onChange={setTruckPlate}
            placeholder="TRK-…"
          />
          <LabeledInput
            label="Vehicle type"
            value={truckType}
            onChange={setTruckType}
            placeholder="Flatbed"
          />
          <button
            onClick={submitAddDriver}
            disabled={!fullName || !phone || createDriver.isPending}
            className="whitespace-nowrap rounded-lg bg-[#F2A65A] px-4 py-2 text-[length:var(--text-7)] font-semibold text-white disabled:opacity-50"
          >
            Save
          </button>
        </div>
      )}
      {error && <p className="mb-3 text-xs text-[var(--danger)]">{error}</p>}

      {isLoading && <DriverListSkeleton />}
      {isError && <p className="text-sm text-[var(--danger)]">Could not load drivers.</p>}

      {!isLoading && data && data.items.length === 0 && (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] py-10 text-center">
          <div className="mb-1 text-[length:var(--text-10)] font-semibold text-[var(--text-strong)]">
            {hasFilters ? 'No drivers match your filters' : 'No drivers yet'}
          </div>
          <p className="mb-4 text-xs text-[var(--text-muted)]">
            {hasFilters
              ? 'Try clearing the search or filters above.'
              : 'Add your first driver to start building your roster.'}
          </p>
          {!hasFilters && (
            <button
              onClick={() => setShowAddDriver(true)}
              className="rounded-full bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--accent-hover)]"
            >
              Add Driver
            </button>
          )}
        </div>
      )}

      {!isLoading && data && data.items.length > 0 && (
        <>
          {/* Desktop/tablet: table */}
          <div className="hidden overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] sm:block">
            <div className="grid grid-cols-[1.4fr_1fr_1fr_1fr_1fr] border-b border-[var(--border)] px-5.5 py-3.5 text-[length:var(--text-4)] font-semibold tracking-wide text-[var(--text-muted)]">
              <div>DRIVER</div>
              <div>TRUCK</div>
              <div>SHIP</div>
              <div>PHONE</div>
              <div>STATUS</div>
            </div>
            {data.items.map((driver) => {
              const style = AVAILABILITY_STYLE[driver.availability];
              return (
                <div
                  key={driver.id}
                  onClick={() => setSelectedDriverId(driver.id)}
                  className="grid cursor-pointer grid-cols-[1.4fr_1fr_1fr_1fr_1fr] items-center border-b border-[var(--surface-muted)] px-5.5 py-4 text-[length:var(--text-8)] hover:bg-[var(--surface-page-1)]"
                >
                  <div className="font-semibold text-[var(--text-strong)]">{driver.fullName}</div>
                  <div className="font-mono text-[var(--text-secondary)]">{driver.truckPlate ?? '—'}</div>
                  <div className="text-[var(--text-secondary)]">{driver.currentShipName ?? '—'}</div>
                  <div className="text-[var(--text-secondary)]">{driver.phone}</div>
                  <div>
                    <span
                      className="rounded-full px-2.5 py-1 text-[length:var(--text-4)] font-semibold"
                      style={{ background: style.bg, color: style.color }}
                    >
                      {AVAILABILITY_LABEL[driver.availability]}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Mobile: cards */}
          <div className="flex flex-col gap-2.5 sm:hidden">
            {data.items.map((driver) => {
              const style = AVAILABILITY_STYLE[driver.availability];
              return (
                <div
                  key={driver.id}
                  onClick={() => setSelectedDriverId(driver.id)}
                  className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-4"
                >
                  <div className="flex items-start justify-between">
                    <div className="font-semibold text-[var(--text-strong)]">{driver.fullName}</div>
                    <span
                      className="rounded-full px-2.5 py-1 text-[length:var(--text-4)] font-semibold"
                      style={{ background: style.bg, color: style.color }}
                    >
                      {AVAILABILITY_LABEL[driver.availability]}
                    </span>
                  </div>
                  <div className="mt-1.5 text-xs text-[var(--text-secondary)]">
                    {driver.truckPlate ?? '—'} · {driver.phone}
                  </div>
                  {driver.currentShipName && (
                    <div className="mt-1 text-xs text-[var(--text-muted)]">On {driver.currentShipName}</div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {selectedDriverId && (
        <DriverDetailDrawer driverId={selectedDriverId} onClose={() => setSelectedDriverId(null)} />
      )}
    </div>
  );
}

function DriverListSkeleton() {
  return (
    <div className="flex flex-col gap-2.5">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="animate-pulse rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-4">
          <div className="h-3 w-1/4 rounded bg-[var(--surface-muted-3)]" />
          <div className="mt-2 h-2.5 w-1/3 rounded bg-[var(--surface-muted-2)]" />
        </div>
      ))}
    </div>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div>
      <div className="mb-1.5 text-[length:var(--text-3)] text-[var(--text-muted)]">{label}</div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-[length:var(--text-7)] outline-none"
      />
    </div>
  );
}
