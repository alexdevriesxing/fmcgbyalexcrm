import type {
  CompleteCrmTaskResponse,
  CreateCrmAccountRequest,
  CreateCrmAccountResponse,
  CreateCrmActivityRequest,
  CreateCrmActivityResponse,
  CreateCrmContactRequest,
  CreateCrmContactResponse,
  CreateCrmTaskRequest,
  CreateCrmTaskResponse,
  CreateOpportunityRequest,
  CreateOpportunityResponse,
  CrmAccountSummary,
  CrmActivitySummary,
  CrmContactSummary,
  CrmOverviewResponse,
  CrmTaskSummary,
  OpportunityStage,
  OpportunitySummary,
  UpdateOpportunityStageRequest,
  UpdateOpportunityStageResponse
} from '@fmcgbyalex/contracts/commercial';
import {
  conflictError,
  countryCode,
  domainAuditStatement,
  domainOutboxStatement,
  idempotencyStatement,
  notFoundError,
  normalizedCode,
  optionalDate,
  optionalEmail,
  optionalText,
  readDomainReplay,
  requestHash,
  requireDomainAccess,
  requireIdempotencyKey,
  requiredId,
  requiredText,
  validationError
} from './domain-support';
import type { ResolvedSession } from './platform';

type AccountRow = {
  id: string;
  code: string;
  display_name: string;
  account_type: CrmAccountSummary['accountType'];
  status: CrmAccountSummary['status'];
  country_code: string;
  currency_code: string;
  owner_user_id: string;
  party_id: string | null;
  contact_count: number;
  open_opportunity_count: number;
  open_pipeline_minor: number;
  next_task_due_at: string | null;
  created_at: string;
  updated_at: string;
  version: number;
};

type ContactRow = {
  id: string;
  account_id: string;
  first_name: string;
  last_name: string;
  job_title: string | null;
  email: string | null;
  phone: string | null;
  is_primary: number;
  active: number;
  created_at: string;
  updated_at: string;
  version: number;
};

type ActivityRow = {
  id: string;
  account_id: string;
  contact_id: string | null;
  opportunity_id: string | null;
  activity_type: CrmActivitySummary['activityType'];
  subject: string;
  body: string | null;
  occurred_at: string;
  created_by_user_id: string;
  created_at: string;
};

type TaskRow = {
  id: string;
  account_id: string;
  opportunity_id: string | null;
  subject: string;
  detail: string | null;
  due_at: string;
  priority: CrmTaskSummary['priority'];
  status: CrmTaskSummary['status'];
  owner_user_id: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  version: number;
};

type OpportunityRow = {
  id: string;
  account_id: string;
  account_name: string;
  display_name: string;
  stage: OpportunityStage;
  expected_value_minor: number;
  currency_code: string;
  probability_basis_points: number;
  owner_user_id: string;
  expected_close_date: string | null;
  next_action: string | null;
  created_at: string;
  updated_at: string;
  version: number;
};

type AccountIdentityRow = {
  id: string;
  display_name: string;
  currency_code: string;
};

export async function getCrmOverview(
  env: Env,
  request: Request,
  session: ResolvedSession
): Promise<CrmOverviewResponse> {
  await Promise.all([
    requireDomainAccess(env, request, session, 'crm', 'crm.accounts.read', 'crm.overview.read'),
    requireDomainAccess(env, request, session, 'crm', 'crm.activities.read', 'crm.overview.read'),
    requireDomainAccess(env, request, session, 'crm', 'crm.pipeline.read', 'crm.overview.read')
  ]);
  return readCrmOverview(env.TENANT_DB, session.response.tenant.id);
}

export async function createCrmAccount(
  env: Env,
  request: Request,
  session: ResolvedSession,
  input: CreateCrmAccountRequest
): Promise<CreateCrmAccountResponse> {
  await requireDomainAccess(env, request, session, 'crm', 'crm.accounts.manage', 'crm.account.create');
  const tenantId = session.response.tenant.id;
  const idempotencyKey = requireIdempotencyKey(request);
  const normalized = {
    code: normalizedCode(input.code, 'code'),
    name: requiredText(input.name, 'name', 2, 160),
    accountType: accountType(input.accountType),
    countryCode: countryCode(input.countryCode),
    currencyCode: tenantCurrency(input.currencyCode, session),
    partyId: input.partyId === undefined ? null : requiredId(input.partyId, 'partyId'),
    ownerUserId: optionalText(input.ownerUserId, 'ownerUserId', 160) ?? session.response.user.id
  };
  const hash = await requestHash(normalized);
  const replay = await readDomainReplay<CreateCrmAccountResponse>(
    env.TENANT_DB,
    tenantId,
    'crm.account.create',
    idempotencyKey,
    hash
  );
  if (replay) return { ...replay, replayed: true };

  const duplicate = await env.TENANT_DB.prepare(
    'SELECT id FROM crm_accounts WHERE tenant_id = ?1 AND code = ?2'
  ).bind(tenantId, normalized.code).first<{ id: string }>();
  if (duplicate) throw conflictError('crm-account-code-conflict', 'CRM account code already exists.');

  if (normalized.partyId) {
    const party = await env.TENANT_DB.prepare(
      `SELECT id FROM business_parties
       WHERE tenant_id = ?1 AND id = ?2 AND party_type IN ('customer', 'distributor', 'retailer') AND active = 1`
    ).bind(tenantId, normalized.partyId).first<{ id: string }>();
    if (!party) throw notFoundError('business-party-not-found', 'Eligible business party not found.');
  }

  const now = new Date().toISOString();
  const account: CrmAccountSummary = {
    id: `acc_${crypto.randomUUID()}`,
    code: normalized.code,
    name: normalized.name,
    accountType: normalized.accountType,
    status: 'active',
    countryCode: normalized.countryCode,
    currencyCode: normalized.currencyCode,
    ownerUserId: normalized.ownerUserId,
    partyId: normalized.partyId,
    contactCount: 0,
    openOpportunityCount: 0,
    openPipelineMinor: 0,
    nextTaskDueAt: null,
    createdAt: now,
    updatedAt: now,
    version: 1
  };
  const response: CreateCrmAccountResponse = { account, replayed: false };
  await env.TENANT_DB.batch([
    env.TENANT_DB.prepare(
      `INSERT INTO crm_accounts (
         id, tenant_id, code, display_name, account_type, status, country_code,
         currency_code, owner_user_id, party_id, created_at, updated_at, version
       ) VALUES (?1, ?2, ?3, ?4, ?5, 'active', ?6, ?7, ?8, ?9, ?10, ?10, 1)`
    ).bind(
      account.id, tenantId, account.code, account.name, account.accountType,
      account.countryCode, account.currencyCode, account.ownerUserId, account.partyId, now
    ),
    idempotencyStatement(env.TENANT_DB, {
      tenantId, scope: 'crm.account.create', idempotencyKey, requestHash: hash,
      responseStatus: 201, responseBody: response, now
    }),
    domainAuditStatement(env.TENANT_DB, session, {
      action: 'crm.account.create', resourceType: 'crm-account', resourceId: account.id,
      metadata: { code: account.code, accountType: account.accountType }, now
    }),
    domainOutboxStatement(env.TENANT_DB, session, {
      eventType: 'crm.account.created.v1', aggregateType: 'crm-account', aggregateId: account.id,
      aggregateVersion: 1, payload: { accountId: account.id, code: account.code }, now
    })
  ]);
  return response;
}

export async function createCrmContact(
  env: Env,
  request: Request,
  session: ResolvedSession,
  input: CreateCrmContactRequest
): Promise<CreateCrmContactResponse> {
  await requireDomainAccess(env, request, session, 'crm', 'crm.accounts.manage', 'crm.contact.create');
  const tenantId = session.response.tenant.id;
  const normalized = {
    accountId: requiredId(input.accountId, 'accountId'),
    firstName: requiredText(input.firstName, 'firstName', 1, 80),
    lastName: requiredText(input.lastName, 'lastName', 1, 80),
    jobTitle: optionalText(input.jobTitle, 'jobTitle', 120),
    email: optionalEmail(input.email, 'email'),
    phone: optionalText(input.phone, 'phone', 50),
    primary: input.primary === true
  };
  const idempotencyKey = requireIdempotencyKey(request);
  const hash = await requestHash(normalized);
  const replay = await readDomainReplay<CreateCrmContactResponse>(env.TENANT_DB, tenantId, 'crm.contact.create', idempotencyKey, hash);
  if (replay) return { ...replay, replayed: true };
  await requireAccount(env.TENANT_DB, tenantId, normalized.accountId);

  const now = new Date().toISOString();
  const contact: CrmContactSummary = {
    id: `con_${crypto.randomUUID()}`,
    accountId: normalized.accountId,
    firstName: normalized.firstName,
    lastName: normalized.lastName,
    displayName: `${normalized.firstName} ${normalized.lastName}`,
    jobTitle: normalized.jobTitle,
    email: normalized.email,
    phone: normalized.phone,
    primary: normalized.primary,
    active: true,
    createdAt: now,
    updatedAt: now,
    version: 1
  };
  const response: CreateCrmContactResponse = { contact, replayed: false };
  const statements: D1PreparedStatement[] = [];
  if (contact.primary) {
    statements.push(env.TENANT_DB.prepare(
      `UPDATE crm_contacts SET is_primary = 0, updated_at = ?3, version = version + 1
       WHERE tenant_id = ?1 AND account_id = ?2 AND is_primary = 1`
    ).bind(tenantId, contact.accountId, now));
  }
  statements.push(
    env.TENANT_DB.prepare(
      `INSERT INTO crm_contacts (
         id, tenant_id, account_id, first_name, last_name, job_title, email, phone,
         is_primary, active, created_at, updated_at, version
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 1, ?10, ?10, 1)`
    ).bind(contact.id, tenantId, contact.accountId, contact.firstName, contact.lastName,
      contact.jobTitle, contact.email, contact.phone, contact.primary ? 1 : 0, now),
    idempotencyStatement(env.TENANT_DB, {
      tenantId, scope: 'crm.contact.create', idempotencyKey, requestHash: hash,
      responseStatus: 201, responseBody: response, now
    }),
    domainAuditStatement(env.TENANT_DB, session, {
      action: 'crm.contact.create', resourceType: 'crm-contact', resourceId: contact.id,
      metadata: { accountId: contact.accountId }, now
    }),
    domainOutboxStatement(env.TENANT_DB, session, {
      eventType: 'crm.contact.created.v1', aggregateType: 'crm-contact', aggregateId: contact.id,
      aggregateVersion: 1, payload: { contactId: contact.id, accountId: contact.accountId }, now
    })
  );
  await env.TENANT_DB.batch(statements);
  return response;
}

export async function createCrmActivity(
  env: Env,
  request: Request,
  session: ResolvedSession,
  input: CreateCrmActivityRequest
): Promise<CreateCrmActivityResponse> {
  await requireDomainAccess(env, request, session, 'crm', 'crm.activities.manage', 'crm.activity.create');
  const tenantId = session.response.tenant.id;
  const normalized = {
    accountId: requiredId(input.accountId, 'accountId'),
    contactId: input.contactId === undefined ? null : requiredId(input.contactId, 'contactId'),
    opportunityId: input.opportunityId === undefined ? null : requiredId(input.opportunityId, 'opportunityId'),
    activityType: activityType(input.activityType),
    subject: requiredText(input.subject, 'subject', 2, 180),
    body: optionalText(input.body, 'body', 4000),
    occurredAt: input.occurredAt === undefined ? new Date().toISOString() : dateTime(input.occurredAt, 'occurredAt')
  };
  const idempotencyKey = requireIdempotencyKey(request);
  const hash = await requestHash(normalized);
  const replay = await readDomainReplay<CreateCrmActivityResponse>(env.TENANT_DB, tenantId, 'crm.activity.create', idempotencyKey, hash);
  if (replay) return { ...replay, replayed: true };
  await requireAccount(env.TENANT_DB, tenantId, normalized.accountId);
  await validateRelatedEntities(env.TENANT_DB, tenantId, normalized.accountId, normalized.contactId, normalized.opportunityId);

  const now = new Date().toISOString();
  const activity: CrmActivitySummary = {
    id: `act_${crypto.randomUUID()}`,
    accountId: normalized.accountId,
    contactId: normalized.contactId,
    opportunityId: normalized.opportunityId,
    activityType: normalized.activityType,
    subject: normalized.subject,
    body: normalized.body,
    occurredAt: normalized.occurredAt,
    createdByUserId: session.response.user.id,
    createdAt: now
  };
  const response: CreateCrmActivityResponse = { activity, replayed: false };
  await env.TENANT_DB.batch([
    env.TENANT_DB.prepare(
      `INSERT INTO crm_activities (
         id, tenant_id, account_id, contact_id, opportunity_id, activity_type,
         subject, body, occurred_at, created_by_user_id, created_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`
    ).bind(activity.id, tenantId, activity.accountId, activity.contactId, activity.opportunityId,
      activity.activityType, activity.subject, activity.body, activity.occurredAt,
      activity.createdByUserId, activity.createdAt),
    idempotencyStatement(env.TENANT_DB, {
      tenantId, scope: 'crm.activity.create', idempotencyKey, requestHash: hash,
      responseStatus: 201, responseBody: response, now
    }),
    domainAuditStatement(env.TENANT_DB, session, {
      action: 'crm.activity.create', resourceType: 'crm-activity', resourceId: activity.id,
      metadata: { accountId: activity.accountId, activityType: activity.activityType }, now
    }),
    domainOutboxStatement(env.TENANT_DB, session, {
      eventType: 'crm.activity.created.v1', aggregateType: 'crm-activity', aggregateId: activity.id,
      aggregateVersion: 1, payload: { activityId: activity.id, accountId: activity.accountId }, now
    })
  ]);
  return response;
}

export async function createCrmTask(
  env: Env,
  request: Request,
  session: ResolvedSession,
  input: CreateCrmTaskRequest
): Promise<CreateCrmTaskResponse> {
  await requireDomainAccess(env, request, session, 'crm', 'crm.activities.manage', 'crm.task.create');
  const tenantId = session.response.tenant.id;
  const normalized = {
    accountId: requiredId(input.accountId, 'accountId'),
    opportunityId: input.opportunityId === undefined ? null : requiredId(input.opportunityId, 'opportunityId'),
    subject: requiredText(input.subject, 'subject', 2, 180),
    detail: optionalText(input.detail, 'detail', 2000),
    dueAt: dateTime(input.dueAt, 'dueAt'),
    priority: taskPriority(input.priority),
    ownerUserId: optionalText(input.ownerUserId, 'ownerUserId', 160) ?? session.response.user.id
  };
  const idempotencyKey = requireIdempotencyKey(request);
  const hash = await requestHash(normalized);
  const replay = await readDomainReplay<CreateCrmTaskResponse>(env.TENANT_DB, tenantId, 'crm.task.create', idempotencyKey, hash);
  if (replay) return { ...replay, replayed: true };
  await requireAccount(env.TENANT_DB, tenantId, normalized.accountId);
  await validateRelatedEntities(env.TENANT_DB, tenantId, normalized.accountId, null, normalized.opportunityId);

  const now = new Date().toISOString();
  const task = taskSummary({
    id: `tsk_${crypto.randomUUID()}`,
    account_id: normalized.accountId,
    opportunity_id: normalized.opportunityId,
    subject: normalized.subject,
    detail: normalized.detail,
    due_at: normalized.dueAt,
    priority: normalized.priority,
    status: 'open',
    owner_user_id: normalized.ownerUserId,
    completed_at: null,
    created_at: now,
    updated_at: now,
    version: 1
  });
  const response: CreateCrmTaskResponse = { task, replayed: false };
  await env.TENANT_DB.batch([
    env.TENANT_DB.prepare(
      `INSERT INTO crm_tasks (
         id, tenant_id, account_id, opportunity_id, subject, detail, due_at,
         priority, status, owner_user_id, completed_at, created_at, updated_at, version
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'open', ?9, NULL, ?10, ?10, 1)`
    ).bind(task.id, tenantId, task.accountId, task.opportunityId, task.subject, task.detail,
      task.dueAt, task.priority, task.ownerUserId, now),
    idempotencyStatement(env.TENANT_DB, {
      tenantId, scope: 'crm.task.create', idempotencyKey, requestHash: hash,
      responseStatus: 201, responseBody: response, now
    }),
    domainAuditStatement(env.TENANT_DB, session, {
      action: 'crm.task.create', resourceType: 'crm-task', resourceId: task.id,
      metadata: { accountId: task.accountId, dueAt: task.dueAt }, now
    }),
    domainOutboxStatement(env.TENANT_DB, session, {
      eventType: 'crm.task.created.v1', aggregateType: 'crm-task', aggregateId: task.id,
      aggregateVersion: 1, payload: { taskId: task.id, accountId: task.accountId }, now
    })
  ]);
  return response;
}

export async function completeCrmTask(
  env: Env,
  request: Request,
  session: ResolvedSession,
  taskIdValue: string
): Promise<CompleteCrmTaskResponse> {
  await requireDomainAccess(env, request, session, 'crm', 'crm.activities.manage', 'crm.task.complete');
  const tenantId = session.response.tenant.id;
  const taskId = requiredId(taskIdValue, 'taskId');
  const idempotencyKey = requireIdempotencyKey(request);
  const hash = await requestHash({ taskId });
  const replay = await readDomainReplay<CompleteCrmTaskResponse>(env.TENANT_DB, tenantId, 'crm.task.complete', idempotencyKey, hash);
  if (replay) return { ...replay, replayed: true };
  const row = await env.TENANT_DB.prepare(
    'SELECT * FROM crm_tasks WHERE tenant_id = ?1 AND id = ?2'
  ).bind(tenantId, taskId).first<TaskRow>();
  if (!row) throw notFoundError('crm-task-not-found', 'CRM task not found.');
  if (row.status !== 'open') throw conflictError('crm-task-not-open', 'Only open tasks can be completed.');

  const now = new Date().toISOString();
  const task = taskSummary({ ...row, status: 'completed', completed_at: now, updated_at: now, version: row.version + 1 });
  const response: CompleteCrmTaskResponse = { task, replayed: false };
  await env.TENANT_DB.batch([
    env.TENANT_DB.prepare(
      `UPDATE crm_tasks SET status = 'completed', completed_at = ?3, updated_at = ?3, version = version + 1
       WHERE tenant_id = ?1 AND id = ?2 AND status = 'open'`
    ).bind(tenantId, taskId, now),
    idempotencyStatement(env.TENANT_DB, {
      tenantId, scope: 'crm.task.complete', idempotencyKey, requestHash: hash,
      responseStatus: 200, responseBody: response, now
    }),
    domainAuditStatement(env.TENANT_DB, session, {
      action: 'crm.task.complete', resourceType: 'crm-task', resourceId: taskId, now
    }),
    domainOutboxStatement(env.TENANT_DB, session, {
      eventType: 'crm.task.completed.v1', aggregateType: 'crm-task', aggregateId: taskId,
      aggregateVersion: task.version, payload: { taskId }, now
    })
  ]);
  return response;
}

export async function createOpportunity(
  env: Env,
  request: Request,
  session: ResolvedSession,
  input: CreateOpportunityRequest
): Promise<CreateOpportunityResponse> {
  await requireDomainAccess(env, request, session, 'crm', 'crm.pipeline.manage', 'crm.opportunity.create');
  const tenantId = session.response.tenant.id;
  const accountId = requiredId(input.accountId, 'accountId');
  const account = await requireAccount(env.TENANT_DB, tenantId, accountId);
  const normalized = {
    accountId,
    name: requiredText(input.name, 'name', 2, 180),
    stage: opportunityStage(input.stage ?? 'lead'),
    expectedValueMinor: moneyMinor(input.expectedValueMinor, 'expectedValueMinor'),
    currencyCode: accountCurrency(input.currencyCode, account.currency_code),
    probabilityBasisPoints: basisPoints(input.probabilityBasisPoints, 'probabilityBasisPoints'),
    expectedCloseDate: optionalDate(input.expectedCloseDate, 'expectedCloseDate'),
    nextAction: optionalText(input.nextAction, 'nextAction', 500),
    ownerUserId: optionalText(input.ownerUserId, 'ownerUserId', 160) ?? session.response.user.id
  };
  const idempotencyKey = requireIdempotencyKey(request);
  const hash = await requestHash(normalized);
  const replay = await readDomainReplay<CreateOpportunityResponse>(env.TENANT_DB, tenantId, 'crm.opportunity.create', idempotencyKey, hash);
  if (replay) return { ...replay, replayed: true };
  const now = new Date().toISOString();
  const opportunity: OpportunitySummary = {
    id: `opp_${crypto.randomUUID()}`,
    accountId,
    accountName: account.display_name,
    name: normalized.name,
    stage: normalized.stage,
    expectedValueMinor: normalized.expectedValueMinor,
    weightedValueMinor: weightedValue(normalized.expectedValueMinor, normalized.probabilityBasisPoints),
    currencyCode: normalized.currencyCode,
    probabilityBasisPoints: normalized.probabilityBasisPoints,
    ownerUserId: normalized.ownerUserId,
    expectedCloseDate: normalized.expectedCloseDate,
    nextAction: normalized.nextAction,
    createdAt: now,
    updatedAt: now,
    version: 1
  };
  const response: CreateOpportunityResponse = { opportunity, replayed: false };
  await env.TENANT_DB.batch([
    env.TENANT_DB.prepare(
      `INSERT INTO crm_opportunities (
         id, tenant_id, account_id, display_name, stage, expected_value_minor,
         currency_code, probability_basis_points, owner_user_id, expected_close_date,
         next_action, created_at, updated_at, version
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12, 1)`
    ).bind(opportunity.id, tenantId, opportunity.accountId, opportunity.name, opportunity.stage,
      opportunity.expectedValueMinor, opportunity.currencyCode, opportunity.probabilityBasisPoints,
      opportunity.ownerUserId, opportunity.expectedCloseDate, opportunity.nextAction, now),
    idempotencyStatement(env.TENANT_DB, {
      tenantId, scope: 'crm.opportunity.create', idempotencyKey, requestHash: hash,
      responseStatus: 201, responseBody: response, now
    }),
    domainAuditStatement(env.TENANT_DB, session, {
      action: 'crm.opportunity.create', resourceType: 'crm-opportunity', resourceId: opportunity.id,
      metadata: { accountId, stage: opportunity.stage, expectedValueMinor: opportunity.expectedValueMinor }, now
    }),
    domainOutboxStatement(env.TENANT_DB, session, {
      eventType: 'crm.opportunity.created.v1', aggregateType: 'crm-opportunity', aggregateId: opportunity.id,
      aggregateVersion: 1, payload: { opportunityId: opportunity.id, accountId }, now
    })
  ]);
  return response;
}

export async function updateOpportunityStage(
  env: Env,
  request: Request,
  session: ResolvedSession,
  opportunityIdValue: string,
  input: UpdateOpportunityStageRequest
): Promise<UpdateOpportunityStageResponse> {
  await requireDomainAccess(env, request, session, 'crm', 'crm.pipeline.manage', 'crm.opportunity.stage.update');
  const tenantId = session.response.tenant.id;
  const opportunityId = requiredId(opportunityIdValue, 'opportunityId');
  const normalized = {
    opportunityId,
    stage: opportunityStage(input.stage),
    probabilityBasisPoints: basisPoints(input.probabilityBasisPoints, 'probabilityBasisPoints'),
    nextAction: optionalText(input.nextAction, 'nextAction', 500)
  };
  if (normalized.stage === 'won' && normalized.probabilityBasisPoints !== 10000) {
    throw validationError('Won opportunities must use 10000 probability basis points.');
  }
  if (normalized.stage === 'lost' && normalized.probabilityBasisPoints !== 0) {
    throw validationError('Lost opportunities must use 0 probability basis points.');
  }
  const idempotencyKey = requireIdempotencyKey(request);
  const hash = await requestHash(normalized);
  const replay = await readDomainReplay<UpdateOpportunityStageResponse>(env.TENANT_DB, tenantId, 'crm.opportunity.stage.update', idempotencyKey, hash);
  if (replay) return { ...replay, replayed: true };
  const row = await env.TENANT_DB.prepare(
    `SELECT o.*, a.display_name AS account_name
     FROM crm_opportunities o JOIN crm_accounts a ON a.tenant_id = o.tenant_id AND a.id = o.account_id
     WHERE o.tenant_id = ?1 AND o.id = ?2`
  ).bind(tenantId, opportunityId).first<OpportunityRow>();
  if (!row) throw notFoundError('crm-opportunity-not-found', 'CRM opportunity not found.');
  const now = new Date().toISOString();
  const opportunity = opportunitySummary({
    ...row,
    stage: normalized.stage,
    probability_basis_points: normalized.probabilityBasisPoints,
    next_action: normalized.nextAction,
    updated_at: now,
    version: row.version + 1
  });
  const response: UpdateOpportunityStageResponse = { opportunity, replayed: false };
  await env.TENANT_DB.batch([
    env.TENANT_DB.prepare(
      `UPDATE crm_opportunities
       SET stage = ?3, probability_basis_points = ?4, next_action = ?5,
           updated_at = ?6, version = version + 1
       WHERE tenant_id = ?1 AND id = ?2`
    ).bind(tenantId, opportunityId, opportunity.stage, opportunity.probabilityBasisPoints,
      opportunity.nextAction, now),
    idempotencyStatement(env.TENANT_DB, {
      tenantId, scope: 'crm.opportunity.stage.update', idempotencyKey, requestHash: hash,
      responseStatus: 200, responseBody: response, now
    }),
    domainAuditStatement(env.TENANT_DB, session, {
      action: 'crm.opportunity.stage.update', resourceType: 'crm-opportunity', resourceId: opportunityId,
      metadata: { previousStage: row.stage, stage: opportunity.stage }, now
    }),
    domainOutboxStatement(env.TENANT_DB, session, {
      eventType: 'crm.opportunity.stage-changed.v1', aggregateType: 'crm-opportunity', aggregateId: opportunityId,
      aggregateVersion: opportunity.version, payload: { opportunityId, stage: opportunity.stage }, now
    })
  ]);
  return response;
}

async function readCrmOverview(db: D1Database, tenantId: string): Promise<CrmOverviewResponse> {
  const now = new Date();
  const nowIso = now.toISOString();
  const dueSoonIso = new Date(now.getTime() + 7 * 86_400_000).toISOString();
  const [accountResult, contactResult, opportunityResult, taskResult, activityResult] = await Promise.all([
    db.prepare(
      `SELECT a.*,
        (SELECT COUNT(*) FROM crm_contacts c WHERE c.tenant_id = a.tenant_id AND c.account_id = a.id AND c.active = 1) AS contact_count,
        (SELECT COUNT(*) FROM crm_opportunities o WHERE o.tenant_id = a.tenant_id AND o.account_id = a.id AND o.stage NOT IN ('won','lost')) AS open_opportunity_count,
        (SELECT COALESCE(SUM(o.expected_value_minor), 0) FROM crm_opportunities o WHERE o.tenant_id = a.tenant_id AND o.account_id = a.id AND o.stage NOT IN ('won','lost')) AS open_pipeline_minor,
        (SELECT MIN(t.due_at) FROM crm_tasks t WHERE t.tenant_id = a.tenant_id AND t.account_id = a.id AND t.status = 'open') AS next_task_due_at
       FROM crm_accounts a WHERE a.tenant_id = ?1 ORDER BY a.display_name, a.id`
    ).bind(tenantId).all<AccountRow>(),
    db.prepare(
      `SELECT * FROM crm_contacts WHERE tenant_id = ?1 AND active = 1
       ORDER BY is_primary DESC, last_name, first_name, id LIMIT 500`
    ).bind(tenantId).all<ContactRow>(),
    db.prepare(
      `SELECT o.*, a.display_name AS account_name
       FROM crm_opportunities o
       JOIN crm_accounts a ON a.tenant_id = o.tenant_id AND a.id = o.account_id
       WHERE o.tenant_id = ?1
       ORDER BY CASE o.stage WHEN 'negotiation' THEN 1 WHEN 'proposal' THEN 2 WHEN 'qualified' THEN 3 WHEN 'lead' THEN 4 ELSE 5 END,
                o.expected_close_date, o.updated_at DESC LIMIT 500`
    ).bind(tenantId).all<OpportunityRow>(),
    db.prepare(
      `SELECT * FROM crm_tasks WHERE tenant_id = ?1
       ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, due_at, created_at DESC LIMIT 500`
    ).bind(tenantId).all<TaskRow>(),
    db.prepare(
      `SELECT * FROM crm_activities WHERE tenant_id = ?1
       ORDER BY occurred_at DESC, created_at DESC LIMIT 100`
    ).bind(tenantId).all<ActivityRow>()
  ]);
  const accounts = accountResult.results.map(accountSummary);
  const contacts = contactResult.results.map(contactSummary);
  const opportunities = opportunityResult.results.map(opportunitySummary);
  const tasks = taskResult.results.map((row) => taskSummary(row, nowIso, dueSoonIso));
  const recentActivities = activityResult.results.map(activitySummary);
  const activeOpportunities = opportunities.filter((item) => !['won', 'lost'].includes(item.stage));
  const openTasks = tasks.filter((item) => item.status === 'open');
  return {
    metrics: {
      accountCount: accounts.filter((item) => item.status === 'active').length,
      activeOpportunityCount: activeOpportunities.length,
      pipelineMinor: activeOpportunities.reduce((sum, item) => sum + item.expectedValueMinor, 0),
      weightedPipelineMinor: activeOpportunities.reduce((sum, item) => sum + item.weightedValueMinor, 0),
      overdueTaskCount: openTasks.filter((item) => item.overdue).length,
      dueSoonTaskCount: openTasks.filter((item) => item.dueSoon).length
    },
    accounts,
    contacts,
    opportunities,
    tasks,
    recentActivities
  };
}

async function requireAccount(db: D1Database, tenantId: string, accountId: string): Promise<AccountIdentityRow> {
  const account = await db.prepare(
    `SELECT id, display_name, currency_code FROM crm_accounts
     WHERE tenant_id = ?1 AND id = ?2 AND status = 'active'`
  ).bind(tenantId, accountId).first<AccountIdentityRow>();
  if (!account) throw notFoundError('crm-account-not-found', 'Active CRM account not found.');
  return account;
}

async function validateRelatedEntities(
  db: D1Database,
  tenantId: string,
  accountId: string,
  contactId: string | null,
  opportunityId: string | null
): Promise<void> {
  if (contactId) {
    const contact = await db.prepare(
      'SELECT id FROM crm_contacts WHERE tenant_id = ?1 AND id = ?2 AND account_id = ?3 AND active = 1'
    ).bind(tenantId, contactId, accountId).first<{ id: string }>();
    if (!contact) throw notFoundError('crm-contact-not-found', 'CRM contact not found for the selected account.');
  }
  if (opportunityId) {
    const opportunity = await db.prepare(
      'SELECT id FROM crm_opportunities WHERE tenant_id = ?1 AND id = ?2 AND account_id = ?3'
    ).bind(tenantId, opportunityId, accountId).first<{ id: string }>();
    if (!opportunity) throw notFoundError('crm-opportunity-not-found', 'CRM opportunity not found for the selected account.');
  }
}

function accountSummary(row: AccountRow): CrmAccountSummary {
  return {
    id: row.id, code: row.code, name: row.display_name, accountType: row.account_type,
    status: row.status, countryCode: row.country_code, currencyCode: row.currency_code,
    ownerUserId: row.owner_user_id, partyId: row.party_id, contactCount: Number(row.contact_count),
    openOpportunityCount: Number(row.open_opportunity_count), openPipelineMinor: Number(row.open_pipeline_minor),
    nextTaskDueAt: row.next_task_due_at, createdAt: row.created_at, updatedAt: row.updated_at,
    version: Number(row.version)
  };
}

function contactSummary(row: ContactRow): CrmContactSummary {
  return {
    id: row.id, accountId: row.account_id, firstName: row.first_name, lastName: row.last_name,
    displayName: `${row.first_name} ${row.last_name}`, jobTitle: row.job_title, email: row.email,
    phone: row.phone, primary: row.is_primary === 1, active: row.active === 1,
    createdAt: row.created_at, updatedAt: row.updated_at, version: Number(row.version)
  };
}

function activitySummary(row: ActivityRow): CrmActivitySummary {
  return {
    id: row.id, accountId: row.account_id, contactId: row.contact_id,
    opportunityId: row.opportunity_id, activityType: row.activity_type, subject: row.subject,
    body: row.body, occurredAt: row.occurred_at, createdByUserId: row.created_by_user_id,
    createdAt: row.created_at
  };
}

function taskSummary(row: TaskRow, nowIso = new Date().toISOString(), dueSoonIso = new Date(Date.now() + 7 * 86_400_000).toISOString()): CrmTaskSummary {
  return {
    id: row.id, accountId: row.account_id, opportunityId: row.opportunity_id,
    subject: row.subject, detail: row.detail, dueAt: row.due_at, priority: row.priority,
    status: row.status, ownerUserId: row.owner_user_id, completedAt: row.completed_at,
    overdue: row.status === 'open' && row.due_at < nowIso,
    dueSoon: row.status === 'open' && row.due_at >= nowIso && row.due_at <= dueSoonIso,
    createdAt: row.created_at, updatedAt: row.updated_at, version: Number(row.version)
  };
}

function opportunitySummary(row: OpportunityRow): OpportunitySummary {
  return {
    id: row.id, accountId: row.account_id, accountName: row.account_name,
    name: row.display_name, stage: row.stage, expectedValueMinor: Number(row.expected_value_minor),
    weightedValueMinor: weightedValue(Number(row.expected_value_minor), Number(row.probability_basis_points)),
    currencyCode: row.currency_code, probabilityBasisPoints: Number(row.probability_basis_points),
    ownerUserId: row.owner_user_id, expectedCloseDate: row.expected_close_date,
    nextAction: row.next_action, createdAt: row.created_at, updatedAt: row.updated_at,
    version: Number(row.version)
  };
}

function accountType(value: unknown): CrmAccountSummary['accountType'] {
  if (!['prospect', 'customer', 'distributor', 'retailer'].includes(String(value))) {
    throw validationError('accountType is invalid.');
  }
  return value as CrmAccountSummary['accountType'];
}

function activityType(value: unknown): CrmActivitySummary['activityType'] {
  if (!['note', 'call', 'email', 'meeting'].includes(String(value))) {
    throw validationError('activityType is invalid.');
  }
  return value as CrmActivitySummary['activityType'];
}

function taskPriority(value: unknown): CrmTaskSummary['priority'] {
  if (!['low', 'medium', 'high', 'urgent'].includes(String(value))) {
    throw validationError('priority is invalid.');
  }
  return value as CrmTaskSummary['priority'];
}

function opportunityStage(value: unknown): OpportunityStage {
  if (!['lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost'].includes(String(value))) {
    throw validationError('stage is invalid.');
  }
  return value as OpportunityStage;
}

function moneyMinor(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw validationError(`${field} must be a non-negative safe integer in minor currency units.`);
  }
  return Number(value);
}

function basisPoints(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 10000) {
    throw validationError(`${field} must be an integer from 0 to 10000.`);
  }
  return Number(value);
}

function currency(value: unknown): string {
  const normalized = requiredText(value, 'currencyCode', 3, 3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) throw validationError('currencyCode must be a three-letter ISO code.');
  return normalized;
}

function tenantCurrency(value: unknown, session: ResolvedSession): string {
  const normalized = currency(value);
  if (normalized !== session.response.tenant.defaultCurrency.toUpperCase()) {
    throw validationError(`currencyCode must match tenant currency ${session.response.tenant.defaultCurrency}.`);
  }
  return normalized;
}

function accountCurrency(value: unknown, expected: string): string {
  const normalized = currency(value);
  if (normalized !== expected) throw validationError(`currencyCode must match account currency ${expected}.`);
  return normalized;
}

function dateTime(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw validationError(`${field} must be an ISO date-time.`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw validationError(`${field} must be a valid ISO date-time.`);
  return date.toISOString();
}

function weightedValue(valueMinor: number, probabilityBasisPoints: number): number {
  return Math.floor((valueMinor * probabilityBasisPoints) / 10000);
}
