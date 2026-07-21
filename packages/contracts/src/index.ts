export const MODULE_KEYS = [
  'platform',
  'master-data',
  'procurement',
  'production',
  'workforce',
  'inventory',
  'sales',
  'finance',
  'crm',
  'field-execution',
  'geospatial',
  'distributors',
  'retailers',
  'trade-terms',
  'returns-rebates',
  'ecommerce',
  'marketing',
  'analytics',
  'integrations'
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];

export const PLATFORM_PERMISSIONS = [
  'platform.session.read',
  'platform.modules.read',
  'platform.modules.manage',
  'platform.tenants.manage',
  'platform.memberships.read',
  'platform.memberships.manage',
  'platform.roles.read',
  'platform.roles.manage',
  'platform.invitations.manage',
  'platform.approvals.read',
  'platform.approvals.request',
  'platform.approvals.decide',
  'platform.approval-policies.read',
  'platform.approval-policies.manage',
  'platform.audit.read'
] as const;

export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[number];
export type PermissionKey = PlatformPermission | (string & {});

export type ModuleEntitlement = {
  key: ModuleKey;
  enabled: boolean;
  status: 'available' | 'foundation' | 'planned';
  label: string;
  description: string;
  version: number;
};

export type TenantSummary = {
  id: string;
  slug: string;
  displayName: string;
  defaultCurrency: string;
  defaultLocale: string;
  defaultTimezone: string;
};

export type TenantOption = TenantSummary & {
  membershipStatus: 'active';
};

export type UserSummary = {
  id: string;
  displayName: string;
};

export type SessionContextResponse = {
  user: UserSummary;
  tenant: TenantSummary;
  roles: string[];
  permissions: string[];
  modules: ModuleEntitlement[];
};

export type TenantOptionsResponse = {
  user: UserSummary | null;
  tenants: TenantOption[];
};

export type SetModuleEntitlementRequest = {
  enabled: boolean;
};

export type SetModuleEntitlementResponse = {
  module: ModuleEntitlement;
  replayed: boolean;
};

export type DevelopmentBootstrapRequest = {
  tenantName: string;
  tenantSlug: string;
  adminEmail: string;
  adminDisplayName: string;
};

export type DevelopmentBootstrapResponse = {
  tenantId: string;
  userId: string;
  created: boolean;
};

export type OnboardTenantRequest = {
  tenantName: string;
  tenantSlug: string;
  adminDisplayName: string;
  defaultCurrency: string;
  defaultLocale: string;
  defaultTimezone: string;
};

export type OnboardTenantResponse = {
  tenantId: string;
  userId: string;
  replayed: boolean;
};

export type RoleSummary = {
  id: string;
  key: string;
  displayName: string;
  system: boolean;
  permissions: string[];
};

export type MembershipSummary = {
  userId: string;
  email: string;
  displayName: string;
  status: 'invited' | 'active' | 'suspended';
  roles: string[];
  createdAt: string;
  updatedAt: string;
};

export type InvitationSummary = {
  id: string;
  email: string;
  displayName: string | null;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  roles: string[];
  expiresAt: string;
  createdAt: string;
  acceptedAt: string | null;
};

export type TenantAdministrationResponse = {
  memberships: MembershipSummary[];
  roles: RoleSummary[];
  invitations: InvitationSummary[];
};

export type CreateInvitationRequest = {
  email: string;
  displayName?: string;
  roleKeys: string[];
};

export type CreateInvitationResponse = {
  invitation: InvitationSummary;
  acceptanceToken: string;
  replayed: boolean;
};

export type AcceptInvitationRequest = {
  token: string;
};

export type AcceptInvitationResponse = {
  tenant: TenantSummary;
  userId: string;
  roles: string[];
};

export type UpdateMembershipRequest = {
  status: 'active' | 'suspended';
  roleKeys: string[];
};

export type UpdateMembershipResponse = {
  membership: MembershipSummary;
  replayed: boolean;
};

export type RevokeInvitationResponse = {
  invitation: InvitationSummary;
  replayed: boolean;
};

export type ApprovalRequestStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'cancelled'
  | 'expired';

export type ApprovalStepStatus = 'pending' | 'approved' | 'rejected';
export type ApprovalDecisionValue = 'approve' | 'reject';

export type ApprovalPolicyStep = {
  stepNumber: number;
  requiredPermission: string;
  minimumApprovers: number;
  selfApprovalAllowed: boolean;
};

export type ApprovalPolicySummary = {
  id: string;
  key: string;
  displayName: string;
  resourceType: string;
  action: string;
  condition: Record<string, unknown>;
  enabled: boolean;
  steps: ApprovalPolicyStep[];
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type ApprovalDecisionSummary = {
  id: string;
  stepNumber: number;
  deciderUserId: string;
  deciderDisplayName: string;
  decision: ApprovalDecisionValue;
  comment: string | null;
  createdAt: string;
};

export type ApprovalRequestStepSummary = ApprovalPolicyStep & {
  status: ApprovalStepStatus;
  approvedCount: number;
  resolvedAt: string | null;
  decisions: ApprovalDecisionSummary[];
};

export type ApprovalRequestSummary = {
  id: string;
  policyKey: string;
  policyDisplayName: string;
  requesterUserId: string;
  requesterDisplayName: string;
  resourceType: string;
  resourceId: string;
  action: string;
  title: string;
  description: string | null;
  payload: Record<string, unknown>;
  status: ApprovalRequestStatus;
  executionStatus: 'pending' | 'completed' | 'not-required' | 'failed';
  currentStepNumber: number;
  totalSteps: number;
  steps: ApprovalRequestStepSummary[];
  expiresAt: string;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type ApprovalWorkspaceResponse = {
  policies: ApprovalPolicySummary[];
  requests: ApprovalRequestSummary[];
};

export type UpsertApprovalPolicyRequest = {
  displayName: string;
  resourceType: string;
  action: string;
  condition?: Record<string, unknown>;
  enabled: boolean;
  steps: Array<{
    requiredPermission: string;
    minimumApprovers: number;
    selfApprovalAllowed: boolean;
  }>;
};

export type UpsertApprovalPolicyResponse = {
  policy: ApprovalPolicySummary;
  replayed: boolean;
};

export type CreateApprovalRequestRequest = {
  policyKey: string;
  resourceType: string;
  resourceId: string;
  action: string;
  title: string;
  description?: string;
  payload: Record<string, unknown>;
};

export type CreateApprovalRequestResponse = {
  request: ApprovalRequestSummary;
  replayed: boolean;
};

export type DecideApprovalRequestRequest = {
  decision: ApprovalDecisionValue;
  comment?: string;
};

export type DecideApprovalRequestResponse = {
  request: ApprovalRequestSummary;
  replayed: boolean;
};

export type CancelApprovalRequestResponse = {
  request: ApprovalRequestSummary;
  replayed: boolean;
};

export type HealthResponse = {
  service: 'fmcgbyalex-api';
  status: 'ok';
  version: string;
  timestamp: string;
};

export type ProblemDetails = {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  correlationId?: string;
};
