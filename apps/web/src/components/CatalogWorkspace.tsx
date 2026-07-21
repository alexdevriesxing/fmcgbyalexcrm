import { useMemo, useState } from 'react';

type CatalogView = 'products' | 'locations' | 'parties';

const products = [
  { id: 'prd-1', code: 'MOJA-COFFEE', name: 'Moja Coffee', brand: 'Moja', category: 'Coffee', variants: 3, baseUnit: 'EA', shelfLife: '365 days', status: 'Active' },
  { id: 'prd-2', code: 'BOTANICAL', name: 'Botanical Sparkling', brand: 'House Brand', category: 'Beverages', variants: 4, baseUnit: 'EA', shelfLife: '120 days', status: 'Active' },
  { id: 'prd-3', code: 'TENOBE-SOMEN', name: 'Tenobe Somen', brand: 'JIP Japan', category: 'Dry Grocery', variants: 2, baseUnit: 'EA', shelfLife: '730 days', status: 'Active' },
  { id: 'prd-4', code: 'COCONUT-WATER', name: 'Island Coconut Water', brand: 'Island', category: 'Beverages', variants: 2, baseUnit: 'EA', shelfLife: '180 days', status: 'Active' }
];

const warehouses = [
  { id: 'wh-1', code: 'NL-CENTRAL', name: 'NL Central Warehouse', site: 'Emmen Distribution Campus', entity: 'FMCG by Alex Netherlands B.V.', timezone: 'Europe/Amsterdam', bins: 64, status: 'Active' },
  { id: 'wh-2', code: 'RTM-IMPORT', name: 'Rotterdam Import Warehouse', site: 'Rotterdam Port Logistics', entity: 'FMCG by Alex Netherlands B.V.', timezone: 'Europe/Amsterdam', bins: 42, status: 'Active' },
  { id: 'wh-3', code: 'BALI-ORIGIN', name: 'Bali Origin Warehouse', site: 'Pupuan Coffee Hub', entity: 'FMCG by Alex Indonesia', timezone: 'Asia/Makassar', bins: 28, status: 'Active' }
];

const parties = [
  { id: 'pty-1', code: 'SUP-JP-001', name: 'Japanese Noodle Manufacturer', type: 'Supplier', country: 'Japan', contact: 'export@example.jp', status: 'Active' },
  { id: 'pty-2', code: 'SUP-ID-014', name: 'Bali Coffee Cooperative', type: 'Supplier', country: 'Indonesia', contact: 'trade@example.id', status: 'Active' },
  { id: 'pty-3', code: 'DIST-NL-032', name: 'Benelux Food Distribution', type: 'Distributor', country: 'Netherlands', contact: 'buying@example.nl', status: 'Active' },
  { id: 'pty-4', code: 'RET-DE-108', name: 'Nordmarkt Retail Group', type: 'Retailer', country: 'Germany', contact: 'category@example.de', status: 'Active' }
];

export function CatalogWorkspace() {
  const [view, setView] = useState<CatalogView>('products');
  const [query, setQuery] = useState('');

  const normalizedQuery = query.trim().toLowerCase();
  const filteredProducts = useMemo(
    () => products.filter((product) => !normalizedQuery || [product.code, product.name, product.brand, product.category].some((value) => value.toLowerCase().includes(normalizedQuery))),
    [normalizedQuery]
  );
  const filteredWarehouses = useMemo(
    () => warehouses.filter((warehouse) => !normalizedQuery || [warehouse.code, warehouse.name, warehouse.site, warehouse.entity].some((value) => value.toLowerCase().includes(normalizedQuery))),
    [normalizedQuery]
  );
  const filteredParties = useMemo(
    () => parties.filter((party) => !normalizedQuery || [party.code, party.name, party.type, party.country].some((value) => value.toLowerCase().includes(normalizedQuery))),
    [normalizedQuery]
  );

  return (
    <section className="workspace-stack" aria-labelledby="catalog-title">
      <div className="workspace-heading">
        <div>
          <span className="eyebrow">Master data</span>
          <h2 id="catalog-title">Business foundation</h2>
          <p>Govern products, packs, parties and operating locations from one tenant-scoped source of truth.</p>
        </div>
        <div className="action-cluster">
          <button className="ghost-button" type="button">Import CSV</button>
          <button className="ghost-button" type="button">Export</button>
          <button className="primary-button" type="button">
            {view === 'products' ? 'New product' : view === 'locations' ? 'New warehouse' : 'New party'}
          </button>
        </div>
      </div>

      <div className="metric-strip catalog-metrics">
        <article><span>Products</span><strong>4</strong><small>11 active SKUs</small></article>
        <article><span>Warehouses</span><strong>3</strong><small>134 configured bins</small></article>
        <article><span>Business parties</span><strong>4</strong><small>2 suppliers · 2 channel partners</small></article>
        <article><span>Data quality</span><strong>98.7%</strong><small>3 fields need enrichment</small></article>
      </div>

      <div className="segmented-control" role="tablist" aria-label="Master data views">
        <button className={view === 'products' ? 'active' : ''} type="button" role="tab" aria-selected={view === 'products'} onClick={() => setView('products')}>Products & SKUs</button>
        <button className={view === 'locations' ? 'active' : ''} type="button" role="tab" aria-selected={view === 'locations'} onClick={() => setView('locations')}>Locations</button>
        <button className={view === 'parties' ? 'active' : ''} type="button" role="tab" aria-selected={view === 'parties'} onClick={() => setView('parties')}>Parties</button>
      </div>

      <div className="filter-bar catalog-filter">
        <label className="search-field">
          <span className="sr-only">Search master data</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={view === 'products' ? 'Search product, brand, SKU or category' : view === 'locations' ? 'Search warehouse, site or entity' : 'Search party, type or country'}
          />
        </label>
        <span className="result-count">
          {view === 'products' ? filteredProducts.length : view === 'locations' ? filteredWarehouses.length : filteredParties.length} records
        </span>
      </div>

      <div className="data-panel">
        <div className="table-scroll">
          {view === 'products' && (
            <table className="data-table">
              <thead><tr><th>Product</th><th>Brand & category</th><th>Variants</th><th>Base unit</th><th>Shelf life</th><th>Status</th><th></th></tr></thead>
              <tbody>{filteredProducts.map((product) => (
                <tr key={product.id}>
                  <td><strong>{product.name}</strong><small className="mono-copy">{product.code}</small></td>
                  <td><strong>{product.brand}</strong><small>{product.category}</small></td>
                  <td><strong>{product.variants}</strong><small>sellable SKUs</small></td>
                  <td><span className="mono-tag">{product.baseUnit}</span></td>
                  <td><strong>{product.shelfLife}</strong><small>default policy</small></td>
                  <td><span className="member-state">{product.status}</span></td>
                  <td><button className="row-menu" type="button" aria-label={`Manage ${product.name}`}>•••</button></td>
                </tr>
              ))}</tbody>
            </table>
          )}

          {view === 'locations' && (
            <table className="data-table">
              <thead><tr><th>Warehouse</th><th>Site</th><th>Legal entity</th><th>Timezone</th><th>Bins</th><th>Status</th><th></th></tr></thead>
              <tbody>{filteredWarehouses.map((warehouse) => (
                <tr key={warehouse.id}>
                  <td><strong>{warehouse.name}</strong><small className="mono-copy">{warehouse.code}</small></td>
                  <td><strong>{warehouse.site}</strong><small>Operating site</small></td>
                  <td><strong>{warehouse.entity}</strong><small>Owning entity</small></td>
                  <td><span className="mono-tag">{warehouse.timezone}</span></td>
                  <td><strong>{warehouse.bins}</strong><small>active bins</small></td>
                  <td><span className="member-state">{warehouse.status}</span></td>
                  <td><button className="row-menu" type="button" aria-label={`Manage ${warehouse.name}`}>•••</button></td>
                </tr>
              ))}</tbody>
            </table>
          )}

          {view === 'parties' && (
            <table className="data-table">
              <thead><tr><th>Party</th><th>Type</th><th>Country</th><th>Primary contact</th><th>Status</th><th></th></tr></thead>
              <tbody>{filteredParties.map((party) => (
                <tr key={party.id}>
                  <td><strong>{party.name}</strong><small className="mono-copy">{party.code}</small></td>
                  <td><span className="role-badge">{party.type}</span></td>
                  <td><strong>{party.country}</strong><small>Registered market</small></td>
                  <td><strong>{party.contact}</strong><small>Commercial contact</small></td>
                  <td><span className="member-state">{party.status}</span></td>
                  <td><button className="row-menu" type="button" aria-label={`Manage ${party.name}`}>•••</button></td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
      </div>

      <div className="data-quality-panel">
        <div>
          <span className="eyebrow">Data stewardship</span>
          <h3>Three catalog improvements are recommended</h3>
          <p>Add GTINs to two imported SKUs and assign a tax classification to one retailer assortment.</p>
        </div>
        <button className="ghost-button" type="button">Open quality queue</button>
      </div>
    </section>
  );
}
