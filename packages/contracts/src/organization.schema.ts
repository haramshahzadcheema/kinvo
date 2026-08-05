import { z } from 'zod';
import { membershipStatusSchema, roleSchema } from './membership.schema';

export const memberSchema = z.object({
  membershipId: z.string(),
  userId: z.string(),
  email: z.string().email(),
  firstName: z.string(),
  lastName: z.string(),
  role: roleSchema,
  status: membershipStatusSchema,
  createdAt: z.string().datetime(),
});
export type Member = z.infer<typeof memberSchema>;

export const listMembersResponseSchema = z.object({
  members: z.array(memberSchema),
});
export type ListMembersResponse = z.infer<typeof listMembersResponseSchema>;

export const updateMemberRoleRequestSchema = z.object({
  role: roleSchema,
});
export type UpdateMemberRoleRequest = z.infer<typeof updateMemberRoleRequestSchema>;

export const createInvitationRequestSchema = z.object({
  email: z.string().email(),
  role: roleSchema,
});
export type CreateInvitationRequest = z.infer<typeof createInvitationRequestSchema>;

export const invitationStatusSchema = z.enum(['PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED']);
export type InvitationStatusValue = z.infer<typeof invitationStatusSchema>;

export const invitationSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  role: roleSchema,
  status: invitationStatusSchema,
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  // The invite link/token is only ever returned once, at creation time —
  // Phase 1 has no email delivery yet, so the caller is responsible for
  // sharing it (see docs/ARCHITECTURE.md). Never returned on subsequent
  // reads (list invitations).
  inviteToken: z.string().optional(),
});
export type InvitationDto = z.infer<typeof invitationSchema>;

export const listInvitationsResponseSchema = z.object({
  invitations: z.array(invitationSchema),
});
export type ListInvitationsResponse = z.infer<typeof listInvitationsResponseSchema>;
