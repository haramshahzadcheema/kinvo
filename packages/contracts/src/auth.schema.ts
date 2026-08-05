import { z } from 'zod';
import { roleSchema } from './membership.schema';

export const registerOrganizationRequestSchema = z.object({
  organizationName: z.string().min(2).max(200),
  email: z.string().email(),
  password: z.string().min(8).max(200),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
});
export type RegisterOrganizationRequest = z.infer<typeof registerOrganizationRequestSchema>;

export const loginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const acceptInvitationRequestSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8).max(200),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
});
export type AcceptInvitationRequest = z.infer<typeof acceptInvitationRequestSchema>;

export const currentUserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  firstName: z.string(),
  lastName: z.string(),
});
export type CurrentUser = z.infer<typeof currentUserSchema>;

export const currentOrganizationSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
});
export type CurrentOrganization = z.infer<typeof currentOrganizationSchema>;

export const currentMembershipSchema = z.object({
  id: z.string(),
  role: roleSchema,
});
export type CurrentMembership = z.infer<typeof currentMembershipSchema>;

export const authResponseSchema = z.object({
  accessToken: z.string(),
  user: currentUserSchema,
  organization: currentOrganizationSchema,
  membership: currentMembershipSchema,
});
export type AuthResponse = z.infer<typeof authResponseSchema>;

export const meResponseSchema = z.object({
  user: currentUserSchema,
  organization: currentOrganizationSchema,
  membership: currentMembershipSchema,
});
export type MeResponse = z.infer<typeof meResponseSchema>;
