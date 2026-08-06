import { z } from 'zod';
import { paginationQuerySchema, sortOrderSchema } from './pagination.schema';

// Matches the status badges in the actual Kinvo mockup
// (🟢 Confirmed, 🟡 On call, 🔴 Escalated, ⚪ Idle).
export const driverAvailabilitySchema = z.enum(['IDLE', 'ON_CALL', 'CONFIRMED', 'ESCALATED']);
export type DriverAvailabilityValue = z.infer<typeof driverAvailabilitySchema>;

export const driverSchema = z.object({
  id: z.string(),
  fullName: z.string(),
  phone: z.string(),
  licenseNumber: z.string().nullable(),
  nationalId: z.string().nullable(),
  truckPlate: z.string().nullable(),
  truckType: z.string().nullable(),
  capacity: z.string().nullable(),
  languages: z.string().nullable(),
  preferredRoutes: z.string().nullable(),
  preferredCompanies: z.string().nullable(),
  rating: z.number().nullable(),
  previousJobsCount: z.number().int(),
  availability: driverAvailabilitySchema,
  currentShipId: z.string().nullable(),
  // Denormalized onto the DTO so the list/detail views never need a
  // second round trip just to show which ship a driver is currently on.
  currentShipName: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type DriverDto = z.infer<typeof driverSchema>;

export const createDriverRequestSchema = z.object({
  fullName: z.string().min(1),
  phone: z.string().min(1),
  licenseNumber: z.string().min(1).optional(),
  nationalId: z.string().min(1).optional(),
  truckPlate: z.string().min(1).optional(),
  truckType: z.string().min(1).optional(),
  capacity: z.string().min(1).optional(),
  languages: z.string().min(1).optional(),
  preferredRoutes: z.string().min(1).optional(),
  preferredCompanies: z.string().min(1).optional(),
  rating: z.number().min(0).max(5).optional(),
  availability: driverAvailabilitySchema.optional(),
  currentShipId: z.string().nullable().optional(),
  notes: z.string().optional(),
});
export type CreateDriverRequest = z.infer<typeof createDriverRequestSchema>;

export const updateDriverRequestSchema = z.object({
  fullName: z.string().min(1).optional(),
  phone: z.string().min(1).optional(),
  licenseNumber: z.string().min(1).nullable().optional(),
  nationalId: z.string().min(1).nullable().optional(),
  truckPlate: z.string().min(1).nullable().optional(),
  truckType: z.string().min(1).nullable().optional(),
  capacity: z.string().min(1).nullable().optional(),
  languages: z.string().min(1).nullable().optional(),
  preferredRoutes: z.string().min(1).nullable().optional(),
  preferredCompanies: z.string().min(1).nullable().optional(),
  rating: z.number().min(0).max(5).nullable().optional(),
  availability: driverAvailabilitySchema.optional(),
  currentShipId: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});
export type UpdateDriverRequest = z.infer<typeof updateDriverRequestSchema>;

export const driverListQuerySchema = paginationQuerySchema.extend({
  search: z.string().optional(),
  availability: driverAvailabilitySchema.optional(),
  truckType: z.string().optional(),
  sortBy: z.enum(['fullName', 'availability', 'createdAt', 'updatedAt']).default('createdAt'),
  sortOrder: sortOrderSchema.default('desc'),
});
export type DriverListQuery = z.infer<typeof driverListQuerySchema>;

export const driverListResponseSchema = z.object({
  items: z.array(driverSchema),
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
  totalPages: z.number(),
});
export type DriverListResponse = z.infer<typeof driverListResponseSchema>;
