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
            className="rounded-xl border px-3.5 py-2.5 text-left transition"
            style={{
              borderColor:
                availabilityFilter === availability
                  ? AVAILABILITY_STYLE[availability].color
                  : '#ECE1CC',
              background:
                availabilityFilter === availability
                  ? AVAILABILITY_STYLE[availability].bg
                  : '#FFFFFF',
            }}
          >
            <div className="text-[10px] font-semibold uppercase tracking-wide text-[#8B9AA3]">
              {AVAILABILITY_LABEL[availability]}
            </div>
            <div
              className="mt-0.5 text-lg font-bold"
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
            className="w-full rounded-full border border-[#ECE1CC] bg-white py-2.5 pl-4 pr-4 text-[12.5px] text-[#0F2A38] outline-none sm:max-w-[280px]"
          />
          <input
            value={truckTypeFilter}
            onChange={(e) => setTruckTypeFilter(e.target.value)}
            placeholder="Filter by truck type"
            className="w-full rounded-full border border-[#ECE1CC] bg-white py-2.5 pl-4 pr-4 text-[12.5px] text-[#0F2A38] outline-none sm:max-w-[200px]"
          />
          {hasFilters && (
            <button
              onClick={() => {
                setSearch('');
                setAvailabilityFilter('');
                setTruckTypeFilter('');
              }}
              className="whitespace-nowrap rounded-full px-3 py-2.5 text-[11.5px] font-semibold text-[#8B9AA3] hover:text-[#0F2A38]"
            >
              Clear filters
            </button>
          )}
        </div>
        <button
          onClick={() => setShowAddDriver((v) => !v)}
          className="whitespace-nowrap rounded-full bg-[#1E7A8C] px-4 py-2 text-xs font-semibold text-white hover:bg-[#175F6E]"
        >
          + Add Driver
        </button>
      </div>

      {showAddDriver && (
        <div className="mb-3.5 grid grid-cols-1 gap-2.5 rounded-2xl border border-[#ECE1CC] bg-white p-4.5 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1fr_auto] lg:items-end">
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
            className="whitespace-nowrap rounded-lg bg-[#F2A65A] px-4 py-2 text-[12.5px] font-semibold text-white disabled:opacity-50"
          >
            Save
          </button>
        </div>
      )}
      {error && <p className="mb-3 text-xs text-[#C1503B]">{error}</p>}

      {isLoading && <DriverListSkeleton />}
      {isError && <p className="text-sm text-[#C1503B]">Could not load drivers.</p>}

      {!isLoading && data && data.items.length === 0 && (
        <div className="rounded-2xl border border-[#ECE1CC] bg-white py-10 text-center">
          <div className="mb-1 text-[15px] font-semibold text-[#0F2A38]">
            {hasFilters ? 'No drivers match your filters' : 'No drivers yet'}
          </div>
          <p className="mb-4 text-xs text-[#8B9AA3]">
            {hasFilters
              ? 'Try clearing the search or filters above.'
              : 'Add your first driver to start building your roster.'}
          </p>
          {!hasFilters && (
            <button
              onClick={() => setShowAddDriver(true)}
              className="rounded-full bg-[#1E7A8C] px-4 py-2 text-xs font-semibold text-white hover:bg-[#175F6E]"
            >
              Add Driver
            </button>
          )}
        </div>
      )}

      {!isLoading && data && data.items.length > 0 && (
        <>
          {/* Desktop/tablet: table */}
          <div className="hidden overflow-hidden rounded-2xl border border-[#ECE1CC] bg-white sm:block">
            <div className="grid grid-cols-[1.4fr_1fr_1fr_1fr_1fr] border-b border-[#ECE1CC] px-5.5 py-3.5 text-[11px] font-semibold tracking-wide text-[#8B9AA3]">
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
                  className="grid cursor-pointer grid-cols-[1.4fr_1fr_1fr_1fr_1fr] items-center border-b border-[#F5EEE0] px-5.5 py-4 text-[13px] hover:bg-[#FBF6EE]"
                >
                  <div className="font-semibold text-[#0F2A38]">{driver.fullName}</div>
                  <div className="font-mono text-[#5C6B75]">{driver.truckPlate ?? '—'}</div>
                  <div className="text-[#5C6B75]">{driver.currentShipName ?? '—'}</div>
                  <div className="text-[#5C6B75]">{driver.phone}</div>
                  <div>
                    <span
                      className="rounded-full px-2.5 py-1 text-[11px] font-semibold"
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
                  className="rounded-xl border border-[#ECE1CC] bg-white p-4"
                >
                  <div className="flex items-start justify-between">
                    <div className="font-semibold text-[#0F2A38]">{driver.fullName}</div>
                    <span
                      className="rounded-full px-2.5 py-1 text-[11px] font-semibold"
                      style={{ background: style.bg, color: style.color }}
                    >
                      {AVAILABILITY_LABEL[driver.availability]}
                    </span>
                  </div>
                  <div className="mt-1.5 text-xs text-[#5C6B75]">
                    {driver.truckPlate ?? '—'} · {driver.phone}
                  </div>
                  {driver.currentShipName && (
                    <div className="mt-1 text-xs text-[#8B9AA3]">On {driver.currentShipName}</div>
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
        <div key={i} className="animate-pulse rounded-xl border border-[#ECE1CC] bg-white p-4">
          <div className="h-3 w-1/4 rounded bg-[#F0EADC]" />
          <div className="mt-2 h-2.5 w-1/3 rounded bg-[#F5F0E6]" />
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
      <div className="mb-1.5 text-[10.5px] text-[#8B9AA3]">{label}</div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-[#ECE1CC] px-3 py-2 text-[12.5px] outline-none"
      />
    </div>
  );
}
