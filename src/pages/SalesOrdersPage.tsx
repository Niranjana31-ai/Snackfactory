import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ClipboardCheck,
  Edit3,
  Eye,
  FileSpreadsheet,
  Plus,
  Search,
  Send,
  ShieldAlert,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../lib/firebase';
import { handleFirestoreError, OperationType } from '../lib/firestoreError';
import {
  BLUEPRINT_CONSTRAINTS,
  computeLineTaxBreakdown,
  DEFAULT_FACTORY_SETTINGS,
  isIntraStateSupply,
  roundCurrency,
  validateSalesOrderApproval,
  validateSalesOrderInput,
  type SalesOrderLineDraft,
} from '../lib/validation';
import {
  GST_RATES,
  ORG_ID,
  SALES_ORDER_STATUSES,
  type Customer,
  type ErpUser,
  type FactorySettings,
  type Product,
  type SalesOrder,
  type SalesOrderItem,
  type SalesOrderStatus,
} from '../types/erp';

type StatusFilter = 'All' | SalesOrderStatus;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function plusDaysIso(days: number): string {
  const dt = new Date();
  dt.setDate(dt.getDate() + days);
  return dt.toISOString().slice(0, 10);
}

function nextOrderNumber(orders: SalesOrder[]): string {
  const year = new Date().getFullYear();
  const prefix = `SO-${year}-`;
  let maxSeq = 0;
  orders.forEach((o) => {
    if (o.orderNumber.startsWith(prefix)) {
      const n = Number(o.orderNumber.slice(prefix.length));
      if (Number.isInteger(n) && n > maxSeq) maxSeq = n;
    }
  });
  return `${prefix}${String(maxSeq + 1).padStart(4, '0')}`;
}

function statusBadgeStyle(status: SalesOrderStatus): string {
  switch (status) {
    case 'Draft':
      return 'bg-slate-100 text-slate-700 border-[#DCE6E6]';
    case 'Pending Approval':
      return 'bg-amber-50 text-amber-800 border-amber-200';
    case 'Approved':
      return 'bg-[#EEF3F3] text-[#3B4F4E] border-[#DCE6E6]';
    case 'Rejected':
      return 'bg-red-50 text-red-700 border-red-200';
    case 'Partially Dispatched':
      return 'bg-indigo-50 text-indigo-700 border-indigo-200';
    case 'Dispatched':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'Cancelled':
      return 'bg-slate-100 text-slate-500 border-[#DCE6E6]';
  }
}

export function SalesOrdersPage() {
  const { firebaseUser, userProfile, effectiveRole } = useAuth();
  const activeRole = effectiveRole ?? userProfile?.role ?? 'Salesman';
  const realRole = userProfile?.role ?? 'Salesman';
  const isSalesmanOnly = realRole === 'Salesman';

  const canCreateEdit =
    activeRole === 'Owner' || activeRole === 'Admin' || activeRole === 'Salesman';
  const canApproveReject =
    (realRole === 'Owner' || realRole === 'Admin') &&
    (activeRole === 'Owner' || activeRole === 'Admin');

  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [orderItems, setOrderItems] = useState<SalesOrderItem[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [employees, setEmployees] = useState<ErpUser[]>([]);
  const [factorySettings, setFactorySettings] = useState<
    Pick<FactorySettings, 'factoryState' | 'factoryStateCode' | 'defaultHsnCode'>
  >({
    factoryState: DEFAULT_FACTORY_SETTINGS.factoryState,
    factoryStateCode: DEFAULT_FACTORY_SETTINGS.factoryStateCode,
    defaultHsnCode: DEFAULT_FACTORY_SETTINGS.defaultHsnCode,
  });

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All');

  const [modalOpen, setModalOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<SalesOrder | null>(null);
  const [formOrderNumber, setFormOrderNumber] = useState('');
  const [formCustomerId, setFormCustomerId] = useState('');
  const [formOrderDate, setFormOrderDate] = useState(todayIso());
  const [formDeliveryDate, setFormDeliveryDate] = useState(plusDaysIso(3));
  const [formSalesmanUid, setFormSalesmanUid] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formItems, setFormItems] = useState<SalesOrderLineDraft[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [viewingOrder, setViewingOrder] = useState<SalesOrder | null>(null);
  const [approvalRemarks, setApprovalRemarks] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [processingAction, setProcessingAction] = useState(false);

  const [deletingOrder, setDeletingOrder] = useState<SalesOrder | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!firebaseUser) return;
    setLoading(true);
    setLoadError(null);

    const ordersQuery = isSalesmanOnly
      ? query(collection(db, 'salesOrders'), where('salesmanUid', '==', firebaseUser.uid))
      : query(collection(db, 'salesOrders'), where('orgId', '==', ORG_ID));

    const itemsQuery = isSalesmanOnly
      ? query(collection(db, 'salesOrderItems'), where('salesmanUid', '==', firebaseUser.uid))
      : query(collection(db, 'salesOrderItems'), where('orgId', '==', ORG_ID));

    const unsubOrders = onSnapshot(
      ordersQuery,
      (snap) => {
        const rows = snap.docs.map((d) => d.data() as SalesOrder);
        rows.sort((a, b) => b.orderDate.localeCompare(a.orderDate) || b.orderNumber.localeCompare(a.orderNumber));
        setOrders(rows);
        setLoading(false);
      },
      (err) => {
        setLoading(false);
        setLoadError('Unable to load sales orders from Cloud Firestore.');
        handleFirestoreError(err, OperationType.LIST, 'salesOrders');
      },
    );

    const unsubItems = onSnapshot(
      itemsQuery,
      (snap) => {
        setOrderItems(snap.docs.map((d) => d.data() as SalesOrderItem));
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, 'salesOrderItems');
      },
    );

    const unsubCustomers = onSnapshot(
      query(collection(db, 'customers'), where('orgId', '==', ORG_ID)),
      (snap) => {
        const rows = snap.docs.map((d) => d.data() as Customer);
        rows.sort((a, b) => a.name.localeCompare(b.name));
        setCustomers(rows);
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, 'customers');
      },
    );

    const unsubProducts = onSnapshot(
      query(collection(db, 'products'), where('orgId', '==', ORG_ID)),
      (snap) => {
        const rows = snap.docs.map((d) => d.data() as Product);
        rows.sort((a, b) => a.name.localeCompare(b.name));
        setProducts(rows);
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, 'products');
      },
    );

    const unsubSettings = onSnapshot(
      doc(db, 'settings', 'factoryConfig'),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as FactorySettings;
          setFactorySettings({
            factoryState: data.factoryState,
            factoryStateCode: data.factoryStateCode,
            defaultHsnCode: data.defaultHsnCode,
          });
        }
      },
      (err) => {
        handleFirestoreError(err, OperationType.GET, 'settings/factoryConfig');
      },
    );

    let unsubEmployees = () => {};
    if (realRole === 'Owner' || realRole === 'Admin') {
      unsubEmployees = onSnapshot(
        collection(db, 'users'),
        (snap) => {
          const rows = snap.docs
            .map((d) => d.data() as ErpUser)
            .filter((u) => u.status === 'Active' && ['Salesman', 'Owner', 'Admin'].includes(u.role));
          rows.sort((a, b) => a.displayName.localeCompare(b.displayName));
          setEmployees(rows);
        },
        (err) => {
          handleFirestoreError(err, OperationType.LIST, 'users');
        },
      );
    }

    return () => {
      unsubOrders();
      unsubItems();
      unsubCustomers();
      unsubProducts();
      unsubSettings();
      unsubEmployees();
    };
  }, [firebaseUser, isSalesmanOnly, realRole]);

  const itemsByOrderId = useMemo(() => {
    const map = new Map<string, SalesOrderItem[]>();
    orderItems.forEach((item) => {
      const list = map.get(item.salesOrderId) ?? [];
      list.push(item);
      map.set(item.salesOrderId, list);
    });
    return map;
  }, [orderItems]);

  const filteredOrders = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return orders.filter((order) => {
      const matchesStatus = statusFilter === 'All' || order.status === statusFilter;
      const matchesSearch =
        !term ||
        order.orderNumber.toLowerCase().includes(term) ||
        order.customerName.toLowerCase().includes(term) ||
        order.salesmanName.toLowerCase().includes(term) ||
        order.invoiceNumber.toLowerCase().includes(term);
      return matchesStatus && matchesSearch;
    });
  }, [orders, searchTerm, statusFilter]);

  const kpis = useMemo(() => {
    const pendingApproval = orders.filter((o) => o.status === 'Pending Approval').length;
    const readyToShip = orders.filter(
      (o) => o.status === 'Approved' || o.status === 'Partially Dispatched',
    ).length;
    const totalOrderValue = roundCurrency(
      orders
        .filter((o) => o.status !== 'Cancelled' && o.status !== 'Rejected')
        .reduce((sum, o) => sum + o.grandTotal, 0),
    );
    return {
      total: orders.length,
      pendingApproval,
      readyToShip,
      totalOrderValue,
    };
  }, [orders]);

  const activeProducts = useMemo(
    () => products.filter((p) => p.status === 'Active'),
    [products],
  );

  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === formCustomerId) ?? null,
    [customers, formCustomerId],
  );

  const liveFormSummary = useMemo(() => {
    const productMap = new Map(products.map((p) => [p.id, p]));
    const isIntra = selectedCustomer
      ? isIntraStateSupply(
          selectedCustomer.state,
          selectedCustomer.stateCode,
          factorySettings.factoryState,
          factorySettings.factoryStateCode,
        )
      : true;

    let subtotal = 0;
    let cgst = 0;
    let sgst = 0;
    let igst = 0;
    let grandTotal = 0;

    formItems.forEach((row) => {
      const p = productMap.get(row.productId);
      const q = Number(row.quantity);
      const r = Number(row.sellingPrice);
      const g = Number(row.gstPercentage);
      if (!p || !Number.isFinite(q) || q <= 0 || !Number.isFinite(r) || r < 0 || !Number.isFinite(g)) {
        return;
      }
      const tax = computeLineTaxBreakdown(q, r, g, isIntra);
      subtotal += tax.lineSubtotal;
      cgst += tax.cgstAmount;
      sgst += tax.sgstAmount;
      igst += tax.igstAmount;
      grandTotal += tax.lineTotal;
    });

    return {
      isIntra,
      subtotal: roundCurrency(subtotal),
      cgst: roundCurrency(cgst),
      sgst: roundCurrency(sgst),
      igst: roundCurrency(igst),
      grandTotal: roundCurrency(grandTotal),
    };
  }, [formItems, products, selectedCustomer, factorySettings]);

  const makeBlankLine = (): SalesOrderLineDraft => {
    const first = activeProducts[0] ?? products[0];
    if (!first) {
      return {
        productId: '',
        quantity: '10',
        sellingPrice: '0',
        gstPercentage: '5',
        hsnCode: factorySettings.defaultHsnCode,
      };
    }
    return {
      productId: first.id,
      quantity: '10',
      sellingPrice: String(first.sellingPrice),
      gstPercentage: String(first.gstPercentage),
      hsnCode: first.hsnCode || factorySettings.defaultHsnCode,
    };
  };

  const openCreateModal = () => {
    setEditingOrder(null);
    setFormOrderNumber(nextOrderNumber(orders));
    setFormCustomerId(customers[0]?.id ?? '');
    setFormOrderDate(todayIso());
    setFormDeliveryDate(plusDaysIso(3));
    setFormSalesmanUid(firebaseUser?.uid ?? '');
    setFormNotes('');
    setFormItems([makeBlankLine()]);
    setFormError(null);
    setModalOpen(true);
  };

  const openEditModal = (order: SalesOrder) => {
    const existingLines = itemsByOrderId.get(order.id) ?? [];
    setEditingOrder(order);
    setFormOrderNumber(order.orderNumber);
    setFormCustomerId(order.customerId);
    setFormOrderDate(order.orderDate);
    setFormDeliveryDate(order.expectedDeliveryDate);
    setFormSalesmanUid(order.salesmanUid);
    setFormNotes(order.notes);
    setFormItems(
      existingLines.length > 0
        ? existingLines.map((line) => ({
            productId: line.productId,
            quantity: String(line.quantity),
            sellingPrice: String(line.sellingPrice),
            gstPercentage: String(line.gstPercentage),
            hsnCode: line.hsnCode,
          }))
        : [makeBlankLine()],
    );
    setFormError(null);
    setModalOpen(true);
  };

  const handleProductChange = (idx: number, productId: string) => {
    const prod = products.find((p) => p.id === productId);
    setFormItems((prev) =>
      prev.map((row, i) =>
        i === idx
          ? {
              ...row,
              productId,
              sellingPrice: prod ? String(prod.sellingPrice) : row.sellingPrice,
              gstPercentage: prod ? String(prod.gstPercentage) : row.gstPercentage,
              hsnCode: prod?.hsnCode || factorySettings.defaultHsnCode,
            }
          : row,
      ),
    );
  };

  const handleSaveOrder = async (targetStatus: 'Draft' | 'Pending Approval') => {
    if (!firebaseUser || !userProfile || !canCreateEdit) return;

    const validation = validateSalesOrderInput(
      {
        orderNumber: formOrderNumber,
        customerId: formCustomerId,
        orderDate: formOrderDate,
        expectedDeliveryDate: formDeliveryDate,
        salesmanUid: formSalesmanUid || firebaseUser.uid,
        salesmanName: userProfile.displayName,
        status: targetStatus,
        notes: formNotes,
        items: formItems,
      },
      customers,
      products,
      employees,
      factorySettings,
      firebaseUser.uid,
      realRole,
      userProfile.displayName,
    );

    if (!validation.valid) {
      setFormError(validation.error);
      return;
    }

    const dupNumber = orders.find(
      (o) => o.orderNumber === validation.sanitized.orderNumber && o.id !== editingOrder?.id,
    );
    if (dupNumber) {
      setFormError(`Sales Order number "${validation.sanitized.orderNumber}" already exists.`);
      return;
    }

    setSaving(true);
    setFormError(null);

    try {
      const batch = writeBatch(db);
      const { items, ...header } = validation.sanitized;

      if (editingOrder) {
        const orderRef = doc(db, 'salesOrders', editingOrder.id);
        batch.update(orderRef, {
          ...header,
          updatedAt: serverTimestamp(),
        });

        const oldLines = itemsByOrderId.get(editingOrder.id) ?? [];
        oldLines.forEach((oldLine) => {
          batch.delete(doc(db, 'salesOrderItems', oldLine.id));
        });

        items.forEach((line) => {
          const lineRef = doc(collection(db, 'salesOrderItems'));
          batch.set(lineRef, {
            id: lineRef.id,
            orgId: ORG_ID,
            salesOrderId: editingOrder.id,
            salesmanUid: header.salesmanUid,
            ...line,
            dispatchedQuantity: 0,
            createdBy: firebaseUser.uid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        });
      } else {
        const orderRef = doc(collection(db, 'salesOrders'));
        batch.set(orderRef, {
          id: orderRef.id,
          orgId: ORG_ID,
          ...header,
          totalDispatchedQty: 0,
          invoiceId: '',
          invoiceNumber: '',
          createdBy: firebaseUser.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        items.forEach((line) => {
          const lineRef = doc(collection(db, 'salesOrderItems'));
          batch.set(lineRef, {
            id: lineRef.id,
            orgId: ORG_ID,
            salesOrderId: orderRef.id,
            salesmanUid: header.salesmanUid,
            ...line,
            dispatchedQuantity: 0,
            createdBy: firebaseUser.uid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        });
      }

      await batch.commit();
      setModalOpen(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes('permission')) {
        handleFirestoreError(
          err,
          editingOrder ? OperationType.UPDATE : OperationType.CREATE,
          editingOrder ? `salesOrders/${editingOrder.id}` : 'salesOrders',
        );
      }
      setFormError('Failed to save sales order. Verify permissions and line item inputs.');
    } finally {
      setSaving(false);
    }
  };

  const handleSubmitDraftForApproval = async (order: SalesOrder) => {
    if (!firebaseUser || order.status !== 'Draft') return;
    setProcessingAction(true);
    setActionError(null);
    try {
      await updateDoc(doc(db, 'salesOrders', order.id), {
        status: 'Pending Approval',
        updatedAt: serverTimestamp(),
      });
      setViewingOrder(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `salesOrders/${order.id}`);
      setActionError('Unable to submit order for approval.');
    } finally {
      setProcessingAction(false);
    }
  };

  const handleApprovalDecision = async (order: SalesOrder, decision: 'Approved' | 'Rejected') => {
    if (!firebaseUser || !userProfile || !canApproveReject) return;
    const check = validateSalesOrderApproval(decision, approvalRemarks);
    if (!check.valid) {
      setActionError(check.error);
      return;
    }

    setProcessingAction(true);
    setActionError(null);
    try {
      await updateDoc(doc(db, 'salesOrders', order.id), {
        status: check.decision,
        approverUid: firebaseUser.uid,
        approverName: userProfile.displayName,
        approvedAt: serverTimestamp(),
        approvalRemarks: check.remarks,
        updatedAt: serverTimestamp(),
      });
      setViewingOrder(null);
      setApprovalRemarks('');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `salesOrders/${order.id}`);
      setActionError('Failed to record approval decision.');
    } finally {
      setProcessingAction(false);
    }
  };

  const handleCancelOrder = async (order: SalesOrder) => {
    if (!firebaseUser) return;
    if (order.totalDispatchedQty > 0 || order.invoiceId) {
      setActionError('Orders with dispatches or generated invoices cannot be cancelled.');
      return;
    }
    setProcessingAction(true);
    setActionError(null);
    try {
      await updateDoc(doc(db, 'salesOrders', order.id), {
        status: 'Cancelled',
        updatedAt: serverTimestamp(),
      });
      setViewingOrder(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `salesOrders/${order.id}`);
      setActionError('Failed to cancel order.');
    } finally {
      setProcessingAction(false);
    }
  };

  const handleDeleteOrder = async () => {
    if (!deletingOrder || !canApproveReject) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const batch = writeBatch(db);
      const lines = itemsByOrderId.get(deletingOrder.id) ?? [];
      lines.forEach((line) => batch.delete(doc(db, 'salesOrderItems', line.id)));
      batch.delete(doc(db, 'salesOrders', deletingOrder.id));
      await batch.commit();
      setDeletingOrder(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `salesOrders/${deletingOrder.id}`);
      setDeleteError('Failed to delete sales order. Only un-invoiced Draft/Rejected/Cancelled orders can be deleted.');
    } finally {
      setDeleting(false);
    }
  };

  const viewingLines = viewingOrder ? itemsByOrderId.get(viewingOrder.id) ?? [] : [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-[#3B4F4E]">Sales &amp; Fulfillment</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#3B4F4E]">
            Sales Orders
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Create customer orders, track GST calculations, and manage Owner/Admin approvals before dispatch.
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {canCreateEdit ? (
            <button
              type="button"
              onClick={openCreateModal}
              disabled={customers.length === 0 || products.length === 0}
              className="min-h-[40px] inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#CF9C2D] hover:bg-[#BC8B22] disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap"
            >
              <Plus className="w-4 h-4 shrink-0" />
              New Sales Order
            </button>
          ) : (
            <span className="text-xs text-slate-500">View-only for {activeRole}</span>
          )}
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-[#DCE6E6] rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500">Total Sales Orders</p>
          <p className="mt-2 text-2xl font-semibold font-mono tabular-nums text-[#3B4F4E]">
            {kpis.total}
          </p>
        </div>
        <div className="bg-white border border-[#DCE6E6] rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500">Pending Approval</p>
          <p className="mt-2 text-2xl font-semibold font-mono tabular-nums text-amber-700">
            {kpis.pendingApproval}
          </p>
        </div>
        <div className="bg-white border border-[#DCE6E6] rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500">Approved / Dispatch Queue</p>
          <p className="mt-2 text-2xl font-semibold font-mono tabular-nums text-[#3B4F4E]">
            {kpis.readyToShip}
          </p>
        </div>
        <div className="bg-white border border-[#DCE6E6] rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500">Active Order Book Value</p>
          <p className="mt-2 text-2xl font-semibold font-mono tabular-nums text-[#3B4F4E]">
            ₹{kpis.totalOrderValue.toFixed(2)}
          </p>
        </div>
      </div>

      {loadError && (
        <div role="alert" className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3 text-sm text-red-800">
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
          <span>{loadError}</span>
        </div>
      )}

      {(customers.length === 0 || products.length === 0) && !loading && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center gap-3 text-xs text-amber-900">
          <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0" />
          <span>
            Register at least one Customer and one Active Product before placing sales orders.
          </span>
        </div>
      )}

      {/* Search, Filters & Table */}
      <div className="bg-white border border-[#DCE6E6] rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#DCE6E6] flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search order no., customer, salesman, or invoice no..."
              aria-label="Search sales orders"
              className="w-full h-9 pl-9 pr-3 text-sm text-[#3B4F4E] bg-slate-50 border border-[#DCE6E6] rounded-lg placeholder:text-slate-400 focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#CF9C2D]"
            />
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {(['All', ...SALES_ORDER_STATUSES] as const).map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => setStatusFilter(status)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md border transition-colors whitespace-nowrap ${
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
                <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 whitespace-nowrap">
                  Order No.
                </th>
                <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 whitespace-nowrap">
                  Customer &amp; Tax Mode
                </th>
                <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 whitespace-nowrap">
                  Order / Delivery
                </th>
                <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 whitespace-nowrap">
                  Salesman
                </th>
                <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 text-right whitespace-nowrap">
                  Dispatched
                </th>
                <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 text-right whitespace-nowrap">
                  Grand Total
                </th>
                <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 whitespace-nowrap">
                  Status
                </th>
                <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 text-right whitespace-nowrap">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-5 py-12 text-center text-sm text-slate-500">
                    Loading sales orders from Cloud Firestore...
                  </td>
                </tr>
              ) : filteredOrders.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-16 text-center">
                    <div className="max-w-md mx-auto flex flex-col items-center">
                      <div className="w-11 h-11 rounded-xl bg-slate-100 border border-[#DCE6E6] flex items-center justify-center text-slate-500 mb-4">
                        <FileSpreadsheet className="w-5 h-5" />
                      </div>
                      <h2 className="text-base font-semibold text-[#3B4F4E]">
                        {orders.length === 0 ? 'No sales orders placed yet' : 'No matching sales orders'}
                      </h2>
                      <p className="mt-1.5 text-sm text-slate-600">
                        {orders.length === 0
                          ? 'Create a customer sales order to capture snack quantities, GST splits, and approvals.'
                          : 'Try adjusting your search query or status filter.'}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredOrders.map((order) => {
                  const canEditRow =
                    canCreateEdit &&
                    (order.status === 'Draft' || order.status === 'Pending Approval') &&
                    order.totalDispatchedQty === 0 &&
                    !order.invoiceId;
                  const canDeleteRow =
                    canApproveReject &&
                    ['Draft', 'Rejected', 'Cancelled'].includes(order.status) &&
                    order.totalDispatchedQty === 0 &&
                    !order.invoiceId;

                  return (
                    <tr key={order.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="px-5 py-3.5 whitespace-nowrap">
                        <p className="font-mono text-xs font-semibold text-[#3B4F4E]">
                          {order.orderNumber}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          {order.itemCount} {order.itemCount === 1 ? 'item' : 'items'}
                          {order.invoiceNumber ? ` · Inv ${order.invoiceNumber}` : ''}
                        </p>
                      </td>
                      <td className="px-5 py-3.5 min-w-[200px]">
                        <p className="text-sm font-medium text-[#3B4F4E]">{order.customerName}</p>
                        <p className="text-xs text-slate-500">
                          {order.customerState} ({order.customerStateCode}) ·{' '}
                          <span className="font-mono text-[11px]">
                            {order.taxType === 'CGST_SGST' ? 'CGST+SGST' : 'IGST'}
                          </span>
                        </p>
                      </td>
                      <td className="px-5 py-3.5 font-mono text-xs text-slate-700 whitespace-nowrap">
                        <p>{order.orderDate}</p>
                        <p className="text-[11px] text-slate-500">Due {order.expectedDeliveryDate}</p>
                      </td>
                      <td className="px-5 py-3.5 text-xs text-slate-700 whitespace-nowrap">
                        {order.salesmanName}
                      </td>
                      <td className="px-5 py-3.5 font-mono text-xs text-slate-800 text-right tabular-nums whitespace-nowrap">
                        {order.totalDispatchedQty} / {order.totalOrderedQty} pkts
                      </td>
                      <td className="px-5 py-3.5 font-mono text-sm font-medium text-[#3B4F4E] text-right tabular-nums whitespace-nowrap">
                        ₹{order.grandTotal.toFixed(2)}
                      </td>
                      <td className="px-5 py-3.5 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 text-xs font-medium rounded-md border ${statusBadgeStyle(
                            order.status,
                          )}`}
                        >
                          {order.status}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setActionError(null);
                              setApprovalRemarks('');
                              setViewingOrder(order);
                            }}
                            className="min-h-[32px] inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-[#3B4F4E] bg-[#EEF3F3] hover:bg-[#E5EDED] rounded-md transition-colors"
                          >
                            {order.status === 'Pending Approval' && canApproveReject ? (
                              <>
                                <ClipboardCheck className="w-3.5 h-3.5" />
                                Review
                              </>
                            ) : (
                              <>
                                <Eye className="w-3.5 h-3.5" />
                                View
                              </>
                            )}
                          </button>

                          {canEditRow && (
                            <button
                              type="button"
                              onClick={() => openEditModal(order)}
                              className="min-h-[32px] inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-[#DCE6E6] rounded-md transition-colors"
                            >
                              <Edit3 className="w-3.5 h-3.5 text-slate-500" />
                              Edit
                            </button>
                          )}

                          {canDeleteRow && (
                            <button
                              type="button"
                              onClick={() => {
                                setDeleteError(null);
                                setDeletingOrder(order);
                              }}
                              className="min-h-[32px] inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-red-700 bg-white hover:bg-red-50 border border-[#DCE6E6] rounded-md transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create / Edit Sales Order Modal */}
      {modalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="so-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/50 overflow-y-auto"
        >
          <div className="w-full max-w-4xl bg-white border border-[#DCE6E6] rounded-xl overflow-hidden my-8">
            <div className="px-6 py-4 border-b border-[#DCE6E6] flex items-center justify-between">
              <h2 id="so-modal-title" className="text-base font-semibold text-[#3B4F4E]">
                {editingOrder ? `Edit Sales Order ${editingOrder.orderNumber}` : 'Create Sales Order'}
              </h2>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                aria-label="Close modal"
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-5 max-h-[80vh] overflow-y-auto">
              {formError && (
                <div role="alert" className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <label htmlFor="so-number" className="block text-xs font-medium text-slate-700 mb-1">
                    Order Number *
                  </label>
                  <input
                    id="so-number"
                    type="text"
                    maxLength={BLUEPRINT_CONSTRAINTS.code.maxLength}
                    value={formOrderNumber}
                    onChange={(e) => setFormOrderNumber(e.target.value.toUpperCase())}
                    className="w-full h-9 px-3 font-mono text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label htmlFor="so-customer" className="block text-xs font-medium text-slate-700 mb-1">
                    Customer *
                  </label>
                  <select
                    id="so-customer"
                    value={formCustomerId}
                    onChange={(e) => setFormCustomerId(e.target.value)}
                    className="w-full h-9 px-3 text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                  >
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.state} · {c.stateCode})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="so-salesman" className="block text-xs font-medium text-slate-700 mb-1">
                    Responsible Salesman *
                  </label>
                  {realRole === 'Owner' || realRole === 'Admin' ? (
                    <select
                      id="so-salesman"
                      value={formSalesmanUid}
                      onChange={(e) => setFormSalesmanUid(e.target.value)}
                      className="w-full h-9 px-3 text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                    >
                      {employees.length === 0 ? (
                        <option value={firebaseUser?.uid ?? ''}>
                          {userProfile?.displayName ?? 'Current User'}
                        </option>
                      ) : (
                        employees.map((emp) => (
                          <option key={emp.uid} value={emp.uid}>
                            {emp.displayName} ({emp.role})
                          </option>
                        ))
                      )}
                    </select>
                  ) : (
                    <input
                      id="so-salesman"
                      type="text"
                      readOnly
                      value={userProfile?.displayName ?? ''}
                      className="w-full h-9 px-3 text-sm text-slate-600 bg-slate-50 border border-[#DCE6E6] rounded-lg"
                    />
                  )}
                </div>

                <div>
                  <label htmlFor="so-order-date" className="block text-xs font-medium text-slate-700 mb-1">
                    Order Date *
                  </label>
                  <input
                    id="so-order-date"
                    type="date"
                    value={formOrderDate}
                    onChange={(e) => setFormOrderDate(e.target.value)}
                    className="w-full h-9 px-3 font-mono text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                  />
                </div>

                <div>
                  <label htmlFor="so-delivery-date" className="block text-xs font-medium text-slate-700 mb-1">
                    Expected Delivery Date *
                  </label>
                  <input
                    id="so-delivery-date"
                    type="date"
                    value={formDeliveryDate}
                    onChange={(e) => setFormDeliveryDate(e.target.value)}
                    className="w-full h-9 px-3 font-mono text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                  />
                </div>

                <div className="sm:col-span-2 flex items-end">
                  <div className="w-full h-9 px-3 bg-slate-50 border border-[#DCE6E6] rounded-lg flex items-center justify-between text-xs">
                    <span className="text-slate-600">Applicable Tax Regime:</span>
                    <span className="font-mono font-semibold text-[#3B4F4E]">
                      {liveFormSummary.isIntra
                        ? `Intra-State (${factorySettings.factoryStateCode}) · CGST + SGST`
                        : `Inter-State · IGST`}
                    </span>
                  </div>
                </div>
              </div>

              {/* Line Items */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-700">
                    Finished Products *
                  </h3>
                  <button
                    type="button"
                    onClick={() => setFormItems((prev) => [...prev, makeBlankLine()])}
                    className="min-h-[30px] inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-[#3B4F4E] bg-[#EEF3F3] hover:bg-[#E5EDED] rounded-md"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Product Line
                  </button>
                </div>

                <div className="border border-[#DCE6E6] rounded-lg overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-[#DCE6E6] text-[11px] font-semibold text-slate-600">
                        <th className="px-3 py-2">Finished Product</th>
                        <th className="px-3 py-2 w-24">HSN</th>
                        <th className="px-3 py-2 w-24 text-right">Qty (pkts)</th>
                        <th className="px-3 py-2 w-28 text-right">Rate (₹)</th>
                        <th className="px-3 py-2 w-24 text-right">GST %</th>
                        <th className="px-3 py-2 w-28 text-right">Line Total</th>
                        <th className="px-3 py-2 w-10" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {formItems.map((line, idx) => {
                        const q = Number(line.quantity);
                        const r = Number(line.sellingPrice);
                        const g = Number(line.gstPercentage);
                        const linePreview =
                          Number.isFinite(q) && Number.isFinite(r) && Number.isFinite(g)
                            ? computeLineTaxBreakdown(q, r, g, liveFormSummary.isIntra).lineTotal
                            : 0;

                        return (
                          <tr key={idx}>
                            <td className="px-3 py-2 min-w-[200px]">
                              <select
                                value={line.productId}
                                onChange={(e) => handleProductChange(idx, e.target.value)}
                                className="w-full h-8 px-2 text-xs text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-md focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                              >
                                {products.map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.name} ({p.packetSize}) [{p.sku}]
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="text"
                                maxLength={16}
                                value={line.hsnCode}
                                onChange={(e) =>
                                  setFormItems((prev) =>
                                    prev.map((row, i) =>
                                      i === idx ? { ...row, hsnCode: e.target.value.toUpperCase() } : row,
                                    ),
                                  )
                                }
                                className="w-full h-8 px-2 font-mono text-xs text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-md"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="number"
                                min="1"
                                step="1"
                                value={line.quantity}
                                onChange={(e) =>
                                  setFormItems((prev) =>
                                    prev.map((row, i) =>
                                      i === idx ? { ...row, quantity: e.target.value } : row,
                                    ),
                                  )
                                }
                                className="w-full h-8 px-2 font-mono text-xs text-right text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-md"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={line.sellingPrice}
                                onChange={(e) =>
                                  setFormItems((prev) =>
                                    prev.map((row, i) =>
                                      i === idx ? { ...row, sellingPrice: e.target.value } : row,
                                    ),
                                  )
                                }
                                className="w-full h-8 px-2 font-mono text-xs text-right text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-md"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <select
                                value={line.gstPercentage}
                                onChange={(e) =>
                                  setFormItems((prev) =>
                                    prev.map((row, i) =>
                                      i === idx ? { ...row, gstPercentage: e.target.value } : row,
                                    ),
                                  )
                                }
                                className="w-full h-8 px-2 font-mono text-xs text-right text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-md"
                              >
                                {GST_RATES.map((rate) => (
                                  <option key={rate} value={String(rate)}>
                                    {rate}%
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="px-3 py-2 font-mono text-xs font-medium text-right text-[#3B4F4E] tabular-nums whitespace-nowrap">
                              ₹{linePreview.toFixed(2)}
                            </td>
                            <td className="px-2 py-2 text-center">
                              {formItems.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setFormItems((prev) => prev.filter((_, i) => i !== idx))
                                  }
                                  aria-label="Remove product line"
                                  className="p-1 text-slate-400 hover:text-red-600"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                <div>
                  <label htmlFor="so-notes" className="block text-xs font-medium text-slate-700 mb-1">
                    Order Notes / Delivery Instructions
                  </label>
                  <textarea
                    id="so-notes"
                    rows={3}
                    maxLength={BLUEPRINT_CONSTRAINTS.description.maxLength}
                    value={formNotes}
                    onChange={(e) => setFormNotes(e.target.value)}
                    placeholder="Optional packaging, route, or billing remarks..."
                    className="w-full p-3 text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                  />
                </div>

                <div className="bg-slate-50 border border-[#DCE6E6] rounded-xl p-4 space-y-2 text-xs">
                  <div className="flex justify-between text-slate-600">
                    <span>Taxable Subtotal</span>
                    <span className="font-mono tabular-nums text-[#3B4F4E]">
                      ₹{liveFormSummary.subtotal.toFixed(2)}
                    </span>
                  </div>
                  {liveFormSummary.isIntra ? (
                    <>
                      <div className="flex justify-between text-slate-600">
                        <span>CGST</span>
                        <span className="font-mono tabular-nums text-[#3B4F4E]">
                          ₹{liveFormSummary.cgst.toFixed(2)}
                        </span>
                      </div>
                      <div className="flex justify-between text-slate-600">
                        <span>SGST</span>
                        <span className="font-mono tabular-nums text-[#3B4F4E]">
                          ₹{liveFormSummary.sgst.toFixed(2)}
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="flex justify-between text-slate-600">
                      <span>IGST</span>
                      <span className="font-mono tabular-nums text-[#3B4F4E]">
                        ₹{liveFormSummary.igst.toFixed(2)}
                      </span>
                    </div>
                  )}
                  <div className="pt-2 border-t border-[#DCE6E6] flex justify-between text-sm font-semibold text-[#3B4F4E]">
                    <span>Grand Total</span>
                    <span className="font-mono tabular-nums">
                      ₹{liveFormSummary.grandTotal.toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-[#DCE6E6] flex flex-wrap items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="min-h-[38px] px-4 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-[#DCE6E6] rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void handleSaveOrder('Draft')}
                  className="min-h-[38px] px-4 py-2 text-xs font-medium text-slate-800 bg-slate-100 hover:bg-slate-200 border border-[#DCE6E6] rounded-lg"
                >
                  {saving ? 'Saving...' : 'Save as Draft'}
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void handleSaveOrder('Pending Approval')}
                  className="min-h-[38px] inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-[#CF9C2D] hover:bg-[#BC8B22] disabled:opacity-60 rounded-lg"
                >
                  <Send className="w-3.5 h-3.5" />
                  {saving ? 'Submitting...' : 'Submit for Approval'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Order Detail & Approval Modal */}
      {viewingOrder && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="so-view-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/50 overflow-y-auto"
        >
          <div className="w-full max-w-3xl bg-white border border-[#DCE6E6] rounded-xl overflow-hidden my-8">
            <div className="px-6 py-4 border-b border-[#DCE6E6] flex items-center justify-between">
              <div>
                <h2 id="so-view-title" className="text-base font-semibold text-[#3B4F4E]">
                  Sales Order {viewingOrder.orderNumber}
                </h2>
                <p className="text-xs text-slate-500">
                  {viewingOrder.customerName} · Salesman: {viewingOrder.salesmanName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setViewingOrder(null)}
                aria-label="Close detail"
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-5 max-h-[80vh] overflow-y-auto">
              {actionError && (
                <div role="alert" className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{actionError}</span>
                </div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="bg-slate-50 border border-[#DCE6E6] rounded-lg p-3">
                  <p className="text-slate-500">Status</p>
                  <p className="mt-1 font-semibold text-[#3B4F4E]">{viewingOrder.status}</p>
                </div>
                <div className="bg-slate-50 border border-[#DCE6E6] rounded-lg p-3">
                  <p className="text-slate-500">Order / Delivery</p>
                  <p className="mt-1 font-mono text-[#3B4F4E]">
                    {viewingOrder.orderDate} → {viewingOrder.expectedDeliveryDate}
                  </p>
                </div>
                <div className="bg-slate-50 border border-[#DCE6E6] rounded-lg p-3">
                  <p className="text-slate-500">Fulfillment</p>
                  <p className="mt-1 font-mono text-[#3B4F4E]">
                    {viewingOrder.totalDispatchedQty} / {viewingOrder.totalOrderedQty} pkts
                  </p>
                </div>
                <div className="bg-slate-50 border border-[#DCE6E6] rounded-lg p-3">
                  <p className="text-slate-500">GST Invoice</p>
                  <p className="mt-1 font-mono text-[#3B4F4E]">
                    {viewingOrder.invoiceNumber || 'Not yet invoiced'}
                  </p>
                </div>
              </div>

              {viewingOrder.approverName && (
                <div className="bg-slate-50 border border-[#DCE6E6] rounded-lg p-3.5 text-xs space-y-1">
                  <p className="font-semibold text-slate-800">
                    Approval Audit: {viewingOrder.status === 'Rejected' ? 'Rejected' : 'Approved'} by{' '}
                    {viewingOrder.approverName}
                    {viewingOrder.approvedAt
                      ? ` on ${viewingOrder.approvedAt.toDate().toLocaleString()}`
                      : ''}
                  </p>
                  {viewingOrder.approvalRemarks && (
                    <p className="text-slate-600">Remarks: {viewingOrder.approvalRemarks}</p>
                  )}
                </div>
              )}

              <div className="border border-[#DCE6E6] rounded-lg overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-[#DCE6E6] text-[11px] font-semibold text-slate-600">
                      <th className="px-4 py-2.5">Product</th>
                      <th className="px-4 py-2.5">HSN</th>
                      <th className="px-4 py-2.5 text-right">Ordered</th>
                      <th className="px-4 py-2.5 text-right">Dispatched</th>
                      <th className="px-4 py-2.5 text-right">Rate</th>
                      <th className="px-4 py-2.5 text-right">GST</th>
                      <th className="px-4 py-2.5 text-right">Line Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-xs">
                    {viewingLines.map((line) => (
                      <tr key={line.id}>
                        <td className="px-4 py-2.5">
                          <p className="font-medium text-[#3B4F4E]">{line.productName}</p>
                          <p className="font-mono text-[11px] text-slate-500">
                            {line.productSku} · {line.packetSize}
                          </p>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-slate-600">{line.hsnCode}</td>
                        <td className="px-4 py-2.5 font-mono text-right">{line.quantity}</td>
                        <td className="px-4 py-2.5 font-mono text-right">{line.dispatchedQuantity}</td>
                        <td className="px-4 py-2.5 font-mono text-right">₹{line.sellingPrice.toFixed(2)}</td>
                        <td className="px-4 py-2.5 font-mono text-right">
                          {line.gstPercentage}% (₹{line.lineGst.toFixed(2)})
                        </td>
                        <td className="px-4 py-2.5 font-mono font-medium text-right text-[#3B4F4E]">
                          ₹{line.lineTotal.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-50 border border-[#DCE6E6] rounded-lg p-4 text-xs">
                <div className="space-y-1 text-slate-600">
                  <p>
                    <span className="font-medium text-slate-800">Billing Address:</span>{' '}
                    {viewingOrder.customerAddress}, {viewingOrder.customerState} (
                    {viewingOrder.customerStateCode})
                  </p>
                  <p>
                    <span className="font-medium text-slate-800">Customer GSTIN:</span>{' '}
                    <span className="font-mono">{viewingOrder.customerGstin || 'Unregistered'}</span>
                  </p>
                  {viewingOrder.notes && (
                    <p>
                      <span className="font-medium text-slate-800">Notes:</span> {viewingOrder.notes}
                    </p>
                  )}
                </div>
                <div className="text-right space-y-1 shrink-0">
                  <p className="text-slate-600">
                    Subtotal: <span className="font-mono text-[#3B4F4E]">₹{viewingOrder.subtotal.toFixed(2)}</span>
                  </p>
                  {viewingOrder.taxType === 'CGST_SGST' ? (
                    <p className="text-slate-600">
                      CGST + SGST:{' '}
                      <span className="font-mono text-[#3B4F4E]">
                        ₹{viewingOrder.cgstTotal.toFixed(2)} + ₹{viewingOrder.sgstTotal.toFixed(2)}
                      </span>
                    </p>
                  ) : (
                    <p className="text-slate-600">
                      IGST: <span className="font-mono text-[#3B4F4E]">₹{viewingOrder.igstTotal.toFixed(2)}</span>
                    </p>
                  )}
                  <p className="text-sm font-semibold text-[#3B4F4E]">
                    Grand Total: <span className="font-mono">₹{viewingOrder.grandTotal.toFixed(2)}</span>
                  </p>
                </div>
              </div>

              {/* Approval Workflow Controls (Owner / Admin Only) */}
              {viewingOrder.status === 'Pending Approval' && canApproveReject && (
                <div className="border border-[#DCE6E6] bg-[#EEF3F3]/70 rounded-xl p-4 space-y-3">
                  <p className="text-xs font-semibold text-[#3B4F4E]">
                    Order Approval Decision (Owner / Admin)
                  </p>
                  <input
                    type="text"
                    maxLength={300}
                    value={approvalRemarks}
                    onChange={(e) => setApprovalRemarks(e.target.value)}
                    placeholder="Approval remarks (required when rejecting)..."
                    className="w-full h-9 px-3 text-sm bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                  />
                  <div className="flex flex-wrap items-center justify-end gap-3">
                    <button
                      type="button"
                      disabled={processingAction}
                      onClick={() => void handleApprovalDecision(viewingOrder, 'Rejected')}
                      className="min-h-[36px] inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-red-700 bg-white hover:bg-red-50 border border-red-200 rounded-lg"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      Reject Order
                    </button>
                    <button
                      type="button"
                      disabled={processingAction}
                      onClick={() => void handleApprovalDecision(viewingOrder, 'Approved')}
                      className="min-h-[36px] inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Approve Order
                    </button>
                  </div>
                </div>
              )}

              <div className="pt-2 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  {viewingOrder.status === 'Draft' && canCreateEdit && (
                    <button
                      type="button"
                      disabled={processingAction}
                      onClick={() => void handleSubmitDraftForApproval(viewingOrder)}
                      className="min-h-[36px] inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-[#CF9C2D] hover:bg-[#BC8B22] rounded-lg"
                    >
                      <Send className="w-3.5 h-3.5" />
                      Submit for Approval
                    </button>
                  )}
                  {((['Draft', 'Pending Approval'].includes(viewingOrder.status) && canCreateEdit) ||
                    (viewingOrder.status === 'Approved' && canApproveReject)) &&
                    viewingOrder.totalDispatchedQty === 0 &&
                    !viewingOrder.invoiceId && (
                      <button
                        type="button"
                        disabled={processingAction}
                        onClick={() => void handleCancelOrder(viewingOrder)}
                        className="min-h-[36px] px-3.5 py-1.5 text-xs font-medium text-red-700 bg-white hover:bg-red-50 border border-[#DCE6E6] rounded-lg"
                      >
                        Cancel Order
                      </button>
                    )}
                </div>

                <button
                  type="button"
                  onClick={() => setViewingOrder(null)}
                  className="min-h-[36px] px-4 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-[#DCE6E6] rounded-lg"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {deletingOrder && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/50"
        >
          <div className="w-full max-w-md bg-white border border-[#DCE6E6] rounded-xl p-6 space-y-4">
            <h2 className="text-base font-semibold text-[#3B4F4E]">Delete Sales Order</h2>
            <p className="text-sm text-slate-600">
              Permanently remove sales order{' '}
              <span className="font-mono font-semibold text-[#3B4F4E]">
                {deletingOrder.orderNumber}
              </span>{' '}
              and its line items?
            </p>
            {deleteError && (
              <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
                {deleteError}
              </p>
            )}
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeletingOrder(null)}
                className="min-h-[36px] px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-[#DCE6E6] rounded-lg"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => void handleDeleteOrder()}
                className="min-h-[36px] px-4 py-2 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg"
              >
                {deleting ? 'Deleting...' : 'Delete Order'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
