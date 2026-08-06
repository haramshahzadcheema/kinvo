export type AuditEventType =
  | 'auth.register_organization'
  | 'auth.login'
  | 'auth.logout'
  | 'auth.logout_all'
  | 'invitation.sent'
  | 'invitation.accepted'
  | 'invitation.revoked'
  | 'membership.role_changed'
  | 'membership.removed'
  | 'ship.created'
  | 'ship.updated'
  | 'ship.status_changed'
  | 'ship.deleted'
  | 'driver.created'
  | 'driver.updated'
  | 'driver.deleted'
  | 'assignment.created'
  | 'assignment.confirmed'
  | 'assignment.rejected'
  | 'assignment.withdrawn'
  | 'assignment.cancelled'
  | 'assignment.no_show'
  | 'assignment.completed'
  | 'assignment.attempt_logged';

export interface AuditEvent {
  type: AuditEventType;
  actorUserId: string;
  // Optional: most events are clearly org-scoped, but a couple (e.g.
  // logout-all, which acts on every session a user has regardless of
  // organization) aren't inherently tied to one — better to omit it
  // honestly than fabricate a value.
  organizationId?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}
