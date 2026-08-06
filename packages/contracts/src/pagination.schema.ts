import { z } from 'zod';

// Shared by every paginated list endpoint (ships, drivers, and future
// modules) — one definition, not one per module, since the shape and
// defaults must stay identical across all of them.
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export const sortOrderSchema = z.enum(['asc', 'desc']);
export type SortOrderValue = z.infer<typeof sortOrderSchema>;

export interface PaginatedResponse<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
