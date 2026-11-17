import {
  BOM_STATUSES,
  BOM_UNITS,
  CUSTOMER_TYPES,
  ERP_ROLES,
  MATERIAL_UNITS,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  PRODUCT_STATUSES,
  USER_STATUSES,
  type Bom,
  type BomItem,
  type BomStatus,
  type BomUnit,
  type Customer,
  type CustomerType,
  type ErpRole,
  type ErpUser,
  type FactorySettings,
  type Invoice,
  type MaterialUnit,
  type PaymentMethod,
  type PaymentStatus,
  type Product,
  type ProductionConsumption,
  type ProductStatus,
  type RawMaterial,
  type SalesOrder,
  type SalesOrderItem,
  type StockBalance,
  type Supplier,
  type TaxType,
  type UserStatus,
} from '../types/erp';

// Mirrored verbatim from firebase-blueprint.json
export const BLUEPRINT_CONSTRAINTS = {
  uid: {
    minLength: 1,
    maxLength: 128,
    pattern: /^[a-zA-Z0-9_-]+$/,
  },
  displayName: {
    minLength: 1,
    maxLength: 100,
  },
  email: {
    minLength: 3,
    maxLength: 254,
  },
  photoURL: {
    maxLength: 500,
  },
  department: {
    minLength: 1,
    maxLength: 80,
  },
  masterName: {
    minLength: 1,
    maxLength: 120,
  },
  code: {
    minLength: 1,
    maxLength: 40,
    pattern: /^[A-Z0-9\-_]+$/,
  },
  category: {
    minLength: 1,
    maxLength: 60,
  },
  description: {
    maxLength: 500,
  },
  packetSize: {
    minLength: 1,
    maxLength: 30,
  },
  contactPerson: {
    minLength: 1,
    maxLength: 100,
  },
  phone: {
    minLength: 6,
    maxLength: 20,
  },
  address: {
    minLength: 1,
    maxLength: 300,
  },
  state: {
    minLength: 1,
    maxLength: 60,
  },
  stateCode: {
    minLength: 1,
    maxLength: 5,
  },
  gstinPattern: /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/,
  emailPattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  phonePattern: /^[0-9+\-\s()]{6,20}$/,
} as const;

export function sanitizeString(value: string, maxLength: number): string {
  return value.trim().slice(0, maxLength);
}

export function isValidDocumentId(id: string): boolean {
  return (
    id.length >= BLUEPRINT_CONSTRAINTS.uid.minLength &&
    id.length <= BLUEPRINT_CONSTRAINTS.uid.maxLength &&
    BLUEPRINT_CONSTRAINTS.uid.pattern.test(id)
  );
}

export function isValidRole(role: string): role is ErpRole {
  return (ERP_ROLES as readonly string[]).includes(role);
}

export function isValidStatus(status: string): status is UserStatus {
  return (USER_STATUSES as readonly string[]).includes(status);
}

export function validateUserUpdateInput(input: {
  displayName: string;
  department: string;
  role: ErpRole;
  status: UserStatus;
}): { valid: true; sanitized: typeof input } | { valid: false; error: string } {
  const displayName = sanitizeString(input.displayName, BLUEPRINT_CONSTRAINTS.displayName.maxLength);
  const department = sanitizeString(input.department, BLUEPRINT_CONSTRAINTS.department.maxLength);

  if (displayName.length < BLUEPRINT_CONSTRAINTS.displayName.minLength) {
    return { valid: false, error: 'Display name is required.' };
  }
  if (department.length < BLUEPRINT_CONSTRAINTS.department.minLength) {
    return { valid: false, error: 'Department is required.' };
  }
  if (!isValidRole(input.role)) {
    return { valid: false, error: 'Selected role is invalid.' };
  }
  if (!isValidStatus(input.status)) {
    return { valid: false, error: 'Selected status is invalid.' };
  }

  return {
    valid: true,
    sanitized: {
      displayName,
      department,
      role: input.role,
      status: input.status,
    },
  };
}

export const USERNAME_PATTERN = /^[a-z0-9._-]+$/;

export function validateUsernameAndPassword(
  usernameRaw: string,
  password: string,
): { valid: true; username: string } | { valid: false; error: string } {
  const username = usernameRaw.trim().toLowerCase();
  if (username.length < 3 || username.length > 30) {
    return { valid: false, error: 'Username must be between 3 and 30 characters.' };
  }
  if (!USERNAME_PATTERN.test(username)) {
    return {
      valid: false,
      error: 'Username may only contain lowercase letters, numbers, dots, underscores, and hyphens.',
    };
  }
  if (password.length < 6 || password.length > 128) {
    return { valid: false, error: 'Password must be at least 6 characters.' };
  }
  return { valid: true, username };
}

export function validateCreateEmployeeInput(input: {
  username: string;
  password: string;
  displayName: string;
  department: string;
  role: ErpRole;
  status: UserStatus;
}):
  | {
      valid: true;
      sanitized: {
        username: string;
        password: string;
        displayName: string;
        department: string;
        role: ErpRole;
        status: UserStatus;
      };
    }
  | { valid: false; error: string } {
  const credCheck = validateUsernameAndPassword(input.username, input.password);
  if (!credCheck.valid) return credCheck;

  const profileCheck = validateUserUpdateInput({
    displayName: input.displayName,
    department: input.department,
    role: input.role,
    status: input.status,
  });
  if (!profileCheck.valid) return profileCheck;

  return {
    valid: true,
    sanitized: {
      username: credCheck.username,
      password: input.password,
      ...profileCheck.sanitized,
    },
  };
}

export interface ProductInput {
  name: string;
  sku: string;
  category: string;
  description: string;
  packetSize: string;
  sellingPrice: string;
  gstPercentage: string;
  hsnCode?: string;
  status: ProductStatus;
}

export interface SanitizedProduct {
  name: string;
  sku: string;
  category: string;
  description: string;
  packetSize: string;
  sellingPrice: number;
  gstPercentage: number;
  hsnCode: string;
  status: ProductStatus;
}

const HSN_PATTERN = /^[0-9A-Za-z]*$/;

export function validateProductInput(
  input: ProductInput,
): { valid: true; sanitized: SanitizedProduct } | { valid: false; error: string } {
  const name = sanitizeString(input.name, BLUEPRINT_CONSTRAINTS.masterName.maxLength);
  const sku = sanitizeString(input.sku.toUpperCase(), BLUEPRINT_CONSTRAINTS.code.maxLength);
  const category = sanitizeString(input.category, BLUEPRINT_CONSTRAINTS.category.maxLength);
  const description = sanitizeString(input.description, BLUEPRINT_CONSTRAINTS.description.maxLength);
  const packetSize = sanitizeString(input.packetSize, BLUEPRINT_CONSTRAINTS.packetSize.maxLength);
  const sellingPrice = Number(input.sellingPrice);
  const gstPercentage = Number(input.gstPercentage);
  const hsnCode = sanitizeString((input.hsnCode ?? '').toUpperCase(), 16);

  if (!name) return { valid: false, error: 'Product name is required.' };
  if (!sku) return { valid: false, error: 'SKU is required.' };
  if (!BLUEPRINT_CONSTRAINTS.code.pattern.test(sku)) {
    return {
      valid: false,
      error: 'SKU may only contain uppercase letters, numbers, hyphens, and underscores.',
    };
  }
  if (!category) return { valid: false, error: 'Product category is required.' };
  if (!packetSize) return { valid: false, error: 'Packet size is required (e.g., 100g, 200g, 500g).' };
  if (!Number.isFinite(sellingPrice) || sellingPrice < 0 || sellingPrice > 10000000) {
    return { valid: false, error: 'Selling price must be a non-negative number.' };
  }
  if (!Number.isFinite(gstPercentage) || gstPercentage < 0 || gstPercentage > 28) {
    return { valid: false, error: 'GST percentage must be between 0 and 28.' };
  }
  if (hsnCode && !HSN_PATTERN.test(hsnCode)) {
    return { valid: false, error: 'HSN code may only contain letters and numbers.' };
  }
  if (!(PRODUCT_STATUSES as readonly string[]).includes(input.status)) {
    return { valid: false, error: 'Invalid product status.' };
  }

  return {
    valid: true,
    sanitized: {
      name,
      sku,
      category,
      description,
      packetSize,
      sellingPrice: Math.round(sellingPrice * 100) / 100,
      gstPercentage: Math.round(gstPercentage * 100) / 100,
      hsnCode,
      status: input.status,
    },
  };
}

export interface RawMaterialInput {
  name: string;
  materialCode: string;
  category: string;
  unit: MaterialUnit;
  openingStock: string;
  currentStock: string;
  purchasePrice: string;
  minimumStockLevel: string;
}

export interface SanitizedRawMaterial {
  name: string;
  materialCode: string;
  category: string;
  unit: MaterialUnit;
  openingStock: number;
  currentStock: number;
  purchasePrice: number;
  minimumStockLevel: number;
}

export function validateRawMaterialInput(
  input: RawMaterialInput,
): { valid: true; sanitized: SanitizedRawMaterial } | { valid: false; error: string } {
  const name = sanitizeString(input.name, BLUEPRINT_CONSTRAINTS.masterName.maxLength);
  const materialCode = sanitizeString(
    input.materialCode.toUpperCase(),
    BLUEPRINT_CONSTRAINTS.code.maxLength,
  );
  const category = sanitizeString(input.category, BLUEPRINT_CONSTRAINTS.category.maxLength);
  const openingStock = Number(input.openingStock);
  const currentStock = Number(input.currentStock);
  const purchasePrice = Number(input.purchasePrice);
  const minimumStockLevel = Number(input.minimumStockLevel);

  if (!name) return { valid: false, error: 'Material name is required.' };
  if (!materialCode) return { valid: false, error: 'Unique material code is required.' };
  if (!BLUEPRINT_CONSTRAINTS.code.pattern.test(materialCode)) {
    return {
      valid: false,
      error: 'Material code may only contain uppercase letters, numbers, hyphens, and underscores.',
    };
  }
  if (!category) return { valid: false, error: 'Material category is required.' };
  if (!(MATERIAL_UNITS as readonly string[]).includes(input.unit)) {
    return { valid: false, error: 'Unit must be kg, litre, or pieces.' };
  }
  if (!Number.isFinite(openingStock) || openingStock < 0 || openingStock > 100000000) {
    return { valid: false, error: 'Opening stock must be 0 or greater.' };
  }
  if (!Number.isFinite(currentStock) || currentStock < 0 || currentStock > 100000000) {
    return { valid: false, error: 'Current stock must be 0 or greater.' };
  }
  if (!Number.isFinite(purchasePrice) || purchasePrice < 0 || purchasePrice > 10000000) {
    return { valid: false, error: 'Purchase price per unit must be 0 or greater.' };
  }
  if (!Number.isFinite(minimumStockLevel) || minimumStockLevel < 0 || minimumStockLevel > 100000000) {
    return { valid: false, error: 'Minimum stock level must be 0 or greater.' };
  }

  return {
    valid: true,
    sanitized: {
      name,
      materialCode,
      category,
      unit: input.unit,
      openingStock: Math.round(openingStock * 1000) / 1000,
      currentStock: Math.round(currentStock * 1000) / 1000,
      purchasePrice: Math.round(purchasePrice * 100) / 100,
      minimumStockLevel: Math.round(minimumStockLevel * 1000) / 1000,
    },
  };
}

export interface CustomerInput {
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
  gstin: string;
  billingAddress: string;
  state: string;
  stateCode: string;
  customerType: CustomerType;
}

export interface SanitizedCustomer {
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
  gstin: string;
  billingAddress: string;
  state: string;
  stateCode: string;
  customerType: CustomerType;
}

export function validateCustomerInput(
  input: CustomerInput,
): { valid: true; sanitized: SanitizedCustomer } | { valid: false; error: string } {
  const name = sanitizeString(input.name, BLUEPRINT_CONSTRAINTS.masterName.maxLength);
  const contactPerson = sanitizeString(
    input.contactPerson,
    BLUEPRINT_CONSTRAINTS.contactPerson.maxLength,
  );
  const phone = sanitizeString(input.phone, BLUEPRINT_CONSTRAINTS.phone.maxLength);
  const email = sanitizeString(input.email, BLUEPRINT_CONSTRAINTS.email.maxLength);
  const gstin = sanitizeString(input.gstin.toUpperCase(), 15);
  const billingAddress = sanitizeString(input.billingAddress, BLUEPRINT_CONSTRAINTS.address.maxLength);
  const state = sanitizeString(input.state, BLUEPRINT_CONSTRAINTS.state.maxLength);
  const stateCode = sanitizeString(input.stateCode, BLUEPRINT_CONSTRAINTS.stateCode.maxLength);

  if (!name) return { valid: false, error: 'Customer name is required.' };
  if (!contactPerson) return { valid: false, error: 'Contact person name is required.' };
  if (!BLUEPRINT_CONSTRAINTS.phonePattern.test(phone)) {
    return { valid: false, error: 'Enter a valid contact phone number (6–20 characters).' };
  }
  if (email && !BLUEPRINT_CONSTRAINTS.emailPattern.test(email)) {
    return { valid: false, error: 'Enter a valid email address or leave it blank.' };
  }
  if (gstin && !BLUEPRINT_CONSTRAINTS.gstinPattern.test(gstin)) {
    return {
      valid: false,
      error: 'GSTIN must be a valid 15-character format (e.g., 27AABCU9603R1ZM) or left blank.',
    };
  }
  if (!billingAddress) return { valid: false, error: 'Billing address is required.' };
  if (!state) return { valid: false, error: 'State is required.' };
  if (!stateCode) return { valid: false, error: 'State code is required.' };
  if (!(CUSTOMER_TYPES as readonly string[]).includes(input.customerType)) {
    return { valid: false, error: 'Customer type must be Retailer or Distributor.' };
  }

  return {
    valid: true,
    sanitized: {
      name,
      contactPerson,
      phone,
      email,
      gstin,
      billingAddress,
      state,
      stateCode,
      customerType: input.customerType,
    },
  };
}

export interface SupplierInput {
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
  gstin: string;
  address: string;
  state: string;
}

export interface SanitizedSupplier {
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
  gstin: string;
  address: string;
  state: string;
}

export function validateSupplierInput(
  input: SupplierInput,
): { valid: true; sanitized: SanitizedSupplier } | { valid: false; error: string } {
  const name = sanitizeString(input.name, BLUEPRINT_CONSTRAINTS.masterName.maxLength);
  const contactPerson = sanitizeString(
    input.contactPerson,
    BLUEPRINT_CONSTRAINTS.contactPerson.maxLength,
  );
  const phone = sanitizeString(input.phone, BLUEPRINT_CONSTRAINTS.phone.maxLength);
  const email = sanitizeString(input.email, BLUEPRINT_CONSTRAINTS.email.maxLength);
  const gstin = sanitizeString(input.gstin.toUpperCase(), 15);
  const address = sanitizeString(input.address, BLUEPRINT_CONSTRAINTS.address.maxLength);
  const state = sanitizeString(input.state, BLUEPRINT_CONSTRAINTS.state.maxLength);

  if (!name) return { valid: false, error: 'Supplier name is required.' };
  if (!contactPerson) return { valid: false, error: 'Contact person name is required.' };
  if (!BLUEPRINT_CONSTRAINTS.phonePattern.test(phone)) {
    return { valid: false, error: 'Enter a valid contact phone number (6–20 characters).' };
  }
  if (email && !BLUEPRINT_CONSTRAINTS.emailPattern.test(email)) {
    return { valid: false, error: 'Enter a valid email address or leave it blank.' };
  }
  if (gstin && !BLUEPRINT_CONSTRAINTS.gstinPattern.test(gstin)) {
    return {
      valid: false,
      error: 'GSTIN must be a valid 15-character format (e.g., 27AABCU9603R1ZM) or left blank.',
    };
  }
  if (!address) return { valid: false, error: 'Supplier address is required.' };
  if (!state) return { valid: false, error: 'State is required.' };

  return {
    valid: true,
    sanitized: {
      name,
      contactPerson,
      phone,
      email,
      gstin,
      address,
      state,
    },
  };
}

export function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

export function roundQuantity(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function getCompatibleBomUnits(stockUnit: MaterialUnit): BomUnit[] {
  if (stockUnit === 'kg') return ['kg', 'g'];
  if (stockUnit === 'litre') return ['litre', 'ml'];
  return ['pieces'];
}

export function convertBomQuantityToStockUnit(
  quantity: number,
  bomUnit: BomUnit,
  stockUnit: MaterialUnit,
): number | null {
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  if (bomUnit === stockUnit) return quantity;
  if (stockUnit === 'kg' && bomUnit === 'g') return quantity / 1000;
  if (stockUnit === 'litre' && bomUnit === 'ml') return quantity / 1000;
  return null;
}

export interface PurchaseLineDraft {
  rawMaterialId: string;
  quantity: string;
  unitPrice: string;
  gstPercentage: string;
}

export interface PurchaseInput {
  poNumber: string;
  supplierId: string;
  purchaseDate: string;
  invoiceNumber: string;
  paymentStatus: PaymentStatus;
  notes: string;
  items: PurchaseLineDraft[];
}

export interface SanitizedPurchaseLine {
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
}

export interface SanitizedPurchase {
  poNumber: string;
  supplierId: string;
  supplierName: string;
  supplierGstin: string;
  purchaseDate: string;
  invoiceNumber: string;
  paymentStatus: PaymentStatus;
  itemCount: number;
  subtotal: number;
  gstTotal: number;
  grandTotal: number;
  notes: string;
  items: SanitizedPurchaseLine[];
}

const DATE_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

export function validatePurchaseInput(
  input: PurchaseInput,
  suppliers: Supplier[],
  materials: RawMaterial[],
): { valid: true; sanitized: SanitizedPurchase } | { valid: false; error: string } {
  const poNumber = sanitizeString(input.poNumber.toUpperCase(), BLUEPRINT_CONSTRAINTS.code.maxLength);
  const supplierId = input.supplierId.trim();
  const purchaseDate = input.purchaseDate.trim();
  const invoiceNumber = sanitizeString(input.invoiceNumber, 60);
  const notes = sanitizeString(input.notes, BLUEPRINT_CONSTRAINTS.description.maxLength);

  if (!poNumber) return { valid: false, error: 'Purchase Order (PO) number is required.' };
  if (!BLUEPRINT_CONSTRAINTS.code.pattern.test(poNumber)) {
    return {
      valid: false,
      error: 'PO number may only contain uppercase letters, numbers, hyphens, and underscores.',
    };
  }

  if (!supplierId || !isValidDocumentId(supplierId)) {
    return { valid: false, error: 'Please select a valid supplier.' };
  }
  const supplier = suppliers.find((s) => s.id === supplierId);
  if (!supplier) {
    return { valid: false, error: 'Selected supplier could not be found.' };
  }

  if (!DATE_PATTERN.test(purchaseDate)) {
    return { valid: false, error: 'Purchase date must be in YYYY-MM-DD format.' };
  }
  if (!(PAYMENT_STATUSES as readonly string[]).includes(input.paymentStatus)) {
    return { valid: false, error: 'Invalid payment status.' };
  }
  if (input.items.length === 0) {
    return { valid: false, error: 'Add at least one raw material line item.' };
  }
  if (input.items.length > 100) {
    return { valid: false, error: 'A single purchase cannot exceed 100 line items.' };
  }

  const materialMap = new Map(materials.map((m) => [m.id, m]));
  const sanitizedItems: SanitizedPurchaseLine[] = [];

  for (let i = 0; i < input.items.length; i += 1) {
    const row = input.items[i];
    const material = materialMap.get(row.rawMaterialId);
    if (!material || !isValidDocumentId(row.rawMaterialId)) {
      return { valid: false, error: `Line ${i + 1}: Select a valid raw material.` };
    }

    const quantity = Number(row.quantity);
    const unitPrice = Number(row.unitPrice);
    const gstPercentage = Number(row.gstPercentage);

    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 100000000) {
      return { valid: false, error: `Line ${i + 1} (${material.name}): Quantity must be greater than 0.` };
    }
    if (!Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice > 10000000) {
      return { valid: false, error: `Line ${i + 1} (${material.name}): Unit price must be 0 or greater.` };
    }
    if (!Number.isFinite(gstPercentage) || gstPercentage < 0 || gstPercentage > 28) {
      return { valid: false, error: `Line ${i + 1} (${material.name}): GST % must be between 0 and 28.` };
    }

    const q = roundQuantity(quantity);
    const price = roundCurrency(unitPrice);
    const gstRate = roundCurrency(gstPercentage);
    const lineSubtotal = roundCurrency(q * price);
    const lineGst = roundCurrency((lineSubtotal * gstRate) / 100);
    const lineTotal = roundCurrency(lineSubtotal + lineGst);

    sanitizedItems.push({
      rawMaterialId: material.id,
      materialName: sanitizeString(material.name, BLUEPRINT_CONSTRAINTS.masterName.maxLength),
      materialCode: sanitizeString(material.materialCode.toUpperCase(), BLUEPRINT_CONSTRAINTS.code.maxLength),
      unit: material.unit,
      quantity: q,
      unitPrice: price,
      gstPercentage: gstRate,
      lineSubtotal,
      lineGst,
      lineTotal,
    });
  }

  const subtotal = roundCurrency(sanitizedItems.reduce((sum, item) => sum + item.lineSubtotal, 0));
  const gstTotal = roundCurrency(sanitizedItems.reduce((sum, item) => sum + item.lineGst, 0));
  const grandTotal = roundCurrency(subtotal + gstTotal);

  return {
    valid: true,
    sanitized: {
      poNumber,
      supplierId: supplier.id,
      supplierName: sanitizeString(supplier.name, BLUEPRINT_CONSTRAINTS.masterName.maxLength),
      supplierGstin: sanitizeString(supplier.gstin.toUpperCase(), 15),
      purchaseDate,
      invoiceNumber,
      paymentStatus: input.paymentStatus,
      itemCount: sanitizedItems.length,
      subtotal,
      gstTotal,
      grandTotal,
      notes,
      items: sanitizedItems,
    },
  };
}

export interface BomLineDraft {
  rawMaterialId: string;
  quantity: string;
  unit: BomUnit;
}

export interface BomInput {
  bomCode: string;
  productId: string;
  version: number;
  batchSize: string;
  status: BomStatus;
  notes: string;
  items: BomLineDraft[];
}

export interface SanitizedBomLine {
  rawMaterialId: string;
  materialName: string;
  materialCode: string;
  stockUnit: MaterialUnit;
  unit: BomUnit;
  quantity: number;
  unitCost: number;
  estimatedCost: number;
}

export interface SanitizedBom {
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
  items: SanitizedBomLine[];
}

export function validateBomInput(
  input: BomInput,
  products: Product[],
  materials: RawMaterial[],
): { valid: true; sanitized: SanitizedBom } | { valid: false; error: string } {
  const bomCode = sanitizeString(input.bomCode.toUpperCase(), BLUEPRINT_CONSTRAINTS.code.maxLength);
  const productId = input.productId.trim();
  const version = Math.trunc(input.version);
  const batchSize = Number(input.batchSize);
  const notes = sanitizeString(input.notes, BLUEPRINT_CONSTRAINTS.description.maxLength);

  if (!bomCode) return { valid: false, error: 'BOM code is required.' };
  if (!BLUEPRINT_CONSTRAINTS.code.pattern.test(bomCode)) {
    return {
      valid: false,
      error: 'BOM code may only contain uppercase letters, numbers, hyphens, and underscores.',
    };
  }
  if (!productId || !isValidDocumentId(productId)) {
    return { valid: false, error: 'Please select a finished product.' };
  }
  const product = products.find((p) => p.id === productId);
  if (!product) {
    return { valid: false, error: 'Selected finished product could not be found.' };
  }
  if (!Number.isInteger(version) || version < 1 || version > 1000) {
    return { valid: false, error: 'BOM version must be an integer between 1 and 1000.' };
  }
  if (!Number.isFinite(batchSize) || batchSize <= 0 || batchSize > 10000000) {
    return { valid: false, error: 'Batch output size (packets) must be greater than 0.' };
  }
  if (!(BOM_STATUSES as readonly string[]).includes(input.status)) {
    return { valid: false, error: 'Invalid BOM status.' };
  }
  if (input.items.length === 0) {
    return { valid: false, error: 'Add at least one raw material component to the BOM.' };
  }
  if (input.items.length > 100) {
    return { valid: false, error: 'A BOM cannot exceed 100 component lines.' };
  }

  const materialMap = new Map(materials.map((m) => [m.id, m]));
  const seenMaterials = new Set<string>();
  const sanitizedItems: SanitizedBomLine[] = [];

  for (let i = 0; i < input.items.length; i += 1) {
    const row = input.items[i];
    const material = materialMap.get(row.rawMaterialId);
    if (!material || !isValidDocumentId(row.rawMaterialId)) {
      return { valid: false, error: `Line ${i + 1}: Select a valid raw material.` };
    }
    if (seenMaterials.has(material.id)) {
      return {
        valid: false,
        error: `Raw material "${material.name}" is listed multiple times. Combine duplicate ingredients into one line.`,
      };
    }
    seenMaterials.add(material.id);

    if (!(BOM_UNITS as readonly string[]).includes(row.unit)) {
      return { valid: false, error: `Line ${i + 1}: Select a valid measurement unit.` };
    }

    const quantity = Number(row.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 100000000) {
      return { valid: false, error: `Line ${i + 1} (${material.name}): Required quantity must be greater than 0.` };
    }

    const convertedQty = convertBomQuantityToStockUnit(quantity, row.unit, material.unit);
    if (convertedQty === null) {
      return {
        valid: false,
        error: `Line ${i + 1} (${material.name}): Unit "${row.unit}" is incompatible with stock unit "${material.unit}".`,
      };
    }

    const q = roundQuantity(quantity);
    const unitCost = roundCurrency(material.purchasePrice);
    const estimatedCost = roundCurrency(convertedQty * unitCost);

    sanitizedItems.push({
      rawMaterialId: material.id,
      materialName: sanitizeString(material.name, BLUEPRINT_CONSTRAINTS.masterName.maxLength),
      materialCode: sanitizeString(material.materialCode.toUpperCase(), BLUEPRINT_CONSTRAINTS.code.maxLength),
      stockUnit: material.unit,
      unit: row.unit,
      quantity: q,
      unitCost,
      estimatedCost,
    });
  }

  const estimatedMaterialCost = roundCurrency(
    sanitizedItems.reduce((sum, item) => sum + item.estimatedCost, 0),
  );
  const roundedBatchSize = roundQuantity(batchSize);
  const costPerUnit = roundCurrency(estimatedMaterialCost / roundedBatchSize);

  return {
    valid: true,
    sanitized: {
      bomCode,
      productId: product.id,
      productName: sanitizeString(product.name, BLUEPRINT_CONSTRAINTS.masterName.maxLength),
      productSku: sanitizeString(product.sku.toUpperCase(), BLUEPRINT_CONSTRAINTS.code.maxLength),
      packetSize: sanitizeString(product.packetSize, BLUEPRINT_CONSTRAINTS.packetSize.maxLength),
      version,
      batchSize: roundedBatchSize,
      status: input.status,
      itemCount: sanitizedItems.length,
      estimatedMaterialCost,
      costPerUnit,
      notes,
      items: sanitizedItems,
    },
  };
}

export interface CalculatedMaterialRequirement {
  rawMaterialId: string;
  materialName: string;
  materialCode: string;
  unit: MaterialUnit;
  expectedQuantity: number;
  availableStock: number;
  shortage: number;
  sufficient: boolean;
  unitCost: number;
  expectedCost: number;
}

export function calculateBomRequirementsForProduction(
  bom: Bom,
  bomItems: BomItem[],
  plannedQuantity: number,
  materials: RawMaterial[],
): {
  requirements: CalculatedMaterialRequirement[];
  allAvailable: boolean;
  totalExpectedMaterialCost: number;
} {
  if (!Number.isFinite(plannedQuantity) || plannedQuantity <= 0 || bom.batchSize <= 0) {
    return { requirements: [], allAvailable: false, totalExpectedMaterialCost: 0 };
  }

  const materialMap = new Map(materials.map((m) => [m.id, m]));
  const scale = plannedQuantity / bom.batchSize;
  const requirements: CalculatedMaterialRequirement[] = [];
  let allAvailable = true;
  let totalCost = 0;

  for (const item of bomItems) {
    const material = materialMap.get(item.rawMaterialId);
    const stockUnit = material?.unit ?? item.stockUnit;
    const baseStockQty = convertBomQuantityToStockUnit(item.quantity, item.unit, stockUnit);
    const expectedQuantity = roundQuantity((baseStockQty ?? item.quantity) * scale);
    const availableStock = roundQuantity(material?.currentStock ?? 0);
    const shortage = roundQuantity(Math.max(0, expectedQuantity - availableStock));
    const sufficient = Boolean(material) && availableStock >= expectedQuantity;
    if (!sufficient) {
      allAvailable = false;
    }
    const unitCost = roundCurrency(material?.purchasePrice ?? item.unitCost);
    const expectedCost = roundCurrency(expectedQuantity * unitCost);
    totalCost += expectedCost;

    requirements.push({
      rawMaterialId: item.rawMaterialId,
      materialName: sanitizeString(
        material?.name ?? item.materialName,
        BLUEPRINT_CONSTRAINTS.masterName.maxLength,
      ),
      materialCode: sanitizeString(
        (material?.materialCode ?? item.materialCode).toUpperCase(),
        BLUEPRINT_CONSTRAINTS.code.maxLength,
      ),
      unit: stockUnit,
      expectedQuantity: Math.max(0.001, expectedQuantity),
      availableStock,
      shortage,
      sufficient,
      unitCost,
      expectedCost,
    });
  }

  return {
    requirements,
    allAvailable: requirements.length > 0 && allAvailable,
    totalExpectedMaterialCost: roundCurrency(totalCost),
  };
}

export interface ProductionPlanInput {
  orderNumber: string;
  productId: string;
  bomId: string;
  plannedQuantity: string;
  productionDate: string;
  supervisorUid: string;
  supervisorName: string;
  notes: string;
}

export interface SanitizedProductionPlan {
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
  productionDate: string;
  supervisorUid: string;
  supervisorName: string;
  notes: string;
  requirements: CalculatedMaterialRequirement[];
}

export function validateProductionPlanInput(
  input: ProductionPlanInput,
  products: Product[],
  boms: Bom[],
  bomItems: BomItem[],
  materials: RawMaterial[],
): { valid: true; sanitized: SanitizedProductionPlan } | { valid: false; error: string } {
  const orderNumber = sanitizeString(input.orderNumber.toUpperCase(), BLUEPRINT_CONSTRAINTS.code.maxLength);
  const productId = input.productId.trim();
  const bomId = input.bomId.trim();
  const plannedQuantity = Number(input.plannedQuantity);
  const productionDate = input.productionDate.trim();
  const supervisorUid = input.supervisorUid.trim();
  const supervisorName = sanitizeString(input.supervisorName, BLUEPRINT_CONSTRAINTS.displayName.maxLength);
  const notes = sanitizeString(input.notes, BLUEPRINT_CONSTRAINTS.description.maxLength);

  if (!orderNumber) return { valid: false, error: 'Production order number is required.' };
  if (!BLUEPRINT_CONSTRAINTS.code.pattern.test(orderNumber)) {
    return {
      valid: false,
      error: 'Order number may only contain uppercase letters, numbers, hyphens, and underscores.',
    };
  }
  if (!productId || !isValidDocumentId(productId)) {
    return { valid: false, error: 'Select a valid finished product.' };
  }
  const product = products.find((p) => p.id === productId);
  if (!product) return { valid: false, error: 'Selected finished product could not be found.' };

  if (!bomId || !isValidDocumentId(bomId)) {
    return { valid: false, error: 'Select a Bill of Materials (BOM) for this product.' };
  }
  const bom = boms.find((b) => b.id === bomId && b.productId === product.id);
  if (!bom) {
    return { valid: false, error: 'Selected BOM does not belong to the chosen product.' };
  }
  const scopedItems = bomItems.filter((item) => item.bomId === bom.id);
  if (scopedItems.length === 0) {
    return { valid: false, error: `BOM ${bom.bomCode} has zero raw material items.` };
  }

  if (!Number.isFinite(plannedQuantity) || plannedQuantity <= 0 || plannedQuantity > 100000000) {
    return { valid: false, error: 'Planned production quantity must be greater than 0.' };
  }
  if (!DATE_PATTERN.test(productionDate)) {
    return { valid: false, error: 'Production date must be in YYYY-MM-DD format.' };
  }
  if (!supervisorUid || !isValidDocumentId(supervisorUid) || !supervisorName) {
    return { valid: false, error: 'Assign a production supervisor.' };
  }

  const roundedQty = roundQuantity(plannedQuantity);
  const calc = calculateBomRequirementsForProduction(bom, scopedItems, roundedQty, materials);
  if (!calc.allAvailable) {
    const firstShort = calc.requirements.find((r) => !r.sufficient);
    return {
      valid: false,
      error: firstShort
        ? `Insufficient stock for ${firstShort.materialName} (${firstShort.materialCode}): need ${firstShort.expectedQuantity} ${firstShort.unit}, available ${firstShort.availableStock} ${firstShort.unit}.`
        : 'Required raw materials are unavailable.',
    };
  }

  return {
    valid: true,
    sanitized: {
      orderNumber,
      productId: product.id,
      productName: sanitizeString(product.name, BLUEPRINT_CONSTRAINTS.masterName.maxLength),
      productSku: sanitizeString(product.sku.toUpperCase(), BLUEPRINT_CONSTRAINTS.code.maxLength),
      packetSize: sanitizeString(product.packetSize, BLUEPRINT_CONSTRAINTS.packetSize.maxLength),
      bomId: bom.id,
      bomCode: sanitizeString(bom.bomCode.toUpperCase(), BLUEPRINT_CONSTRAINTS.code.maxLength),
      bomVersion: bom.version,
      bomBatchSize: bom.batchSize,
      plannedQuantity: roundedQty,
      expectedQuantity: roundedQty,
      productionDate,
      supervisorUid,
      supervisorName,
      notes,
      requirements: calc.requirements,
    },
  };
}

export interface ProductionConsumptionDraft {
  id: string;
  actualConsumedQuantity: string;
  damagedMaterialQuantity: string;
}

export interface ProductionCompletionInput {
  actualGoodQuantity: string;
  damagedQuantity: string;
  notes: string;
  consumptions: ProductionConsumptionDraft[];
}

export interface SanitizedCompletionLine {
  id: string;
  rawMaterialId: string;
  materialName: string;
  materialCode: string;
  unit: MaterialUnit;
  expectedQuantity: number;
  issuedQuantity: number;
  actualConsumedQuantity: number;
  damagedMaterialQuantity: number;
  varianceQuantity: number;
  deltaFromIssued: number;
  unitCost: number;
}

export interface SanitizedProductionCompletion {
  actualGoodQuantity: number;
  damagedQuantity: number;
  notes: string;
  yieldVarianceQty: number;
  yieldVariancePercent: number;
  expectedMaterialCost: number;
  actualMaterialCost: number;
  materialCostVariance: number;
  damagedMaterialQty: number;
  lines: SanitizedCompletionLine[];
}

export function validateProductionCompletionInput(
  input: ProductionCompletionInput,
  expectedQuantity: number,
  consumptionRecords: ProductionConsumption[],
  materials: RawMaterial[],
): { valid: true; sanitized: SanitizedProductionCompletion } | { valid: false; error: string } {
  const actualGood = Number(input.actualGoodQuantity);
  const damagedPackets = Number(input.damagedQuantity);
  const notes = sanitizeString(input.notes, BLUEPRINT_CONSTRAINTS.description.maxLength);

  if (!Number.isFinite(actualGood) || actualGood < 0 || actualGood > 100000000) {
    return { valid: false, error: 'Actual good packets produced must be 0 or greater.' };
  }
  if (!Number.isFinite(damagedPackets) || damagedPackets < 0 || damagedPackets > 100000000) {
    return { valid: false, error: 'Damaged / rejected packets must be 0 or greater.' };
  }
  if (actualGood === 0 && damagedPackets === 0) {
    return {
      valid: false,
      error: 'Enter actual good packets or damaged packets produced before completing the batch.',
    };
  }
  if (expectedQuantity <= 0) {
    return { valid: false, error: 'Expected production quantity must be greater than 0.' };
  }

  const draftById = new Map(input.consumptions.map((c) => [c.id, c]));
  const materialMap = new Map(materials.map((m) => [m.id, m]));
  const lines: SanitizedCompletionLine[] = [];

  let expectedMaterialCost = 0;
  let actualMaterialCost = 0;
  let damagedMaterialQty = 0;

  for (const rec of consumptionRecords) {
    const draft = draftById.get(rec.id);
    if (!draft) {
      return { valid: false, error: `Missing consumption input for ${rec.materialName}.` };
    }
    const actualConsumed = Number(draft.actualConsumedQuantity);
    const damagedMat = Number(draft.damagedMaterialQuantity);

    if (!Number.isFinite(actualConsumed) || actualConsumed < 0 || actualConsumed > 100000000) {
      return {
        valid: false,
        error: `${rec.materialName}: Actual consumed quantity must be 0 or greater.`,
      };
    }
    if (!Number.isFinite(damagedMat) || damagedMat < 0 || damagedMat > 100000000) {
      return {
        valid: false,
        error: `${rec.materialName}: Damaged material quantity must be 0 or greater.`,
      };
    }

    const cleanActual = roundQuantity(actualConsumed);
    const cleanDamaged = roundQuantity(damagedMat);
    const deltaFromIssued = roundQuantity(cleanActual - rec.issuedQuantity);

    if (deltaFromIssued > 0) {
      const mat = materialMap.get(rec.rawMaterialId);
      const avail = roundQuantity(mat?.currentStock ?? 0);
      if (avail < deltaFromIssued) {
        return {
          valid: false,
          error: `${rec.materialName}: Extra consumption (${deltaFromIssued} ${rec.unit}) exceeds available stock (${avail} ${rec.unit}).`,
        };
      }
    }

    const varianceQuantity = roundQuantity(cleanActual - rec.expectedQuantity);
    expectedMaterialCost += rec.expectedQuantity * rec.unitCost;
    actualMaterialCost += cleanActual * rec.unitCost;
    damagedMaterialQty += cleanDamaged;

    lines.push({
      id: rec.id,
      rawMaterialId: rec.rawMaterialId,
      materialName: rec.materialName,
      materialCode: rec.materialCode,
      unit: rec.unit,
      expectedQuantity: rec.expectedQuantity,
      issuedQuantity: rec.issuedQuantity,
      actualConsumedQuantity: cleanActual,
      damagedMaterialQuantity: cleanDamaged,
      varianceQuantity,
      deltaFromIssued,
      unitCost: rec.unitCost,
    });
  }

  const roundedGood = roundQuantity(actualGood);
  const roundedDamaged = roundQuantity(damagedPackets);
  const yieldVarianceQty = roundQuantity(roundedGood - expectedQuantity);
  const yieldVariancePercent = roundCurrency((yieldVarianceQty / expectedQuantity) * 100);
  const roundedExpCost = roundCurrency(expectedMaterialCost);
  const roundedActCost = roundCurrency(actualMaterialCost);
  const materialCostVariance = roundCurrency(roundedActCost - roundedExpCost);

  return {
    valid: true,
    sanitized: {
      actualGoodQuantity: roundedGood,
      damagedQuantity: roundedDamaged,
      notes,
      yieldVarianceQty,
      yieldVariancePercent,
      expectedMaterialCost: roundedExpCost,
      actualMaterialCost: roundedActCost,
      materialCostVariance,
      damagedMaterialQty: roundQuantity(damagedMaterialQty),
      lines,
    },
  };
}

export interface StockAdjustmentInput {
  direction: 'In' | 'Out';
  quantity: string;
  transactionDate: string;
  referenceDoc: string;
  reason: string;
}

export function validateStockAdjustmentInput(
  input: StockAdjustmentInput,
  currentBalance: number,
):
  | {
      valid: true;
      sanitized: {
        direction: 'In' | 'Out';
        quantity: number;
        newBalance: number;
        transactionDate: string;
        referenceDoc: string;
        reason: string;
      };
    }
  | { valid: false; error: string } {
  const qty = Number(input.quantity);
  const transactionDate = input.transactionDate.trim();
  const referenceDoc = sanitizeString(input.referenceDoc.toUpperCase(), 60);
  const reason = sanitizeString(input.reason, 300);

  if (!Number.isFinite(qty) || qty <= 0 || qty > 100000000) {
    return { valid: false, error: 'Adjustment quantity must be greater than 0.' };
  }
  if (!DATE_PATTERN.test(transactionDate)) {
    return { valid: false, error: 'Transaction date must be in YYYY-MM-DD format.' };
  }
  if (!referenceDoc) {
    return { valid: false, error: 'Reference document number is required (e.g., ADJ-2026-001).' };
  }
  if (!reason) {
    return { valid: false, error: 'Adjustment reason is required for audit trail compliance.' };
  }

  const cleanQty = roundQuantity(qty);
  const newBalance =
    input.direction === 'In'
      ? roundQuantity(currentBalance + cleanQty)
      : roundQuantity(currentBalance - cleanQty);

  if (newBalance < 0) {
    return {
      valid: false,
      error: `Cannot reduce stock below zero (available balance: ${currentBalance}, requested out: ${cleanQty}).`,
    };
  }

  return {
    valid: true,
    sanitized: {
      direction: input.direction,
      quantity: cleanQty,
      newBalance,
      transactionDate,
      referenceDoc,
      reason,
    },
  };
}

export const DEFAULT_FACTORY_SETTINGS = {
  factoryName: 'SnackFactory Foods Pvt. Ltd.',
  factoryAddress: 'Plot 14, SIDCO Industrial Estate, Coimbatore, Tamil Nadu - 641021',
  factoryState: 'Tamil Nadu',
  factoryStateCode: '33',
  factoryGstin: '',
  invoicePrefix: 'SF-INV-',
  nextInvoiceSeq: 1,
  defaultHsnCode: '21069099',
} as const;

export function isIntraStateSupply(
  customerState: string,
  customerStateCode: string,
  factoryState: string = DEFAULT_FACTORY_SETTINGS.factoryState,
  factoryStateCode: string = DEFAULT_FACTORY_SETTINGS.factoryStateCode,
): boolean {
  const cCode = customerStateCode.trim();
  const fCode = factoryStateCode.trim();
  if (cCode && fCode) {
    return cCode === fCode;
  }
  return customerState.trim().toLowerCase() === factoryState.trim().toLowerCase();
}

export function computeLineTaxBreakdown(
  quantity: number,
  rate: number,
  gstPercentage: number,
  isIntraState: boolean,
): {
  lineSubtotal: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  lineGst: number;
  lineTotal: number;
} {
  const lineSubtotal = roundCurrency(quantity * rate);
  const lineGst = roundCurrency((lineSubtotal * gstPercentage) / 100);
  if (isIntraState) {
    const cgstAmount = roundCurrency(lineGst / 2);
    const sgstAmount = roundCurrency(lineGst - cgstAmount);
    return {
      lineSubtotal,
      cgstAmount,
      sgstAmount,
      igstAmount: 0,
      lineGst,
      lineTotal: roundCurrency(lineSubtotal + lineGst),
    };
  }
  return {
    lineSubtotal,
    cgstAmount: 0,
    sgstAmount: 0,
    igstAmount: lineGst,
    lineGst,
    lineTotal: roundCurrency(lineSubtotal + lineGst),
  };
}

export interface FactorySettingsInput {
  factoryName: string;
  factoryAddress: string;
  factoryState: string;
  factoryStateCode: string;
  factoryGstin: string;
  invoicePrefix: string;
  nextInvoiceSeq: string;
  defaultHsnCode: string;
}

export interface SanitizedFactorySettings {
  factoryName: string;
  factoryAddress: string;
  factoryState: string;
  factoryStateCode: string;
  factoryGstin: string;
  invoicePrefix: string;
  nextInvoiceSeq: number;
  defaultHsnCode: string;
}

export function validateFactorySettingsInput(
  input: FactorySettingsInput,
): { valid: true; sanitized: SanitizedFactorySettings } | { valid: false; error: string } {
  const factoryName = sanitizeString(input.factoryName, BLUEPRINT_CONSTRAINTS.masterName.maxLength);
  const factoryAddress = sanitizeString(input.factoryAddress, BLUEPRINT_CONSTRAINTS.address.maxLength);
  const factoryState = sanitizeString(input.factoryState, BLUEPRINT_CONSTRAINTS.state.maxLength);
  const factoryStateCode = sanitizeString(input.factoryStateCode, BLUEPRINT_CONSTRAINTS.stateCode.maxLength);
  const factoryGstin = sanitizeString(input.factoryGstin.toUpperCase(), 15);
  const invoicePrefix = sanitizeString(input.invoicePrefix.toUpperCase(), 20);
  const nextInvoiceSeq = Math.trunc(Number(input.nextInvoiceSeq));
  const defaultHsnCode = sanitizeString(input.defaultHsnCode.toUpperCase(), 16);

  if (!factoryName) return { valid: false, error: 'Factory legal name is required.' };
  if (!factoryAddress) return { valid: false, error: 'Factory address is required.' };
  if (!factoryState) return { valid: false, error: 'Factory state is required.' };
  if (!factoryStateCode) return { valid: false, error: 'Factory state code is required (e.g., 33 for Tamil Nadu).' };
  if (factoryGstin && !BLUEPRINT_CONSTRAINTS.gstinPattern.test(factoryGstin)) {
    return {
      valid: false,
      error: 'Factory GSTIN must be a valid 15-character format (e.g., 33AABCS1429B1Z5) or blank.',
    };
  }
  if (!invoicePrefix || !BLUEPRINT_CONSTRAINTS.code.pattern.test(invoicePrefix)) {
    return {
      valid: false,
      error: 'Invoice prefix may only contain uppercase letters, numbers, hyphens, and underscores.',
    };
  }
  if (!Number.isInteger(nextInvoiceSeq) || nextInvoiceSeq < 1 || nextInvoiceSeq > 100000000) {
    return { valid: false, error: 'Next invoice sequence must be an integer >= 1.' };
  }
  if (!defaultHsnCode || !/^[0-9A-Za-z]+$/.test(defaultHsnCode)) {
    return { valid: false, error: 'Default HSN code must be alphanumeric (e.g., 21069099).' };
  }

  return {
    valid: true,
    sanitized: {
      factoryName,
      factoryAddress,
      factoryState,
      factoryStateCode,
      factoryGstin,
      invoicePrefix,
      nextInvoiceSeq,
      defaultHsnCode,
    },
  };
}

export interface SalesOrderLineDraft {
  productId: string;
  quantity: string;
  sellingPrice: string;
  gstPercentage: string;
  hsnCode: string;
}

export interface SalesOrderInput {
  orderNumber: string;
  customerId: string;
  orderDate: string;
  expectedDeliveryDate: string;
  salesmanUid: string;
  salesmanName?: string;
  status: 'Draft' | 'Pending Approval';
  notes: string;
  items: SalesOrderLineDraft[];
}

export interface SanitizedSalesOrderLine {
  productId: string;
  productName: string;
  productSku: string;
  packetSize: string;
  hsnCode: string;
  quantity: number;
  sellingPrice: number;
  gstPercentage: number;
  lineSubtotal: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  lineGst: number;
  lineTotal: number;
}

export interface SanitizedSalesOrder {
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
  status: 'Draft' | 'Pending Approval';
  itemCount: number;
  totalOrderedQty: number;
  taxType: TaxType;
  subtotal: number;
  cgstTotal: number;
  sgstTotal: number;
  igstTotal: number;
  gstTotal: number;
  grandTotal: number;
  notes: string;
  items: SanitizedSalesOrderLine[];
}

export function validateSalesOrderInput(
  input: SalesOrderInput,
  customers: Customer[],
  products: Product[],
  employees: ErpUser[],
  factorySettings: Pick<FactorySettings, 'factoryState' | 'factoryStateCode' | 'defaultHsnCode'>,
  callerUid: string,
  callerRole: ErpRole,
  callerName: string,
): { valid: true; sanitized: SanitizedSalesOrder } | { valid: false; error: string } {
  const orderNumber = sanitizeString(input.orderNumber.toUpperCase(), BLUEPRINT_CONSTRAINTS.code.maxLength);
  const customerId = input.customerId.trim();
  const orderDate = input.orderDate.trim();
  const expectedDeliveryDate = input.expectedDeliveryDate.trim();
  const notes = sanitizeString(input.notes, BLUEPRINT_CONSTRAINTS.description.maxLength);

  if (!orderNumber) return { valid: false, error: 'Sales order number is required.' };
  if (!BLUEPRINT_CONSTRAINTS.code.pattern.test(orderNumber)) {
    return {
      valid: false,
      error: 'Order number may only contain uppercase letters, numbers, hyphens, and underscores.',
    };
  }
  if (!customerId || !isValidDocumentId(customerId)) {
    return { valid: false, error: 'Please select a valid customer.' };
  }
  const customer = customers.find((c) => c.id === customerId);
  if (!customer) {
    return { valid: false, error: 'Selected customer could not be found.' };
  }
  if (!DATE_PATTERN.test(orderDate)) {
    return { valid: false, error: 'Order date must be in YYYY-MM-DD format.' };
  }
  if (!DATE_PATTERN.test(expectedDeliveryDate)) {
    return { valid: false, error: 'Expected delivery date must be in YYYY-MM-DD format.' };
  }
  if (expectedDeliveryDate < orderDate) {
    return { valid: false, error: 'Expected delivery date cannot be earlier than the order date.' };
  }
  if (input.status !== 'Draft' && input.status !== 'Pending Approval') {
    return { valid: false, error: 'New sales orders can only be saved as Draft or submitted for Pending Approval.' };
  }

  let salesmanUid = input.salesmanUid.trim() || callerUid;
  let salesmanName = sanitizeString(input.salesmanName ?? callerName, BLUEPRINT_CONSTRAINTS.displayName.maxLength);

  if (callerRole === 'Salesman') {
    salesmanUid = callerUid;
    salesmanName = sanitizeString(callerName, BLUEPRINT_CONSTRAINTS.displayName.maxLength);
  } else if (employees.length > 0) {
    const matched = employees.find((u) => u.uid === salesmanUid);
    if (matched) {
      salesmanName = sanitizeString(matched.displayName, BLUEPRINT_CONSTRAINTS.displayName.maxLength);
    }
  }

  if (!salesmanUid || !isValidDocumentId(salesmanUid) || !salesmanName) {
    return { valid: false, error: 'Assign a responsible salesman.' };
  }

  if (input.items.length === 0) {
    return { valid: false, error: 'Add at least one finished product line item.' };
  }
  if (input.items.length > 100) {
    return { valid: false, error: 'A sales order cannot exceed 100 line items.' };
  }

  const isIntraState = isIntraStateSupply(
    customer.state,
    customer.stateCode,
    factorySettings.factoryState,
    factorySettings.factoryStateCode,
  );
  const taxType: TaxType = isIntraState ? 'CGST_SGST' : 'IGST';

  const productMap = new Map(products.map((p) => [p.id, p]));
  const sanitizedItems: SanitizedSalesOrderLine[] = [];

  for (let i = 0; i < input.items.length; i += 1) {
    const row = input.items[i];
    const product = productMap.get(row.productId);
    if (!product || !isValidDocumentId(row.productId)) {
      return { valid: false, error: `Line ${i + 1}: Select a valid finished product.` };
    }
    const quantity = Number(row.quantity);
    const sellingPrice = Number(row.sellingPrice);
    const gstPercentage = Number(row.gstPercentage);
    const rawHsn = row.hsnCode.trim() || product.hsnCode || factorySettings.defaultHsnCode;
    const hsnCode = sanitizeString(rawHsn.toUpperCase(), 16);

    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 100000000) {
      return { valid: false, error: `Line ${i + 1} (${product.name}): Quantity must be greater than 0.` };
    }
    if (!Number.isFinite(sellingPrice) || sellingPrice < 0 || sellingPrice > 10000000) {
      return { valid: false, error: `Line ${i + 1} (${product.name}): Selling price must be 0 or greater.` };
    }
    if (!Number.isFinite(gstPercentage) || gstPercentage < 0 || gstPercentage > 28) {
      return { valid: false, error: `Line ${i + 1} (${product.name}): GST % must be between 0 and 28.` };
    }
    if (!hsnCode || !/^[0-9A-Za-z]+$/.test(hsnCode)) {
      return { valid: false, error: `Line ${i + 1} (${product.name}): Valid alphanumeric HSN code is required.` };
    }

    const q = roundQuantity(quantity);
    const rate = roundCurrency(sellingPrice);
    const gstRate = roundCurrency(gstPercentage);
    const taxes = computeLineTaxBreakdown(q, rate, gstRate, isIntraState);

    sanitizedItems.push({
      productId: product.id,
      productName: sanitizeString(product.name, BLUEPRINT_CONSTRAINTS.masterName.maxLength),
      productSku: sanitizeString(product.sku.toUpperCase(), BLUEPRINT_CONSTRAINTS.code.maxLength),
      packetSize: sanitizeString(product.packetSize, BLUEPRINT_CONSTRAINTS.packetSize.maxLength),
      hsnCode,
      quantity: q,
      sellingPrice: rate,
      gstPercentage: gstRate,
      lineSubtotal: taxes.lineSubtotal,
      cgstAmount: taxes.cgstAmount,
      sgstAmount: taxes.sgstAmount,
      igstAmount: taxes.igstAmount,
      lineGst: taxes.lineGst,
      lineTotal: taxes.lineTotal,
    });
  }

  const totalOrderedQty = roundQuantity(sanitizedItems.reduce((s, item) => s + item.quantity, 0));
  const subtotal = roundCurrency(sanitizedItems.reduce((s, item) => s + item.lineSubtotal, 0));
  const cgstTotal = roundCurrency(sanitizedItems.reduce((s, item) => s + item.cgstAmount, 0));
  const sgstTotal = roundCurrency(sanitizedItems.reduce((s, item) => s + item.sgstAmount, 0));
  const igstTotal = roundCurrency(sanitizedItems.reduce((s, item) => s + item.igstAmount, 0));
  const gstTotal = roundCurrency(cgstTotal + sgstTotal + igstTotal);
  const grandTotal = roundCurrency(subtotal + gstTotal);

  return {
    valid: true,
    sanitized: {
      orderNumber,
      customerId: customer.id,
      customerName: sanitizeString(customer.name, BLUEPRINT_CONSTRAINTS.masterName.maxLength),
      customerGstin: sanitizeString(customer.gstin.toUpperCase(), 15),
      customerAddress: sanitizeString(customer.billingAddress, BLUEPRINT_CONSTRAINTS.address.maxLength),
      customerState: sanitizeString(customer.state, BLUEPRINT_CONSTRAINTS.state.maxLength),
      customerStateCode: sanitizeString(customer.stateCode, BLUEPRINT_CONSTRAINTS.stateCode.maxLength),
      orderDate,
      expectedDeliveryDate,
      salesmanUid,
      salesmanName,
      status: input.status,
      itemCount: sanitizedItems.length,
      totalOrderedQty,
      taxType,
      subtotal,
      cgstTotal,
      sgstTotal,
      igstTotal,
      gstTotal,
      grandTotal,
      notes,
      items: sanitizedItems,
    },
  };
}

export function validateSalesOrderApproval(
  decision: 'Approved' | 'Rejected',
  remarks: string,
): { valid: true; decision: 'Approved' | 'Rejected'; remarks: string } | { valid: false; error: string } {
  const cleanRemarks = sanitizeString(remarks, 300);
  if (decision === 'Rejected' && !cleanRemarks) {
    return {
      valid: false,
      error: 'Please provide rejection remarks so the salesman understands what needs revision.',
    };
  }
  return { valid: true, decision, remarks: cleanRemarks };
}

export interface DispatchLineDraft {
  salesOrderItemId: string;
  dispatchQuantity: string;
}

export interface DispatchInput {
  dispatchNumber: string;
  dispatchDate: string;
  vehicleNumber: string;
  driverName: string;
  transporterName: string;
  ewayBillNumber: string;
  notes: string;
  confirmPartialAuthorization: boolean;
  lines: DispatchLineDraft[];
}

export interface DispatchLineCheck {
  salesOrderItemId: string;
  productId: string;
  productName: string;
  productSku: string;
  packetSize: string;
  orderedQuantity: number;
  alreadyDispatched: number;
  remainingQuantity: number;
  availableStock: number;
  requestedDispatch: number;
  shortage: number;
}

export interface SanitizedDispatch {
  dispatchNumber: string;
  dispatchDate: string;
  vehicleNumber: string;
  driverName: string;
  transporterName: string;
  ewayBillNumber: string;
  notes: string;
  isPartial: boolean;
  totalDispatchedQty: number;
  newOrderTotalDispatched: number;
  nextOrderStatus: 'Partially Dispatched' | 'Dispatched';
  lines: DispatchLineCheck[];
}

export function validateDispatchInput(
  input: DispatchInput,
  order: SalesOrder,
  orderItems: SalesOrderItem[],
  stockBalances: StockBalance[],
  canAuthorizePartial: boolean,
): { valid: true; sanitized: SanitizedDispatch } | { valid: false; error: string; shortages: DispatchLineCheck[] } {
  if (order.status !== 'Approved' && order.status !== 'Partially Dispatched') {
    return {
      valid: false,
      error: `Order ${order.orderNumber} is "${order.status}". Only Approved or Partially Dispatched orders can be dispatched.`,
      shortages: [],
    };
  }

  const dispatchNumber = sanitizeString(input.dispatchNumber.toUpperCase(), BLUEPRINT_CONSTRAINTS.code.maxLength);
  const dispatchDate = input.dispatchDate.trim();
  const vehicleNumber = sanitizeString(input.vehicleNumber.toUpperCase(), 40);
  const driverName = sanitizeString(input.driverName, 100);
  const transporterName = sanitizeString(input.transporterName, 120);
  const ewayBillNumber = sanitizeString(input.ewayBillNumber.toUpperCase(), 40);
  const notes = sanitizeString(input.notes, BLUEPRINT_CONSTRAINTS.description.maxLength);

  if (!dispatchNumber || !BLUEPRINT_CONSTRAINTS.code.pattern.test(dispatchNumber)) {
    return {
      valid: false,
      error: 'Dispatch number must use uppercase letters, numbers, hyphens, or underscores.',
      shortages: [],
    };
  }
  if (!DATE_PATTERN.test(dispatchDate)) {
    return { valid: false, error: 'Dispatch date must be in YYYY-MM-DD format.', shortages: [] };
  }
  if (!vehicleNumber) {
    return { valid: false, error: 'Vehicle registration number is required.', shortages: [] };
  }
  if (!driverName) {
    return { valid: false, error: 'Driver name is required.', shortages: [] };
  }

  const fgMap = new Map(
    stockBalances
      .filter((b) => b.stockCategory === 'finished_goods')
      .map((b) => [b.itemId, roundQuantity(b.currentBalance)]),
  );
  const draftMap = new Map(input.lines.map((l) => [l.salesOrderItemId, l]));

  const checks: DispatchLineCheck[] = [];
  const shortages: DispatchLineCheck[] = [];
  let totalDispatchNow = 0;
  let willLeaveUnshipped = false;

  for (const item of orderItems) {
    const remainingQuantity = roundQuantity(Math.max(0, item.quantity - item.dispatchedQuantity));
    const availableStock = fgMap.get(item.productId) ?? 0;
    const draft = draftMap.get(item.id);
    const rawQty = draft ? Number(draft.dispatchQuantity) : 0;

    if (!Number.isFinite(rawQty) || rawQty < 0 || rawQty > 100000000) {
      return {
        valid: false,
        error: `${item.productName}: Dispatch quantity must be 0 or greater.`,
        shortages: [],
      };
    }

    const requestedDispatch = roundQuantity(rawQty);
    if (requestedDispatch > remainingQuantity) {
      return {
        valid: false,
        error: `${item.productName}: Dispatch quantity (${requestedDispatch}) exceeds remaining order quantity (${remainingQuantity}).`,
        shortages: [],
      };
    }

    const shortage = roundQuantity(Math.max(0, requestedDispatch - availableStock));
    const check: DispatchLineCheck = {
      salesOrderItemId: item.id,
      productId: item.productId,
      productName: item.productName,
      productSku: item.productSku,
      packetSize: item.packetSize,
      orderedQuantity: item.quantity,
      alreadyDispatched: item.dispatchedQuantity,
      remainingQuantity,
      availableStock,
      requestedDispatch,
      shortage,
    };

    if (shortage > 0) {
      shortages.push(check);
    }
    if (requestedDispatch < remainingQuantity) {
      willLeaveUnshipped = true;
    }
    if (requestedDispatch > 0) {
      totalDispatchNow = roundQuantity(totalDispatchNow + requestedDispatch);
      checks.push(check);
    }
  }

  if (shortages.length > 0) {
    const summary = shortages
      .map((s) => `${s.productName} (short by ${s.shortage} pkts; available ${s.availableStock}, requested ${s.requestedDispatch})`)
      .join('; ');
    return {
      valid: false,
      error: `Dispatch blocked due to insufficient finished goods stock: ${summary}.`,
      shortages,
    };
  }

  if (checks.length === 0 || totalDispatchNow <= 0) {
    return {
      valid: false,
      error: 'Enter a dispatch quantity greater than 0 for at least one line item.',
      shortages: [],
    };
  }

  const isPartial = willLeaveUnshipped;
  if (isPartial && !canAuthorizePartial) {
    return {
      valid: false,
      error: 'Partial dispatch requires Owner or Admin authorization. Dispatch the full remaining quantity or request manager approval.',
      shortages: [],
    };
  }
  if (isPartial && !input.confirmPartialAuthorization) {
    return {
      valid: false,
      error: 'Confirm "Authorize Partial Dispatch" before shipping less than the full remaining order quantity.',
      shortages: [],
    };
  }

  const newOrderTotalDispatched = roundQuantity(order.totalDispatchedQty + totalDispatchNow);
  const nextOrderStatus: 'Partially Dispatched' | 'Dispatched' =
    newOrderTotalDispatched + 0.0001 >= order.totalOrderedQty ? 'Dispatched' : 'Partially Dispatched';

  return {
    valid: true,
    sanitized: {
      dispatchNumber,
      dispatchDate,
      vehicleNumber,
      driverName,
      transporterName,
      ewayBillNumber,
      notes,
      isPartial,
      totalDispatchedQty: totalDispatchNow,
      newOrderTotalDispatched:
        nextOrderStatus === 'Dispatched' ? order.totalOrderedQty : newOrderTotalDispatched,
      nextOrderStatus,
      lines: checks,
    },
  };
}

export interface CustomerPaymentInput {
  receiptNumber: string;
  paymentDate: string;
  amount: string;
  paymentMethod: PaymentMethod;
  referenceNumber: string;
  notes: string;
}

export interface SanitizedCustomerPayment {
  receiptNumber: string;
  paymentDate: string;
  amount: number;
  paymentMethod: PaymentMethod;
  referenceNumber: string;
  notes: string;
  newAmountPaid: number;
  newOutstandingBalance: number;
  newPaymentStatus: PaymentStatus;
}

export function validatePaymentInput(
  input: CustomerPaymentInput,
  invoice: Invoice,
): { valid: true; sanitized: SanitizedCustomerPayment } | { valid: false; error: string } {
  const receiptNumber = sanitizeString(input.receiptNumber.toUpperCase(), BLUEPRINT_CONSTRAINTS.code.maxLength);
  const paymentDate = input.paymentDate.trim();
  const amount = Number(input.amount);
  const referenceNumber = sanitizeString(input.referenceNumber, 80);
  const notes = sanitizeString(input.notes, 300);

  if (!receiptNumber || !BLUEPRINT_CONSTRAINTS.code.pattern.test(receiptNumber)) {
    return {
      valid: false,
      error: 'Receipt number may only contain uppercase letters, numbers, hyphens, and underscores.',
    };
  }
  if (!DATE_PATTERN.test(paymentDate)) {
    return { valid: false, error: 'Payment date must be in YYYY-MM-DD format.' };
  }
  if (invoice.outstandingBalance <= 0) {
    return { valid: false, error: `Invoice ${invoice.invoiceNumber} is already settled in full.` };
  }
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000000) {
    return { valid: false, error: 'Payment amount must be greater than ₹0.00.' };
  }

  const cleanAmount = roundCurrency(amount);
  if (cleanAmount > roundCurrency(invoice.outstandingBalance) + 0.005) {
    return {
      valid: false,
      error: `Payment (₹${cleanAmount.toFixed(2)}) exceeds the outstanding balance (₹${invoice.outstandingBalance.toFixed(2)}). Advance payments are not enabled.`,
    };
  }

  if (!(PAYMENT_METHODS as readonly string[]).includes(input.paymentMethod)) {
    return { valid: false, error: 'Select a valid payment method.' };
  }
  if (!referenceNumber) {
    return { valid: false, error: 'Payment reference / transaction ID is required.' };
  }

  const cappedAmount = Math.min(cleanAmount, invoice.outstandingBalance);
  const rawPaid = roundCurrency(invoice.amountPaid + cappedAmount);
  const rawOutstanding = roundCurrency(Math.max(0, invoice.grandTotal - rawPaid));
  const isSettled = rawOutstanding <= 0.009;

  return {
    valid: true,
    sanitized: {
      receiptNumber,
      paymentDate,
      amount: cappedAmount,
      paymentMethod: input.paymentMethod,
      referenceNumber,
      notes,
      newAmountPaid: isSettled ? invoice.grandTotal : rawPaid,
      newOutstandingBalance: isSettled ? 0 : rawOutstanding,
      newPaymentStatus: isSettled ? 'Paid' : 'Partially Paid',
    },
  };
}

export function findDuplicatePaymentConflict(
  existingPayments: Array<Pick<import('../types/erp').Payment, 'receiptNumber' | 'referenceNumber' | 'invoiceNumber'>>,
  receiptNumber: string,
  referenceNumber: string,
): string | null {
  const normReceipt = receiptNumber.trim().toUpperCase();
  const normRef = referenceNumber.trim().toUpperCase();

  const dupReceipt = existingPayments.find(
    (p) => p.receiptNumber.trim().toUpperCase() === normReceipt,
  );
  if (dupReceipt) {
    return `Receipt number "${normReceipt}" already exists (Invoice ${dupReceipt.invoiceNumber}). Duplicate payment records are blocked.`;
  }

  const dupRef = existingPayments.find(
    (p) => p.referenceNumber.trim().toUpperCase() === normRef,
  );
  if (dupRef) {
    return `Transaction reference "${referenceNumber.trim()}" is already recorded on Receipt ${dupRef.receiptNumber} (Invoice ${dupRef.invoiceNumber}). Enter a unique transaction reference.`;
  }

  return null;
}

export interface ProductionCostingInput {
  labourCost: string;
  gasElectricityCost: string;
  otherExpenses: string;
  notes: string;
}

export interface SanitizedProductionCosting {
  labourCost: number;
  gasElectricityCost: number;
  otherExpenses: number;
  notes: string;
}

export function validateProductionCostingInput(
  input: ProductionCostingInput,
): { valid: true; sanitized: SanitizedProductionCosting } | { valid: false; error: string } {
  const labourCost = Number(input.labourCost === '' ? '0' : input.labourCost);
  const gasElectricityCost = Number(input.gasElectricityCost === '' ? '0' : input.gasElectricityCost);
  const otherExpenses = Number(input.otherExpenses === '' ? '0' : input.otherExpenses);
  const notes = sanitizeString(input.notes, BLUEPRINT_CONSTRAINTS.description.maxLength);

  if (!Number.isFinite(labourCost) || labourCost < 0 || labourCost > 100000000) {
    return { valid: false, error: 'Labour cost must be ₹0.00 or greater.' };
  }
  if (!Number.isFinite(gasElectricityCost) || gasElectricityCost < 0 || gasElectricityCost > 100000000) {
    return { valid: false, error: 'Gas & electricity expense must be ₹0.00 or greater.' };
  }
  if (!Number.isFinite(otherExpenses) || otherExpenses < 0 || otherExpenses > 100000000) {
    return { valid: false, error: 'Other production expenses must be ₹0.00 or greater.' };
  }

  return {
    valid: true,
    sanitized: {
      labourCost: roundCurrency(labourCost),
      gasElectricityCost: roundCurrency(gasElectricityCost),
      otherExpenses: roundCurrency(otherExpenses),
      notes,
    },
  };
}




