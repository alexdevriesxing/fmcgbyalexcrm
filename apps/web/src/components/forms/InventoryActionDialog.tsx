import type {
  AdjustStockRequest,
  ChangeInventoryStatusRequest,
  FefoResponse,
  InventoryBalanceSummary,
  InventoryMovementSummary,
  ReceiveStockRequest,
  ReverseInventoryMovementRequest,
  TransferStockRequest,
  UpdateInventorySettingsRequest
} from '@fmcgbyalex/contracts/inventory';
import { useMemo, useState, type FormEvent } from 'react';
import { useApplication } from '../../state/ApplicationProvider';
import { EmptyState, Modal } from '../Modal';

export type InventoryAction =
  | 'receive'
  | 'transfer'
  | 'adjust'
  | 'quarantine'
  | 'release'
  | 'reverse'
  | 'settings'
  | 'fefo';

export function InventoryActionDialog({
  action,
  onClose,
  initialBalanceId,
  initialMovementId
}: {
  action: InventoryAction;
  onClose: () => void;
  initialBalanceId: string | null;
  initialMovementId: string | null;
}) {
  if (action === 'receive') return <ReceiveDialog onClose={onClose} />;
  if (action === 'transfer') return <TransferDialog onClose={onClose} initialBalanceId={initialBalanceId} />;
  if (action === 'adjust') return <AdjustmentDialog onClose={onClose} initialBalanceId={initialBalanceId} />;
  if (action === 'quarantine' || action === 'release') return <StatusDialog action={action} onClose={onClose} initialBalanceId={initialBalanceId} />;
  if (action === 'reverse') return <ReversalDialog onClose={onClose} initialMovementId={initialMovementId} />;
  if (action === 'settings') return <SettingsDialog onClose={onClose} />;
  return <FefoDialog onClose={onClose} />;
}

function ReceiveDialog({ onClose }: { onClose: () => void }) {
  const application = useApplication();
  const variants = useMemo(() => application.data.products.flatMap((product) => product.variants.map((variant) => ({ ...variant, productName: product.name }))), [application.data.products]);
  const suppliers = application.data.parties.filter((party) => party.type === 'supplier' && party.active);
  const [variantId, setVariantId] = useState(variants[0]?.id ?? '');
  const [warehouseId, setWarehouseId] = useState(application.data.warehouses[0]?.id ?? '');
  const [supplierPartyId, setSupplierPartyId] = useState('');
  const [lotCode, setLotCode] = useState('');
  const [manufacturedOn, setManufacturedOn] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [quantityBase, setQuantityBase] = useState('');
  const [referenceType, setReferenceType] = useState('goods-receipt');
  const [referenceId, setReferenceId] = useState(() => `GRN-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-`);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input: ReceiveStockRequest = {
      variantId,
      warehouseId,
      lotCode: lotCode.trim().toUpperCase(),
      quantityBase: parsePositiveInteger(quantityBase, 'Quantity'),
      referenceType: referenceType.trim(),
      referenceId: referenceId.trim(),
      ...(manufacturedOn ? { manufacturedOn } : {}),
      ...(expiresOn ? { expiresOn } : {}),
      ...(supplierPartyId ? { supplierPartyId } : {})
    };
    try {
      await application.receiveStock(input);
      onClose();
    } catch {
      // The global notice renders structured API failures.
    }
  }

  return (
    <Modal eyebrow="Inventory command" title="Receive stock" description="Creates or reuses the lot, posts a receipt movement and updates the derived balance in one D1 batch." onClose={onClose}>
      {variants.length === 0 || application.data.warehouses.length === 0 ? (
        <EmptyState title="Master data is required" detail="Create at least one SKU and warehouse before receiving inventory." />
      ) : (
        <form className="operational-form" onSubmit={(event) => void submit(event)}>
          <div className="form-grid two-column">
            <label><span>SKU</span><select required value={variantId} onChange={(event) => setVariantId(event.target.value)}>{variants.map((variant) => <option value={variant.id} key={variant.id}>{variant.sku} · {variant.productName} · {variant.name}</option>)}</select></label>
            <label><span>Warehouse</span><select required value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}>{application.data.warehouses.map((warehouse) => <option value={warehouse.id} key={warehouse.id}>{warehouse.code} · {warehouse.name}</option>)}</select></label>
            <label><span>Lot / batch code</span><input required value={lotCode} onChange={(event) => setLotCode(event.target.value)} placeholder="LOT-260721" /></label>
            <label><span>Quantity in base units</span><input required type="number" min={1} step={1} value={quantityBase} onChange={(event) => setQuantityBase(event.target.value)} /></label>
            <label><span>Manufactured on</span><input type="date" value={manufacturedOn} onChange={(event) => setManufacturedOn(event.target.value)} /></label>
            <label><span>Expires on</span><input type="date" value={expiresOn} onChange={(event) => setExpiresOn(event.target.value)} /></label>
            <label><span>Supplier</span><select value={supplierPartyId} onChange={(event) => setSupplierPartyId(event.target.value)}><option value="">Not specified</option>{suppliers.map((supplier) => <option value={supplier.id} key={supplier.id}>{supplier.code} · {supplier.name}</option>)}</select></label>
            <label><span>Reference type</span><input required value={referenceType} onChange={(event) => setReferenceType(event.target.value)} /></label>
            <label className="full-width"><span>Reference ID</span><input required value={referenceId} onChange={(event) => setReferenceId(event.target.value)} /></label>
          </div>
          <FormActions busy={application.busyAction} onCancel={onClose} submitLabel="Post receipt" />
        </form>
      )}
    </Modal>
  );
}

function TransferDialog({ onClose, initialBalanceId }: { onClose: () => void; initialBalanceId: string | null }) {
  const application = useApplication();
  const balances = (application.data.inventory?.balances ?? []).filter((balance) => balance.quantityBase > 0);
  const [balanceId, setBalanceId] = useState(initialBalanceId && balances.some((balance) => balanceKey(balance) === initialBalanceId) ? initialBalanceId : balances[0] ? balanceKey(balances[0]) : '');
  const selected = balances.find((balance) => balanceKey(balance) === balanceId) ?? null;
  const destinationOptions = application.data.warehouses.filter((warehouse) => warehouse.id !== selected?.warehouseId);
  const [destinationWarehouseId, setDestinationWarehouseId] = useState(destinationOptions[0]?.id ?? '');
  const [quantityBase, setQuantityBase] = useState('');
  const [referenceId, setReferenceId] = useState(() => `TRN-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-`);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const input: TransferStockRequest = {
      variantId: selected.variantId,
      sourceWarehouseId: selected.warehouseId,
      sourceBinId: selected.binId,
      destinationWarehouseId,
      lotId: selected.lot.id,
      status: selected.status,
      quantityBase: parsePositiveInteger(quantityBase, 'Quantity'),
      referenceId: referenceId.trim()
    };
    try {
      await application.transferStock(input);
      onClose();
    } catch {
      // The global notice renders structured API failures.
    }
  }

  return (
    <Modal eyebrow="Inventory command" title="Transfer stock" description="Posts a balanced transfer-out and transfer-in pair; either both entries commit or neither does." onClose={onClose}>
      {balances.length === 0 || application.data.warehouses.length < 2 ? (
        <EmptyState title="A transfer is not available" detail="You need positive stock and at least two active warehouses." />
      ) : (
        <form className="operational-form" onSubmit={(event) => void submit(event)}>
          <div className="form-grid two-column">
            <label className="full-width"><span>Source stock position</span><select required value={balanceId} onChange={(event) => { setBalanceId(event.target.value); setDestinationWarehouseId(''); }}>{balances.map((balance) => <option value={balanceKey(balance)} key={balanceKey(balance)}>{balance.sku} · {balance.warehouseCode}/{balance.binCode} · {balance.lot.lotCode} · {balance.quantityBase.toLocaleString()} {balance.baseUnitCode}</option>)}</select></label>
            <label><span>Destination warehouse</span><select required value={destinationWarehouseId} onChange={(event) => setDestinationWarehouseId(event.target.value)}><option value="">Select destination</option>{destinationOptions.map((warehouse) => <option value={warehouse.id} key={warehouse.id}>{warehouse.code} · {warehouse.name}</option>)}</select></label>
            <label><span>Quantity</span><input required type="number" min={1} max={selected?.quantityBase} step={1} value={quantityBase} onChange={(event) => setQuantityBase(event.target.value)} /></label>
            <label className="full-width"><span>Transfer reference</span><input required value={referenceId} onChange={(event) => setReferenceId(event.target.value)} /></label>
          </div>
          {selected && <StockPositionSummary balance={selected} />}
          <FormActions busy={application.busyAction} onCancel={onClose} submitLabel="Post transfer" />
        </form>
      )}
    </Modal>
  );
}

function AdjustmentDialog({ onClose, initialBalanceId }: { onClose: () => void; initialBalanceId: string | null }) {
  const application = useApplication();
  const balances = application.data.inventory?.balances ?? [];
  const [balanceId, setBalanceId] = useState(initialBalanceId && balances.some((balance) => balanceKey(balance) === initialBalanceId) ? initialBalanceId : balances[0] ? balanceKey(balances[0]) : '');
  const selected = balances.find((balance) => balanceKey(balance) === balanceId) ?? null;
  const [quantityDeltaBase, setQuantityDeltaBase] = useState('');
  const [reason, setReason] = useState('Cycle count correction');
  const [referenceId, setReferenceId] = useState(() => `ADJ-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-`);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const input: AdjustStockRequest = {
      variantId: selected.variantId,
      warehouseId: selected.warehouseId,
      binId: selected.binId,
      lotId: selected.lot.id,
      status: selected.status,
      quantityDeltaBase: parseNonZeroInteger(quantityDeltaBase, 'Adjustment quantity'),
      reason: reason.trim(),
      referenceId: referenceId.trim()
    };
    try {
      await application.adjustStock(input);
      onClose();
    } catch {
      // The global notice renders structured API failures.
    }
  }

  return (
    <Modal eyebrow="Inventory command" title="Post stock adjustment" description="Use a signed whole-number delta. The database rejects any result below zero." onClose={onClose}>
      {balances.length === 0 ? <EmptyState title="No stock positions" detail="Receive inventory before posting an adjustment." /> : (
        <form className="operational-form" onSubmit={(event) => void submit(event)}>
          <div className="form-grid two-column">
            <label className="full-width"><span>Stock position</span><select required value={balanceId} onChange={(event) => setBalanceId(event.target.value)}>{balances.map((balance) => <option value={balanceKey(balance)} key={balanceKey(balance)}>{balance.sku} · {balance.warehouseCode}/{balance.binCode} · {balance.lot.lotCode} · {balance.status}</option>)}</select></label>
            <label><span>Signed quantity delta</span><input required type="number" step={1} value={quantityDeltaBase} onChange={(event) => setQuantityDeltaBase(event.target.value)} placeholder="-12 or 24" /></label>
            <label><span>Reference ID</span><input required value={referenceId} onChange={(event) => setReferenceId(event.target.value)} /></label>
            <label className="full-width"><span>Reason</span><textarea required rows={3} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
          </div>
          {selected && <StockPositionSummary balance={selected} />}
          <FormActions busy={application.busyAction} onCancel={onClose} submitLabel="Post adjustment" />
        </form>
      )}
    </Modal>
  );
}

function StatusDialog({ action, onClose, initialBalanceId }: { action: 'quarantine' | 'release'; onClose: () => void; initialBalanceId: string | null }) {
  const application = useApplication();
  const sourceStatus = action === 'quarantine' ? 'available' : 'quarantine';
  const balances = (application.data.inventory?.balances ?? []).filter((balance) => balance.status === sourceStatus && balance.quantityBase > 0);
  const [balanceId, setBalanceId] = useState(initialBalanceId && balances.some((balance) => balanceKey(balance) === initialBalanceId) ? initialBalanceId : balances[0] ? balanceKey(balances[0]) : '');
  const selected = balances.find((balance) => balanceKey(balance) === balanceId) ?? null;
  const [quantityBase, setQuantityBase] = useState('');
  const [reason, setReason] = useState(action === 'quarantine' ? 'Quality inspection required' : 'Quality disposition approved');
  const [referenceId, setReferenceId] = useState(() => `${action === 'quarantine' ? 'QA' : 'REL'}-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-`);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const input: ChangeInventoryStatusRequest = {
      variantId: selected.variantId,
      warehouseId: selected.warehouseId,
      binId: selected.binId,
      lotId: selected.lot.id,
      quantityBase: parsePositiveInteger(quantityBase, 'Quantity'),
      reason: reason.trim(),
      referenceId: referenceId.trim()
    };
    try {
      if (action === 'quarantine') await application.quarantineStock(input);
      else await application.releaseStock(input);
      onClose();
    } catch {
      // The global notice renders structured API failures.
    }
  }

  return (
    <Modal eyebrow="Inventory status" title={action === 'quarantine' ? 'Move stock to quarantine' : 'Release quarantined stock'} description="Status changes are balanced ledger pairs and preserve the complete stock history." onClose={onClose}>
      {balances.length === 0 ? <EmptyState title={`No ${sourceStatus} stock`} detail={`There are no positive ${sourceStatus} balances available for this command.`} /> : (
        <form className="operational-form" onSubmit={(event) => void submit(event)}>
          <div className="form-grid two-column">
            <label className="full-width"><span>Stock position</span><select required value={balanceId} onChange={(event) => setBalanceId(event.target.value)}>{balances.map((balance) => <option value={balanceKey(balance)} key={balanceKey(balance)}>{balance.sku} · {balance.warehouseCode}/{balance.binCode} · {balance.lot.lotCode} · {balance.quantityBase.toLocaleString()}</option>)}</select></label>
            <label><span>Quantity</span><input required type="number" min={1} max={selected?.quantityBase} step={1} value={quantityBase} onChange={(event) => setQuantityBase(event.target.value)} /></label>
            <label><span>Reference ID</span><input required value={referenceId} onChange={(event) => setReferenceId(event.target.value)} /></label>
            <label className="full-width"><span>Reason</span><textarea required rows={3} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
          </div>
          {selected && <StockPositionSummary balance={selected} />}
          <FormActions busy={application.busyAction} onCancel={onClose} submitLabel={action === 'quarantine' ? 'Quarantine stock' : 'Release stock'} />
        </form>
      )}
    </Modal>
  );
}

function ReversalDialog({ onClose, initialMovementId }: { onClose: () => void; initialMovementId: string | null }) {
  const application = useApplication();
  const movements = (application.data.inventory?.recentMovements ?? []).filter((movement) => ['receive', 'adjust-in', 'adjust-out'].includes(movement.movementType) && !movement.reversalOfMovementId);
  const [movementId, setMovementId] = useState(initialMovementId && movements.some((movement) => movement.id === initialMovementId) ? initialMovementId : movements[0]?.id ?? '');
  const selected = movements.find((movement) => movement.id === movementId) ?? null;
  const [reason, setReason] = useState('Correct erroneous inventory posting');
  const [referenceId, setReferenceId] = useState(() => `REV-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-`);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const input: ReverseInventoryMovementRequest = { reason: reason.trim(), referenceId: referenceId.trim() };
    try {
      await application.reverseMovement(selected.id, input);
      onClose();
    } catch {
      // The global notice renders structured API failures.
    }
  }

  return (
    <Modal eyebrow="Ledger correction" title="Reverse inventory movement" description="History is never edited. A new movement with the opposite quantity is linked to the original entry." onClose={onClose}>
      {movements.length === 0 ? <EmptyState title="No reversible recent movement" detail="Only standalone receipts and adjustments can be reversed from this view." /> : (
        <form className="operational-form" onSubmit={(event) => void submit(event)}>
          <div className="form-grid">
            <label><span>Original movement</span><select required value={movementId} onChange={(event) => setMovementId(event.target.value)}>{movements.map((movement) => <option value={movement.id} key={movement.id}>{movement.id} · {movement.movementType} · {movement.sku} · {signedNumber(movement.quantityDeltaBase)}</option>)}</select></label>
            <label><span>Reversal reference</span><input required value={referenceId} onChange={(event) => setReferenceId(event.target.value)} /></label>
            <label><span>Reason</span><textarea required rows={3} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
          </div>
          {selected && <MovementSummary movement={selected} />}
          <FormActions busy={application.busyAction} onCancel={onClose} submitLabel="Post reversal" />
        </form>
      )}
    </Modal>
  );
}

function SettingsDialog({ onClose }: { onClose: () => void }) {
  const application = useApplication();
  const [buckets, setBuckets] = useState((application.data.inventorySettings?.agingBucketsDays ?? [30, 60, 90, 180]).join(', '));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = [...new Set(buckets.split(',').map((value) => Number(value.trim())).filter((value) => Number.isSafeInteger(value) && value > 0))].sort((a, b) => a - b);
    if (parsed.length === 0) throw new Error('Provide at least one positive aging boundary.');
    const input: UpdateInventorySettingsRequest = { agingBucketsDays: parsed };
    try {
      await application.updateInventorySettings(input);
      onClose();
    } catch {
      // The global notice renders structured API failures.
    }
  }

  return (
    <Modal eyebrow="Tenant inventory policy" title="Configure aging buckets" description="Boundaries are stored per tenant and immediately drive the expiry analysis." onClose={onClose}>
      <form className="operational-form" onSubmit={(event) => void submit(event)}>
        <label><span>Remaining shelf-life boundaries in days</span><input required value={buckets} onChange={(event) => setBuckets(event.target.value)} placeholder="30, 60, 90, 180" /><small>Enter ascending positive whole numbers separated by commas.</small></label>
        <FormActions busy={application.busyAction} onCancel={onClose} submitLabel="Save aging policy" />
      </form>
    </Modal>
  );
}

function FefoDialog({ onClose }: { onClose: () => void }) {
  const application = useApplication();
  const variants = useMemo(() => application.data.products.flatMap((product) => product.variants.map((variant) => ({ ...variant, productName: product.name }))), [application.data.products]);
  const [variantId, setVariantId] = useState(variants[0]?.id ?? '');
  const [warehouseId, setWarehouseId] = useState('');
  const [quantityBase, setQuantityBase] = useState('');
  const [result, setResult] = useState<FefoResponse | null>(null);
  const [planning, setPlanning] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPlanning(true);
    try {
      setResult(await application.planFefo(variantId, parsePositiveInteger(quantityBase, 'Quantity'), warehouseId || null));
    } finally {
      setPlanning(false);
    }
  }

  return (
    <Modal eyebrow="Allocation planning" title="FEFO stock recommendation" description="Selects available balances by earliest expiry, then manufacture date and lot code." onClose={onClose} width="wide">
      {variants.length === 0 ? <EmptyState title="No SKUs available" detail="Create a product before requesting a FEFO plan." /> : (
        <form className="operational-form" onSubmit={(event) => void submit(event)}>
          <div className="form-grid three-column">
            <label><span>SKU</span><select required value={variantId} onChange={(event) => setVariantId(event.target.value)}>{variants.map((variant) => <option value={variant.id} key={variant.id}>{variant.sku} · {variant.productName}</option>)}</select></label>
            <label><span>Requested quantity</span><input required type="number" min={1} step={1} value={quantityBase} onChange={(event) => setQuantityBase(event.target.value)} /></label>
            <label><span>Warehouse</span><select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}><option value="">All warehouses</option>{application.data.warehouses.map((warehouse) => <option value={warehouse.id} key={warehouse.id}>{warehouse.code} · {warehouse.name}</option>)}</select></label>
          </div>
          <div className="form-actions"><button className="ghost-button" type="button" onClick={onClose}>Close</button><button className="primary-button" type="submit" disabled={planning}>{planning ? 'Planning…' : 'Build FEFO plan'}</button></div>
        </form>
      )}
      {result && (
        <div className="fefo-result">
          <div className="fefo-result-head"><div><span className="eyebrow">Allocation result</span><h3>{result.fullyAllocated ? 'Fully allocated' : 'Insufficient available stock'}</h3></div><strong>{result.allocatedQuantityBase.toLocaleString()} / {result.requestedQuantityBase.toLocaleString()}</strong></div>
          <div className="fefo-candidates">{result.candidates.map((candidate, index) => <article key={balanceKey(candidate.balance)}><span>{index + 1}</span><div><strong>{candidate.balance.lot.lotCode} · {candidate.balance.warehouseCode}/{candidate.balance.binCode}</strong><small>{candidate.balance.lot.expiresOn ?? 'No expiry'} · {candidate.balance.quantityBase.toLocaleString()} available</small></div><strong>{candidate.recommendedQuantityBase.toLocaleString()}</strong></article>)}</div>
        </div>
      )}
    </Modal>
  );
}

function StockPositionSummary({ balance }: { balance: InventoryBalanceSummary }) {
  return <div className="selection-summary"><div><span>SKU</span><strong>{balance.sku}</strong></div><div><span>Lot</span><strong>{balance.lot.lotCode}</strong></div><div><span>Location</span><strong>{balance.warehouseCode}/{balance.binCode}</strong></div><div><span>Available position</span><strong>{balance.quantityBase.toLocaleString()} {balance.baseUnitCode}</strong></div></div>;
}

function MovementSummary({ movement }: { movement: InventoryMovementSummary }) {
  return <div className="selection-summary"><div><span>Movement</span><strong>{movement.movementType}</strong></div><div><span>SKU / lot</span><strong>{movement.sku} · {movement.lotCode}</strong></div><div><span>Location</span><strong>{movement.warehouseCode}/{movement.binCode}</strong></div><div><span>Delta</span><strong>{signedNumber(movement.quantityDeltaBase)}</strong></div></div>;
}

function FormActions({ busy, onCancel, submitLabel }: { busy: string | null; onCancel: () => void; submitLabel: string }) {
  return <div className="form-actions"><button className="ghost-button" type="button" onClick={onCancel}>Cancel</button><button className="primary-button" type="submit" disabled={busy !== null}>{busy ?? submitLabel}</button></div>;
}

export function balanceKey(balance: InventoryBalanceSummary): string {
  return [balance.variantId, balance.warehouseId, balance.binId, balance.lot.id, balance.status].join(':');
}

function signedNumber(value: number): string {
  return `${value > 0 ? '+' : ''}${value.toLocaleString()}`;
}

function parsePositiveInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${label} must be a positive whole number.`);
  return parsed;
}

function parseNonZeroInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed === 0) throw new Error(`${label} must be a non-zero whole number.`);
  return parsed;
}
