import type { QuoteSummary, SalesOrderSummary } from '@fmcgbyalex/contracts/commercial';
import { useEffect, useMemo, useState } from 'react';
import { useApplication } from '../state/ApplicationProvider';
import { useCommercial } from '../state/CommercialProvider';
import { EmptyState, InlineLoading } from './Modal';
import { SalesDialog, type SalesAction } from './forms/SalesDialog';

type SalesView = 'quotes' | 'orders' | 'pricing' | 'availability';
type RequestedSalesAction = Extract<SalesAction, string>;

export function SalesWorkspace({ requestedAction, onActionConsumed }: { requestedAction: RequestedSalesAction | null; onActionConsumed: () => void }) {
  const application = useApplication();
  const commercial = useCommercial();
  const [view, setView] = useState<SalesView>('quotes');
  const [query, setQuery] = useState('');
  const [dialog, setDialog] = useState<SalesAction | null>(null);
  const sales = commercial.sales;

  useEffect(() => {
    if (requestedAction) {
      setDialog(requestedAction);
      onActionConsumed();
    }
  }, [requestedAction, onActionConsumed]);

  const normalized = query.trim().toLowerCase();
  const quotes = useMemo(() => (sales?.quotes ?? []).filter((quote) =>
    !normalized || [quote.quoteNumber, quote.accountName, quote.status, quote.customerReference ?? '']
      .some((value) => value.toLowerCase().includes(normalized))
  ), [sales?.quotes, normalized]);
  const orders = useMemo(() => (sales?.orders ?? []).filter((order) =>
    !normalized || [order.orderNumber, order.accountName, order.status, order.customerReference ?? '']
      .some((value) => value.toLowerCase().includes(normalized))
  ), [sales?.orders, normalized]);
  const priceLists = useMemo(() => (sales?.priceLists ?? []).filter((priceList) =>
    !normalized || [priceList.code, priceList.name, priceList.currencyCode]
      .some((value) => value.toLowerCase().includes(normalized))
  ), [sales?.priceLists, normalized]);
  const availability = useMemo(() => (sales?.availability ?? []).filter((item) =>
    !normalized || [item.sku, item.warehouseCode].some((value) => value.toLowerCase().includes(normalized))
  ), [sales?.availability, normalized]);

  const canManageQuotes = application.hasPermission('sales.quotes.manage');
  const canManagePricing = application.hasPermission('sales.pricing.manage');
  const canManageOrders = application.hasPermission('sales.orders.manage');
  const canReserve = application.hasPermission('sales.orders.reserve');
  const currencyCode = application.session?.tenant.defaultCurrency ?? 'EUR';

  return (
    <section className="workspace-stack" aria-labelledby="sales-title">
      <div className="workspace-heading">
        <div><span className="eyebrow">Sales and order management</span><h2 id="sales-title">Revenue commitment centre</h2><p>Control pricing, quotations, customer acceptance, order allocation and available-to-promise inventory without bypassing the stock ledger.</p></div>
        <div className="action-cluster">
          <button className="ghost-button" type="button" onClick={() => exportSalesCsv(sales)} disabled={!sales}>Export sales</button>
          {canManagePricing && <button className="ghost-button" type="button" onClick={() => setDialog('price-list')}>New price list</button>}
          {canManageQuotes && <button className="primary-button" type="button" onClick={() => setDialog('quote')}>New quotation</button>}
        </div>
      </div>

      {commercial.loading && !sales ? <InlineLoading label="Loading quotations, orders and availability" /> : (
        <>
          <div className="metric-strip commercial-metrics">
            <article><span>Open quotations</span><strong>{sales?.metrics.openQuoteCount ?? 0}</strong><small>{formatMoney(sales?.metrics.openQuoteValueMinor ?? 0, currencyCode)} potential revenue</small></article>
            <article><span>Active orders</span><strong>{sales?.metrics.activeOrderCount ?? 0}</strong><small>{formatMoney(sales?.metrics.activeOrderValueMinor ?? 0, currencyCode)} committed value</small></article>
            <article><span>Reserved inventory</span><strong>{(sales?.metrics.reservedQuantityBase ?? 0).toLocaleString()}</strong><small>Base units committed to allocated orders</small></article>
            <article><span>Conversion control</span><strong>Atomic</strong><small>Order, lines and reservations commit together</small></article>
          </div>

          <div className="segmented-control" role="tablist" aria-label="Sales views">
            <Tab active={view === 'quotes'} onClick={() => setView('quotes')} label="Quotations" />
            <Tab active={view === 'orders'} onClick={() => setView('orders')} label="Sales orders" />
            <Tab active={view === 'pricing'} onClick={() => setView('pricing')} label="Price lists" />
            <Tab active={view === 'availability'} onClick={() => setView('availability')} label="Available to promise" />
          </div>

          <div className="filter-bar commercial-filter">
            <label className="search-field"><span className="sr-only">Search sales</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search quote, order, customer, SKU or warehouse" /></label>
            <span className="result-count">{view === 'quotes' ? quotes.length : view === 'orders' ? orders.length : view === 'pricing' ? priceLists.length : availability.length} records</span>
            <button className="ghost-button compact" type="button" onClick={() => void commercial.refresh()} disabled={commercial.refreshing}>{commercial.refreshing ? 'Refreshing…' : 'Refresh'}</button>
          </div>

          {view === 'quotes' && <QuotesView quotes={quotes} canManage={canManageQuotes} canConvert={canManageOrders && canReserve} onAction={setDialog} />}
          {view === 'orders' && <OrdersView orders={orders} reservations={sales?.reservations ?? []} canCancel={canManageOrders} onCancel={(order) => setDialog({ type: 'cancel', order })} />}
          {view === 'pricing' && <PricingView priceLists={priceLists} canManage={canManagePricing} onCreate={() => setDialog('price-list')} />}
          {view === 'availability' && <AvailabilityView availability={availability} />}
        </>
      )}

      {dialog && <SalesDialog action={dialog} onClose={() => setDialog(null)} />}
    </section>
  );
}

function QuotesView({ quotes, canManage, canConvert, onAction }: { quotes: QuoteSummary[]; canManage: boolean; canConvert: boolean; onAction: (action: SalesAction) => void }) {
  if (quotes.length === 0) return <EmptyState title="No quotations yet" detail="Create a quotation from a CRM account and live product variants. The Worker will recompute all totals." />;
  return <div className="quote-card-grid">{quotes.map((quote) => <article className="quote-card" key={quote.id}><header><div><span className="mono-copy">{quote.quoteNumber}</span><h3>{quote.accountName}</h3></div><span className={`commercial-status ${quote.status}`}>{quote.status}</span></header><div className="document-value"><strong>{formatMoney(quote.totalMinor, quote.currencyCode)}</strong><small>{quote.lines.length} line{quote.lines.length === 1 ? '' : 's'} · valid until {formatDate(quote.validUntil)}</small></div><dl><div><dt>Subtotal</dt><dd>{formatMoney(quote.subtotalMinor, quote.currencyCode)}</dd></div><div><dt>Discount</dt><dd>{formatMoney(quote.discountMinor, quote.currencyCode)}</dd></div><div><dt>Tax</dt><dd>{formatMoney(quote.taxMinor, quote.currencyCode)}</dd></div></dl><div className="line-pill-list">{quote.lines.slice(0, 4).map((line) => <span key={line.id}>{line.sku} · {line.quantityBase.toLocaleString()}</span>)}{quote.lines.length > 4 && <span>+{quote.lines.length - 4} more</span>}</div><footer><span>{quote.customerReference ?? 'No customer reference'}</span><div>{canManage && quote.status === 'draft' && <button className="ghost-button compact" type="button" onClick={() => onAction({ type: 'send', quote })}>Mark sent</button>}{canManage && quote.status === 'sent' && <button className="primary-button compact" type="button" onClick={() => onAction({ type: 'accept', quote })}>Accept</button>}{canConvert && quote.status === 'accepted' && <button className="primary-button compact" type="button" onClick={() => onAction({ type: 'convert', quote })}>Convert to order</button>}{quote.status === 'converted' && <span className="conversion-badge">Order created</span>}</div></footer></article>)}</div>;
}

function OrdersView({ orders, reservations, canCancel, onCancel }: { orders: SalesOrderSummary[]; reservations: NonNullable<ReturnType<typeof useCommercial>['sales']>['reservations']; canCancel: boolean; onCancel: (order: SalesOrderSummary) => void }) {
  if (orders.length === 0) return <EmptyState title="No sales orders" detail="Accepted quotations become sales orders only after warehouse allocation succeeds." />;
  return <div className="data-panel"><div className="order-list">{orders.map((order) => { const activeReservations = reservations.filter((reservation) => reservation.orderId === order.id && reservation.status === 'active'); return <article key={order.id}><div><span className="mono-copy">{order.orderNumber}</span><strong>{order.accountName}</strong><small>{order.customerReference ?? 'No customer reference'}</small></div><div><strong>{formatMoney(order.totalMinor, order.currencyCode)}</strong><small>{order.lines.length} order line{order.lines.length === 1 ? '' : 's'}</small></div><div><strong>{activeReservations.reduce((sum, reservation) => sum + reservation.quantityBase, 0).toLocaleString()} units</strong><small>{activeReservations.length} active reservation{activeReservations.length === 1 ? '' : 's'}</small></div><div><strong>{order.requestedDeliveryDate ? formatDate(order.requestedDeliveryDate) : 'Not set'}</strong><small>Requested delivery</small></div><span className={`commercial-status ${order.status}`}>{order.status}</span>{canCancel && ['confirmed', 'allocated'].includes(order.status) ? <button className="ghost-button compact danger-text" type="button" onClick={() => onCancel(order)}>Cancel</button> : <span />}</article>; })}</div></div>;
}

function PricingView({ priceLists, canManage, onCreate }: { priceLists: NonNullable<ReturnType<typeof useCommercial>['sales']>['priceLists']; canManage: boolean; onCreate: () => void }) {
  if (priceLists.length === 0) return <EmptyState title="No price lists" detail="Create a price list with SKU quantity breaks, minor-unit prices and tax basis points." action={canManage ? <button className="primary-button" type="button" onClick={onCreate}>Create price list</button> : undefined} />;
  return <div className="price-list-grid">{priceLists.map((priceList) => <article className="price-list-card" key={priceList.id}><header><div><span className="mono-copy">{priceList.code}</span><h3>{priceList.name}</h3></div><span className={`member-state ${priceList.active ? 'active' : ''}`}>{priceList.active ? 'Active' : 'Inactive'}</span></header><p>{priceList.currencyCode} · {priceList.validFrom ? `from ${formatDate(priceList.validFrom)}` : 'no start date'} · {priceList.validUntil ? `until ${formatDate(priceList.validUntil)}` : 'open ended'}</p><div className="pricing-lines">{priceList.items.slice(0, 8).map((item) => <div key={item.id}><span><strong>{item.sku}</strong><small>From {item.minimumQuantityBase.toLocaleString()} units</small></span><strong>{formatMoney(item.unitPriceMinor, priceList.currencyCode)}</strong></div>)}</div>{priceList.items.length > 8 && <small>+{priceList.items.length - 8} additional price breaks</small>}</article>)}</div>;
}

function AvailabilityView({ availability }: { availability: NonNullable<ReturnType<typeof useCommercial>['sales']>['availability'] }) {
  if (availability.length === 0) return <EmptyState title="No warehouse availability" detail="Available-to-promise appears after sellable inventory exists in active warehouses." />;
  return <div className="data-panel"><div className="table-scroll"><table className="data-table"><thead><tr><th>SKU</th><th>Warehouse</th><th className="numeric">On hand available</th><th className="numeric">Reserved</th><th className="numeric">Available to promise</th><th>Commitment</th></tr></thead><tbody>{availability.map((item) => { const commitment = item.onHandAvailableBase === 0 ? 0 : Math.round((item.reservedBase / item.onHandAvailableBase) * 100); return <tr key={`${item.variantId}:${item.warehouseId}`}><td><strong>{item.sku}</strong><small className="mono-copy">{item.variantId}</small></td><td><strong>{item.warehouseCode}</strong><small>Allocation warehouse</small></td><td className="numeric"><strong>{item.onHandAvailableBase.toLocaleString()}</strong></td><td className="numeric"><strong>{item.reservedBase.toLocaleString()}</strong></td><td className="numeric"><strong className={item.availableToPromiseBase === 0 ? 'negative-number' : 'positive-number'}>{item.availableToPromiseBase.toLocaleString()}</strong></td><td><div className="commitment-meter"><i style={{ width: `${Math.min(100, commitment)}%` }} /></div><small>{commitment}% committed</small></td></tr>; })}</tbody></table></div></div>;
}

function Tab({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) { return <button className={active ? 'active' : ''} type="button" role="tab" aria-selected={active} onClick={onClick}>{label}</button>; }

function exportSalesCsv(sales: ReturnType<typeof useCommercial>['sales']) {
  if (!sales) return;
  const rows = [
    ['Document type', 'Number', 'Account/SKU', 'Status/Warehouse', 'Value/on hand', 'Reserved/ATP'],
    ...sales.quotes.map((item) => ['Quotation', item.quoteNumber, item.accountName, item.status, String(item.totalMinor), '']),
    ...sales.orders.map((item) => ['Sales order', item.orderNumber, item.accountName, item.status, String(item.totalMinor), String(item.lines.reduce((sum, line) => sum + line.reservedQuantityBase, 0))]),
    ...sales.availability.map((item) => ['Availability', '', item.sku, item.warehouseCode, String(item.onHandAvailableBase), `${item.reservedBase}/${item.availableToPromiseBase}`])
  ];
  downloadCsv('sales-orders-and-availability.csv', rows);
}

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows.map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function formatMoney(valueMinor: number, currencyCode: string): string { return new Intl.NumberFormat(undefined, { style: 'currency', currency: currencyCode }).format(valueMinor / 100); }
function formatDate(value: string): string { return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(`${value}T00:00:00`)); }
