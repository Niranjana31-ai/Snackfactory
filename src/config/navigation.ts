import type { ErpModuleDefinition, ErpRole, ModuleId, NavSectionId } from '../types/erp';

export const NAV_SECTIONS: readonly NavSectionId[] = [
  'Overview',
  'Master Data',
  'Procurement & Production',
  'Sales & Fulfillment',
  'Finance & Governance',
] as const;

export const ROLE_DESCRIPTIONS: Record<ErpRole, { summary: string; defaultDepartment: string }> = {
  Owner: {
    summary: 'Full enterprise control across manufacturing, commercial operations, audit reports, and role governance.',
    defaultDepartment: 'Executive & Operations',
  },
  Admin: {
    summary: 'System administration, master data governance, user provisioning, and operational oversight.',
    defaultDepartment: 'Systems & Administration',
  },
  Salesman: {
    summary: 'Customer accounts, product catalog lookup, sales order capture, dispatch tracking, and collections.',
    defaultDepartment: 'Sales & Distribution',
  },
  'Production Supervisor': {
    summary: 'Raw material planning, supplier receipts, BOM recipes, batch production runs, and stock movements.',
    defaultDepartment: 'Manufacturing & Floor',
  },
  'Accountant/Auditor': {
    summary: 'Order-to-audit reconciliation, unit costing variance, invoicing verification, payments, and compliance reports.',
    defaultDepartment: 'Finance & Audit',
  },
};

export const ERP_MODULES: readonly ErpModuleDefinition[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    section: 'Overview',
    description: 'Order-to-audit operational summary across procurement, production, fulfillment, and financial controls.',
    emptyStateTitle: 'Operational telemetry awaits live transactions',
    emptyStateDescription: 'No orders, batches, or ledger entries have been recorded yet.',
    columns: ['Stage', 'Module', 'Record Count', 'Status'],
    allowedRoles: ['Owner', 'Admin', 'Salesman', 'Production Supervisor', 'Accountant/Auditor'],
  },
  {
    id: 'products',
    label: 'Products',
    section: 'Master Data',
    description: 'Finished snack SKUs, pack configurations, shelf-life standards, and wholesale unit pricing.',
    emptyStateTitle: 'No finished snack products registered',
    emptyStateDescription: 'Add finished snack SKUs, HSN codes, GST slabs, and wholesale selling prices.',
    columns: ['SKU Code', 'Product Name', 'Category', 'Pack Size', 'Base Price', 'Status'],
    allowedRoles: ['Owner', 'Admin', 'Salesman', 'Production Supervisor', 'Accountant/Auditor'],
  },
  {
    id: 'customers',
    label: 'Customers',
    section: 'Master Data',
    description: 'Distributors, retail chains, credit limits, GST/tax identifiers, and delivery zones.',
    emptyStateTitle: 'No customer accounts added yet',
    emptyStateDescription: 'Register retailers and distributors with GSTIN and state tax classification.',
    columns: ['Account Code', 'Customer Name', 'Channel', 'Credit Limit', 'Payment Terms', 'Status'],
    allowedRoles: ['Owner', 'Admin', 'Salesman', 'Accountant/Auditor'],
  },
  {
    id: 'suppliers',
    label: 'Suppliers',
    section: 'Master Data',
    description: 'Approved raw material and packaging vendors, lead times, and quality compliance ratings.',
    emptyStateTitle: 'No approved suppliers registered',
    emptyStateDescription: 'Register raw material and packaging vendors with GSTIN and state details.',
    columns: ['Vendor Code', 'Supplier Name', 'Supply Category', 'Lead Time', 'Payment Terms', 'Status'],
    allowedRoles: ['Owner', 'Admin', 'Production Supervisor', 'Accountant/Auditor'],
  },
  {
    id: 'raw-materials',
    label: 'Raw Materials',
    section: 'Master Data',
    description: 'Ingredients, oils, seasonings, and flexible packaging films with reorder thresholds.',
    emptyStateTitle: 'No raw materials cataloged',
    emptyStateDescription: 'Define ingredients, packaging materials, opening stock, and reorder levels.',
    columns: ['Material Code', 'Material Name', 'Category', 'Unit of Measure', 'Reorder Point', 'Status'],
    allowedRoles: ['Owner', 'Admin', 'Production Supervisor'],
  },
  {
    id: 'purchases',
    label: 'Purchases',
    section: 'Procurement & Production',
    description: 'Supplier purchase orders, GST billing, payment tracking, and verified raw material receipts.',
    emptyStateTitle: 'No purchase orders issued',
    emptyStateDescription: 'Create supplier purchase orders and receive raw material stock.',
    columns: ['PO Number', 'Supplier', 'Date', 'Invoice No.', 'Total Amount', 'Status'],
    allowedRoles: ['Owner', 'Admin', 'Production Supervisor', 'Accountant/Auditor'],
  },
  {
    id: 'bom',
    label: 'Bill of Materials (BOM)',
    section: 'Master Data',
    description: 'Versioned snack recipes linking finished products to raw material quantities and estimated costs.',
    emptyStateTitle: 'No Bills of Materials defined',
    emptyStateDescription: 'Define product recipes, units, and estimated material costing.',
    columns: ['BOM Code', 'Finished Product', 'Version', 'Batch Yield', 'Est. Cost', 'Status'],
    allowedRoles: ['Owner', 'Admin', 'Production Supervisor', 'Accountant/Auditor'],
  },
  {
    id: 'production',
    label: 'Production',
    section: 'Procurement & Production',
    description: 'BOM-driven production plans, material availability checks, consumption tracking, and yield variance.',
    emptyStateTitle: 'No production orders scheduled',
    emptyStateDescription: 'Create a batch production order from an active BOM to reserve and consume raw materials.',
    columns: ['Order No.', 'Product / BOM', 'Date', 'Planned Qty', 'Good / Damaged', 'Status'],
    allowedRoles: ['Owner', 'Admin', 'Production Supervisor'],
  },
  {
    id: 'inventory',
    label: 'Inventory',
    section: 'Procurement & Production',
    description: 'Real-time stock balances across raw materials, WIP, finished goods, damaged stock, and audit ledger.',
    emptyStateTitle: 'No inventory balances recorded',
    emptyStateDescription: 'Stock movements from opening balances, purchases, production, and adjustments appear here.',
    columns: ['Item Code', 'Item Name', 'Category', 'Current Balance', 'Min Level', 'Alert'],
    allowedRoles: ['Owner', 'Admin', 'Salesman', 'Production Supervisor', 'Accountant/Auditor'],
  },
  {
    id: 'sales-orders',
    label: 'Sales Orders',
    section: 'Sales & Fulfillment',
    description: 'Customer sales orders, GST estimates, approval workflow, and fulfillment tracking.',
    emptyStateTitle: 'No sales orders placed',
    emptyStateDescription: 'Create customer sales orders and submit them for Owner/Admin approval.',
    columns: ['Order No.', 'Customer', 'Order Date', 'Expected Delivery', 'Order Total', 'Status'],
    allowedRoles: ['Owner', 'Admin', 'Salesman', 'Accountant/Auditor'],
  },
  {
    id: 'dispatch',
    label: 'Dispatch',
    section: 'Sales & Fulfillment',
    description: 'Approved order stock availability checks, vehicle manifests, partial dispatch controls, and FG deductions.',
    emptyStateTitle: 'No dispatches recorded',
    emptyStateDescription: 'Dispatch approved sales orders against available finished goods inventory.',
    columns: ['Dispatch No.', 'Sales Order', 'Customer', 'Vehicle / Driver', 'Dispatch Date', 'Type'],
    allowedRoles: ['Owner', 'Admin', 'Salesman', 'Production Supervisor'],
  },
  {
    id: 'invoices',
    label: 'Invoices',
    section: 'Sales & Fulfillment',
    description: 'GST tax invoices (CGST/SGST & IGST), configurable factory GST details, PDF downloads, and printing.',
    emptyStateTitle: 'No GST invoices generated',
    emptyStateDescription: 'Generate unique GST tax invoices from approved sales orders.',
    columns: ['Invoice No.', 'Sales Order', 'Customer', 'Invoice Date', 'Grand Total', 'Payment Status'],
    allowedRoles: ['Owner', 'Admin', 'Salesman', 'Accountant/Auditor'],
  },
  {
    id: 'payments',
    label: 'Payments',
    section: 'Sales & Fulfillment',
    description: 'Customer payment receipts linked to GST invoices with real-time outstanding balance reconciliation.',
    emptyStateTitle: 'No payment transactions posted',
    emptyStateDescription: 'Record customer payments against open GST invoices to track receivables.',
    columns: ['Receipt No.', 'Invoice No.', 'Customer', 'Method', 'Payment Date', 'Amount'],
    allowedRoles: ['Owner', 'Admin', 'Salesman', 'Accountant/Auditor'],
  },
  {
    id: 'costing',
    label: 'Costing',
    section: 'Finance & Governance',
    description: 'Weighted average material valuation, packaging, labour, utility overheads, batch cost comparison, and product margins.',
    emptyStateTitle: 'No production batches costed yet',
    emptyStateDescription: 'Complete production runs and record labour or utility expenses to analyze per-packet costing.',
    columns: ['Batch / Order', 'Product', 'Material + Pkg', 'Overheads', 'Cost / Pkt', 'Margin'],
    allowedRoles: ['Owner', 'Admin', 'Production Supervisor', 'Accountant/Auditor'],
  },
  {
    id: 'reports',
    label: 'Reports',
    section: 'Finance & Governance',
    description: 'Monthly financial & stock audit reports, 9-point automated anomaly validation, P&L summary, PDF & Excel exports.',
    emptyStateTitle: 'No audit records in selected period',
    emptyStateDescription: 'Select a month or date range to inspect operational registers, stock reconciliation, and compliance logs.',
    columns: ['Report Domain', 'Records', 'Period Total', 'Validation Status', 'PDF', 'Excel'],
    allowedRoles: ['Owner', 'Admin', 'Accountant/Auditor'],
  },
  {
    id: 'user-management',
    label: 'User Management',
    section: 'Finance & Governance',
    description: 'Manage ERP employee usernames, assign operational roles, and control account status.',
    emptyStateTitle: 'No operator accounts found',
    emptyStateDescription: 'Employee accounts created by Owner or Admin appear here.',
    columns: ['Operator', 'Username', 'Role', 'Department', 'Status', 'Last Login'],
    allowedRoles: ['Owner', 'Admin'],
  },
];

export function getModulesForRole(role: ErpRole): ErpModuleDefinition[] {
  return ERP_MODULES.filter((mod) => mod.allowedRoles.includes(role));
}

export function getModuleById(id: ModuleId): ErpModuleDefinition {
  return ERP_MODULES.find((mod) => mod.id === id) ?? ERP_MODULES[0];
}

export function isModuleAllowedForRole(id: ModuleId, role: ErpRole): boolean {
  const mod = getModuleById(id);
  return mod.allowedRoles.includes(role);
}
