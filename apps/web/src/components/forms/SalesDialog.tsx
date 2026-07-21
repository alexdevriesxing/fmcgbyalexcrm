import type {
  QuoteSummary,
  SalesOrderSummary
} from '@fmcgbyalex/contracts/commercial';
import { useMemo, useState, type FormEvent } from 'react';
import { useApplication } from '../../state/ApplicationProvider';
import { useCommercial } from '../../state/CommercialProvider';
import { Modal } from '../Modal';

export type SalesAction =
  | 'price-list'
  | 'quote'
  | { type: 'send'; quote: QuoteSummary }
  | { type: 'accept'; quote: QuoteSummary }
  | { type: 'convert'; quote: QuoteSummary }
  | { type: 'cancel'; order: SalesOrderSummary };

type PriceRow = {
  id: string;
  variantId: string;
  minimumQuantityBase: string;
  unitPrice: string;
  taxPercent: string;
};

type QuoteRow = {
  id: string;
  variantId: string;
  quantityBase: string;
  unitPrice: string;
  discountPercent: string;
  taxPercent: string;
};

export function SalesDialog({ action, onClose }: { action: SalesAction; onClose: () => void }) {
  if (action === 'price-list') return <PriceListDialog onClose={onClose} />;
  if (action === 'quote') return <QuoteDialog onClose={onClose} />;
  if (action.type === 'convert') return <ConvertDialog quote={action.quote} onClose={onClose} />;
  if (action.type === 'cancel') return <CancelOrderDialog order={action.order} onClose={onClose} />;
  return <QuoteTransitionDialog action={action} onClose={onClose} />;
}

function PriceListDialog({ onClose }: { onClose: () => void }) {
  const application = useApplication();
  const commercial = useCommercial();
  const variants = productVariants(application.data.products);
  const currencyCode = application.session?.tenant.defaultCurrency ?? 'EUR';
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [validFrom, setValidFrom] = useState(today());
  const [validUntil, setValidUntil] = useState('');
  const [rows, setRows] = useState<PriceRow[]>([emptyPriceRow(variants[0]?.id ?? '')]);

  function updateRow(id: string, patch: Partial<PriceRow>) {
    setRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await commercial.createPriceList({
        code,
        name,
        currencyCode,
        ...(validFrom ? { validFrom } : {}),
        ...(validUntil ? { validUntil } : {}),
        items: rows.map((row) => ({
          variantId: row.variantId,
          minimumQuantityBase: positiveInteger(row.minimumQuantityBase, 'Minimum quantity'),
          unitPriceMinor: toMinorUnits(row.unitPrice),
          taxBasisPoints: percentToBasisPoints(row.taxPercent)
        }))
      });
      onClose();
    } catch {
      // Provider publishes structured errors.
    }
  }

  return (
    <Modal eyebrow="Commercial pricing" title="Create price list" description="Prices use integer minor units and quantity breaks use integer base units." onClose={onClose} width="wide">
      <form className="operational-form" onSubmit={(event) => void submit(event)}>
        <div className="form-grid two-column">
          <label><span>Price-list code</span><input required value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="EUR-RETAIL-2026" /></label>
          <label><span>Price-list name</span><input required value={name} onChange={(event) => setName(event.target.value)} placeholder="EUR Retail 2026" /></label>
          <label><span>Valid from</span><input type="date" value={validFrom} onChange={(event) => setValidFrom(event.target.value)} /></label>
          <label><span>Valid until</span><input type="date" value={validUntil} onChange={(event) => setValidUntil(event.target.value)} /></label>
        </div>
        <div className="line-editor">
          <div className="line-editor-heading"><div><span className="eyebrow">Pricing lines</span><h3>SKU quantity breaks</h3></div><button className="ghost-button compact" type="button" onClick={() => setRows((current) => [...current, emptyPriceRow(variants[0]?.id ?? '')])}>Add line</button></div>
          {rows.map((row, index) => (
            <div className="commercial-line-grid price-line" key={row.id}>
              <span className="line-number">{index + 1}</span>
              <label><span>SKU</span><select required value={row.variantId} onChange={(event) => updateRow(row.id, { variantId: event.target.value })}><option value="">Select SKU</option>{variants.map((variant) => <option value={variant.id} key={variant.id}>{variant.sku} · {variant.name}</option>)}</select></label>
              <label><span>Minimum qty</span><input required type="number" min="1" step="1" value={row.minimumQuantityBase} onChange={(event) => updateRow(row.id, { minimumQuantityBase: event.target.value })} /></label>
              <label><span>Unit price ({currencyCode})</span><input required inputMode="decimal" value={row.unitPrice} onChange={(event) => updateRow(row.id, { unitPrice: event.target.value })} placeholder="1.99" /></label>
              <label><span>Tax %</span><input required type="number" min="0" max="100" step="0.01" value={row.taxPercent} onChange={(event) => updateRow(row.id, { taxPercent: event.target.value })} /></label>
              <button className="row-menu danger-text" type="button" aria-label={`Remove price line ${index + 1}`} disabled={rows.length === 1} onClick={() => setRows((current) => current.filter((item) => item.id !== row.id))}>×</button>
            </div>
          ))}
        </div>
        <DialogActions busy={commercial.busyAction} label="Create price list" onClose={onClose} disabled={variants.length === 0 || rows.some((row) => !row.variantId || !row.unitPrice)} />
      </form>
    </Modal>
  );
}

function QuoteDialog({ onClose }: { onClose: () => void }) {
  const application = useApplication();
  const commercial = useCommercial();
  const accounts = commercial.crm?.accounts.filter((account) => account.status === 'active') ?? [];
  const variants = productVariants(application.data.products);
  const currencyCode = application.session?.tenant.defaultCurrency ?? 'EUR';
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [validUntil, setValidUntil] = useState(inDays(30));
  const [customerReference, setCustomerReference] = useState('');
  const [notes, setNotes] = useState('');
  const [rows, setRows] = useState<QuoteRow[]>([emptyQuoteRow(variants[0]?.id ?? '')]);

  function updateRow(id: string, patch: Partial<QuoteRow>) {
    setRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row));
  }

  const preview = useMemo(() => calculatePreview(rows), [rows]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await commercial.createQuote({
        accountId,
        currencyCode,
        validUntil,
        ...(customerReference.trim() ? { customerReference: customerReference.trim() } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        lines: rows.map((row) => ({
          variantId: row.variantId,
          quantityBase: positiveInteger(row.quantityBase, 'Quantity'),
          unitPriceMinor: toMinorUnits(row.unitPrice),
          discountBasisPoints: percentToBasisPoints(row.discountPercent),
          taxBasisPoints: percentToBasisPoints(row.taxPercent)
        }))
      });
      onClose();
    } catch {
      // Provider publishes structured errors.
    }
  }

  return (
    <Modal eyebrow="Sales quotation" title="Create quotation" description="The preview is indicative; the Worker recomputes and stores the authoritative totals." onClose={onClose} width="wide">
      <form className="operational-form" onSubmit={(event) => void submit(event)}>
        <div className="form-grid two-column">
          <label><span>CRM account</span><select required value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="">Select account</option>{accounts.map((account) => <option value={account.id} key={account.id}>{account.name} · {account.code}</option>)}</select></label>
          <label><span>Valid until</span><input required type="date" value={validUntil} onChange={(event) => setValidUntil(event.target.value)} /></label>
          <label><span>Customer reference</span><input value={customerReference} onChange={(event) => setCustomerReference(event.target.value)} /></label>
          <label><span>Currency</span><input readOnly value={currencyCode} /></label>
        </div>
        <div className="line-editor">
          <div className="line-editor-heading"><div><span className="eyebrow">Quotation lines</span><h3>Products and commercial terms</h3></div><button className="ghost-button compact" type="button" onClick={() => setRows((current) => [...current, emptyQuoteRow(variants[0]?.id ?? '')])}>Add line</button></div>
          {rows.map((row, index) => (
            <div className="commercial-line-grid quote-line" key={row.id}>
              <span className="line-number">{index + 1}</span>
              <label><span>SKU</span><select required value={row.variantId} onChange={(event) => updateRow(row.id, { variantId: event.target.value })}><option value="">Select SKU</option>{variants.map((variant) => <option value={variant.id} key={variant.id}>{variant.sku} · {variant.name}</option>)}</select></label>
              <label><span>Quantity</span><input required type="number" min="1" step="1" value={row.quantityBase} onChange={(event) => updateRow(row.id, { quantityBase: event.target.value })} /></label>
              <label><span>Unit price</span><input required inputMode="decimal" value={row.unitPrice} onChange={(event) => updateRow(row.id, { unitPrice: event.target.value })} placeholder="1.99" /></label>
              <label><span>Discount %</span><input required type="number" min="0" max="100" step="0.01" value={row.discountPercent} onChange={(event) => updateRow(row.id, { discountPercent: event.target.value })} /></label>
              <label><span>Tax %</span><input required type="number" min="0" max="100" step="0.01" value={row.taxPercent} onChange={(event) => updateRow(row.id, { taxPercent: event.target.value })} /></label>
              <button className="row-menu danger-text" type="button" aria-label={`Remove quotation line ${index + 1}`} disabled={rows.length === 1} onClick={() => setRows((current) => current.filter((item) => item.id !== row.id))}>×</button>
            </div>
          ))}
        </div>
        <div className="quote-preview"><span>Browser preview</span><strong>{formatMoney(preview.totalMinor, currencyCode)}</strong><small>Subtotal {formatMoney(preview.subtotalMinor, currencyCode)} · Discount {formatMoney(preview.discountMinor, currencyCode)} · Tax {formatMoney(preview.taxMinor, currencyCode)}</small></div>
        <label><span>Commercial notes</span><textarea rows={4} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
        <DialogActions busy={commercial.busyAction} label="Create quotation" onClose={onClose} disabled={!accountId || variants.length === 0 || rows.some((row) => !row.variantId || !row.unitPrice)} />
      </form>
    </Modal>
  );
}

function QuoteTransitionDialog({ action, onClose }: { action: Extract<SalesAction, { type: 'send' | 'accept' }>; onClose: () => void }) {
  const commercial = useCommercial();
  const verb = action.type === 'send' ? 'Send' : 'Accept';
  const detail = action.type === 'send'
    ? 'This moves the draft quotation into customer decision status.'
    : 'This confirms customer acceptance. Inventory is not reserved until order conversion.';

  async function submit() {
    try {
      if (action.type === 'send') await commercial.sendQuote(action.quote.id);
      else await commercial.acceptQuote(action.quote.id);
      onClose();
    } catch {
      // Provider publishes structured errors.
    }
  }

  return (
    <Modal eyebrow="Quotation transition" title={`${verb} ${action.quote.quoteNumber}`} description={detail} onClose={onClose}>
      <DocumentSummary label={action.quote.accountName} number={action.quote.quoteNumber} status={action.quote.status} totalMinor={action.quote.totalMinor} currencyCode={action.quote.currencyCode} lines={action.quote.lines.length} />
      <div className="form-actions"><button className="ghost-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="button" onClick={() => void submit()} disabled={commercial.busyAction !== null}>{commercial.busyAction ?? `${verb} quotation`}</button></div>
    </Modal>
  );
}

function ConvertDialog({ quote, onClose }: { quote: QuoteSummary; onClose: () => void }) {
  const application = useApplication();
  const commercial = useCommercial();
  const warehouses = application.data.warehouses;
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? '');
  const [requestedDeliveryDate, setRequestedDeliveryDate] = useState(inDays(14));
  const [customerReference, setCustomerReference] = useState(quote.customerReference ?? '');
  const availability = commercial.sales?.availability ?? [];
  const warehouseAvailability = quote.lines.map((line) => {
    const position = availability.find((item) => item.variantId === line.variantId && item.warehouseId === warehouseId);
    return { line, availableToPromiseBase: position?.availableToPromiseBase ?? 0 };
  });
  const insufficient = warehouseAvailability.some((item) => item.availableToPromiseBase < item.line.quantityBase);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await commercial.convertQuote(quote.id, {
        warehouseId,
        ...(requestedDeliveryDate ? { requestedDeliveryDate } : {}),
        ...(customerReference.trim() ? { customerReference: customerReference.trim() } : {})
      });
      onClose();
    } catch {
      // Provider publishes structured errors.
    }
  }

  return (
    <Modal eyebrow="Quote-to-order" title={`Allocate ${quote.quoteNumber}`} description="Order lines and warehouse reservations commit atomically or roll back together." onClose={onClose} width="wide">
      <form className="operational-form" onSubmit={(event) => void submit(event)}>
        <DocumentSummary label={quote.accountName} number={quote.quoteNumber} status={quote.status} totalMinor={quote.totalMinor} currencyCode={quote.currencyCode} lines={quote.lines.length} />
        <div className="form-grid two-column">
          <label><span>Allocation warehouse</span><select required value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}><option value="">Select warehouse</option>{warehouses.map((warehouse) => <option value={warehouse.id} key={warehouse.id}>{warehouse.name} · {warehouse.code}</option>)}</select></label>
          <label><span>Requested delivery</span><input type="date" value={requestedDeliveryDate} onChange={(event) => setRequestedDeliveryDate(event.target.value)} /></label>
          <label><span>Customer reference</span><input value={customerReference} onChange={(event) => setCustomerReference(event.target.value)} /></label>
        </div>
        <div className="allocation-check-list">
          {warehouseAvailability.map(({ line, availableToPromiseBase }) => <div className={availableToPromiseBase < line.quantityBase ? 'insufficient' : ''} key={line.id}><span><strong>{line.sku}</strong><small>Requested {line.quantityBase.toLocaleString()}</small></span><span><strong>{availableToPromiseBase.toLocaleString()}</strong><small>available to promise</small></span></div>)}
        </div>
        {insufficient && <div className="inline-warning">The selected warehouse cannot satisfy every line. Conversion will be rejected without partial reservations.</div>}
        <DialogActions busy={commercial.busyAction} label="Create and allocate order" onClose={onClose} disabled={!warehouseId || insufficient} />
      </form>
    </Modal>
  );
}

function CancelOrderDialog({ order, onClose }: { order: SalesOrderSummary; onClose: () => void }) {
  const commercial = useCommercial();
  const activeReservations = commercial.sales?.reservations.filter((reservation) => reservation.orderId === order.id && reservation.status === 'active') ?? [];

  async function submit() {
    try {
      await commercial.cancelOrder(order.id);
      onClose();
    } catch {
      // Provider publishes structured errors.
    }
  }

  return (
    <Modal eyebrow="Order cancellation" title={`Cancel ${order.orderNumber}`} description="Cancellation is audited and releases all active inventory reservations for this order." onClose={onClose}>
      <DocumentSummary label={order.accountName} number={order.orderNumber} status={order.status} totalMinor={order.totalMinor} currencyCode={order.currencyCode} lines={order.lines.length} />
      <div className="cancellation-impact"><strong>{activeReservations.length} reservation{activeReservations.length === 1 ? '' : 's'} will be released</strong><span>{activeReservations.reduce((sum, reservation) => sum + reservation.quantityBase, 0).toLocaleString()} base units return to available-to-promise.</span></div>
      <div className="form-actions"><button className="ghost-button" type="button" onClick={onClose}>Keep order</button><button className="primary-button danger-button" type="button" onClick={() => void submit()} disabled={commercial.busyAction !== null}>{commercial.busyAction ?? 'Cancel and release stock'}</button></div>
    </Modal>
  );
}

function DocumentSummary({ label, number, status, totalMinor, currencyCode, lines }: { label: string; number: string; status: string; totalMinor: number; currencyCode: string; lines: number }) {
  return <div className="document-summary"><div><span className="eyebrow">Commercial document</span><h3>{number}</h3><p>{label}</p></div><dl><div><dt>Status</dt><dd><span className={`commercial-status ${status}`}>{status}</span></dd></div><div><dt>Lines</dt><dd>{lines}</dd></div><div><dt>Total</dt><dd>{formatMoney(totalMinor, currencyCode)}</dd></div></dl></div>;
}

function DialogActions({ busy, label, onClose, disabled = false }: { busy: string | null; label: string; onClose: () => void; disabled?: boolean }) {
  return <div className="form-actions"><button className="ghost-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit" disabled={busy !== null || disabled}>{busy ?? label}</button></div>;
}

function productVariants(products: ReturnType<typeof useApplication>['data']['products']): Array<{ id: string; sku: string; name: string }> {
  return products.flatMap((product) => product.variants.map((variant) => ({ id: variant.id, sku: variant.sku, name: `${product.name} · ${variant.name}` })));
}

function emptyPriceRow(variantId: string): PriceRow {
  return { id: crypto.randomUUID(), variantId, minimumQuantityBase: '1', unitPrice: '', taxPercent: '21' };
}

function emptyQuoteRow(variantId: string): QuoteRow {
  return { id: crypto.randomUUID(), variantId, quantityBase: '1', unitPrice: '', discountPercent: '0', taxPercent: '21' };
}

function positiveInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${label} must be a positive integer.`);
  return parsed;
}

function toMinorUnits(value: string): number {
  const normalized = value.trim().replace(',', '.');
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) throw new Error('Enter a valid monetary amount with at most two decimals.');
  const [whole = '0', fraction = ''] = normalized.split('.');
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(result)) throw new Error('The monetary value exceeds safe limits.');
  return result;
}

function percentToBasisPoints(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) throw new Error('Percentage must be between 0 and 100.');
  return Math.round(parsed * 100);
}

function calculatePreview(rows: QuoteRow[]): { subtotalMinor: number; discountMinor: number; taxMinor: number; totalMinor: number } {
  return rows.reduce((totals, row) => {
    try {
      const quantity = positiveInteger(row.quantityBase, 'Quantity');
      const unitPrice = toMinorUnits(row.unitPrice || '0');
      const subtotal = quantity * unitPrice;
      const discount = Math.floor((subtotal * percentToBasisPoints(row.discountPercent)) / 10000);
      const tax = Math.floor(((subtotal - discount) * percentToBasisPoints(row.taxPercent)) / 10000);
      return {
        subtotalMinor: totals.subtotalMinor + subtotal,
        discountMinor: totals.discountMinor + discount,
        taxMinor: totals.taxMinor + tax,
        totalMinor: totals.totalMinor + subtotal - discount + tax
      };
    } catch {
      return totals;
    }
  }, { subtotalMinor: 0, discountMinor: 0, taxMinor: 0, totalMinor: 0 });
}

function formatMoney(valueMinor: number, currencyCode: string): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: currencyCode }).format(valueMinor / 100);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function inDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}
