import { roundCurrency, roundQuantity } from './validation';
import type {
  Customer,
  Dispatch,
  DispatchItem,
  InventoryLedgerEntry,
  Invoice,
  InvoiceItem,
  Payment,
  Product,
  ProductionConsumption,
  ProductionCosting,
  ProductionOrder,
  ProductionVariance,
  Purchase,
  PurchaseItem,
  RawMaterial,
  SalesOrder,
  SalesOrderItem,
  StockBalance,
  Supplier,
} from '../types/erp';

export const PACKAGING_MATERIAL_CATEGORIES = new Set<string>([
  'Packaging Film & Pouches',
  'Cartons & Labels',
]);

export function isPackagingMaterial(category: string): boolean {
  return PACKAGING_MATERIAL_CATEGORIES.has(category);
}

export interface MaterialWacValuation {
  rawMaterialId: string;
  materialCode: string;
  materialName: string;
  category: string;
  isPackaging: boolean;
  unit: RawMaterial['unit'];
  openingStock: number;
  openingUnitRate: number;
  receivedQuantity: number;
  receivedSubtotal: number;
  wacUnitCost: number;
  valuationSource: 'Weighted Average Cost' | 'Opening / Master Rate';
}

export function calculateWeightedAverageMaterialCosts(
  materials: RawMaterial[],
  purchases: Purchase[],
  purchaseItems: PurchaseItem[],
): Map<string, MaterialWacValuation> {
  const receivedPurchaseIds = new Set(
    purchases.filter((p) => p.receiptStatus === 'Received').map((p) => p.id),
  );

  const receivedTotals = new Map<string, { qty: number; subtotal: number }>();
  purchaseItems.forEach((item) => {
    if (!receivedPurchaseIds.has(item.purchaseId)) return;
    const prev = receivedTotals.get(item.rawMaterialId) ?? { qty: 0, subtotal: 0 };
    const lineCost = Number.isFinite(item.lineSubtotal)
      ? item.lineSubtotal
      : item.quantity * item.unitPrice;
    receivedTotals.set(item.rawMaterialId, {
      qty: roundQuantity(prev.qty + item.quantity),
      subtotal: roundCurrency(prev.subtotal + lineCost),
    });
  });

  const map = new Map<string, MaterialWacValuation>();
  materials.forEach((mat) => {
    const rec = receivedTotals.get(mat.id) ?? { qty: 0, subtotal: 0 };
    const openingQty = Math.max(0, mat.openingStock);
    const openingRate = Math.max(0, mat.purchasePrice);
    const openingValue = openingQty * openingRate;
    const totalQty = openingQty + rec.qty;
    const totalVal = openingValue + rec.subtotal;

    const wacUnitCost =
      totalQty > 0
        ? roundCurrency(totalVal / totalQty)
        : roundCurrency(openingRate);

    map.set(mat.id, {
      rawMaterialId: mat.id,
      materialCode: mat.materialCode,
      materialName: mat.name,
      category: mat.category,
      isPackaging: isPackagingMaterial(mat.category),
      unit: mat.unit,
      openingStock: openingQty,
      openingUnitRate: openingRate,
      receivedQuantity: rec.qty,
      receivedSubtotal: rec.subtotal,
      wacUnitCost,
      valuationSource: rec.qty > 0 ? 'Weighted Average Cost' : 'Opening / Master Rate',
    });
  });

  return map;
}

export interface BatchCostBreakdown {
  productionOrderId: string;
  orderNumber: string;
  productId: string;
  productName: string;
  productSku: string;
  packetSize: string;
  productionDate: string;
  status: ProductionOrder['status'];
  plannedQuantity: number;
  actualGoodQuantity: number;
  damagedQuantity: number;
  rawMaterialCost: number;
  packagingMaterialCost: number;
  labourCost: number;
  gasElectricityCost: number;
  otherExpenses: number;
  totalOverheadCost: number;
  totalProductionCost: number;
  costPerGoodPacket: number | null;
  sellingPricePerPacket: number | null;
  profitPerPacket: number | null;
  profitMarginPercent: number | null;
  hasOverheadEntry: boolean;
  costingRecord: ProductionCosting | null;
  materialLineDetails: Array<{
    materialName: string;
    materialCode: string;
    category: string;
    isPackaging: boolean;
    quantityUsed: number;
    unit: string;
    wacUnitCost: number;
    totalCost: number;
    valuationSource: string;
  }>;
}

export interface ProductCostSummary {
  productId: string;
  productName: string;
  productSku: string;
  packetSize: string;
  batchCount: number;
  batchesWithOverheadCount: number;
  totalGoodPackets: number;
  totalDamagedPackets: number;
  rawMaterialCost: number;
  packagingMaterialCost: number;
  labourCost: number;
  gasElectricityCost: number;
  otherExpenses: number;
  totalProductionCost: number;
  costPerGoodPacket: number | null;
  sellingPricePerPacket: number | null;
  profitPerPacket: number | null;
  profitMarginPercent: number | null;
  estimatedTotalRevenue: number | null;
  estimatedTotalProfit: number | null;
}

export function calculateBatchAndProductCosting(params: {
  productionOrders: ProductionOrder[];
  consumptions: ProductionConsumption[];
  materials: RawMaterial[];
  products: Product[];
  wacMap: Map<string, MaterialWacValuation>;
  costings: ProductionCosting[];
}): {
  batches: BatchCostBreakdown[];
  productSummaries: ProductCostSummary[];
} {
  const materialMap = new Map(params.materials.map((m) => [m.id, m]));
  const productMap = new Map(params.products.map((p) => [p.id, p]));
  const costingMap = new Map(params.costings.map((c) => [c.productionOrderId, c]));
  const consumptionByOrder = new Map<string, ProductionConsumption[]>();

  params.consumptions.forEach((c) => {
    const list = consumptionByOrder.get(c.productionOrderId) ?? [];
    list.push(c);
    consumptionByOrder.set(c.productionOrderId, list);
  });

  const batches: BatchCostBreakdown[] = [];

  params.productionOrders
    .filter((o) => o.status !== 'Cancelled')
    .forEach((order) => {
      const lines = consumptionByOrder.get(order.id) ?? [];
      let rawMaterialCost = 0;
      let packagingMaterialCost = 0;

      const materialLineDetails = lines.map((line) => {
        const mat = materialMap.get(line.rawMaterialId);
        const wac = params.wacMap.get(line.rawMaterialId);
        const category = mat?.category ?? 'Other';
        const packaging = wac?.isPackaging ?? isPackagingMaterial(category);
        const qtyUsed =
          order.status === 'Completed'
            ? line.actualConsumedQuantity
            : line.issuedQuantity > 0
              ? line.issuedQuantity
              : line.expectedQuantity;

        const unitCost = wac
          ? wac.wacUnitCost
          : line.unitCost > 0
            ? line.unitCost
            : mat?.purchasePrice ?? 0;

        const totalCost = roundCurrency(qtyUsed * unitCost);
        if (packaging) {
          packagingMaterialCost = roundCurrency(packagingMaterialCost + totalCost);
        } else {
          rawMaterialCost = roundCurrency(rawMaterialCost + totalCost);
        }

        return {
          materialName: line.materialName,
          materialCode: line.materialCode,
          category,
          isPackaging: packaging,
          quantityUsed: roundQuantity(qtyUsed),
          unit: line.unit,
          wacUnitCost: roundCurrency(unitCost),
          totalCost,
          valuationSource: wac?.valuationSource ?? 'Batch Consumption Rate',
        };
      });

      const overhead = costingMap.get(order.id) ?? null;
      const labourCost = overhead ? roundCurrency(overhead.labourCost) : 0;
      const gasElectricityCost = overhead ? roundCurrency(overhead.gasElectricityCost) : 0;
      const otherExpenses = overhead ? roundCurrency(overhead.otherExpenses) : 0;
      const totalOverheadCost = roundCurrency(labourCost + gasElectricityCost + otherExpenses);
      const totalProductionCost = roundCurrency(
        rawMaterialCost + packagingMaterialCost + totalOverheadCost,
      );

      const product = productMap.get(order.productId) ?? null;
      const sellingPricePerPacket = product ? roundCurrency(product.sellingPrice) : null;
      const costPerGoodPacket =
        order.actualGoodQuantity > 0
          ? roundCurrency(totalProductionCost / order.actualGoodQuantity)
          : null;
      const profitPerPacket =
        costPerGoodPacket !== null && sellingPricePerPacket !== null
          ? roundCurrency(sellingPricePerPacket - costPerGoodPacket)
          : null;
      const profitMarginPercent =
        profitPerPacket !== null && sellingPricePerPacket !== null && sellingPricePerPacket > 0
          ? roundCurrency((profitPerPacket / sellingPricePerPacket) * 100)
          : null;

      batches.push({
        productionOrderId: order.id,
        orderNumber: order.orderNumber,
        productId: order.productId,
        productName: order.productName,
        productSku: order.productSku,
        packetSize: order.packetSize,
        productionDate: order.productionDate,
        status: order.status,
        plannedQuantity: order.plannedQuantity,
        actualGoodQuantity: order.actualGoodQuantity,
        damagedQuantity: order.damagedQuantity,
        rawMaterialCost,
        packagingMaterialCost,
        labourCost,
        gasElectricityCost,
        otherExpenses,
        totalOverheadCost,
        totalProductionCost,
        costPerGoodPacket,
        sellingPricePerPacket,
        profitPerPacket,
        profitMarginPercent,
        hasOverheadEntry: overhead !== null,
        costingRecord: overhead,
        materialLineDetails,
      });
    });

  batches.sort(
    (a, b) =>
      b.productionDate.localeCompare(a.productionDate) ||
      b.orderNumber.localeCompare(a.orderNumber),
  );

  // Product-wise aggregation across completed batches with good output > 0
  const productGroups = new Map<string, BatchCostBreakdown[]>();
  batches
    .filter((b) => b.status === 'Completed' && b.actualGoodQuantity > 0)
    .forEach((b) => {
      const list = productGroups.get(b.productId) ?? [];
      list.push(b);
      productGroups.set(b.productId, list);
    });

  const productSummaries: ProductCostSummary[] = [];
  productGroups.forEach((group, productId) => {
    const first = group[0];
    const product = productMap.get(productId) ?? null;
    const totalGoodPackets = roundQuantity(
      group.reduce((s, b) => s + b.actualGoodQuantity, 0),
    );
    const totalDamagedPackets = roundQuantity(
      group.reduce((s, b) => s + b.damagedQuantity, 0),
    );
    const rawMaterialCost = roundCurrency(group.reduce((s, b) => s + b.rawMaterialCost, 0));
    const packagingMaterialCost = roundCurrency(
      group.reduce((s, b) => s + b.packagingMaterialCost, 0),
    );
    const labourCost = roundCurrency(group.reduce((s, b) => s + b.labourCost, 0));
    const gasElectricityCost = roundCurrency(
      group.reduce((s, b) => s + b.gasElectricityCost, 0),
    );
    const otherExpenses = roundCurrency(group.reduce((s, b) => s + b.otherExpenses, 0));
    const totalProductionCost = roundCurrency(
      rawMaterialCost +
        packagingMaterialCost +
        labourCost +
        gasElectricityCost +
        otherExpenses,
    );
    const costPerGoodPacket =
      totalGoodPackets > 0 ? roundCurrency(totalProductionCost / totalGoodPackets) : null;
    const sellingPricePerPacket = product ? roundCurrency(product.sellingPrice) : null;
    const profitPerPacket =
      costPerGoodPacket !== null && sellingPricePerPacket !== null
        ? roundCurrency(sellingPricePerPacket - costPerGoodPacket)
        : null;
    const profitMarginPercent =
      profitPerPacket !== null && sellingPricePerPacket !== null && sellingPricePerPacket > 0
        ? roundCurrency((profitPerPacket / sellingPricePerPacket) * 100)
        : null;
    const estimatedTotalRevenue =
      sellingPricePerPacket !== null
        ? roundCurrency(totalGoodPackets * sellingPricePerPacket)
        : null;
    const estimatedTotalProfit =
      estimatedTotalRevenue !== null
        ? roundCurrency(estimatedTotalRevenue - totalProductionCost)
        : null;

    productSummaries.push({
      productId,
      productName: first.productName,
      productSku: first.productSku,
      packetSize: first.packetSize,
      batchCount: group.length,
      batchesWithOverheadCount: group.filter((b) => b.hasOverheadEntry).length,
      totalGoodPackets,
      totalDamagedPackets,
      rawMaterialCost,
      packagingMaterialCost,
      labourCost,
      gasElectricityCost,
      otherExpenses,
      totalProductionCost,
      costPerGoodPacket,
      sellingPricePerPacket,
      profitPerPacket,
      profitMarginPercent,
      estimatedTotalRevenue,
      estimatedTotalProfit,
    });
  });

  productSummaries.sort((a, b) => b.totalProductionCost - a.totalProductionCost);

  return { batches, productSummaries };
}

export interface StockReconciliationRow {
  balanceId: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  stockCategory: StockBalance['stockCategory'];
  unit: StockBalance['unit'];
  masterOpeningStock: number;
  periodOpeningStock: number;
  periodInflow: number;
  periodOutflow: number;
  periodClosingBalance: number;
  liveSystemBalance: number;
  minimumStockLevel: number;
  isLowStock: boolean;
}

export interface CustomerAuditSummary {
  customerId: string;
  customerName: string;
  customerGstin: string;
  invoiceCount: number;
  periodBilled: number;
  periodPaid: number;
  allTimeBilled: number;
  allTimePaid: number;
  outstandingBalance: number;
  openInvoices: number;
}

export interface ProductAuditSummary {
  productId: string;
  productName: string;
  productSku: string;
  packetSize: string;
  batchesCompleted: number;
  producedGoodQty: number;
  producedDamagedQty: number;
  totalManufacturingCost: number;
  avgCostPerPacket: number | null;
  orderedQty: number;
  invoicedQty: number;
  salesTaxableValue: number;
  salesGstTotal: number;
  sellingPrice: number;
}

export interface ProfitAndLossSummary {
  salesRevenueExclGst: number;
  gstCollected: number;
  grossSalesInclGst: number;
  purchasesExclGst: number;
  inputPurchaseGst: number;
  rawMaterialConsumedCost: number;
  packagingConsumedCost: number;
  labourExpenses: number;
  gasElectricityExpenses: number;
  otherProductionExpenses: number;
  totalProductionCost: number;
  grossManufacturingProfit: number;
  grossMarginPercent: number | null;
  cashCollectedInPeriod: number;
  totalOutstandingReceivables: number;
}

export interface MonthlyAuditDataset {
  fromDate: string;
  toDate: string;
  stockReconciliation: StockReconciliationRow[];
  rawMaterialBalances: StockReconciliationRow[];
  finishedGoodsBalances: StockReconciliationRow[];
  damagedBalances: StockReconciliationRow[];
  purchasesInPeriod: Purchase[];
  purchaseItemsInPeriod: PurchaseItem[];
  productionOrdersInPeriod: ProductionOrder[];
  consumptionsInPeriod: Array<ProductionConsumption & { orderNumber: string; productionDate: string; productName: string }>;
  variancesInPeriod: ProductionVariance[];
  damagedConsumptionsInPeriod: Array<ProductionConsumption & { orderNumber: string; productionDate: string; productName: string }>;
  salesOrdersInPeriod: SalesOrder[];
  invoicesInPeriod: Invoice[];
  dispatchesInPeriod: Dispatch[];
  paymentsInPeriod: Payment[];
  costingsInPeriod: ProductionCosting[];
  batchCostingsInPeriod: BatchCostBreakdown[];
  productCostSummariesInPeriod: ProductCostSummary[];
  customerSummaries: CustomerAuditSummary[];
  productSummaries: ProductAuditSummary[];
  profitAndLoss: ProfitAndLossSummary;
}

export function buildMonthlyAuditDataset(params: {
  fromDate: string;
  toDate: string;
  rawMaterials: RawMaterial[];
  products: Product[];
  customers: Customer[];
  purchases: Purchase[];
  purchaseItems: PurchaseItem[];
  productionOrders: ProductionOrder[];
  productionConsumption: ProductionConsumption[];
  productionVariances: ProductionVariance[];
  productionCostings: ProductionCosting[];
  stockBalances: StockBalance[];
  inventoryLedger: InventoryLedgerEntry[];
  salesOrders: SalesOrder[];
  salesOrderItems: SalesOrderItem[];
  invoices: Invoice[];
  invoiceItems: InvoiceItem[];
  dispatches: Dispatch[];
  payments: Payment[];
}): MonthlyAuditDataset {
  const inRange = (d: string) => d >= params.fromDate && d <= params.toDate;
  const beforeStart = (d: string) => d < params.fromDate;

  // Ledger grouping by stockCategory + itemId
  const ledgerByKey = new Map<string, InventoryLedgerEntry[]>();
  params.inventoryLedger.forEach((entry) => {
    const key = `${entry.stockCategory}::${entry.itemId}`;
    const list = ledgerByKey.get(key) ?? [];
    list.push(entry);
    ledgerByKey.set(key, list);
  });

  const stockReconciliation: StockReconciliationRow[] = params.stockBalances.map((sb) => {
    const key = `${sb.stockCategory}::${sb.itemId}`;
    const entries = ledgerByKey.get(key) ?? [];
    const hasOpeningLedger = entries.some((e) => e.transactionType === 'Opening Stock');

    let preDelta = hasOpeningLedger ? 0 : sb.openingStock;
    let periodInflow = 0;
    let periodOutflow = 0;

    entries.forEach((e) => {
      if (beforeStart(e.transactionDate)) {
        preDelta += e.quantityIn - e.quantityOut;
      } else if (inRange(e.transactionDate)) {
        periodInflow += e.quantityIn;
        periodOutflow += e.quantityOut;
      }
    });

    const periodOpeningStock = roundQuantity(preDelta);
    const cleanIn = roundQuantity(periodInflow);
    const cleanOut = roundQuantity(periodOutflow);
    const periodClosingBalance = roundQuantity(periodOpeningStock + cleanIn - cleanOut);

    return {
      balanceId: sb.id,
      itemId: sb.itemId,
      itemCode: sb.itemCode,
      itemName: sb.itemName,
      stockCategory: sb.stockCategory,
      unit: sb.unit,
      masterOpeningStock: sb.openingStock,
      periodOpeningStock,
      periodInflow: cleanIn,
      periodOutflow: cleanOut,
      periodClosingBalance,
      liveSystemBalance: sb.currentBalance,
      minimumStockLevel: sb.minimumStockLevel,
      isLowStock: sb.currentBalance <= sb.minimumStockLevel,
    };
  });

  stockReconciliation.sort(
    (a, b) => a.stockCategory.localeCompare(b.stockCategory) || a.itemName.localeCompare(b.itemName),
  );

  const purchasesInPeriod = params.purchases.filter((p) => inRange(p.purchaseDate));
  const purchasePeriodIds = new Set(purchasesInPeriod.map((p) => p.id));
  const purchaseItemsInPeriod = params.purchaseItems.filter((pi) => purchasePeriodIds.has(pi.purchaseId));

  const productionOrdersInPeriod = params.productionOrders.filter((o) => inRange(o.productionDate));
  const orderMap = new Map(params.productionOrders.map((o) => [o.id, o]));
  const periodOrderIds = new Set(productionOrdersInPeriod.map((o) => o.id));

  const consumptionsInPeriod = params.productionConsumption
    .filter((c) => periodOrderIds.has(c.productionOrderId))
    .map((c) => {
      const ord = orderMap.get(c.productionOrderId);
      return {
        ...c,
        orderNumber: ord?.orderNumber ?? c.productionOrderId,
        productionDate: ord?.productionDate ?? '',
        productName: ord?.productName ?? '',
      };
    });

  const damagedConsumptionsInPeriod = consumptionsInPeriod.filter(
    (c) => c.damagedMaterialQuantity > 0,
  );

  const variancesInPeriod = params.productionVariances.filter((v) => inRange(v.productionDate));
  const salesOrdersInPeriod = params.salesOrders.filter((so) => inRange(so.orderDate));
  const invoicesInPeriod = params.invoices.filter((inv) => inRange(inv.invoiceDate));
  const dispatchesInPeriod = params.dispatches.filter((d) => inRange(d.dispatchDate));
  const paymentsInPeriod = params.payments.filter((p) => inRange(p.paymentDate));
  const costingsInPeriod = params.productionCostings.filter((c) => inRange(c.productionDate));

  const wacMap = calculateWeightedAverageMaterialCosts(
    params.rawMaterials,
    params.purchases,
    params.purchaseItems,
  );

  const {
    batches: batchCostingsInPeriod,
    productSummaries: productCostSummariesInPeriod,
  } = calculateBatchAndProductCosting({
    productionOrders: productionOrdersInPeriod,
    consumptions: params.productionConsumption,
    materials: params.rawMaterials,
    products: params.products,
    wacMap,
    costings: params.productionCostings,
  });

  // Customer-wise summary (all-time outstanding + period activity)
  const customerLookup = new Map(params.customers.map((c) => [c.id, c]));
  const custAcc = new Map<string, CustomerAuditSummary>();

  const ensureCustomer = (customerId: string, customerName: string, customerGstin: string) => {
    const existing = custAcc.get(customerId);
    if (existing) return existing;
    const master = customerLookup.get(customerId);
    const created: CustomerAuditSummary = {
      customerId,
      customerName: master?.name ?? customerName,
      customerGstin: master?.gstin ?? customerGstin,
      invoiceCount: 0,
      periodBilled: 0,
      periodPaid: 0,
      allTimeBilled: 0,
      allTimePaid: 0,
      outstandingBalance: 0,
      openInvoices: 0,
    };
    custAcc.set(customerId, created);
    return created;
  };

  params.invoices.forEach((inv) => {
    const row = ensureCustomer(inv.customerId, inv.customerName, inv.customerGstin);
    row.invoiceCount += 1;
    row.allTimeBilled = roundCurrency(row.allTimeBilled + inv.grandTotal);
    row.allTimePaid = roundCurrency(row.allTimePaid + inv.amountPaid);
    row.outstandingBalance = roundCurrency(row.outstandingBalance + inv.outstandingBalance);
    if (inv.outstandingBalance > 0) row.openInvoices += 1;
    if (inRange(inv.invoiceDate)) {
      row.periodBilled = roundCurrency(row.periodBilled + inv.grandTotal);
    }
  });

  paymentsInPeriod.forEach((pay) => {
    const row = ensureCustomer(pay.customerId, pay.customerName, '');
    row.periodPaid = roundCurrency(row.periodPaid + pay.amount);
  });

  const customerSummaries = Array.from(custAcc.values()).sort(
    (a, b) => b.outstandingBalance - a.outstandingBalance || b.allTimeBilled - a.allTimeBilled,
  );

  // Product-wise summary (Production + Sales in period)
  const productAcc = new Map<string, ProductAuditSummary>();
  const ensureProduct = (productId: string, fallbackName: string, fallbackSku: string, fallbackSize: string) => {
    const existing = productAcc.get(productId);
    if (existing) return existing;
    const master = params.products.find((p) => p.id === productId);
    const created: ProductAuditSummary = {
      productId,
      productName: master?.name ?? fallbackName,
      productSku: master?.sku ?? fallbackSku,
      packetSize: master?.packetSize ?? fallbackSize,
      batchesCompleted: 0,
      producedGoodQty: 0,
      producedDamagedQty: 0,
      totalManufacturingCost: 0,
      avgCostPerPacket: null,
      orderedQty: 0,
      invoicedQty: 0,
      salesTaxableValue: 0,
      salesGstTotal: 0,
      sellingPrice: master?.sellingPrice ?? 0,
    };
    productAcc.set(productId, created);
    return created;
  };

  batchCostingsInPeriod
    .filter((b) => b.status === 'Completed')
    .forEach((b) => {
      const row = ensureProduct(b.productId, b.productName, b.productSku, b.packetSize);
      row.batchesCompleted += 1;
      row.producedGoodQty = roundQuantity(row.producedGoodQty + b.actualGoodQuantity);
      row.producedDamagedQty = roundQuantity(row.producedDamagedQty + b.damagedQuantity);
      row.totalManufacturingCost = roundCurrency(row.totalManufacturingCost + b.totalProductionCost);
    });

  const periodSoIds = new Set(salesOrdersInPeriod.filter((s) => s.status !== 'Cancelled' && s.status !== 'Rejected').map((s) => s.id));
  params.salesOrderItems
    .filter((item) => periodSoIds.has(item.salesOrderId))
    .forEach((item) => {
      const row = ensureProduct(item.productId, item.productName, item.productSku, item.packetSize);
      row.orderedQty = roundQuantity(row.orderedQty + item.quantity);
    });

  const periodInvIds = new Set(invoicesInPeriod.map((i) => i.id));
  params.invoiceItems
    .filter((item) => periodInvIds.has(item.invoiceId))
    .forEach((item) => {
      const row = ensureProduct(item.productId, item.productName, item.productSku, item.packetSize);
      row.invoicedQty = roundQuantity(row.invoicedQty + item.quantity);
      row.salesTaxableValue = roundCurrency(row.salesTaxableValue + item.taxableValue);
      row.salesGstTotal = roundCurrency(row.salesGstTotal + item.lineGst);
    });

  const productSummaries = Array.from(productAcc.values()).map((row) => ({
    ...row,
    avgCostPerPacket:
      row.producedGoodQty > 0
        ? roundCurrency(row.totalManufacturingCost / row.producedGoodQty)
        : null,
  }));
  productSummaries.sort((a, b) => b.salesTaxableValue - a.salesTaxableValue || b.totalManufacturingCost - a.totalManufacturingCost);

  // Profit & Loss Summary (exclusively real numbers)
  const salesRevenueExclGst = roundCurrency(
    invoicesInPeriod.reduce((s, inv) => s + inv.subtotal, 0),
  );
  const gstCollected = roundCurrency(
    invoicesInPeriod.reduce((s, inv) => s + inv.gstTotal, 0),
  );
  const grossSalesInclGst = roundCurrency(
    invoicesInPeriod.reduce((s, inv) => s + inv.grandTotal, 0),
  );

  const receivedPurchasesInPeriod = purchasesInPeriod.filter((p) => p.receiptStatus === 'Received');
  const purchasesExclGst = roundCurrency(
    receivedPurchasesInPeriod.reduce((s, p) => s + p.subtotal, 0),
  );
  const inputPurchaseGst = roundCurrency(
    receivedPurchasesInPeriod.reduce((s, p) => s + p.gstTotal, 0),
  );

  const activeCostBatches = batchCostingsInPeriod.filter(
    (b) => b.status === 'Completed' || b.status === 'In Progress',
  );
  const rawMaterialConsumedCost = roundCurrency(
    activeCostBatches.reduce((s, b) => s + b.rawMaterialCost, 0),
  );
  const packagingConsumedCost = roundCurrency(
    activeCostBatches.reduce((s, b) => s + b.packagingMaterialCost, 0),
  );
  const labourExpenses = roundCurrency(
    activeCostBatches.reduce((s, b) => s + b.labourCost, 0),
  );
  const gasElectricityExpenses = roundCurrency(
    activeCostBatches.reduce((s, b) => s + b.gasElectricityCost, 0),
  );
  const otherProductionExpenses = roundCurrency(
    activeCostBatches.reduce((s, b) => s + b.otherExpenses, 0),
  );
  const totalProductionCost = roundCurrency(
    rawMaterialConsumedCost +
      packagingConsumedCost +
      labourExpenses +
      gasElectricityExpenses +
      otherProductionExpenses,
  );
  const grossManufacturingProfit = roundCurrency(salesRevenueExclGst - totalProductionCost);
  const grossMarginPercent =
    salesRevenueExclGst > 0
      ? roundCurrency((grossManufacturingProfit / salesRevenueExclGst) * 100)
      : null;

  const cashCollectedInPeriod = roundCurrency(
    paymentsInPeriod.reduce((s, p) => s + p.amount, 0),
  );
  const totalOutstandingReceivables = roundCurrency(
    params.invoices.reduce((s, inv) => s + inv.outstandingBalance, 0),
  );

  return {
    fromDate: params.fromDate,
    toDate: params.toDate,
    stockReconciliation,
    rawMaterialBalances: stockReconciliation.filter((r) => r.stockCategory === 'raw_material'),
    finishedGoodsBalances: stockReconciliation.filter((r) => r.stockCategory === 'finished_goods'),
    damagedBalances: stockReconciliation.filter((r) => r.stockCategory === 'damaged'),
    purchasesInPeriod,
    purchaseItemsInPeriod,
    productionOrdersInPeriod,
    consumptionsInPeriod,
    variancesInPeriod,
    damagedConsumptionsInPeriod,
    salesOrdersInPeriod,
    invoicesInPeriod,
    dispatchesInPeriod,
    paymentsInPeriod,
    costingsInPeriod,
    batchCostingsInPeriod,
    productCostSummariesInPeriod,
    customerSummaries,
    productSummaries,
    profitAndLoss: {
      salesRevenueExclGst,
      gstCollected,
      grossSalesInclGst,
      purchasesExclGst,
      inputPurchaseGst,
      rawMaterialConsumedCost,
      packagingConsumedCost,
      labourExpenses,
      gasElectricityExpenses,
      otherProductionExpenses,
      totalProductionCost,
      grossManufacturingProfit,
      grossMarginPercent,
      cashCollectedInPeriod,
      totalOutstandingReceivables,
    },
  };
}

export interface AuditValidationFinding {
  recordRef: string;
  detail: string;
}

export interface AuditValidationCheck {
  id:
    | 'negative-inventory'
    | 'sales-exceed-stock'
    | 'missing-purchase-records'
    | 'production-consumption-mismatch'
    | 'invoice-payment-mismatch'
    | 'incorrect-stock-balances'
    | 'duplicate-transaction-refs'
    | 'unapproved-sales-orders'
    | 'unrecorded-stock-adjustments';
  title: string;
  description: string;
  status: 'Pass' | 'Warning' | 'Fail';
  affectedCount: number;
  findings: AuditValidationFinding[];
}

export function runAuditValidations(params: {
  rawMaterials: RawMaterial[];
  suppliers: Supplier[];
  purchases: Purchase[];
  purchaseItems: PurchaseItem[];
  productionOrders: ProductionOrder[];
  productionConsumption: ProductionConsumption[];
  productionVariances: ProductionVariance[];
  stockBalances: StockBalance[];
  inventoryLedger: InventoryLedgerEntry[];
  salesOrders: SalesOrder[];
  salesOrderItems: SalesOrderItem[];
  invoices: Invoice[];
  dispatches: Dispatch[];
  dispatchItems: DispatchItem[];
  payments: Payment[];
}): AuditValidationCheck[] {
  const checks: AuditValidationCheck[] = [];

  // 1. Negative inventory
  {
    const findings: AuditValidationFinding[] = [];
    params.rawMaterials.forEach((m) => {
      if (m.currentStock < 0) {
        findings.push({
          recordRef: m.materialCode,
          detail: `Raw material "${m.name}" has negative master stock (${m.currentStock} ${m.unit}).`,
        });
      }
    });
    params.stockBalances.forEach((sb) => {
      if (sb.currentBalance < 0) {
        findings.push({
          recordRef: `${sb.stockCategory}:${sb.itemCode}`,
          detail: `Stock balance "${sb.itemName}" (${sb.stockCategory}) is negative (${sb.currentBalance} ${sb.unit}).`,
        });
      }
    });
    params.inventoryLedger.forEach((le) => {
      if (le.balance < 0) {
        findings.push({
          recordRef: le.referenceDoc,
          detail: `Ledger entry on ${le.transactionDate} for ${le.itemName} resulted in negative balance (${le.balance}).`,
        });
      }
    });
    checks.push({
      id: 'negative-inventory',
      title: '1. Negative Inventory Check',
      description: 'Verifies zero negative stock balances across raw materials, WIP, finished goods, and ledger entries.',
      status: findings.length === 0 ? 'Pass' : 'Fail',
      affectedCount: findings.length,
      findings,
    });
  }

  // 2. Sales exceeding available stock
  {
    const findings: AuditValidationFinding[] = [];
    const fgBalanceMap = new Map(
      params.stockBalances
        .filter((b) => b.stockCategory === 'finished_goods')
        .map((b) => [b.itemId, b.currentBalance]),
    );
    const activeOrders = params.salesOrders.filter(
      (o) => o.status === 'Approved' || o.status === 'Partially Dispatched' || o.status === 'Pending Approval',
    );
    const activeOrderMap = new Map(activeOrders.map((o) => [o.id, o]));
    const demandedByProduct = new Map<string, { name: string; sku: string; remaining: number; orders: string[] }>();

    params.salesOrderItems.forEach((item) => {
      const ord = activeOrderMap.get(item.salesOrderId);
      if (!ord) return;
      const rem = roundQuantity(Math.max(0, item.quantity - item.dispatchedQuantity));
      if (rem <= 0) return;
      const prev = demandedByProduct.get(item.productId) ?? {
        name: item.productName,
        sku: item.productSku,
        remaining: 0,
        orders: [],
      };
      prev.remaining = roundQuantity(prev.remaining + rem);
      if (!prev.orders.includes(ord.orderNumber)) prev.orders.push(ord.orderNumber);
      demandedByProduct.set(item.productId, prev);
    });

    demandedByProduct.forEach((demand, productId) => {
      const avail = fgBalanceMap.get(productId) ?? 0;
      if (demand.remaining > avail + 0.001) {
        findings.push({
          recordRef: demand.sku,
          detail: `${demand.name}: Open sales demand (${demand.remaining} pkts across ${demand.orders.join(', ')}) exceeds available FG stock (${avail} pkts).`,
        });
      }
    });

    checks.push({
      id: 'sales-exceed-stock',
      title: '2. Sales Exceeding Available Stock',
      description: 'Compares open/approved sales order fulfillment demand against live finished goods stock.',
      status: findings.length === 0 ? 'Pass' : 'Warning',
      affectedCount: findings.length,
      findings,
    });
  }

  // 3. Missing purchase records
  {
    const findings: AuditValidationFinding[] = [];
    const purchaseIds = new Set(params.purchases.map((p) => p.id));
    const itemsByPurchase = new Map<string, number>();
    params.purchaseItems.forEach((pi) => {
      itemsByPurchase.set(pi.purchaseId, (itemsByPurchase.get(pi.purchaseId) ?? 0) + 1);
    });

    params.purchases.forEach((p) => {
      if (p.receiptStatus === 'Received' && !p.invoiceNumber.trim()) {
        findings.push({
          recordRef: p.poNumber,
          detail: `Received PO ${p.poNumber} (${p.supplierName}) is missing supplier invoice number.`,
        });
      }
      const lineCount = itemsByPurchase.get(p.id) ?? 0;
      if (lineCount === 0) {
        findings.push({
          recordRef: p.poNumber,
          detail: `Purchase ${p.poNumber} has 0 recorded line items in purchaseItems.`,
        });
      }
    });

    params.inventoryLedger
      .filter((le) => le.transactionType === 'Purchase Receipt')
      .forEach((le) => {
        const matched = params.purchases.some((p) => p.poNumber === le.referenceDoc);
        if (!matched) {
          findings.push({
            recordRef: le.referenceDoc,
            detail: `Inventory Purchase Receipt (${le.itemName}, +${le.quantityIn} ${le.unit}) references missing PO ${le.referenceDoc}.`,
          });
        }
      });

    params.purchaseItems.forEach((pi) => {
      if (!purchaseIds.has(pi.purchaseId)) {
        findings.push({
          recordRef: pi.materialCode,
          detail: `Orphaned purchase item (${pi.materialName}) references missing purchaseId ${pi.purchaseId}.`,
        });
      }
    });

    checks.push({
      id: 'missing-purchase-records',
      title: '3. Missing Purchase Records',
      description: 'Flags received POs without supplier invoice numbers, missing line items, or unlinked receipt ledger entries.',
      status: findings.length === 0 ? 'Pass' : 'Fail',
      affectedCount: findings.length,
      findings,
    });
  }

  // 4. Production consumption mismatches
  {
    const findings: AuditValidationFinding[] = [];
    const varianceOrderIds = new Set(params.productionVariances.map((v) => v.productionOrderId));
    const orderMap = new Map(params.productionOrders.map((o) => [o.id, o]));

    params.productionOrders
      .filter((o) => o.status === 'Completed')
      .forEach((o) => {
        if (!varianceOrderIds.has(o.id)) {
          findings.push({
            recordRef: o.orderNumber,
            detail: `Completed production order ${o.orderNumber} is missing its ProductionVariance snapshot.`,
          });
        }
      });

    params.productionConsumption.forEach((c) => {
      const ord = orderMap.get(c.productionOrderId);
      if (!ord || ord.status === 'Cancelled') return;
      const expectedVar = roundQuantity(c.actualConsumedQuantity - c.expectedQuantity);
      if (ord.status === 'Completed' && Math.abs(expectedVar - c.varianceQuantity) > 0.02) {
        findings.push({
          recordRef: ord.orderNumber,
          detail: `${c.materialName}: Recorded variance (${c.varianceQuantity}) mismatches actual - expected (${expectedVar}).`,
        });
      }
      if (ord.status === 'Completed' && c.expectedQuantity > 0) {
        const pct = Math.abs((expectedVar / c.expectedQuantity) * 100);
        if (pct > 15) {
          findings.push({
            recordRef: ord.orderNumber,
            detail: `${c.materialName}: Consumption variance is ${pct.toFixed(1)}% (Expected ${c.expectedQuantity}, Actual ${c.actualConsumedQuantity} ${c.unit}).`,
          });
        }
      }
    });

    checks.push({
      id: 'production-consumption-mismatch',
      title: '4. Production Consumption Mismatches',
      description: 'Detects missing variance snapshots, variance formula discrepancies, and >15% material consumption deviations.',
      status:
        findings.length === 0
          ? 'Pass'
          : findings.some((f) => f.detail.includes('missing') || f.detail.includes('mismatches'))
            ? 'Fail'
            : 'Warning',
      affectedCount: findings.length,
      findings,
    });
  }

  // 5. Invoice and payment mismatches
  {
    const findings: AuditValidationFinding[] = [];
    const paymentsByInvoice = new Map<string, number>();
    params.payments.forEach((p) => {
      paymentsByInvoice.set(p.invoiceId, roundCurrency((paymentsByInvoice.get(p.invoiceId) ?? 0) + p.amount));
    });

    params.invoices.forEach((inv) => {
      const ledgerPaid = paymentsByInvoice.get(inv.id) ?? 0;
      if (Math.abs(ledgerPaid - inv.amountPaid) > 0.02) {
        findings.push({
          recordRef: inv.invoiceNumber,
          detail: `Invoice ${inv.invoiceNumber} amountPaid (₹${inv.amountPaid.toFixed(2)}) does not match sum of payments (₹${ledgerPaid.toFixed(2)}).`,
        });
      }
      if (Math.abs(inv.amountPaid + inv.outstandingBalance - inv.grandTotal) > 0.02) {
        findings.push({
          recordRef: inv.invoiceNumber,
          detail: `Invoice ${inv.invoiceNumber} paid + outstanding does not equal grandTotal (₹${inv.grandTotal.toFixed(2)}).`,
        });
      }
      if (inv.outstandingBalance === 0 && inv.paymentStatus !== 'Paid') {
        findings.push({
          recordRef: inv.invoiceNumber,
          detail: `Invoice ${inv.invoiceNumber} has ₹0.00 due but status is "${inv.paymentStatus}".`,
        });
      }
      if (inv.outstandingBalance > 0 && inv.amountPaid > 0 && inv.paymentStatus !== 'Partially Paid') {
        findings.push({
          recordRef: inv.invoiceNumber,
          detail: `Invoice ${inv.invoiceNumber} has partial payment but status is "${inv.paymentStatus}".`,
        });
      }
    });

    params.salesOrders
      .filter((so) => so.status === 'Dispatched' && !so.invoiceId)
      .forEach((so) => {
        findings.push({
          recordRef: so.orderNumber,
          detail: `Dispatched sales order ${so.orderNumber} (${so.customerName}) has no GST invoice generated yet.`,
        });
      });

    checks.push({
      id: 'invoice-payment-mismatch',
      title: '5. Invoice & Payment Mismatches',
      description: 'Reconciles invoice totals against payment receipts, status flags, and dispatched un-invoiced orders.',
      status: findings.length === 0 ? 'Pass' : 'Fail',
      affectedCount: findings.length,
      findings,
    });
  }

  // 6. Incorrect stock balances
  {
    const findings: AuditValidationFinding[] = [];
    const rmBalanceById = new Map<string, StockBalance>();

    params.stockBalances.forEach((sb) => {
      if (sb.stockCategory === 'raw_material') {
        rmBalanceById.set(sb.itemId, sb);
      }
      const computed = roundQuantity(
        sb.openingStock +
          sb.receivedFromPurchases +
          sb.receivedFromProduction -
          sb.issuedToProduction -
          sb.dispatchedThroughSales +
          sb.adjustmentsNet,
      );
      if (Math.abs(computed - sb.currentBalance) > 0.02) {
        findings.push({
          recordRef: `${sb.stockCategory}:${sb.itemCode}`,
          detail: `${sb.itemName}: Stored balance (${sb.currentBalance}) differs from formula balance (${computed}).`,
        });
      }
    });

    params.rawMaterials.forEach((rm) => {
      const sb = rmBalanceById.get(rm.id);
      if (sb && Math.abs(sb.currentBalance - rm.currentStock) > 0.02) {
        findings.push({
          recordRef: rm.materialCode,
          detail: `${rm.name}: RawMaterial master stock (${rm.currentStock}) mismatches StockBalance (${sb.currentBalance}).`,
        });
      }
    });

    checks.push({
      id: 'incorrect-stock-balances',
      title: '6. Incorrect Stock Balances',
      description: 'Validates stock balance arithmetic (Opening + Receipts - Issues - Dispatches + Adjustments = Closing) and master sync.',
      status: findings.length === 0 ? 'Pass' : 'Fail',
      affectedCount: findings.length,
      findings,
    });
  }

  // 7. Duplicate transaction references
  {
    const findings: AuditValidationFinding[] = [];
    const seenReceipt = new Map<string, string>();
    const seenPayRef = new Map<string, string>();
    const seenPoNumber = new Map<string, string>();
    const seenInvoiceNo = new Map<string, string>();

    params.payments.forEach((p) => {
      const rKey = p.receiptNumber.trim().toUpperCase();
      if (seenReceipt.has(rKey)) {
        findings.push({
          recordRef: p.receiptNumber,
          detail: `Duplicate payment receipt number "${p.receiptNumber}" on invoice ${p.invoiceNumber}.`,
        });
      } else {
        seenReceipt.set(rKey, p.id);
      }

      const refKey = p.referenceNumber.trim().toUpperCase();
      if (refKey && seenPayRef.has(refKey)) {
        findings.push({
          recordRef: p.referenceNumber,
          detail: `Duplicate transaction reference "${p.referenceNumber}" appears on receipt ${p.receiptNumber}.`,
        });
      } else if (refKey) {
        seenPayRef.set(refKey, p.receiptNumber);
      }
    });

    params.purchases.forEach((po) => {
      const key = po.poNumber.trim().toUpperCase();
      if (seenPoNumber.has(key)) {
        findings.push({
          recordRef: po.poNumber,
          detail: `Duplicate Purchase Order number "${po.poNumber}".`,
        });
      } else {
        seenPoNumber.set(key, po.id);
      }
    });

    params.invoices.forEach((inv) => {
      const key = inv.invoiceNumber.trim().toUpperCase();
      if (seenInvoiceNo.has(key)) {
        findings.push({
          recordRef: inv.invoiceNumber,
          detail: `Duplicate GST Invoice number "${inv.invoiceNumber}".`,
        });
      } else {
        seenInvoiceNo.set(key, inv.id);
      }
    });

    checks.push({
      id: 'duplicate-transaction-refs',
      title: '7. Duplicate Transaction References',
      description: 'Scans payments, purchase orders, and GST invoices for duplicate receipt numbers, UTR/cheque refs, or document IDs.',
      status: findings.length === 0 ? 'Pass' : 'Fail',
      affectedCount: findings.length,
      findings,
    });
  }

  // 8. Unapproved sales orders
  {
    const findings: AuditValidationFinding[] = [];
    const orderMap = new Map(params.salesOrders.map((o) => [o.id, o]));

    params.salesOrders
      .filter((o) => o.status === 'Draft' || o.status === 'Pending Approval')
      .forEach((o) => {
        findings.push({
          recordRef: o.orderNumber,
          detail: `${o.customerName} (₹${o.grandTotal.toFixed(2)}) is in "${o.status}" awaiting approval.`,
        });
      });

    params.dispatches.forEach((d) => {
      const so = orderMap.get(d.salesOrderId);
      if (so && ['Draft', 'Pending Approval', 'Rejected', 'Cancelled'].includes(so.status)) {
        findings.push({
          recordRef: d.dispatchNumber,
          detail: `Dispatch ${d.dispatchNumber} is linked to unapproved order ${so.orderNumber} (${so.status}).`,
        });
      }
    });

    checks.push({
      id: 'unapproved-sales-orders',
      title: '8. Unapproved Sales Orders',
      description: 'Identifies pending/draft sales orders awaiting Owner/Admin review and verifies no unapproved orders were dispatched.',
      status:
        findings.length === 0
          ? 'Pass'
          : findings.some((f) => f.detail.includes('Dispatch'))
            ? 'Fail'
            : 'Warning',
      affectedCount: findings.length,
      findings,
    });
  }

  // 9. Unrecorded stock adjustments
  {
    const findings: AuditValidationFinding[] = [];
    const adjLedgerByKey = new Map<string, number>();

    params.inventoryLedger
      .filter((le) => le.transactionType === 'Adjustment In' || le.transactionType === 'Adjustment Out')
      .forEach((le) => {
        if (!le.reason.trim() || !le.referenceDoc.trim()) {
          findings.push({
            recordRef: le.itemCode,
            detail: `Stock adjustment on ${le.transactionDate} (${le.itemName}) is missing a reason or reference document.`,
          });
        }
        const key = `${le.stockCategory}::${le.itemId}`;
        const prev = adjLedgerByKey.get(key) ?? 0;
        adjLedgerByKey.set(key, roundQuantity(prev + le.quantityIn - le.quantityOut));
      });

    params.stockBalances.forEach((sb) => {
      const key = `${sb.stockCategory}::${sb.itemId}`;
      const ledgerAdjNet = adjLedgerByKey.get(key) ?? 0;
      if (Math.abs(sb.adjustmentsNet - ledgerAdjNet) > 0.02) {
        findings.push({
          recordRef: `${sb.stockCategory}:${sb.itemCode}`,
          detail: `${sb.itemName}: Stock balance adjustmentsNet (${sb.adjustmentsNet}) does not match Adjustment ledger entries (${ledgerAdjNet}).`,
        });
      }
    });

    checks.push({
      id: 'unrecorded-stock-adjustments',
      title: '9. Unrecorded Stock Adjustments',
      description: 'Ensures every stock adjustment has a ledger entry with reason/reference and reconciles with stock balance adjustments.',
      status: findings.length === 0 ? 'Pass' : 'Fail',
      affectedCount: findings.length,
      findings,
    });
  }

  return checks;
}
