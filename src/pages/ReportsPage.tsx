import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  BarChart3,
  Calendar,
  CheckCircle2,
  ClipboardList,
  Download,
  FileSpreadsheet,
  FileText,
  History,
  IndianRupee,
  Layers,
  Package,
  Search,
  ShieldAlert,
  ShieldCheck,
  ShoppingBag,
  TrendingUp,
  XCircle,
} from 'lucide-react';
import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import {
  buildMonthlyAuditDataset,
  runAuditValidations,
  type AuditValidationCheck,
} from '../lib/costingAndAudit';
import { exportAuditReportToExcel } from '../lib/excelExport';
import { db } from '../lib/firebase';
import { handleFirestoreError, OperationType } from '../lib/firestoreError';
import { downloadMonthlyAuditReportPdf } from '../lib/pdfGenerator';
import {
  ORG_ID,
  type AuditLogEntry,
  type Customer,
  type Dispatch,
  type DispatchItem,
  type InventoryLedgerEntry,
  type Invoice,
  type InvoiceItem,
  type Payment,
  type Product,
  type ProductionConsumption,
  type ProductionCosting,
  type ProductionOrder,
  type ProductionVariance,
  type Purchase,
  type PurchaseItem,
  type RawMaterial,
  type SalesOrder,
  type SalesOrderItem,
  type StockBalance,
  type Supplier,
} from '../types/erp';

type ReportsTab =
  | 'executive'
  | 'validations'
  | 'stock-manufacturing'
  | 'procurement-costing'
  | 'sales-receivables'
  | 'audit-trail';

type StockSectionFilter =
  | 'all'
  | 'opening-reconciliation'
  | 'rm-consumption'
  | 'production-output'
  | 'damaged-rejected'
  | 'finished-goods'
  | 'variance';

type SalesSectionFilter =
  | 'all'
  | 'sales-orders'
  | 'gst-invoices'
  | 'dispatches'
  | 'payments'
  | 'customer-balances'
  | 'product-summary';

function getMonthRange(yyyyMm: string): { fromDate: string; toDate: string } {
  const parts = yyyyMm.split('-');
  const year = Number(parts[0]) || new Date().getFullYear();
  const month = Number(parts[1]) || new Date().getMonth() + 1;
  const lastDay = new Date(year, month, 0).getDate();
  const mm = String(month).padStart(2, '0');
  const dd = String(lastDay).padStart(2, '0');
  return {
    fromDate: `${year}-${mm}-01`,
    toDate: `${year}-${mm}-${dd}`,
  };
}

function getCurrentMonthValue(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}`;
}

function formatInr(amount: number): string {
  return `₹${amount.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatQty(qty: number): string {
  return Number.isInteger(qty) ? String(qty) : qty.toFixed(2);
}

export function ReportsPage() {
  const { firebaseUser, userProfile, effectiveRole } = useAuth();
  const activeRole = effectiveRole ?? userProfile?.role ?? 'Salesman';
  const realRole = userProfile?.role ?? 'Salesman';

  const canViewReports =
    ['Owner', 'Admin', 'Accountant/Auditor'].includes(activeRole) &&
    ['Owner', 'Admin', 'Accountant/Auditor'].includes(realRole);

  const initialMonth = getCurrentMonthValue();
  const initialRange = getMonthRange(initialMonth);

  const [selectedMonth, setSelectedMonth] = useState(initialMonth);
  const [fromDate, setFromDate] = useState(initialRange.fromDate);
  const [toDate, setToDate] = useState(initialRange.toDate);
  const [activeTab, setActiveTab] = useState<ReportsTab>('executive');
  const [stockFilter, setStockFilter] = useState<StockSectionFilter>('all');
  const [salesFilter, setSalesFilter] = useState<SalesSectionFilter>('all');
  const [validationFilter, setValidationFilter] = useState<'ALL' | 'Fail' | 'Warning' | 'Pass'>('ALL');
  const [expandedChecks, setExpandedChecks] = useState<Record<string, boolean>>({});
  const [auditSearch, setAuditSearch] = useState('');
  const [auditModuleFilter, setAuditModuleFilter] = useState('ALL');
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  // Live ERP state
  const [rawMaterials, setRawMaterials] = useState<RawMaterial[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [purchaseItems, setPurchaseItems] = useState<PurchaseItem[]>([]);
  const [productionOrders, setProductionOrders] = useState<ProductionOrder[]>([]);
  const [productionConsumption, setProductionConsumption] = useState<ProductionConsumption[]>([]);
  const [productionVariances, setProductionVariances] = useState<ProductionVariance[]>([]);
  const [productionCostings, setProductionCostings] = useState<ProductionCosting[]>([]);
  const [stockBalances, setStockBalances] = useState<StockBalance[]>([]);
  const [inventoryLedger, setInventoryLedger] = useState<InventoryLedgerEntry[]>([]);
  const [salesOrders, setSalesOrders] = useState<SalesOrder[]>([]);
  const [salesOrderItems, setSalesOrderItems] = useState<SalesOrderItem[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [invoiceItems, setInvoiceItems] = useState<InvoiceItem[]>([]);
  const [dispatches, setDispatches] = useState<Dispatch[]>([]);
  const [dispatchItems, setDispatchItems] = useState<DispatchItem[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!firebaseUser || !canViewReports) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setLoadError(null);

    const orgQuery = (colName: string) =>
      query(collection(db, colName), where('orgId', '==', ORG_ID));

    const unsubs = [
      onSnapshot(
        orgQuery('rawMaterials'),
        (snap) => {
          setRawMaterials(snap.docs.map((d) => d.data() as RawMaterial));
          setLoading(false);
        },
        (err) => {
          setLoading(false);
          setLoadError('Unable to load ERP data for monthly audit reports.');
          handleFirestoreError(err, OperationType.LIST, 'rawMaterials');
        },
      ),
      onSnapshot(
        orgQuery('products'),
        (snap) => setProducts(snap.docs.map((d) => d.data() as Product)),
        (err) => handleFirestoreError(err, OperationType.LIST, 'products'),
      ),
      onSnapshot(
        orgQuery('customers'),
        (snap) => setCustomers(snap.docs.map((d) => d.data() as Customer)),
        (err) => handleFirestoreError(err, OperationType.LIST, 'customers'),
      ),
      onSnapshot(
        orgQuery('suppliers'),
        (snap) => setSuppliers(snap.docs.map((d) => d.data() as Supplier)),
        (err) => handleFirestoreError(err, OperationType.LIST, 'suppliers'),
      ),
      onSnapshot(
        orgQuery('purchases'),
        (snap) => setPurchases(snap.docs.map((d) => d.data() as Purchase)),
        (err) => handleFirestoreError(err, OperationType.LIST, 'purchases'),
      ),
      onSnapshot(
        orgQuery('purchaseItems'),
        (snap) => setPurchaseItems(snap.docs.map((d) => d.data() as PurchaseItem)),
        (err) => handleFirestoreError(err, OperationType.LIST, 'purchaseItems'),
      ),
      onSnapshot(
        orgQuery('productionOrders'),
        (snap) => setProductionOrders(snap.docs.map((d) => d.data() as ProductionOrder)),
        (err) => handleFirestoreError(err, OperationType.LIST, 'productionOrders'),
      ),
      onSnapshot(
        orgQuery('productionConsumption'),
        (snap) => setProductionConsumption(snap.docs.map((d) => d.data() as ProductionConsumption)),
        (err) => handleFirestoreError(err, OperationType.LIST, 'productionConsumption'),
      ),
      onSnapshot(
        orgQuery('productionVariances'),
        (snap) => setProductionVariances(snap.docs.map((d) => d.data() as ProductionVariance)),
        (err) => handleFirestoreError(err, OperationType.LIST, 'productionVariances'),
      ),
      onSnapshot(
        orgQuery('productionCostings'),
        (snap) => setProductionCostings(snap.docs.map((d) => d.data() as ProductionCosting)),
        (err) => handleFirestoreError(err, OperationType.LIST, 'productionCostings'),
      ),
      onSnapshot(
        orgQuery('stockBalances'),
        (snap) => setStockBalances(snap.docs.map((d) => d.data() as StockBalance)),
        (err) => handleFirestoreError(err, OperationType.LIST, 'stockBalances'),
      ),
      onSnapshot(
        orgQuery('inventoryLedger'),
        (snap) => setInventoryLedger(snap.docs.map((d) => d.data() as InventoryLedgerEntry)),
        (err) => handleFirestoreError(err, OperationType.LIST, 'inventoryLedger'),
      ),
      onSnapshot(
        orgQuery('salesOrders'),
        (snap) => setSalesOrders(snap.docs.map((d) => d.data() as SalesOrder)),
        (err) => handleFirestoreError(err, OperationType.LIST, 'salesOrders'),
      ),
      onSnapshot(
        orgQuery('salesOrderItems'),
        (snap) => setSalesOrderItems(snap.docs.map((d) => d.data() as SalesOrderItem)),
        (err) => handleFirestoreError(err, OperationType.LIST, 'salesOrderItems'),
      ),
      onSnapshot(
        orgQuery('invoices'),
        (snap) => setInvoices(snap.docs.map((d) => d.data() as Invoice)),
        (err) => handleFirestoreError(err, OperationType.LIST, 'invoices'),
      ),
      onSnapshot(
        orgQuery('invoiceItems'),
        (snap) => setInvoiceItems(snap.docs.map((d) => d.data() as InvoiceItem)),
        (err) => handleFirestoreError(err, OperationType.LIST, 'invoiceItems'),
      ),
      onSnapshot(
        orgQuery('dispatches'),
        (snap) => setDispatches(snap.docs.map((d) => d.data() as Dispatch)),
        (err) => handleFirestoreError(err, OperationType.LIST, 'dispatches'),
      ),
      onSnapshot(
        orgQuery('dispatchItems'),
        (snap) => setDispatchItems(snap.docs.map((d) => d.data() as DispatchItem)),
        (err) => handleFirestoreError(err, OperationType.LIST, 'dispatchItems'),
      ),
      onSnapshot(
        orgQuery('payments'),
        (snap) => setPayments(snap.docs.map((d) => d.data() as Payment)),
        (err) => handleFirestoreError(err, OperationType.LIST, 'payments'),
      ),
      onSnapshot(
        orgQuery('auditLogs'),
        (snap) => {
          const list = snap.docs.map((d) => d.data() as AuditLogEntry);
          list.sort((a, b) => {
            const ta = a.createdAt ? a.createdAt.toMillis() : 0;
            const tb = b.createdAt ? b.createdAt.toMillis() : 0;
            return tb - ta;
          });
          setAuditLogs(list);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'auditLogs'),
      ),
    ];

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [firebaseUser, canViewReports]);

  const effectiveFrom = fromDate <= toDate ? fromDate : toDate;
  const effectiveTo = fromDate <= toDate ? toDate : fromDate;

  const dataset = useMemo(
    () =>
      buildMonthlyAuditDataset({
        fromDate: effectiveFrom,
        toDate: effectiveTo,
        rawMaterials,
        products,
        customers,
        purchases,
        purchaseItems,
        productionOrders,
        productionConsumption,
        productionVariances,
        productionCostings,
        stockBalances,
        inventoryLedger,
        salesOrders,
        salesOrderItems,
        invoices,
        invoiceItems,
        dispatches,
        payments,
      }),
    [
      effectiveFrom,
      effectiveTo,
      rawMaterials,
      products,
      customers,
      purchases,
      purchaseItems,
      productionOrders,
      productionConsumption,
      productionVariances,
      productionCostings,
      stockBalances,
      inventoryLedger,
      salesOrders,
      salesOrderItems,
      invoices,
      invoiceItems,
      dispatches,
      payments,
    ],
  );

  const validations = useMemo(
    () =>
      runAuditValidations({
        rawMaterials,
        suppliers,
        purchases,
        purchaseItems,
        productionOrders,
        productionConsumption,
        productionVariances,
        stockBalances,
        inventoryLedger,
        salesOrders,
        salesOrderItems,
        invoices,
        dispatches,
        dispatchItems,
        payments,
      }),
    [
      rawMaterials,
      suppliers,
      purchases,
      purchaseItems,
      productionOrders,
      productionConsumption,
      productionVariances,
      stockBalances,
      inventoryLedger,
      salesOrders,
      salesOrderItems,
      invoices,
      dispatches,
      dispatchItems,
      payments,
    ],
  );

  const validationCounts = useMemo(() => {
    const pass = validations.filter((v) => v.status === 'Pass').length;
    const warning = validations.filter((v) => v.status === 'Warning').length;
    const fail = validations.filter((v) => v.status === 'Fail').length;
    const totalIssues = validations.reduce((s, v) => s + v.affectedCount, 0);
    return { pass, warning, fail, totalIssues };
  }, [validations]);

  const filteredValidations = useMemo(() => {
    if (validationFilter === 'ALL') return validations;
    return validations.filter((v) => v.status === validationFilter);
  }, [validations, validationFilter]);

  const auditModules = useMemo(() => {
    const set = new Set<string>();
    auditLogs.forEach((l) => set.add(l.module));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [auditLogs]);

  const filteredAuditLogs = useMemo(() => {
    const q = auditSearch.trim().toLowerCase();
    return auditLogs.filter((l) => {
      if (auditModuleFilter !== 'ALL' && l.module !== auditModuleFilter) return false;
      if (!q) return true;
      return (
        l.action.toLowerCase().includes(q) ||
        l.module.toLowerCase().includes(q) ||
        l.recordLabel.toLowerCase().includes(q) ||
        l.details.toLowerCase().includes(q) ||
        l.userName.toLowerCase().includes(q)
      );
    });
  }, [auditLogs, auditSearch, auditModuleFilter]);

  const handleMonthChange = (val: string) => {
    setSelectedMonth(val);
    if (/^\d{4}-\d{2}$/.test(val)) {
      const range = getMonthRange(val);
      setFromDate(range.fromDate);
      setToDate(range.toDate);
    }
  };

  const logReportExport = async (format: 'PDF' | 'EXCEL') => {
    if (!firebaseUser || !userProfile || !canViewReports) return;
    try {
      const auditRef = doc(collection(db, 'auditLogs'));
      const label = `${format} Audit (${effectiveFrom} to ${effectiveTo})`.slice(0, 120);
      const details = `Exported Monthly Audit Report (${format}) for ${effectiveFrom} to ${effectiveTo}. Validations: ${validationCounts.pass} Pass, ${validationCounts.warning} Warning, ${validationCounts.fail} Fail.`.slice(
        0,
        500,
      );
      await setDoc(auditRef, {
        id: auditRef.id,
        orgId: ORG_ID,
        action: 'AUDIT_REPORT_EXPORTED',
        module: 'Monthly Audit Reports',
        recordId: `${effectiveFrom}_${effectiveTo}`,
        recordLabel: label,
        details,
        userUid: firebaseUser.uid,
        userName: userProfile.displayName,
        userRole: realRole,
        createdAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'auditLogs');
    }
  };

  const handleDownloadPdf = async () => {
    setExportError(null);
    try {
      downloadMonthlyAuditReportPdf(dataset, validations);
      setExportStatus(`Downloaded PDF audit report for ${effectiveFrom} to ${effectiveTo}.`);
      await logReportExport('PDF');
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Failed to generate PDF report.');
    }
  };

  const handleExportExcel = async () => {
    setExportError(null);
    try {
      exportAuditReportToExcel(dataset, validations, auditLogs);
      setExportStatus(`Exported 12-sheet Excel workbook for ${effectiveFrom} to ${effectiveTo}.`);
      await logReportExport('EXCEL');
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Failed to generate Excel workbook.');
    }
  };

  const jumpToReportSection = (
    tab: ReportsTab,
    subSection?: StockSectionFilter | SalesSectionFilter,
  ) => {
    setActiveTab(tab);
    if (tab === 'stock-manufacturing' && subSection) {
      setStockFilter(subSection as StockSectionFilter);
    }
    if (tab === 'sales-receivables' && subSection) {
      setSalesFilter(subSection as SalesSectionFilter);
    }
  };

  if (!canViewReports) {
    return (
      <div className="bg-white border border-[#DCE6E6] rounded-xl p-8 text-center">
        <ShieldAlert className="w-10 h-10 text-red-500 mx-auto mb-3" />
        <h2 className="text-lg font-semibold text-[#3B4F4E]">Restricted Audit &amp; Finance View</h2>
        <p className="mt-1 text-sm text-slate-600 max-w-md mx-auto">
          Monthly Audit Reports and Financial Reconciliation are restricted to Owner, Admin, and Accountant/Auditor accounts.
        </p>
      </div>
    );
  }

  const pnl = dataset.profitAndLoss;

  const toggleCheckExpand = (id: string) => {
    setExpandedChecks((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="space-y-6">
      {/* Header + Export Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-[#3B4F4E]">Finance &amp; Governance</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#3B4F4E]">
            Monthly Audit Reports &amp; Control Validation
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            End-to-end period reconciliation covering all 14 operational registers, P&amp;L, automated 9-rule audit checks, and PDF/Excel export.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => void handleDownloadPdf()}
            disabled={loading}
            className="min-h-[40px] inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 border border-[#DCE6E6] rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            <Download className="w-4 h-4" />
            Download PDF Report
          </button>
          <button
            type="button"
            onClick={() => void handleExportExcel()}
            disabled={loading}
            className="min-h-[40px] inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            <FileSpreadsheet className="w-4 h-4" />
            Export Excel (.xlsx)
          </button>
        </div>
      </div>

      {/* Period Picker */}
      <div className="bg-white border border-[#DCE6E6] rounded-xl p-4 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Quick Month Preset
            </label>
            <div className="relative">
              <Calendar className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="month"
                value={selectedMonth}
                onChange={(e) => handleMonthChange(e.target.value)}
                className="pl-9 pr-3 py-2 text-sm bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              From Date
            </label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="px-3 py-2 text-sm bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              To Date
            </label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="px-3 py-2 text-sm bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="px-2.5 py-1 rounded-md bg-slate-100 text-slate-700 font-medium">
            Window: {effectiveFrom} → {effectiveTo}
          </span>
          <span
            className={`px-2.5 py-1 rounded-md font-medium ${
              validationCounts.fail > 0
                ? 'bg-red-50 text-red-700 border border-red-200'
                : validationCounts.warning > 0
                  ? 'bg-amber-50 text-amber-700 border border-amber-200'
                  : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
            }`}
          >
            Audit Health: {validationCounts.pass}/9 Pass
            {validationCounts.fail > 0 ? ` · ${validationCounts.fail} Fail` : ''}
            {validationCounts.warning > 0 ? ` · ${validationCounts.warning} Warn` : ''}
          </span>
        </div>
      </div>

      {exportStatus && (
        <div className="flex items-center justify-between gap-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl px-4 py-3 text-sm">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{exportStatus}</span>
          </div>
          <button
            type="button"
            onClick={() => setExportStatus(null)}
            className="text-xs font-medium underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {(loadError || exportError) && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{loadError ?? exportError}</span>
        </div>
      )}

      {/* Top KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-[#DCE6E6] rounded-xl p-4">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Sales Revenue (Excl. GST)</span>
            <IndianRupee className="w-4 h-4 text-[#3B4F4E]" />
          </div>
          <p className="mt-2 text-2xl font-semibold text-[#3B4F4E]">
            {formatInr(pnl.salesRevenueExclGst)}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Incl. GST: {formatInr(pnl.grossSalesInclGst)} ({dataset.invoicesInPeriod.length} invoices)
          </p>
        </div>

        <div className="bg-white border border-[#DCE6E6] rounded-xl p-4">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Total Production Cost</span>
            <Package className="w-4 h-4 text-slate-600" />
          </div>
          <p className="mt-2 text-2xl font-semibold text-[#3B4F4E]">
            {formatInr(pnl.totalProductionCost)}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Materials {formatInr(pnl.rawMaterialConsumedCost + pnl.packagingConsumedCost)} + Overheads{' '}
            {formatInr(pnl.labourExpenses + pnl.gasElectricityExpenses + pnl.otherProductionExpenses)}
          </p>
        </div>

        <div className="bg-white border border-[#DCE6E6] rounded-xl p-4">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Gross Mfg Profit</span>
            <TrendingUp
              className={`w-4 h-4 ${
                pnl.grossManufacturingProfit >= 0 ? 'text-emerald-600' : 'text-red-600'
              }`}
            />
          </div>
          <p
            className={`mt-2 text-2xl font-semibold ${
              pnl.grossManufacturingProfit >= 0 ? 'text-emerald-700' : 'text-red-700'
            }`}
          >
            {formatInr(pnl.grossManufacturingProfit)}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Margin:{' '}
            {pnl.grossMarginPercent !== null ? `${pnl.grossMarginPercent.toFixed(2)}%` : 'N/A (no sales)'}
          </p>
        </div>

        <div className="bg-white border border-[#DCE6E6] rounded-xl p-4">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Collections &amp; Receivables</span>
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
          </div>
          <p className="mt-2 text-2xl font-semibold text-[#3B4F4E]">
            {formatInr(pnl.cashCollectedInPeriod)}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            All-time receivables due: {formatInr(pnl.totalOutstandingReceivables)}
          </p>
        </div>
      </div>

      {/* Main Navigation Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-[#DCE6E6] pb-3">
        {[
          { id: 'executive' as const, label: 'Executive P&L & 14-Report Index', icon: BarChart3 },
          {
            id: 'validations' as const,
            label: `9-Rule Audit Validations (${validationCounts.fail + validationCounts.warning} flags)`,
            icon: ShieldCheck,
          },
          { id: 'stock-manufacturing' as const, label: 'Stock, Production & Variance', icon: Layers },
          { id: 'procurement-costing' as const, label: 'Purchases, Expenses & Costing', icon: ClipboardList },
          { id: 'sales-receivables' as const, label: 'Sales, GST, Dispatch & Receivables', icon: ShoppingBag },
          { id: 'audit-trail' as const, label: `Audit Trail (${auditLogs.length})`, icon: History },
        ].map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
                active
                  ? 'bg-[#0B162C] text-white'
                  : 'bg-white text-slate-600 border border-[#DCE6E6] hover:bg-slate-50'
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* TAB 1: EXECUTIVE SUMMARY, P&L & 14-REPORT INDEX */}
      {activeTab === 'executive' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Profit & Loss Statement */}
            <div className="bg-white border border-[#DCE6E6] rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-[#DCE6E6] flex items-center justify-between">
                <div>
                  <h2 className="text-base font-semibold text-[#3B4F4E]">
                    14. Profit &amp; Loss Summary ({effectiveFrom} to {effectiveTo})
                  </h2>
                  <p className="text-xs text-slate-500">
                    Computed strictly from verified Firestore invoices, WAC consumption, and recorded overheads.
                  </p>
                </div>
              </div>
              <div className="divide-y divide-slate-100 text-sm">
                {[
                  { label: 'Sales Revenue (Excl. GST)', val: formatInr(pnl.salesRevenueExclGst), bold: true },
                  { label: 'Output GST Collected (CGST + SGST + IGST)', val: formatInr(pnl.gstCollected) },
                  { label: 'Gross Sales Billed (Incl. GST)', val: formatInr(pnl.grossSalesInclGst) },
                  { label: 'Raw Material Consumed Cost (WAC)', val: formatInr(pnl.rawMaterialConsumedCost) },
                  { label: 'Packaging Material Consumed Cost (WAC)', val: formatInr(pnl.packagingConsumedCost) },
                  { label: 'Batch Labour Expenses', val: formatInr(pnl.labourExpenses) },
                  { label: 'Gas & Electricity Expenses', val: formatInr(pnl.gasElectricityExpenses) },
                  { label: 'Other Production Expenses', val: formatInr(pnl.otherProductionExpenses) },
                  { label: 'Total Production / COGS Cost', val: formatInr(pnl.totalProductionCost), bold: true },
                  {
                    label: 'Gross Manufacturing Profit (Sales Excl. GST − Total Cost)',
                    val: formatInr(pnl.grossManufacturingProfit),
                    bold: true,
                    highlight: pnl.grossManufacturingProfit >= 0 ? 'emerald' : 'red',
                  },
                  {
                    label: 'Gross Profit Margin (%)',
                    val: pnl.grossMarginPercent !== null ? `${pnl.grossMarginPercent.toFixed(2)}%` : 'N/A',
                  },
                  { label: 'Received Purchases in Period (Excl. GST)', val: formatInr(pnl.purchasesExclGst) },
                  { label: 'Input Purchase GST (Received POs)', val: formatInr(pnl.inputPurchaseGst) },
                  { label: 'Customer Cash Collected in Period', val: formatInr(pnl.cashCollectedInPeriod), bold: true },
                  { label: 'Total Outstanding Receivables (All-Time)', val: formatInr(pnl.totalOutstandingReceivables) },
                ].map((row) => (
                  <div
                    key={row.label}
                    className={`px-5 py-2.5 flex items-center justify-between gap-4 ${
                      row.bold ? 'bg-slate-50/70 font-semibold' : ''
                    }`}
                  >
                    <span className="text-slate-700">{row.label}</span>
                    <span
                      className={`tabular-nums ${
                        row.highlight === 'emerald'
                          ? 'text-emerald-700'
                          : row.highlight === 'red'
                            ? 'text-red-700'
                            : 'text-[#3B4F4E]'
                      }`}
                    >
                      {row.val}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* 14-Report Directory Cards */}
            <div className="bg-white border border-[#DCE6E6] rounded-xl p-5 space-y-4">
              <div>
                <h2 className="text-base font-semibold text-[#3B4F4E]">
                  Monthly Audit Register Directory (14 Reports)
                </h2>
                <p className="text-xs text-slate-500">
                  Click any audit register below to inspect its itemized rows for {effectiveFrom} to {effectiveTo}.
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {[
                  {
                    num: '01',
                    title: 'Opening Stock & Reconciliation',
                    metric: `${dataset.stockReconciliation.length} items`,
                    action: () => jumpToReportSection('stock-manufacturing', 'opening-reconciliation'),
                  },
                  {
                    num: '02',
                    title: 'Purchases Register',
                    metric: `${dataset.purchasesInPeriod.length} POs (${formatInr(pnl.purchasesExclGst)})`,
                    action: () => jumpToReportSection('procurement-costing'),
                  },
                  {
                    num: '03',
                    title: 'Raw Material Consumption',
                    metric: `${dataset.consumptionsInPeriod.length} lines`,
                    action: () => jumpToReportSection('stock-manufacturing', 'rm-consumption'),
                  },
                  {
                    num: '04',
                    title: 'Production Output',
                    metric: `${dataset.productionOrdersInPeriod.length} batches`,
                    action: () => jumpToReportSection('stock-manufacturing', 'production-output'),
                  },
                  {
                    num: '05',
                    title: 'Damaged & Rejected Materials',
                    metric: `${dataset.damagedBalances.length} SKUs · ${dataset.damagedConsumptionsInPeriod.length} lines`,
                    action: () => jumpToReportSection('stock-manufacturing', 'damaged-rejected'),
                  },
                  {
                    num: '06',
                    title: 'Finished Goods Stock',
                    metric: `${dataset.finishedGoodsBalances.length} SKUs`,
                    action: () => jumpToReportSection('stock-manufacturing', 'finished-goods'),
                  },
                  {
                    num: '07',
                    title: 'Sales Orders',
                    metric: `${dataset.salesOrdersInPeriod.length} orders`,
                    action: () => jumpToReportSection('sales-receivables', 'sales-orders'),
                  },
                  {
                    num: '08',
                    title: 'GST Invoices',
                    metric: `${dataset.invoicesInPeriod.length} invoices (${formatInr(pnl.grossSalesInclGst)})`,
                    action: () => jumpToReportSection('sales-receivables', 'gst-invoices'),
                  },
                  {
                    num: '09',
                    title: 'Dispatch Records',
                    metric: `${dataset.dispatchesInPeriod.length} challans`,
                    action: () => jumpToReportSection('sales-receivables', 'dispatches'),
                  },
                  {
                    num: '10',
                    title: 'Customer Payments',
                    metric: `${dataset.paymentsInPeriod.length} receipts (${formatInr(pnl.cashCollectedInPeriod)})`,
                    action: () => jumpToReportSection('sales-receivables', 'payments'),
                  },
                  {
                    num: '11',
                    title: 'Outstanding Balances',
                    metric: `${dataset.customerSummaries.filter((c) => c.outstandingBalance > 0).length} customers due`,
                    action: () => jumpToReportSection('sales-receivables', 'customer-balances'),
                  },
                  {
                    num: '12',
                    title: 'Production Expenses',
                    metric: `${dataset.costingsInPeriod.length} expense logs`,
                    action: () => jumpToReportSection('procurement-costing'),
                  },
                  {
                    num: '13',
                    title: 'Product Costing Breakdown',
                    metric: `${dataset.productCostSummariesInPeriod.length} products`,
                    action: () => jumpToReportSection('procurement-costing'),
                  },
                  {
                    num: '14',
                    title: '9-Rule Audit Validations',
                    metric: `${validationCounts.fail} Fail · ${validationCounts.warning} Warn`,
                    action: () => jumpToReportSection('validations'),
                  },
                ].map((item) => (
                  <button
                    key={item.num}
                    type="button"
                    onClick={item.action}
                    className="text-left p-3 rounded-lg border border-[#DCE6E6] hover:border-blue-400 hover:bg-[#EEF3F3]/40 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-mono font-semibold text-[#3B4F4E]">
                        #{item.num}
                      </span>
                      <span className="text-[11px] text-slate-500">{item.metric}</span>
                    </div>
                    <p className="mt-1 text-sm font-medium text-[#3B4F4E]">{item.title}</p>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Product-Wise & Customer-Wise Snapshot Tables */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white border border-[#DCE6E6] rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[#DCE6E6] flex items-center justify-between">
                <h3 className="text-sm font-semibold text-[#3B4F4E]">
                  Product-Wise Production &amp; Sales Summary
                </h3>
                <button
                  type="button"
                  onClick={() => jumpToReportSection('sales-receivables', 'product-summary')}
                  className="text-xs font-medium text-[#3B4F4E] hover:underline"
                >
                  Full View
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600 border-b border-[#DCE6E6]">
                    <tr>
                      <th className="py-2.5 px-4 font-medium">Product</th>
                      <th className="py-2.5 px-3 font-medium text-right">Good Pkts</th>
                      <th className="py-2.5 px-3 font-medium text-right">Avg Cost/Pkt</th>
                      <th className="py-2.5 px-3 font-medium text-right">Invoiced Qty</th>
                      <th className="py-2.5 px-4 font-medium text-right">Sales (Excl GST)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {dataset.productSummaries.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-6 text-center text-slate-500">
                          No product production or sales recorded in {effectiveFrom} to {effectiveTo}.
                        </td>
                      </tr>
                    ) : (
                      dataset.productSummaries.map((p) => (
                        <tr key={p.productId}>
                          <td className="py-2.5 px-4 font-medium text-[#3B4F4E]">
                            {p.productName}{' '}
                            <span className="text-slate-400 font-normal">({p.packetSize})</span>
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums">
                            {formatQty(p.producedGoodQty)}
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums">
                            {p.avgCostPerPacket !== null ? formatInr(p.avgCostPerPacket) : 'N/A'}
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums">
                            {formatQty(p.invoicedQty)}
                          </td>
                          <td className="py-2.5 px-4 text-right font-medium tabular-nums">
                            {formatInr(p.salesTaxableValue)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-white border border-[#DCE6E6] rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[#DCE6E6] flex items-center justify-between">
                <h3 className="text-sm font-semibold text-[#3B4F4E]">
                  Customer-Wise Billing &amp; Outstanding Receivables
                </h3>
                <button
                  type="button"
                  onClick={() => jumpToReportSection('sales-receivables', 'customer-balances')}
                  className="text-xs font-medium text-[#3B4F4E] hover:underline"
                >
                  Full View
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600 border-b border-[#DCE6E6]">
                    <tr>
                      <th className="py-2.5 px-4 font-medium">Customer</th>
                      <th className="py-2.5 px-3 font-medium text-right">Period Billed</th>
                      <th className="py-2.5 px-3 font-medium text-right">Period Paid</th>
                      <th className="py-2.5 px-4 font-medium text-right">Total Due</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {dataset.customerSummaries.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-6 text-center text-slate-500">
                          No customer billing or receivables recorded yet.
                        </td>
                      </tr>
                    ) : (
                      dataset.customerSummaries.slice(0, 8).map((c) => (
                        <tr key={c.customerId}>
                          <td className="py-2.5 px-4 font-medium text-[#3B4F4E]">
                            {c.customerName}
                            <div className="text-[11px] text-slate-400 font-normal">
                              {c.openInvoices} open invoice{c.openInvoices === 1 ? '' : 's'}
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums">
                            {formatInr(c.periodBilled)}
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums text-emerald-700">
                            {formatInr(c.periodPaid)}
                          </td>
                          <td
                            className={`py-2.5 px-4 text-right font-semibold tabular-nums ${
                              c.outstandingBalance > 0 ? 'text-amber-700' : 'text-emerald-700'
                            }`}
                          >
                            {formatInr(c.outstandingBalance)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: 9-RULE AUDIT VALIDATIONS */}
      {activeTab === 'validations' && (
        <div className="space-y-4">
          <div className="bg-white border border-[#DCE6E6] rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-[#3B4F4E]">
                Automated 9-Point Audit Control Engine
              </h2>
              <p className="text-xs text-slate-500">
                Continuously scans all Firestore ledgers, stock balances, POs, production variances, invoices, dispatches, and payments.
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(['ALL', 'Fail', 'Warning', 'Pass'] as const).map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setValidationFilter(status)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                    validationFilter === status
                      ? 'bg-[#0B162C] text-white border-[#0B162C]'
                      : 'bg-white text-slate-600 border-[#DCE6E6] hover:bg-slate-50'
                  }`}
                >
                  {status === 'ALL'
                    ? `All (${validations.length})`
                    : status === 'Fail'
                      ? `Fail (${validationCounts.fail})`
                      : status === 'Warning'
                        ? `Warning (${validationCounts.warning})`
                        : `Pass (${validationCounts.pass})`}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3">
            {filteredValidations.map((chk: AuditValidationCheck) => {
              const expanded = Boolean(expandedChecks[chk.id]);
              return (
                <div
                  key={chk.id}
                  className={`bg-white border rounded-xl overflow-hidden ${
                    chk.status === 'Fail'
                      ? 'border-red-200'
                      : chk.status === 'Warning'
                        ? 'border-amber-200'
                        : 'border-[#DCE6E6]'
                  }`}
                >
                  <div className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 shrink-0">
                        {chk.status === 'Pass' && (
                          <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                        )}
                        {chk.status === 'Warning' && (
                          <AlertTriangle className="w-5 h-5 text-amber-600" />
                        )}
                        {chk.status === 'Fail' && <XCircle className="w-5 h-5 text-red-600" />}
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-sm font-semibold text-[#3B4F4E]">{chk.title}</h3>
                          <span
                            className={`px-2 py-0.5 text-[11px] font-medium rounded ${
                              chk.status === 'Pass'
                                ? 'bg-emerald-50 text-emerald-700'
                                : chk.status === 'Warning'
                                  ? 'bg-amber-50 text-amber-700'
                                  : 'bg-red-50 text-red-700'
                            }`}
                          >
                            {chk.status} · {chk.affectedCount} issue
                            {chk.affectedCount === 1 ? '' : 's'}
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs text-slate-600">{chk.description}</p>
                      </div>
                    </div>

                    {chk.findings.length > 0 && (
                      <button
                        type="button"
                        onClick={() => toggleCheckExpand(chk.id)}
                        className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-[#DCE6E6] rounded-lg shrink-0 whitespace-nowrap"
                      >
                        {expanded ? 'Hide Findings' : `Inspect ${chk.findings.length} Finding${chk.findings.length === 1 ? '' : 's'}`}
                      </button>
                    )}
                  </div>

                  {expanded && chk.findings.length > 0 && (
                    <div className="border-t border-slate-100 bg-slate-50/70 px-4 py-3 space-y-2">
                      {chk.findings.map((f, idx) => (
                        <div
                          key={`${chk.id}-${idx}`}
                          className="flex items-start gap-2.5 text-xs bg-white border border-[#DCE6E6] rounded-lg px-3 py-2"
                        >
                          <span className="font-mono font-semibold text-slate-700 shrink-0">
                            [{f.recordRef}]
                          </span>
                          <span className="text-slate-700">{f.detail}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 3: STOCK, PRODUCTION & VARIANCE REPORTS */}
      {activeTab === 'stock-manufacturing' && (
        <div className="space-y-6">
          <div className="flex flex-wrap gap-2">
            {[
              { id: 'all' as const, label: 'All Stock & Production Tables' },
              { id: 'opening-reconciliation' as const, label: '1. Opening Stock & Reconciliation' },
              { id: 'rm-consumption' as const, label: '3. Raw Material Consumption' },
              { id: 'production-output' as const, label: '4. Production Output' },
              { id: 'damaged-rejected' as const, label: '5. Damaged & Rejected' },
              { id: 'finished-goods' as const, label: '6. Finished Goods Stock' },
              { id: 'variance' as const, label: 'Yield & Material Variance' },
            ].map((btn) => (
              <button
                key={btn.id}
                type="button"
                onClick={() => setStockFilter(btn.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                  stockFilter === btn.id
                    ? 'bg-[#CF9C2D] text-white border-[#3B4F4E]'
                    : 'bg-white text-slate-600 border-[#DCE6E6] hover:bg-slate-50'
                }`}
              >
                {btn.label}
              </button>
            ))}
          </div>

          {(stockFilter === 'all' || stockFilter === 'opening-reconciliation') && (
            <div className="bg-white border border-[#DCE6E6] rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[#DCE6E6]">
                <h3 className="text-sm font-semibold text-[#3B4F4E]">
                  1. Opening Stock &amp; Period Stock Reconciliation ({effectiveFrom} to {effectiveTo})
                </h3>
                <p className="text-xs text-slate-500">
                  Reconstructs period opening, inflows, outflows, and closing balance from immutable inventory ledger entries alongside live system balances.
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600 border-b border-[#DCE6E6]">
                    <tr>
                      <th className="py-2.5 px-4 font-medium">Category</th>
                      <th className="py-2.5 px-3 font-medium">Item</th>
                      <th className="py-2.5 px-3 font-medium text-right">Period Opening</th>
                      <th className="py-2.5 px-3 font-medium text-right">Inflow (+)</th>
                      <th className="py-2.5 px-3 font-medium text-right">Outflow (−)</th>
                      <th className="py-2.5 px-3 font-medium text-right">Period Closing</th>
                      <th className="py-2.5 px-4 font-medium text-right">Live Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {dataset.stockReconciliation.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-6 text-center text-slate-500">
                          No stock balance records found.
                        </td>
                      </tr>
                    ) : (
                      dataset.stockReconciliation.map((row) => (
                        <tr key={row.balanceId}>
                          <td className="py-2.5 px-4 uppercase text-[11px] font-mono text-slate-500">
                            {row.stockCategory.replace('_', ' ')}
                          </td>
                          <td className="py-2.5 px-3 font-medium text-[#3B4F4E]">
                            {row.itemName}{' '}
                            <span className="text-slate-400 font-mono font-normal">
                              ({row.itemCode})
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums">
                            {formatQty(row.periodOpeningStock)} {row.unit}
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums text-emerald-700">
                            +{formatQty(row.periodInflow)}
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums text-red-700">
                            -{formatQty(row.periodOutflow)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-semibold tabular-nums">
                            {formatQty(row.periodClosingBalance)} {row.unit}
                          </td>
                          <td className="py-2.5 px-4 text-right tabular-nums">
                            {formatQty(row.liveSystemBalance)} {row.unit}
                            {row.isLowStock && (
                              <span className="ml-1.5 px-1.5 py-0.5 text-[10px] bg-amber-50 text-amber-700 rounded">
                                Low
                              </span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {(stockFilter === 'all' || stockFilter === 'rm-consumption') && (
            <div className="bg-white border border-[#DCE6E6] rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[#DCE6E6]">
                <h3 className="text-sm font-semibold text-[#3B4F4E]">
                  3. Raw Material Consumption Register ({dataset.consumptionsInPeriod.length} lines)
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600 border-b border-[#DCE6E6]">
                    <tr>
                      <th className="py-2.5 px-4 font-medium">Date / Batch</th>
                      <th className="py-2.5 px-3 font-medium">Product</th>
                      <th className="py-2.5 px-3 font-medium">Material</th>
                      <th className="py-2.5 px-3 font-medium text-right">Expected</th>
                      <th className="py-2.5 px-3 font-medium text-right">Issued</th>
                      <th className="py-2.5 px-3 font-medium text-right">Actual Consumed</th>
                      <th className="py-2.5 px-4 font-medium text-right">Variance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {dataset.consumptionsInPeriod.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-6 text-center text-slate-500">
                          No material consumption recorded for this period.
                        </td>
                      </tr>
                    ) : (
                      dataset.consumptionsInPeriod.map((c) => (
                        <tr key={c.id}>
                          <td className="py-2.5 px-4">
                            <span className="font-mono font-medium text-[#3B4F4E]">
                              {c.orderNumber}
                            </span>
                            <div className="text-[11px] text-slate-400">{c.productionDate}</div>
                          </td>
                          <td className="py-2.5 px-3 text-slate-700">{c.productName}</td>
                          <td className="py-2.5 px-3 font-medium text-[#3B4F4E]">
                            {c.materialName}
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums">
                            {formatQty(c.expectedQuantity)} {c.unit}
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums">
                            {formatQty(c.issuedQuantity)} {c.unit}
                          </td>
                          <td className="py-2.5 px-3 text-right font-semibold tabular-nums">
                            {formatQty(c.actualConsumedQuantity)} {c.unit}
                          </td>
                          <td
                            className={`py-2.5 px-4 text-right font-medium tabular-nums ${
                              c.varianceQuantity > 0
                                ? 'text-red-700'
                                : c.varianceQuantity < 0
                                  ? 'text-emerald-700'
                                  : 'text-slate-600'
                            }`}
                          >
                            {c.varianceQuantity > 0 ? '+' : ''}
                            {formatQty(c.varianceQuantity)} {c.unit}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {(stockFilter === 'all' || stockFilter === 'production-output') && (
            <div className="bg-white border border-[#DCE6E6] rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[#DCE6E6]">
                <h3 className="text-sm font-semibold text-[#3B4F4E]">
                  4. Production Output Register ({dataset.productionOrdersInPeriod.length} batches)
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600 border-b border-[#DCE6E6]">
                    <tr>
                      <th className="py-2.5 px-4 font-medium">Order No / Date</th>
                      <th className="py-2.5 px-3 font-medium">Product</th>
                      <th className="py-2.5 px-3 font-medium">Supervisor</th>
                      <th className="py-2.5 px-3 font-medium">Status</th>
                      <th className="py-2.5 px-3 font-medium text-right">Planned</th>
                      <th className="py-2.5 px-3 font-medium text-right">Actual Good</th>
                      <th className="py-2.5 px-4 font-medium text-right">Rejected / Damaged</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {dataset.productionOrdersInPeriod.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-6 text-center text-slate-500">
                          No production orders recorded in this period.
                        </td>
                      </tr>
                    ) : (
                      dataset.productionOrdersInPeriod.map((o) => (
                        <tr key={o.id}>
                          <td className="py-2.5 px-4">
                            <span className="font-mono font-medium text-[#3B4F4E]">
                              {o.orderNumber}
                            </span>
                            <div className="text-[11px] text-slate-400">{o.productionDate}</div>
                          </td>
                          <td className="py-2.5 px-3 font-medium text-[#3B4F4E]">
                            {o.productName} ({o.packetSize})
                          </td>
                          <td className="py-2.5 px-3 text-slate-600">{o.supervisorName}</td>
                          <td className="py-2.5 px-3">
                            <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-medium">
                              {o.status}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums">
                            {formatQty(o.plannedQuantity)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-semibold text-emerald-700 tabular-nums">
                            {formatQty(o.actualGoodQuantity)}
                          </td>
                          <td className="py-2.5 px-4 text-right font-medium text-red-700 tabular-nums">
                            {formatQty(o.damagedQuantity)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {(stockFilter === 'all' || stockFilter === 'damaged-rejected') && (
            <div className="bg-white border border-[#DCE6E6] rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[#DCE6E6]">
                <h3 className="text-sm font-semibold text-[#3B4F4E]">
                  5. Damaged &amp; Rejected Materials &amp; Packets
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600 border-b border-[#DCE6E6]">
                    <tr>
                      <th className="py-2.5 px-4 font-medium">Source</th>
                      <th className="py-2.5 px-3 font-medium">Item / Product</th>
                      <th className="py-2.5 px-3 font-medium text-right">Period Damaged Inflow</th>
                      <th className="py-2.5 px-4 font-medium text-right">Current Damaged Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {dataset.damagedBalances.length === 0 &&
                    dataset.damagedConsumptionsInPeriod.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-6 text-center text-slate-500">
                          Zero damaged stock or damaged material incidents recorded.
                        </td>
                      </tr>
                    ) : (
                      <>
                        {dataset.damagedBalances.map((b) => (
                          <tr key={b.balanceId}>
                            <td className="py-2.5 px-4 text-slate-500">Damaged Stock Bucket</td>
                            <td className="py-2.5 px-3 font-medium text-[#3B4F4E]">
                              {b.itemName} ({b.itemCode})
                            </td>
                            <td className="py-2.5 px-3 text-right text-red-700 tabular-nums">
                              +{formatQty(b.periodInflow)} {b.unit}
                            </td>
                            <td className="py-2.5 px-4 text-right font-semibold tabular-nums">
                              {formatQty(b.liveSystemBalance)} {b.unit}
                            </td>
                          </tr>
                        ))}
                        {dataset.damagedConsumptionsInPeriod.map((dc) => (
                          <tr key={dc.id}>
                            <td className="py-2.5 px-4 text-slate-500">
                              Batch {dc.orderNumber} ({dc.productionDate})
                            </td>
                            <td className="py-2.5 px-3 font-medium text-[#3B4F4E]">
                              {dc.materialName} (Raw Material Damage)
                            </td>
                            <td className="py-2.5 px-3 text-right text-red-700 tabular-nums">
                              {formatQty(dc.damagedMaterialQuantity)} {dc.unit}
                            </td>
                            <td className="py-2.5 px-4 text-right text-slate-500">—</td>
                          </tr>
                        ))}
                      </>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {(stockFilter === 'all' || stockFilter === 'finished-goods') && (
            <div className="bg-white border border-[#DCE6E6] rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[#DCE6E6]">
                <h3 className="text-sm font-semibold text-[#3B4F4E]">
                  6. Finished Goods Stock Report ({dataset.finishedGoodsBalances.length} SKUs)
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600 border-b border-[#DCE6E6]">
                    <tr>
                      <th className="py-2.5 px-4 font-medium">SKU / Product</th>
                      <th className="py-2.5 px-3 font-medium text-right">Period Opening</th>
                      <th className="py-2.5 px-3 font-medium text-right">Produced (+)</th>
                      <th className="py-2.5 px-3 font-medium text-right">Dispatched (−)</th>
                      <th className="py-2.5 px-4 font-medium text-right">Live Available Stock</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {dataset.finishedGoodsBalances.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-6 text-center text-slate-500">
                          No finished goods stock balances recorded.
                        </td>
                      </tr>
                    ) : (
                      dataset.finishedGoodsBalances.map((fg) => (
                        <tr key={fg.balanceId}>
                          <td className="py-2.5 px-4 font-medium text-[#3B4F4E]">
                            {fg.itemName}{' '}
                            <span className="font-mono text-slate-400 font-normal">
                              ({fg.itemCode})
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums">
                            {formatQty(fg.periodOpeningStock)} pkts
                          </td>
                          <td className="py-2.5 px-3 text-right text-emerald-700 tabular-nums">
                            +{formatQty(fg.periodInflow)}
                          </td>
                          <td className="py-2.5 px-3 text-right text-[#3B4F4E] tabular-nums">
                            -{formatQty(fg.periodOutflow)}
                          </td>
                          <td className="py-2.5 px-4 text-right font-semibold tabular-nums">
                            {formatQty(fg.liveSystemBalance)} pkts
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {(stockFilter === 'all' || stockFilter === 'variance') && (
            <div className="bg-white border border-[#DCE6E6] rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[#DCE6E6]">
                <h3 className="text-sm font-semibold text-[#3B4F4E]">
                  Production Yield &amp; Material Cost Variance ({dataset.variancesInPeriod.length} batches)
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600 border-b border-[#DCE6E6]">
                    <tr>
                      <th className="py-2.5 px-4 font-medium">Batch / Product</th>
                      <th className="py-2.5 px-3 font-medium text-right">Expected Qty</th>
                      <th className="py-2.5 px-3 font-medium text-right">Actual Good</th>
                      <th className="py-2.5 px-3 font-medium text-right">Yield Var %</th>
                      <th className="py-2.5 px-3 font-medium text-right">Exp. Mat Cost</th>
                      <th className="py-2.5 px-3 font-medium text-right">Act. Mat Cost</th>
                      <th className="py-2.5 px-4 font-medium text-right">Cost Variance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {dataset.variancesInPeriod.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-6 text-center text-slate-500">
                          No completed batch variance records in this period.
                        </td>
                      </tr>
                    ) : (
                      dataset.variancesInPeriod.map((v) => (
                        <tr key={v.id}>
                          <td className="py-2.5 px-4">
                            <span className="font-mono font-medium text-[#3B4F4E]">
                              {v.orderNumber}
                            </span>{' '}
                            · {v.productName}
                            <div className="text-[11px] text-slate-400">{v.productionDate}</div>
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums">
                            {formatQty(v.expectedQuantity)}
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums">
                            {formatQty(v.actualGoodQuantity)}
                          </td>
                          <td
                            className={`py-2.5 px-3 text-right font-medium tabular-nums ${
                              v.yieldVariancePercent < 0 ? 'text-red-700' : 'text-emerald-700'
                            }`}
                          >
                            {v.yieldVariancePercent > 0 ? '+' : ''}
                            {v.yieldVariancePercent.toFixed(2)}%
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums">
                            {formatInr(v.expectedMaterialCost)}
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums">
                            {formatInr(v.actualMaterialCost)}
                          </td>
                          <td
                            className={`py-2.5 px-4 text-right font-semibold tabular-nums ${
                              v.materialCostVariance > 0 ? 'text-red-700' : 'text-emerald-700'
                            }`}
                          >
                            {v.materialCostVariance > 0 ? '+' : ''}
                            {formatInr(v.materialCostVariance)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 4: PURCHASES, EXPENSES & PRODUCT COSTING */}
      {activeTab === 'procurement-costing' && (
        <div className="space-y-6">
          {/* 2. Purchases Report */}
          <div className="bg-white border border-[#DCE6E6] rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#DCE6E6] flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#3B4F4E]">
                2. Purchases Register ({dataset.purchasesInPeriod.length} POs)
              </h3>
              <span className="text-xs text-slate-500">
                Received Subtotal: {formatInr(pnl.purchasesExclGst)} · GST: {formatInr(pnl.inputPurchaseGst)}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 border-b border-[#DCE6E6]">
                  <tr>
                    <th className="py-2.5 px-4 font-medium">PO / Date</th>
                    <th className="py-2.5 px-3 font-medium">Supplier</th>
                    <th className="py-2.5 px-3 font-medium">Invoice No</th>
                    <th className="py-2.5 px-3 font-medium">Receipt</th>
                    <th className="py-2.5 px-3 font-medium">Payment</th>
                    <th className="py-2.5 px-3 font-medium text-right">Subtotal</th>
                    <th className="py-2.5 px-3 font-medium text-right">GST</th>
                    <th className="py-2.5 px-4 font-medium text-right">Grand Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {dataset.purchasesInPeriod.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-6 text-center text-slate-500">
                        No purchase orders in {effectiveFrom} to {effectiveTo}.
                      </td>
                    </tr>
                  ) : (
                    dataset.purchasesInPeriod.map((po) => (
                      <tr key={po.id}>
                        <td className="py-2.5 px-4">
                          <span className="font-mono font-medium text-[#3B4F4E]">
                            {po.poNumber}
                          </span>
                          <div className="text-[11px] text-slate-400">{po.purchaseDate}</div>
                        </td>
                        <td className="py-2.5 px-3 font-medium text-[#3B4F4E]">
                          {po.supplierName}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-slate-600">
                          {po.invoiceNumber || '—'}
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-medium">
                            {po.receiptStatus}
                          </span>
                        </td>
                        <td className="py-2.5 px-3">{po.paymentStatus}</td>
                        <td className="py-2.5 px-3 text-right tabular-nums">
                          {formatInr(po.subtotal)}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums">
                          {formatInr(po.gstTotal)}
                        </td>
                        <td className="py-2.5 px-4 text-right font-semibold tabular-nums">
                          {formatInr(po.grandTotal)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* 12. Production Expenses */}
          <div className="bg-white border border-[#DCE6E6] rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#DCE6E6] flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#3B4F4E]">
                12. Recorded Production Overhead Expenses ({dataset.costingsInPeriod.length} batches)
              </h3>
              <span className="text-xs text-slate-500">
                Total Overheads:{' '}
                {formatInr(
                  pnl.labourExpenses + pnl.gasElectricityExpenses + pnl.otherProductionExpenses,
                )}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 border-b border-[#DCE6E6]">
                  <tr>
                    <th className="py-2.5 px-4 font-medium">Batch / Date</th>
                    <th className="py-2.5 px-3 font-medium">Product</th>
                    <th className="py-2.5 px-3 font-medium text-right">Labour</th>
                    <th className="py-2.5 px-3 font-medium text-right">Gas &amp; Electricity</th>
                    <th className="py-2.5 px-3 font-medium text-right">Other</th>
                    <th className="py-2.5 px-3 font-medium text-right">Total Overhead</th>
                    <th className="py-2.5 px-4 font-medium">Recorded By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {dataset.costingsInPeriod.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-6 text-center text-slate-500">
                        No production expense records logged for batches in this period.
                      </td>
                    </tr>
                  ) : (
                    dataset.costingsInPeriod.map((c) => {
                      const total = c.labourCost + c.gasElectricityCost + c.otherExpenses;
                      return (
                        <tr key={c.id}>
                          <td className="py-2.5 px-4">
                            <span className="font-mono font-medium text-[#3B4F4E]">
                              {c.orderNumber}
                            </span>
                            <div className="text-[11px] text-slate-400">{c.productionDate}</div>
                          </td>
                          <td className="py-2.5 px-3 font-medium text-[#3B4F4E]">
                            {c.productName}
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums">
                            {formatInr(c.labourCost)}
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums">
                            {formatInr(c.gasElectricityCost)}
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums">
                            {formatInr(c.otherExpenses)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-semibold tabular-nums">
                            {formatInr(total)}
                          </td>
                          <td className="py-2.5 px-4 text-slate-600">{c.recordedByName}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* 13. Product Costing Breakdown */}
          <div className="bg-white border border-[#DCE6E6] rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#DCE6E6]">
              <h3 className="text-sm font-semibold text-[#3B4F4E]">
                13. Product Costing &amp; Margin Summary (Period Completed Batches)
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 border-b border-[#DCE6E6]">
                  <tr>
                    <th className="py-2.5 px-4 font-medium">Product</th>
                    <th className="py-2.5 px-3 font-medium text-right">Batches / Good Pkts</th>
                    <th className="py-2.5 px-3 font-medium text-right">Raw Mat (WAC)</th>
                    <th className="py-2.5 px-3 font-medium text-right">Packaging</th>
                    <th className="py-2.5 px-3 font-medium text-right">Overheads</th>
                    <th className="py-2.5 px-3 font-medium text-right">Cost / Pkt</th>
                    <th className="py-2.5 px-3 font-medium text-right">Selling Price</th>
                    <th className="py-2.5 px-4 font-medium text-right">Margin %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {dataset.productCostSummariesInPeriod.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-6 text-center text-slate-500">
                        No completed batches with good output in this period.
                      </td>
                    </tr>
                  ) : (
                    dataset.productCostSummariesInPeriod.map((ps) => (
                      <tr key={ps.productId}>
                        <td className="py-2.5 px-4 font-medium text-[#3B4F4E]">
                          {ps.productName} ({ps.packetSize})
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums">
                          {ps.batchCount} / {formatQty(ps.totalGoodPackets)}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums">
                          {formatInr(ps.rawMaterialCost)}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums">
                          {formatInr(ps.packagingMaterialCost)}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums">
                          {formatInr(ps.labourCost + ps.gasElectricityCost + ps.otherExpenses)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-semibold tabular-nums">
                          {ps.costPerGoodPacket !== null ? formatInr(ps.costPerGoodPacket) : 'N/A'}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums">
                          {ps.sellingPricePerPacket !== null
                            ? formatInr(ps.sellingPricePerPacket)
                            : 'N/A'}
                        </td>
                        <td
                          className={`py-2.5 px-4 text-right font-semibold tabular-nums ${
                            ps.profitMarginPercent !== null && ps.profitMarginPercent > 0
                              ? 'text-emerald-700'
                              : 'text-red-700'
                          }`}
                        >
                          {ps.profitMarginPercent !== null
                            ? `${ps.profitMarginPercent.toFixed(2)}%`
                            : 'N/A'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 5: SALES, GST INVOICES, DISPATCH, PAYMENTS & BALANCES */}
      {activeTab === 'sales-receivables' && (
        <div className="space-y-6">
          <div className="flex flex-wrap gap-2">
            {[
              { id: 'all' as const, label: 'All Sales & Receivables Tables' },
              { id: 'sales-orders' as const, label: '7. Sales Orders' },
              { id: 'gst-invoices' as const, label: '8. GST Invoices' },
              { id: 'dispatches' as const, label: '9. Dispatch Records' },
              { id: 'payments' as const, label: '10. Customer Payments' },
              { id: 'customer-balances' as const, label: '11. Outstanding Balances' },
              { id: 'product-summary' as const, label: 'Product-Wise Summary' },
            ].map((btn) => (
              <button
                key={btn.id}
                type="button"
                onClick={() => setSalesFilter(btn.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                  salesFilter === btn.id
                    ? 'bg-[#CF9C2D] text-white border-[#3B4F4E]'
                    : 'bg-white text-slate-600 border-[#DCE6E6] hover:bg-slate-50'
                }`}
              >
                {btn.label}
              </button>
            ))}
          </div>

          {(salesFilter === 'all' || salesFilter === 'sales-orders') && (
            <div className="bg-white border border-[#DCE6E6] rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[#DCE6E6]">
                <h3 className="text-sm font-semibold text-[#3B4F4E]">
                  7. Sales Orders Register ({dataset.salesOrdersInPeriod.length} orders)
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600 border-b border-[#DCE6E6]">
                    <tr>
                      <th className="py-2.5 px-4 font-medium">Order No / Date</th>
                      <th className="py-2.5 px-3 font-medium">Customer</th>
                      <th className="py-2.5 px-3 font-medium">Salesman</th>
                      <th className="py-2.5 px-3 font-medium">Status</th>
                      <th className="py-2.5 px-3 font-medium text-right">Dispatched / Ordered</th>
                      <th className="py-2.5 px-4 font-medium text-right">Grand Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {dataset.salesOrdersInPeriod.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-6 text-center text-slate-500">
                          No sales orders in {effectiveFrom} to {effectiveTo}.
                        </td>
                      </tr>
                    ) : (
                      dataset.salesOrdersInPeriod.map((so) => (
                        <tr key={so.id}>
                          <td className="py-2.5 px-4">
                            <span className="font-mono font-medium text-[#3B4F4E]">
                              {so.orderNumber}
                            </span>
                            <div className="text-[11px] text-slate-400">{so.orderDate}</div>
                          </td>
                          <td className="py-2.5 px-3 font-medium text-[#3B4F4E]">
                            {so.customerName}
                          </td>
                          <td className="py-2.5 px-3 text-slate-600">{so.salesmanName}</td>
                          <td className="py-2.5 px-3">
                            <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-medium">
                              {so.status}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums">
                            {so.totalDispatchedQty} / {so.totalOrderedQty} pkts
                          </td>
                          <td className="py-2.5 px-4 text-right font-semibold tabular-nums">
                            {formatInr(so.grandTotal)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {(salesFilter === 'all' || salesFilter === 'gst-invoices') && (
            <div className="bg-white border border-[#DCE6E6] rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[#DCE6E6] flex items-center justify-between">
                <h3 className="text-sm font-semibold text-[#3B4F4E]">
                  8. GST Invoices Register ({dataset.invoicesInPeriod.length} invoices)
                </h3>
                <span className="text-xs text-slate-500">
                  Taxable: {formatInr(pnl.salesRevenueExclGst)} · GST: {formatInr(pnl.gstCollected)}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600 border-b border-[#DCE6E6]">
                    <tr>
                      <th className="py-2.5 px-4 font-medium">Invoice / Date</th>
                      <th className="py-2.5 px-3 font-medium">Customer</th>
                      <th className="py-2.5 px-3 font-medium">Tax Type</th>
                      <th className="py-2.5 px-3 font-medium text-right">Taxable</th>
                      <th className="py-2.5 px-3 font-medium text-right">GST</th>
                      <th className="py-2.5 px-3 font-medium text-right">Total</th>
                      <th className="py-2.5 px-4 font-medium text-right">Due / Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {dataset.invoicesInPeriod.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-6 text-center text-slate-500">
                          No GST invoices generated in this period.
                        </td>
                      </tr>
                    ) : (
                      dataset.invoicesInPeriod.map((inv) => (
                        <tr key={inv.id}>
                          <td className="py-2.5 px-4">
                            <span className="font-mono font-medium text-[#3B4F4E]">
                              {inv.invoiceNumber}
                            </span>
                            <div className="text-[11px] text-slate-400">{inv.invoiceDate}</div>
                          </td>
                          <td className="py-2.5 px-3 font-medium text-[#3B4F4E]">
                            {inv.customerName}
                          </td>
                          <td className="py-2.5 px-3 text-slate-600">
                            {inv.taxType === 'CGST_SGST' ? 'CGST + SGST' : 'IGST'}
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums">
                            {formatInr(inv.subtotal)}
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums">
                            {formatInr(inv.gstTotal)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-semibold tabular-nums">
                            {formatInr(inv.grandTotal)}
                          </td>
                          <td className="py-2.5 px-4 text-right tabular-nums">
                            {formatInr(inv.outstandingBalance)}{' '}
                            <span className="text-[11px] text-slate-400">({inv.paymentStatus})</span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {(salesFilter === 'all' || salesFilter === 'dispatches') && (
            <div className="bg-white border border-[#DCE6E6] rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[#DCE6E6]">
                <h3 className="text-sm font-semibold text-[#3B4F4E]">
                  9. Dispatch Records ({dataset.dispatchesInPeriod.length} challans)
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600 border-b border-[#DCE6E6]">
                    <tr>
                      <th className="py-2.5 px-4 font-medium">Dispatch / Date</th>
                      <th className="py-2.5 px-3 font-medium">Sales Order</th>
                      <th className="py-2.5 px-3 font-medium">Customer</th>
                      <th className="py-2.5 px-3 font-medium">Vehicle / Driver</th>
                      <th className="py-2.5 px-3 font-medium">Type</th>
                      <th className="py-2.5 px-4 font-medium text-right">Packets Shipped</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {dataset.dispatchesInPeriod.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-6 text-center text-slate-500">
                          No dispatch records in this period.
                        </td>
                      </tr>
                    ) : (
                      dataset.dispatchesInPeriod.map((d) => (
                        <tr key={d.id}>
                          <td className="py-2.5 px-4">
                            <span className="font-mono font-medium text-[#3B4F4E]">
                              {d.dispatchNumber}
                            </span>
                            <div className="text-[11px] text-slate-400">{d.dispatchDate}</div>
                          </td>
                          <td className="py-2.5 px-3 font-mono text-slate-700">{d.orderNumber}</td>
                          <td className="py-2.5 px-3 font-medium text-[#3B4F4E]">
                            {d.customerName}
                          </td>
                          <td className="py-2.5 px-3 text-slate-600">
                            {d.vehicleNumber} · {d.driverName}
                          </td>
                          <td className="py-2.5 px-3">{d.isPartial ? 'Partial' : 'Full'}</td>
                          <td className="py-2.5 px-4 text-right font-semibold tabular-nums">
                            {d.totalDispatchedQty} pkts
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {(salesFilter === 'all' || salesFilter === 'payments') && (
            <div className="bg-white border border-[#DCE6E6] rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[#DCE6E6]">
                <h3 className="text-sm font-semibold text-[#3B4F4E]">
                  10. Customer Payments ({dataset.paymentsInPeriod.length} receipts ·{' '}
                  {formatInr(pnl.cashCollectedInPeriod)})
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600 border-b border-[#DCE6E6]">
                    <tr>
                      <th className="py-2.5 px-4 font-medium">Receipt / Date</th>
                      <th className="py-2.5 px-3 font-medium">Customer</th>
                      <th className="py-2.5 px-3 font-medium">Invoice</th>
                      <th className="py-2.5 px-3 font-medium">Method / Ref</th>
                      <th className="py-2.5 px-3 font-medium">Recorded By</th>
                      <th className="py-2.5 px-4 font-medium text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {dataset.paymentsInPeriod.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-6 text-center text-slate-500">
                          No customer payments recorded in this period.
                        </td>
                      </tr>
                    ) : (
                      dataset.paymentsInPeriod.map((p) => (
                        <tr key={p.id}>
                          <td className="py-2.5 px-4">
                            <span className="font-mono font-medium text-[#3B4F4E]">
                              {p.receiptNumber}
                            </span>
                            <div className="text-[11px] text-slate-400">{p.paymentDate}</div>
                          </td>
                          <td className="py-2.5 px-3 font-medium text-[#3B4F4E]">
                            {p.customerName}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-slate-700">
                            {p.invoiceNumber}
                          </td>
                          <td className="py-2.5 px-3 text-slate-600">
                            {p.paymentMethod} · <span className="font-mono">{p.referenceNumber}</span>
                          </td>
                          <td className="py-2.5 px-3 text-slate-600">{p.recordedByName}</td>
                          <td className="py-2.5 px-4 text-right font-semibold text-emerald-700 tabular-nums">
                            {formatInr(p.amount)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {(salesFilter === 'all' || salesFilter === 'customer-balances') && (
            <div className="bg-white border border-[#DCE6E6] rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[#DCE6E6]">
                <h3 className="text-sm font-semibold text-[#3B4F4E]">
                  11. Customer Outstanding Balances (All-Time Ledger + Period Activity)
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600 border-b border-[#DCE6E6]">
                    <tr>
                      <th className="py-2.5 px-4 font-medium">Customer / GSTIN</th>
                      <th className="py-2.5 px-3 font-medium text-right">Invoices</th>
                      <th className="py-2.5 px-3 font-medium text-right">Period Billed</th>
                      <th className="py-2.5 px-3 font-medium text-right">Period Paid</th>
                      <th className="py-2.5 px-3 font-medium text-right">All-Time Billed</th>
                      <th className="py-2.5 px-3 font-medium text-right">All-Time Paid</th>
                      <th className="py-2.5 px-4 font-medium text-right">Outstanding Due</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {dataset.customerSummaries.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-6 text-center text-slate-500">
                          No customer billing records found.
                        </td>
                      </tr>
                    ) : (
                      dataset.customerSummaries.map((c) => (
                        <tr key={c.customerId}>
                          <td className="py-2.5 px-4 font-medium text-[#3B4F4E]">
                            {c.customerName}
                            <div className="text-[11px] font-mono text-slate-400 font-normal">
                              {c.customerGstin || 'Unregistered'}
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums">
                            {c.invoiceCount} ({c.openInvoices} open)
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums">
                            {formatInr(c.periodBilled)}
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums text-emerald-700">
                            {formatInr(c.periodPaid)}
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums">
                            {formatInr(c.allTimeBilled)}
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums">
                            {formatInr(c.allTimePaid)}
                          </td>
                          <td
                            className={`py-2.5 px-4 text-right font-semibold tabular-nums ${
                              c.outstandingBalance > 0 ? 'text-amber-700' : 'text-emerald-700'
                            }`}
                          >
                            {formatInr(c.outstandingBalance)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {(salesFilter === 'all' || salesFilter === 'product-summary') && (
            <div className="bg-white border border-[#DCE6E6] rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[#DCE6E6]">
                <h3 className="text-sm font-semibold text-[#3B4F4E]">
                  Product-Wise Complete Period Summary (Production Cost + Sales Revenue)
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600 border-b border-[#DCE6E6]">
                    <tr>
                      <th className="py-2.5 px-4 font-medium">Product</th>
                      <th className="py-2.5 px-3 font-medium text-right">Batches</th>
                      <th className="py-2.5 px-3 font-medium text-right">Good / Damaged</th>
                      <th className="py-2.5 px-3 font-medium text-right">Total Mfg Cost</th>
                      <th className="py-2.5 px-3 font-medium text-right">Avg Cost/Pkt</th>
                      <th className="py-2.5 px-3 font-medium text-right">Ordered / Invoiced</th>
                      <th className="py-2.5 px-3 font-medium text-right">Sales (Excl GST)</th>
                      <th className="py-2.5 px-4 font-medium text-right">Sales GST</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {dataset.productSummaries.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-6 text-center text-slate-500">
                          No product activity in {effectiveFrom} to {effectiveTo}.
                        </td>
                      </tr>
                    ) : (
                      dataset.productSummaries.map((ps) => (
                        <tr key={ps.productId}>
                          <td className="py-2.5 px-4 font-medium text-[#3B4F4E]">
                            {ps.productName} ({ps.packetSize})
                            <div className="text-[11px] font-mono text-slate-400 font-normal">
                              {ps.productSku}
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums">
                            {ps.batchesCompleted}
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums">
                            {formatQty(ps.producedGoodQty)} / {formatQty(ps.producedDamagedQty)}
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums">
                            {formatInr(ps.totalManufacturingCost)}
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums">
                            {ps.avgCostPerPacket !== null ? formatInr(ps.avgCostPerPacket) : 'N/A'}
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums">
                            {formatQty(ps.orderedQty)} / {formatQty(ps.invoicedQty)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-semibold tabular-nums">
                            {formatInr(ps.salesTaxableValue)}
                          </td>
                          <td className="py-2.5 px-4 text-right tabular-nums">
                            {formatInr(ps.salesGstTotal)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 6: IMMUTABLE AUDIT TRAIL */}
      {activeTab === 'audit-trail' && (
        <div className="space-y-4">
          <div className="bg-white border border-[#DCE6E6] rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={auditSearch}
                onChange={(e) => setAuditSearch(e.target.value)}
                placeholder="Search action, document, user, or details..."
                className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-slate-400" />
              <select
                value={auditModuleFilter}
                onChange={(e) => setAuditModuleFilter(e.target.value)}
                className="px-3 py-2 text-sm bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="ALL">All Modules ({auditLogs.length})</option>
                {auditModules.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="bg-white border border-[#DCE6E6] rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 border-b border-[#DCE6E6]">
                  <tr>
                    <th className="py-2.5 px-4 font-medium">Timestamp</th>
                    <th className="py-2.5 px-3 font-medium">Module / Action</th>
                    <th className="py-2.5 px-3 font-medium">Record</th>
                    <th className="py-2.5 px-3 font-medium">Audit Details</th>
                    <th className="py-2.5 px-4 font-medium">Operator</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredAuditLogs.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-500">
                        No audit trail entries recorded yet. Actions in Payments, Costing, and Reports automatically write immutable entries here.
                      </td>
                    </tr>
                  ) : (
                    filteredAuditLogs.slice(0, 200).map((log) => (
                      <tr key={log.id}>
                        <td className="py-2.5 px-4 text-slate-500 whitespace-nowrap">
                          {log.createdAt
                            ? log.createdAt.toDate().toLocaleString('en-IN')
                            : 'Pending sync'}
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="font-medium text-[#3B4F4E]">{log.module}</span>
                          <div className="text-[11px] font-mono text-[#3B4F4E]">{log.action}</div>
                        </td>
                        <td className="py-2.5 px-3 font-mono font-medium text-slate-800">
                          {log.recordLabel}
                        </td>
                        <td className="py-2.5 px-3 text-slate-700 max-w-md">{log.details}</td>
                        <td className="py-2.5 px-4 whitespace-nowrap">
                          <span className="font-medium text-[#3B4F4E]">{log.userName}</span>
                          <div className="text-[11px] text-slate-400">{log.userRole}</div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
