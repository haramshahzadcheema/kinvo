import type { ShipStatusValue, TruckRequirementInput } from '@kinvo/contracts';
import { useState, type ReactNode } from 'react';
import { formatDateTime, isWithinHours } from '../../lib/format';
import { isApiError } from '../../lib/useAuth';
import { ShipDetailDrawer } from './ShipDetailDrawer';
import { SHIP_STATUS_LABEL, SHIP_STATUS_STYLE } from './statusStyles';
import { useShipMutations, useShips, useShipStats } from './useShips';

const STAT_STATUSES: { status: ShipStatusValue; label: string; tone: string }[] = [
  { status: 'RECRUITING', label: 'Recruiting', tone: '#B4762A' },
  { status: 'CONFIRMED', label: 'Confirmed', tone: '#1E7A8C' },
  { status: 'IN_PROGRESS', label: 'In Progress', tone: '#2A5DA6' },
  { status: 'COMPLETED', label: 'Completed', tone: '#3D8A4E' },
];

const DEFAULT_SORT = {
  value: 'eta-asc',
  label: 'ETA — soonest first',
  sortBy: 'eta' as const,
  sortOrder: 'asc' as const,
};

const SORT_OPTIONS: {
  value: string;
  label: string;
  sortBy: 'eta' | 'shipName' | 'status' | 'createdAt';
  sortOrder: 'asc' | 'desc';
}[] = [
  DEFAULT_SORT,
  { value: 'createdAt-desc', label: 'Newest first', sortBy: 'createdAt', sortOrder: 'desc' },
  { value: 'shipName-asc', label: 'Ship name (A–Z)', sortBy: 'shipName', sortOrder: 'asc' },
  { value: 'status-asc', label: 'Status', sortBy: 'status', sortOrder: 'asc' },
];

interface DestinationCard extends TruckRequirementInput {
  key: string;
}

function emptyCard(): DestinationCard {
  return {
    key: crypto.randomUUID(),
    destination: '',
    truckType: '',
    quantityNeeded: 1,
    rate: undefined,
    rateCurrency: undefined,
    notes: undefined,
  };
}

export function ShipsPage({ autoOpenCreate = false }: { autoOpenCreate?: boolean }) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<ShipStatusValue | ''>('');
  const [sortValue, setSortValue] = useState(DEFAULT_SORT.value);
  const [showAddShip, setShowAddShip] = useState(autoOpenCreate);
  const [selectedShipId, setSelectedShipId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeSort = SORT_OPTIONS.find((o) => o.value === sortValue) ?? DEFAULT_SORT;
  const { data, isLoading, isError } = useShips({
    search: search || undefined,
    status: statusFilter || undefined,
    sortBy: activeSort.sortBy,
    sortOrder: activeSort.sortOrder,
    pageSize: 50,
  });
  const { counts: stats } = useShipStats();
  const { createShip } = useShipMutations();

  const [shipName, setShipName] = useState('');
  const [company, setCompany] = useState('');
  const [berth, setBerth] = useState('');
  const [gate, setGate] = useState('');
  const [cargoType, setCargoType] = useState('');
  const [eta, setEta] = useState('');
  const [reportingTime, setReportingTime] = useState('');
  const [notes, setNotes] = useState('');
  const [destinations, setDestinations] = useState<DestinationCard[]>([emptyCard()]);

  function resetForm() {
    setShipName('');
    setCompany('');
    setBerth('');
    setGate('');
    setCargoType('');
    setEta('');
    setReportingTime('');
    setNotes('');
    setDestinations([emptyCard()]);
  }

  function updateDestination(idx: number, patch: Partial<DestinationCard>) {
    setDestinations((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  async function submitAddShip() {
    setError(null);
    try {
      await createShip.mutateAsync({
        shipName,
        company: company || undefined,
        berth: berth || undefined,
        gate: gate || undefined,
        cargoType: cargoType || undefined,
        eta: eta ? new Date(eta).toISOString() : undefined,
        reportingTime: reportingTime ? new Date(reportingTime).toISOString() : undefined,
        notes: notes || undefined,
        truckRequirements: destinations
          .filter((d) => d.destination && d.truckType && d.quantityNeeded > 0)
          .map(({ destination, truckType, quantityNeeded, rate, notes }) => ({
            destination,
            truckType,
            quantityNeeded,
            rate,
            rateCurrency: rate ? 'PKR' : undefined,
            notes: notes || undefined,
          })),
      });
      resetForm();
      setShowAddShip(false);
    } catch (err) {
      setError(isApiError(err) ? err.message : 'Could not create the ship.');
    }
  }

  const hasFilters = Boolean(search || statusFilter);

  return (
    <div className="animate-[tideIn_0.2s_ease]">
      <div className="mb-3.5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {STAT_STATUSES.map((item) => (
          <button
            key={item.status}
            onClick={() =>
              setStatusFilter((current) => (current === item.status ? '' : item.status))
            }
            className="rounded-xl border px-3.5 py-2.5 text-left transition"
            style={{
              borderColor: statusFilter === item.status ? item.tone : '#ECE1CC',
              background:
                statusFilter === item.status ? SHIP_STATUS_STYLE[item.status].bg : '#FFFFFF',
            }}
          >
            <div className="text-[10px] font-semibold uppercase tracking-wide text-[#8B9AA3]">
              {item.label}
            </div>
            <div className="mt-0.5 text-lg font-bold" style={{ color: item.tone }}>
              {stats[item.status]}
            </div>
          </button>
        ))}
      </div>

      <div className="mb-3.5 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-col gap-2 sm:flex-row">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search ship, company, or destination"
            className="w-full rounded-full border border-[#ECE1CC] bg-white py-2.5 pl-4 pr-4 text-[12.5px] text-[#0F2A38] outline-none sm:max-w-[280px]"
          />
          <select
            value={sortValue}
            onChange={(e) => setSortValue(e.target.value)}
            className="w-full rounded-full border border-[#ECE1CC] bg-white py-2.5 pl-4 pr-4 text-[12.5px] text-[#0F2A38] outline-none sm:w-auto"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {hasFilters && (
            <button
              onClick={() => {
                setSearch('');
                setStatusFilter('');
              }}
              className="whitespace-nowrap rounded-full px-3 py-2.5 text-[11.5px] font-semibold text-[#8B9AA3] hover:text-[#0F2A38]"
            >
              Clear filters
            </button>
          )}
        </div>
        <button
          onClick={() => setShowAddShip((v) => !v)}
          className="whitespace-nowrap rounded-full bg-[#1E7A8C] px-4 py-2 text-xs font-semibold text-white hover:bg-[#175F6E] sm:w-auto"
        >
          + Add Ship
        </button>
      </div>

      {showAddShip && (
        <div className="mb-3.5 rounded-2xl border border-[#ECE1CC] bg-white p-5">
          <SectionLabel>Ship information</SectionLabel>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <LabeledInput
              label="Ship name"
              value={shipName}
              onChange={setShipName}
              placeholder="e.g. Ever Given"
            />
            <LabeledInput
              label="Shipping company"
              value={company}
              onChange={setCompany}
              placeholder="Shipping line"
            />
            <LabeledInput
              label="Cargo"
              value={cargoType}
              onChange={setCargoType}
              placeholder="e.g. Containers"
            />
            <LabeledInput label="Berth" value={berth} onChange={setBerth} placeholder="e.g. 5" />
            <LabeledInput label="Gate" value={gate} onChange={setGate} placeholder="e.g. Gate 2" />
            <LabeledInput label="ETA" value={eta} onChange={setEta} type="datetime-local" />
            <LabeledInput
              label="Reporting time"
              value={reportingTime}
              onChange={setReportingTime}
              type="datetime-local"
            />
          </div>
          <div className="mt-3">
            <div className="mb-1.5 text-[10.5px] text-[#8B9AA3]">Notes</div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="General remarks about this ship (optional)"
              className="w-full rounded-lg border border-[#ECE1CC] px-3 py-2 text-[12.5px] outline-none"
            />
          </div>

          <div className="mt-5">
            <SectionLabel>Destinations</SectionLabel>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {destinations.map((row, idx) => (
                <div
                  key={row.key}
                  className="rounded-xl border border-[#F5EEE0] bg-[#FBF6EE] p-3.5"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[10.5px] font-semibold uppercase tracking-wide text-[#8B9AA3]">
                      Destination {idx + 1}
                    </span>
                    {destinations.length > 1 && (
                      <button
                        onClick={() => setDestinations((rows) => rows.filter((_, i) => i !== idx))}
                        className="text-sm text-[#C1503B]"
                        aria-label="Remove destination"
                      >
                        ×
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      value={row.destination}
                      onChange={(e) => updateDestination(idx, { destination: e.target.value })}
                      placeholder="e.g. Salalah, Oman"
                      className="col-span-2 rounded-lg border border-[#ECE1CC] px-3 py-2 text-[12.5px] outline-none"
                    />
                    <input
                      value={row.truckType}
                      onChange={(e) => updateDestination(idx, { truckType: e.target.value })}
                      placeholder="Truck type"
                      className="rounded-lg border border-[#ECE1CC] px-3 py-2 text-[12.5px] outline-none"
                    />
                    <input
                      value={row.quantityNeeded}
                      type="number"
                      min={1}
                      onChange={(e) =>
                        updateDestination(idx, { quantityNeeded: Number(e.target.value) })
                      }
                      placeholder="Trucks"
                      className="rounded-lg border border-[#ECE1CC] px-3 py-2 text-[12.5px] outline-none"
                    />
                    <input
                      value={row.rate ?? ''}
                      type="number"
                      min={0}
                      step="0.01"
                      onChange={(e) =>
                        updateDestination(idx, {
                          rate: e.target.value ? Number(e.target.value) : undefined,
                        })
                      }
                      placeholder="Rate (PKR)"
                      className="rounded-lg border border-[#ECE1CC] px-3 py-2 text-[12.5px] outline-none"
                    />
                    <input
                      value={row.notes ?? ''}
                      onChange={(e) => updateDestination(idx, { notes: e.target.value })}
                      placeholder="Notes (optional)"
                      className="rounded-lg border border-[#ECE1CC] px-3 py-2 text-[12.5px] outline-none"
                    />
                  </div>
                </div>
              ))}
            </div>
            <button
              onClick={() => setDestinations((rows) => [...rows, emptyCard()])}
              className="mt-2.5 rounded-full border border-[#ECE1CC] bg-white px-3.5 py-1.5 text-[11.5px] font-semibold text-[#1E7A8C]"
            >
              + Add destination
            </button>
          </div>

          {error && <p className="mt-3 text-xs text-[#C1503B]">{error}</p>}

          <button
            onClick={submitAddShip}
            disabled={!shipName || createShip.isPending}
            className="mt-4 w-full rounded-full bg-[#F2A65A] px-4.5 py-2 text-[12.5px] font-semibold text-white disabled:opacity-50 sm:w-auto"
          >
            {createShip.isPending ? 'Creating…' : 'Create Ship Operation'}
          </button>
        </div>
      )}

      {isLoading && <ShipListSkeleton />}
      {isError && <p className="text-sm text-[#C1503B]">Could not load ships.</p>}
      {!isLoading && data && data.items.length === 0 && (
        <div className="rounded-2xl border border-[#ECE1CC] bg-white py-10 text-center">
          <div className="mb-1 text-[15px] font-semibold text-[#0F2A38]">
            {hasFilters ? 'No ships match your filters' : 'No ships yet'}
          </div>
          <p className="mb-4 text-xs text-[#8B9AA3]">
            {hasFilters
              ? 'Try clearing the search or status filter above.'
              : 'Create your first ship operation to start tracking truck requirements.'}
          </p>
          {!hasFilters && (
            <button
              onClick={() => setShowAddShip(true)}
              className="rounded-full bg-[#1E7A8C] px-4 py-2 text-xs font-semibold text-white hover:bg-[#175F6E]"
            >
              Create Ship
            </button>
          )}
        </div>
      )}

      {!isLoading && data && data.items.length > 0 && (
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {data.items.map((ship) => {
            const style = SHIP_STATUS_STYLE[ship.status];
            const needed = ship.truckRequirements.reduce((sum, r) => sum + r.quantityNeeded, 0);
            const isActive = ship.status !== 'COMPLETED' && ship.status !== 'CANCELLED';
            const arrivingSoon = isActive && isWithinHours(ship.eta, 48);
            const etaLabel = formatDateTime(ship.eta);
            return (
              <div
                key={ship.id}
                onClick={() => setSelectedShipId(ship.id)}
                className="cursor-pointer rounded-2xl border bg-white p-5 transition hover:-translate-y-0.5 hover:shadow-lg"
                style={{ borderColor: arrivingSoon ? '#F2A65A' : '#ECE1CC' }}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-[15px] font-bold text-[#0F2A38]">{ship.shipName}</div>
                    <div className="mt-0.5 text-xs text-[#8B9AA3]">
                      {ship.berth ? `Berth ${ship.berth} · ` : ''}
                      {ship.truckRequirements.length} destination
                      {ship.truckRequirements.length === 1 ? '' : 's'}
                    </div>
                  </div>
                  <span
                    className="whitespace-nowrap rounded-full px-2.5 py-1 text-[10.5px] font-semibold"
                    style={{ background: style.bg, color: style.color }}
                  >
                    {SHIP_STATUS_LABEL[ship.status]}
                  </span>
                </div>
                <div className="mt-3.5 flex items-center justify-between text-xs text-[#8B9AA3]">
                  <span>
                    {etaLabel ? (
                      <>
                        ETA <span className="font-semibold text-[#0F2A38]">{etaLabel}</span>
                      </>
                    ) : (
                      'No ETA set'
                    )}
                  </span>
                  {arrivingSoon && (
                    <span className="rounded-full bg-[#FDEFD9] px-2 py-0.5 text-[10px] font-semibold text-[#B4762A]">
                      Arriving soon
                    </span>
                  )}
                </div>
                {needed > 0 && (
                  <div className="mt-2 text-xs text-[#8B9AA3]">
                    <span className="font-mono">{needed}</span> trucks needed
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {selectedShipId && (
        <ShipDetailDrawer shipId={selectedShipId} onClose={() => setSelectedShipId(null)} />
      )}
    </div>
  );
}

function ShipListSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="animate-pulse rounded-2xl border border-[#ECE1CC] bg-white p-5">
          <div className="h-3.5 w-2/3 rounded bg-[#F0EADC]" />
          <div className="mt-2.5 h-2.5 w-1/2 rounded bg-[#F5F0E6]" />
          <div className="mt-5 h-2.5 w-1/3 rounded bg-[#F5F0E6]" />
        </div>
      ))}
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="mb-2.5 text-[10.5px] font-semibold uppercase tracking-wide text-[#8B9AA3]">
      {children}
    </div>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div>
      <div className="mb-1.5 text-[10.5px] text-[#8B9AA3]">{label}</div>
      <input
        value={value}
        type={type}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-[#ECE1CC] px-3 py-2 text-[12.5px] outline-none"
      />
    </div>
  );
}
