import {
  MODULE_KEYS,
  type ApprovalDecisionSummary,
  type ApprovalPolicyStep,
  type ApprovalPolicySummary,
  type ApprovalRequestStepSummary,
  type ApprovalRequestSummary,
  type ApprovalWorkspaceResponse,
  type CancelApprovalRequestResponse,
  type CreateApprovalRequestRequest,
  type CreateApprovalRequestResponse,
  type DecideApprovalRequestRequest,
  type DecideApprovalRequestResponse,
  type UpsertApprovalPolicyRequest,
  type UpsertApprovalPolicyResponse
} from '@fmcgbyalex/contracts';
import {
  PlatformHttpError,
  enforceModule,
  enforcePermission,
  type ResolvedSession
} from './platform';

const POLICY_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RESOURCE_TYPE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9-]*[a-z0-9])?$/;
const ACTION_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const REQUEST_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_POLICY_STEPS = 5;
const DEFAULT_POLICY_KEY = 'module-entitlement-change';
const MODULE_ACTION = 'platform.module-entitlement.set';
const MODULE_RESOURCE_TYPE = 'module-entitlement';

type PolicyRow = {
  id: string;
  key: string;
  display_name: string;
  resource_type: string;
  action: string;
  condition_json: string;
  enabled: number;
  created_at: string;
  updated_at: string;
  version: number;
};

type PolicyStepRow = {
  policy_id: string;
  step_number: number;
  required_permission: string;
  minimum_approvers: number;
  self_approval_allowed: number;
};

type RequestRow = {
  id: string;
  policy_id: string;
  policy_key_snapshot: string;
  policy_name_snapshot: string;
  requester_user_id: string;
  requester_display_name: string;
  resource_type: string;
  resource_id: string;
  action: string;
  title: string;
  description: string | null;
  payload_json: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'expired';
  execution_status: 'pending' | 'completed' | 'not-required' | 'failed';
  current_step_number: number;
  total_steps: number;
  expires_at: string;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
  version: number;
};

type RequestStepRow = {
  request_id: string;
  step_number: number;
  required_permission: string;
  minimum_approvers: number;
  self_approval_allowed: number;
  status: 'pending' | 'approved' | 'rejected';
  approved_count: number;
  resolved_at: string | null;
};

type DecisionRow = {
  id: string;
  request_id: string;
  step_number: number;
  decider_user_id: string;
  decider_display_name: string;
  decision: 'approve' | 'reject';
  comment: string | null;
  created_at: string;
};

type PermissionRow = { key: string };
type IdempotencyRow = { request_hash: string; response_body: string | null };
type ModuleRow = { enabled: number; version: number };
type RequestStatusRow = {
  status: RequestRow['status'];
  requester_user_id: string;
  current_step_number: number;
  expires_at: string;
  action: string;
  resource_type: string;
  resource_id: string;
  payload_json: string;
};

export async function getApprovalWorkspace(
  env: Env,
  request: Request,
  session: ResolvedSession
): Promise<ApprovalWorkspaceResponse> {
  await requireApprovalAccess(env, request, session, [
    'platform.approvals.read',
    'platform.approval-policies.read'
  ]);
  await ensureDefaultApprovalPolicy(env.CONTROL_DB, session.response.tenant.id);
  await expireApprovalRequests(
    env.CONTROL_DB,
    session.response.tenant.id,
    session.context.correlationId
  );
  return loadWorkspace(env.CONTROL_DB, session.response.tenant.id);
}

export async function getApprovalRequest(
  env: Env,
  request: Request,
  session: ResolvedSession,
  requestId: string
): Promise<ApprovalRequestSummary> {
  await requireApprovalAccess(env, request, session, ['platform.approvals.read']);
  await expireApprovalRequests(
    env.CONTROL_DB,
    session.response.tenant.id,
    session.context.correlationId
  );
  return loadRequest(env.CONTROL_DB, session.response.tenant.id, requestId);
}

export async function upsertApprovalPolicy(
  env: Env,
  request: Request,
  session: ResolvedSession,
  policyKeyValue: string,
  input: UpsertApprovalPolicyRequest
): Promise<UpsertApprovalPolicyResponse> {
  await requireApprovalAccess(env, request, session, [
    'platform.approval-policies.manage'
  ]);
  const policyKey = normalizePolicyKey(policyKeyValue);
  const displayName = requiredText(input.displayName, 'displayName', 3, 120);
  const resourceType = normalizeResourceType(input.resourceType);
  const action = normalizeAction(input.action);
  const condition = normalizeCondition(input.condition);
  const steps = await normalizePolicySteps(env.CONTROL_DB, input.steps);
  const idempotencyKey = requireIdempotency(request);
  const requestHash = await sha256(
    stableJson({
      tenantId: session.response.tenant.id,
      policyKey,
      displayName,
      resourceType,
      action,
      condition,
      enabled: input.enabled,
      steps
    })
  );
  const scope = `platform.approval-policy.upsert:${policyKey}`;
  const replay = await readReplay<{ policyId: string }>(
    env.CONTROL_DB,
    session.response.tenant.id,
    scope,
    idempotencyKey,
    requestHash
  );
  if (replay) {
    return {
      policy: await loadPolicy(
        env.CONTROL_DB,
        session.response.tenant.id,
        replay.policyId
      ),
      replayed: true
    };
  }

  const existing = await env.CONTROL_DB.prepare(
    `SELECT id, version FROM approval_policies
     WHERE tenant_id = ?1 AND key = ?2`
  )
    .bind(session.response.tenant.id, policyKey)
    .first<{ id: string; version: number }>();
  const policyId = existing?.id ?? `pol_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + IDEMPOTENCY_TTL_MS).toISOString();
  const statements: D1PreparedStatement[] = [
    env.CONTROL_DB.prepare(
      `INSERT INTO idempotency_keys (
         tenant_id, scope, idempotency_key, request_hash,
         response_status, response_body, created_at, expires_at
       ) VALUES (?1, ?2, ?3, ?4, 200, ?5, ?6, ?7)`
    ).bind(
      session.response.tenant.id,
      scope,
      idempotencyKey,
      requestHash,
      JSON.stringify({ policyId }),
      now,
      expiresAt
    ),
    env.CONTROL_DB.prepare(
      `INSERT INTO approval_policies (
         id, tenant_id, key, display_name, resource_type, action,
         condition_json, enabled, created_at, updated_at, version
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9, 1)
       ON CONFLICT(tenant_id, key) DO UPDATE SET
         display_name = excluded.display_name,
         resource_type = excluded.resource_type,
         action = excluded.action,
         condition_json = excluded.condition_json,
         enabled = excluded.enabled,
         updated_at = excluded.updated_at,
         version = approval_policies.version + 1`
    ).bind(
      policyId,
      session.response.tenant.id,
      policyKey,
      displayName,
      resourceType,
      action,
      JSON.stringify(condition),
      input.enabled ? 1 : 0,
      now
    ),
    env.CONTROL_DB.prepare(
      `DELETE FROM approval_policy_steps WHERE policy_id = ?1`
    ).bind(policyId)
  ];

  for (const step of steps) {
    statements.push(
      env.CONTROL_DB.prepare(
        `INSERT INTO approval_policy_steps (
           policy_id, step_number, required_permission,
           minimum_approvers, self_approval_allowed
         ) VALUES (?1, ?2, ?3, ?4, ?5)`
      ).bind(
        policyId,
        step.stepNumber,
        step.requiredPermission,
        step.minimumApprovers,
        step.selfApprovalAllowed ? 1 : 0
      )
    );
  }

  statements.push(
    env.CONTROL_DB.prepare(
      `INSERT INTO audit_events (
         id, tenant_id, actor_type, actor_id, action, resource_type,
         resource_id, outcome, correlation_id, metadata_json, occurred_at
       ) VALUES (?1, ?2, 'user', ?3, 'platform.approval-policy.upsert',
         'approval-policy', ?4, 'success', ?5, ?6, ?7)`
    ).bind(
      crypto.randomUUID(),
      session.response.tenant.id,
      session.response.user.id,
      policyId,
      session.context.correlationId,
      JSON.stringify({
        policyKey,
        enabled: input.enabled,
        stepCount: steps.length,
        previousVersion: existing?.version ?? 0
      }),
      now
    ),
    env.CONTROL_DB.prepare(
      `INSERT INTO outbox_events (
         id, tenant_id, event_type, aggregate_type, aggregate_id,
         aggregate_version, payload_json, correlation_id, occurred_at
       ) SELECT ?1, ?2, 'platform.approval-policy.changed.v1',
         'approval-policy', p.id, p.version, ?3, ?4, ?5
       FROM approval_policies p
       WHERE p.tenant_id = ?2 AND p.id = ?6`
    ).bind(
      crypto.randomUUID(),
      session.response.tenant.id,
      JSON.stringify({
        policyId,
        policyKey,
        enabled: input.enabled,
        stepCount: steps.length
      }),
      session.context.correlationId,
      now,
      policyId
    )
  );

  try {
    await env.CONTROL_DB.batch(statements);
  } catch (error) {
    const concurrentReplay = await readReplay<{ policyId: string }>(
      env.CONTROL_DB,
      session.response.tenant.id,
      scope,
      idempotencyKey,
      requestHash
    );
    if (concurrentReplay) {
      return {
        policy: await loadPolicy(
          env.CONTROL_DB,
          session.response.tenant.id,
          concurrentReplay.policyId
        ),
        replayed: true
      };
    }
    throw error;
  }

  return {
    policy: await loadPolicy(env.CONTROL_DB, session.response.tenant.id, policyId),
    replayed: false
  };
}

export async function createApprovalRequest(
  env: Env,
  request: Request,
  session: ResolvedSession,
  input: CreateApprovalRequestRequest
): Promise<CreateApprovalRequestResponse> {
  await requireApprovalAccess(env, request, session, [
    'platform.approvals.request'
  ]);
  await ensureDefaultApprovalPolicy(env.CONTROL_DB, session.response.tenant.id);

  const policyKey = normalizePolicyKey(input.policyKey);
  const resourceType = normalizeResourceType(input.resourceType);
  const resourceId = requiredText(input.resourceId, 'resourceId', 1, 180);
  const action = normalizeAction(input.action);
  const title = requiredText(input.title, 'title', 3, 160);
  const description = optionalText(input.description, 2000);
  const payload = await validateSupportedAction(
    env.CONTROL_DB,
    session,
    resourceType,
    resourceId,
    action,
    input.payload
  );
  const policy = await loadEnabledPolicyByKey(
    env.CONTROL_DB,
    session.response.tenant.id,
    policyKey,
    resourceType,
    action
  );
  const idempotencyKey = requireIdempotency(request);
  const requestHash = await sha256(
    stableJson({
      tenantId: session.response.tenant.id,
      policyKey,
      resourceType,
      resourceId,
      action,
      title,
      description,
      payload
    })
  );
  const scope = `platform.approval-request.create:${policyKey}:${resourceType}:${resourceId}`;
  const replay = await readReplay<{ requestId: string }>(
    env.CONTROL_DB,
    session.response.tenant.id,
    scope,
    idempotencyKey,
    requestHash
  );
  if (replay) {
    return {
      request: await loadRequest(
        env.CONTROL_DB,
        session.response.tenant.id,
        replay.requestId
      ),
      replayed: true
    };
  }

  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + REQUEST_TTL_MS).toISOString();
  const idempotencyExpiresAt = new Date(
    Date.now() + IDEMPOTENCY_TTL_MS
  ).toISOString();
  const approvalRequestId = `apr_${crypto.randomUUID()}`;
  const payloadJson = stableJson(payload);
  const statements: D1PreparedStatement[] = [
    env.CONTROL_DB.prepare(
      `INSERT INTO idempotency_keys (
         tenant_id, scope, idempotency_key, request_hash,
         response_status, response_body, created_at, expires_at
       ) VALUES (?1, ?2, ?3, ?4, 201, ?5, ?6, ?7)`
    ).bind(
      session.response.tenant.id,
      scope,
      idempotencyKey,
      requestHash,
      JSON.stringify({ requestId: approvalRequestId }),
      now,
      idempotencyExpiresAt
    ),
    env.CONTROL_DB.prepare(
      `INSERT INTO approval_requests (
         id, tenant_id, policy_id, policy_key_snapshot, policy_name_snapshot,
         requester_user_id, resource_type, resource_id, action, title,
         description, payload_json, payload_hash, status, execution_status,
         current_step_number, total_steps, expires_at, correlation_id,
         created_at, updated_at, version
       ) VALUES (
         ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
         ?11, ?12, ?13, 'pending', 'pending', 1, ?14, ?15, ?16, ?17, ?17, 1
       )`
    ).bind(
      approvalRequestId,
      session.response.tenant.id,
      policy.id,
      policy.key,
      policy.displayName,
      session.response.user.id,
      resourceType,
      resourceId,
      action,
      title,
      description ?? null,
      payloadJson,
      await sha256(payloadJson),
      policy.steps.length,
      expiresAt,
      session.context.correlationId,
      now
    )
  ];

  for (const step of policy.steps) {
    statements.push(
      env.CONTROL_DB.prepare(
        `INSERT INTO approval_request_steps (
           request_id, step_number, required_permission,
           minimum_approvers, self_approval_allowed,
           status, approved_count
         ) VALUES (?1, ?2, ?3, ?4, ?5, 'pending', 0)`
      ).bind(
        approvalRequestId,
        step.stepNumber,
        step.requiredPermission,
        step.minimumApprovers,
        step.selfApprovalAllowed ? 1 : 0
      )
    );
  }

  statements.push(
    env.CONTROL_DB.prepare(
      `INSERT INTO audit_events (
         id, tenant_id, actor_type, actor_id, action, resource_type,
         resource_id, outcome, correlation_id, metadata_json, occurred_at
       ) VALUES (?1, ?2, 'user', ?3, 'platform.approval-request.create',
         'approval-request', ?4, 'success', ?5, ?6, ?7)`
    ).bind(
      crypto.randomUUID(),
      session.response.tenant.id,
      session.response.user.id,
      approvalRequestId,
      session.context.correlationId,
      JSON.stringify({
        policyKey,
        resourceType,
        resourceId,
        action,
        totalSteps: policy.steps.length
      }),
      now
    ),
    env.CONTROL_DB.prepare(
      `INSERT INTO outbox_events (
         id, tenant_id, event_type, aggregate_type, aggregate_id,
         aggregate_version, payload_json, correlation_id, occurred_at
       ) VALUES (?1, ?2, 'platform.approval-request.created.v1',
         'approval-request', ?3, 1, ?4, ?5, ?6)`
    ).bind(
      crypto.randomUUID(),
      session.response.tenant.id,
      approvalRequestId,
      JSON.stringify({
        requestId: approvalRequestId,
        policyKey,
        resourceType,
        resourceId,
        action,
        requesterUserId: session.response.user.id,
        expiresAt
      }),
      session.context.correlationId,
      now
    )
  );

  try {
    await env.CONTROL_DB.batch(statements);
  } catch (error) {
    const concurrentReplay = await readReplay<{ requestId: string }>(
      env.CONTROL_DB,
      session.response.tenant.id,
      scope,
      idempotencyKey,
      requestHash
    );
    if (concurrentReplay) {
      return {
        request: await loadRequest(
          env.CONTROL_DB,
          session.response.tenant.id,
          concurrentReplay.requestId
        ),
        replayed: true
      };
    }
    throw error;
  }

  return {
    request: await loadRequest(
      env.CONTROL_DB,
      session.response.tenant.id,
      approvalRequestId
    ),
    replayed: false
  };
}

export async function decideApprovalRequest(
  env: Env,
  request: Request,
  session: ResolvedSession,
  requestId: string,
  input: DecideApprovalRequestRequest
): Promise<DecideApprovalRequestResponse> {
  await requireApprovalAccess(env, request, session, [
    'platform.approvals.decide'
  ]);
  const decision = input.decision;
  if (decision !== 'approve' && decision !== 'reject') {
    throw validationError('decision must be approve or reject.');
  }
  const comment = optionalText(input.comment, 1000);
  if (decision === 'reject' && !comment) {
    throw validationError('A rejection comment is required.');
  }
  const idempotencyKey = requireIdempotency(request);
  const requestState = await loadPendingRequestState(
    env.CONTROL_DB,
    session.response.tenant.id,
    requestId
  );
  if (requestState.expires_at <= new Date().toISOString()) {
    await expireApprovalRequests(
      env.CONTROL_DB,
      session.response.tenant.id,
      session.context.correlationId
    );
    throw new PlatformHttpError({
      status: 409,
      type: 'https://fmcgbyalex.com/problems/approval-request-expired',
      title: 'Approval request has expired'
    });
  }
  const step = await env.CONTROL_DB.prepare(
    `SELECT request_id, step_number, required_permission, minimum_approvers,
            self_approval_allowed, status, approved_count, resolved_at
     FROM approval_request_steps
     WHERE request_id = ?1 AND step_number = ?2`
  )
    .bind(requestId, requestState.current_step_number)
    .first<RequestStepRow>();
  if (!step || step.status !== 'pending') {
    throw new PlatformHttpError({
      status: 409,
      type: 'https://fmcgbyalex.com/problems/approval-step-not-pending',
      title: 'The current approval step is not pending'
    });
  }
  if (
    requestState.requester_user_id === session.response.user.id &&
    step.self_approval_allowed !== 1
  ) {
    throw new PlatformHttpError({
      status: 403,
      type: 'https://fmcgbyalex.com/problems/self-approval-not-allowed',
      title: 'Self-approval is not allowed for this step'
    });
  }
  await enforcePermission(
    env.CONTROL_DB,
    request,
    session,
    step.required_permission,
    'platform.approval-request.decide'
  );

  const requestHash = await sha256(
    stableJson({
      tenantId: session.response.tenant.id,
      requestId,
      stepNumber: step.step_number,
      deciderUserId: session.response.user.id,
      decision,
      comment
    })
  );
  const scope = `platform.approval-request.decide:${requestId}:${step.step_number}:${session.response.user.id}`;
  const replay = await readReplay<{ requestId: string }>(
    env.CONTROL_DB,
    session.response.tenant.id,
    scope,
    idempotencyKey,
    requestHash
  );
  if (replay) {
    return {
      request: await loadRequest(
        env.CONTROL_DB,
        session.response.tenant.id,
        replay.requestId
      ),
      replayed: true
    };
  }

  const duplicate = await env.CONTROL_DB.prepare(
    `SELECT id FROM approval_decisions
     WHERE request_id = ?1 AND step_number = ?2 AND decider_user_id = ?3`
  )
    .bind(requestId, step.step_number, session.response.user.id)
    .first<{ id: string }>();
  if (duplicate) {
    throw new PlatformHttpError({
      status: 409,
      type: 'https://fmcgbyalex.com/problems/approval-already-decided',
      title: 'This user already decided the current step'
    });
  }

  const now = new Date().toISOString();
  const idempotencyExpiresAt = new Date(
    Date.now() + IDEMPOTENCY_TTL_MS
  ).toISOString();
  const decisionId = `apd_${crypto.randomUUID()}`;
  const statements: D1PreparedStatement[] = [
    env.CONTROL_DB.prepare(
      `INSERT INTO idempotency_keys (
         tenant_id, scope, idempotency_key, request_hash,
         response_status, response_body, created_at, expires_at
       ) VALUES (?1, ?2, ?3, ?4, 200, ?5, ?6, ?7)`
    ).bind(
      session.response.tenant.id,
      scope,
      idempotencyKey,
      requestHash,
      JSON.stringify({ requestId }),
      now,
      idempotencyExpiresAt
    ),
    env.CONTROL_DB.prepare(
      `INSERT INTO approval_decisions (
         id, tenant_id, request_id, step_number, decider_user_id,
         decision, comment, created_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
    ).bind(
      decisionId,
      session.response.tenant.id,
      requestId,
      step.step_number,
      session.response.user.id,
      decision,
      comment ?? null,
      now
    )
  ];

  if (decision === 'reject') {
    statements.push(
      env.CONTROL_DB.prepare(
        `UPDATE approval_request_steps
         SET status = 'rejected', resolved_at = ?1
         WHERE request_id = ?2 AND step_number = ?3 AND status = 'pending'`
      ).bind(now, requestId, step.step_number),
      env.CONTROL_DB.prepare(
        `UPDATE approval_requests
         SET status = 'rejected', execution_status = 'not-required',
             resolved_at = ?1, updated_at = ?1, version = version + 1
         WHERE tenant_id = ?2 AND id = ?3 AND status = 'pending'
           AND current_step_number = ?4`
      ).bind(now, session.response.tenant.id, requestId, step.step_number)
    );
  } else {
    statements.push(
      env.CONTROL_DB.prepare(
        `UPDATE approval_request_steps
         SET approved_count = (
               SELECT COUNT(*) FROM approval_decisions d
               WHERE d.request_id = ?1 AND d.step_number = ?2
                 AND d.decision = 'approve'
             ),
             status = CASE WHEN (
               SELECT COUNT(*) FROM approval_decisions d
               WHERE d.request_id = ?1 AND d.step_number = ?2
                 AND d.decision = 'approve'
             ) >= minimum_approvers THEN 'approved' ELSE 'pending' END,
             resolved_at = CASE WHEN (
               SELECT COUNT(*) FROM approval_decisions d
               WHERE d.request_id = ?1 AND d.step_number = ?2
                 AND d.decision = 'approve'
             ) >= minimum_approvers THEN ?3 ELSE NULL END
         WHERE request_id = ?1 AND step_number = ?2 AND status = 'pending'`
      ).bind(requestId, step.step_number, now)
    );
    statements.push(
      ...approvedActionStatements(
        env.CONTROL_DB,
        session,
        requestId,
        requestState,
        step.step_number,
        now
      )
    );
    statements.push(
      env.CONTROL_DB.prepare(
        `UPDATE approval_requests
         SET status = CASE
               WHEN EXISTS (
                 SELECT 1 FROM approval_request_steps s
                 WHERE s.request_id = approval_requests.id
                   AND s.step_number = approval_requests.current_step_number
                   AND s.status = 'approved'
               )
               AND NOT EXISTS (
                 SELECT 1 FROM approval_request_steps n
                 WHERE n.request_id = approval_requests.id
                   AND n.step_number > approval_requests.current_step_number
               ) THEN 'approved'
               ELSE status
             END,
             execution_status = CASE
               WHEN EXISTS (
                 SELECT 1 FROM approval_request_steps s
                 WHERE s.request_id = approval_requests.id
                   AND s.step_number = approval_requests.current_step_number
                   AND s.status = 'approved'
               )
               AND NOT EXISTS (
                 SELECT 1 FROM approval_request_steps n
                 WHERE n.request_id = approval_requests.id
                   AND n.step_number > approval_requests.current_step_number
               ) THEN 'completed'
               ELSE execution_status
             END,
             current_step_number = CASE
               WHEN EXISTS (
                 SELECT 1 FROM approval_request_steps s
                 WHERE s.request_id = approval_requests.id
                   AND s.step_number = approval_requests.current_step_number
                   AND s.status = 'approved'
               )
               AND EXISTS (
                 SELECT 1 FROM approval_request_steps n
                 WHERE n.request_id = approval_requests.id
                   AND n.step_number = approval_requests.current_step_number + 1
               ) THEN current_step_number + 1
               ELSE current_step_number
             END,
             resolved_at = CASE
               WHEN EXISTS (
                 SELECT 1 FROM approval_request_steps s
                 WHERE s.request_id = approval_requests.id
                   AND s.step_number = approval_requests.current_step_number
                   AND s.status = 'approved'
               )
               AND NOT EXISTS (
                 SELECT 1 FROM approval_request_steps n
                 WHERE n.request_id = approval_requests.id
                   AND n.step_number > approval_requests.current_step_number
               ) THEN ?1
               ELSE resolved_at
             END,
             updated_at = ?1,
             version = version + 1
         WHERE tenant_id = ?2 AND id = ?3 AND status = 'pending'
           AND current_step_number = ?4
           AND EXISTS (
             SELECT 1 FROM approval_request_steps s
             WHERE s.request_id = approval_requests.id
               AND s.step_number = approval_requests.current_step_number
               AND s.status = 'approved'
           )`
      ).bind(now, session.response.tenant.id, requestId, step.step_number)
    );
  }

  statements.push(
    env.CONTROL_DB.prepare(
      `INSERT INTO audit_events (
         id, tenant_id, actor_type, actor_id, action, resource_type,
         resource_id, outcome, correlation_id, metadata_json, occurred_at
       ) VALUES (?1, ?2, 'user', ?3, 'platform.approval-request.decide',
         'approval-request', ?4, 'success', ?5, ?6, ?7)`
    ).bind(
      crypto.randomUUID(),
      session.response.tenant.id,
      session.response.user.id,
      requestId,
      session.context.correlationId,
      JSON.stringify({
        decisionId,
        decision,
        stepNumber: step.step_number,
        requiredPermission: step.required_permission
      }),
      now
    ),
    env.CONTROL_DB.prepare(
      `INSERT INTO outbox_events (
         id, tenant_id, event_type, aggregate_type, aggregate_id,
         aggregate_version, payload_json, correlation_id, occurred_at
       ) SELECT ?1, ?2, 'platform.approval-request.decision-recorded.v1',
         'approval-request', r.id, r.version, ?3, ?4, ?5
       FROM approval_requests r
       WHERE r.tenant_id = ?2 AND r.id = ?6`
    ).bind(
      crypto.randomUUID(),
      session.response.tenant.id,
      JSON.stringify({
        requestId,
        decisionId,
        decision,
        stepNumber: step.step_number,
        deciderUserId: session.response.user.id
      }),
      session.context.correlationId,
      now,
      requestId
    )
  );

  try {
    await env.CONTROL_DB.batch(statements);
  } catch (error) {
    const concurrentReplay = await readReplay<{ requestId: string }>(
      env.CONTROL_DB,
      session.response.tenant.id,
      scope,
      idempotencyKey,
      requestHash
    );
    if (concurrentReplay) {
      return {
        request: await loadRequest(
          env.CONTROL_DB,
          session.response.tenant.id,
          concurrentReplay.requestId
        ),
        replayed: true
      };
    }
    throw error;
  }

  return {
    request: await loadRequest(env.CONTROL_DB, session.response.tenant.id, requestId),
    replayed: false
  };
}

export async function cancelApprovalRequest(
  env: Env,
  request: Request,
  session: ResolvedSession,
  requestId: string
): Promise<CancelApprovalRequestResponse> {
  await requireApprovalAccess(env, request, session, ['platform.approvals.request']);
  const state = await loadPendingRequestState(
    env.CONTROL_DB,
    session.response.tenant.id,
    requestId
  );
  const canOverride = session.context.permissions.has('platform.approvals.decide');
  if (state.requester_user_id !== session.response.user.id && !canOverride) {
    throw new PlatformHttpError({
      status: 403,
      type: 'https://fmcgbyalex.com/problems/approval-cancel-denied',
      title: 'Only the requester or an approval administrator can cancel this request'
    });
  }
  const idempotencyKey = requireIdempotency(request);
  const requestHash = await sha256(
    stableJson({
      tenantId: session.response.tenant.id,
      requestId,
      actorUserId: session.response.user.id
    })
  );
  const scope = `platform.approval-request.cancel:${requestId}`;
  const replay = await readReplay<{ requestId: string }>(
    env.CONTROL_DB,
    session.response.tenant.id,
    scope,
    idempotencyKey,
    requestHash
  );
  if (replay) {
    return {
      request: await loadRequest(
        env.CONTROL_DB,
        session.response.tenant.id,
        replay.requestId
      ),
      replayed: true
    };
  }

  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + IDEMPOTENCY_TTL_MS).toISOString();
  await env.CONTROL_DB.batch([
    env.CONTROL_DB.prepare(
      `INSERT INTO idempotency_keys (
         tenant_id, scope, idempotency_key, request_hash,
         response_status, response_body, created_at, expires_at
       ) VALUES (?1, ?2, ?3, ?4, 200, ?5, ?6, ?7)`
    ).bind(
      session.response.tenant.id,
      scope,
      idempotencyKey,
      requestHash,
      JSON.stringify({ requestId }),
      now,
      expiresAt
    ),
    env.CONTROL_DB.prepare(
      `UPDATE approval_requests
       SET status = 'cancelled', execution_status = 'not-required',
           resolved_at = ?1, updated_at = ?1, version = version + 1
       WHERE tenant_id = ?2 AND id = ?3 AND status = 'pending'`
    ).bind(now, session.response.tenant.id, requestId),
    env.CONTROL_DB.prepare(
      `INSERT INTO audit_events (
         id, tenant_id, actor_type, actor_id, action, resource_type,
         resource_id, outcome, correlation_id, metadata_json, occurred_at
       ) VALUES (?1, ?2, 'user', ?3, 'platform.approval-request.cancel',
         'approval-request', ?4, 'success', ?5, '{}', ?6)`
    ).bind(
      crypto.randomUUID(),
      session.response.tenant.id,
      session.response.user.id,
      requestId,
      session.context.correlationId,
      now
    ),
    env.CONTROL_DB.prepare(
      `INSERT INTO outbox_events (
         id, tenant_id, event_type, aggregate_type, aggregate_id,
         aggregate_version, payload_json, correlation_id, occurred_at
       ) SELECT ?1, ?2, 'platform.approval-request.cancelled.v1',
         'approval-request', r.id, r.version, ?3, ?4, ?5
       FROM approval_requests r
       WHERE r.tenant_id = ?2 AND r.id = ?6`
    ).bind(
      crypto.randomUUID(),
      session.response.tenant.id,
      JSON.stringify({ requestId, actorUserId: session.response.user.id }),
      session.context.correlationId,
      now,
      requestId
    )
  ]);

  return {
    request: await loadRequest(env.CONTROL_DB, session.response.tenant.id, requestId),
    replayed: false
  };
}

export async function requireDirectModuleChangeAllowed(
  env: Env,
  session: ResolvedSession
): Promise<void> {
  await ensureDefaultApprovalPolicy(env.CONTROL_DB, session.response.tenant.id);
  const policy = await env.CONTROL_DB.prepare(
    `SELECT id FROM approval_policies
     WHERE tenant_id = ?1 AND resource_type = ?2 AND action = ?3 AND enabled = 1
     ORDER BY created_at, id LIMIT 1`
  )
    .bind(session.response.tenant.id, MODULE_RESOURCE_TYPE, MODULE_ACTION)
    .first<{ id: string }>();
  if (policy) {
    throw new PlatformHttpError({
      status: 409,
      type: 'https://fmcgbyalex.com/problems/approval-required',
      title: 'Approval is required for module entitlement changes',
      detail: `Submit an approval request using policy ${DEFAULT_POLICY_KEY}.`
    });
  }
}

async function requireApprovalAccess(
  env: Env,
  request: Request,
  session: ResolvedSession,
  permissions: string[]
): Promise<void> {
  await enforceModule(
    env.CONTROL_DB,
    request,
    session,
    'platform',
    'platform.approvals.access'
  );
  for (const permission of permissions) {
    await enforcePermission(
      env.CONTROL_DB,
      request,
      session,
      permission,
      'platform.approvals.access'
    );
  }
}

async function ensureDefaultApprovalPolicy(
  db: D1Database,
  tenantId: string
): Promise<void> {
  const policyId = `pol_module_${tenantId}`;
  const now = new Date().toISOString();
  await db.batch([
    db.prepare(
      `INSERT OR IGNORE INTO approval_policies (
         id, tenant_id, key, display_name, resource_type, action,
         condition_json, enabled, created_at, updated_at, version
       ) VALUES (?1, ?2, ?3, 'Module entitlement change', ?4, ?5, '{}', 1, ?6, ?6, 1)`
    ).bind(
      policyId,
      tenantId,
      DEFAULT_POLICY_KEY,
      MODULE_RESOURCE_TYPE,
      MODULE_ACTION,
      now
    ),
    db.prepare(
      `INSERT OR IGNORE INTO approval_policy_steps (
         policy_id, step_number, required_permission,
         minimum_approvers, self_approval_allowed
       ) VALUES (?1, 1, 'platform.modules.manage', 1, 0)`
    ).bind(policyId)
  ]);
}

async function validateSupportedAction(
  db: D1Database,
  session: ResolvedSession,
  resourceType: string,
  resourceId: string,
  action: string,
  payload: Record<string, unknown>
): Promise<Record<string, unknown>> {
  if (action !== MODULE_ACTION || resourceType !== MODULE_RESOURCE_TYPE) {
    throw new PlatformHttpError({
      status: 400,
      type: 'https://fmcgbyalex.com/problems/unsupported-approval-action',
      title: 'This approval action is not supported yet'
    });
  }
  if (!(MODULE_KEYS as readonly string[]).includes(resourceId)) {
    throw new PlatformHttpError({
      status: 404,
      type: 'https://fmcgbyalex.com/problems/module-not-found',
      title: 'Module not found'
    });
  }
  if (typeof payload.enabled !== 'boolean') {
    throw validationError('payload.enabled must be a boolean.');
  }
  const module = await db.prepare(
    `SELECT enabled, version FROM tenant_modules
     WHERE tenant_id = ?1 AND module_key = ?2`
  )
    .bind(session.response.tenant.id, resourceId)
    .first<ModuleRow>();
  if (!module) {
    throw new PlatformHttpError({
      status: 404,
      type: 'https://fmcgbyalex.com/problems/module-not-found',
      title: 'Module not found'
    });
  }
  if ((module.enabled === 1) === payload.enabled) {
    throw new PlatformHttpError({
      status: 409,
      type: 'https://fmcgbyalex.com/problems/no-change-requested',
      title: 'The requested module state is already active'
    });
  }
  return {
    enabled: payload.enabled,
    expectedVersion: module.version
  };
}

function approvedActionStatements(
  db: D1Database,
  session: ResolvedSession,
  requestId: string,
  requestState: RequestStatusRow,
  stepNumber: number,
  now: string
): D1PreparedStatement[] {
  if (
    requestState.action !== MODULE_ACTION ||
    requestState.resource_type !== MODULE_RESOURCE_TYPE
  ) {
    return [];
  }
  const payload = parseObject(requestState.payload_json, 'approval payload');
  const enabled = payload.enabled;
  if (typeof enabled !== 'boolean') {
    throw new PlatformHttpError({
      status: 500,
      type: 'https://fmcgbyalex.com/problems/approval-payload-invalid',
      title: 'Approval payload is invalid'
    });
  }
  const finalStepCondition = `
    EXISTS (
      SELECT 1
      FROM approval_requests ar
      JOIN approval_request_steps s
        ON s.request_id = ar.id AND s.step_number = ar.current_step_number
      WHERE ar.id = ?5 AND ar.tenant_id = ?3 AND ar.status = 'pending'
        AND ar.current_step_number = ?6
        AND s.status = 'approved'
        AND NOT EXISTS (
          SELECT 1 FROM approval_request_steps n
          WHERE n.request_id = ar.id AND n.step_number > ar.current_step_number
        )
    )`;

  return [
    db.prepare(
      `UPDATE tenant_modules
       SET enabled = ?1,
           enabled_at = CASE WHEN ?1 = 1 THEN ?2 ELSE enabled_at END,
           disabled_at = CASE WHEN ?1 = 0 THEN ?2 ELSE NULL END,
           updated_at = ?2,
           version = version + 1
       WHERE tenant_id = ?3 AND module_key = ?4
         AND ${finalStepCondition}`
    ).bind(
      enabled ? 1 : 0,
      now,
      session.response.tenant.id,
      requestState.resource_id,
      requestId,
      stepNumber
    ),
    db.prepare(
      `INSERT INTO audit_events (
         id, tenant_id, actor_type, actor_id, action, resource_type,
         resource_id, outcome, correlation_id, metadata_json, occurred_at
       ) SELECT ?1, ?2, 'system', ?3, 'platform.module-entitlement.approved',
         'module', ?4, 'success', ?5, ?6, ?7
       WHERE EXISTS (
         SELECT 1
         FROM approval_requests ar
         JOIN approval_request_steps s
           ON s.request_id = ar.id AND s.step_number = ar.current_step_number
         WHERE ar.id = ?3 AND ar.tenant_id = ?2 AND ar.status = 'pending'
           AND ar.current_step_number = ?8
           AND s.status = 'approved'
           AND NOT EXISTS (
             SELECT 1 FROM approval_request_steps n
             WHERE n.request_id = ar.id AND n.step_number > ar.current_step_number
           )
       )`
    ).bind(
      crypto.randomUUID(),
      session.response.tenant.id,
      requestId,
      requestState.resource_id,
      session.context.correlationId,
      JSON.stringify({ approvalRequestId: requestId, enabled }),
      now,
      stepNumber
    ),
    db.prepare(
      `INSERT INTO outbox_events (
         id, tenant_id, event_type, aggregate_type, aggregate_id,
         aggregate_version, payload_json, correlation_id, occurred_at
       ) SELECT ?1, ?2, 'platform.module-entitlement.changed.v1',
         'module-entitlement', tm.module_key, tm.version, ?3, ?4, ?5
       FROM tenant_modules tm
       WHERE tm.tenant_id = ?2 AND tm.module_key = ?6
         AND EXISTS (
           SELECT 1
           FROM approval_requests ar
           JOIN approval_request_steps s
             ON s.request_id = ar.id AND s.step_number = ar.current_step_number
           WHERE ar.id = ?7 AND ar.tenant_id = ?2 AND ar.status = 'pending'
             AND ar.current_step_number = ?8
             AND s.status = 'approved'
             AND NOT EXISTS (
               SELECT 1 FROM approval_request_steps n
               WHERE n.request_id = ar.id AND n.step_number > ar.current_step_number
             )
         )`
    ).bind(
      crypto.randomUUID(),
      session.response.tenant.id,
      JSON.stringify({
        moduleKey: requestState.resource_id,
        enabled,
        approvalRequestId: requestId
      }),
      session.context.correlationId,
      now,
      requestState.resource_id,
      requestId,
      stepNumber
    )
  ];
}

async function loadWorkspace(
  db: D1Database,
  tenantId: string
): Promise<ApprovalWorkspaceResponse> {
  const [policies, policySteps, requests, requestSteps, decisions] =
    await Promise.all([
      db.prepare(
        `SELECT id, key, display_name, resource_type, action, condition_json,
                enabled, created_at, updated_at, version
         FROM approval_policies
         WHERE tenant_id = ?1
         ORDER BY display_name, key`
      )
        .bind(tenantId)
        .all<PolicyRow>(),
      db.prepare(
        `SELECT s.policy_id, s.step_number, s.required_permission,
                s.minimum_approvers, s.self_approval_allowed
         FROM approval_policy_steps s
         JOIN approval_policies p ON p.id = s.policy_id
         WHERE p.tenant_id = ?1
         ORDER BY s.policy_id, s.step_number`
      )
        .bind(tenantId)
        .all<PolicyStepRow>(),
      db.prepare(
        `SELECT
           r.id, r.policy_id, r.policy_key_snapshot, r.policy_name_snapshot,
           r.requester_user_id, u.display_name AS requester_display_name,
           r.resource_type, r.resource_id, r.action, r.title, r.description,
           r.payload_json, r.status, r.execution_status,
           r.current_step_number, r.total_steps, r.expires_at, r.resolved_at,
           r.created_at, r.updated_at, r.version
         FROM approval_requests r
         JOIN users u ON u.id = r.requester_user_id
         WHERE r.tenant_id = ?1
         ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END,
                  r.created_at DESC
         LIMIT 100`
      )
        .bind(tenantId)
        .all<RequestRow>(),
      db.prepare(
        `SELECT s.request_id, s.step_number, s.required_permission,
                s.minimum_approvers, s.self_approval_allowed, s.status,
                s.approved_count, s.resolved_at
         FROM approval_request_steps s
         JOIN approval_requests r ON r.id = s.request_id
         WHERE r.tenant_id = ?1
         ORDER BY s.request_id, s.step_number`
      )
        .bind(tenantId)
        .all<RequestStepRow>(),
      db.prepare(
        `SELECT d.id, d.request_id, d.step_number, d.decider_user_id,
                u.display_name AS decider_display_name, d.decision,
                d.comment, d.created_at
         FROM approval_decisions d
         JOIN users u ON u.id = d.decider_user_id
         WHERE d.tenant_id = ?1
         ORDER BY d.request_id, d.step_number, d.created_at`
      )
        .bind(tenantId)
        .all<DecisionRow>()
    ]);

  const policyStepMap = groupBy(policySteps.results, (row) => row.policy_id);
  const requestStepMap = groupBy(requestSteps.results, (row) => row.request_id);
  const decisionMap = groupBy(decisions.results, (row) => row.request_id);

  return {
    policies: policies.results.map((policy) =>
      toPolicySummary(policy, policyStepMap.get(policy.id) ?? [])
    ),
    requests: requests.results.map((approvalRequest) =>
      toRequestSummary(
        approvalRequest,
        requestStepMap.get(approvalRequest.id) ?? [],
        decisionMap.get(approvalRequest.id) ?? []
      )
    )
  };
}

async function loadPolicy(
  db: D1Database,
  tenantId: string,
  policyId: string
): Promise<ApprovalPolicySummary> {
  const policy = await db.prepare(
    `SELECT id, key, display_name, resource_type, action, condition_json,
            enabled, created_at, updated_at, version
     FROM approval_policies
     WHERE tenant_id = ?1 AND id = ?2`
  )
    .bind(tenantId, policyId)
    .first<PolicyRow>();
  if (!policy) {
    throw new PlatformHttpError({
      status: 404,
      type: 'https://fmcgbyalex.com/problems/approval-policy-not-found',
      title: 'Approval policy not found'
    });
  }
  const steps = await db.prepare(
    `SELECT policy_id, step_number, required_permission,
            minimum_approvers, self_approval_allowed
     FROM approval_policy_steps
     WHERE policy_id = ?1 ORDER BY step_number`
  )
    .bind(policyId)
    .all<PolicyStepRow>();
  return toPolicySummary(policy, steps.results);
}

async function loadEnabledPolicyByKey(
  db: D1Database,
  tenantId: string,
  policyKey: string,
  resourceType: string,
  action: string
): Promise<ApprovalPolicySummary> {
  const policy = await db.prepare(
    `SELECT id, key, display_name, resource_type, action, condition_json,
            enabled, created_at, updated_at, version
     FROM approval_policies
     WHERE tenant_id = ?1 AND key = ?2 AND enabled = 1
       AND resource_type = ?3 AND action = ?4`
  )
    .bind(tenantId, policyKey, resourceType, action)
    .first<PolicyRow>();
  if (!policy) {
    throw new PlatformHttpError({
      status: 404,
      type: 'https://fmcgbyalex.com/problems/approval-policy-not-found',
      title: 'No enabled approval policy matches this action'
    });
  }
  const steps = await db.prepare(
    `SELECT policy_id, step_number, required_permission,
            minimum_approvers, self_approval_allowed
     FROM approval_policy_steps
     WHERE policy_id = ?1 ORDER BY step_number`
  )
    .bind(policy.id)
    .all<PolicyStepRow>();
  if (steps.results.length === 0) {
    throw new PlatformHttpError({
      status: 409,
      type: 'https://fmcgbyalex.com/problems/approval-policy-invalid',
      title: 'Approval policy has no decision steps'
    });
  }
  return toPolicySummary(policy, steps.results);
}

async function loadRequest(
  db: D1Database,
  tenantId: string,
  requestId: string
): Promise<ApprovalRequestSummary> {
  const request = await db.prepare(
    `SELECT
       r.id, r.policy_id, r.policy_key_snapshot, r.policy_name_snapshot,
       r.requester_user_id, u.display_name AS requester_display_name,
       r.resource_type, r.resource_id, r.action, r.title, r.description,
       r.payload_json, r.status, r.execution_status,
       r.current_step_number, r.total_steps, r.expires_at, r.resolved_at,
       r.created_at, r.updated_at, r.version
     FROM approval_requests r
     JOIN users u ON u.id = r.requester_user_id
     WHERE r.tenant_id = ?1 AND r.id = ?2`
  )
    .bind(tenantId, requestId)
    .first<RequestRow>();
  if (!request) {
    throw new PlatformHttpError({
      status: 404,
      type: 'https://fmcgbyalex.com/problems/approval-request-not-found',
      title: 'Approval request not found'
    });
  }
  const [steps, decisions] = await Promise.all([
    db.prepare(
      `SELECT request_id, step_number, required_permission,
              minimum_approvers, self_approval_allowed, status,
              approved_count, resolved_at
       FROM approval_request_steps
       WHERE request_id = ?1 ORDER BY step_number`
    )
      .bind(requestId)
      .all<RequestStepRow>(),
    db.prepare(
      `SELECT d.id, d.request_id, d.step_number, d.decider_user_id,
              u.display_name AS decider_display_name, d.decision,
              d.comment, d.created_at
       FROM approval_decisions d
       JOIN users u ON u.id = d.decider_user_id
       WHERE d.tenant_id = ?1 AND d.request_id = ?2
       ORDER BY d.step_number, d.created_at`
    )
      .bind(tenantId, requestId)
      .all<DecisionRow>()
  ]);
  return toRequestSummary(request, steps.results, decisions.results);
}

async function loadPendingRequestState(
  db: D1Database,
  tenantId: string,
  requestId: string
): Promise<RequestStatusRow> {
  const approvalRequest = await db.prepare(
    `SELECT status, requester_user_id, current_step_number, expires_at,
            action, resource_type, resource_id, payload_json
     FROM approval_requests
     WHERE tenant_id = ?1 AND id = ?2`
  )
    .bind(tenantId, requestId)
    .first<RequestStatusRow>();
  if (!approvalRequest) {
    throw new PlatformHttpError({
      status: 404,
      type: 'https://fmcgbyalex.com/problems/approval-request-not-found',
      title: 'Approval request not found'
    });
  }
  if (approvalRequest.status !== 'pending') {
    throw new PlatformHttpError({
      status: 409,
      type: 'https://fmcgbyalex.com/problems/approval-request-resolved',
      title: `Approval request is already ${approvalRequest.status}`
    });
  }
  return approvalRequest;
}

async function expireApprovalRequests(
  db: D1Database,
  tenantId: string,
  correlationId: string
): Promise<void> {
  const now = new Date().toISOString();
  const expired = await db.prepare(
    `SELECT id FROM approval_requests
     WHERE tenant_id = ?1 AND status = 'pending' AND expires_at <= ?2`
  )
    .bind(tenantId, now)
    .all<{ id: string }>();
  if (expired.results.length === 0) {
    return;
  }
  const statements: D1PreparedStatement[] = [];
  for (const item of expired.results) {
    statements.push(
      db.prepare(
        `UPDATE approval_requests
         SET status = 'expired', execution_status = 'not-required',
             resolved_at = ?1, updated_at = ?1, version = version + 1
         WHERE tenant_id = ?2 AND id = ?3 AND status = 'pending'`
      ).bind(now, tenantId, item.id),
      db.prepare(
        `INSERT INTO audit_events (
           id, tenant_id, actor_type, actor_id, action, resource_type,
           resource_id, outcome, correlation_id, metadata_json, occurred_at
         ) VALUES (?1, ?2, 'system', NULL, 'platform.approval-request.expire',
           'approval-request', ?3, 'success', ?4, '{}', ?5)`
      ).bind(crypto.randomUUID(), tenantId, item.id, correlationId, now),
      db.prepare(
        `INSERT INTO outbox_events (
           id, tenant_id, event_type, aggregate_type, aggregate_id,
           aggregate_version, payload_json, correlation_id, occurred_at
         ) SELECT ?1, ?2, 'platform.approval-request.expired.v1',
           'approval-request', r.id, r.version, ?3, ?4, ?5
         FROM approval_requests r
         WHERE r.tenant_id = ?2 AND r.id = ?6`
      ).bind(
        crypto.randomUUID(),
        tenantId,
        JSON.stringify({ requestId: item.id }),
        correlationId,
        now,
        item.id
      )
    );
  }
  await db.batch(statements);
}

async function normalizePolicySteps(
  db: D1Database,
  input: UpsertApprovalPolicyRequest['steps']
): Promise<ApprovalPolicyStep[]> {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_POLICY_STEPS) {
    throw validationError(`steps must contain between 1 and ${MAX_POLICY_STEPS} items.`);
  }
  const steps = input.map((step, index) => {
    const requiredPermission = requiredText(
      step.requiredPermission,
      `steps[${index}].requiredPermission`,
      3,
      160
    );
    if (
      !Number.isInteger(step.minimumApprovers) ||
      step.minimumApprovers < 1 ||
      step.minimumApprovers > 10
    ) {
      throw validationError(
        `steps[${index}].minimumApprovers must be an integer from 1 to 10.`
      );
    }
    if (typeof step.selfApprovalAllowed !== 'boolean') {
      throw validationError(
        `steps[${index}].selfApprovalAllowed must be a boolean.`
      );
    }
    return {
      stepNumber: index + 1,
      requiredPermission,
      minimumApprovers: step.minimumApprovers,
      selfApprovalAllowed: step.selfApprovalAllowed
    };
  });
  const uniquePermissions = [...new Set(steps.map((step) => step.requiredPermission))];
  const placeholders = uniquePermissions.map((_, index) => `?${index + 1}`).join(',');
  const result = await db.prepare(
    `SELECT key FROM permissions WHERE key IN (${placeholders})`
  )
    .bind(...uniquePermissions)
    .all<PermissionRow>();
  const available = new Set(result.results.map((row) => row.key));
  const missing = uniquePermissions.filter((permission) => !available.has(permission));
  if (missing.length > 0) {
    throw validationError(`Unknown required permission: ${missing.join(', ')}.`);
  }
  return steps;
}

function toPolicySummary(
  policy: PolicyRow,
  steps: PolicyStepRow[]
): ApprovalPolicySummary {
  return {
    id: policy.id,
    key: policy.key,
    displayName: policy.display_name,
    resourceType: policy.resource_type,
    action: policy.action,
    condition: parseObject(policy.condition_json, 'policy condition'),
    enabled: policy.enabled === 1,
    steps: steps.map((step) => ({
      stepNumber: step.step_number,
      requiredPermission: step.required_permission,
      minimumApprovers: step.minimum_approvers,
      selfApprovalAllowed: step.self_approval_allowed === 1
    })),
    version: policy.version,
    createdAt: policy.created_at,
    updatedAt: policy.updated_at
  };
}

function toRequestSummary(
  approvalRequest: RequestRow,
  steps: RequestStepRow[],
  decisions: DecisionRow[]
): ApprovalRequestSummary {
  const decisionMap = groupBy(decisions, (decision) => decision.step_number);
  const requestSteps: ApprovalRequestStepSummary[] = steps.map((step) => ({
    stepNumber: step.step_number,
    requiredPermission: step.required_permission,
    minimumApprovers: step.minimum_approvers,
    selfApprovalAllowed: step.self_approval_allowed === 1,
    status: step.status,
    approvedCount: step.approved_count,
    resolvedAt: step.resolved_at,
    decisions: (decisionMap.get(step.step_number) ?? []).map(toDecisionSummary)
  }));
  return {
    id: approvalRequest.id,
    policyKey: approvalRequest.policy_key_snapshot,
    policyDisplayName: approvalRequest.policy_name_snapshot,
    requesterUserId: approvalRequest.requester_user_id,
    requesterDisplayName: approvalRequest.requester_display_name,
    resourceType: approvalRequest.resource_type,
    resourceId: approvalRequest.resource_id,
    action: approvalRequest.action,
    title: approvalRequest.title,
    description: approvalRequest.description,
    payload: parseObject(approvalRequest.payload_json, 'approval payload'),
    status: approvalRequest.status,
    executionStatus: approvalRequest.execution_status,
    currentStepNumber: approvalRequest.current_step_number,
    totalSteps: approvalRequest.total_steps,
    steps: requestSteps,
    expiresAt: approvalRequest.expires_at,
    resolvedAt: approvalRequest.resolved_at,
    createdAt: approvalRequest.created_at,
    updatedAt: approvalRequest.updated_at,
    version: approvalRequest.version
  };
}

function toDecisionSummary(decision: DecisionRow): ApprovalDecisionSummary {
  return {
    id: decision.id,
    stepNumber: decision.step_number,
    deciderUserId: decision.decider_user_id,
    deciderDisplayName: decision.decider_display_name,
    decision: decision.decision,
    comment: decision.comment,
    createdAt: decision.created_at
  };
}

async function readReplay<T>(
  db: D1Database,
  tenantId: string,
  scope: string,
  idempotencyKey: string,
  requestHash: string
): Promise<T | null> {
  const existing = await db.prepare(
    `SELECT request_hash, response_body
     FROM idempotency_keys
     WHERE tenant_id = ?1 AND scope = ?2 AND idempotency_key = ?3
       AND expires_at > ?4`
  )
    .bind(tenantId, scope, idempotencyKey, new Date().toISOString())
    .first<IdempotencyRow>();
  if (!existing) {
    return null;
  }
  if (existing.request_hash !== requestHash) {
    throw new PlatformHttpError({
      status: 409,
      type: 'https://fmcgbyalex.com/problems/idempotency-key-conflict',
      title: 'Idempotency key conflict',
      detail: 'The key was already used for another approval command.'
    });
  }
  if (!existing.response_body) {
    throw new PlatformHttpError({
      status: 409,
      type: 'https://fmcgbyalex.com/problems/request-in-progress',
      title: 'An identical approval command is already in progress'
    });
  }
  return JSON.parse(existing.response_body) as T;
}

function requireIdempotency(request: Request): string {
  const value = request.headers.get('Idempotency-Key')?.trim() ?? '';
  if (!IDEMPOTENCY_PATTERN.test(value)) {
    throw new PlatformHttpError({
      status: 400,
      type: 'https://fmcgbyalex.com/problems/idempotency-key-required',
      title: 'A valid Idempotency-Key header is required'
    });
  }
  return value;
}

function normalizePolicyKey(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!POLICY_KEY_PATTERN.test(normalized) || normalized.length > 100) {
    throw validationError('policyKey must be a lowercase URL-safe key.');
  }
  return normalized;
}

function normalizeResourceType(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!RESOURCE_TYPE_PATTERN.test(normalized) || normalized.length > 100) {
    throw validationError('resourceType must be a lowercase resource key.');
  }
  return normalized;
}

function normalizeAction(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!ACTION_PATTERN.test(normalized) || normalized.length > 160) {
    throw validationError('action must be a lowercase dot-separated action key.');
  }
  return normalized;
}

function normalizeCondition(
  value: Record<string, unknown> | undefined
): Record<string, unknown> {
  if (value === undefined) {
    return {};
  }
  if (!isPlainObject(value)) {
    throw validationError('condition must be a JSON object.');
  }
  const serialized = stableJson(value);
  if (serialized.length > 4000) {
    throw validationError('condition must not exceed 4000 JSON characters.');
  }
  return JSON.parse(serialized) as Record<string, unknown>;
}

function requiredText(
  value: string,
  field: string,
  minimum: number,
  maximum: number
): string {
  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > maximum) {
    throw validationError(
      `${field} must contain ${minimum} to ${maximum} characters.`
    );
  }
  return normalized;
}

function optionalText(
  value: string | undefined,
  maximum: number
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }
  if (normalized.length > maximum) {
    throw validationError(`Text must not exceed ${maximum} characters.`);
  }
  return normalized;
}

function validationError(detail: string): PlatformHttpError {
  return new PlatformHttpError({
    status: 400,
    type: 'https://fmcgbyalex.com/problems/validation-error',
    title: 'Request validation failed',
    detail
  });
}

function parseObject(value: string, label: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isPlainObject(parsed)) {
      throw new Error('not object');
    }
    return parsed;
  } catch {
    throw new PlatformHttpError({
      status: 500,
      type: 'https://fmcgbyalex.com/problems/stored-json-invalid',
      title: `Stored ${label} is invalid`
    });
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortJson(child)])
    );
  }
  return value;
}

function groupBy<T, K>(values: T[], keyOf: (value: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const value of values) {
    const key = keyOf(value);
    const group = groups.get(key) ?? [];
    group.push(value);
    groups.set(key, group);
  }
  return groups;
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
