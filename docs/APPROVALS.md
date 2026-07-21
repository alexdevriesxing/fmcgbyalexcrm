# Maker-checker approvals

The platform approval engine separates the user proposing a high-risk change from the users authorizing it.

## Runtime model

1. A tenant policy identifies the resource type and action that require approval.
2. A maker submits an idempotent approval request.
3. The engine copies the active policy and its steps into immutable request snapshots.
4. Each checker must hold both `platform.approvals.decide` and the permission required by the current step.
5. A requester cannot approve their own request unless the policy step explicitly permits it.
6. When a step reaches its minimum number of independent approvers, the request advances to the next step.
7. Final approval executes the supported action and records the resulting audit and outbox events in the same D1 batch.

## Supported action in this milestone

`platform.module-entitlement.set` changes a tenant module entitlement. While its default policy is enabled, the direct module-entitlement endpoint fails with an `approval-required` problem response.

The action payload is normalized when the request is created:

```json
{
  "enabled": true,
  "expectedVersion": 1
}
```

The expected version is captured for audit context. Final execution reads the current tenant module and increments its version atomically.

## Default policy

Every tenant receives `module-entitlement-change`:

- Resource type: `module-entitlement`
- Action: `platform.module-entitlement.set`
- Required permission: `platform.modules.manage`
- Minimum approvers: 1
- Self-approval: disabled
- Request expiry: 7 days

Tenant administrators may change the threshold, add sequential steps, change required permissions or disable the policy. Policy changes are idempotent and audited. Pending requests retain the policy snapshot that existed when they were submitted.

## Security properties

- Tenant IDs are always derived from an authenticated active membership.
- Request payloads are hashed and stored with an immutable policy snapshot.
- Decision uniqueness is enforced per request, step and user.
- Rejections require a comment.
- All mutation endpoints require idempotency keys.
- Expired, rejected, cancelled and approved requests cannot be decided again.
- Direct actions fail closed while a matching enabled policy exists.
- The final action, request resolution, audit records and outbox events are written through atomic D1 batches.
- Logs never include bearer tokens or approval payload bodies.

## API surface

- `GET /v1/approvals`
- `GET /v1/approvals/:requestId`
- `POST /v1/approvals`
- `POST /v1/approvals/:requestId/decisions`
- `POST /v1/approvals/:requestId/cancel`
- `PUT /v1/admin/approval-policies/:policyKey`

## Extension model

Additional business actions should be added through an explicit action validator and executor. Each executor must:

- validate and normalize the request payload before persistence;
- snapshot relevant optimistic-lock versions;
- execute only after the final policy step succeeds;
- use tenant-scoped SQL predicates;
- update the target aggregate, approval state, audit trail and outbox atomically;
- remain replay-safe.
