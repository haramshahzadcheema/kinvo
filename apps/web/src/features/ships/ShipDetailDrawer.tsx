import type { UpdateShipRequest } from '@kinvo/contracts';
import { useState } from 'react';
import { TruckRequirementDrivers } from '../assignments/TruckRequirementDrivers';
import { formatDateTime, formatRate } from '../../lib/format';
import { isApiError } from '../../lib/useAuth';
import { SHIP_NEXT_STATUSES, SHIP_STATUS_LABEL, SHIP_STATUS_STYLE } from './statusStyles';
import { useShip, useShipMutations } from './useShips';

function toDatetimeLocal(iso: string | null): string {
  if (!iso) return '';
  return iso.slice(0, 16);
}

export function ShipDetailDrawer({ shipId, onClose }: { shipId: string; onClose: () => void }) {
  const { data: ship, isLoading } = useShip(shipId);
  const {
    updateShip,
    updateShipStatus,
    deleteShip,
    addTruckRequirement,
    removeTruckRequirement,
    addDocumentRequirement,
    removeDocumentRequirement,
  } = useShipMutations();
  const [error, setError] = useState<string | null>(null);
  const [showAddDestination, setShowAddDestination] = useState(false);
  const [showAddDocument, setShowAddDocument] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<{
    shipName: string;
    company: string;
    cargoType: string;
    berth: string;
    gate: string;
    eta: string;
    reportingTime: string;
    notes: string;
  } | null>(null);

  const [newDestination, setNewDestination] = useState('');
  const [newTruckType, setNewTruckType] = useState('');
  const [newQuantity, setNewQuantity] = useState('1');
  const [newRate, setNewRate] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [newDocumentType, setNewDocumentType] = useState('');

  function startEditing() {
    if (!ship) return;
    setEditForm({
      shipName: ship.shipName,
      company: ship.company ?? '',
      cargoType: ship.cargoType ?? '',
      berth: ship.berth ?? '',
      gate: ship.gate ?? '',
      eta: toDatetimeLocal(ship.eta),
      reportingTime: toDatetimeLocal(ship.reportingTime),
      notes: ship.notes ?? '',
    });
    setEditing(true);
  }

  async function handleSaveEdit() {
    if (!editForm) return;
    setError(null);
    try {
      const payload: UpdateShipRequest = {
        shipName: editForm.shipName,
        company: editForm.company.trim() ? editForm.company.trim() : null,
        cargoType: editForm.cargoType.trim() ? editForm.cargoType.trim() : null,
        berth: editForm.berth.trim() ? editForm.berth.trim() : null,
        gate: editForm.gate.trim() ? editForm.gate.trim() : null,
        eta: editForm.eta ? new Date(editForm.eta).toISOString() : null,
        reportingTime: editForm.reportingTime
          ? new Date(editForm.reportingTime).toISOString()
          : null,
        notes: editForm.notes.trim() ? editForm.notes.trim() : null,
      };
      await updateShip.mutateAsync({ shipId, input: payload });
      setEditing(false);
      setEditForm(null);
    } catch (err) {
      setError(isApiError(err) ? err.message : 'Could not save changes.');
    }
  }

  async function handleStatusChange(status: string) {
    setError(null);
    try {
      await updateShipStatus.mutateAsync({ shipId, status: status as never });
    } catch (err) {
      setError(isApiError(err) ? err.message : 'Could not change status.');
    }
  }

  async function handleDelete() {
    setError(null);
    try {
      await deleteShip.mutateAsync(shipId);
      onClose();
    } catch (err) {
      setError(isApiError(err) ? err.message : 'Could not delete this ship.');
    }
  }

  async function handleAddTruckRequirement() {
    if (!newDestination || !newTruckType) return;
    setError(null);
    try {
      await addTruckRequirement.mutateAsync({
        shipId,
        input: {
          destination: newDestination,
          truckType: newTruckType,
          quantityNeeded: Number(newQuantity) || 1,
          rate: newRate ? Number(newRate) : undefined,
          rateCurrency: newRate ? 'PKR' : undefined,
          notes: newNotes || undefined,
        },
      });
      setNewDestination('');
      setNewTruckType('');
      setNewQuantity('1');
      setNewRate('');
      setNewNotes('');
      setShowAddDestination(false);
    } catch (err) {
      setError(isApiError(err) ? err.message : 'Could not add the truck requirement.');
    }
  }

  async function handleAddDocumentRequirement() {
    if (!newDocumentType) return;
    setError(null);
    try {
      await addDocumentRequirement.mutateAsync({
        shipId,
        input: { documentType: newDocumentType, isRequired: true },
      });
      setNewDocumentType('');
      setShowAddDocument(false);
    } catch (err) {
      setError(isApiError(err) ? err.message : 'Could not add the document requirement.');
    }
  }

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-20 flex items-center justify-center bg-[var(--surface-overlay)] sm:p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="h-full w-full overflow-y-auto bg-[var(--surface-card)] p-6 sm:h-auto sm:max-h-[88vh] sm:w-[600px] sm:rounded-2xl sm:p-7"
      >
        {isLoading && <DrawerSkeleton />}

        {ship && !editing && (
          <>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-bold text-[var(--text-strong)]">{ship.shipName}</div>
                <div className="mt-0.5 text-xs text-[var(--text-muted)]">
                  {ship.company ?? 'No company set'}
                </div>
              </div>
              <div className="flex flex-shrink-0 items-center gap-2">
                <span
                  className="whitespace-nowrap rounded-full px-2.5 py-1 text-[length:var(--text-4)] font-semibold"
                  style={{
                    background: SHIP_STATUS_STYLE[ship.status].bg,
                    color: SHIP_STATUS_STYLE[ship.status].color,
                  }}
                >
                  {SHIP_STATUS_LABEL[ship.status]}
                </span>
                <button
                  onClick={startEditing}
                  className="text-[length:var(--text-5)] font-semibold text-[var(--accent)] hover:text-[var(--accent-hover)]"
                >
                  Edit
                </button>
              </div>
            </div>

            {error && <p className="mt-3 text-xs text-[var(--danger)]">{error}</p>}

            <div className="mt-4 flex flex-wrap gap-2">
              {SHIP_NEXT_STATUSES[ship.status].map((next) => (
                <button
                  key={next}
                  onClick={() => handleStatusChange(next)}
                  disabled={updateShipStatus.isPending}
                  className="rounded-full border border-[var(--border)] px-3 py-1.5 text-[length:var(--text-5)] font-semibold text-[var(--accent)] hover:bg-[var(--surface-page-1)] disabled:opacity-50"
                >
                  Move to {SHIP_STATUS_LABEL[next]}
                </button>
              ))}
            </div>

            <div className="mt-5 rounded-xl border border-[var(--surface-muted)] bg-[var(--surface-page-1)] p-4">
              <h3 className="mb-3 text-[length:var(--text-4)] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                Ship details
              </h3>
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
                <InfoField label="Cargo" value={ship.cargoType} />
                <InfoField label="Berth" value={ship.berth} />
                <InfoField label="Gate" value={ship.gate} />
                <InfoField label="ETA" value={formatDateTime(ship.eta)} />
                <InfoField label="Reporting time" value={formatDateTime(ship.reportingTime)} />
              </div>
              {ship.notes && (
                <div className="mt-3 border-t border-[var(--surface-muted-3)] pt-3">
                  <div className="text-[length:var(--text-2)] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                    Notes
                  </div>
                  <div className="mt-0.5 text-[length:var(--text-7)] text-[var(--text-strong)]">{ship.notes}</div>
                </div>
              )}
            </div>

            <section className="mt-6">
              <div className="mb-2.5 flex items-center justify-between">
                <h3 className="text-[length:var(--text-4)] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                  Destinations
                </h3>
                <button
                  onClick={() => setShowAddDestination((v) => !v)}
                  className="text-[length:var(--text-5)] font-semibold text-[var(--accent)]"
                >
                  {showAddDestination ? 'Cancel' : '+ Add destination'}
                </button>
              </div>

              <div className="flex flex-col gap-2.5">
                {ship.truckRequirements.map((req) => (
                  <div key={req.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-[length:var(--text-9)] font-bold text-[var(--text-strong)]">
                          {req.destination}
                        </div>
                        <div className="mt-0.5 text-xs text-[var(--text-muted)]">
                          {req.truckType} · {req.quantityNeeded} truck
                          {req.quantityNeeded === 1 ? '' : 's'}
                        </div>
                      </div>
                      <button
                        onClick={() =>
                          removeTruckRequirement.mutate({ shipId, truckRequirementId: req.id })
                        }
                        className="flex-shrink-0 text-sm text-[var(--danger)]"
                        aria-label="Remove truck requirement"
                      >
                        ×
                      </button>
                    </div>
                    <div className="mt-2.5 flex items-center justify-between">
                      <span className="text-[length:var(--text-8)] font-semibold text-[var(--accent)]">
                        {formatRate(req.rate, req.rateCurrency)}
                      </span>
                    </div>
                    {req.notes && (
                      <div className="mt-2 rounded-lg bg-[var(--surface-page-1)] px-2.5 py-1.5 text-[length:var(--text-5)] text-[var(--text-secondary)]">
                        {req.notes}
                      </div>
                    )}
                    <TruckRequirementDrivers
                      truckRequirementId={req.id}
                      quantityNeeded={req.quantityNeeded}
                      confirmedCount={req.confirmedCount}
                      pendingCount={req.pendingCount}
                    />
                  </div>
                ))}
                {ship.truckRequirements.length === 0 && !showAddDestination && (
                  <p className="text-xs text-[var(--text-muted)]">No destinations added yet.</p>
                )}
              </div>

              {showAddDestination && (
                <div className="mt-2.5 rounded-xl border border-[var(--surface-muted)] bg-[var(--surface-page-1)] p-3.5">
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      value={newDestination}
                      onChange={(e) => setNewDestination(e.target.value)}
                      placeholder="Destination"
                      className="col-span-2 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-[length:var(--text-6)] outline-none"
                    />
                    <input
                      value={newTruckType}
                      onChange={(e) => setNewTruckType(e.target.value)}
                      placeholder="Truck type"
                      className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-[length:var(--text-6)] outline-none"
                    />
                    <input
                      value={newQuantity}
                      type="number"
                      min={1}
                      onChange={(e) => setNewQuantity(e.target.value)}
                      className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-[length:var(--text-6)] outline-none"
                    />
                    <input
                      value={newRate}
                      type="number"
                      min={0}
                      step="0.01"
                      onChange={(e) => setNewRate(e.target.value)}
                      placeholder="Rate (PKR)"
                      className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-[length:var(--text-6)] outline-none"
                    />
                    <input
                      value={newNotes}
                      onChange={(e) => setNewNotes(e.target.value)}
                      placeholder="Notes (optional)"
                      className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-[length:var(--text-6)] outline-none"
                    />
                  </div>
                  <button
                    onClick={handleAddTruckRequirement}
                    className="mt-2.5 w-full rounded-lg bg-[var(--accent)] px-3 py-1.5 text-[length:var(--text-6)] font-semibold text-white"
                  >
                    Add destination
                  </button>
                </div>
              )}
            </section>

            <section className="mt-6">
              <div className="mb-2.5 flex items-center justify-between">
                <h3 className="text-[length:var(--text-4)] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                  Document requirements
                </h3>
                <button
                  onClick={() => setShowAddDocument((v) => !v)}
                  className="text-[length:var(--text-5)] font-semibold text-[var(--accent)]"
                >
                  {showAddDocument ? 'Cancel' : '+ Add document'}
                </button>
              </div>
              <div className="flex flex-col gap-2">
                {ship.documentRequirements.map((req) => (
                  <div
                    key={req.id}
                    className="flex items-center justify-between rounded-lg border border-[var(--surface-muted)] px-3 py-2 text-[length:var(--text-7)]"
                  >
                    <span>{req.documentType}</span>
                    <button
                      onClick={() =>
                        removeDocumentRequirement.mutate({ shipId, documentRequirementId: req.id })
                      }
                      className="text-[var(--danger)]"
                      aria-label="Remove document requirement"
                    >
                      ×
                    </button>
                  </div>
                ))}
                {ship.documentRequirements.length === 0 && !showAddDocument && (
                  <p className="text-xs text-[var(--text-muted)]">No document requirements yet.</p>
                )}
              </div>
              {showAddDocument && (
                <div className="mt-2 flex gap-2">
                  <input
                    value={newDocumentType}
                    onChange={(e) => setNewDocumentType(e.target.value)}
                    placeholder="e.g. Port Entry Pass"
                    className="flex-1 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-[length:var(--text-6)] outline-none"
                  />
                  <button
                    onClick={handleAddDocumentRequirement}
                    className="rounded-lg bg-[var(--accent)] px-3 text-[length:var(--text-6)] font-semibold text-white"
                  >
                    Add
                  </button>
                </div>
              )}
            </section>

            <div className="mt-7 flex justify-between">
              <button
                onClick={handleDelete}
                disabled={deleteShip.isPending}
                className="rounded-full border border-[var(--danger-bg-strong)] px-4 py-2 text-[length:var(--text-6)] font-semibold text-[var(--danger)] disabled:opacity-50"
              >
                Delete ship
              </button>
              <button
                onClick={onClose}
                className="rounded-full bg-[var(--surface-card-alt)] px-4 py-2 text-[length:var(--text-7)] font-semibold text-[var(--text-strong)]"
              >
                Close
              </button>
            </div>
          </>
        )}

        {ship && editing && editForm && (
          <>
            <div className="text-lg font-bold text-[var(--text-strong)]">Edit ship details</div>
            {error && <p className="mt-3 text-xs text-[var(--danger)]">{error}</p>}
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <EditField
                label="Ship name"
                value={editForm.shipName}
                onChange={(v) => setEditForm({ ...editForm, shipName: v })}
              />
              <EditField
                label="Shipping company"
                value={editForm.company}
                onChange={(v) => setEditForm({ ...editForm, company: v })}
              />
              <EditField
                label="Cargo"
                value={editForm.cargoType}
                onChange={(v) => setEditForm({ ...editForm, cargoType: v })}
              />
              <EditField
                label="Berth"
                value={editForm.berth}
                onChange={(v) => setEditForm({ ...editForm, berth: v })}
              />
              <EditField
                label="Gate"
                value={editForm.gate}
                onChange={(v) => setEditForm({ ...editForm, gate: v })}
              />
              <EditField
                label="ETA"
                type="datetime-local"
                value={editForm.eta}
                onChange={(v) => setEditForm({ ...editForm, eta: v })}
              />
              <EditField
                label="Reporting time"
                type="datetime-local"
                value={editForm.reportingTime}
                onChange={(v) => setEditForm({ ...editForm, reportingTime: v })}
              />
            </div>
            <div className="mt-3">
              <div className="mb-1.5 text-[length:var(--text-3)] text-[var(--text-muted)]">Notes</div>
              <textarea
                value={editForm.notes}
                onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                rows={3}
                placeholder="General remarks about this ship"
                className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-[length:var(--text-7)] outline-none"
              />
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => {
                  setEditing(false);
                  setEditForm(null);
                  setError(null);
                }}
                className="rounded-full bg-[var(--surface-card-alt)] px-4 py-2 text-[length:var(--text-7)] font-semibold text-[var(--text-strong)]"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={!editForm.shipName.trim() || updateShip.isPending}
                className="rounded-full bg-[var(--accent)] px-4 py-2 text-[length:var(--text-7)] font-semibold text-white disabled:opacity-50"
              >
                {updateShip.isPending ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function InfoField({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <div className="text-[length:var(--text-2)] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
        {label}
      </div>
      <div className="mt-0.5 text-[length:var(--text-7)] text-[var(--text-strong)]">{value ?? '—'}</div>
    </div>
  );
}

function EditField({
  label,
  value,
  onChange,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <div>
      <div className="mb-1.5 text-[length:var(--text-3)] text-[var(--text-muted)]">{label}</div>
      <input
        value={value}
        type={type}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-[length:var(--text-7)] outline-none"
      />
    </div>
  );
}

function DrawerSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="h-4 w-1/2 rounded bg-[var(--surface-muted-3)]" />
      <div className="mt-2 h-3 w-1/3 rounded bg-[var(--surface-muted-2)]" />
      <div className="mt-6 h-20 rounded-xl bg-[var(--surface-muted-2)]" />
      <div className="mt-6 h-3 w-1/4 rounded bg-[var(--surface-muted-2)]" />
      <div className="mt-3 h-16 rounded-lg bg-[var(--surface-muted-2)]" />
      <div className="mt-3 h-16 rounded-lg bg-[var(--surface-muted-2)]" />
    </div>
  );
}
