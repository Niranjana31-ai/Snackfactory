import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  Eye,
  FileText,
  Plus,
  Printer,
  Search,
  Settings,
  X,
} from 'lucide-react';
import {
  collection,
  doc,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../lib/firebase';
import { handleFirestoreError, OperationType } from '../lib/firestoreError';
import { downloadGstInvoicePdf } from '../lib/pdfGenerator';
import {
  computeLineTaxBreakdown,
  DEFAULT_FACTORY_SETTINGS,
  isIntraStateSupply,
  roundCurrency,
  validateFactorySettingsInput,
} from '../lib/validation';
import {
  ORG_ID,
  PAYMENT_STATUSES,
  type FactorySettings,
  type Invoice,
  type InvoiceItem,
  type PaymentStatus,
  type SalesOrder,
  type SalesOrderItem,
} from '../types/erp';

type InvoiceFilter = 'All' | PaymentStatus;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function paymentStatusBadge(status: PaymentStatus): string {
  switch (status) {
    case 'Paid':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'Partially Paid':
      return 'bg-amber-50 text-amber-800 border-amber-200';
    case 'Unpaid':
      return 'bg-red-50 text-red-700 border-red-200';
  }
}

export function InvoicesPage() {
  const { firebaseUser, userProfile, effectiveRole } = useAuth();
  const activeRole = effectiveRole ?? userProfile?.role ?? 'Salesman';
  const realRole = userProfile?.role ?? 'Salesman';
  const isSalesmanOnly = realRole === 'Salesman';

  const canManageInvoices =
    ['Owner', 'Admin', 'Accountant/Auditor'].includes(activeRole) &&
    ['Owner', 'Admin', 'Accountant/Auditor'].includes(realRole);
  const canEditFactorySettings =
    ['Owner', 'Admin'].includes(activeRole) && ['Owner', 'Admin'].includes(realRole);

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [invoiceItems, setInvoiceItems] = useState<InvoiceItem[]>([]);
  const [salesOrders, setSalesOrders] = useState<SalesOrder[]>([]);
  const [orderItems, setOrderItems] = useState<SalesOrderItem[]>([]);
  const [factoryConfigDoc, setFactoryConfigDoc] = useState<FactorySettings | null>(null);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<InvoiceFilter>('All');

  // Generate Invoice Modal
  const [genModalOpen, setGenModalOpen] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(todayIso());
  const [invoiceNotes, setInvoiceNotes] = useState('');
  const [genError, setGenError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  // Factory GST Config Modal
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [cfgName, setCfgName] = useState<string>(DEFAULT_FACTORY_SETTINGS.factoryName);
  const [cfgAddress, setCfgAddress] = useState<string>(DEFAULT_FACTORY_SETTINGS.factoryAddress);
  const [cfgState, setCfgState] = useState<string>(DEFAULT_FACTORY_SETTINGS.factoryState);
  const [cfgStateCode, setCfgStateCode] = useState<string>(DEFAULT_FACTORY_SETTINGS.factoryStateCode);
  const [cfgGstin, setCfgGstin] = useState<string>(DEFAULT_FACTORY_SETTINGS.factoryGstin);
  const [cfgPrefix, setCfgPrefix] = useState<string>(DEFAULT_FACTORY_SETTINGS.invoicePrefix);
  const [cfgSeq, setCfgSeq] = useState<string>(String(DEFAULT_FACTORY_SETTINGS.nextInvoiceSeq));
  const [cfgHsn, setCfgHsn] = useState<string>(DEFAULT_FACTORY_SETTINGS.defaultHsnCode);
  const [cfgError, setCfgError] = useState<string | null>(null);
  const [savingCfg, setSavingCfg] = useState(false);

  const [viewingInvoice, setViewingInvoice] = useState<Invoice | null>(null);

  useEffect(() => {
    if (!firebaseUser) return;
    setLoading(true);
    setLoadError(null);

    const invQuery = isSalesmanOnly
      ? query(collection(db, 'invoices'), where('salesmanUid', '==', firebaseUser.uid))
      : query(collection(db, 'invoices'), where('orgId', '==', ORG_ID));

    const invItemsQuery = isSalesmanOnly
      ? query(collection(db, 'invoiceItems'), where('salesmanUid', '==', firebaseUser.uid))
      : query(collection(db, 'invoiceItems'), where('orgId', '==', ORG_ID));

    const soQuery = isSalesmanOnly
      ? query(collection(db, 'salesOrders'), where('salesmanUid', '==', firebaseUser.uid))
      : query(collection(db, 'salesOrders'), where('orgId', '==', ORG_ID));

    const soItemsQuery = isSalesmanOnly
      ? query(collection(db, 'salesOrderItems'), where('salesmanUid', '==', firebaseUser.uid))
      : query(collection(db, 'salesOrderItems'), where('orgId', '==', ORG_ID));

    const unsubInvoices = onSnapshot(
      invQuery,
      (snap) => {
        const rows = snap.docs.map((d) => d.data() as Invoice);
        rows.sort(
          (a, b) =>
            b.invoiceDate.localeCompare(a.invoiceDate) ||
            b.invoiceNumber.localeCompare(a.invoiceNumber),
        );
        setInvoices(rows);
        setLoading(false);
      },
      (err) => {
        setLoading(false);
        setLoadError('Unable to load GST invoices from Cloud Firestore.');
        handleFirestoreError(err, OperationType.LIST, 'invoices');
      },
    );

    const unsubInvItems = onSnapshot(
      invItemsQuery,
      (snap) => {
        setInvoiceItems(snap.docs.map((d) => d.data() as InvoiceItem));
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, 'invoiceItems');
      },
    );

    const unsubOrders = onSnapshot(
      soQuery,
      (snap) => {
        setSalesOrders(snap.docs.map((d) => d.data() as SalesOrder));
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, 'salesOrders');
      },
    );

    const unsubOrderItems = onSnapshot(
      soItemsQuery,
      (snap) => {
        setOrderItems(snap.docs.map((d) => d.data() as SalesOrderItem));
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, 'salesOrderItems');
      },
    );

    const unsubCfg = onSnapshot(
      doc(db, 'settings', 'factoryConfig'),
      (snap) => {
        if (snap.exists()) {
          setFactoryConfigDoc(snap.data() as FactorySettings);
        } else {
          setFactoryConfigDoc(null);
        }
      },
      (err) => {
        handleFirestoreError(err, OperationType.GET, 'settings/factoryConfig');
      },
    );

    return () => {
      unsubInvoices();
      unsubInvItems();
      unsubOrders();
      unsubOrderItems();
      unsubCfg();
    };
  }, [firebaseUser, isSalesmanOnly]);

  const activeSettings = useMemo(
    () => ({
      factoryName: factoryConfigDoc?.factoryName ?? DEFAULT_FACTORY_SETTINGS.factoryName,
      factoryAddress: factoryConfigDoc?.factoryAddress ?? DEFAULT_FACTORY_SETTINGS.factoryAddress,
      factoryState: factoryConfigDoc?.factoryState ?? DEFAULT_FACTORY_SETTINGS.factoryState,
      factoryStateCode:
        factoryConfigDoc?.factoryStateCode ?? DEFAULT_FACTORY_SETTINGS.factoryStateCode,
      factoryGstin: factoryConfigDoc?.factoryGstin ?? DEFAULT_FACTORY_SETTINGS.factoryGstin,
      invoicePrefix: factoryConfigDoc?.invoicePrefix ?? DEFAULT_FACTORY_SETTINGS.invoicePrefix,
      nextInvoiceSeq: factoryConfigDoc?.nextInvoiceSeq ?? DEFAULT_FACTORY_SETTINGS.nextInvoiceSeq,
      defaultHsnCode: factoryConfigDoc?.defaultHsnCode ?? DEFAULT_FACTORY_SETTINGS.defaultHsnCode,
    }),
    [factoryConfigDoc],
  );

  const invoiceableOrders = useMemo(
    () =>
      salesOrders.filter(
        (o) =>
          (o.status === 'Approved' ||
            o.status === 'Partially Dispatched' ||
            o.status === 'Dispatched') &&
          !o.invoiceId,
      ),
    [salesOrders],
  );

  const itemsByInvoiceId = useMemo(() => {
    const map = new Map<string, InvoiceItem[]>();
    invoiceItems.forEach((item) => {
      const list = map.get(item.invoiceId) ?? [];
      list.push(item);
      map.set(item.invoiceId, list);
    });
    return map;
  }, [invoiceItems]);

  const filteredInvoices = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return invoices.filter((inv) => {
      const matchesStatus = statusFilter === 'All' || inv.paymentStatus === statusFilter;
      const matchesSearch =
        !term ||
        inv.invoiceNumber.toLowerCase().includes(term) ||
        inv.orderNumber.toLowerCase().includes(term) ||
        inv.customerName.toLowerCase().includes(term) ||
        inv.customerGstin.toLowerCase().includes(term);
      return matchesStatus && matchesSearch;
    });
  }, [invoices, searchTerm, statusFilter]);

  const totals = useMemo(() => {
    const totalBilled = roundCurrency(invoices.reduce((s, i) => s + i.grandTotal, 0));
    const totalCollected = roundCurrency(invoices.reduce((s, i) => s + i.amountPaid, 0));
    const totalOutstanding = roundCurrency(invoices.reduce((s, i) => s + i.outstandingBalance, 0));
    return { count: invoices.length, totalBilled, totalCollected, totalOutstanding };
  }, [invoices]);

  const openSettingsModal = () => {
    setCfgName(activeSettings.factoryName);
    setCfgAddress(activeSettings.factoryAddress);
    setCfgState(activeSettings.factoryState);
    setCfgStateCode(activeSettings.factoryStateCode);
    setCfgGstin(activeSettings.factoryGstin);
    setCfgPrefix(activeSettings.invoicePrefix);
    setCfgSeq(String(activeSettings.nextInvoiceSeq));
    setCfgHsn(activeSettings.defaultHsnCode);
    setCfgError(null);
    setSettingsOpen(true);
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !canEditFactorySettings) return;

    const check = validateFactorySettingsInput({
      factoryName: cfgName,
      factoryAddress: cfgAddress,
      factoryState: cfgState,
      factoryStateCode: cfgStateCode,
      factoryGstin: cfgGstin,
      invoicePrefix: cfgPrefix,
      nextInvoiceSeq: cfgSeq,
      defaultHsnCode: cfgHsn,
    });

    if (!check.valid) {
      setCfgError(check.error);
      return;
    }

    setSavingCfg(true);
    setCfgError(null);

    try {
      const settingsRef = doc(db, 'settings', 'factoryConfig');
      if (factoryConfigDoc) {
        await updateDoc(settingsRef, {
          ...check.sanitized,
          updatedBy: firebaseUser.uid,
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(settingsRef, {
          id: 'factoryConfig',
          orgId: ORG_ID,
          ...check.sanitized,
          updatedBy: firebaseUser.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      setSettingsOpen(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'settings/factoryConfig');
      setCfgError('Failed to save factory GST settings.');
    } finally {
      setSavingCfg(false);
    }
  };

  const openGenerateModal = () => {
    setSelectedOrderId(invoiceableOrders[0]?.id ?? '');
    setInvoiceDate(todayIso());
    setInvoiceNotes('');
    setGenError(null);
    setGenModalOpen(true);
  };

  const selectedOrderForPreview = useMemo(
    () => invoiceableOrders.find((o) => o.id === selectedOrderId) ?? null,
    [invoiceableOrders, selectedOrderId],
  );

  const selectedOrderLines = useMemo(
    () => (selectedOrderForPreview ? orderItems.filter((l) => l.salesOrderId === selectedOrderForPreview.id) : []),
    [orderItems, selectedOrderForPreview],
  );

  const previewTaxBreakdown = useMemo(() => {
    if (!selectedOrderForPreview) return null;
    const isIntra = isIntraStateSupply(
      selectedOrderForPreview.customerState,
      selectedOrderForPreview.customerStateCode,
      activeSettings.factoryState,
      activeSettings.factoryStateCode,
    );
    let subtotal = 0;
    let cgst = 0;
    let sgst = 0;
    let igst = 0;
    const lines = selectedOrderLines.map((line) => {
      const tax = computeLineTaxBreakdown(
        line.quantity,
        line.sellingPrice,
        line.gstPercentage,
        isIntra,
      );
      subtotal += tax.lineSubtotal;
      cgst += tax.cgstAmount;
      sgst += tax.sgstAmount;
      igst += tax.igstAmount;
      return { line, tax };
    });
    const rSub = roundCurrency(subtotal);
    const rCgst = roundCurrency(cgst);
    const rSgst = roundCurrency(sgst);
    const rIgst = roundCurrency(igst);
    const rGst = roundCurrency(rCgst + rSgst + rIgst);
    const rGrand = roundCurrency(rSub + rGst);
    return {
      isIntra,
      taxType: (isIntra ? 'CGST_SGST' : 'IGST') as 'CGST_SGST' | 'IGST',
      subtotal: rSub,
      cgstTotal: rCgst,
      sgstTotal: rSgst,
      igstTotal: rIgst,
      gstTotal: rGst,
      grandTotal: rGrand,
      lines,
    };
  }, [selectedOrderForPreview, selectedOrderLines, activeSettings]);

  const handleGenerateInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !userProfile || !canManageInvoices || !selectedOrderForPreview || !previewTaxBreakdown) {
      return;
    }
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(invoiceDate)) {
      setGenError('Invoice date must be in YYYY-MM-DD format.');
      return;
    }
    if (previewTaxBreakdown.lines.length === 0) {
      setGenError('Selected sales order has no line items.');
      return;
    }

    setGenerating(true);
    setGenError(null);

    try {
      const invoiceId = `inv_${selectedOrderForPreview.id}`;
      await runTransaction(db, async (tx) => {
        const settingsRef = doc(db, 'settings', 'factoryConfig');
        const orderRef = doc(db, 'salesOrders', selectedOrderForPreview.id);
        const invoiceRef = doc(db, 'invoices', invoiceId);

        // ALL READS FIRST
        const [settingsSnap, orderSnap, invSnap] = await Promise.all([
          tx.get(settingsRef),
          tx.get(orderRef),
          tx.get(invoiceRef),
        ]);

        if (!orderSnap.exists()) {
          throw new Error('Sales order could not be found.');
        }
        const freshOrder = orderSnap.data() as SalesOrder;
        if (!['Approved', 'Partially Dispatched', 'Dispatched'].includes(freshOrder.status)) {
          throw new Error(`Order ${freshOrder.orderNumber} is "${freshOrder.status}". Only approved or dispatched orders can be invoiced.`);
        }
        if (freshOrder.invoiceId || invSnap.exists()) {
          throw new Error(`A GST invoice already exists for ${freshOrder.orderNumber}. Duplicate invoices are blocked.`);
        }

        const cfg = settingsSnap.exists()
          ? (settingsSnap.data() as FactorySettings)
          : {
              factoryName: DEFAULT_FACTORY_SETTINGS.factoryName,
              factoryAddress: DEFAULT_FACTORY_SETTINGS.factoryAddress,
              factoryState: DEFAULT_FACTORY_SETTINGS.factoryState,
              factoryStateCode: DEFAULT_FACTORY_SETTINGS.factoryStateCode,
              factoryGstin: DEFAULT_FACTORY_SETTINGS.factoryGstin,
              invoicePrefix: DEFAULT_FACTORY_SETTINGS.invoicePrefix,
              nextInvoiceSeq: DEFAULT_FACTORY_SETTINGS.nextInvoiceSeq,
              defaultHsnCode: DEFAULT_FACTORY_SETTINGS.defaultHsnCode,
            };

        const invoiceNumber = `${cfg.invoicePrefix}${String(cfg.nextInvoiceSeq).padStart(4, '0')}`;
        const cleanNotes = invoiceNotes.trim().slice(0, 500);

        // ALL WRITES AFTER READS
        if (settingsSnap.exists()) {
          tx.update(settingsRef, {
            nextInvoiceSeq: cfg.nextInvoiceSeq + 1,
            updatedBy: firebaseUser.uid,
            updatedAt: serverTimestamp(),
          });
        } else {
          tx.set(settingsRef, {
            id: 'factoryConfig',
            orgId: ORG_ID,
            factoryName: cfg.factoryName,
            factoryAddress: cfg.factoryAddress,
            factoryState: cfg.factoryState,
            factoryStateCode: cfg.factoryStateCode,
            factoryGstin: cfg.factoryGstin,
            invoicePrefix: cfg.invoicePrefix,
            nextInvoiceSeq: cfg.nextInvoiceSeq + 1,
            defaultHsnCode: cfg.defaultHsnCode,
            updatedBy: firebaseUser.uid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }

        tx.set(invoiceRef, {
          id: invoiceId,
          orgId: ORG_ID,
          invoiceNumber,
          salesOrderId: freshOrder.id,
          orderNumber: freshOrder.orderNumber,
          salesmanUid: freshOrder.salesmanUid,
          salesmanName: freshOrder.salesmanName,
          invoiceDate,
          factoryName: cfg.factoryName,
          factoryAddress: cfg.factoryAddress,
          factoryState: cfg.factoryState,
          factoryStateCode: cfg.factoryStateCode,
          factoryGstin: cfg.factoryGstin,
          customerId: freshOrder.customerId,
          customerName: freshOrder.customerName,
          customerGstin: freshOrder.customerGstin,
          customerAddress: freshOrder.customerAddress,
          customerState: freshOrder.customerState,
          customerStateCode: freshOrder.customerStateCode,
          taxType: previewTaxBreakdown.taxType,
          itemCount: previewTaxBreakdown.lines.length,
          subtotal: previewTaxBreakdown.subtotal,
          cgstTotal: previewTaxBreakdown.cgstTotal,
          sgstTotal: previewTaxBreakdown.sgstTotal,
          igstTotal: previewTaxBreakdown.igstTotal,
          gstTotal: previewTaxBreakdown.gstTotal,
          grandTotal: previewTaxBreakdown.grandTotal,
          amountPaid: 0,
          outstandingBalance: previewTaxBreakdown.grandTotal,
          paymentStatus: 'Unpaid',
          notes: cleanNotes,
          createdBy: firebaseUser.uid,
          createdByName: userProfile.displayName,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        previewTaxBreakdown.lines.forEach(({ line, tax }) => {
          const itemRef = doc(collection(db, 'invoiceItems'));
          tx.set(itemRef, {
            id: itemRef.id,
            orgId: ORG_ID,
            invoiceId,
            salesOrderId: freshOrder.id,
            salesmanUid: freshOrder.salesmanUid,
            productId: line.productId,
            productName: line.productName,
            productSku: line.productSku,
            packetSize: line.packetSize,
            hsnCode: line.hsnCode || cfg.defaultHsnCode,
            quantity: line.quantity,
            rate: line.sellingPrice,
            taxableValue: tax.lineSubtotal,
            gstPercentage: line.gstPercentage,
            cgstAmount: tax.cgstAmount,
            sgstAmount: tax.sgstAmount,
            igstAmount: tax.igstAmount,
            lineGst: tax.lineGst,
            lineTotal: tax.lineTotal,
            createdBy: firebaseUser.uid,
            createdAt: serverTimestamp(),
          });
        });

        tx.update(orderRef, {
          invoiceId,
          invoiceNumber,
          updatedAt: serverTimestamp(),
        });
      });

      setGenModalOpen(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to generate GST invoice.';
      if (msg.toLowerCase().includes('permission')) {
        handleFirestoreError(err, OperationType.CREATE, `invoices/inv_${selectedOrderForPreview.id}`);
      }
      setGenError(msg);
    } finally {
      setGenerating(false);
    }
  };

  const viewingLines = viewingInvoice ? itemsByInvoiceId.get(viewingInvoice.id) ?? [] : [];

  return (
    <div className="space-y-6">
      <div className={viewingInvoice ? 'no-print space-y-6' : 'space-y-6'}>
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-[#3B4F4E]">Sales &amp; Fulfillment</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#3B4F4E]">
              GST Invoices
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Generate tax-compliant CGST+SGST / IGST invoices with configurable factory GSTIN, PDF download, and print support.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            {canEditFactorySettings && (
              <button
                type="button"
                onClick={openSettingsModal}
                className="min-h-[40px] inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-[#DCE6E6] rounded-lg transition-colors whitespace-nowrap"
              >
                <Settings className="w-4 h-4 text-slate-500" />
                Factory GST Settings
              </button>
            )}

            {canManageInvoices && (
              <button
                type="button"
                onClick={openGenerateModal}
                disabled={invoiceableOrders.length === 0}
                className="min-h-[40px] inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#CF9C2D] hover:bg-[#BC8B22] disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap"
              >
                <Plus className="w-4 h-4 shrink-0" />
                Generate GST Invoice
              </button>
            )}
          </div>
        </div>

        {/* Factory GST Banner */}
        <div className="bg-white border border-[#DCE6E6] rounded-xl px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-slate-600">
            <span className="font-semibold text-[#3B4F4E]">{activeSettings.factoryName}</span>
            <span>
              Origin: <strong className="text-slate-800">{activeSettings.factoryState} ({activeSettings.factoryStateCode})</strong>
            </span>
            <span>
              GSTIN:{' '}
              <span className="font-mono text-slate-800">
                {activeSettings.factoryGstin || 'Not Configured'}
              </span>
            </span>
            <span>
              Next Invoice:{' '}
              <span className="font-mono font-semibold text-[#3B4F4E]">
                {activeSettings.invoicePrefix}
                {String(activeSettings.nextInvoiceSeq).padStart(4, '0')}
              </span>
            </span>
          </div>
          {!factoryConfigDoc && canEditFactorySettings && (
            <button
              type="button"
              onClick={openSettingsModal}
              className="text-[#3B4F4E] hover:text-[#3B4F4E] font-medium whitespace-nowrap self-start sm:self-auto"
            >
              Configure Factory GSTIN →
            </button>
          )}
        </div>

        {/* KPI Strip */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white border border-[#DCE6E6] rounded-xl p-4">
            <p className="text-xs font-medium text-slate-500">Issued Invoices</p>
            <p className="mt-2 text-2xl font-semibold font-mono tabular-nums text-[#3B4F4E]">
              {totals.count}
            </p>
          </div>
          <div className="bg-white border border-[#DCE6E6] rounded-xl p-4">
            <p className="text-xs font-medium text-slate-500">Total Billed (Incl. GST)</p>
            <p className="mt-2 text-2xl font-semibold font-mono tabular-nums text-[#3B4F4E]">
              ₹{totals.totalBilled.toFixed(2)}
            </p>
          </div>
          <div className="bg-white border border-[#DCE6E6] rounded-xl p-4">
            <p className="text-xs font-medium text-slate-500">Total Collected</p>
            <p className="mt-2 text-2xl font-semibold font-mono tabular-nums text-emerald-700">
              ₹{totals.totalCollected.toFixed(2)}
            </p>
          </div>
          <div className="bg-white border border-[#DCE6E6] rounded-xl p-4">
            <p className="text-xs font-medium text-slate-500">Outstanding Balance</p>
            <p className="mt-2 text-2xl font-semibold font-mono tabular-nums text-red-700">
              ₹{totals.totalOutstanding.toFixed(2)}
            </p>
          </div>
        </div>

        {loadError && (
          <div role="alert" className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3 text-sm text-red-800">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            <span>{loadError}</span>
          </div>
        )}

        {/* Invoice History Table */}
        <div className="bg-white border border-[#DCE6E6] rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-[#DCE6E6] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search invoice no., order no., customer, or GSTIN..."
                aria-label="Search GST invoices"
                className="w-full h-9 pl-9 pr-3 text-sm text-[#3B4F4E] bg-slate-50 border border-[#DCE6E6] rounded-lg focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#CF9C2D]"
              />
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {(['All', ...PAYMENT_STATUSES] as const).map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setStatusFilter(status)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md border transition-colors ${
                    statusFilter === status
                      ? 'bg-[#CF9C2D] text-white border-[#3B4F4E]'
                      : 'bg-slate-50 text-slate-600 border-[#DCE6E6] hover:bg-slate-100'
                  }`}
                >
                  {status}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#DCE6E6] bg-slate-50/70">
                  <th className="px-5 py-3 text-xs font-semibold text-slate-600">Invoice No.</th>
                  <th className="px-5 py-3 text-xs font-semibold text-slate-600">Customer</th>
                  <th className="px-5 py-3 text-xs font-semibold text-slate-600">Tax Breakdown</th>
                  <th className="px-5 py-3 text-xs font-semibold text-slate-600 text-right">Grand Total</th>
                  <th className="px-5 py-3 text-xs font-semibold text-slate-600 text-right">Paid / Due</th>
                  <th className="px-5 py-3 text-xs font-semibold text-slate-600">Status</th>
                  <th className="px-5 py-3 text-xs font-semibold text-slate-600 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-12 text-center text-sm text-slate-500">
                      Loading GST invoices...
                    </td>
                  </tr>
                ) : filteredInvoices.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-14 text-center">
                      <div className="max-w-md mx-auto flex flex-col items-center">
                        <div className="w-11 h-11 rounded-xl bg-slate-100 border border-[#DCE6E6] flex items-center justify-center text-slate-500 mb-3">
                          <FileText className="w-5 h-5" />
                        </div>
                        <h2 className="text-base font-semibold text-[#3B4F4E]">
                          {invoices.length === 0 ? 'No GST invoices issued yet' : 'No matching invoices'}
                        </h2>
                        <p className="mt-1 text-sm text-slate-600">
                          {invoices.length === 0
                            ? 'Approve a sales order first, then generate a GST Tax Invoice.'
                            : 'Try adjusting your search or payment status filter.'}
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredInvoices.map((inv) => (
                    <tr key={inv.id} className="hover:bg-slate-50/70">
                      <td className="px-5 py-3.5 whitespace-nowrap">
                        <p className="font-mono text-xs font-semibold text-[#3B4F4E]">
                          {inv.invoiceNumber}
                        </p>
                        <p className="text-[11px] font-mono text-slate-500">
                          {inv.invoiceDate} · {inv.orderNumber}
                        </p>
                      </td>
                      <td className="px-5 py-3.5">
                        <p className="text-sm font-medium text-[#3B4F4E]">{inv.customerName}</p>
                        <p className="text-xs text-slate-500">
                          {inv.customerState} ({inv.customerStateCode}) ·{' '}
                          <span className="font-mono">{inv.customerGstin || 'Unregistered'}</span>
                        </p>
                      </td>
                      <td className="px-5 py-3.5 text-xs font-mono text-slate-700 whitespace-nowrap">
                        {inv.taxType === 'CGST_SGST' ? (
                          <span>
                            CGST ₹{inv.cgstTotal.toFixed(2)} + SGST ₹{inv.sgstTotal.toFixed(2)}
                          </span>
                        ) : (
                          <span>IGST ₹{inv.igstTotal.toFixed(2)}</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 font-mono text-sm font-semibold text-[#3B4F4E] text-right tabular-nums whitespace-nowrap">
                        ₹{inv.grandTotal.toFixed(2)}
                      </td>
                      <td className="px-5 py-3.5 font-mono text-xs text-right tabular-nums whitespace-nowrap">
                        <p className="text-emerald-700">Paid ₹{inv.amountPaid.toFixed(2)}</p>
                        <p className="text-red-700 font-medium">Due ₹{inv.outstandingBalance.toFixed(2)}</p>
                      </td>
                      <td className="px-5 py-3.5 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 text-xs font-medium rounded-md border ${paymentStatusBadge(
                            inv.paymentStatus,
                          )}`}
                        >
                          {inv.paymentStatus}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setViewingInvoice(inv)}
                            className="min-h-[32px] inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-[#3B4F4E] bg-[#EEF3F3] hover:bg-[#E5EDED] rounded-md"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            View / Print
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              downloadGstInvoicePdf(inv, itemsByInvoiceId.get(inv.id) ?? [])
                            }
                            className="min-h-[32px] inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-[#DCE6E6] rounded-md"
                          >
                            <Download className="w-3.5 h-3.5" />
                            PDF
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Generate Invoice Modal */}
      {genModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/50 overflow-y-auto no-print"
        >
          <div className="w-full max-w-2xl bg-white border border-[#DCE6E6] rounded-xl overflow-hidden my-8">
            <div className="px-6 py-4 border-b border-[#DCE6E6] flex items-center justify-between">
              <h2 className="text-base font-semibold text-[#3B4F4E]">Generate GST Tax Invoice</h2>
              <button
                type="button"
                onClick={() => setGenModalOpen(false)}
                aria-label="Close modal"
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleGenerateInvoice} className="p-6 space-y-4">
              {genError && (
                <div role="alert" className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{genError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="inv-so" className="block text-xs font-medium text-slate-700 mb-1">
                    Approved / Dispatched Sales Order *
                  </label>
                  <select
                    id="inv-so"
                    value={selectedOrderId}
                    onChange={(e) => setSelectedOrderId(e.target.value)}
                    className="w-full h-9 px-3 text-sm border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                  >
                    {invoiceableOrders.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.orderNumber} · {o.customerName} (₹{o.grandTotal.toFixed(2)})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="inv-date" className="block text-xs font-medium text-slate-700 mb-1">
                    Invoice Date *
                  </label>
                  <input
                    id="inv-date"
                    type="date"
                    value={invoiceDate}
                    onChange={(e) => setInvoiceDate(e.target.value)}
                    className="w-full h-9 px-3 font-mono text-sm border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                  />
                </div>
              </div>

              {selectedOrderForPreview && previewTaxBreakdown && (
                <div className="bg-slate-50 border border-[#DCE6E6] rounded-lg p-4 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-[#3B4F4E]">
                      Customer: {selectedOrderForPreview.customerName}
                    </span>
                    <span className="font-mono text-[#3B4F4E] font-semibold">
                      {previewTaxBreakdown.isIntra
                        ? 'Tamil Nadu Intra-State (CGST + SGST)'
                        : 'Inter-State Supply (IGST)'}
                    </span>
                  </div>
                  <p className="text-slate-600">
                    Customer GSTIN: {selectedOrderForPreview.customerGstin || 'Unregistered'} ·{' '}
                    State: {selectedOrderForPreview.customerState} ({selectedOrderForPreview.customerStateCode})
                  </p>
                  <div className="pt-2 border-t border-[#DCE6E6] grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono">
                    <div>
                      <p className="text-slate-500">Taxable</p>
                      <p className="font-semibold text-[#3B4F4E]">
                        ₹{previewTaxBreakdown.subtotal.toFixed(2)}
                      </p>
                    </div>
                    {previewTaxBreakdown.isIntra ? (
                      <>
                        <div>
                          <p className="text-slate-500">CGST</p>
                          <p className="font-semibold text-[#3B4F4E]">
                            ₹{previewTaxBreakdown.cgstTotal.toFixed(2)}
                          </p>
                        </div>
                        <div>
                          <p className="text-slate-500">SGST</p>
                          <p className="font-semibold text-[#3B4F4E]">
                            ₹{previewTaxBreakdown.sgstTotal.toFixed(2)}
                          </p>
                        </div>
                      </>
                    ) : (
                      <div>
                        <p className="text-slate-500">IGST</p>
                        <p className="font-semibold text-[#3B4F4E]">
                          ₹{previewTaxBreakdown.igstTotal.toFixed(2)}
                        </p>
                      </div>
                    )}
                    <div>
                      <p className="text-slate-500">Grand Total</p>
                      <p className="font-semibold text-[#3B4F4E]">
                        ₹{previewTaxBreakdown.grandTotal.toFixed(2)}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <div>
                <label htmlFor="inv-notes" className="block text-xs font-medium text-slate-700 mb-1">
                  Invoice Terms / Notes
                </label>
                <input
                  id="inv-notes"
                  type="text"
                  maxLength={500}
                  value={invoiceNotes}
                  onChange={(e) => setInvoiceNotes(e.target.value)}
                  placeholder="Optional payment terms or declarations..."
                  className="w-full h-9 px-3 text-sm border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                />
              </div>

              <div className="pt-3 border-t border-[#DCE6E6] flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setGenModalOpen(false)}
                  className="min-h-[38px] px-4 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-[#DCE6E6] rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={generating || !selectedOrderForPreview}
                  className="min-h-[38px] inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-[#CF9C2D] hover:bg-[#BC8B22] disabled:opacity-60 rounded-lg"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {generating ? 'Issuing Invoice...' : 'Issue GST Invoice'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Factory GST Settings Modal */}
      {settingsOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/50 overflow-y-auto no-print"
        >
          <div className="w-full max-w-xl bg-white border border-[#DCE6E6] rounded-xl overflow-hidden my-8">
            <div className="px-6 py-4 border-b border-[#DCE6E6] flex items-center justify-between">
              <h2 className="text-base font-semibold text-[#3B4F4E]">Factory GST Configuration</h2>
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                aria-label="Close settings modal"
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveSettings} className="p-6 space-y-4">
              {cfgError && (
                <div role="alert" className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                  {cfgError}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Factory Legal Name *
                </label>
                <input
                  type="text"
                  value={cfgName}
                  onChange={(e) => setCfgName(e.target.value)}
                  className="w-full h-9 px-3 text-sm border border-[#DCE6E6] rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Factory Address *
                </label>
                <input
                  type="text"
                  value={cfgAddress}
                  onChange={(e) => setCfgAddress(e.target.value)}
                  className="w-full h-9 px-3 text-sm border border-[#DCE6E6] rounded-lg"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Factory State *
                  </label>
                  <input
                    type="text"
                    value={cfgState}
                    onChange={(e) => setCfgState(e.target.value)}
                    className="w-full h-9 px-3 text-sm border border-[#DCE6E6] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    State Code *
                  </label>
                  <input
                    type="text"
                    value={cfgStateCode}
                    onChange={(e) => setCfgStateCode(e.target.value)}
                    className="w-full h-9 px-3 font-mono text-sm border border-[#DCE6E6] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Default HSN *
                  </label>
                  <input
                    type="text"
                    value={cfgHsn}
                    onChange={(e) => setCfgHsn(e.target.value.toUpperCase())}
                    className="w-full h-9 px-3 font-mono text-sm border border-[#DCE6E6] rounded-lg"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-1">
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Factory GSTIN
                  </label>
                  <input
                    type="text"
                    maxLength={15}
                    placeholder="33AABCS1429B1Z5"
                    value={cfgGstin}
                    onChange={(e) => setCfgGstin(e.target.value.toUpperCase())}
                    className="w-full h-9 px-3 font-mono text-sm border border-[#DCE6E6] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Invoice Prefix *
                  </label>
                  <input
                    type="text"
                    value={cfgPrefix}
                    onChange={(e) => setCfgPrefix(e.target.value.toUpperCase())}
                    className="w-full h-9 px-3 font-mono text-sm border border-[#DCE6E6] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Next Sequence *
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={cfgSeq}
                    onChange={(e) => setCfgSeq(e.target.value)}
                    className="w-full h-9 px-3 font-mono text-sm border border-[#DCE6E6] rounded-lg"
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-[#DCE6E6] flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setSettingsOpen(false)}
                  className="min-h-[38px] px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-[#DCE6E6] rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingCfg}
                  className="min-h-[38px] px-4 py-2 text-xs font-medium text-white bg-[#CF9C2D] hover:bg-[#BC8B22] rounded-lg"
                >
                  {savingCfg ? 'Saving...' : 'Save Factory GST Settings'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Printable GST Tax Invoice Modal */}
      {viewingInvoice && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/50 overflow-y-auto print:static print:bg-white print:p-0"
        >
          <div className="w-full max-w-4xl bg-white border border-[#DCE6E6] rounded-xl overflow-hidden my-8 print-only-sheet">
            <div className="px-6 py-4 border-b border-[#DCE6E6] flex items-center justify-between no-print">
              <h2 className="text-base font-semibold text-[#3B4F4E]">
                Tax Invoice {viewingInvoice.invoiceNumber}
              </h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => downloadGstInvoicePdf(viewingInvoice, viewingLines)}
                  className="min-h-[34px] inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#CF9C2D] hover:bg-[#BC8B22] rounded-md"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download PDF
                </button>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="min-h-[34px] inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-[#DCE6E6] rounded-md"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Print Invoice
                </button>
                <button
                  type="button"
                  onClick={() => setViewingInvoice(null)}
                  aria-label="Close invoice"
                  className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="p-6 space-y-5 max-h-[82vh] overflow-y-auto print:max-h-none print:overflow-visible">
              {/* Banner */}
              <div className="bg-[#0B162C] text-white rounded-lg p-5 flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-lg font-semibold">{viewingInvoice.factoryName}</h3>
                  <p className="text-xs text-slate-300 mt-1">
                    TAX INVOICE ·{' '}
                    {viewingInvoice.taxType === 'CGST_SGST'
                      ? 'INTRA-STATE (CGST + SGST)'
                      : 'INTER-STATE (IGST)'}
                  </p>
                </div>
                <div className="text-right font-mono">
                  <p className="text-sm font-semibold">{viewingInvoice.invoiceNumber}</p>
                  <p className="text-xs text-slate-300 mt-1">Date: {viewingInvoice.invoiceDate}</p>
                  <p className="text-xs text-slate-300">Order Ref: {viewingInvoice.orderNumber}</p>
                </div>
              </div>

              {/* Supplier & Customer */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div className="border border-[#DCE6E6] rounded-lg p-4">
                  <p className="font-semibold uppercase text-slate-500">Supplier (Factory)</p>
                  <p className="text-sm font-semibold text-[#3B4F4E] mt-1">
                    {viewingInvoice.factoryName}
                  </p>
                  <p className="text-slate-600 mt-1">{viewingInvoice.factoryAddress}</p>
                  <p className="text-slate-600 mt-1">
                    State: {viewingInvoice.factoryState} ({viewingInvoice.factoryStateCode}) · GSTIN:{' '}
                    <span className="font-mono">
                      {viewingInvoice.factoryGstin || 'Unregistered'}
                    </span>
                  </p>
                </div>

                <div className="border border-[#DCE6E6] rounded-lg p-4">
                  <p className="font-semibold uppercase text-slate-500">Bill To (Customer)</p>
                  <p className="text-sm font-semibold text-[#3B4F4E] mt-1">
                    {viewingInvoice.customerName}
                  </p>
                  <p className="text-slate-600 mt-1">{viewingInvoice.customerAddress}</p>
                  <p className="text-slate-600 mt-1">
                    State: {viewingInvoice.customerState} ({viewingInvoice.customerStateCode}) · GSTIN:{' '}
                    <span className="font-mono">
                      {viewingInvoice.customerGstin || 'Unregistered'}
                    </span>
                  </p>
                </div>
              </div>

              {/* Line Items */}
              <div className="border border-[#DCE6E6] rounded-lg overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-[#DCE6E6] text-[11px] font-semibold text-slate-600">
                      <th className="px-3 py-2">Product Description</th>
                      <th className="px-3 py-2">HSN</th>
                      <th className="px-3 py-2 text-right">Qty</th>
                      <th className="px-3 py-2 text-right">Rate</th>
                      <th className="px-3 py-2 text-right">Taxable</th>
                      {viewingInvoice.taxType === 'CGST_SGST' ? (
                        <>
                          <th className="px-3 py-2 text-right">CGST</th>
                          <th className="px-3 py-2 text-right">SGST</th>
                        </>
                      ) : (
                        <th className="px-3 py-2 text-right">IGST</th>
                      )}
                      <th className="px-3 py-2 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-xs">
                    {viewingLines.map((line) => (
                      <tr key={line.id}>
                        <td className="px-3 py-2.5">
                          <p className="font-medium text-[#3B4F4E]">{line.productName}</p>
                          <p className="text-[11px] text-slate-500">
                            {line.productSku} · {line.packetSize} ({line.gstPercentage}% GST)
                          </p>
                        </td>
                        <td className="px-3 py-2.5 font-mono text-slate-600">{line.hsnCode}</td>
                        <td className="px-3 py-2.5 text-right font-mono">{line.quantity}</td>
                        <td className="px-3 py-2.5 text-right font-mono">₹{line.rate.toFixed(2)}</td>
                        <td className="px-3 py-2.5 text-right font-mono">
                          ₹{line.taxableValue.toFixed(2)}
                        </td>
                        {viewingInvoice.taxType === 'CGST_SGST' ? (
                          <>
                            <td className="px-3 py-2.5 text-right font-mono">
                              ₹{line.cgstAmount.toFixed(2)}
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono">
                              ₹{line.sgstAmount.toFixed(2)}
                            </td>
                          </>
                        ) : (
                          <td className="px-3 py-2.5 text-right font-mono">
                            ₹{line.igstAmount.toFixed(2)}
                          </td>
                        )}
                        <td className="px-3 py-2.5 text-right font-mono font-semibold text-[#3B4F4E]">
                          ₹{line.lineTotal.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Summary Footer */}
              <div className="flex flex-col sm:flex-row justify-between gap-4 items-start">
                <div className="text-xs text-slate-600 space-y-1">
                  <p>Salesman: {viewingInvoice.salesmanName}</p>
                  <p>Issued By: {viewingInvoice.createdByName}</p>
                  {viewingInvoice.notes && <p>Notes: {viewingInvoice.notes}</p>}
                </div>

                <div className="w-full sm:w-72 border border-[#DCE6E6] rounded-lg p-4 space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Taxable Value</span>
                    <span className="font-mono">₹{viewingInvoice.subtotal.toFixed(2)}</span>
                  </div>
                  {viewingInvoice.taxType === 'CGST_SGST' ? (
                    <>
                      <div className="flex justify-between">
                        <span className="text-slate-500">CGST</span>
                        <span className="font-mono">₹{viewingInvoice.cgstTotal.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">SGST</span>
                        <span className="font-mono">₹{viewingInvoice.sgstTotal.toFixed(2)}</span>
                      </div>
                    </>
                  ) : (
                    <div className="flex justify-between">
                      <span className="text-slate-500">IGST</span>
                      <span className="font-mono">₹{viewingInvoice.igstTotal.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="pt-2 border-t border-[#DCE6E6] flex justify-between text-sm font-semibold text-[#3B4F4E]">
                    <span>Grand Total</span>
                    <span className="font-mono">₹{viewingInvoice.grandTotal.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-emerald-700">
                    <span>Amount Paid</span>
                    <span className="font-mono">₹{viewingInvoice.amountPaid.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between font-semibold text-red-700">
                    <span>Outstanding Balance</span>
                    <span className="font-mono">₹{viewingInvoice.outstandingBalance.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
