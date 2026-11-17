import { useEffect, useMemo, useState, type ComponentType } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeftRight,
  ArrowRight,
  Boxes,
  Calendar,
  ChevronDown,
  ClipboardList,
  Factory,
  IndianRupee,
  PackageCheck,
  Search,
  ShieldCheck,
  ShoppingCart,
  TrendingUp,
  Truck,
  UserCheck,
  Wallet,
} from 'lucide-react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { getModulesForRole, ROLE_DESCRIPTIONS } from '../config/navigation';
import { useAuth } from '../contexts/AuthContext';
import {
  calculateBatchAndProductCosting,
  calculateWeightedAverageMaterialCosts,
} from '../lib/costingAndAudit';
import { db } from '../lib/firebase';
import { handleFirestoreError, OperationType } from '../lib/firestoreError';
import { roundCurrency, roundQuantity } from '../lib/validation';
import {
  ERP_ROLES,
  ORG_ID,
  type ErpRole,
  type Invoice,
  type ModuleId,
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
  type StockBalance,
} from '../types/erp';

interface DashboardPageProps {
  onNavigate: (moduleId: ModuleId) => void;
}

type DashboardScopeTab = 'ALL' | 'MANUFACTURING' | 'SALES_FINANCE';
type RightPanelMode = 'FLOW' | 'ALERTS' | 'YIELD';

interface TicketMetricCard {
  id: string;
  code: string;
  label: string;
  scope: 'MANUFACTURING' | 'SALES_FINANCE';
  primaryStat: string;
  subLabel: string;
  centerTop: string;
  centerHighlight: string;
  centerBottom: string;
  rightCode: string;
  rightSub: string;
  headlineAmount: string;
  targetModule: ModuleId;
  actionLabel: string;
  icon: ComponentType<{ className?: string }>;
}

function getCurrentMonthPrefix(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function DashboardPage({ onNavigate }: DashboardPageProps) {
  const { firebaseUser, userProfile, effectiveRole, previewRole, setPreviewRole } = useAuth();
  const activeRole = effectiveRole ?? userProfile?.role ?? 'Salesman';
  const realRole = userProfile?.role ?? 'Salesman';

  const canReadManufacturing = realRole !== 'Salesman';
  const isSalesmanOnly = realRole === 'Salesman';
  const canReadInvoices = realRole !== 'Production Supervisor';
  const canReadFinanceSummary =
    realRole === 'Owner' || realRole === 'Admin' || realRole === 'Accountant/Auditor';

  const permittedModules = getModulesForRole(activeRole);
  const permittedIds = new Set(permittedModules.map((m) => m.id));

  const [stockBalances, setStockBalances] = useState<StockBalance[]>([]);
  const [rawMaterials, setRawMaterials] = useState<RawMaterial[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [purchaseItems, setPurchaseItems] = useState<PurchaseItem[]>([]);
  const [productionOrders, setProductionOrders] = useState<ProductionOrder[]>([]);
  const [productionConsumption, setProductionConsumption] = useState<ProductionConsumption[]>([]);
  const [productionCostings, setProductionCostings] = useState<ProductionCosting[]>([]);
  const [variances, setVariances] = useState<ProductionVariance[]>([]);
  const [salesOrders, setSalesOrders] = useState<SalesOrder[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Interactive UI controls inspired by the reference shell
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMonth, setSelectedMonth] = useState(getCurrentMonthPrefix());
  const [scopeTab, setScopeTab] = useState<DashboardScopeTab>('ALL');
  const [showAlertsOnly, setShowAlertsOnly] = useState(false);
  const [rightMode, setRightMode] = useState<RightPanelMode>('FLOW');
  const [quickJumpModule, setQuickJumpModule] = useState<ModuleId>('sales-orders');

  useEffect(() => {
    const firstAllowed =
      permittedModules.find((m) => m.id !== 'dashboard')?.id ?? 'dashboard';
    setQuickJumpModule(firstAllowed);
  }, [activeRole]);

  useEffect(() => {
    if (!firebaseUser) return;
    setLoading(true);
    setLoadError(null);

    let gotBalances = false;
    let gotSalesOrders = false;
    const markReady = () => {
      if (gotBalances && gotSalesOrders) setLoading(false);
    };

    const unsubBalances = onSnapshot(
      query(collection(db, 'stockBalances'), where('orgId', '==', ORG_ID)),
      (snap) => {
        setStockBalances(snap.docs.map((d) => d.data() as StockBalance));
        gotBalances = true;
        markReady();
      },
      (error) => {
        setLoading(false);
        setLoadError('Unable to load live stock balances from Cloud Firestore.');
        handleFirestoreError(error, OperationType.LIST, 'stockBalances');
      },
    );

    const unsubProducts = onSnapshot(
      query(collection(db, 'products'), where('orgId', '==', ORG_ID)),
      (snap) => {
        setProducts(snap.docs.map((d) => d.data() as Product));
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'products');
      },
    );

    const salesOrdersQuery = isSalesmanOnly
      ? query(collection(db, 'salesOrders'), where('salesmanUid', '==', firebaseUser.uid))
      : query(collection(db, 'salesOrders'), where('orgId', '==', ORG_ID));

    const unsubSalesOrders = onSnapshot(
      salesOrdersQuery,
      (snap) => {
        setSalesOrders(snap.docs.map((d) => d.data() as SalesOrder));
        gotSalesOrders = true;
        markReady();
      },
      (error) => {
        setLoading(false);
        setLoadError('Unable to load sales orders from Cloud Firestore.');
        handleFirestoreError(error, OperationType.LIST, 'salesOrders');
      },
    );

    let unsubInvoices = () => {};
    let unsubPayments = () => {};
    if (canReadInvoices) {
      const invoicesQuery = isSalesmanOnly
        ? query(collection(db, 'invoices'), where('salesmanUid', '==', firebaseUser.uid))
        : query(collection(db, 'invoices'), where('orgId', '==', ORG_ID));

      unsubInvoices = onSnapshot(
        invoicesQuery,
        (snap) => {
          setInvoices(snap.docs.map((d) => d.data() as Invoice));
        },
        (error) => {
          handleFirestoreError(error, OperationType.LIST, 'invoices');
        },
      );

      const paymentsQuery = isSalesmanOnly
        ? query(collection(db, 'payments'), where('salesmanUid', '==', firebaseUser.uid))
        : query(collection(db, 'payments'), where('orgId', '==', ORG_ID));

      unsubPayments = onSnapshot(
        paymentsQuery,
        (snap) => {
          setPayments(snap.docs.map((d) => d.data() as Payment));
        },
        (error) => {
          handleFirestoreError(error, OperationType.LIST, 'payments');
        },
      );
    }

    let unsubMaterials = () => {};
    let unsubPurchases = () => {};
    let unsubPurchaseItems = () => {};
    let unsubOrders = () => {};
    let unsubConsumption = () => {};
    let unsubCostings = () => {};
    let unsubVariances = () => {};

    if (canReadManufacturing) {
      unsubMaterials = onSnapshot(
        query(collection(db, 'rawMaterials'), where('orgId', '==', ORG_ID)),
        (snap) => {
          setRawMaterials(snap.docs.map((d) => d.data() as RawMaterial));
        },
        (error) => {
          handleFirestoreError(error, OperationType.LIST, 'rawMaterials');
        },
      );

      unsubPurchases = onSnapshot(
        query(collection(db, 'purchases'), where('orgId', '==', ORG_ID)),
        (snap) => {
          setPurchases(snap.docs.map((d) => d.data() as Purchase));
        },
        (error) => {
          handleFirestoreError(error, OperationType.LIST, 'purchases');
        },
      );

      unsubPurchaseItems = onSnapshot(
        query(collection(db, 'purchaseItems'), where('orgId', '==', ORG_ID)),
        (snap) => {
          setPurchaseItems(snap.docs.map((d) => d.data() as PurchaseItem));
        },
        (error) => {
          handleFirestoreError(error, OperationType.LIST, 'purchaseItems');
        },
      );

      unsubOrders = onSnapshot(
        query(collection(db, 'productionOrders'), where('orgId', '==', ORG_ID)),
        (snap) => {
          setProductionOrders(snap.docs.map((d) => d.data() as ProductionOrder));
        },
        (error) => {
          handleFirestoreError(error, OperationType.LIST, 'productionOrders');
        },
      );

      unsubConsumption = onSnapshot(
        query(collection(db, 'productionConsumption'), where('orgId', '==', ORG_ID)),
        (snap) => {
          setProductionConsumption(snap.docs.map((d) => d.data() as ProductionConsumption));
        },
        (error) => {
          handleFirestoreError(error, OperationType.LIST, 'productionConsumption');
        },
      );

      unsubCostings = onSnapshot(
        query(collection(db, 'productionCostings'), where('orgId', '==', ORG_ID)),
        (snap) => {
          setProductionCostings(snap.docs.map((d) => d.data() as ProductionCosting));
        },
        (error) => {
          handleFirestoreError(error, OperationType.LIST, 'productionCostings');
        },
      );

      unsubVariances = onSnapshot(
        query(collection(db, 'productionVariances'), where('orgId', '==', ORG_ID)),
        (snap) => {
          const rows = snap.docs.map((d) => d.data() as ProductionVariance);
          rows.sort((a, b) => b.productionDate.localeCompare(a.productionDate));
          setVariances(rows);
        },
        (error) => {
          handleFirestoreError(error, OperationType.LIST, 'productionVariances');
        },
      );
    }

    return () => {
      unsubBalances();
      unsubProducts();
      unsubSalesOrders();
      unsubInvoices();
      unsubPayments();
      unsubMaterials();
      unsubPurchases();
      unsubPurchaseItems();
      unsubOrders();
      unsubConsumption();
      unsubCostings();
      unsubVariances();
    };
  }, [firebaseUser, canReadManufacturing, isSalesmanOnly, canReadInvoices]);

  const metrics = useMemo(() => {
    const rmBalances = stockBalances.filter((b) => b.stockCategory === 'raw_material');
    const rmCount = canReadManufacturing ? rawMaterials.length : rmBalances.length;

    const lowStockAlerts: Array<{
      id: string;
      code: string;
      name: string;
      category: 'Raw Material' | 'Finished Goods';
      current: number;
      minimum: number;
      unit: string;
      targetModule: ModuleId;
    }> = [];

    if (canReadManufacturing && rawMaterials.length > 0) {
      rawMaterials.forEach((m) => {
        if (m.currentStock <= m.minimumStockLevel) {
          lowStockAlerts.push({
            id: `rm_${m.id}`,
            code: m.materialCode,
            name: m.name,
            category: 'Raw Material',
            current: m.currentStock,
            minimum: m.minimumStockLevel,
            unit: m.unit,
            targetModule: 'raw-materials',
          });
        }
      });
    } else {
      rmBalances.forEach((b) => {
        if (b.currentBalance <= b.minimumStockLevel) {
          lowStockAlerts.push({
            id: b.id,
            code: b.itemCode,
            name: b.itemName,
            category: 'Raw Material',
            current: b.currentBalance,
            minimum: b.minimumStockLevel,
            unit: b.unit,
            targetModule: 'inventory',
          });
        }
      });
    }

    stockBalances
      .filter((b) => b.stockCategory === 'finished_goods' && b.minimumStockLevel > 0)
      .forEach((b) => {
        if (b.currentBalance <= b.minimumStockLevel) {
          lowStockAlerts.push({
            id: b.id,
            code: b.itemCode,
            name: b.itemName,
            category: 'Finished Goods',
            current: b.currentBalance,
            minimum: b.minimumStockLevel,
            unit: b.unit,
            targetModule: 'inventory',
          });
        }
      });

    const finishedGoodsPackets = roundQuantity(
      stockBalances
        .filter((b) => b.stockCategory === 'finished_goods')
        .reduce((sum, b) => sum + b.currentBalance, 0),
    );
    const wipPackets = roundQuantity(
      stockBalances
        .filter((b) => b.stockCategory === 'wip')
        .reduce((sum, b) => sum + b.currentBalance, 0),
    );

    const activeOrdersCount = productionOrders.filter((o) => o.status === 'In Progress').length;
    const completedBatchesCount = productionOrders.filter((o) => o.status === 'Completed').length;
    const totalExpected = variances.reduce((s, v) => s + v.expectedQuantity, 0);
    const totalGood = variances.reduce((s, v) => s + v.actualGoodQuantity, 0);
    const totalDamaged = variances.reduce((s, v) => s + v.damagedQuantity, 0);
    const avgYieldPct = totalExpected > 0 ? roundCurrency((totalGood / totalExpected) * 100) : 0;
    const netYieldVariancePct =
      totalExpected > 0
        ? roundCurrency(((totalGood - totalExpected) / totalExpected) * 100)
        : 0;

    const validSalesOrders = salesOrders.filter(
      (o) => o.status !== 'Cancelled' && o.status !== 'Rejected',
    );
    const totalSalesOrderValue = roundCurrency(
      validSalesOrders.reduce((sum, o) => sum + o.grandTotal, 0),
    );
    const totalInvoicedSales = roundCurrency(
      invoices.reduce((sum, inv) => sum + inv.grandTotal, 0),
    );
    const totalSalesHeadline =
      invoices.length > 0 ? totalInvoicedSales : totalSalesOrderValue;

    const activePurchases = purchases.filter((p) => p.receiptStatus !== 'Cancelled');
    const receivedPurchases = activePurchases.filter((p) => p.receiptStatus === 'Received');
    const totalPurchaseValue = roundCurrency(
      activePurchases.reduce((sum, p) => sum + p.grandTotal, 0),
    );

    const pendingApprovals = salesOrders.filter((o) => o.status === 'Pending Approval').length;
    const pendingDispatchOrders = salesOrders.filter(
      (o) => o.status === 'Approved' || o.status === 'Partially Dispatched',
    );
    const pendingOrdersCount = pendingApprovals + pendingDispatchOrders.length;
    const pendingDispatchUnits = roundQuantity(
      pendingDispatchOrders.reduce(
        (sum, o) => sum + Math.max(0, o.totalOrderedQty - o.totalDispatchedQty),
        0,
      ),
    );

    const outstandingPayments = roundCurrency(
      invoices.reduce((sum, inv) => sum + inv.outstandingBalance, 0),
    );
    const unpaidInvoiceCount = invoices.filter((inv) => inv.outstandingBalance > 0).length;

    const monthInvoices = invoices.filter((inv) => inv.invoiceDate.startsWith(selectedMonth));
    const monthlyRevenueExclGst = roundCurrency(
      monthInvoices.reduce((sum, inv) => sum + inv.subtotal, 0),
    );
    const monthlyGstCollected = roundCurrency(
      monthInvoices.reduce((sum, inv) => sum + inv.gstTotal, 0),
    );
    const monthlyGrossRevenue = roundCurrency(
      monthInvoices.reduce((sum, inv) => sum + inv.grandTotal, 0),
    );
    const monthlyCashCollected = roundCurrency(
      payments
        .filter((p) => p.paymentDate.startsWith(selectedMonth))
        .reduce((sum, p) => sum + p.amount, 0),
    );

    const wacMap = calculateWeightedAverageMaterialCosts(rawMaterials, purchases, purchaseItems);
    const monthProductionOrders = productionOrders.filter(
      (o) =>
        o.productionDate.startsWith(selectedMonth) &&
        (o.status === 'Completed' || o.status === 'In Progress'),
    );
    const { batches: monthBatches } = calculateBatchAndProductCosting({
      productionOrders: monthProductionOrders,
      consumptions: productionConsumption,
      materials: rawMaterials,
      products,
      wacMap,
      costings: productionCostings,
    });

    const monthlyProductionCost = roundCurrency(
      monthBatches.reduce((sum, b) => sum + b.totalProductionCost, 0),
    );
    const monthlyMfgProfit = roundCurrency(monthlyRevenueExclGst - monthlyProductionCost);
    const monthlyMarginPercent =
      monthlyRevenueExclGst > 0
        ? roundCurrency((monthlyMfgProfit / monthlyRevenueExclGst) * 100)
        : null;

    return {
      rmCount,
      lowStockAlerts,
      lowStockCount: lowStockAlerts.length,
      finishedGoodsPackets,
      wipPackets,
      activeOrdersCount,
      completedBatchesCount,
      totalExpected,
      totalGood,
      totalDamaged,
      avgYieldPct,
      netYieldVariancePct,
      validSalesOrdersCount: validSalesOrders.length,
      totalSalesHeadline,
      activePurchaseCount: activePurchases.length,
      receivedPurchaseCount: receivedPurchases.length,
      totalPurchaseValue,
      pendingOrdersCount,
      pendingApprovals,
      pendingDispatchCount: pendingDispatchOrders.length,
      pendingDispatchUnits,
      outstandingPayments,
      unpaidInvoiceCount,
      monthInvoiceCount: monthInvoices.length,
      monthlyRevenueExclGst,
      monthlyGstCollected,
      monthlyGrossRevenue,
      monthlyCashCollected,
      monthlyProductionCost,
      monthlyMfgProfit,
      monthlyMarginPercent,
    };
  }, [
    stockBalances,
    rawMaterials,
    products,
    purchases,
    purchaseItems,
    productionOrders,
    productionConsumption,
    productionCostings,
    variances,
    canReadManufacturing,
    salesOrders,
    invoices,
    payments,
    selectedMonth,
  ]);

  const ticketCards: TicketMetricCard[] = useMemo(
    () => [
      {
        id: 'total-sales',
        code: 'SLS',
        label: 'Total Sales',
        scope: 'SALES_FINANCE',
        primaryStat: canReadInvoices
          ? `${invoices.length} GST`
          : `${metrics.validSalesOrdersCount} SO`,
        subLabel: 'Billed Revenue',
        centerTop: 'SALES ORDERS',
        centerHighlight: `${metrics.validSalesOrdersCount} ACTIVE`,
        centerBottom: canReadInvoices ? `${metrics.monthInvoiceCount} THIS MONTH` : 'ROLE SCOPED',
        rightCode: 'INV',
        rightSub: `${metrics.monthInvoiceCount} Month`,
        headlineAmount: canReadInvoices
          ? `₹${metrics.totalSalesHeadline.toFixed(0)}`
          : `${metrics.validSalesOrdersCount} Orders`,
        targetModule: canReadInvoices ? 'invoices' : 'sales-orders',
        actionLabel: 'VIEW SALES',
        icon: IndianRupee,
      },
      {
        id: 'total-purchases',
        code: 'PUR',
        label: 'Total Purchases',
        scope: 'MANUFACTURING',
        primaryStat: canReadManufacturing ? `${metrics.activePurchaseCount} PO` : 'LOCKED',
        subLabel: 'Procurement',
        centerTop: 'SUPPLIER RECEIPTS',
        centerHighlight: canReadManufacturing
          ? `${metrics.receivedPurchaseCount} RECEIVED`
          : 'RESTRICTED',
        centerBottom: canReadManufacturing
          ? `${metrics.activePurchaseCount} TOTAL PO`
          : 'ADMIN SCOPE',
        rightCode: 'GRN',
        rightSub: 'Material Intake',
        headlineAmount: canReadManufacturing ? `₹${metrics.totalPurchaseValue.toFixed(0)}` : 'Protected',
        targetModule: 'purchases',
        actionLabel: 'OPEN POs',
        icon: ShoppingCart,
      },
      {
        id: 'raw-material-stock',
        code: 'RAW',
        label: 'Raw Material Stock',
        scope: 'MANUFACTURING',
        primaryStat: `${metrics.rmCount} SKU`,
        subLabel: 'Ingredients',
        centerTop: 'THRESHOLD MONITOR',
        centerHighlight:
          metrics.lowStockCount > 0 ? `${metrics.lowStockCount} ALERTS` : 'ALL NOMINAL',
        centerBottom: `${metrics.rmCount} CATALOGED`,
        rightCode: 'STK',
        rightSub: 'Opening & Ledger',
        headlineAmount: `${metrics.rmCount} Items`,
        targetModule: permittedIds.has('raw-materials') ? 'raw-materials' : 'inventory',
        actionLabel: 'CHECK STOCK',
        icon: Boxes,
      },
      {
        id: 'finished-goods-stock',
        code: 'FG',
        label: 'Finished Goods Stock',
        scope: 'MANUFACTURING',
        primaryStat: `${metrics.finishedGoodsPackets}`,
        subLabel: 'Ready Packets',
        centerTop: 'FLOOR & WAREHOUSE',
        centerHighlight:
          metrics.completedBatchesCount > 0
            ? `${metrics.completedBatchesCount} BATCHES`
            : `${metrics.activeOrdersCount} RUNNING`,
        centerBottom: `${metrics.wipPackets} WIP PKTS`,
        rightCode: 'MFG',
        rightSub: `${metrics.avgYieldPct.toFixed(0)}% Yield`,
        headlineAmount: `${metrics.finishedGoodsPackets} pkts`,
        targetModule: 'inventory',
        actionLabel: 'INVENTORY',
        icon: PackageCheck,
      },
      {
        id: 'pending-orders',
        code: 'ORD',
        label: 'Pending Orders',
        scope: 'SALES_FINANCE',
        primaryStat: `${metrics.pendingOrdersCount}`,
        subLabel: 'Action Queue',
        centerTop: 'APPROVAL & DISPATCH',
        centerHighlight: `${metrics.pendingApprovals} APPROVAL`,
        centerBottom: `${metrics.pendingDispatchCount} DISPATCH (${metrics.pendingDispatchUnits} PKT)`,
        rightCode: 'DSP',
        rightSub: `${metrics.pendingDispatchUnits} Pkts`,
        headlineAmount: `${metrics.pendingOrdersCount} Open`,
        targetModule: metrics.pendingDispatchCount > 0 ? 'dispatch' : 'sales-orders',
        actionLabel: 'PROCESS',
        icon: Truck,
      },
      {
        id: 'outstanding-payments',
        code: 'PAY',
        label: 'Outstanding Payments',
        scope: 'SALES_FINANCE',
        primaryStat: canReadInvoices ? `${metrics.unpaidInvoiceCount} DUE` : 'LOCKED',
        subLabel: 'Receivables',
        centerTop: 'COLLECTIONS LEDGER',
        centerHighlight: canReadInvoices
          ? `₹${metrics.monthlyCashCollected.toFixed(0)} COLLECTED`
          : 'RESTRICTED',
        centerBottom: canReadInvoices ? `${selectedMonth} PERIOD` : 'FINANCE SCOPE',
        rightCode: 'REC',
        rightSub: 'Cash / UPI / Bank',
        headlineAmount: canReadInvoices ? `₹${metrics.outstandingPayments.toFixed(0)}` : 'Protected',
        targetModule: 'payments',
        actionLabel: 'COLLECT',
        icon: Wallet,
      },
    ],
    [canReadInvoices, canReadManufacturing, invoices.length, metrics, permittedIds, selectedMonth],
  );

  const filteredTicketCards = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return ticketCards.filter((card) => {
      if (scopeTab !== 'ALL' && card.scope !== scopeTab) return false;
      if (showAlertsOnly) {
        const isAlertCard =
          (card.id === 'raw-material-stock' && metrics.lowStockCount > 0) ||
          (card.id === 'pending-orders' && metrics.pendingOrdersCount > 0) ||
          (card.id === 'outstanding-payments' && metrics.outstandingPayments > 0);
        if (!isAlertCard) return false;
      }
      if (!q) return true;
      return (
        card.label.toLowerCase().includes(q) ||
        card.code.toLowerCase().includes(q) ||
        card.centerHighlight.toLowerCase().includes(q) ||
        card.actionLabel.toLowerCase().includes(q)
      );
    });
  }, [ticketCards, scopeTab, showAlertsOnly, searchQuery, metrics]);

  // Gauge slider positions for the right dark-teal panel (representing Revenue vs Cost or Good vs Expected)
  const costRatioPct = useMemo(() => {
    if (metrics.monthlyRevenueExclGst <= 0 && metrics.monthlyProductionCost <= 0) return 35;
    const total = Math.max(1, metrics.monthlyRevenueExclGst + metrics.monthlyProductionCost);
    return Math.min(82, Math.max(15, Math.round((metrics.monthlyProductionCost / total) * 100)));
  }, [metrics.monthlyRevenueExclGst, metrics.monthlyProductionCost]);

  const revenueRatioPct = useMemo(() => {
    if (metrics.monthlyRevenueExclGst <= 0) return 75;
    return Math.min(92, Math.max(costRatioPct + 12, 78));
  }, [metrics.monthlyRevenueExclGst, costRatioPct]);

  return (
    <div className="space-y-6">
      {/* TOP ROUNDED WHITE CONTROL BAR (Matching Flight Search Bar in Reference) */}
      <section
        aria-label="Workspace Quick Controls"
        className="bg-white rounded-[24px] p-4 sm:p-5 border border-[#DCE6E6]/80 shadow-xs space-y-3.5"
      >
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
          {/* Quick Search + Swap/Jump Control */}
          <div className="md:col-span-6 flex items-center bg-[#E5EDED] rounded-full h-11 px-3 gap-2">
            <Search className="w-4 h-4 text-[#6C7E7D] shrink-0 ml-1" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search metrics, stock, orders, invoices..."
              aria-label="Filter dashboard metrics"
              className="flex-1 min-w-0 bg-transparent text-xs sm:text-sm font-medium text-[#3B4F4E] placeholder:text-[#6C7E7D] focus:outline-none"
            />
            <button
              type="button"
              onClick={() => onNavigate(quickJumpModule)}
              title="Open selected module"
              aria-label="Swap to quick module"
              className="w-8 h-8 rounded-full bg-[#3B4F4E] text-white flex items-center justify-center shrink-0 hover:bg-[#2C3C3B] transition-colors"
            >
              <ArrowLeftRight className="w-3.5 h-3.5" />
            </button>
            <select
              value={quickJumpModule}
              onChange={(e) => setQuickJumpModule(e.target.value as ModuleId)}
              aria-label="Quick module selector"
              className="bg-transparent text-xs font-semibold text-[#3B4F4E] pr-2 focus:outline-none max-w-[130px] truncate"
            >
              {permittedModules.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          {/* Period Month Selector Pill */}
          <div className="md:col-span-3 flex items-center gap-2.5 bg-[#E5EDED] rounded-full h-11 px-4">
            <Calendar className="w-4 h-4 text-[#3B4F4E] shrink-0" />
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value || getCurrentMonthPrefix())}
              aria-label="Audit and P&L month"
              className="w-full bg-transparent text-xs font-semibold text-[#3B4F4E] font-mono focus:outline-none"
            />
          </div>

          {/* Active Operator Role Pill */}
          <div className="md:col-span-3 flex items-center gap-2.5 bg-[#E5EDED] rounded-full h-11 px-4">
            <UserCheck className="w-4 h-4 text-[#3B4F4E] shrink-0" />
            <span className="text-xs font-semibold uppercase tracking-wide text-[#3B4F4E] truncate">
              {activeRole}
            </span>
          </div>
        </div>

        {/* Second Row: Segmented Tabs + Status Pill + Golden Primary CTA */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
          <div className="md:col-span-6 flex items-center bg-[#E5EDED] rounded-full p-1">
            {(
              [
                { id: 'ALL', label: 'ALL METRICS' },
                { id: 'MANUFACTURING', label: 'MANUFACTURING' },
                { id: 'SALES_FINANCE', label: 'SALES & FINANCE' },
              ] as const
            ).map((tab) => {
              const active = scopeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setScopeTab(tab.id)}
                  className={`flex-1 h-9 px-3 rounded-full text-[11px] font-semibold tracking-wider uppercase transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-[#3B4F4E] text-white shadow-xs'
                      : 'text-[#3B4F4E] hover:bg-white/60'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <div className="md:col-span-3 flex items-center gap-2.5 bg-[#E5EDED] rounded-full h-11 px-4">
            <Factory className="w-4 h-4 text-[#3B4F4E] shrink-0" />
            <span className="text-xs font-semibold uppercase tracking-wide text-[#3B4F4E] truncate">
              {loading ? 'SYNCING...' : 'FIRESTORE LIVE'}
            </span>
          </div>

          <button
            type="button"
            onClick={() => onNavigate(quickJumpModule)}
            className="md:col-span-3 h-11 px-6 rounded-full bg-[#CF9C2D] hover:bg-[#BC8B22] text-white text-xs font-semibold tracking-[0.08em] uppercase transition-colors whitespace-nowrap flex items-center justify-center gap-2"
          >
            <span>OPEN MODULE</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </section>

      {loadError && (
        <div
          role="alert"
          className="p-4 rounded-2xl bg-red-50 border border-red-200 text-sm text-red-700 flex items-start gap-2.5"
        >
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{loadError}</span>
        </div>
      )}

      {/* SECTION TITLE & RIGHT FILTER PILLS (Exact RESULT (n) + FILTER + ROLE/SCOPE layout) */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-1">
        <div>
          <h1 className="text-base sm:text-lg font-semibold tracking-wide uppercase text-[#3B4F4E]">
            Operations Summary ({filteredTicketCards.length})
          </h1>
          <p className="text-xs text-[#6C7E7D]">
            Live Order-to-Audit metrics persisted in Cloud Firestore · Period {selectedMonth}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => setShowAlertsOnly((prev) => !prev)}
            className={`h-9 px-5 rounded-full text-xs font-semibold tracking-wide uppercase border transition-colors whitespace-nowrap ${
              showAlertsOnly
                ? 'bg-[#3B4F4E] text-white border-[#3B4F4E]'
                : 'bg-white text-[#3B4F4E] border-[#DCE6E6] hover:bg-[#E5EDED]'
            }`}
          >
            {showAlertsOnly ? 'SHOWING ALERTS' : 'FILTER ALERTS'}
          </button>

          {userProfile?.role === 'Owner' ? (
            <div className="relative">
              <select
                value={previewRole ?? 'Owner'}
                onChange={(e) => setPreviewRole(e.target.value as ErpRole)}
                aria-label="Preview workspace role"
                className="appearance-none h-9 pl-5 pr-9 rounded-full bg-white border border-[#DCE6E6] text-xs font-semibold tracking-wide uppercase text-[#3B4F4E] focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
              >
                {ERP_ROLES.map((role) => (
                  <option key={role} value={role}>
                    ROLE: {role}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-[#3B4F4E] absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          ) : (
            <span className="h-9 px-5 rounded-full bg-white border border-[#DCE6E6] text-xs font-semibold tracking-wide uppercase text-[#3B4F4E] inline-flex items-center">
              SCOPE: {activeRole}
            </span>
          )}
        </div>
      </div>

      {/* MAIN 2-COLUMN ASYMMETRIC SPLIT (Ticket-Styled White Metrics List + Dark Eucalyptus Right Panel) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-stretch">
        {/* LEFT: Ticket-Styled Stacked Operational Metric Rows */}
        <section className="xl:col-span-8 bg-white rounded-[24px] border border-[#DCE6E6]/80 shadow-xs overflow-hidden flex flex-col justify-between">
          {filteredTicketCards.length === 0 ? (
            <div className="p-10 text-center space-y-3">
              <p className="text-sm font-semibold text-[#3B4F4E]">
                No dashboard metrics match your current filter.
              </p>
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setScopeTab('ALL');
                  setShowAlertsOnly(false);
                }}
                className="px-5 py-2 rounded-full bg-[#CF9C2D] text-white text-xs font-semibold uppercase tracking-wide"
              >
                Reset Filters
              </button>
            </div>
          ) : (
            <div>
              {filteredTicketCards.map((card, idx) => {
                const Icon = card.icon;
                const canOpen = permittedIds.has(card.targetModule);
                return (
                  <div
                    key={card.id}
                    className={`px-5 sm:px-7 py-5 grid grid-cols-1 sm:grid-cols-12 items-center gap-4 hover:bg-[#F7FAFA] transition-colors ${
                      idx > 0 ? 'ticket-seam' : ''
                    }`}
                  >
                    {/* Left Brand / Module Icon + Code */}
                    <div className="sm:col-span-3 flex items-center gap-3.5 min-w-0">
                      <div className="w-11 h-11 rounded-full bg-[#EEF3F3] border border-[#DCE6E6] flex items-center justify-center text-[#3B4F4E] shrink-0">
                        <Icon className="w-5 h-5 text-[#CF9C2D]" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-[#3B4F4E] truncate">
                          {card.label}
                        </p>
                        <p className="text-[11px] text-[#6C7E7D] truncate">{card.subLabel}</p>
                      </div>
                    </div>

                    {/* Center Left Code & Count */}
                    <div className="sm:col-span-2 flex sm:block items-baseline justify-between">
                      <p className="text-base font-bold tracking-wide text-[#3B4F4E] font-mono tabular-nums">
                        {card.code}
                      </p>
                      <p className="text-xs text-[#6C7E7D] font-mono tabular-nums">
                        {card.primaryStat}
                      </p>
                    </div>

                    {/* Center Highlight (Ochre Gold Metric Duration/Highlight) */}
                    <div className="sm:col-span-3 text-left sm:text-center">
                      <p className="text-[10px] font-semibold tracking-wider uppercase text-[#6C7E7D]">
                        {card.centerTop}
                      </p>
                      <p className="text-xs font-bold text-[#CF9C2D] font-mono tabular-nums mt-0.5">
                        {card.centerHighlight}
                      </p>
                      <p className="text-[11px] font-medium text-[#3B4F4E] mt-0.5">
                        {card.centerBottom}
                      </p>
                    </div>

                    {/* Right Target & Ochre Action Button */}
                    <div className="sm:col-span-4 flex items-center justify-between sm:justify-end gap-4">
                      <div className="text-left sm:text-right">
                        <p className="text-sm sm:text-base font-bold text-[#3B4F4E] font-mono tabular-nums">
                          {card.headlineAmount}
                        </p>
                        <p className="text-[11px] text-[#6C7E7D]">{card.rightSub}</p>
                      </div>
                      {canOpen ? (
                        <button
                          type="button"
                          onClick={() => onNavigate(card.targetModule)}
                          className="min-h-[36px] px-4 py-1.5 rounded-full bg-[#CF9C2D] hover:bg-[#BC8B22] text-white text-[11px] font-semibold tracking-wider uppercase transition-colors whitespace-nowrap shrink-0"
                        >
                          {card.actionLabel}
                        </button>
                      ) : (
                        <span className="px-3 py-1.5 rounded-full bg-[#EEF3F3] text-[#6C7E7D] text-[10px] font-semibold uppercase whitespace-nowrap">
                          Protected
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* RIGHT: Dark Eucalyptus Teal Feature Panel (Exact Route Arc + Dark Filter & Dual-Marker Range) */}
        <aside className="xl:col-span-4 bg-[#3B4F4E] text-white rounded-[24px] overflow-hidden flex flex-col justify-between shadow-sm">
          {/* Top Header & Dotted Supply-Chain Map Arc */}
          <div className="p-6 pb-4 space-y-5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-[#AFC2C0]">
                  INTAKE
                </p>
                <p className="text-xl font-bold tracking-wide text-white mt-0.5">RAW</p>
              </div>
              <div className="text-center pt-3">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-[#CF9C2D]">
                  ORDER-TO-AUDIT
                </p>
                <p className="text-[11px] text-[#AFC2C0] font-mono tabular-nums mt-0.5">
                  {metrics.completedBatchesCount} BATCHES · {metrics.avgYieldPct.toFixed(0)}% YIELD
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-[#AFC2C0]">
                  OUTPUT
                </p>
                <p className="text-xl font-bold tracking-wide text-white mt-0.5">AUDIT</p>
              </div>
            </div>

            {/* Dotted Map Background + Golden Supply Arc */}
            <div className="relative py-2">
              <svg viewBox="0 0 320 130" aria-hidden="true" className="w-full h-32">
                <g fill="#5C7473">
                  {Array.from({ length: 22 }).map((_, xi) =>
                    Array.from({ length: 9 }).map((__, yi) => {
                      const x = 18 + xi * 13.5;
                      const y = 14 + yi * 13;
                      const hole =
                        (xi < 3 && yi > 5) ||
                        (xi > 18 && yi < 2) ||
                        (xi > 7 && xi < 12 && yi > 6) ||
                        (xi === 14 && yi < 2);
                      return hole ? null : <circle key={`${xi}-${yi}`} cx={x} cy={y} r="1.7" />;
                    }),
                  )}
                </g>

                {/* Curved Golden Arc */}
                <path
                  d="M 56 84 Q 160 12 264 78"
                  fill="none"
                  stroke="#CF9C2D"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <circle cx="56" cy="84" r="4.5" fill="#CF9C2D" />
                <circle cx="264" cy="78" r="4.5" fill="#CF9C2D" />

                {/* Center Factory Node */}
                <circle cx="160" cy="48" r="10" fill="#2C3C3B" stroke="#CF9C2D" strokeWidth="1.5" />
                <text
                  x="160"
                  y="51.5"
                  textAnchor="middle"
                  fill="#CF9C2D"
                  fontSize="8"
                  fontWeight="700"
                >
                  MFG
                </text>

                <text x="56" y="102" textAnchor="middle" fill="#FFFFFF" fontSize="9" fontWeight="600">
                  PURCHASE
                </text>
                <text x="264" y="96" textAnchor="middle" fill="#FFFFFF" fontSize="9" fontWeight="600">
                  DISPATCH
                </text>
              </svg>
            </div>
          </div>

          {/* Lower Dark Inset Panel (Matching NON STOP / ONE STOP / MORE STOP + Dual Slider) */}
          <div className="bg-[#2C3C3B] p-6 space-y-5">
            {/* Three Interactive Mode Tabs */}
            <div className="flex items-center justify-between gap-2">
              {(
                [
                  { id: 'FLOW', label: 'P&L FLOW' },
                  { id: 'ALERTS', label: `ALERTS (${metrics.lowStockCount})` },
                  { id: 'YIELD', label: 'YIELD' },
                ] as const
              ).map((tab) => {
                const active = rightMode === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setRightMode(tab.id)}
                    className={`flex-1 h-8 px-2.5 rounded-full text-[10px] font-semibold tracking-wider uppercase transition-colors whitespace-nowrap ${
                      active
                        ? 'bg-[#CF9C2D] text-white'
                        : 'text-[#DCE6E5] hover:bg-[#3B4F4E]'
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {rightMode === 'FLOW' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-[#AFC2C0]">
                  <span>Monthly Cost vs Revenue ({selectedMonth})</span>
                </div>

                {/* Dual-Marker Visual Track matching Reference Price Slider */}
                <div className="pt-2 pb-6 relative">
                  <div className="h-0.5 w-full bg-[#4B6160] relative">
                    <div
                      className="h-0.5 bg-[#CF9C2D] absolute top-0"
                      style={{
                        left: `${costRatioPct}%`,
                        width: `${Math.max(10, revenueRatioPct - costRatioPct)}%`,
                      }}
                    />
                  </div>
                  {/* Left Marker: Production Cost */}
                  <div
                    className="absolute top-0 -translate-x-1/2 -translate-y-1.5 flex flex-col items-center"
                    style={{ left: `${costRatioPct}%` }}
                  >
                    <span className="w-3.5 h-3.5 rounded-full bg-[#CF9C2D] border-2 border-[#2C3C3B]" />
                    <span className="mt-2 px-2.5 py-0.5 rounded-full bg-[#CF9C2D] text-[10px] font-mono font-semibold text-white whitespace-nowrap">
                      {canReadFinanceSummary
                        ? `Cost ₹${metrics.monthlyProductionCost.toFixed(0)}`
                        : 'Cost'}
                    </span>
                  </div>
                  {/* Right Marker: Revenue */}
                  <div
                    className="absolute top-0 -translate-x-1/2 -translate-y-1.5 flex flex-col items-center"
                    style={{ left: `${revenueRatioPct}%` }}
                  >
                    <span className="w-3.5 h-3.5 rounded-full bg-[#CF9C2D] border-2 border-[#2C3C3B]" />
                    <span className="mt-2 px-2.5 py-0.5 rounded-full bg-[#CF9C2D] text-[10px] font-mono font-semibold text-white whitespace-nowrap">
                      {canReadInvoices
                        ? `Rev ₹${metrics.monthlyRevenueExclGst.toFixed(0)}`
                        : 'Rev'}
                    </span>
                  </div>
                </div>

                <div className="pt-2 border-t border-[#3B4F4E] grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-[#AFC2C0]">
                      Gross Mfg P&L
                    </p>
                    <p className="font-mono font-semibold text-white mt-0.5 tabular-nums">
                      {canReadFinanceSummary
                        ? `${metrics.monthlyMfgProfit < 0 ? '-' : ''}₹${Math.abs(metrics.monthlyMfgProfit).toFixed(2)}`
                        : 'Protected'}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] uppercase tracking-wider text-[#AFC2C0]">
                      Margin / GST
                    </p>
                    <p className="font-mono font-semibold text-[#CF9C2D] mt-0.5 tabular-nums">
                      {canReadFinanceSummary && metrics.monthlyMarginPercent !== null
                        ? `${metrics.monthlyMarginPercent.toFixed(1)}%`
                        : canReadInvoices
                          ? `GST ₹${metrics.monthlyGstCollected.toFixed(0)}`
                          : '—'}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {rightMode === 'ALERTS' && (
              <div className="space-y-2.5">
                {metrics.lowStockAlerts.length === 0 ? (
                  <p className="text-xs text-[#C8D7D6] py-3">
                    All cataloged raw materials and finished snack items are above minimum stock
                    levels.
                  </p>
                ) : (
                  metrics.lowStockAlerts.slice(0, 3).map((alert) => (
                    <div
                      key={alert.id}
                      className="flex items-center justify-between gap-2 bg-[#3B4F4E]/70 rounded-xl px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-white truncate">{alert.name}</p>
                        <p className="text-[10px] font-mono text-[#AFC2C0]">
                          {alert.current}/{alert.minimum} {alert.unit}
                        </p>
                      </div>
                      {permittedIds.has(alert.targetModule) && (
                        <button
                          type="button"
                          onClick={() => onNavigate(alert.targetModule)}
                          className="px-2.5 py-1 rounded-full bg-[#CF9C2D] text-[10px] font-semibold uppercase text-white whitespace-nowrap"
                        >
                          Restock
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}

            {rightMode === 'YIELD' && (
              <div className="space-y-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-[#AFC2C0]">Good Packets</span>
                  <span className="font-mono font-semibold text-white tabular-nums">
                    {metrics.totalGood} / {metrics.totalExpected} pkts
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[#AFC2C0]">Damaged / Rejected</span>
                  <span className="font-mono font-semibold text-[#CF9C2D] tabular-nums">
                    {metrics.totalDamaged} pkts
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[#AFC2C0]">Net Yield Variance</span>
                  <span className="font-mono font-semibold text-white tabular-nums">
                    {metrics.netYieldVariancePct > 0 ? '+' : ''}
                    {metrics.netYieldVariancePct.toFixed(1)}%
                  </span>
                </div>
                {permittedIds.has('production') && (
                  <button
                    type="button"
                    onClick={() => onNavigate('production')}
                    className="w-full h-8 rounded-full bg-[#CF9C2D] hover:bg-[#BC8B22] text-white text-[10px] font-semibold uppercase tracking-wider transition-colors"
                  >
                    Open Production Batches
                  </button>
                )}
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* LOWER ANALYTICS ROW: Monthly P&L Detail + Low Stock Register + Production Variance */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Monthly Revenue & P&L Summary Card */}
        <section className="xl:col-span-6 bg-white rounded-[24px] p-6 border border-[#DCE6E6]/80 shadow-xs space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <TrendingUp className="w-4 h-4 text-[#CF9C2D] shrink-0" />
              <h2 className="text-sm font-semibold uppercase tracking-wide text-[#3B4F4E]">
                Monthly Revenue & P&L ({selectedMonth})
              </h2>
            </div>
            {permittedIds.has('reports') && (
              <button
                type="button"
                onClick={() => onNavigate('reports')}
                className="px-4 py-1.5 rounded-full bg-[#EEF3F3] hover:bg-[#E5EDED] text-[#3B4F4E] text-[11px] font-semibold uppercase tracking-wide transition-colors whitespace-nowrap"
              >
                Audit Report
              </button>
            )}
          </div>

          {!canReadInvoices ? (
            <p className="text-xs text-[#6C7E7D] bg-[#EEF3F3] rounded-2xl p-4">
              Revenue and Profit & Loss metrics are restricted to Owner, Admin, and
              Accountant/Auditor roles.
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-[#EEF3F3] rounded-2xl p-3.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[#6C7E7D]">
                  Gross Revenue
                </p>
                <p className="mt-1 font-mono text-sm sm:text-base font-bold text-[#3B4F4E] tabular-nums">
                  ₹{metrics.monthlyGrossRevenue.toFixed(0)}
                </p>
              </div>
              <div className="bg-[#EEF3F3] rounded-2xl p-3.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[#6C7E7D]">
                  Cash Collected
                </p>
                <p className="mt-1 font-mono text-sm sm:text-base font-bold text-emerald-700 tabular-nums">
                  ₹{metrics.monthlyCashCollected.toFixed(0)}
                </p>
              </div>
              <div className="bg-[#EEF3F3] rounded-2xl p-3.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[#6C7E7D]">
                  Prod. Cost
                </p>
                <p className="mt-1 font-mono text-sm sm:text-base font-bold text-[#3B4F4E] tabular-nums">
                  {canReadFinanceSummary ? `₹${metrics.monthlyProductionCost.toFixed(0)}` : 'Scoped'}
                </p>
              </div>
              <div className="bg-[#EEF3F3] rounded-2xl p-3.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[#6C7E7D]">
                  Mfg Profit
                </p>
                <p
                  className={`mt-1 font-mono text-sm sm:text-base font-bold tabular-nums ${
                    !canReadFinanceSummary
                      ? 'text-[#3B4F4E]'
                      : metrics.monthlyMfgProfit >= 0
                        ? 'text-emerald-700'
                        : 'text-red-700'
                  }`}
                >
                  {canReadFinanceSummary
                    ? `${metrics.monthlyMfgProfit < 0 ? '-' : ''}₹${Math.abs(metrics.monthlyMfgProfit).toFixed(0)}`
                    : 'Scoped'}
                </p>
              </div>
            </div>
          )}
        </section>

        {/* Low Stock Alerts & Quick Operator Session Summary */}
        <section className="xl:col-span-6 bg-white rounded-[24px] p-6 border border-[#DCE6E6]/80 shadow-xs space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <AlertTriangle
                className={`w-4 h-4 shrink-0 ${
                  metrics.lowStockCount > 0 ? 'text-[#CF9C2D]' : 'text-emerald-600'
                }`}
              />
              <h2 className="text-sm font-semibold uppercase tracking-wide text-[#3B4F4E]">
                Low Stock Alerts & Session
              </h2>
            </div>
            <span className="text-xs font-mono font-semibold text-[#6C7E7D] tabular-nums">
              {metrics.lowStockCount} alerts
            </span>
          </div>

          {metrics.lowStockAlerts.length > 0 ? (
            <div className="divide-y divide-dashed divide-[#DCE6E6]">
              {metrics.lowStockAlerts.slice(0, 4).map((alert) => (
                <div key={alert.id} className="py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-[#3B4F4E] truncate">{alert.name}</p>
                    <p className="text-[11px] font-mono text-[#6C7E7D]">
                      {alert.code} · {alert.category}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-xs font-mono font-bold text-red-700 tabular-nums">
                      {alert.current}/{alert.minimum} {alert.unit}
                    </span>
                    {permittedIds.has(alert.targetModule) && (
                      <button
                        type="button"
                        onClick={() => onNavigate(alert.targetModule)}
                        className="px-3 py-1 rounded-full bg-[#CF9C2D] text-white text-[10px] font-semibold uppercase"
                      >
                        Restock
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-[#EEF3F3] rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <ShieldCheck className="w-4 h-4 text-[#CF9C2D] shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-semibold text-[#3B4F4E]">
                    {userProfile?.displayName ?? 'Operator'} ({activeRole})
                  </p>
                  <p className="text-[11px] text-[#6C7E7D] mt-0.5">
                    {ROLE_DESCRIPTIONS[activeRole].summary}
                  </p>
                </div>
              </div>
              {permittedIds.has('production') && (
                <button
                  type="button"
                  onClick={() => onNavigate('production')}
                  className="px-4 py-1.5 rounded-full bg-[#3B4F4E] text-white text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap shrink-0 flex items-center gap-1.5"
                >
                  <ClipboardList className="w-3.5 h-3.5 text-[#CF9C2D]" />
                  <span>Production</span>
                </button>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
