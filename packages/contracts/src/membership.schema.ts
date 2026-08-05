import { z } from 'zod';

export const roleSchema = z.enum(['OWNER', 'ADMIN', 'DISPATCHER', 'VIEWER']);
export type RoleValue = z.infer<typeof roleSchema>;

export const membershipStatusSchema = z.enum(['ACTIVE', 'REMOVED']);
export type MembershipStatusValue = z.infer<typeof membershipStatusSchema>;
