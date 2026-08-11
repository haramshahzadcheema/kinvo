import { z } from 'zod';
import { paginationQuerySchema, sortOrderSchema } from './pagination.schema';

// DRAFT -> RECRUITING -> CONFIRMED -> IN_PROGRESS -> COMPLETED, CANCELLED
// reachable from any pre-COMPLETED state. Enforced in ships.service.ts, not
// just here — this schema only constrains which values are well-formed.
export const shipStatusSchema = z.enum([
  'DRAFT',
  'RECRUITING',
  'CONFIRMED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
]);
export type ShipStatusValue = z.infer<typeof shipStatusSchema>;

// A ship does not have one price — real port trucking is priced per
// destination and truck type, so rate/rateCurrency live on the requirement,
// not on Ship. rate is nullable: a requirement can exist before its price
// is negotiated, and there's no ship-level fallback to substitute.
//
// confirmedCount/pendingCount are derived (Phase 3) — computed from the
// requirement's Assignment rows at read time, never stored as columns.
// Storing them would create a second source of truth that could drift
// from the actual Assignment rows; deriving them keeps exactly one.
export const truckRequirementSchema = z.object({
  id: z.string(),
  destination: z.string(),
  truckType: z.string(),
  quantityNeeded: z.number().int().positive(),
  rate: z.number().nullable(),
  rateCurrency: z.string().nullable(),
  notes: z.string().nullable(),
  confirmedCount: z.number().int().nonnegative(),
  pendingCount: z.number().int().nonnegative(),
  // Added for the Recruitment view (needed/confirmed/pending/rejected per
  // destination) — REJECTED assignments were already tracked on Assignment
  // itself, this just surfaces the aggregate the way confirmedCount/
  // pendingCount already do. See loadRequirementCounts in ships.service.ts.
  rejectedCount: z.number().int().nonnegative(),
});
export type TruckRequirementDto = z.infer<typeof truckRequirementSchema>;

export const truckRequirementInputSchema = z.object({
  destination: z.string().min(1),
  truckType: z.string().min(1),
  quantityNeeded: z.number().int().positive(),
  rate: z.number().positive().optional(),
  rateCurrency: z.string().min(1).max(8).optional(),
  notes: z.string().optional(),
});
export type TruckRequirementInput = z.infer<typeof truckRequirementInputSchema>;

export const updateTruckRequirementRequestSchema = truckRequirementInputSchema.partial();

// documentType is free text on purpose — CNIC/License/Vehicle
// Registration/Port Entry Pass are examples a dispatcher types, not a
// hardcoded enum.
export const documentRequirementSchema = z.object({
  id: z.string(),
  documentType: z.string(),
  isRequired: z.boolean(),
});
export type DocumentRequirementDto = z.infer<typeof documentRequirementSchema>;

export const documentRequirementInputSchema = z.object({
  documentType: z.string().min(1),
  isRequired: z.boolean().default(true),
});
export type DocumentRequirementInput = z.infer<typeof documentRequirementInputSchema>;

export const updateDocumentRequirementRequestSchema = documentRequirementInputSchema.partial();

export const shipSchema = z.object({
  id: z.string(),
  shipName: z.string(),
  company: z.string().nullable(),
  eta: z.string().datetime().nullable(),
  reportingTime: z.string().datetime().nullable(),
  berth: z.string().nullable(),
  gate: z.string().nullable(),
  cargoType: z.string().nullable(),
  status: shipStatusSchema,
  notes: z.string().nullable(),
  truckRequirements: z.array(truckRequirementSchema),
  documentRequirements: z.array(documentRequirementSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ShipDto = z.infer<typeof shipSchema>;

export const createShipRequestSchema = z.object({
  shipName: z.string().min(1),
  company: z.string().min(1).optional(),
  eta: z.string().datetime().optional(),
  reportingTime: z.string().datetime().optional(),
  berth: z.string().min(1).optional(),
  gate: z.string().min(1).optional(),
  cargoType: z.string().min(1).optional(),
  notes: z.string().optional(),
  truckRequirements: z.array(truckRequirementInputSchema).optional(),
  documentRequirements: z.array(documentRequirementInputSchema).optional(),
});
export type CreateShipRequest = z.infer<typeof createShipRequestSchema>;

// Status is intentionally NOT included here — status changes go through
// their own endpoint/transition check (ships.service.ts's state machine),
// never as a side effect of a general field-edit PATCH.
export const updateShipRequestSchema = z.object({
  shipName: z.string().min(1).optional(),
  company: z.string().min(1).nullable().optional(),
  eta: z.string().datetime().nullable().optional(),
  reportingTime: z.string().datetime().nullable().optional(),
  berth: z.string().min(1).nullable().optional(),
  gate: z.string().min(1).nullable().optional(),
  cargoType: z.string().min(1).nullable().optional(),
  notes: z.string().nullable().optional(),
});
export type UpdateShipRequest = z.infer<typeof updateShipRequestSchema>;

export const updateShipStatusRequestSchema = z.object({
  status: shipStatusSchema,
});
export type UpdateShipStatusRequest = z.infer<typeof updateShipStatusRequestSchema>;

export const shipListQuerySchema = paginationQuerySchema.extend({
  search: z.string().optional(),
  status: shipStatusSchema.optional(),
  sortBy: z.enum(['shipName', 'eta', 'status', 'createdAt', 'updatedAt']).default('createdAt'),
  sortOrder: sortOrderSchema.default('desc'),
});
export type ShipListQuery = z.infer<typeof shipListQuerySchema>;

export const shipListResponseSchema = z.object({
  items: z.array(shipSchema),
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
  totalPages: z.number(),
});
export type ShipListResponse = z.infer<typeof shipListResponseSchema>;
