import { useMemo, useState } from 'react';

type InventoryRow = {
  id: string;
  sku: string;
  product: string;
  variant: string;
  warehouse: string;
  bin: string;
  lot: string;
  expiry: string | null;
  daysRemaining: number | null;
  status: 'available' | 'quarantine' | 'blocked';
  quantity: number;
  unit: string;
};

const inventoryRows: InventoryRow[] = [
  { id: 'bal-1', sku: 'MOJA-ARABICA-250', product: 'Moja Coffee', variant: 'Arabica Ground 250 g', warehouse: 'NL Central', bin: 'A-01-03', lot: 'MC-260603', expiry: '3 Jun 2027', daysRemaining: 317, status: 'available', quantity: 3120, unit: 'EA' },
  { id: 'bal-2', sku: 'BOTANICAL-330', product: 'Botanical Sparkling', variant: 'Ginger Lime 330 ml', warehouse: 'NL Central', bin: 'B-02-01', lot: 'BS-260514', expiry: '14 Aug 2026', daysRemaining: 24, status: 'available', quantity: 1840, unit: 'EA' },
  { id: 'bal-3', sku: 'BOTANICAL-330', product: 'Botanical Sparkling', variant: 'Ginger Lime 330 ml', warehouse: 'NL Central', bin: 'Q-01-01', lot: 'BS-260507', expiry: '7 Aug 2026', daysRemaining: 17, status: 'quarantine', quantity: 240, unit: 'EA' },
  { id: 'bal-4', sku: 'SOMEN-400', product: 'Tenobe Somen', variant: 'Premium Noodles 400 g', warehouse: 'Rotterdam Import', bin: 'C-03-04', lot: 'TS-JP-0426', expiry: '18 Dec 2026', daysRemaining: 150, status: 'available', quantity: 2280, unit: 'EA' },
  { id: 'bal-5', sku: 'COCONUT-1L', product: 'Island Coconut Water', variant: 'Pure Coconut 1 L', warehouse: 'Rotterdam Import', bin: 'D-01-02', lot: 'ICW-260401', expiry: '29 Jul 2026', daysRemaining: 8, status: 'blocked', quantity: 480, unit: 'EA' },
  { id: 'bal-6', sku: 'MOJA-BEANS-1K', product: 'Moja Coffee', variant: 'Arabica Beans 1 kg', warehouse: 'Bali Origin', bin: 'A-04-02', lot: 'MB-260701', expiry: '1 Jul 2027', daysRemaining: 345, status: 'available', quantity: 780, unit: 'EA' }
];

const movements = [
  { id: 'MOV-10428', type: 'Receive', reference: 'GRN-NL-24071', sku: 'BOTANICAL-330', quantity: '+1,200', location: 'NL Central · B-02-01', time: '16:42' },
  { id: 'MOV-10427', type: 'Transfer', reference: 'TRN-00982', sku: 'SOMEN-400', quantity: '-480', location: 'Rotterdam Import', time: '15:18' },
  { id: 'MOV-10426', type: 'Transfer', reference: 'TRN-00982', sku: 'SOMEN-400', quantity: '+480', location: 'NL Central', time: '15:18' },
  { id: 'MOV-10425', type: 'Quarantine', reference: 'QA-00631', sku: 'BOTANICAL-330', quantity: '240', location: 'NL Central · Q-01-01', time: '13:54' },
  { id: 'MOV-10424', type: 'Reversal', reference: 'REV-00112', sku: 'MOJA-ARABICA-250', quantity: '-24', location: 'NL Central · A-01-03', time: '11:07' }
];

const aging = [
  { label: 'Expired', value: 0, percentage: 0 },
  { label: '0–30 days', value: 720, percentage: 8 },
  { label: '31–60 days', value: 1840, percentage: 20 },
  { label: '61–90 days', value: 0, percentage: 0 },
  { label: '91–180 days', value: 2280, percentage: 25 },
  { label: '181+ days', value: 3900, percentage: 43 },
  { label: 'No expiry', value: 0, percentage: 0 }
];

export function InventoryWorkspace() {
  const [query, setQuery] = useState('');
  const [warehouse, setWarehouse] = useState('all');
  const [status, setStatus] = useState('all');
  const [activeView, setActiveView] = useState<'stock' | 'movements' | 'aging'>('stock');

  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return inventoryRows.filter((row) => {
      const matchesQuery = !normalizedQuery || [row.sku, row.product, row.variant, row.lot, row.bin]
        .some((value) => value.toLowerCase().includes(normalizedQuery));
      const matchesWarehouse = warehouse === 'all' || row.warehouse === warehouse;
      const matchesStatus = status === 'all' || row.status === status;
      return matchesQuery && matchesWarehouse && matchesStatus;
    });
  }, [query, status, warehouse]);

  const totalQuantity = inventoryRows.reduce((total, row) => total + row.quantity, 0);
  const atRisk = inventoryRows.filter((row) => row.daysRemaining !== null && row.daysRemaining <= 60)
    .reduce((total, row) => total + row.quantity, 0);
  const quarantined = inventoryRows.filter((row) => row.status === 'quarantine')
    .reduce((total, row) => total + row.quantity, 0);

  return (
    <section className="workspace-stack" aria-labelledby="inventory-title">
      <div className="workspace-heading">
        <div>
          <span className="eyebrow">Inventory & WMS</span>
          <h2 id="inventory-title">Stock control centre</h2>
          <p>Trace every unit through lots, bins, status changes and append-only ledger movements.</p>
        </div>
        <div className="action-cluster">
          <button className="ghost-button" type="button">Import catalog</button>
          <button className="ghost-button" type="button">Transfer stock</button>
          <button className="primary-button" type="button">Receive stock</button>
        </div>
      </div>

      <div className="metric-strip inventory-metrics">
        <article><span>On-hand stock</span><strong>{totalQuantity.toLocaleString()}</strong><small>Base units across 3 warehouses</small></article>
        <article><span>Near expiry</span><strong>{atRisk.toLocaleString()}</strong><small>Within 60 days · FEFO priority</small></article>
        <article><span>Quarantine</span><strong>{quarantined.toLocaleString()}</strong><small>Awaiting quality disposition</small></article>
        <article><span>Ledger integrity</span><strong>100%</strong><small>Balances reconcile to movements</small></article>
      </div>

      <div className="segmented-control" role="tablist" aria-label="Inventory views">
        {(['stock', 'movements', 'aging'] as const).map((view) => (
          <button
            className={activeView === view ? 'active' : ''}
            key={view}
            type="button"
            role="tab"
            aria-selected={activeView === view}
            onClick={() => setActiveView(view)}
          >
            {view === 'stock' ? 'Stock & lots' : view === 'movements' ? 'Movement ledger' : 'Aging & expiry'}
          </button>
        ))}
      </div>

      {activeView === 'stock' && (
        <>
          <div className="filter-bar">
            <label className="search-field">
              <span className="sr-only">Search stock</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search SKU, product, lot or bin" />
            </label>
            <label>
              <span>Warehouse</span>
              <select value={warehouse} onChange={(event) => setWarehouse(event.target.value)}>
                <option value="all">All warehouses</option>
                <option value="NL Central">NL Central</option>
                <option value="Rotterdam Import">Rotterdam Import</option>
                <option value="Bali Origin">Bali Origin</option>
              </select>
            </label>
            <label>
              <span>Status</span>
              <select value={status} onChange={(event) => setStatus(event.target.value)}>
                <option value="all">All statuses</option>
                <option value="available">Available</option>
                <option value="quarantine">Quarantine</option>
                <option value="blocked">Blocked</option>
              </select>
            </label>
            <span className="result-count">{filteredRows.length} stock positions</span>
          </div>

          <div className="data-panel">
            <div className="table-scroll">
              <table className="data-table">
                <thead><tr><th>Product / SKU</th><th>Warehouse & bin</th><th>Lot</th><th>Expiry</th><th>Status</th><th className="numeric">Quantity</th><th></th></tr></thead>
                <tbody>
                  {filteredRows.map((row) => (
                    <tr key={row.id}>
                      <td><strong>{row.product}</strong><small>{row.variant} · {row.sku}</small></td>
                      <td><strong>{row.warehouse}</strong><small>{row.bin}</small></td>
                      <td><span className="mono-tag">{row.lot}</span></td>
                      <td><strong>{row.expiry ?? 'No expiry'}</strong><small className={row.daysRemaining !== null && row.daysRemaining <= 30 ? 'risk-text' : ''}>{row.daysRemaining === null ? 'Not tracked' : `${row.daysRemaining} days remaining`}</small></td>
                      <td><span className={`stock-status ${row.status}`}>{row.status}</span></td>
                      <td className="numeric"><strong>{row.quantity.toLocaleString()}</strong><small>{row.unit}</small></td>
                      <td><button className="row-menu" type="button" aria-label={`Open actions for ${row.sku}`}>•••</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {activeView === 'movements' && (
        <div className="data-panel ledger-panel">
          <div className="panel-heading"><div><span className="eyebrow">Append-only journal</span><h3>Recent inventory movements</h3></div><button className="ghost-button compact" type="button">Export ledger</button></div>
          <div className="movement-list">
            {movements.map((movement) => (
              <article key={movement.id}>
                <span className={`movement-icon ${movement.type.toLowerCase()}`}>{movement.type.slice(0, 2).toUpperCase()}</span>
                <div><strong>{movement.type} · {movement.sku}</strong><small>{movement.id} · {movement.reference}</small></div>
                <div><strong>{movement.location}</strong><small>Today at {movement.time}</small></div>
                <strong className={movement.quantity.startsWith('-') ? 'negative-number' : 'positive-number'}>{movement.quantity}</strong>
              </article>
            ))}
          </div>
        </div>
      )}

      {activeView === 'aging' && (
        <div className="aging-layout">
          <article className="data-panel aging-chart">
            <div className="panel-heading"><div><span className="eyebrow">Configurable buckets</span><h3>Remaining shelf life</h3></div><button className="ghost-button compact" type="button">Edit buckets</button></div>
            <div className="aging-bars">
              {aging.map((bucket) => (
                <div className="aging-row" key={bucket.label}>
                  <span>{bucket.label}</span>
                  <div><i style={{ width: `${bucket.percentage}%` }} /></div>
                  <strong>{bucket.value.toLocaleString()}</strong>
                </div>
              ))}
            </div>
          </article>
          <article className="expiry-callout">
            <span className="eyebrow">FEFO recommendation</span>
            <h3>Pick Botanical Sparkling first</h3>
            <p>Lot <strong>BS-260507</strong> expires in 17 days. Allocate it before later lots once quality releases the quarantined stock.</p>
            <dl>
              <div><dt>At risk</dt><dd>240 EA</dd></div>
              <div><dt>Next available lot</dt><dd>BS-260514</dd></div>
              <div><dt>Potential write-off</dt><dd>€312</dd></div>
            </dl>
            <button className="primary-button" type="button">Open FEFO planner</button>
          </article>
        </div>
      )}
    </section>
  );
}
