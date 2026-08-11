import { z } from 'zod';
import { paginationQuerySchema } from './pagination.schema';

// Phase D (Kinvo UI redesign, Campaigns group): a pre-gate reminder call
// request for a ship's already-confirmed drivers, gated by an explicit
// approval step before it's considered sent. See the ReminderCampaign
// comment in schema.prisma for why approving this does NOT claim any
// actual call was placed — approvedDriverCount is a real, honest snapshot
// of how many drivers were confirmed at approval time, nothing more.
export const reminderCampaignStatusSchema = z.enum(['PENDING_APPROVAL', 'SENT', 'CANCELLED']);
export type ReminderCampaignStatusValue = z.infer<typeof reminderCampaignStatusSchema>;

export const reminderCampaignSchema = z.object({
  id: z.string(),
  shipId: z.string(),
  shipName: z.string(),
  shipGate: z.string().nullable(),
  shipReportingTime: z.string().datetime().nullable(),
  status: reminderCampaignStatusSchema,
  notes: z.string().nullable(),
  // Live count of currently-confirmed drivers on this ship — kept distinct
  // from confirmedDriverCountAtApproval (a frozen historical snapshot) so
  // a PENDING_APPROVAL campaign always shows the true current number, not
  // one that could already be stale by the time it's reviewed.
  currentConfirmedDriverCount: z.number().int().nonnegative(),
  createdByUserId: z.string(),
  createdByUserName: z.string(),
  approvedByUserId: z.string().nullable(),
  approvedByUserName: z.string().nullable(),
  approvedAt: z.string().datetime().nullable(),
  confirmedDriverCountAtApproval: z.number().int().nonnegative().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ReminderCampaignDto = z.infer<typeof reminderCampaignSchema>;

export const createReminderCampaignRequestSchema = z.object({
  shipId: z.string().min(1),
  notes: z.string().trim().max(2000).optional(),
});
export type CreateReminderCampaignRequest = z.infer<typeof createReminderCampaignRequestSchema>;

export const reminderCampaignListQuerySchema = paginationQuerySchema.extend({
  status: reminderCampaignStatusSchema.optional(),
});
export type ReminderCampaignListQuery = z.infer<typeof reminderCampaignListQuerySchema>;

export const reminderCampaignListResponseSchema = z.object({
  items: z.array(reminderCampaignSchema),
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
  totalPages: z.number(),
});
export type ReminderCampaignListResponse = z.infer<typeof reminderCampaignListResponseSchema>;
