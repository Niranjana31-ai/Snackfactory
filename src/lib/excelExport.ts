import * as XLSX from 'xlsx';
import type { AuditValidationCheck, MonthlyAuditDataset } from './costingAndAudit';
import type { AuditLogEntry } from '../types/erp';

export function exportAuditReportToExcel(
  dataset: MonthlyAuditDataset,
  validations: AuditValidationCheck[],
  auditLogs: AuditLogEntry[],
): void {
  const wb = XLSX.utils.book_new();

  // 1. P&L & Executive Summary
  const pnlRows = [
    { Metric: 'Audit Period', Value: `${dataset.fromDate} to ${dataset.toDate}` },
    { Metric: 'Sales Revenue (Excl. GST)', Value: dataset.profitAndLoss.salesRevenueExclGst },
    { Metric: 'GST Collected on Sales', Value: dataset.profitAndLoss.gstCollected },
    { Metric: 'Gross Sales Billed (Incl. GST)', Value: dataset.profitAndLoss.grossSalesInclGst },
    { Metric: 'Raw Material Consumed Cost (WAC)', Value: dataset.profitAndLoss.rawMaterialConsumedCost },
    { Metric: 'Packaging Material Consumed Cost (WAC)', Value: dataset.profitAndLoss.packagingConsumedCost },
    { Metric: 'Labour Expenses', Value: dataset.profitAndLoss.labourExpenses },
    { Metric: 'Gas & Electricity Expenses', Value: dataset.profitAndLoss.gasElectricityExpenses },
    { Metric: 'Other Production Expenses', Value: dataset.profitAndLoss.otherProductionExpenses },
    { Metric: 'Total Manufacturing / Production Cost', Value: dataset.profitAndLoss.totalProductionCost },
    { Metric: 'Gross Manufacturing Profit', Value: dataset.profitAndLoss.grossManufacturingProfit },
    {
      Metric: 'Gross Margin (%)',
      Value:
        dataset.profitAndLoss.grossMarginPercent !== null
          ? `${dataset.profitAndLoss.grossMarginPercent.toFixed(2)}%`
          : 'N/A',
    },
    { Metric: 'Received Purchases (Excl. GST)', Value: dataset.profitAndLoss.purchasesExclGst },
    { Metric: 'Input Purchase GST', Value: dataset.profitAndLoss.inputPurchaseGst },
    { Metric: 'Customer Cash Collected (Period)', Value: dataset.profitAndLoss.cashCollectedInPeriod },
    {
      Metric: 'Total Outstanding Receivables (All-Time)',
      Value: dataset.profitAndLoss.totalOutstandingReceivables,
    },
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(pnlRows), 'Profit & Loss');

  // 2. Stock Reconciliation
  const stockRows = dataset.stockReconciliation.map((r) => ({
    Category: r.stockCategory,
    Code: r.itemCode,
    Item: r.itemName,
    Unit: r.unit,
    'Period Opening': r.periodOpeningStock,
    'Period Inflow': r.periodInflow,
    'Period Outflow': r.periodOutflow,
    'Period Closing': r.periodClosingBalance,
    'Live Balance': r.liveSystemBalance,
    'Min Level': r.minimumStockLevel,
    Status: r.isLowStock ? 'Low Stock' : 'Nominal',
  }));
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(stockRows.length > 0 ? stockRows : [{ Note: 'No stock records' }]),
    'Stock Reconciliation',
  );

  // 3. Purchases
  const purchaseRows = dataset.purchasesInPeriod.map((p) => ({
    'PO Number': p.poNumber,
    Date: p.purchaseDate,
    Supplier: p.supplierName,
    'Supplier GSTIN': p.supplierGstin,
    'Invoice No': p.invoiceNumber,
    'Receipt Status': p.receiptStatus,
    'Payment Status': p.paymentStatus,
    Subtotal: p.subtotal,
    GST: p.gstTotal,
    'Grand Total': p.grandTotal,
  }));
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(purchaseRows.length > 0 ? purchaseRows : [{ Note: 'No purchases in period' }]),
    'Purchases',
  );

  // 4. Production, Consumption & Costing
  const batchRows = dataset.batchCostingsInPeriod.map((b) => ({
    'Order No': b.orderNumber,
    Date: b.productionDate,
    Product: b.productName,
    Status: b.status,
    'Planned Qty': b.plannedQuantity,
    'Good Packets': b.actualGoodQuantity,
    'Damaged Packets': b.damagedQuantity,
    'Raw Material Cost': b.rawMaterialCost,
    'Packaging Cost': b.packagingMaterialCost,
    'Labour Cost': b.labourCost,
    'Gas & Electricity': b.gasElectricityCost,
    'Other Expenses': b.otherExpenses,
    'Total Production Cost': b.totalProductionCost,
    'Cost / Packet': b.costPerGoodPacket ?? 'N/A',
    'Selling Price': b.sellingPricePerPacket ?? 'N/A',
    'Profit / Packet': b.profitPerPacket ?? 'N/A',
    'Margin %': b.profitMarginPercent !== null ? `${b.profitMarginPercent.toFixed(2)}%` : 'N/A',
  }));
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(batchRows.length > 0 ? batchRows : [{ Note: 'No production batches in period' }]),
    'Production & Costing',
  );

  // 5. Variance & Damaged Materials
  const varianceRows = dataset.variancesInPeriod.map((v) => ({
    'Order No': v.orderNumber,
    Date: v.productionDate,
    Product: v.productName,
    'Expected Qty': v.expectedQuantity,
    'Actual Good Qty': v.actualGoodQuantity,
    'Damaged Pkts': v.damagedQuantity,
    'Yield Variance %': v.yieldVariancePercent,
    'Expected Material Cost': v.expectedMaterialCost,
    'Actual Material Cost': v.actualMaterialCost,
    'Material Cost Variance': v.materialCostVariance,
    'Damaged Material Qty': v.damagedMaterialQty,
  }));
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(varianceRows.length > 0 ? varianceRows : [{ Note: 'No variances in period' }]),
    'Variance & Damage',
  );

  // 6. Sales Orders, Invoices & Dispatches
  const invoiceRows = dataset.invoicesInPeriod.map((inv) => ({
    'Invoice No': inv.invoiceNumber,
    Date: inv.invoiceDate,
    'Sales Order': inv.orderNumber,
    Customer: inv.customerName,
    'Tax Type': inv.taxType,
    Taxable: inv.subtotal,
    CGST: inv.cgstTotal,
    SGST: inv.sgstTotal,
    IGST: inv.igstTotal,
    'Grand Total': inv.grandTotal,
    Paid: inv.amountPaid,
    Outstanding: inv.outstandingBalance,
    Status: inv.paymentStatus,
  }));
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(invoiceRows.length > 0 ? invoiceRows : [{ Note: 'No GST invoices in period' }]),
    'GST Invoices',
  );

  const dispatchRows = dataset.dispatchesInPeriod.map((d) => ({
    'Dispatch No': d.dispatchNumber,
    Date: d.dispatchDate,
    'Sales Order': d.orderNumber,
    Customer: d.customerName,
    Vehicle: d.vehicleNumber,
    Driver: d.driverName,
    Type: d.isPartial ? 'Partial' : 'Full',
    'Packets Shipped': d.totalDispatchedQty,
  }));
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(dispatchRows.length > 0 ? dispatchRows : [{ Note: 'No dispatches in period' }]),
    'Dispatches',
  );

  // 7. Customer Payments & Outstanding Balances
  const paymentRows = dataset.paymentsInPeriod.map((p) => ({
    'Receipt No': p.receiptNumber,
    Date: p.paymentDate,
    Customer: p.customerName,
    Invoice: p.invoiceNumber,
    Method: p.paymentMethod,
    Reference: p.referenceNumber,
    Amount: p.amount,
    'Recorded By': p.recordedByName,
  }));
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(paymentRows.length > 0 ? paymentRows : [{ Note: 'No payments in period' }]),
    'Customer Payments',
  );

  const custBalanceRows = dataset.customerSummaries.map((c) => ({
    Customer: c.customerName,
    GSTIN: c.customerGstin || 'Unregistered',
    'Period Billed': c.periodBilled,
    'Period Collected': c.periodPaid,
    'All-Time Billed': c.allTimeBilled,
    'All-Time Paid': c.allTimePaid,
    'Outstanding Balance': c.outstandingBalance,
    'Open Invoices': c.openInvoices,
  }));
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(custBalanceRows.length > 0 ? custBalanceRows : [{ Note: 'No customer billing records' }]),
    'Customer Balances',
  );

  // 8. Product-wise Summary
  const prodSummaryRows = dataset.productSummaries.map((p) => ({
    SKU: p.productSku,
    Product: `${p.productName} (${p.packetSize})`,
    'Batches Completed': p.batchesCompleted,
    'Good Output (Pkts)': p.producedGoodQty,
    'Damaged Output (Pkts)': p.producedDamagedQty,
    'Mfg Cost': p.totalManufacturingCost,
    'Avg Cost/Pkt': p.avgCostPerPacket ?? 'N/A',
    'Ordered Qty': p.orderedQty,
    'Invoiced Qty': p.invoicedQty,
    'Sales Revenue (Excl GST)': p.salesTaxableValue,
  }));
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(prodSummaryRows.length > 0 ? prodSummaryRows : [{ Note: 'No product summary data' }]),
    'Product Summary',
  );

  // 9. Audit Validations & Audit Trail
  const valRows = validations.map((v) => ({
    Check: v.title,
    Status: v.status,
    'Affected Count': v.affectedCount,
    Details:
      v.findings.length === 0
        ? 'All checks passed'
        : v.findings.map((f) => `[${f.recordRef}] ${f.detail}`).join(' | '),
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(valRows), 'Audit Validations');

  const logRows = auditLogs.slice(0, 500).map((l) => ({
    Action: l.action,
    Module: l.module,
    Record: l.recordLabel,
    Details: l.details,
    User: l.userName,
    Role: l.userRole,
    Timestamp: l.createdAt ? l.createdAt.toDate().toISOString() : '',
  }));
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(logRows.length > 0 ? logRows : [{ Note: 'No audit log entries' }]),
    'Audit Trail',
  );

  XLSX.writeFile(wb, `SnackFactory_Audit_${dataset.fromDate}_to_${dataset.toDate}.xlsx`);
}
