import { z } from 'zod';
import { currentOrganizationSchema } from './auth.schema';
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

// Name-only — slug is assigned once at registration (see
// auth.service.ts's generateUniqueSlug) and never re-derived from a
// rename, since anything already linking to the org by slug shouldn't
// silently break. Gated to OWNER/ADMIN (organization:manage), matching
// the tier OrganizationSection.tsx already displays org info to
// differently. Response reuses the same shape GET /me already returns
// for `organization`, so the frontend can update its cached auth state
// with the literal response.
export const updateOrganizationRequestSchema = z.object({
  name: z.string().trim().min(2).max(200),
});
export type UpdateOrganizationRequest = z.infer<typeof updateOrganizationRequestSchema>;

export const updateOrganizationResponseSchema = currentOrganizationSchema;
export type UpdateOrganizationResponse = z.infer<typeof updateOrganizationResponseSchema>;
