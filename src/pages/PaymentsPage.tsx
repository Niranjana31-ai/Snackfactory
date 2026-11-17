import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  Eye,
  Plus,
  Printer,
  Search,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import {
  collection,
  doc,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../lib/firebase';
import { handleFirestoreError, OperationType } from '../lib/firestoreError';
import { downloadPaymentReceiptPdf } from '../lib/pdfGenerator';
import {
  findDuplicatePaymentConflict,
  roundCurrency,
  validatePaymentInput,
} from '../lib/validation';
import {
  ORG_ID,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  type Invoice,
  type Payment,
  type PaymentMethod,
  type PaymentStatus,
} from '../types/erp';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function nextReceiptNumber(payments: Payment[]): string {
  const year = new Date().getFullYear();
  const prefix = `RCPT-${year}-`;
  let maxSeq = 0;
  payments.forEach((p) => {
    if (p.receiptNumber.startsWith(prefix)) {
      const n = Number(p.receiptNumber.slice(prefix.length));
      if (Number.isInteger(n) && n > maxSeq) maxSeq = n;
    }
  });
  return `${prefix}${String(maxSeq + 1).padStart(4, '0')}`;
}

function statusBadge(status: PaymentStatus): string {
  switch (status) {
    case 'Paid':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'Partially Paid':
      return 'bg-amber-50 text-amber-800 border-amber-200';
    case 'Unpaid':
      return 'bg-red-50 text-red-700 border-red-200';
  }
}

export function PaymentsPage() {
  const { firebaseUser, userProfile, effectiveRole } = useAuth();
  const activeRole = effectiveRole ?? userProfile?.role ?? 'Salesman';
  const realRole = userProfile?.role ?? 'Salesman';
  const isSalesmanOnly = realRole === 'Salesman';

  const canRecordPayment =
    ['Owner', 'Admin', 'Accountant/Auditor'].includes(activeRole) &&
    ['Owner', 'Admin', 'Accountant/Auditor'].includes(realRole);

  const [payments, setPayments] = useState<Payment[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<'receipts' | 'balances'>('receipts');
  const [searchTerm, setSearchTerm] = useState('');
  const [methodFilter, setMethodFilter] = useState<'All' | PaymentMethod>('All');
  const [invoiceStatusFilter, setInvoiceStatusFilter] = useState<'All' | PaymentStatus>('All');
  const [customerFilter, setCustomerFilter] = useState<string>('All');

  // Record Payment Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState('ALL');
  const [selectedInvoiceId, setSelectedInvoiceId] = useState('');
  const [receiptNumber, setReceiptNumber] = useState('');
  const [paymentDate, setPaymentDate] = useState(todayIso());
  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('Bank Transfer');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Printable Receipt Preview Modal
  const [viewingPayment, setViewingPayment] = useState<Payment | null>(null);

  useEffect(() => {
    if (!firebaseUser) return;
    setLoading(true);
    setLoadError(null);

    const paymentsQuery = isSalesmanOnly
      ? query(collection(db, 'payments'), where('salesmanUid', '==', firebaseUser.uid))
      : query(collection(db, 'payments'), where('orgId', '==', ORG_ID));

    const invoicesQuery = isSalesmanOnly
      ? query(collection(db, 'invoices'), where('salesmanUid', '==', firebaseUser.uid))
      : query(collection(db, 'invoices'), where('orgId', '==', ORG_ID));

    const unsubPayments = onSnapshot(
      paymentsQuery,
      (snap) => {
        const rows = snap.docs.map((d) => d.data() as Payment);
        rows.sort(
          (a, b) =>
            b.paymentDate.localeCompare(a.paymentDate) ||
            b.receiptNumber.localeCompare(a.receiptNumber),
        );
        setPayments(rows);
        setLoading(false);
      },
      (err) => {
        setLoading(false);
        setLoadError('Unable to load customer payments from Cloud Firestore.');
        handleFirestoreError(err, OperationType.LIST, 'payments');
      },
    );

    const unsubInvoices = onSnapshot(
      invoicesQuery,
      (snap) => {
        const rows = snap.docs.map((d) => d.data() as Invoice);
        rows.sort((a, b) => b.invoiceDate.localeCompare(a.invoiceDate));
        setInvoices(rows);
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, 'invoices');
      },
    );

    return () => {
      unsubPayments();
      unsubInvoices();
    };
  }, [firebaseUser, isSalesmanOnly]);

  const invoiceMap = useMemo(() => new Map(invoices.map((i) => [i.id, i])), [invoices]);

  const openInvoices = useMemo(
    () => invoices.filter((inv) => inv.outstandingBalance > 0),
    [invoices],
  );

  // Customer balances derived cleanly from live invoices & payments
  const customerBalances = useMemo(() => {
    const map = new Map<
      string,
      {
        customerId: string;
        customerName: string;
        totalInvoiced: number;
        totalPaid: number;
        outstandingBalance: number;
        invoiceCount: number;
        openInvoices: number;
        paymentCount: number;
        lastPaymentDate: string;
      }
    >();

    invoices.forEach((inv) => {
      const existing = map.get(inv.customerId) ?? {
        customerId: inv.customerId,
        customerName: inv.customerName,
        totalInvoiced: 0,
        totalPaid: 0,
        outstandingBalance: 0,
        invoiceCount: 0,
        openInvoices: 0,
        paymentCount: 0,
        lastPaymentDate: '',
      };
      existing.totalInvoiced = roundCurrency(existing.totalInvoiced + inv.grandTotal);
      existing.totalPaid = roundCurrency(existing.totalPaid + inv.amountPaid);
      existing.outstandingBalance = roundCurrency(
        existing.outstandingBalance + inv.outstandingBalance,
      );
      existing.invoiceCount += 1;
      if (inv.outstandingBalance > 0) existing.openInvoices += 1;
      map.set(inv.customerId, existing);
    });

    payments.forEach((p) => {
      const row = map.get(p.customerId);
      if (row) {
        row.paymentCount += 1;
        if (!row.lastPaymentDate || p.paymentDate > row.lastPaymentDate) {
          row.lastPaymentDate = p.paymentDate;
        }
      }
    });

    return Array.from(map.values()).sort(
      (a, b) => b.outstandingBalance - a.outstandingBalance || a.customerName.localeCompare(b.customerName),
    );
  }, [invoices, payments]);

  const customersWithOpenInvoices = useMemo(
    () => customerBalances.filter((c) => c.openInvoices > 0),
    [customerBalances],
  );

  const modalFilteredOpenInvoices = useMemo(() => {
    if (selectedCustomerId === 'ALL') return openInvoices;
    return openInvoices.filter((inv) => inv.customerId === selectedCustomerId);
  }, [openInvoices, selectedCustomerId]);

  const selectedInvoice = useMemo(
    () => openInvoices.find((inv) => inv.id === selectedInvoiceId) ?? null,
    [openInvoices, selectedInvoiceId],
  );

  const kpis = useMemo(() => {
    const totalInvoiced = roundCurrency(invoices.reduce((s, i) => s + i.grandTotal, 0));
    const totalCollected = roundCurrency(invoices.reduce((s, i) => s + i.amountPaid, 0));
    const totalOutstanding = roundCurrency(invoices.reduce((s, i) => s + i.outstandingBalance, 0));
    return {
      totalInvoiced,
      totalCollected,
      totalOutstanding,
      openCount: openInvoices.length,
    };
  }, [invoices, openInvoices.length]);

  const filteredPayments = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return payments.filter((p) => {
      const linkedInv = invoiceMap.get(p.invoiceId);
      const matchesMethod = methodFilter === 'All' || p.paymentMethod === methodFilter;
      const matchesCustomer = customerFilter === 'All' || p.customerId === customerFilter;
      const matchesStatus =
        invoiceStatusFilter === 'All' || linkedInv?.paymentStatus === invoiceStatusFilter;
      const matchesSearch =
        !term ||
        p.receiptNumber.toLowerCase().includes(term) ||
        p.invoiceNumber.toLowerCase().includes(term) ||
        p.customerName.toLowerCase().includes(term) ||
        p.referenceNumber.toLowerCase().includes(term) ||
        p.notes.toLowerCase().includes(term);
      return matchesMethod && matchesCustomer && matchesStatus && matchesSearch;
    });
  }, [payments, invoiceMap, methodFilter, customerFilter, invoiceStatusFilter, searchTerm]);

  const filteredCustomerBalances = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return customerBalances.filter((c) => {
      const matchesCustomer = customerFilter === 'All' || c.customerId === customerFilter;
      const matchesStatus =
        invoiceStatusFilter === 'All' ||
        (invoiceStatusFilter === 'Paid' && c.outstandingBalance === 0) ||
        (invoiceStatusFilter === 'Partially Paid' &&
          c.outstandingBalance > 0 &&
          c.totalPaid > 0) ||
        (invoiceStatusFilter === 'Unpaid' && c.outstandingBalance > 0 && c.totalPaid === 0);
      const matchesSearch = !term || c.customerName.toLowerCase().includes(term);
      return matchesCustomer && matchesStatus && matchesSearch;
    });
  }, [customerBalances, customerFilter, invoiceStatusFilter, searchTerm]);

  const openRecordModal = (preselectCustomerId = 'ALL') => {
    const matchingInvoices =
      preselectCustomerId === 'ALL'
        ? openInvoices
        : openInvoices.filter((i) => i.customerId === preselectCustomerId);
    const firstOpen = matchingInvoices[0] ?? openInvoices[0];

    setSelectedCustomerId(preselectCustomerId);
    setSelectedInvoiceId(firstOpen?.id ?? '');
    setReceiptNumber(nextReceiptNumber(payments));
    setPaymentDate(todayIso());
    setAmount(firstOpen ? String(firstOpen.outstandingBalance.toFixed(2)) : '');
    setPaymentMethod('Bank Transfer');
    setReferenceNumber('');
    setNotes('');
    setFormError(null);
    setModalOpen(true);
  };

  const handleCustomerInModalChange = (custId: string) => {
    setSelectedCustomerId(custId);
    const matching =
      custId === 'ALL' ? openInvoices : openInvoices.filter((i) => i.customerId === custId);
    const first = matching[0];
    setSelectedInvoiceId(first?.id ?? '');
    setAmount(first ? first.outstandingBalance.toFixed(2) : '');
  };

  const handleInvoiceSelection = (invoiceId: string) => {
    setSelectedInvoiceId(invoiceId);
    const inv = openInvoices.find((i) => i.id === invoiceId);
    if (inv) {
      setAmount(inv.outstandingBalance.toFixed(2));
    }
  };

  const handleSubmitPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !userProfile || !canRecordPayment || !selectedInvoice) return;

    const check = validatePaymentInput(
      {
        receiptNumber,
        paymentDate,
        amount,
        paymentMethod,
        referenceNumber,
        notes,
      },
      selectedInvoice,
    );

    if (!check.valid) {
      setFormError(check.error);
      return;
    }

    const duplicateErr = findDuplicatePaymentConflict(
      payments,
      check.sanitized.receiptNumber,
      check.sanitized.referenceNumber,
    );
    if (duplicateErr) {
      setFormError(duplicateErr);
      return;
    }

    setSaving(true);
    setFormError(null);

    try {
      await runTransaction(db, async (tx) => {
        const invRef = doc(db, 'invoices', selectedInvoice.id);
        const invSnap = await tx.get(invRef);
        if (!invSnap.exists()) {
          throw new Error('Selected GST invoice no longer exists.');
        }

        const freshInvoice = invSnap.data() as Invoice;
        const freshCheck = validatePaymentInput(
          {
            receiptNumber,
            paymentDate,
            amount,
            paymentMethod,
            referenceNumber,
            notes,
          },
          freshInvoice,
        );
        if (!freshCheck.valid) {
          throw new Error(freshCheck.error);
        }

        const clean = freshCheck.sanitized;
        const payRef = doc(collection(db, 'payments'));
        const auditRef = doc(collection(db, 'auditLogs'));

        tx.set(payRef, {
          id: payRef.id,
          orgId: ORG_ID,
          receiptNumber: clean.receiptNumber,
          invoiceId: freshInvoice.id,
          invoiceNumber: freshInvoice.invoiceNumber,
          salesOrderId: freshInvoice.salesOrderId,
          orderNumber: freshInvoice.orderNumber,
          salesmanUid: freshInvoice.salesmanUid,
          customerId: freshInvoice.customerId,
          customerName: freshInvoice.customerName,
          paymentDate: clean.paymentDate,
          amount: clean.amount,
          paymentMethod: clean.paymentMethod,
          referenceNumber: clean.referenceNumber,
          notes: clean.notes,
          recordedBy: firebaseUser.uid,
          recordedByName: userProfile.displayName,
          createdAt: serverTimestamp(),
        });

        tx.update(invRef, {
          amountPaid: clean.newAmountPaid,
          outstandingBalance: clean.newOutstandingBalance,
          paymentStatus: clean.newPaymentStatus,
          updatedAt: serverTimestamp(),
        });

        tx.set(auditRef, {
          id: auditRef.id,
          orgId: ORG_ID,
          action: 'PAYMENT_RECORDED',
          module: 'Payments',
          recordId: payRef.id,
          recordLabel: clean.receiptNumber,
          details: `Recorded ${clean.paymentMethod} payment of ₹${clean.amount.toFixed(2)} (Ref: ${clean.referenceNumber}) for ${freshInvoice.customerName} on ${freshInvoice.invoiceNumber}. Status: ${clean.newPaymentStatus}.`,
          userUid: firebaseUser.uid,
          userName: userProfile.displayName,
          userRole: realRole,
          createdAt: serverTimestamp(),
        });
      });

      setModalOpen(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to record customer payment.';
      if (msg.toLowerCase().includes('permission')) {
        handleFirestoreError(err, OperationType.CREATE, 'payments');
      }
      setFormError(msg);
    } finally {
      setSaving(false);
    }
  };

  const viewingInvoice = viewingPayment ? invoiceMap.get(viewingPayment.invoiceId) ?? null : null;

  return (
    <div className="space-y-6">
      <div className={viewingPayment ? 'no-print space-y-6' : 'space-y-6'}>
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-[#3B4F4E]">Finance &amp; Governance</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#3B4F4E]">
              Customer Payments &amp; Receivables
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Record partial or full invoice settlements, monitor customer-wise balances, block duplicate references, and download PDF receipts.
            </p>
          </div>

          <div className="shrink-0">
            {canRecordPayment ? (
              <button
                type="button"
                onClick={() => openRecordModal('ALL')}
                disabled={openInvoices.length === 0}
                className="min-h-[40px] inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#CF9C2D] hover:bg-[#BC8B22] disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap"
              >
                <Plus className="w-4 h-4 shrink-0" />
                Record Payment
              </button>
            ) : (
              <span className="text-xs text-slate-500">View-only for {activeRole}</span>
            )}
          </div>
        </div>

        {/* KPI Strip */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white border border-[#DCE6E6] rounded-xl p-4">
            <p className="text-xs font-medium text-slate-500">Total Invoiced</p>
            <p className="mt-2 text-2xl font-semibold font-mono tabular-nums text-[#3B4F4E]">
              ₹{kpis.totalInvoiced.toFixed(2)}
            </p>
          </div>
          <div className="bg-white border border-[#DCE6E6] rounded-xl p-4">
            <p className="text-xs font-medium text-slate-500">Total Collected</p>
            <p className="mt-2 text-2xl font-semibold font-mono tabular-nums text-emerald-700">
              ₹{kpis.totalCollected.toFixed(2)}
            </p>
          </div>
          <div className="bg-white border border-[#DCE6E6] rounded-xl p-4">
            <p className="text-xs font-medium text-slate-500">Outstanding Receivables</p>
            <p className="mt-2 text-2xl font-semibold font-mono tabular-nums text-red-700">
              ₹{kpis.totalOutstanding.toFixed(2)}
            </p>
          </div>
          <div className="bg-white border border-[#DCE6E6] rounded-xl p-4">
            <p className="text-xs font-medium text-slate-500">Open Invoices</p>
            <p className="mt-2 text-2xl font-semibold font-mono tabular-nums text-amber-700">
              {kpis.openCount}
            </p>
          </div>
        </div>

        {loadError && (
          <div
            role="alert"
            className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3 text-sm text-red-800"
          >
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            <span>{loadError}</span>
          </div>
        )}

        {/* Workspace View Tabs */}
        <div className="flex flex-wrap items-center gap-2 border-b border-[#DCE6E6] pb-3">
          <button
            type="button"
            onClick={() => setActiveTab('receipts')}
            className={`min-h-[36px] inline-flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
              activeTab === 'receipts'
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-700 border-[#DCE6E6] hover:bg-slate-50'
            }`}
          >
            <Wallet className="w-3.5 h-3.5" />
            Payment History ({payments.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('balances')}
            className={`min-h-[36px] inline-flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
              activeTab === 'balances'
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-700 border-[#DCE6E6] hover:bg-slate-50'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            Customer Outstanding Balances ({customerBalances.length})
          </button>
        </div>

        {/* Filters Strip */}
        <div className="bg-white border border-[#DCE6E6] rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-[#DCE6E6] space-y-3">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div className="relative flex-1 max-w-md">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="search"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search receipt no., invoice, customer, UTR/cheque ref..."
                  aria-label="Search payments"
                  className="w-full h-9 pl-9 pr-3 text-sm text-[#3B4F4E] bg-slate-50 border border-[#DCE6E6] rounded-lg focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#CF9C2D]"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={customerFilter}
                  onChange={(e) => setCustomerFilter(e.target.value)}
                  aria-label="Filter by customer"
                  className="h-9 px-3 text-xs font-medium text-slate-700 bg-slate-50 border border-[#DCE6E6] rounded-lg"
                >
                  <option value="All">All Customers</option>
                  {customerBalances.map((c) => (
                    <option key={c.customerId} value={c.customerId}>
                      {c.customerName}
                    </option>
                  ))}
                </select>

                <select
                  value={invoiceStatusFilter}
                  onChange={(e) =>
                    setInvoiceStatusFilter(e.target.value as 'All' | PaymentStatus)
                  }
                  aria-label="Filter by invoice payment status"
                  className="h-9 px-3 text-xs font-medium text-slate-700 bg-slate-50 border border-[#DCE6E6] rounded-lg"
                >
                  <option value="All">All Statuses</option>
                  {PAYMENT_STATUSES.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {activeTab === 'receipts' && (
              <div className="flex flex-wrap items-center gap-1.5">
                {(['All', ...PAYMENT_METHODS] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMethodFilter(m)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md border transition-colors ${
                      methodFilter === m
                        ? 'bg-[#CF9C2D] text-white border-[#3B4F4E]'
                        : 'bg-slate-50 text-slate-600 border-[#DCE6E6] hover:bg-slate-100'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            )}
          </div>

          {activeTab === 'receipts' ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#DCE6E6] bg-slate-50/70">
                    <th className="px-5 py-3 text-xs font-semibold text-slate-600">Receipt No.</th>
                    <th className="px-5 py-3 text-xs font-semibold text-slate-600">Invoice / Order</th>
                    <th className="px-5 py-3 text-xs font-semibold text-slate-600">Customer</th>
                    <th className="px-5 py-3 text-xs font-semibold text-slate-600">Method &amp; Ref</th>
                    <th className="px-5 py-3 text-xs font-semibold text-slate-600">Payment Date</th>
                    <th className="px-5 py-3 text-xs font-semibold text-slate-600">Invoice Status</th>
                    <th className="px-5 py-3 text-xs font-semibold text-slate-600 text-right">Amount</th>
                    <th className="px-5 py-3 text-xs font-semibold text-slate-600 text-right">Receipt PDF</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {loading ? (
                    <tr>
                      <td colSpan={8} className="px-5 py-12 text-center text-sm text-slate-500">
                        Loading payment receipts...
                      </td>
                    </tr>
                  ) : filteredPayments.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-6 py-14 text-center">
                        <div className="max-w-md mx-auto flex flex-col items-center">
                          <div className="w-11 h-11 rounded-xl bg-slate-100 border border-[#DCE6E6] flex items-center justify-center text-slate-500 mb-3">
                            <Wallet className="w-5 h-5" />
                          </div>
                          <h2 className="text-base font-semibold text-[#3B4F4E]">
                            {payments.length === 0
                              ? 'No customer payments recorded yet'
                              : 'No matching payments'}
                          </h2>
                          <p className="mt-1 text-sm text-slate-600">
                            {payments.length === 0
                              ? 'Issue a GST invoice first, then link customer receipts here to reduce outstanding receivables.'
                              : 'Try adjusting your search, customer, status, or payment method filters.'}
                          </p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredPayments.map((p) => {
                      const inv = invoiceMap.get(p.invoiceId) ?? null;
                      return (
                        <tr key={p.id} className="hover:bg-slate-50/70">
                          <td className="px-5 py-3.5 font-mono text-xs font-semibold text-[#3B4F4E] whitespace-nowrap">
                            {p.receiptNumber}
                          </td>
                          <td className="px-5 py-3.5 whitespace-nowrap">
                            <p className="font-mono text-xs font-medium text-[#3B4F4E]">
                              {p.invoiceNumber}
                            </p>
                            <p className="font-mono text-[11px] text-slate-500">{p.orderNumber}</p>
                          </td>
                          <td className="px-5 py-3.5">
                            <p className="text-sm text-[#3B4F4E]">{p.customerName}</p>
                            {p.notes && (
                              <p className="text-[11px] text-slate-500 truncate max-w-[180px]">
                                {p.notes}
                              </p>
                            )}
                          </td>
                          <td className="px-5 py-3.5 text-xs text-slate-700 whitespace-nowrap">
                            <p className="font-medium">{p.paymentMethod}</p>
                            <p className="font-mono text-[11px] text-slate-500">
                              {p.referenceNumber}
                            </p>
                          </td>
                          <td className="px-5 py-3.5 font-mono text-xs text-slate-600 whitespace-nowrap">
                            {p.paymentDate}
                          </td>
                          <td className="px-5 py-3.5 whitespace-nowrap">
                            {inv ? (
                              <span
                                className={`inline-flex items-center px-2 py-0.5 text-[11px] font-medium rounded-md border ${statusBadge(
                                  inv.paymentStatus,
                                )}`}
                              >
                                {inv.paymentStatus}
                              </span>
                            ) : (
                              <span className="text-xs text-slate-400">—</span>
                            )}
                          </td>
                          <td className="px-5 py-3.5 font-mono text-sm font-semibold text-emerald-700 text-right tabular-nums whitespace-nowrap">
                            ₹{p.amount.toFixed(2)}
                          </td>
                          <td className="px-5 py-3.5 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => setViewingPayment(p)}
                                className="min-h-[30px] inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-[#3B4F4E] bg-[#EEF3F3] hover:bg-[#E5EDED] rounded-md"
                              >
                                <Eye className="w-3.5 h-3.5" />
                                View
                              </button>
                              <button
                                type="button"
                                onClick={() => downloadPaymentReceiptPdf(p, inv)}
                                className="min-h-[30px] inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-[#DCE6E6] rounded-md"
                              >
                                <Download className="w-3.5 h-3.5" />
                                PDF
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#DCE6E6] bg-slate-50/70">
                    <th className="px-5 py-3 text-xs font-semibold text-slate-600">Customer</th>
                    <th className="px-5 py-3 text-xs font-semibold text-slate-600 text-right">Invoices</th>
                    <th className="px-5 py-3 text-xs font-semibold text-slate-600 text-right">Total Billed</th>
                    <th className="px-5 py-3 text-xs font-semibold text-slate-600 text-right">Total Paid</th>
                    <th className="px-5 py-3 text-xs font-semibold text-slate-600 text-right">Outstanding Balance</th>
                    <th className="px-5 py-3 text-xs font-semibold text-slate-600">Last Payment</th>
                    <th className="px-5 py-3 text-xs font-semibold text-slate-600 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {filteredCustomerBalances.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-5 py-12 text-center text-sm text-slate-500">
                        No customer receivable balances found.
                      </td>
                    </tr>
                  ) : (
                    filteredCustomerBalances.map((c) => (
                      <tr key={c.customerId} className="hover:bg-slate-50/70">
                        <td className="px-5 py-3.5">
                          <p className="text-sm font-medium text-[#3B4F4E]">{c.customerName}</p>
                          <p className="text-[11px] text-slate-500">
                            {c.paymentCount} receipt{c.paymentCount === 1 ? '' : 's'}
                          </p>
                        </td>
                        <td className="px-5 py-3.5 font-mono text-xs text-slate-700 text-right">
                          {c.invoiceCount}{' '}
                          {c.openInvoices > 0 && (
                            <span className="text-amber-700">({c.openInvoices} open)</span>
                          )}
                        </td>
                        <td className="px-5 py-3.5 font-mono text-xs text-[#3B4F4E] text-right tabular-nums">
                          ₹{c.totalInvoiced.toFixed(2)}
                        </td>
                        <td className="px-5 py-3.5 font-mono text-xs text-emerald-700 text-right tabular-nums">
                          ₹{c.totalPaid.toFixed(2)}
                        </td>
                        <td className="px-5 py-3.5 font-mono text-sm font-semibold text-right tabular-nums">
                          <span
                            className={
                              c.outstandingBalance > 0 ? 'text-red-700' : 'text-emerald-700'
                            }
                          >
                            ₹{c.outstandingBalance.toFixed(2)}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 font-mono text-xs text-slate-600">
                          {c.lastPaymentDate || '—'}
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          {canRecordPayment && c.openInvoices > 0 ? (
                            <button
                              type="button"
                              onClick={() => openRecordModal(c.customerId)}
                              className="min-h-[30px] inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-[#3B4F4E] bg-[#EEF3F3] hover:bg-[#E5EDED] rounded-md"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              Collect
                            </button>
                          ) : (
                            <span className="text-xs text-slate-400">
                              {c.outstandingBalance === 0 ? 'Settled' : 'View-only'}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Record Payment Modal */}
      {modalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/50 overflow-y-auto no-print"
        >
          <div className="w-full max-w-xl bg-white border border-[#DCE6E6] rounded-xl overflow-hidden my-8">
            <div className="px-6 py-4 border-b border-[#DCE6E6] flex items-center justify-between">
              <h2 className="text-base font-semibold text-[#3B4F4E]">Record Customer Payment</h2>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                aria-label="Close modal"
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmitPayment} className="p-6 space-y-4">
              {formError && (
                <div
                  role="alert"
                  className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-start gap-2"
                >
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{formError}</span>
                </div>
              )}

              <div>
                <label htmlFor="pay-cust" className="block text-xs font-medium text-slate-700 mb-1">
                  Customer Filter
                </label>
                <select
                  id="pay-cust"
                  value={selectedCustomerId}
                  onChange={(e) => handleCustomerInModalChange(e.target.value)}
                  className="w-full h-9 px-3 text-sm border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                >
                  <option value="ALL">
                    All Customers with Open Invoices ({openInvoices.length} open)
                  </option>
                  {customersWithOpenInvoices.map((c) => (
                    <option key={c.customerId} value={c.customerId}>
                      {c.customerName} (Total Due ₹{c.outstandingBalance.toFixed(2)})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="pay-inv" className="block text-xs font-medium text-slate-700 mb-1">
                  Corresponding Open GST Invoice *
                </label>
                <select
                  id="pay-inv"
                  value={selectedInvoiceId}
                  onChange={(e) => handleInvoiceSelection(e.target.value)}
                  className="w-full h-9 px-3 text-sm border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                >
                  {modalFilteredOpenInvoices.map((inv) => (
                    <option key={inv.id} value={inv.id}>
                      {inv.invoiceNumber} · {inv.customerName} (Due ₹
                      {inv.outstandingBalance.toFixed(2)})
                    </option>
                  ))}
                </select>
              </div>

              {selectedInvoice && (
                <div className="bg-slate-50 border border-[#DCE6E6] rounded-lg p-3.5 grid grid-cols-3 gap-3 text-xs font-mono">
                  <div>
                    <p className="text-slate-500">Invoice Total</p>
                    <p className="font-semibold text-[#3B4F4E] mt-0.5">
                      ₹{selectedInvoice.grandTotal.toFixed(2)}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-500">Already Paid</p>
                    <p className="font-semibold text-emerald-700 mt-0.5">
                      ₹{selectedInvoice.amountPaid.toFixed(2)}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-500">Outstanding</p>
                    <p className="font-semibold text-red-700 mt-0.5">
                      ₹{selectedInvoice.outstandingBalance.toFixed(2)}
                    </p>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="pay-rcpt" className="block text-xs font-medium text-slate-700 mb-1">
                    Receipt Number *
                  </label>
                  <input
                    id="pay-rcpt"
                    type="text"
                    value={receiptNumber}
                    onChange={(e) => setReceiptNumber(e.target.value.toUpperCase())}
                    className="w-full h-9 px-3 font-mono text-sm border border-[#DCE6E6] rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="pay-date" className="block text-xs font-medium text-slate-700 mb-1">
                    Payment Date *
                  </label>
                  <input
                    id="pay-date"
                    type="date"
                    value={paymentDate}
                    onChange={(e) => setPaymentDate(e.target.value)}
                    className="w-full h-9 px-3 font-mono text-sm border border-[#DCE6E6] rounded-lg"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label htmlFor="pay-amt" className="block text-xs font-medium text-slate-700">
                      Amount Received (₹) *
                    </label>
                    {selectedInvoice && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setAmount((selectedInvoice.outstandingBalance / 2).toFixed(2))
                          }
                          className="text-[11px] font-medium text-slate-600 hover:text-slate-800"
                        >
                          50%
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setAmount(selectedInvoice.outstandingBalance.toFixed(2))
                          }
                          className="text-[11px] font-medium text-[#3B4F4E] hover:text-[#3B4F4E]"
                        >
                          Full Balance
                        </button>
                      </div>
                    )}
                  </div>
                  <input
                    id="pay-amt"
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="w-full h-9 px-3 font-mono text-sm border border-[#DCE6E6] rounded-lg"
                  />
                </div>
                <div>
                  <label
                    htmlFor="pay-method"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Payment Method *
                  </label>
                  <select
                    id="pay-method"
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                    className="w-full h-9 px-3 text-sm border border-[#DCE6E6] rounded-lg"
                  >
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="pay-ref" className="block text-xs font-medium text-slate-700 mb-1">
                  Transaction Reference / UTR / Cheque / Cash Voucher No. *
                </label>
                <input
                  id="pay-ref"
                  type="text"
                  maxLength={80}
                  value={referenceNumber}
                  onChange={(e) => setReferenceNumber(e.target.value)}
                  placeholder="e.g. UTR89234110, CHQ-4092, or CASH-2026-01"
                  className="w-full h-9 px-3 font-mono text-sm border border-[#DCE6E6] rounded-lg"
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  Must be unique across receipts to prevent duplicate payment postings.
                </p>
              </div>

              <div>
                <label htmlFor="pay-notes" className="block text-xs font-medium text-slate-700 mb-1">
                  Payment Remarks
                </label>
                <input
                  id="pay-notes"
                  type="text"
                  maxLength={300}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional bank account, partial settlement remarks, or cheque details..."
                  className="w-full h-9 px-3 text-sm border border-[#DCE6E6] rounded-lg"
                />
              </div>

              <div className="pt-3 border-t border-[#DCE6E6] flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="min-h-[38px] px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-[#DCE6E6] rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || !selectedInvoice}
                  className="min-h-[38px] inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-[#CF9C2D] hover:bg-[#BC8B22] disabled:opacity-60 rounded-lg"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {saving ? 'Recording...' : 'Record Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Printable Receipt Preview Modal */}
      {viewingPayment && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/50 overflow-y-auto print-only-sheet"
        >
          <div className="w-full max-w-2xl bg-white border border-[#DCE6E6] rounded-xl overflow-hidden my-6 print-only-sheet">
            <div className="px-6 py-4 border-b border-[#DCE6E6] flex items-center justify-between no-print">
              <h2 className="text-base font-semibold text-[#3B4F4E]">
                Payment Receipt · {viewingPayment.receiptNumber}
              </h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => downloadPaymentReceiptPdf(viewingPayment, viewingInvoice)}
                  className="min-h-[34px] inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-[#DCE6E6] rounded-lg"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download PDF
                </button>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="min-h-[34px] inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#CF9C2D] hover:bg-[#BC8B22] rounded-lg"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Print
                </button>
                <button
                  type="button"
                  onClick={() => setViewingPayment(null)}
                  aria-label="Close receipt preview"
                  className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="p-6 space-y-5 text-sm">
              <div className="bg-[#0B162C] text-white rounded-lg p-5 flex items-center justify-between">
                <div>
                  <p className="text-base font-semibold">
                    {viewingInvoice?.factoryName ?? 'SnackFactory Foods Pvt. Ltd.'}
                  </p>
                  <p className="text-xs text-slate-300 mt-0.5">OFFICIAL CUSTOMER PAYMENT RECEIPT</p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-sm font-semibold">{viewingPayment.receiptNumber}</p>
                  <p className="font-mono text-xs text-slate-300 mt-0.5">
                    Date: {viewingPayment.paymentDate}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border border-[#DCE6E6] rounded-lg p-4 text-xs">
                <div className="space-y-1.5">
                  <p className="font-semibold text-slate-500">RECEIVED FROM</p>
                  <p className="text-sm font-semibold text-[#3B4F4E]">
                    {viewingPayment.customerName}
                  </p>
                  <p className="text-slate-600">
                    Method: <strong className="text-slate-800">{viewingPayment.paymentMethod}</strong>
                  </p>
                  <p className="text-slate-600">
                    Ref No:{' '}
                    <span className="font-mono text-slate-800">{viewingPayment.referenceNumber}</span>
                  </p>
                  <p className="text-slate-600">Recorded By: {viewingPayment.recordedByName}</p>
                </div>
                <div className="space-y-1.5">
                  <p className="font-semibold text-slate-500">INVOICE RECONCILIATION</p>
                  <p className="font-mono text-sm font-semibold text-[#3B4F4E]">
                    {viewingPayment.invoiceNumber}
                  </p>
                  <p className="text-slate-600">Sales Order: {viewingPayment.orderNumber}</p>
                  {viewingInvoice && (
                    <>
                      <p className="text-slate-600">
                        Invoice Grand Total: ₹{viewingInvoice.grandTotal.toFixed(2)}
                      </p>
                      <p className="text-slate-600">
                        Remaining Balance:{' '}
                        <span className="font-mono font-semibold text-[#3B4F4E]">
                          ₹{viewingInvoice.outstandingBalance.toFixed(2)}
                        </span>{' '}
                        ({viewingInvoice.paymentStatus})
                      </p>
                    </>
                  )}
                </div>
              </div>

              <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-5 py-4 flex items-center justify-between">
                <span className="text-xs font-semibold text-emerald-900 uppercase tracking-wide">
                  Amount Received
                </span>
                <span className="font-mono text-xl font-bold text-emerald-800">
                  ₹{viewingPayment.amount.toFixed(2)}
                </span>
              </div>

              {viewingPayment.notes && (
                <p className="text-xs text-slate-600">
                  <strong>Remarks:</strong> {viewingPayment.notes}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
