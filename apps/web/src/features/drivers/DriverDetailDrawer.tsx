import type { DriverAvailabilityValue, UpdateDriverRequest } from '@kinvo/contracts';
import { useState } from 'react';
import { formatDateTime } from '../../lib/format';
import { isApiError } from '../../lib/useAuth';
import {
  ASSIGNMENT_STATUS_LABEL,
  ASSIGNMENT_STATUS_STYLE,
} from '../assignments/statusStyles';
import { useAssignments } from '../assignments/useAssignments';
import { AVAILABILITY_LABEL, AVAILABILITY_STYLE } from './statusStyles';
import { useDriver, useDriverMutations } from './useDrivers';

const AVAILABILITY_OPTIONS: DriverAvailabilityValue[] = [
  'IDLE',
  'ON_CALL',
  'CONFIRMED',
  'ESCALATED',
];

interface EditForm {
  fullName: string;
  phone: string;
  licenseNumber: string;
  nationalId: string;
  truckPlate: string;
  truckType: string;
  capacity: string;
  languages: string;
  preferredRoutes: string;
  preferredCompanies: string;
  notes: string;
}

export function DriverDetailDrawer({
  driverId,
  onClose,
}: {
  driverId: string;
  onClose: () => void;
}) {
  const { data: driver, isLoading } = useDriver(driverId);
  const { data: assignmentHistory } = useAssignments({
    driverId,
    sortBy: 'invitedAt',
    sortOrder: 'desc',
    pageSize: 10,
  });
  const { updateDriver, deleteDriver } = useDriverMutations();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<EditForm | null>(null);

  function startEditing() {
    if (!driver) return;
    setEditForm({
      fullName: driver.fullName,
      phone: driver.phone,
      licenseNumber: driver.licenseNumber ?? '',
      nationalId: driver.nationalId ?? '',
      truckPlate: driver.truckPlate ?? '',
      truckType: driver.truckType ?? '',
      capacity: driver.capacity ?? '',
      languages: driver.languages ?? '',
      preferredRoutes: driver.preferredRoutes ?? '',
      preferredCompanies: driver.preferredCompanies ?? '',
      notes: driver.notes ?? '',
    });
    setEditing(true);
  }

  async function handleSaveEdit() {
    if (!editForm) return;
    setError(null);
    try {
      const payload: UpdateDriverRequest = {
        fullName: editForm.fullName,
        phone: editForm.phone,
        licenseNumber: editForm.licenseNumber.trim() ? editForm.licenseNumber.trim() : null,
        nationalId: editForm.nationalId.trim() ? editForm.nationalId.trim() : null,
        truckPlate: editForm.truckPlate.trim() ? editForm.truckPlate.trim() : null,
        truckType: editForm.truckType.trim() ? editForm.truckType.trim() : null,
        capacity: editForm.capacity.trim() ? editForm.capacity.trim() : null,
        languages: editForm.languages.trim() ? editForm.languages.trim() : null,
        preferredRoutes: editForm.preferredRoutes.trim() ? editForm.preferredRoutes.trim() : null,
        preferredCompanies: editForm.preferredCompanies.trim()
          ? editForm.preferredCompanies.trim()
          : null,
        notes: editForm.notes.trim() ? editForm.notes.trim() : null,
      };
      await updateDriver.mutateAsync({ driverId, input: payload });
      setEditing(false);
      setEditForm(null);
    } catch (err) {
      setError(isApiError(err) ? err.message : 'Could not save changes.');
    }
  }

  async function handleAvailabilityChange(availability: DriverAvailabilityValue) {
    setError(null);
    try {
      await updateDriver.mutateAsync({ driverId, input: { availability } });
    } catch (err) {
      setError(isApiError(err) ? err.message : 'Could not update availability.');
    }
  }

  async function handleDelete() {
    setError(null);
    try {
      await deleteDriver.mutateAsync(driverId);
      onClose();
    } catch (err) {
      setError(isApiError(err) ? err.message : 'Could not delete this driver.');
    }
  }

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-20 flex items-center justify-center bg-[rgba(15,42,56,0.4)] sm:p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="h-full w-full overflow-y-auto bg-white p-6 sm:h-auto sm:max-h-[85vh] sm:w-[520px] sm:rounded-2xl sm:p-7.5"
      >
        {isLoading && <DriverDrawerSkeleton />}

        {driver && !editing && (
          <>
            <div className="flex items-center gap-3.5">
              <div className="flex h-13 w-13 flex-shrink-0 items-center justify-center rounded-full bg-[#1E7A8C] text-lg font-semibold text-white">
                {driver.fullName
                  .split(' ')
                  .map((n) => n[0])
                  .slice(0, 2)
                  .join('')}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-lg font-bold text-[#0F2A38]">{driver.fullName}</div>
                <div className="mt-0.5 text-xs text-[#8B9AA3]">
                  {driver.truckType ?? '—'} {driver.capacity ? `· ${driver.capacity}` : ''}
                </div>
              </div>
              <span
                className="flex-shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold"
                style={{
                  background: AVAILABILITY_STYLE[driver.availability].bg,
                  color: AVAILABILITY_STYLE[driver.availability].color,
                }}
              >
                {AVAILABILITY_LABEL[driver.availability]}
              </span>
            </div>

            {error && <p className="mt-3 text-xs text-[#C1503B]">{error}</p>}

            <div className="mt-5 flex flex-wrap items-center gap-2">
              {AVAILABILITY_OPTIONS.filter((a) => a !== driver.availability).map((option) => (
                <button
                  key={option}
                  onClick={() => handleAvailabilityChange(option)}
                  className="rounded-full border border-[#ECE1CC] px-3 py-1.5 text-[11.5px] font-semibold text-[#1E7A8C] hover:bg-[#FBF6EE]"
                >
                  Mark {AVAILABILITY_LABEL[option]}
                </button>
              ))}
              <button
                onClick={startEditing}
                className="ml-auto text-[11.5px] font-semibold text-[#1E7A8C] hover:text-[#175F6E]"
              >
                Edit
              </button>
            </div>

            <div className="mt-5.5 grid grid-cols-2 gap-3">
              <Detail label="Phone" value={driver.phone} mono />
              <Detail label="License" value={driver.licenseNumber ?? '—'} mono />
              <Detail label="National ID" value={driver.nationalId ?? '—'} mono />
              <Detail
                label="Rating"
                value={
                  driver.rating != null
                    ? `★ ${driver.rating} · ${driver.previousJobsCount} jobs`
                    : '—'
                }
              />
              <Detail label="Languages" value={driver.languages ?? '—'} />
              <Detail label="Preferred companies" value={driver.preferredCompanies ?? '—'} />
            </div>
            <div className="mt-3">
              <Detail label="Preferred routes" value={driver.preferredRoutes ?? '—'} />
            </div>
            <div className="mt-3">
              <Detail label="Currently on" value={driver.currentShipName ?? 'Not assigned'} />
            </div>
            {driver.notes && (
              <div className="mt-3 border-t border-[#F5EEE0] pt-3">
                <Detail label="Notes" value={driver.notes} />
              </div>
            )}

            <div className="mt-5 border-t border-[#F5EEE0] pt-4">
              <h3 className="mb-2.5 text-[11px] font-semibold uppercase tracking-wide text-[#8B9AA3]">
                Assignment history
              </h3>
              {(assignmentHistory?.items.length ?? 0) === 0 ? (
                <p className="text-xs text-[#8B9AA3]">No assignments yet.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {assignmentHistory?.items.map((a) => (
                    <div
                      key={a.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-[#F5EEE0] px-3 py-2"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-[12px] font-semibold text-[#0F2A38]">
                          {a.shipName} · {a.destination}
                        </div>
                        <div className="text-[10.5px] text-[#8B9AA3]">
                          Invited {formatDateTime(a.invitedAt)}
                        </div>
                      </div>
                      <span
                        className="flex-shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[10.5px] font-semibold"
                        style={{
                          background: ASSIGNMENT_STATUS_STYLE[a.status].bg,
                          color: ASSIGNMENT_STATUS_STYLE[a.status].color,
                        }}
                      >
                        {ASSIGNMENT_STATUS_LABEL[a.status]}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-7 flex justify-between">
              <button
                onClick={handleDelete}
                disabled={deleteDriver.isPending}
                className="rounded-full border border-[#F0C4B8] px-4 py-2 text-[12px] font-semibold text-[#C1503B] disabled:opacity-50"
              >
                Delete driver
              </button>
              <button
                onClick={onClose}
                className="rounded-full bg-[#F3EDDD] px-4 py-2 text-[12.5px] font-semibold text-[#0F2A38]"
              >
                Close
              </button>
            </div>
          </>
        )}

        {driver && editing && editForm && (
          <>
            <div className="text-lg font-bold text-[#0F2A38]">Edit driver</div>
            {error && <p className="mt-3 text-xs text-[#C1503B]">{error}</p>}
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <EditField
                label="Full name"
                value={editForm.fullName}
                onChange={(v) => setEditForm({ ...editForm, fullName: v })}
              />
              <EditField
                label="Phone"
                value={editForm.phone}
                onChange={(v) => setEditForm({ ...editForm, phone: v })}
              />
              <EditField
                label="Truck plate"
                value={editForm.truckPlate}
                onChange={(v) => setEditForm({ ...editForm, truckPlate: v })}
              />
              <EditField
                label="Truck type"
                value={editForm.truckType}
                onChange={(v) => setEditForm({ ...editForm, truckType: v })}
              />
              <EditField
                label="Capacity"
                value={editForm.capacity}
                onChange={(v) => setEditForm({ ...editForm, capacity: v })}
              />
              <EditField
                label="License number"
                value={editForm.licenseNumber}
                onChange={(v) => setEditForm({ ...editForm, licenseNumber: v })}
              />
              <EditField
                label="National ID"
                value={editForm.nationalId}
                onChange={(v) => setEditForm({ ...editForm, nationalId: v })}
              />
              <EditField
                label="Languages"
                value={editForm.languages}
                onChange={(v) => setEditForm({ ...editForm, languages: v })}
              />
              <EditField
                label="Preferred routes"
                value={editForm.preferredRoutes}
                onChange={(v) => setEditForm({ ...editForm, preferredRoutes: v })}
              />
              <EditField
                label="Preferred companies"
                value={editForm.preferredCompanies}
                onChange={(v) => setEditForm({ ...editForm, preferredCompanies: v })}
              />
            </div>
            <div className="mt-3">
              <div className="mb-1.5 text-[10.5px] text-[#8B9AA3]">Notes</div>
              <textarea
                value={editForm.notes}
                onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                rows={3}
                placeholder="General remarks about this driver"
                className="w-full rounded-lg border border-[#ECE1CC] px-3 py-2 text-[12.5px] outline-none"
              />
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => {
                  setEditing(false);
                  setEditForm(null);
                  setError(null);
                }}
                className="rounded-full bg-[#F3EDDD] px-4 py-2 text-[12.5px] font-semibold text-[#0F2A38]"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={
                  !editForm.fullName.trim() || !editForm.phone.trim() || updateDriver.isPending
                }
                className="rounded-full bg-[#1E7A8C] px-4 py-2 text-[12.5px] font-semibold text-white disabled:opacity-50"
              >
                {updateDriver.isPending ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function DriverDrawerSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="flex items-center gap-3.5">
        <div className="h-13 w-13 flex-shrink-0 rounded-full bg-[#F0EADC]" />
        <div className="flex-1">
          <div className="h-4 w-1/2 rounded bg-[#F0EADC]" />
          <div className="mt-2 h-2.5 w-1/3 rounded bg-[#F5F0E6]" />
        </div>
      </div>
      <div className="mt-5.5 grid grid-cols-2 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-8 rounded bg-[#F5F0E6]" />
        ))}
      </div>
    </div>
  );
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10.5px] uppercase tracking-wide text-[#8B9AA3]">{label}</div>
      <div className={`mt-0.5 text-[12.5px] text-[#0F2A38] ${mono ? 'font-mono' : ''}`}>
        {value}
      </div>
    </div>
  );
}

function EditField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <div className="mb-1.5 text-[10.5px] text-[#8B9AA3]">{label}</div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-[#ECE1CC] px-3 py-2 text-[12.5px] outline-none"
      />
    </div>
  );
}
