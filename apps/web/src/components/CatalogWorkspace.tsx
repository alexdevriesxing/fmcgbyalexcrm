import { useEffect, useMemo, useState } from 'react';
import { useApplication } from '../state/ApplicationProvider';
import { EmptyState } from './Modal';
import { MasterDataDialog, type MasterDataAction } from './forms/MasterDataDialog';

type CatalogView = 'products' | 'locations' | 'parties';

export function CatalogWorkspace({
  requestedAction,
  onActionConsumed
}: {
  requestedAction: MasterDataAction | null;
  onActionConsumed: () => void;
}) {
  const application = useApplication();
  const [view, setView] = useState<CatalogView>('products');
  const [query, setQuery] = useState('');
  const [dialog, setDialog] = useState<MasterDataAction | null>(null);
  const products = application.data.products;
  const warehouses = application.data.warehouses;
  const parties = application.data.parties;

  useEffect(() => {
    if (!requestedAction) return;
    setDialog(requestedAction);
    setView(requestedAction === 'product' ? 'products' : requestedAction === 'warehouse' ? 'locations' : 'parties');
    onActionConsumed();
  }, [onActionConsumed, requestedAction]);

  const normalizedQuery = query.trim().toLowerCase();
  const filteredProducts = useMemo(
    () => products.filter((product) => !normalizedQuery || [product.code, product.name, product.brand, product.category, ...product.variants.flatMap((variant) => [variant.sku, variant.name, variant.barcode ?? ''])].some((value) => value.toLowerCase().includes(normalizedQuery))),
    [normalizedQuery, products]
  );
  const filteredWarehouses = useMemo(
    () => warehouses.filter((warehouse) => !normalizedQuery || [warehouse.code, warehouse.name, warehouse.siteCode, warehouse.siteName, warehouse.legalEntityCode, warehouse.timezone].some((value) => value.toLowerCase().includes(normalizedQuery))),
    [normalizedQuery, warehouses]
  );
  const filteredParties = useMemo(
    () => parties.filter((party) => !normalizedQuery || [party.code, party.name, party.type, party.countryCode, party.email ?? '', party.taxId ?? ''].some((value) => value.toLowerCase().includes(normalizedQuery))),
    [normalizedQuery, parties]
  );

  const skuCount = products.reduce((total, product) => total + product.variants.length, 0);
  const supplierCount = parties.filter((party) => party.type === 'supplier').length;
  const channelCount = parties.filter((party) => party.type === 'distributor' || party.type === 'retailer').length;
  const missingBarcodes = products.flatMap((product) => product.variants).filter((variant) => !variant.barcode).length;
  const incompleteParties = parties.filter((party) => !party.email || !party.taxId).length;
  const canManageCatalog = application.hasPermission('master-data.catalog.manage');
  const canManageLocations = application.hasPermission('master-data.locations.manage');
  const canManageParties = application.hasPermission('master-data.parties.manage');
  const canCreate = view === 'products' ? canManageCatalog : view === 'locations' ? canManageLocations : canManageParties;

  function openCreateDialog() {
    setDialog(view === 'products' ? 'product' : view === 'locations' ? 'warehouse' : 'party');
  }

  function exportCurrentView() {
    const rows: Array<Array<string | number | boolean | null>> = view === 'products'
      ? filteredProducts.map((product) => [product.code, product.name, product.brand, product.category, product.baseUnitCode, product.shelfLifeDays, product.variants.length, product.active])
      : view === 'locations'
        ? filteredWarehouses.map((warehouse) => [warehouse.code, warehouse.name, warehouse.siteCode, warehouse.siteName, warehouse.legalEntityCode, warehouse.timezone, warehouse.defaultBinId, warehouse.active])
        : filteredParties.map((party) => [party.code, party.name, party.type, party.countryCode, party.taxId, party.email, party.phone, party.active]);
    const headers = view === 'products'
      ? ['code', 'name', 'brand', 'category', 'base_unit', 'shelf_life_days', 'variant_count', 'active']
      : view === 'locations'
        ? ['code', 'name', 'site_code', 'site_name', 'legal_entity_code', 'timezone', 'default_bin_id', 'active']
        : ['code', 'name', 'type', 'country_code', 'tax_id', 'email', 'phone', 'active'];
    downloadCsv(`fmcg-${view}-${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
  }

  return (
    <section className="workspace-stack" aria-labelledby="catalog-title">
      <div className="workspace-heading">
        <div>
          <span className="eyebrow">Master data</span>
          <h2 id="catalog-title">Business foundation</h2>
          <p>Live tenant-scoped products, packs, parties and operating locations with idempotent creation workflows.</p>
        </div>
        <div className="action-cluster">
          <button className="ghost-button" type="button" onClick={exportCurrentView} disabled={(view === 'products' ? filteredProducts : view === 'locations' ? filteredWarehouses : filteredParties).length === 0}>Export CSV</button>
          <button className="primary-button" type="button" onClick={openCreateDialog} disabled={!canCreate} title={!canCreate ? 'Your role does not have manage permission for this data.' : undefined}>
            {view === 'products' ? 'New product' : view === 'locations' ? 'New warehouse' : 'New party'}
          </button>
        </div>
      </div>

      <div className="metric-strip catalog-metrics">
        <article><span>Products</span><strong>{products.length.toLocaleString()}</strong><small>{skuCount.toLocaleString()} active and inactive SKUs</small></article>
        <article><span>Warehouses</span><strong>{warehouses.length.toLocaleString()}</strong><small>{new Set(warehouses.map((warehouse) => warehouse.siteCode)).size} operating sites</small></article>
        <article><span>Business parties</span><strong>{parties.length.toLocaleString()}</strong><small>{supplierCount} suppliers · {channelCount} channel partners</small></article>
        <article><span>Data gaps</span><strong>{(missingBarcodes + incompleteParties).toLocaleString()}</strong><small>{missingBarcodes} missing barcodes · {incompleteParties} incomplete parties</small></article>
      </div>

      <div className="segmented-control" role="tablist" aria-label="Master data views">
        <button className={view === 'products' ? 'active' : ''} type="button" role="tab" aria-selected={view === 'products'} onClick={() => setView('products')}>Products & SKUs</button>
        <button className={view === 'locations' ? 'active' : ''} type="button" role="tab" aria-selected={view === 'locations'} onClick={() => setView('locations')}>Locations</button>
        <button className={view === 'parties' ? 'active' : ''} type="button" role="tab" aria-selected={view === 'parties'} onClick={() => setView('parties')}>Parties</button>
      </div>

      <div className="filter-bar catalog-filter">
        <label className="search-field">
          <span className="sr-only">Search master data</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={view === 'products' ? 'Search product, brand, SKU or barcode' : view === 'locations' ? 'Search warehouse, site or entity' : 'Search party, type, country or contact'} />
        </label>
        <span className="result-count">{view === 'products' ? filteredProducts.length : view === 'locations' ? filteredWarehouses.length : filteredParties.length} records</span>
      </div>

      <div className="data-panel">
        <div className="table-scroll">
          {view === 'products' && (filteredProducts.length === 0 ? (
            <EmptyState title={products.length === 0 ? 'No products yet' : 'No matching products'} detail={products.length === 0 ? 'Create the first product and SKU to unlock receiving and FEFO workflows.' : 'Change the search text to see other tenant catalog records.'} action={canManageCatalog && products.length === 0 ? <button className="primary-button" type="button" onClick={() => setDialog('product')}>Create first product</button> : undefined} />
          ) : (
            <table className="data-table">
              <thead><tr><th>Product</th><th>Brand & category</th><th>Variants</th><th>Base unit</th><th>Shelf life</th><th>Status</th></tr></thead>
              <tbody>{filteredProducts.map((product) => <tr key={product.id}><td><strong>{product.name}</strong><small className="mono-copy">{product.code}</small></td><td><strong>{product.brand}</strong><small>{product.category}</small></td><td><strong>{product.variants.length}</strong><small>{product.variants.map((variant) => variant.sku).join(' · ') || 'No variants'}</small></td><td><span className="mono-tag">{product.baseUnitCode}</span></td><td><strong>{product.shelfLifeDays === null ? 'Not set' : `${product.shelfLifeDays} days`}</strong><small>Tenant catalog policy</small></td><td><span className={`member-state ${product.active ? '' : 'suspended'}`}>{product.active ? 'Active' : 'Inactive'}</span></td></tr>)}</tbody>
            </table>
          ))}

          {view === 'locations' && (filteredWarehouses.length === 0 ? (
            <EmptyState title={warehouses.length === 0 ? 'No warehouses yet' : 'No matching locations'} detail={warehouses.length === 0 ? 'Create a warehouse with its legal entity, site, default zone and bin.' : 'Change the search text to see other locations.'} action={canManageLocations && warehouses.length === 0 ? <button className="primary-button" type="button" onClick={() => setDialog('warehouse')}>Create first warehouse</button> : undefined} />
          ) : (
            <table className="data-table"><thead><tr><th>Warehouse</th><th>Site</th><th>Legal entity</th><th>Timezone</th><th>Default storage</th><th>Status</th></tr></thead><tbody>{filteredWarehouses.map((warehouse) => <tr key={warehouse.id}><td><strong>{warehouse.name}</strong><small className="mono-copy">{warehouse.code}</small></td><td><strong>{warehouse.siteName}</strong><small>{warehouse.siteCode}</small></td><td><strong>{warehouse.legalEntityCode}</strong><small>Owning entity</small></td><td><span className="mono-tag">{warehouse.timezone}</span></td><td><strong>{warehouse.defaultZoneId}</strong><small>{warehouse.defaultBinId}</small></td><td><span className={`member-state ${warehouse.active ? '' : 'suspended'}`}>{warehouse.active ? 'Active' : 'Inactive'}</span></td></tr>)}</tbody></table>
          ))}

          {view === 'parties' && (filteredParties.length === 0 ? (
            <EmptyState title={parties.length === 0 ? 'No business parties yet' : 'No matching parties'} detail={parties.length === 0 ? 'Create suppliers, customers, distributors or retailers for operational use.' : 'Change the search text to see other parties.'} action={canManageParties && parties.length === 0 ? <button className="primary-button" type="button" onClick={() => setDialog('party')}>Create first party</button> : undefined} />
          ) : (
            <table className="data-table"><thead><tr><th>Party</th><th>Type</th><th>Country</th><th>Commercial details</th><th>Tax ID</th><th>Status</th></tr></thead><tbody>{filteredParties.map((party) => <tr key={party.id}><td><strong>{party.name}</strong><small className="mono-copy">{party.code}</small></td><td><span className="role-badge">{capitalize(party.type)}</span></td><td><strong>{party.countryCode}</strong><small>Registered market</small></td><td><strong>{party.email ?? 'No email'}</strong><small>{party.phone ?? 'No phone'}</small></td><td><span className="mono-tag">{party.taxId ?? 'Not set'}</span></td><td><span className={`member-state ${party.active ? '' : 'suspended'}`}>{party.active ? 'Active' : 'Inactive'}</span></td></tr>)}</tbody></table>
          ))}
        </div>
      </div>

      {(missingBarcodes > 0 || incompleteParties > 0) && <div className="data-quality-panel"><div><span className="eyebrow">Data stewardship</span><h3>{missingBarcodes + incompleteParties} master-data improvements are recommended</h3><p>Add missing GTINs, commercial contacts and tax identifiers before downstream order and compliance workflows depend on them.</p></div><span className="quality-score">Live quality check</span></div>}

      {dialog && <MasterDataDialog action={dialog} onClose={() => setDialog(null)} />}
    </section>
  );
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
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
