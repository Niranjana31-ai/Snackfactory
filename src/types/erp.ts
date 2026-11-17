import type { Timestamp } from 'firebase/firestore';

export const ORG_ID = 'snackfactory' as const;

export type ErpRole =
  | 'Owner'
  | 'Admin'
  | 'Salesman'
  | 'Production Supervisor'
  | 'Accountant/Auditor';

export type UserStatus = 'Active' | 'Suspended';

export const ERP_ROLES: readonly ErpRole[] = [
  'Owner',
  'Admin',
  'Salesman',
  'Production Supervisor',
  'Accountant/Auditor',
] as const;

export const USER_STATUSES: readonly UserStatus[] = ['Active', 'Suspended'] as const;

export interface ErpUser {
  uid: string;
  username?: string;
  displayName: string;
  email: string;
  photoURL?: string;
  role: ErpRole;
  department: string;
  status: UserStatus;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
  lastLoginAt: Timestamp | null;
}

export type ProductStatus = 'Active' | 'Inactive';

export const PRODUCT_STATUSES: readonly ProductStatus[] = ['Active', 'Inactive'] as const;

export const PRODUCT_CATEGORIES: readonly string[] = [
  'Namkeen',
  'Potato & Banana Chips',
  'Extruded Snacks',
  'Traditional Sweets',
  'Roasted & Baked',
  'Bakery & Biscuits',
  'Other',
] as const;

export const PACKET_SIZE_PRESETS: readonly string[] = [
  '50g',
  '100g',
  '200g',
  '500g',
  '1kg',
] as const;

export const GST_RATES: readonly number[] = [0, 5, 12, 18, 28] as const;

export interface Product {
  id: string;
  orgId: typeof ORG_ID;
  name: string;
  sku: string;
  category: string;
  description: string;
  packetSize: string;
  sellingPrice: number;
  gstPercentage: number;
  hsnCode?: string;
  status: ProductStatus;
  createdBy: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export type MaterialUnit = 'kg' | 'litre' | 'pieces';

export const MATERIAL_UNITS: readonly MaterialUnit[] = ['kg', 'litre', 'pieces'] as const;

export const MATERIAL_CATEGORIES: readonly string[] = [
  'Grains & Flours',
  'Edible Oils',
  'Spices & Seasonings',
  'Nuts & Pulses',
  'Packaging Film & Pouches',
  'Cartons & Labels',
  'Additives & Preservatives',
  'Other',
] as const;

export interface RawMaterial {
  id: string;
  orgId: typeof ORG_ID;
  name: string;
  materialCode: string;
  category: string;
  unit: MaterialUnit;
  openingStock: number;
  currentStock: number;
  purchasePrice: number;
  minimumStockLevel: number;
  createdBy: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export type CustomerType = 'Retailer' | 'Distributor';

export const CUSTOMER_TYPES: readonly CustomerType[] = ['Retailer', 'Distributor'] as const;

export interface Customer {
  id: string;
  orgId: typeof ORG_ID;
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
  gstin: string;
  billingAddress: string;
  state: string;
  stateCode: string;
  customerType: CustomerType;
  createdBy: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface Supplier {
  id: string;
  orgId: typeof ORG_ID;
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
  gstin: string;
  address: string;
  state: string;
  createdBy: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export type PaymentStatus = 'Paid' | 'Partially Paid' | 'Unpaid';
export const PAYMENT_STATUSES: readonly PaymentStatus[] = [
  'Paid',
  'Partially Paid',
  'Unpaid',
] as const;

export type PurchaseReceiptStatus = 'Ordered' | 'Received' | 'Cancelled';
export const PURCHASE_RECEIPT_STATUSES: readonly PurchaseReceiptStatus[] = [
  'Ordered',
  'Received',
  'Cancelled',
] as const;

export interface Purchase {
  id: string;
  orgId: typeof ORG_ID;
  poNumber: string;
  supplierId: string;
  supplierName: string;
  supplierGstin: string;
  purchaseDate: string;
  invoiceNumber: string;
  paymentStatus: PaymentStatus;
  receiptStatus: PurchaseReceiptStatus;
  itemCount: number;
  subtotal: number;
  gstTotal: number;
  grandTotal: number;
  notes: string;
  createdBy: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
  receivedBy?: string;
  receivedAt?: Timestamp | null;
}

export interface PurchaseItem {
  id: string;
  orgId: typeof ORG_ID;
  purchaseId: string;
  rawMaterialId: string;
  materialName: string;
  materialCode: string;
  unit: MaterialUnit;
  quantity: number;
  unitPrice: number;
  gstPercentage: number;
  lineSubtotal: number;
  lineGst: number;
  lineTotal: number;
  createdBy: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export type BomStatus = 'Active' | 'Draft' | 'Archived';
export const BOM_STATUSES: readonly BomStatus[] = ['Active', 'Draft', 'Archived'] as const;

export type BomUnit = 'kg' | 'g' | 'litre' | 'ml' | 'pieces';
export const BOM_UNITS: readonly BomUnit[] = ['kg', 'g', 'litre', 'ml', 'pieces'] as const;

export interface Bom {
  id: string;
  orgId: typeof ORG_ID;
  bomCode: string;
  productId: string;
  productName: string;
  productSku: string;
  packetSize: string;
  version: number;
  batchSize: number;
  status: BomStatus;
  itemCount: number;
  estimatedMaterialCost: number;
  costPerUnit: number;
  notes: string;
  createdBy: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface BomItem {
  id: string;
  orgId: typeof ORG_ID;
  bomId: string;
  rawMaterialId: string;
  materialName: string;
  materialCode: string;
  stockUnit: MaterialUnit;
  unit: BomUnit;
  quantity: number;
  unitCost: number;
  estimatedCost: number;
  createdBy: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export type ProductionStatus = 'Planned' | 'In Progress' | 'Completed' | 'Cancelled';
export const PRODUCTION_STATUSES: readonly ProductionStatus[] = [
  'Planned',
  'In Progress',
  'Completed',
  'Cancelled',
] as const;

export interface ProductionOrder {
  id: string;
  orgId: typeof ORG_ID;
  orderNumber: string;
  productId: string;
  productName: string;
  productSku: string;
  packetSize: string;
  bomId: string;
  bomCode: string;
  bomVersion: number;
  bomBatchSize: number;
  plannedQuantity: number;
  expectedQuantity: number;
  actualGoodQuantity: number;
  damagedQuantity: number;
  productionDate: string;
  supervisorUid: string;
  supervisorName: string;
  status: ProductionStatus;
  materialsIssued: boolean;
  finishedGoodsPosted: boolean;
  notes: string;
  createdBy: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
  issuedBy?: string;
  issuedAt?: Timestamp | null;
  completedBy?: string;
  completedAt?: Timestamp | null;
}

export interface ProductionConsumption {
  id: string;
  orgId: typeof ORG_ID;
  productionOrderId: string;
  rawMaterialId: string;
  materialName: string;
  materialCode: string;
  unit: MaterialUnit;
  expectedQuantity: number;
  issuedQuantity: number;
  actualConsumedQuantity: number;
  damagedMaterialQuantity: number;
  varianceQuantity: number;
  unitCost: number;
  createdBy: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export type StockCategory = 'raw_material' | 'wip' | 'finished_goods' | 'damaged';
export const STOCK_CATEGORIES: readonly StockCategory[] = [
  'raw_material',
  'wip',
  'finished_goods',
  'damaged',
] as const;

export type StockUnit = MaterialUnit | 'packets';
export const STOCK_UNITS: readonly StockUnit[] = ['kg', 'litre', 'pieces', 'packets'] as const;

export type LedgerTransactionType =
  | 'Opening Stock'
  | 'Purchase Receipt'
  | 'Production Issue'
  | 'Production Return'
  | 'Production Extra Consumption'
  | 'WIP Issue'
  | 'WIP Completion'
  | 'Production Output'
  | 'Damaged Output'
  | 'Sales Dispatch'
  | 'Adjustment In'
  | 'Adjustment Out';

export const LEDGER_TRANSACTION_TYPES: readonly LedgerTransactionType[] = [
  'Opening Stock',
  'Purchase Receipt',
  'Production Issue',
  'Production Return',
  'Production Extra Consumption',
  'WIP Issue',
  'WIP Completion',
  'Production Output',
  'Damaged Output',
  'Sales Dispatch',
  'Adjustment In',
  'Adjustment Out',
] as const;

export interface StockBalance {
  id: string;
  orgId: typeof ORG_ID;
  itemId: string;
  itemCode: string;
  itemName: string;
  stockCategory: StockCategory;
  unit: StockUnit;
  openingStock: number;
  receivedFromPurchases: number;
  issuedToProduction: number;
  receivedFromProduction: number;
  dispatchedThroughSales: number;
  adjustmentsNet: number;
  currentBalance: number;
  minimumStockLevel: number;
  updatedBy: string;
  updatedByName: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface InventoryLedgerEntry {
  id: string;
  orgId: typeof ORG_ID;
  transactionDate: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  stockCategory: StockCategory;
  unit: StockUnit;
  transactionType: LedgerTransactionType;
  quantityIn: number;
  quantityOut: number;
  balance: number;
  referenceDoc: string;
  reason: string;
  userUid: string;
  userName: string;
  createdAt: Timestamp | null;
}

export interface ProductionVariance {
  id: string;
  orgId: typeof ORG_ID;
  productionOrderId: string;
  orderNumber: string;
  productId: string;
  productName: string;
  productionDate: string;
  expectedQuantity: number;
  actualGoodQuantity: number;
  damagedQuantity: number;
  yieldVarianceQty: number;
  yieldVariancePercent: number;
  expectedMaterialCost: number;
  actualMaterialCost: number;
  materialCostVariance: number;
  damagedMaterialQty: number;
  createdBy: string;
  createdAt: Timestamp | null;
}

export type SalesOrderStatus =
  | 'Draft'
  | 'Pending Approval'
  | 'Approved'
  | 'Rejected'
  | 'Partially Dispatched'
  | 'Dispatched'
  | 'Cancelled';

export const SALES_ORDER_STATUSES: readonly SalesOrderStatus[] = [
  'Draft',
  'Pending Approval',
  'Approved',
  'Rejected',
  'Partially Dispatched',
  'Dispatched',
  'Cancelled',
] as const;

export type TaxType = 'CGST_SGST' | 'IGST';

export interface FactorySettings {
  id: 'factoryConfig';
  orgId: typeof ORG_ID;
  factoryName: string;
  factoryAddress: string;
  factoryState: string;
  factoryStateCode: string;
  factoryGstin: string;
  invoicePrefix: string;
  nextInvoiceSeq: number;
  defaultHsnCode: string;
  updatedBy: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface SalesOrder {
  id: string;
  orgId: typeof ORG_ID;
  orderNumber: string;
  customerId: string;
  customerName: string;
  customerGstin: string;
  customerAddress: string;
  customerState: string;
  customerStateCode: string;
  orderDate: string;
  expectedDeliveryDate: string;
  salesmanUid: string;
  salesmanName: string;
  status: SalesOrderStatus;
  itemCount: number;
  totalOrderedQty: number;
  totalDispatchedQty: number;
  taxType: TaxType;
  subtotal: number;
  cgstTotal: number;
  sgstTotal: number;
  igstTotal: number;
  gstTotal: number;
  grandTotal: number;
  invoiceId: string;
  invoiceNumber: string;
  notes: string;
  approverUid?: string;
  approverName?: string;
  approvedAt?: Timestamp | null;
  approvalRemarks?: string;
  createdBy: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface SalesOrderItem {
  id: string;
  orgId: typeof ORG_ID;
  salesOrderId: string;
  salesmanUid: string;
  productId: string;
  productName: string;
  productSku: string;
  packetSize: string;
  hsnCode: string;
  quantity: number;
  dispatchedQuantity: number;
  sellingPrice: number;
  gstPercentage: number;
  lineSubtotal: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  lineGst: number;
  lineTotal: number;
  createdBy: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface Invoice {
  id: string;
  orgId: typeof ORG_ID;
  invoiceNumber: string;
  salesOrderId: string;
  orderNumber: string;
  salesmanUid: string;
  salesmanName: string;
  invoiceDate: string;
  factoryName: string;
  factoryAddress: string;
  factoryState: string;
  factoryStateCode: string;
  factoryGstin: string;
  customerId: string;
  customerName: string;
  customerGstin: string;
  customerAddress: string;
  customerState: string;
  customerStateCode: string;
  taxType: TaxType;
  itemCount: number;
  subtotal: number;
  cgstTotal: number;
  sgstTotal: number;
  igstTotal: number;
  gstTotal: number;
  grandTotal: number;
  amountPaid: number;
  outstandingBalance: number;
  paymentStatus: PaymentStatus;
  notes: string;
  createdBy: string;
  createdByName: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface InvoiceItem {
  id: string;
  orgId: typeof ORG_ID;
  invoiceId: string;
  salesOrderId: string;
  salesmanUid: string;
  productId: string;
  productName: string;
  productSku: string;
  packetSize: string;
  hsnCode: string;
  quantity: number;
  rate: number;
  taxableValue: number;
  gstPercentage: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  lineGst: number;
  lineTotal: number;
  createdBy: string;
  createdAt: Timestamp | null;
}

export interface Dispatch {
  id: string;
  orgId: typeof ORG_ID;
  dispatchNumber: string;
  salesOrderId: string;
  orderNumber: string;
  salesmanUid: string;
  salesmanName: string;
  customerId: string;
  customerName: string;
  customerAddress: string;
  dispatchDate: string;
  vehicleNumber: string;
  driverName: string;
  transporterName: string;
  ewayBillNumber: string;
  notes: string;
  isPartial: boolean;
  partialAuthorizedBy: string;
  partialAuthorizedByName: string;
  itemCount: number;
  totalDispatchedQty: number;
  dispatchedBy: string;
  dispatchedByName: string;
  createdAt: Timestamp | null;
}

export interface DispatchItem {
  id: string;
  orgId: typeof ORG_ID;
  dispatchId: string;
  salesOrderId: string;
  salesOrderItemId: string;
  salesmanUid: string;
  productId: string;
  productName: string;
  productSku: string;
  packetSize: string;
  orderedQuantity: number;
  dispatchedQuantity: number;
  createdBy: string;
  createdAt: Timestamp | null;
}

export type PaymentMethod = 'UPI' | 'NEFT/RTGS' | 'Bank Transfer' | 'Cheque' | 'Cash';

export const PAYMENT_METHODS: readonly PaymentMethod[] = [
  'UPI',
  'NEFT/RTGS',
  'Bank Transfer',
  'Cheque',
  'Cash',
] as const;

export interface Payment {
  id: string;
  orgId: typeof ORG_ID;
  receiptNumber: string;
  invoiceId: string;
  invoiceNumber: string;
  salesOrderId: string;
  orderNumber: string;
  salesmanUid: string;
  customerId: string;
  customerName: string;
  paymentDate: string;
  amount: number;
  paymentMethod: PaymentMethod;
  referenceNumber: string;
  notes: string;
  recordedBy: string;
  recordedByName: string;
  createdAt: Timestamp | null;
}

export interface ProductionCosting {
  id: string;
  orgId: typeof ORG_ID;
  productionOrderId: string;
  orderNumber: string;
  productId: string;
  productName: string;
  productionDate: string;
  labourCost: number;
  gasElectricityCost: number;
  otherExpenses: number;
  notes: string;
  recordedBy: string;
  recordedByName: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface AuditLogEntry {
  id: string;
  orgId: typeof ORG_ID;
  action: string;
  module: string;
  recordId: string;
  recordLabel: string;
  details: string;
  userUid: string;
  userName: string;
  userRole: ErpRole;
  createdAt: Timestamp | null;
}

export type ModuleId =
  | 'dashboard'
  | 'products'
  | 'customers'
  | 'suppliers'
  | 'raw-materials'
  | 'purchases'
  | 'bom'
  | 'production'
  | 'inventory'
  | 'sales-orders'
  | 'invoices'
  | 'dispatch'
  | 'payments'
  | 'costing'
  | 'reports'
  | 'user-management';

export type NavSectionId =
  | 'Overview'
  | 'Master Data'
  | 'Procurement & Production'
  | 'Sales & Fulfillment'
  | 'Finance & Governance';

export interface ErpModuleDefinition {
  id: ModuleId;
  label: string;
  section: NavSectionId;
  description: string;
  emptyStateTitle: string;
  emptyStateDescription: string;
  columns: string[];
  allowedRoles: ErpRole[];
}
