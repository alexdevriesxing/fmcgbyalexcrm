# CRM and Sales Commercial Vertical

Release 0.8.0 adds the first end-to-end commercial operating flow to the FMCG by Alex SuperApp.

## Operating flow

1. Create or link a CRM account.
2. Add contacts and record calls, emails, meetings and notes.
3. Schedule account or opportunity follow-up tasks.
4. Create opportunities with expected value, probability, stage and next action.
5. Define SKU price lists and quantity breaks.
6. Create a quotation from live CRM accounts and product variants.
7. Move the quotation from draft to sent and accepted.
8. Convert the accepted quotation into a sales order for one warehouse.
9. Reserve available inventory atomically with the order.
10. Cancel an eligible order to release all active reservations.

## Money and quantity rules

All monetary values are integers in the smallest currency unit. For example, EUR 199.00 is stored as `19900` with currency code `EUR`.

All commercial quantities use integer inventory base units. The commercial engine does not use JavaScript floating-point values for persisted money or stock.

The Worker calculates every quotation and sales-order line:

- subtotal = quantity × unit price
- discount = floor(subtotal × discount basis points / 10,000)
- taxable amount = subtotal − discount
- tax = floor(taxable amount × tax basis points / 10,000)
- total = taxable amount + tax

Document totals are the safe-integer sum of the calculated lines. Browser previews are not authoritative.

## CRM model

The tenant data plane includes:

- `crm_accounts`
- `crm_contacts`
- `crm_activities`
- `crm_tasks`
- `crm_opportunities`

Activity rows are append-only account history. Tasks may be open, completed or cancelled. Overdue and due-soon states are derived from the current time rather than stored as mutable flags.

Opportunity stages are:

- lead
- qualified
- proposal
- negotiation
- won
- lost

Won opportunities require 10,000 probability basis points. Lost opportunities require zero.

## Sales model

The tenant data plane includes:

- `sales_price_lists`
- `sales_price_list_items`
- `sales_quotes`
- `sales_quote_lines`
- `sales_orders`
- `sales_order_lines`
- `inventory_reservations`

Quotation states are explicit:

```text
draft -> sent -> accepted -> converted
```

A quotation can become only one order. The database enforces uniqueness on the source quotation and converted order reference.

## Inventory reservations

Reservations are commercial commitments beside the append-only inventory ledger. They do not change physical on-hand balances.

Available to promise is calculated as:

```text
available inventory balance - active reservations
```

Database triggers reject inserts or updates that would make active reservations exceed available stock for the selected tenant, warehouse and variant.

Quote conversion creates the following in one D1 batch:

- sales order
- sales order lines
- active reservations
- converted quotation state
- idempotency response
- audit event
- outbox event

A failed reservation rolls back the complete conversion. Partial orders are not created.

Cancelling a confirmed or allocated order updates the order and releases all active reservations in one batch.

## Security model

All reads and writes are tenant scoped. Referenced accounts, contacts, opportunities, products, warehouses, quotations and orders must belong to the authenticated tenant.

CRM permissions:

- `crm.accounts.read`
- `crm.accounts.manage`
- `crm.activities.read`
- `crm.activities.manage`
- `crm.pipeline.read`
- `crm.pipeline.manage`

Sales permissions:

- `sales.pricing.read`
- `sales.pricing.manage`
- `sales.quotes.read`
- `sales.quotes.manage`
- `sales.orders.read`
- `sales.orders.manage`
- `sales.orders.reserve`

Every state-changing endpoint requires an idempotency key. Successful commands also write tenant audit and transactional outbox records.

## API surface

### CRM

```text
GET   /v1/crm/overview
POST  /v1/crm/accounts
POST  /v1/crm/contacts
POST  /v1/crm/activities
POST  /v1/crm/tasks
POST  /v1/crm/tasks/:taskId/complete
POST  /v1/crm/opportunities
PATCH /v1/crm/opportunities/:opportunityId/stage
```

### Sales

```text
GET  /v1/sales/overview
POST /v1/sales/price-lists
POST /v1/sales/quotes
POST /v1/sales/quotes/:quoteId/send
POST /v1/sales/quotes/:quoteId/accept
POST /v1/sales/quotes/:quoteId/convert
POST /v1/sales/orders/:orderId/cancel
```

## Current scope boundaries

This release allocates a complete order from one warehouse. Lot-level picking and reservation consumption during shipment are intentionally deferred to the fulfilment vertical.

Customer-specific price-list assignment, credit limits, invoices, returns and trade-spend deductions are also future commercial and finance slices.
