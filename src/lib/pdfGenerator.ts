import { jsPDF } from 'jspdf';
import type { Dispatch, DispatchItem, Invoice, InvoiceItem } from '../types/erp';

function formatMoney(amount: number): string {
  return `INR ${amount.toFixed(2)}`;
}

export function downloadGstInvoicePdf(invoice: Invoice, items: InvoiceItem[]): void {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 40;
  let y = 44;

  // Header Banner
  doc.setFillColor(11, 22, 44);
  doc.rect(margin, y, pageWidth - margin * 2, 56, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text(invoice.factoryName, margin + 14, y + 24);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`TAX INVOICE · ${invoice.taxType === 'CGST_SGST' ? 'INTRA-STATE (CGST + SGST)' : 'INTER-STATE (IGST)'}`, margin + 14, y + 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text(invoice.invoiceNumber, pageWidth - margin - 14, y + 26, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Date: ${invoice.invoiceDate}`, pageWidth - margin - 14, y + 42, { align: 'right' });

  y += 74;
  doc.setTextColor(15, 23, 42);

  // Seller & Buyer Boxes
  const colWidth = (pageWidth - margin * 2 - 16) / 2;
  doc.setDrawColor(226, 232, 240);
  doc.rect(margin, y, colWidth, 92);
  doc.rect(margin + colWidth + 16, y, colWidth, 92);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text('SUPPLIER (FACTORY)', margin + 10, y + 15);
  doc.text('BILL TO (CUSTOMER)', margin + colWidth + 26, y + 15);

  doc.setTextColor(15, 23, 42);
  doc.setFontSize(10);
  doc.text(invoice.factoryName, margin + 10, y + 30);
  doc.text(invoice.customerName, margin + colWidth + 26, y + 30);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  const factoryAddrLines = doc.splitTextToSize(invoice.factoryAddress, colWidth - 20) as string[];
  const custAddrLines = doc.splitTextToSize(invoice.customerAddress, colWidth - 20) as string[];
  doc.text(factoryAddrLines.slice(0, 2), margin + 10, y + 43);
  doc.text(custAddrLines.slice(0, 2), margin + colWidth + 26, y + 43);

  doc.text(
    `State: ${invoice.factoryState} (${invoice.factoryStateCode}) · GSTIN: ${invoice.factoryGstin || 'Unregistered'}`,
    margin + 10,
    y + 78,
  );
  doc.text(
    `State: ${invoice.customerState} (${invoice.customerStateCode}) · GSTIN: ${invoice.customerGstin || 'Unregistered'}`,
    margin + colWidth + 26,
    y + 78,
  );

  y += 108;
  doc.setFontSize(8.5);
  doc.setTextColor(71, 85, 105);
  doc.text(`Sales Order Ref: ${invoice.orderNumber}`, margin, y);
  doc.text(`Salesman: ${invoice.salesmanName}`, margin + 180, y);
  doc.text(`Payment Status: ${invoice.paymentStatus}`, pageWidth - margin, y, { align: 'right' });

  y += 14;

  // Table Header
  doc.setFillColor(241, 245, 249);
  doc.rect(margin, y, pageWidth - margin * 2, 22, 'F');
  doc.setTextColor(51, 65, 85);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);

  const cols = {
    idx: margin + 6,
    desc: margin + 26,
    hsn: margin + 190,
    qty: margin + 245,
    rate: margin + 292,
    taxable: margin + 352,
    gst: margin + 412,
    total: pageWidth - margin - 6,
  };

  doc.text('#', cols.idx, y + 14);
  doc.text('Product Description', cols.desc, y + 14);
  doc.text('HSN', cols.hsn, y + 14);
  doc.text('Qty', cols.qty, y + 14, { align: 'right' });
  doc.text('Rate', cols.rate, y + 14, { align: 'right' });
  doc.text('Taxable', cols.taxable, y + 14, { align: 'right' });
  doc.text('GST', cols.gst, y + 14, { align: 'right' });
  doc.text('Total', cols.total, y + 14, { align: 'right' });

  y += 22;
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(15, 23, 42);

  items.forEach((item, index) => {
    if (y > 720) {
      doc.addPage();
      y = 44;
    }
    doc.setFontSize(8.5);
    const label = `${item.productName} (${item.packetSize})`;
    const truncated = label.length > 34 ? `${label.slice(0, 32)}..` : label;
    doc.text(String(index + 1), cols.idx, y + 14);
    doc.text(truncated, cols.desc, y + 14);
    doc.text(item.hsnCode, cols.hsn, y + 14);
    doc.text(String(item.quantity), cols.qty, y + 14, { align: 'right' });
    doc.text(item.rate.toFixed(2), cols.rate, y + 14, { align: 'right' });
    doc.text(item.taxableValue.toFixed(2), cols.taxable, y + 14, { align: 'right' });
    doc.text(`${item.gstPercentage}% (${item.lineGst.toFixed(2)})`, cols.gst, y + 14, { align: 'right' });
    doc.text(item.lineTotal.toFixed(2), cols.total, y + 14, { align: 'right' });

    doc.setDrawColor(241, 245, 249);
    doc.line(margin, y + 20, pageWidth - margin, y + 20);
    y += 22;
  });

  y += 14;
  if (y > 690) {
    doc.addPage();
    y = 44;
  }

  // Totals Summary Box
  const sumX = pageWidth - margin - 220;
  doc.setDrawColor(226, 232, 240);
  doc.rect(sumX, y, 220, invoice.taxType === 'CGST_SGST' ? 126 : 112);

  const putRow = (label: string, val: string, rowY: number, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(9);
    doc.text(label, sumX + 10, rowY);
    doc.text(val, pageWidth - margin - 10, rowY, { align: 'right' });
  };

  let sy = y + 18;
  putRow('Taxable Subtotal', formatMoney(invoice.subtotal), sy);
  sy += 16;
  if (invoice.taxType === 'CGST_SGST') {
    putRow('CGST', formatMoney(invoice.cgstTotal), sy);
    sy += 16;
    putRow('SGST', formatMoney(invoice.sgstTotal), sy);
    sy += 16;
  } else {
    putRow('IGST', formatMoney(invoice.igstTotal), sy);
    sy += 16;
  }
  putRow('Total Invoice Amount', formatMoney(invoice.grandTotal), sy, true);
  sy += 18;
  putRow('Amount Paid', formatMoney(invoice.amountPaid), sy);
  sy += 16;
  putRow('Outstanding Balance', formatMoney(invoice.outstandingBalance), sy, true);

  if (invoice.notes) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(71, 85, 105);
    const noteLines = doc.splitTextToSize(`Notes: ${invoice.notes}`, sumX - margin - 20) as string[];
    doc.text(noteLines.slice(0, 4), margin, y + 16);
  }

  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text('Generated by SnackFactory ERP · Authorized Signatory', margin, 800);

  doc.save(`${invoice.invoiceNumber}.pdf`);
}

export function downloadDispatchNotePdf(dispatch: Dispatch, items: DispatchItem[]): void {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 40;
  let y = 44;

  doc.setFillColor(11, 22, 44);
  doc.rect(margin, y, pageWidth - margin * 2, 54, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('DISPATCH DELIVERY CHALLAN', margin + 14, y + 23);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(
    dispatch.isPartial
      ? `Partial Dispatch (Authorized by ${dispatch.partialAuthorizedByName || 'Manager'})`
      : 'Full Order Dispatch',
    margin + 14,
    y + 40,
  );
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text(dispatch.dispatchNumber, pageWidth - margin - 14, y + 24, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Date: ${dispatch.dispatchDate}`, pageWidth - margin - 14, y + 40, { align: 'right' });

  y += 72;
  doc.setTextColor(15, 23, 42);
  doc.setDrawColor(226, 232, 240);
  doc.rect(margin, y, pageWidth - margin * 2, 76);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text(`Customer: ${dispatch.customerName}`, margin + 12, y + 18);
  doc.text(`Sales Order: ${dispatch.orderNumber}`, pageWidth - margin - 12, y + 18, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text(`Delivery Address: ${dispatch.customerAddress}`, margin + 12, y + 34);
  doc.text(
    `Vehicle: ${dispatch.vehicleNumber}   |   Driver: ${dispatch.driverName}   |   Transporter: ${dispatch.transporterName || 'Direct'}`,
    margin + 12,
    y + 50,
  );
  doc.text(
    `E-Way Bill: ${dispatch.ewayBillNumber || 'N/A'}   |   Dispatched By: ${dispatch.dispatchedByName}`,
    margin + 12,
    y + 65,
  );

  y += 94;
  doc.setFillColor(241, 245, 249);
  doc.rect(margin, y, pageWidth - margin * 2, 22, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text('#', margin + 8, y + 14);
  doc.text('SKU', margin + 32, y + 14);
  doc.text('Finished Product', margin + 125, y + 14);
  doc.text('Pack Size', margin + 320, y + 14);
  doc.text('Ordered', margin + 415, y + 14, { align: 'right' });
  doc.text('Dispatched Now', pageWidth - margin - 8, y + 14, { align: 'right' });

  y += 22;
  doc.setFont('helvetica', 'normal');
  items.forEach((item, index) => {
    doc.text(String(index + 1), margin + 8, y + 14);
    doc.text(item.productSku, margin + 32, y + 14);
    doc.text(item.productName, margin + 125, y + 14);
    doc.text(item.packetSize, margin + 320, y + 14);
    doc.text(String(item.orderedQuantity), margin + 415, y + 14, { align: 'right' });
    doc.text(String(item.dispatchedQuantity), pageWidth - margin - 8, y + 14, { align: 'right' });
    doc.setDrawColor(241, 245, 249);
    doc.line(margin, y + 20, pageWidth - margin, y + 20);
    y += 22;
  });

  y += 18;
  doc.setFont('helvetica', 'bold');
  doc.text(`Total Dispatched Units: ${dispatch.totalDispatchedQty} packets`, pageWidth - margin, y, {
    align: 'right',
  });
  if (dispatch.notes) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.text(`Remarks: ${dispatch.notes}`, margin, y);
  }

  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text('Receiver Signature', margin, 790);
  doc.text('Dispatch Supervisor Signature', pageWidth - margin, 790, { align: 'right' });

  doc.save(`${dispatch.dispatchNumber}.pdf`);
}

export function downloadPaymentReceiptPdf(
  payment: import('../types/erp').Payment,
  invoice: Invoice | null,
): void {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 40;
  let y = 44;

  // Header Banner
  doc.setFillColor(11, 22, 44);
  doc.rect(margin, y, pageWidth - margin * 2, 56, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text(invoice?.factoryName ?? 'SnackFactory Foods Pvt. Ltd.', margin + 14, y + 24);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text('OFFICIAL CUSTOMER PAYMENT RECEIPT', margin + 14, y + 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text(payment.receiptNumber, pageWidth - margin - 14, y + 26, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Payment Date: ${payment.paymentDate}`, pageWidth - margin - 14, y + 42, { align: 'right' });

  y += 78;
  doc.setTextColor(15, 23, 42);
  doc.setDrawColor(226, 232, 240);
  doc.rect(margin, y, pageWidth - margin * 2, 148);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text('RECEIVED FROM', margin + 14, y + 20);
  doc.text('LINKED TAX INVOICE', margin + 275, y + 20);

  doc.setTextColor(15, 23, 42);
  doc.setFontSize(11);
  doc.text(payment.customerName, margin + 14, y + 38);
  doc.text(payment.invoiceNumber, margin + 275, y + 38);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Sales Order Ref: ${payment.orderNumber}`, margin + 14, y + 58);
  doc.text(
    `Invoice Status: ${invoice?.paymentStatus ?? 'Reconciled'}`,
    margin + 275,
    y + 58,
  );
  doc.text(`Payment Method: ${payment.paymentMethod}`, margin + 14, y + 76);
  doc.text(`Transaction Ref: ${payment.referenceNumber}`, margin + 275, y + 76);
  doc.text(`Recorded By: ${payment.recordedByName}`, margin + 14, y + 94);
  if (invoice) {
    doc.text(`Invoice Grand Total: ${formatMoney(invoice.grandTotal)}`, margin + 275, y + 94);
    doc.text(`Total Paid on Invoice: ${formatMoney(invoice.amountPaid)}`, margin + 14, y + 112);
    doc.text(
      `Remaining Balance: ${formatMoney(invoice.outstandingBalance)}`,
      margin + 275,
      y + 112,
    );
  }
  if (payment.notes) {
    doc.text(`Remarks: ${payment.notes.slice(0, 85)}`, margin + 14, y + 132);
  }

  y += 172;
  doc.setFillColor(240, 253, 244);
  doc.setDrawColor(167, 243, 208);
  doc.rect(margin, y, pageWidth - margin * 2, 48, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(6, 95, 70);
  doc.text('AMOUNT RECEIVED', margin + 16, y + 29);
  doc.setFontSize(15);
  doc.text(formatMoney(payment.amount), pageWidth - margin - 16, y + 30, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text(
    'Generated by SnackFactory ERP · Immutable Payment Ledger Receipt',
    margin,
    790,
  );
  doc.text('Authorized Accounts Signatory', pageWidth - margin, 790, { align: 'right' });

  doc.save(`${payment.receiptNumber}.pdf`);
}

export function downloadMonthlyAuditReportPdf(
  dataset: import('./costingAndAudit').MonthlyAuditDataset,
  validations: import('./costingAndAudit').AuditValidationCheck[],
): void {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 38;
  let y = 40;

  const ensureSpace = (needed: number) => {
    if (y + needed > 780) {
      doc.addPage();
      y = 42;
    }
  };

  // Title Banner
  doc.setFillColor(11, 22, 44);
  doc.rect(margin, y, pageWidth - margin * 2, 54, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('SNACKFACTORY ERP · MONTHLY FINANCIAL & STOCK AUDIT REPORT', margin + 14, y + 22);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Audit Window: ${dataset.fromDate} to ${dataset.toDate}`, margin + 14, y + 40);
  doc.text(`Generated: ${new Date().toISOString().slice(0, 10)}`, pageWidth - margin - 14, y + 40, {
    align: 'right',
  });

  y += 72;
  doc.setTextColor(15, 23, 42);

  // Section 1: Profit & Loss Summary
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('1. Profit & Loss and Financial Summary', margin, y);
  y += 14;

  const pnl = dataset.profitAndLoss;
  const pnlLines: Array<[string, string]> = [
    ['Sales Revenue (Excl. GST)', formatMoney(pnl.salesRevenueExclGst)],
    ['GST Collected on Sales', formatMoney(pnl.gstCollected)],
    ['Gross Sales Invoiced (Incl. GST)', formatMoney(pnl.grossSalesInclGst)],
    ['Raw Material Consumed Cost (WAC)', formatMoney(pnl.rawMaterialConsumedCost)],
    ['Packaging Material Consumed Cost (WAC)', formatMoney(pnl.packagingConsumedCost)],
    ['Labour + Gas/Electricity + Other Prod. Expenses', formatMoney(pnl.labourExpenses + pnl.gasElectricityExpenses + pnl.otherProductionExpenses)],
    ['Total Production Cost', formatMoney(pnl.totalProductionCost)],
    ['Gross Manufacturing Profit', formatMoney(pnl.grossManufacturingProfit)],
    ['Gross Margin (%)', pnl.grossMarginPercent !== null ? `${pnl.grossMarginPercent.toFixed(2)}%` : 'N/A'],
    ['Received Purchases (Excl. GST)', formatMoney(pnl.purchasesExclGst)],
    ['Customer Cash Collected (Period)', formatMoney(pnl.cashCollectedInPeriod)],
    ['Total Outstanding Receivables (All-Time)', formatMoney(pnl.totalOutstandingReceivables)],
  ];

  doc.setFontSize(8.5);
  pnlLines.forEach(([label, val], idx) => {
    ensureSpace(18);
    if (idx % 2 === 0) {
      doc.setFillColor(248, 250, 252);
      doc.rect(margin, y, pageWidth - margin * 2, 16, 'F');
    }
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(51, 65, 85);
    doc.text(label, margin + 8, y + 11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text(val, pageWidth - margin - 8, y + 11, { align: 'right' });
    y += 16;
  });

  // Section 2: 9-Point Automated Audit Validation
  y += 16;
  ensureSpace(40);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('2. Automated Audit Validation Summary (9 Rules)', margin, y);
  y += 14;

  validations.forEach((chk) => {
    ensureSpace(22);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(15, 23, 42);
    doc.text(chk.title, margin + 6, y + 10);
    doc.setTextColor(
      chk.status === 'Pass' ? 5 : chk.status === 'Warning' ? 180 : 185,
      chk.status === 'Pass' ? 150 : chk.status === 'Warning' ? 83 : 28,
      chk.status === 'Pass' ? 105 : chk.status === 'Warning' ? 9 : 28,
    );
    doc.text(
      `${chk.status.toUpperCase()} (${chk.affectedCount} issue${chk.affectedCount === 1 ? '' : 's'})`,
      pageWidth - margin - 6,
      y + 10,
      { align: 'right' },
    );
    doc.setDrawColor(226, 232, 240);
    doc.line(margin, y + 15, pageWidth - margin, y + 15);
    y += 17;
  });

  // Section 3: Product Costing & Sales Register Summary
  y += 16;
  ensureSpace(40);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text('3. Product-Wise Production Cost & Sales Summary', margin, y);
  y += 14;

  if (dataset.productSummaries.length === 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.text('No completed production or sales activity recorded in this period.', margin + 6, y + 10);
    y += 18;
  } else {
    doc.setFillColor(241, 245, 249);
    doc.rect(margin, y, pageWidth - margin * 2, 18, 'F');
    doc.setFontSize(8);
    doc.text('SKU / Product', margin + 6, y + 12);
    doc.text('Good Pkts', margin + 225, y + 12, { align: 'right' });
    doc.text('Avg Cost/Pkt', margin + 300, y + 12, { align: 'right' });
    doc.text('Invoiced Qty', margin + 385, y + 12, { align: 'right' });
    doc.text('Sales (Excl GST)', pageWidth - margin - 6, y + 12, { align: 'right' });
    y += 18;

    dataset.productSummaries.forEach((p) => {
      ensureSpace(18);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.text(`${p.productSku} · ${p.productName}`.slice(0, 34), margin + 6, y + 11);
      doc.text(String(p.producedGoodQty), margin + 225, y + 11, { align: 'right' });
      doc.text(
        p.avgCostPerPacket !== null ? formatMoney(p.avgCostPerPacket) : 'N/A',
        margin + 300,
        y + 11,
        { align: 'right' },
      );
      doc.text(String(p.invoicedQty), margin + 385, y + 11, { align: 'right' });
      doc.text(formatMoney(p.salesTaxableValue), pageWidth - margin - 6, y + 11, { align: 'right' });
      y += 16;
    });
  }

  // Section 4: Customer Outstanding Balances
  y += 16;
  ensureSpace(40);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('4. Customer Billing & Outstanding Receivables', margin, y);
  y += 14;

  if (dataset.customerSummaries.length === 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.text('No customer invoices or receivables recorded.', margin + 6, y + 10);
  } else {
    doc.setFillColor(241, 245, 249);
    doc.rect(margin, y, pageWidth - margin * 2, 18, 'F');
    doc.setFontSize(8);
    doc.text('Customer Name', margin + 6, y + 12);
    doc.text('Period Billed', margin + 260, y + 12, { align: 'right' });
    doc.text('Period Paid', margin + 355, y + 12, { align: 'right' });
    doc.text('Total Due', pageWidth - margin - 6, y + 12, { align: 'right' });
    y += 18;

    dataset.customerSummaries.forEach((c) => {
      ensureSpace(18);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.text(c.customerName.slice(0, 38), margin + 6, y + 11);
      doc.text(formatMoney(c.periodBilled), margin + 260, y + 11, { align: 'right' });
      doc.text(formatMoney(c.periodPaid), margin + 355, y + 11, { align: 'right' });
      doc.text(formatMoney(c.outstandingBalance), pageWidth - margin - 6, y + 11, { align: 'right' });
      y += 16;
    });
  }

  doc.save(`SnackFactory_Audit_Report_${dataset.fromDate}_to_${dataset.toDate}.pdf`);
}
