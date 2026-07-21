import type {
  CreatePartyRequest,
  CreateProductRequest,
  CreateWarehouseRequest,
  PartyType
} from '@fmcgbyalex/contracts/inventory';
import { useState, type FormEvent } from 'react';
import { useApplication } from '../../state/ApplicationProvider';
import { Modal } from '../Modal';

export type MasterDataAction = 'product' | 'warehouse' | 'party';

type VariantDraft = {
  id: string;
  sku: string;
  name: string;
  barcode: string;
  packQuantityBase: string;
  caseQuantityBase: string;
};

export function MasterDataDialog({ action, onClose }: { action: MasterDataAction; onClose: () => void }) {
  if (action === 'product') return <ProductDialog onClose={onClose} />;
  if (action === 'warehouse') return <WarehouseDialog onClose={onClose} />;
  return <PartyDialog onClose={onClose} />;
}

function ProductDialog({ onClose }: { onClose: () => void }) {
  const application = useApplication();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [category, setCategory] = useState('');
  const [baseUnitCode, setBaseUnitCode] = useState('EA');
  const [baseUnitName, setBaseUnitName] = useState('Each');
  const [shelfLifeDays, setShelfLifeDays] = useState('');
  const [variants, setVariants] = useState<VariantDraft[]>([newVariantDraft()]);

  function updateVariant(id: string, field: keyof Omit<VariantDraft, 'id'>, value: string) {
    setVariants((current) => current.map((variant) => variant.id === id ? { ...variant, [field]: value } : variant));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input: CreateProductRequest = {
      code: code.trim().toUpperCase(),
      name: name.trim(),
      brand: brand.trim(),
      category: category.trim(),
      baseUnitCode: baseUnitCode.trim().toUpperCase(),
      baseUnitName: baseUnitName.trim(),
      variants: variants.map((variant) => ({
        sku: variant.sku.trim().toUpperCase(),
        name: variant.name.trim(),
        packQuantityBase: parsePositiveInteger(variant.packQuantityBase, 'Pack quantity'),
        ...(variant.barcode.trim() ? { barcode: variant.barcode.trim() } : {}),
        ...(variant.caseQuantityBase.trim()
          ? { caseQuantityBase: parsePositiveInteger(variant.caseQuantityBase, 'Case quantity') }
          : {})
      })),
      ...(shelfLifeDays.trim()
        ? { shelfLifeDays: parseNonNegativeInteger(shelfLifeDays, 'Shelf life') }
        : {})
    };
    try {
      await application.createProduct(input);
      onClose();
    } catch {
      // Structured errors are rendered by the global notice.
    }
  }

  return (
    <Modal
      eyebrow="Master data · Product"
      title="Create product and sellable SKUs"
      description="The product, brand, category, unit and variants are committed together with tenant-scoped idempotency."
      onClose={onClose}
      width="wide"
    >
      <form className="operational-form" onSubmit={(event) => void submit(event)}>
        <div className="form-grid two-column">
          <label><span>Product code</span><input required maxLength={48} value={code} onChange={(event) => setCode(event.target.value)} placeholder="BOTANICAL" /></label>
          <label><span>Product name</span><input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="Botanical Sparkling" /></label>
          <label><span>Brand</span><input required maxLength={120} value={brand} onChange={(event) => setBrand(event.target.value)} placeholder="House Brand" /></label>
          <label><span>Category</span><input required maxLength={120} value={category} onChange={(event) => setCategory(event.target.value)} placeholder="Beverages" /></label>
          <label><span>Base unit code</span><input required maxLength={12} value={baseUnitCode} onChange={(event) => setBaseUnitCode(event.target.value)} /></label>
          <label><span>Base unit name</span><input required maxLength={60} value={baseUnitName} onChange={(event) => setBaseUnitName(event.target.value)} /></label>
          <label><span>Shelf life in days</span><input min={0} step={1} type="number" value={shelfLifeDays} onChange={(event) => setShelfLifeDays(event.target.value)} placeholder="120" /></label>
        </div>

        <div className="form-section-heading">
          <div><span className="eyebrow">Sellable variants</span><h3>SKUs and pack structure</h3></div>
          <button className="ghost-button compact" type="button" onClick={() => setVariants((current) => [...current, newVariantDraft()])}>Add SKU</button>
        </div>
        <div className="variant-editor-list">
          {variants.map((variant, index) => (
            <fieldset key={variant.id}>
              <legend>SKU {index + 1}</legend>
              <div className="form-grid three-column">
                <label><span>SKU</span><input required value={variant.sku} onChange={(event) => updateVariant(variant.id, 'sku', event.target.value)} /></label>
                <label><span>Variant name</span><input required value={variant.name} onChange={(event) => updateVariant(variant.id, 'name', event.target.value)} /></label>
                <label><span>Barcode / GTIN</span><input value={variant.barcode} onChange={(event) => updateVariant(variant.id, 'barcode', event.target.value)} /></label>
                <label><span>Units per sellable pack</span><input required type="number" min={1} step={1} value={variant.packQuantityBase} onChange={(event) => updateVariant(variant.id, 'packQuantityBase', event.target.value)} /></label>
                <label><span>Units per case</span><input type="number" min={1} step={1} value={variant.caseQuantityBase} onChange={(event) => updateVariant(variant.id, 'caseQuantityBase', event.target.value)} /></label>
                <div className="form-inline-action">
                  <button className="text-button danger" type="button" disabled={variants.length === 1} onClick={() => setVariants((current) => current.filter((item) => item.id !== variant.id))}>Remove SKU</button>
                </div>
              </div>
            </fieldset>
          ))}
        </div>
        <FormActions busy={application.busyAction} onCancel={onClose} submitLabel="Create product" />
      </form>
    </Modal>
  );
}

function WarehouseDialog({ onClose }: { onClose: () => void }) {
  const application = useApplication();
  const [legalEntityCode, setLegalEntityCode] = useState('NL-BV');
  const [legalEntityName, setLegalEntityName] = useState('FMCG by Alex Netherlands B.V.');
  const [siteCode, setSiteCode] = useState('EMMEN');
  const [siteName, setSiteName] = useState('Emmen Distribution Campus');
  const [warehouseCode, setWarehouseCode] = useState('');
  const [warehouseName, setWarehouseName] = useState('');
  const [timezone, setTimezone] = useState('Europe/Amsterdam');
  const [defaultZoneCode, setDefaultZoneCode] = useState('GENERAL');
  const [defaultBinCode, setDefaultBinCode] = useState('DEFAULT');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input: CreateWarehouseRequest = {
      legalEntityCode: legalEntityCode.trim().toUpperCase(),
      legalEntityName: legalEntityName.trim(),
      siteCode: siteCode.trim().toUpperCase(),
      siteName: siteName.trim(),
      warehouseCode: warehouseCode.trim().toUpperCase(),
      warehouseName: warehouseName.trim(),
      timezone: timezone.trim(),
      ...(defaultZoneCode.trim() ? { defaultZoneCode: defaultZoneCode.trim().toUpperCase() } : {}),
      ...(defaultBinCode.trim() ? { defaultBinCode: defaultBinCode.trim().toUpperCase() } : {})
    };
    try {
      await application.createWarehouse(input);
      onClose();
    } catch {
      // Structured errors are rendered by the global notice.
    }
  }

  return (
    <Modal eyebrow="Master data · Location" title="Create operating warehouse" description="Creates the legal entity, site, warehouse and default storage hierarchy where required." onClose={onClose}>
      <form className="operational-form" onSubmit={(event) => void submit(event)}>
        <div className="form-grid two-column">
          <label><span>Legal entity code</span><input required value={legalEntityCode} onChange={(event) => setLegalEntityCode(event.target.value)} /></label>
          <label><span>Legal entity name</span><input required value={legalEntityName} onChange={(event) => setLegalEntityName(event.target.value)} /></label>
          <label><span>Site code</span><input required value={siteCode} onChange={(event) => setSiteCode(event.target.value)} /></label>
          <label><span>Site name</span><input required value={siteName} onChange={(event) => setSiteName(event.target.value)} /></label>
          <label><span>Warehouse code</span><input required value={warehouseCode} onChange={(event) => setWarehouseCode(event.target.value)} placeholder="NL-CENTRAL" /></label>
          <label><span>Warehouse name</span><input required value={warehouseName} onChange={(event) => setWarehouseName(event.target.value)} placeholder="NL Central Warehouse" /></label>
          <label><span>Timezone</span><input required value={timezone} onChange={(event) => setTimezone(event.target.value)} /></label>
          <label><span>Default zone</span><input value={defaultZoneCode} onChange={(event) => setDefaultZoneCode(event.target.value)} /></label>
          <label><span>Default bin</span><input value={defaultBinCode} onChange={(event) => setDefaultBinCode(event.target.value)} /></label>
        </div>
        <FormActions busy={application.busyAction} onCancel={onClose} submitLabel="Create warehouse" />
      </form>
    </Modal>
  );
}

function PartyDialog({ onClose }: { onClose: () => void }) {
  const application = useApplication();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState<PartyType>('supplier');
  const [countryCode, setCountryCode] = useState('NL');
  const [taxId, setTaxId] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input: CreatePartyRequest = {
      code: code.trim().toUpperCase(),
      name: name.trim(),
      type,
      countryCode: countryCode.trim().toUpperCase(),
      ...(taxId.trim() ? { taxId: taxId.trim() } : {}),
      ...(email.trim() ? { email: email.trim().toLowerCase() } : {}),
      ...(phone.trim() ? { phone: phone.trim() } : {})
    };
    try {
      await application.createParty(input);
      onClose();
    } catch {
      // Structured errors are rendered by the global notice.
    }
  }

  return (
    <Modal eyebrow="Master data · Party" title="Create supplier or channel partner" description="Parties can participate in receiving, sales, distribution and retail workflows without duplicating records." onClose={onClose}>
      <form className="operational-form" onSubmit={(event) => void submit(event)}>
        <div className="form-grid two-column">
          <label><span>Party code</span><input required value={code} onChange={(event) => setCode(event.target.value)} placeholder="SUP-JP-001" /></label>
          <label><span>Display name</span><input required value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label><span>Party type</span><select value={type} onChange={(event) => setType(event.target.value as PartyType)}><option value="supplier">Supplier</option><option value="customer">Customer</option><option value="distributor">Distributor</option><option value="retailer">Retailer</option></select></label>
          <label><span>Country code</span><input required minLength={2} maxLength={2} value={countryCode} onChange={(event) => setCountryCode(event.target.value)} /></label>
          <label><span>Tax ID</span><input value={taxId} onChange={(event) => setTaxId(event.target.value)} /></label>
          <label><span>Email</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label><span>Phone</span><input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
        </div>
        <FormActions busy={application.busyAction} onCancel={onClose} submitLabel="Create party" />
      </form>
    </Modal>
  );
}

function FormActions({ busy, onCancel, submitLabel }: { busy: string | null; onCancel: () => void; submitLabel: string }) {
  return (
    <div className="form-actions">
      <button className="ghost-button" type="button" onClick={onCancel}>Cancel</button>
      <button className="primary-button" type="submit" disabled={busy !== null}>{busy ?? submitLabel}</button>
    </div>
  );
}

function newVariantDraft(): VariantDraft {
  return {
    id: crypto.randomUUID(),
    sku: '',
    name: '',
    barcode: '',
    packQuantityBase: '1',
    caseQuantityBase: ''
  };
}

function parsePositiveInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${label} must be a positive whole number.`);
  return parsed;
}

function parseNonNegativeInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${label} must be a non-negative whole number.`);
  return parsed;
}
