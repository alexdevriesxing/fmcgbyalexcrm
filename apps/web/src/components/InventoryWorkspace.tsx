import type { InventoryBalanceSummary, InventoryMovementSummary } from '@fmcgbyalex/contracts/inventory';
import { useEffect, useMemo, useState } from 'react';
import { useApplication } from '../state/ApplicationProvider';
import { EmptyState } from './Modal';
import { InventoryActionDialog, balanceKey, type InventoryAction } from './forms/InventoryActionDialog';

export function InventoryWorkspace({
  requestedAction,
  onActionConsumed
}: {
  requestedAction: InventoryAction | null;
  onActionConsumed: () => void;
}) {
  const application = useApplication();
  const overview = application.data.inventory;
  const balances = overview?.balances ?? [];
  const movements = overview?.recentMovements ?? [];
  const aging = application.data.aging;
  const [query, setQuery] = useState('');
  const [warehouseId, setWarehouseId] = useState('all');
  const [status, setStatus] = useState('all');
  const [activeView, setActiveView] = useState<'stock' | 'movements' | 'aging'>('stock');
  const [dialog, setDialog] = useState<InventoryAction | null>(null);
  const [initialBalanceId, setInitialBalanceId] = useState<string | null>(null);
  const [initialMovementId, setInitialMovementId] = useState<string | null>(null);
  const [rowMenu, setRowMenu] = useState<string | null>(null);

  useEffect(() => {
    if (!requestedAction) return;
    setDialog(requestedAction);
    onActionConsumed();
  }, [onActionConsumed, requestedAction]);

  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return balances.filter((row) => {
      const matchesQuery = !normalizedQuery || [row.sku, row.productName, row.variantName, row.lot.lotCode, row.binCode, row.warehouseCode]
        .some((value) => value.toLowerCase().includes(normalizedQuery));
      const matchesWarehouse = warehouseId === 'all' || row.warehouseId === warehouseId;
      const matchesStatus = status === 'all' || row.status === status;
      return matchesQuery && matchesWarehouse && matchesStatus;
    });
  }, [balances, query, status, warehouseId]);

  const totalAgingQuantity = aging?.buckets.reduce((total, bucket) => total + bucket.quantityBase, 0) ?? 0;
  const earliestRisk = [...balances]
    .filter((balance) => balance.status === 'available' && balance.quantityBase > 0 && balance.expiresInDays !== null)
    .sort((left, right) => (left.expiresInDays ?? Number.MAX_SAFE_INTEGER) - (right.expiresInDays ?? Number.MAX_SAFE_INTEGER))[0] ?? null;
  const canReceive = application.hasPermission('inventory.stock.receive');
  const canTransfer = application.hasPermission('inventory.stock.transfer');
  const canAdjust = application.hasPermission('inventory.stock.adjust');
  const canChangeStatus = application.hasPermission('inventory.stock.quarantine');
  const canManageSettings = application.hasPermission('inventory.settings.manage');

  function openAction(action: InventoryAction, balance: InventoryBalanceSummary | null = null, movement: InventoryMovementSummary | null = null) {
    setInitialBalanceId(balance ? balanceKey(balance) : null);
    setInitialMovementId(movement?.id ?? null);
    setDialog(action);
    setRowMenu(null);
  }

  function exportActiveView() {
    if (activeView === 'stock') {
      downloadCsv('inventory-balances.csv', ['sku', 'product', 'variant', 'warehouse', 'bin', 'lot', 'expires_on', 'status', 'quantity_base', 'unit'], filteredRows.map((row) => [row.sku, row.productName, row.variantName, row.warehouseCode, row.binCode, row.lot.lotCode, row.lot.expiresOn, row.status, row.quantityBase, row.baseUnitCode]));
      return;
    }
    if (activeView === 'movements') {
      downloadCsv('inventory-movements.csv', ['movement_id', 'type', 'reference_type', 'reference_id', 'sku', 'warehouse', 'bin', 'lot', 'status', 'quantity_delta', 'resulting_quantity', 'occurred_at'], movements.map((movement) => [movement.id, movement.movementType, movement.referenceType, movement.referenceId, movement.sku, movement.warehouseCode, movement.binCode, movement.lotCode, movement.status, movement.quantityDeltaBase, movement.resultingQuantityBase, movement.occurredAt]));
      return;
    }
    downloadCsv('inventory-aging.csv', ['bucket', 'minimum_days', 'maximum_days', 'quantity_base', 'lot_count'], (aging?.buckets ?? []).map((bucket) => [bucket.label, bucket.minimumDays, bucket.maximumDays, bucket.quantityBase, bucket.lotCount]));
  }

  return (
    <section className="workspace-stack" aria-labelledby="inventory-title">
      <div className="workspace-heading">
        <div>
          <span className="eyebrow">Inventory & WMS</span>
          <h2 id="inventory-title">Stock control centre</h2>
          <p>Live balances, lots, expiry risk, FEFO recommendations and immutable inventory commands for the selected tenant.</p>
        </div>
        <div className="action-cluster">
          <button className="ghost-button" type="button" onClick={exportActiveView} disabled={activeView === 'stock' ? filteredRows.length === 0 : activeView === 'movements' ? movements.length === 0 : !aging?.buckets.length}>Export CSV</button>
          <button className="ghost-button" type="button" onClick={() => openAction('transfer')} disabled={!canTransfer}>Transfer stock</button>
          <button className="primary-button" type="button" onClick={() => openAction('receive')} disabled={!canReceive}>Receive stock</button>
        </div>
      </div>

      <div className="metric-strip inventory-metrics">
        <article><span>On-hand stock</span><strong>{(overview?.totals.quantityBase ?? 0).toLocaleString()}</strong><small>{overview?.totals.skuCount ?? 0} SKUs · {overview?.totals.lotCount ?? 0} lots</small></article>
        <article><span>Available</span><strong>{(overview?.totals.availableBase ?? 0).toLocaleString()}</strong><small>Eligible for allocation and FEFO</small></article>
        <article><span>Near expiry</span><strong>{(overview?.totals.nearExpiryBase ?? 0).toLocaleString()}</strong><small>{(overview?.totals.expiredBase ?? 0).toLocaleString()} expired base units</small></article>
        <article><span>Quarantine</span><strong>{(overview?.totals.quarantineBase ?? 0).toLocaleString()}</strong><small>Blocked from allocation pending disposition</small></article>
      </div>

      <div className="segmented-control" role="tablist" aria-label="Inventory views">
        {(['stock', 'movements', 'aging'] as const).map((view) => (
          <button className={activeView === view ? 'active' : ''} key={view} type="button" role="tab" aria-selected={activeView === view} onClick={() => setActiveView(view)}>
            {view === 'stock' ? 'Stock & lots' : view === 'movements' ? 'Movement ledger' : 'Aging & expiry'}
          </button>
        ))}
      </div>

      {activeView === 'stock' && (
        <>
          <div className="filter-bar">
            <label className="search-field"><span className="sr-only">Search stock</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search SKU, product, lot, warehouse or bin" /></label>
            <label><span>Warehouse</span><select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}><option value="all">All warehouses</option>{application.data.warehouses.map((warehouse) => <option value={warehouse.id} key={warehouse.id}>{warehouse.code} · {warehouse.name}</option>)}</select></label>
            <label><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All statuses</option><option value="available">Available</option><option value="quarantine">Quarantine</option><option value="damaged">Damaged</option><option value="blocked">Blocked</option></select></label>
            <span className="result-count">{filteredRows.length} stock positions</span>
          </div>

          <div className="data-panel">
            <div className="table-scroll">
              {filteredRows.length === 0 ? (
                <EmptyState
                  title={balances.length === 0 ? 'No inventory has been received' : 'No stock positions match the filters'}
                  detail={balances.length === 0 ? 'Create master data and post the first goods receipt to begin the ledger.' : 'Clear or change the current search, warehouse and status filters.'}
                  action={balances.length === 0 && canReceive ? <button className="primary-button" type="button" onClick={() => openAction('receive')}>Receive first stock</button> : undefined}
                />
              ) : (
                <table className="data-table">
                  <thead><tr><th>Product / SKU</th><th>Warehouse & bin</th><th>Lot</th><th>Expiry</th><th>Status</th><th className="numeric">Quantity</th><th></th></tr></thead>
                  <tbody>{filteredRows.map((row) => {
                    const key = balanceKey(row);
                    return (
                      <tr key={key}>
                        <td><strong>{row.productName}</strong><small>{row.variantName} · {row.sku}</small></td>
                        <td><strong>{row.warehouseName}</strong><small>{row.warehouseCode} · {row.binCode}</small></td>
                        <td><span className="mono-tag">{row.lot.lotCode}</span><small>{row.lot.manufacturedOn ? `Made ${formatDate(row.lot.manufacturedOn)}` : 'Manufacture date not set'}</small></td>
                        <td><strong>{row.lot.expiresOn ? formatDate(row.lot.expiresOn) : 'No expiry'}</strong><small className={row.expiresInDays !== null && row.expiresInDays <= 30 ? 'risk-text' : ''}>{row.expiresInDays === null ? 'Not tracked' : row.expiresInDays < 0 ? `${Math.abs(row.expiresInDays)} days expired` : `${row.expiresInDays} days remaining`}</small></td>
                        <td><span className={`stock-status ${row.status}`}>{row.status}</span></td>
                        <td className="numeric"><strong>{row.quantityBase.toLocaleString()}</strong><small>{row.baseUnitCode}</small></td>
                        <td className="row-action-cell">
                          <button className="row-menu" type="button" aria-label={`Open actions for ${row.sku} lot ${row.lot.lotCode}`} aria-expanded={rowMenu === key} onClick={() => setRowMenu((current) => current === key ? null : key)}>•••</button>
                          {rowMenu === key && <div className="row-action-menu">
                            {canTransfer && <button type="button" onClick={() => openAction('transfer', row)}>Transfer</button>}
                            {canAdjust && <button type="button" onClick={() => openAction('adjust', row)}>Adjust</button>}
                            {canChangeStatus && row.status === 'available' && <button type="button" onClick={() => openAction('quarantine', row)}>Quarantine</button>}
                            {canChangeStatus && row.status === 'quarantine' && <button type="button" onClick={() => openAction('release', row)}>Release</button>}
                          </div>}
                        </td>
                      </tr>
                    );
                  })}</tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}

      {activeView === 'movements' && (
        <div className="data-panel ledger-panel">
          <div className="panel-heading"><div><span className="eyebrow">Append-only journal</span><h3>Recent inventory movements</h3></div><div className="action-cluster"><button className="ghost-button compact" type="button" onClick={() => openAction('reverse')} disabled={!canAdjust || movements.length === 0}>Reverse movement</button><button className="ghost-button compact" type="button" onClick={exportActiveView} disabled={movements.length === 0}>Export ledger</button></div></div>
          {movements.length === 0 ? <EmptyState title="No ledger entries" detail="Receipts, adjustments, transfers and status movements will appear here." /> : (
            <div className="movement-list">{movements.map((movement) => <article key={movement.id}><span className={`movement-icon ${movement.movementType}`}>{movement.movementType.slice(0, 2).toUpperCase()}</span><div><strong>{humanizeMovement(movement.movementType)} · {movement.sku}</strong><small>{movement.id} · {movement.referenceType}/{movement.referenceId}</small></div><div><strong>{movement.warehouseCode} · {movement.binCode}</strong><small>{formatDateTime(movement.occurredAt)} · lot {movement.lotCode}</small></div><strong className={movement.quantityDeltaBase < 0 ? 'negative-number' : 'positive-number'}>{signedNumber(movement.quantityDeltaBase)}</strong>{canAdjust && ['receive', 'adjust-in', 'adjust-out'].includes(movement.movementType) && !movement.reversalOfMovementId ? <button className="row-menu" type="button" aria-label={`Reverse movement ${movement.id}`} onClick={() => openAction('reverse', null, movement)}>↶</button> : <span />}</article>)}</div>
          )}
        </div>
      )}

      {activeView === 'aging' && (
        <div className="aging-layout">
          <article className="data-panel aging-chart">
            <div className="panel-heading"><div><span className="eyebrow">Tenant-configured buckets</span><h3>Remaining shelf life</h3></div><button className="ghost-button compact" type="button" onClick={() => openAction('settings')} disabled={!canManageSettings}>Edit buckets</button></div>
            {!aging?.buckets.length ? <EmptyState title="No aging data" detail="Aging appears after inventory with an expiry date is received." /> : (
              <div className="aging-bars">{aging.buckets.map((bucket) => { const percentage = totalAgingQuantity === 0 ? 0 : Math.round((bucket.quantityBase / totalAgingQuantity) * 100); return <div className="aging-row" key={bucket.key}><span>{bucket.label}</span><div><i style={{ width: `${percentage}%` }} /></div><strong>{bucket.quantityBase.toLocaleString()}</strong><small>{bucket.lotCount} lots</small></div>; })}</div>
            )}
          </article>
          <article className="expiry-callout">
            <span className="eyebrow">FEFO recommendation</span>
            {earliestRisk ? <><h3>Allocate {earliestRisk.sku} lot {earliestRisk.lot.lotCode} first</h3><p>This available lot {earliestRisk.expiresInDays !== null && earliestRisk.expiresInDays < 0 ? 'is already expired' : `expires in ${earliestRisk.expiresInDays ?? 'an unknown number of'} days`}. Confirm commercial and quality policy before allocation.</p><dl><div><dt>Available position</dt><dd>{earliestRisk.quantityBase.toLocaleString()} {earliestRisk.baseUnitCode}</dd></div><div><dt>Warehouse</dt><dd>{earliestRisk.warehouseCode}/{earliestRisk.binCode}</dd></div><div><dt>Expiry</dt><dd>{earliestRisk.lot.expiresOn ? formatDate(earliestRisk.lot.expiresOn) : 'Not set'}</dd></div></dl></> : <><h3>No expiring available stock</h3><p>Receive expiry-controlled inventory to generate a tenant-specific FEFO recommendation.</p></>}
            <button className="primary-button" type="button" onClick={() => openAction('fefo')} disabled={application.data.products.length === 0}>Open FEFO planner</button>
          </article>
        </div>
      )}

      {dialog && <InventoryActionDialog action={dialog} onClose={() => setDialog(null)} initialBalanceId={initialBalanceId} initialMovementId={initialMovementId} />}
    </section>
  );
}

function humanizeMovement(value: string): string {
  return value.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

function signedNumber(value: number): string {
  return `${value > 0 ? '+' : ''}${value.toLocaleString()}`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(`${value}T00:00:00Z`));
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function downloadCsv(filename: string, headers: string[], rows: Array<Array<string | number | boolean | null>>) {
  const csv = [headers, ...rows].map((row) => row.map((cell) => `"${String(cell ?? '').replaceAll('"', '""')}"`).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
