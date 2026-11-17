# SnackFactory ERP — Firestore Security Specification (Username/Password Auth)

## 1. Data Invariants

1. **Zero Plain-Text Passwords & Zero Pre-Auth Username Enumeration**: Passwords are never stored in Firestore or `localStorage`. Usernames (`^[a-z0-9._\-]{3,30}$`) map deterministically to `<username>@users.snackfactory.internal` in Firebase Auth; no unauthenticated Firestore read or list query is permitted.
2. **One-Time Atomic Owner Bootstrap**: When `/system/bootstrap` does not yet exist, the first setup creates `/system/bootstrap` and `/users/{uid}` (`role: 'Owner'`, `status: 'Active'`) atomically in a single batch (`existsAfter`). Once `/system/bootstrap` exists, self-registration of `Owner` or any privileged role is permanently denied.
3. **Owner/Admin Employee Provisioning**: Only active `Owner` or `Admin` accounts may create `/users/{newUid}` documents for employees, assign/modify roles (`Owner`, `Admin`, `Salesman`, `Production Supervisor`, `Accountant/Auditor`), or toggle `Active`/`Suspended` status.
4. **Bootstrapped Email Guard**: `isBootstrappedOwner()` continues to strictly require `request.auth.token.email_verified == true` so email spoofing is impossible.
5. **Active Account Gate**: All ERP data access (`products`, `rawMaterials`, `customers`, `suppliers`, `users`) requires an active `/users/{uid}` document (`status == 'Active'`) matching the caller's `role`.

## 2. Adversarial "Dirty Dozen" Payloads (Expected: `PERMISSION_DENIED`)

1. **Unauthenticated Username Lookup**: `LIST /users` or `GET /system/bootstrap` with `auth == null`.
2. **Duplicate Owner Bootstrap Hijack**: Authenticated non-admin attempts `CREATE /users/{uid}` with `role: 'Owner'` after `/system/bootstrap` already exists.
3. **Non-Atomic Bootstrap Bypass**: Attempt `CREATE /users/{uid}` with `role: 'Owner'` without simultaneously writing `/system/bootstrap`.
4. **Employee Self-Role Escalation**: `Salesman` updates own `/users/{uid}` changing `role` to `'Admin'`.
5. **Non-Admin Creating Employee**: `Salesman` attempts `CREATE /users/other_uid`.
6. **Plain-Text Password Field Injection**: `Owner` attempts `CREATE /users/u2` containing ghost field `password: 'secret123'`.
7. **Suspended Employee Data Access**: User with `status: 'Suspended'` attempts `LIST /products` or `GET /customers/c1`.
8. **Invalid Username Format**: `Owner` attempts `CREATE /users/u2` with `username: 'Bad User!'`.
9. **Immutable `uid` / `createdAt` Tampering**: `Admin` updates `/users/u2` changing `createdAt` or `uid`.
10. **Self-Deletion by Owner**: `Owner` attempts `DELETE /users/{ownUid}`.
11. **Bootstrap Lock Tampering**: `Admin` attempts `UPDATE` or `DELETE /system/bootstrap`.
12. **Client Timestamp Forgery**: `Owner` creates `/users/u2` with backdated `createdAt` instead of `request.time`.

## 3. Stage 3 Data Invariants (Purchases & BOM)

1. **Relational Integrity on Procurement & BOM**: Every `/purchases/{purchaseId}` must reference an existing `/suppliers/{supplierId}`; every `/purchaseItems/{itemId}` must reference an existing or batch-created `/purchases/{purchaseId}` and an existing `/rawMaterials/{rawMaterialId}`. Every `/bom/{bomId}` must reference an existing `/products/{productId}`; every `/bomItems/{itemId}` must reference an existing or batch-created `/bom/{bomId}` and an existing `/rawMaterials/{rawMaterialId}`.
2. **Inventory Receipt Terminal Lock**: Raw material stock is only incremented when a purchase transitions from `receiptStatus == 'Ordered'` to `'Received'` via atomic transaction. Once `'Received'`, purchase totals, supplier, line items (`purchaseItems`), and `receiptStatus` cannot be edited or deleted (only `paymentStatus`, `invoiceNumber`, and `notes` may be updated).
3. **Role-Governed Procurement & BOM Writes**: `Salesman` has zero read/write access to `purchases`, `purchaseItems`, `bom`, or `bomItems`. `Accountant/Auditor` has read-only access for financial and costing audit. `Owner`, `Admin`, and `Production Supervisor` can create/edit purchases, receive stock, and manage BOM versions; only `Owner` and `Admin` can delete unreceived purchases or BOMs.

## 4. Stage 3 Adversarial Payloads (Expected: `PERMISSION_DENIED`)

1. **Salesman Reading Purchases**: `Salesman` attempts `LIST /purchases` or `GET /bom/b1`.
2. **Auditor Mutating Purchase**: `Accountant/Auditor` attempts `CREATE /purchases/p1` or `UPDATE /bom/b1`.
3. **Orphaned Purchase Line Item**: `Production Supervisor` creates `/purchaseItems/pi1` pointing to non-existent `purchaseId`.
4. **Post-Receipt Line-Item Tampering**: `Admin` attempts `UPDATE` or `DELETE` on `/purchaseItems/pi1` belonging to a `Received` purchase.
5. **Post-Receipt Total/Status Reversal**: `Owner` attempts to revert `/purchases/p1` from `receiptStatus: 'Received'` back to `'Ordered'` or alter `grandTotal`.
6. **Deleting Received Purchase**: `Owner` attempts `DELETE /purchases/p1` where `receiptStatus == 'Received'`.
7. **Shadow Field Injection on BOM**: `Production Supervisor` creates `/bom/b1` with ghost field `approvedOverride: true`.
8. **Invalid BOM Measurement Unit**: `Admin` creates `/bomItems/bi1` with `unit: 'tonnes'`.

## 5. Stage 4 Data Invariants (Production, Inventory & Variance)

1. **Zero Negative Inventory**: Both `/rawMaterials/{materialId}.currentStock` and `/stockBalances/{balanceId}.currentBalance` and `/inventoryLedger/{entryId}.balance` strictly enforce `>= 0` in Firestore rules and atomic `runTransaction` updates.
2. **Idempotent Production Execution & Terminal Lock**: Material issuance (`Planned -> In Progress`) sets `materialsIssued = true` once; completion (`In Progress -> Completed`) sets `finishedGoodsPosted = true` once and atomically requires `existsAfter(/productionVariances/{orderId})`. Neither `Completed` nor `Cancelled` production orders can be updated or re-executed.
3. **Immutable Inventory Audit Trail**: `/inventoryLedger/{entryId}` and `/productionVariances/{varianceId}` forbid updates and deletes (`allow update, delete: if false`), and `userUid == request.auth.uid` is enforced on creation.
4. **Role-Governed Manufacturing & Stock Control**: Only `Owner`, `Admin`, and `Production Supervisor` can create/issue/complete production or record stock adjustments. `Salesman` and `Accountant/Auditor` have read-only inventory visibility (`Salesman` has no write access to production or adjustments).

## 6. Stage 4 Adversarial Payloads (Expected: `PERMISSION_DENIED`)

1. **Negative Inventory Write**: `Production Supervisor` updates `/stockBalances/rm_1` with `currentBalance: -5`.
2. **Double Production Completion**: `Owner` attempts to update `/productionOrders/po1` where `existing().status == 'Completed'`.
3. **Completed Order Without Variance**: `Production Supervisor` transitions `productionOrders/po1` to `Completed` without creating `/productionVariances/po1` in the same transaction.
4. **Ledger Tampering**: `Admin` attempts `UPDATE` or `DELETE` on `/inventoryLedger/led1`.
5. **Salesman Stock Adjustment**: `Salesman` attempts `CREATE /inventoryLedger/led1` or `UPDATE /stockBalances/fg_1`.
6. **Impersonating Another Operator**: `Production Supervisor` creates `/inventoryLedger/led1` with `userUid: 'other_uid'`.

## 7. Stage 5 Data Invariants (Sales Orders, GST Invoices, Dispatch & Payments)

1. **Salesman Data Isolation**: `Salesman` accounts can only `get` or `list` `salesOrders`, `salesOrderItems`, `invoices`, `invoiceItems`, `dispatches`, `dispatchItems`, and `payments` where `salesmanUid == request.auth.uid`. Cross-salesman queries are denied.
2. **Approval Authority Gate**: Only `Owner` and `Admin` can transition a `salesOrder` from `Pending Approval` to `Approved` or `Rejected` (recording `approverUid == request.auth.uid` and `approvedAt == request.time`). Salesmen cannot self-approve orders.
3. **Approved-Only Dispatch & Authorized Partial Dispatch**: Dispatches (`/dispatches/{dispatchId}`) require the parent sales order to be in `Approved` or `Partially Dispatched` status. Unapproved (`Draft`, `Pending Approval`, `Rejected`, `Cancelled`) orders cannot be dispatched. Partial dispatches (`isPartial == true`) require `Owner` or `Admin` authorization. Finished goods stock balances (`stockBalances/fg_${productId}`) must remain `>= 0`.
4. **Anti-Duplicate GST Invoice Lock**: Every invoice must use deterministic ID `'inv_' + salesOrderId`, verify parent order status in `['Approved', 'Partially Dispatched', 'Dispatched']` and `existing().invoiceId == ''`, and atomically write `invoiceId` on `/salesOrders/{salesOrderId}` (`getAfter`). Invoices and invoice items cannot be deleted.
5. **Non-Exceeding Payment Reconciliation**: Creating `/payments/{paymentId}` (`Owner`, `Admin`, `Accountant/Auditor`) enforces `amount > 0 && amount <= get(/invoices/{invoiceId}).data.outstandingBalance` and atomically ensures `getAfter(/invoices/{invoiceId}).data.outstandingBalance >= 0`.

## 8. Stage 5 Adversarial Payloads (Expected: `PERMISSION_DENIED`)

1. **Salesman Self-Approving Order**: `Salesman` updates `/salesOrders/so1` setting `status: 'Approved'`.
2. **Cross-Salesman Order Snooping**: `Salesman` A attempts `GET` or `LIST /salesOrders` belonging to `Salesman` B.
3. **Dispatching Unapproved Order**: `Production Supervisor` creates `/dispatches/d1` referencing a `Pending Approval` or `Draft` sales order.
4. **Unauthorized Partial Dispatch**: `Production Supervisor` or `Salesman` creates `/dispatches/d1` with `isPartial: true`.
5. **Duplicate GST Invoice Creation**: `Accountant/Auditor` creates `/invoices/custom_id` or tries creating `/invoices/inv_so1` when `salesOrders/so1.invoiceId` is already populated.
6. **Overpayment Above Outstanding Balance**: `Accountant/Auditor` creates `/payments/p1` with `amount: 5000` when invoice `outstandingBalance` is `1200`.
7. **Salesman Recording Payment**: `Salesman` attempts `CREATE /payments/p1` or `UPDATE /invoices/inv_so1`.

## 9. Stage 6 Data Invariants (Product Costing, Audit Reports & Immutable Audit Trail)

1. **Production Overhead Costing 1:1 Binding**: Every `/productionCostings/{costingId}` document must have `costingId == productionOrderId` and reference an existing `/productionOrders/{productionOrderId}`, with non-negative `labourCost`, `gasElectricityCost`, and `otherExpenses` (`>= 0`). Only `Owner`, `Admin`, and `Accountant/Auditor` can create, update, or delete production costing entries; `Production Supervisor` has read-only access to inspect production costs. `Salesman` has zero access.
2. **Immutable Chronological Audit Trail**: `/auditLogs/{logId}` entries strictly enforce `userUid == request.auth.uid`, `createdAt == request.time`, valid `userRole`, and `allow update, delete: if false`. Only `Owner`, `Admin`, and `Accountant/Auditor` may read/list `/auditLogs`.
3. **Immutable Payment Protection**: `/payments/{paymentId}` forbids `update` and `delete` (`allow update, delete: if false`), preventing unauthorized payment modifications once recorded.

## 10. Stage 6 Adversarial Payloads (Expected: `PERMISSION_DENIED`)

1. **Supervisor Mutating Overhead Costing**: `Production Supervisor` attempts `CREATE` or `UPDATE` on `/productionCostings/po1`.
2. **Salesman Reading Costing or Audit Logs**: `Salesman` attempts `LIST /productionCostings` or `LIST /auditLogs`.
3. **Orphaned Costing Record**: `Accountant/Auditor` creates `/productionCostings/custom_id` where `custom_id != productionOrderId` or pointing to a non-existent `productionOrderId`.
4. **Audit Log Impersonation / Tampering**: `Admin` creates `/auditLogs/log1` with `userUid: 'other_uid'`, or `Owner` attempts `UPDATE` or `DELETE` on `/auditLogs/log1`.
5. **Payment Mutation Attempt**: `Owner` or `Accountant/Auditor` attempts `UPDATE` or `DELETE` on `/payments/p1`.

