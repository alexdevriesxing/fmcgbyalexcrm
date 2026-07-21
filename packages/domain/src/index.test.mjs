import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AccessDeniedError,
  ModuleDisabledError,
  addMoney,
  requireModule,
  requirePermission,
} from './index.ts';

const context = {
  tenantId: 'tenant-1',
  userId: 'user-1',
  correlationId: 'correlation-1',
  roles: ['admin'],
  permissions: new Set(['platform.modules.read']),
  modules: new Map([
    ['platform', true],
    ['finance', false]
  ])
};

test('permission checks fail closed', () => {
  requirePermission(context, 'platform.modules.read');
  assert.throws(
    () => requirePermission(context, 'platform.modules.manage'),
    AccessDeniedError
  );
});

test('module checks fail closed', () => {
  requireModule(context, 'platform');
  assert.throws(() => requireModule(context, 'finance'), ModuleDisabledError);
  assert.throws(() => requireModule(context, 'marketing'), ModuleDisabledError);
});

test('money arithmetic preserves currency', () => {
  assert.deepEqual(
    addMoney(
      { currency: 'EUR', minorUnits: 120n },
      { currency: 'EUR', minorUnits: 80n }
    ),
    { currency: 'EUR', minorUnits: 200n }
  );

  assert.throws(() =>
    addMoney(
      { currency: 'EUR', minorUnits: 1n },
      { currency: 'USD', minorUnits: 1n }
    )
  );
});
