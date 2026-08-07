// Explicit named re-exports, not `export *`: TypeScript compiles `export *`
// to a runtime copy loop in CommonJS output, which bundlers' static export
// analysis (Rollup, esbuild) cannot see through — it breaks named-import
// tree-shaking/resolution for consumers like apps/web. Explicit re-exports
// compile to a statically analyzable `Object.defineProperty` per export.
export {
  dependencyHealthSchema,
  healthStatusSchema,
  livenessResponseSchema,
  readinessResponseSchema,
} from './health.schema';
export type {
  DependencyHealth,
  HealthStatus,
  LivenessResponse,
  ReadinessResponse,
} from './health.schema';

export { roleSchema, membershipStatusSchema } from './membership.schema';
export type { RoleValue, MembershipStatusValue } from './membership.schema';

export {
  registerOrganizationRequestSchema,
  loginRequestSchema,
  acceptInvitationRequestSchema,
  currentUserSchema,
  currentOrganizationSchema,
  currentMembershipSchema,
  authResponseSchema,
  meResponseSchema,
} from './auth.schema';
export type {
  RegisterOrganizationRequest,
  LoginRequest,
  AcceptInvitationRequest,
  CurrentUser,
  CurrentOrganization,
  CurrentMembership,
  AuthResponse,
  MeResponse,
} from './auth.schema';

export {
  memberSchema,
  listMembersResponseSchema,
  updateMemberRoleRequestSchema,
  createInvitationRequestSchema,
  invitationStatusSchema,
  invitationSchema,
  listInvitationsResponseSchema,
} from './organization.schema';
export type {
  Member,
  ListMembersResponse,
  UpdateMemberRoleRequest,
  CreateInvitationRequest,
  InvitationStatusValue,
  InvitationDto,
  ListInvitationsResponse,
} from './organization.schema';

export { paginationQuerySchema, sortOrderSchema } from './pagination.schema';
export type { PaginationQuery, SortOrderValue, PaginatedResponse } from './pagination.schema';

export {
  shipStatusSchema,
  truckRequirementSchema,
  truckRequirementInputSchema,
  updateTruckRequirementRequestSchema,
  documentRequirementSchema,
  documentRequirementInputSchema,
  updateDocumentRequirementRequestSchema,
  shipSchema,
  createShipRequestSchema,
  updateShipRequestSchema,
  updateShipStatusRequestSchema,
  shipListQuerySchema,
  shipListResponseSchema,
} from './ship.schema';
export type {
  ShipStatusValue,
  TruckRequirementDto,
  TruckRequirementInput,
  DocumentRequirementDto,
  DocumentRequirementInput,
  ShipDto,
  CreateShipRequest,
  UpdateShipRequest,
  UpdateShipStatusRequest,
  ShipListQuery,
  ShipListResponse,
} from './ship.schema';

export {
  driverAvailabilitySchema,
  driverSchema,
  createDriverRequestSchema,
  updateDriverRequestSchema,
  driverListQuerySchema,
  driverListResponseSchema,
} from './driver.schema';
export type {
  DriverAvailabilityValue,
  DriverDto,
  CreateDriverRequest,
  UpdateDriverRequest,
  DriverListQuery,
  DriverListResponse,
} from './driver.schema';

export {
  assignmentStatusSchema,
  attemptOutcomeSchema,
  humanLoggableAttemptOutcomeSchema,
  assignmentAttemptSchema,
  logAttemptRequestSchema,
  assignmentSchema,
  createAssignmentRequestSchema,
  rejectAssignmentRequestSchema,
  cancelAssignmentRequestSchema,
  assignmentListQuerySchema,
  assignmentListResponseSchema,
} from './assignment.schema';
export type {
  AssignmentStatusValue,
  AttemptOutcomeValue,
  HumanLoggableAttemptOutcomeValue,
  AssignmentAttemptDto,
  LogAttemptRequest,
  AssignmentDto,
  CreateAssignmentRequest,
  RejectAssignmentRequest,
  CancelAssignmentRequest,
  AssignmentListQuery,
  AssignmentListResponse,
} from './assignment.schema';

export {
  resolvedVoiceCallSchema,
  voiceCallListQuerySchema,
  voiceCallListResponseSchema,
  activeVoiceCallSchema,
  activeVoiceCallsResponseSchema,
} from './voiceCall.schema';
export type {
  ResolvedVoiceCallDto,
  VoiceCallListQuery,
  VoiceCallListResponse,
  ActiveVoiceCallDto,
  ActiveVoiceCallsResponse,
} from './voiceCall.schema';
