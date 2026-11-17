import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  Eye,
  Printer,
  Search,
  ShieldAlert,
  Truck,
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
import { downloadDispatchNotePdf } from '../lib/pdfGenerator';
import {
  roundQuantity,
  validateDispatchInput,
  type DispatchLineDraft,
} from '../lib/validation';
import {
  ORG_ID,
  type Dispatch,
  type DispatchItem,
  type SalesOrder,
  type SalesOrderItem,
  type StockBalance,
} from '../types/erp';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function nextDispatchNumber(dispatches: Dispatch[]): string {
  const year = new Date().getFullYear();
  const prefix = `DSP-${year}-`;
  let maxSeq = 0;
  dispatches.forEach((d) => {
    if (d.dispatchNumber.startsWith(prefix)) {
      const n = Number(d.dispatchNumber.slice(prefix.length));
      if (Number.isInteger(n) && n > maxSeq) maxSeq = n;
    }
  });
  return `${prefix}${String(maxSeq + 1).padStart(4, '0')}`;
}

export function DispatchPage() {
  const { firebaseUser, userProfile, effectiveRole } = useAuth();
  const activeRole = effectiveRole ?? userProfile?.role ?? 'Salesman';
  const realRole = userProfile?.role ?? 'Salesman';
  const isSalesmanOnly = realRole === 'Salesman';

  const canExecuteDispatch =
    ['Owner', 'Admin', 'Production Supervisor'].includes(activeRole) &&
    ['Owner', 'Admin', 'Production Supervisor'].includes(realRole);
  const canAuthorizePartial =
    ['Owner', 'Admin'].includes(activeRole) && ['Owner', 'Admin'].includes(realRole);

  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [orderItems, setOrderItems] = useState<SalesOrderItem[]>([]);
  const [stockBalances, setStockBalances] = useState<StockBalance[]>([]);
  const [dispatches, setDispatches] = useState<Dispatch[]>([]);
  const [dispatchItems, setDispatchItems] = useState<DispatchItem[]>([]);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const [selectedOrder, setSelectedOrder] = useState<SalesOrder | null>(null);
  const [formDispatchNumber, setFormDispatchNumber] = useState('');
  const [formDispatchDate, setFormDispatchDate] = useState(todayIso());
  const [formVehicleNumber, setFormVehicleNumber] = useState('');
  const [formDriverName, setFormDriverName] = useState('');
  const [formTransporter, setFormTransporter] = useState('');
  const [formEwayBill, setFormEwayBill] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formConfirmPartial, setFormConfirmPartial] = useState(false);
  const [formLines, setFormLines] = useState<DispatchLineDraft[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [viewingDispatch, setViewingDispatch] = useState<Dispatch | null>(null);

  useEffect(() => {
    if (!firebaseUser) return;
    setLoading(true);
    setLoadError(null);

    const ordersQuery = isSalesmanOnly
      ? query(collection(db, 'salesOrders'), where('salesmanUid', '==', firebaseUser.uid))
      : query(collection(db, 'salesOrders'), where('orgId', '==', ORG_ID));

    const orderItemsQuery = isSalesmanOnly
      ? query(collection(db, 'salesOrderItems'), where('salesmanUid', '==', firebaseUser.uid))
      : query(collection(db, 'salesOrderItems'), where('orgId', '==', ORG_ID));

    const dispatchesQuery = isSalesmanOnly
      ? query(collection(db, 'dispatches'), where('salesmanUid', '==', firebaseUser.uid))
      : query(collection(db, 'dispatches'), where('orgId', '==', ORG_ID));

    const dispatchItemsQuery = isSalesmanOnly
      ? query(collection(db, 'dispatchItems'), where('salesmanUid', '==', firebaseUser.uid))
      : query(collection(db, 'dispatchItems'), where('orgId', '==', ORG_ID));

    const unsubOrders = onSnapshot(
      ordersQuery,
      (snap) => {
        const rows = snap.docs.map((d) => d.data() as SalesOrder);
        rows.sort((a, b) => b.orderDate.localeCompare(a.orderDate));
        setOrders(rows);
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, 'salesOrders');
      },
    );

    const unsubOrderItems = onSnapshot(
      orderItemsQuery,
      (snap) => {
        setOrderItems(snap.docs.map((d) => d.data() as SalesOrderItem));
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, 'salesOrderItems');
      },
    );

    const unsubBalances = onSnapshot(
      query(collection(db, 'stockBalances'), where('orgId', '==', ORG_ID)),
      (snap) => {
        setStockBalances(snap.docs.map((d) => d.data() as StockBalance));
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, 'stockBalances');
      },
    );

    const unsubDispatches = onSnapshot(
      dispatchesQuery,
      (snap) => {
        const rows = snap.docs.map((d) => d.data() as Dispatch);
        rows.sort(
          (a, b) =>
            b.dispatchDate.localeCompare(a.dispatchDate) ||
            b.dispatchNumber.localeCompare(a.dispatchNumber),
        );
        setDispatches(rows);
        setLoading(false);
      },
      (err) => {
        setLoading(false);
        setLoadError('Unable to load dispatch records from Cloud Firestore.');
        handleFirestoreError(err, OperationType.LIST, 'dispatches');
      },
    );

    const unsubDispatchItems = onSnapshot(
      dispatchItemsQuery,
      (snap) => {
        setDispatchItems(snap.docs.map((d) => d.data() as DispatchItem));
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, 'dispatchItems');
      },
    );

    return () => {
      unsubOrders();
      unsubOrderItems();
      unsubBalances();
      unsubDispatches();
      unsubDispatchItems();
    };
  }, [firebaseUser, isSalesmanOnly]);

  const fgStockByProductId = useMemo(() => {
    const map = new Map<string, number>();
    stockBalances
      .filter((b) => b.stockCategory === 'finished_goods')
      .forEach((b) => {
        map.set(b.itemId, roundQuantity(b.currentBalance));
      });
    return map;
  }, [stockBalances]);

  const orderItemsByOrderId = useMemo(() => {
    const map = new Map<string, SalesOrderItem[]>();
    orderItems.forEach((item) => {
      const list = map.get(item.salesOrderId) ?? [];
      list.push(item);
      map.set(item.salesOrderId, list);
    });
    return map;
  }, [orderItems]);

  const dispatchItemsByDispatchId = useMemo(() => {
    const map = new Map<string, DispatchItem[]>();
    dispatchItems.forEach((item) => {
      const list = map.get(item.dispatchId) ?? [];
      list.push(item);
      map.set(item.dispatchId, list);
    });
    return map;
  }, [dispatchItems]);

  const approvedQueue = useMemo(
    () =>
      orders.filter(
        (o) => o.status === 'Approved' || o.status === 'Partially Dispatched',
      ),
    [orders],
  );

  const filteredDispatches = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return dispatches;
    return dispatches.filter(
      (d) =>
        d.dispatchNumber.toLowerCase().includes(term) ||
        d.orderNumber.toLowerCase().includes(term) ||
        d.customerName.toLowerCase().includes(term) ||
        d.vehicleNumber.toLowerCase().includes(term),
    );
  }, [dispatches, searchTerm]);

  const openDispatchModal = (order: SalesOrder) => {
    const lines = orderItemsByOrderId.get(order.id) ?? [];
    setSelectedOrder(order);
    setFormDispatchNumber(nextDispatchNumber(dispatches));
    setFormDispatchDate(todayIso());
    setFormVehicleNumber('');
    setFormDriverName('');
    setFormTransporter('');
    setFormEwayBill('');
    setFormNotes('');
    setFormConfirmPartial(false);
    setFormLines(
      lines.map((line) => ({
        salesOrderItemId: line.id,
        dispatchQuantity: String(roundQuantity(Math.max(0, line.quantity - line.dispatchedQuantity))),
      })),
    );
    setFormError(null);
  };

  const modalPreview = useMemo(() => {
    if (!selectedOrder) {
      return { rows: [], hasShortage: false, isPartial: false };
    }
    const lines = orderItemsByOrderId.get(selectedOrder.id) ?? [];
    const draftMap = new Map(formLines.map((l) => [l.salesOrderItemId, l.dispatchQuantity]));

    let hasShortage = false;
    let isPartial = false;

    const rows = lines.map((line) => {
      const remaining = roundQuantity(Math.max(0, line.quantity - line.dispatchedQuantity));
      const available = fgStockByProductId.get(line.productId) ?? 0;
      const requestedRaw = Number(draftMap.get(line.id) ?? '0');
      const requested = Number.isFinite(requestedRaw) ? roundQuantity(Math.max(0, requestedRaw)) : 0;
      const shortage = roundQuantity(Math.max(0, requested - available));
      if (shortage > 0) hasShortage = true;
      if (requested < remaining) isPartial = true;
      return {
        line,
        remaining,
        available,
        requested,
        shortage,
      };
    });

    return { rows, hasShortage, isPartial };
  }, [selectedOrder, orderItemsByOrderId, formLines, fgStockByProductId]);

  const handleConfirmDispatch = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!firebaseUser || !userProfile || !selectedOrder || !canExecuteDispatch) return;

    const currentLines = orderItemsByOrderId.get(selectedOrder.id) ?? [];
    const check = validateDispatchInput(
      {
        dispatchNumber: formDispatchNumber,
        dispatchDate: formDispatchDate,
        vehicleNumber: formVehicleNumber,
        driverName: formDriverName,
        transporterName: formTransporter,
        ewayBillNumber: formEwayBill,
        notes: formNotes,
        confirmPartialAuthorization: formConfirmPartial,
        lines: formLines,
      },
      selectedOrder,
      currentLines,
      stockBalances,
      canAuthorizePartial,
    );

    if (!check.valid) {
      setFormError(check.error);
      return;
    }

    const dupDispatch = dispatches.find(
      (d) => d.dispatchNumber === check.sanitized.dispatchNumber,
    );
    if (dupDispatch) {
      setFormError(`Dispatch number "${check.sanitized.dispatchNumber}" already exists.`);
      return;
    }

    setSaving(true);
    setFormError(null);

    try {
      const clean = check.sanitized;

      await runTransaction(db, async (tx) => {
        const orderRef = doc(db, 'salesOrders', selectedOrder.id);
        const orderSnap = await tx.get(orderRef);
        if (!orderSnap.exists()) {
          throw new Error('Selected sales order no longer exists.');
        }
        const freshOrder = orderSnap.data() as SalesOrder;
        if (freshOrder.status !== 'Approved' && freshOrder.status !== 'Partially Dispatched') {
          throw new Error(`Order ${freshOrder.orderNumber} is "${freshOrder.status}" and cannot be dispatched.`);
        }

        // Read all targeted salesOrderItems and unique finished_goods stockBalances BEFORE writes
        const orderItemSnaps = await Promise.all(
          clean.lines.map((line) => tx.get(doc(db, 'salesOrderItems', line.salesOrderItemId))),
        );

        const productDeductions = new Map<
          string,
          { qty: number; productName: string; productSku: string }
        >();
        clean.lines.forEach((line) => {
          const prev = productDeductions.get(line.productId);
          productDeductions.set(line.productId, {
            qty: roundQuantity((prev?.qty ?? 0) + line.requestedDispatch),
            productName: line.productName,
            productSku: line.productSku,
          });
        });

        const uniqueProductIds = Array.from(productDeductions.keys());
        const fgSnaps = await Promise.all(
          uniqueProductIds.map((pid) => tx.get(doc(db, 'stockBalances', `fg_${pid}`))),
        );

        // Validate line remaining quantities
        orderItemSnaps.forEach((snap, idx) => {
          if (!snap.exists()) {
            throw new Error(`Sales order line item ${clean.lines[idx].productName} not found.`);
          }
          const item = snap.data() as SalesOrderItem;
          const remaining = roundQuantity(Math.max(0, item.quantity - item.dispatchedQuantity));
          if (clean.lines[idx].requestedDispatch > remaining + 0.0001) {
            throw new Error(
              `${item.productName}: Requested dispatch (${clean.lines[idx].requestedDispatch}) exceeds remaining (${remaining}).`,
            );
          }
        });

        // Validate finished goods stock balances strictly inside transaction
        const fgStates = new Map<string, StockBalance>();
        fgSnaps.forEach((snap, idx) => {
          const pid = uniqueProductIds[idx];
          const ded = productDeductions.get(pid)!;
          if (!snap.exists()) {
            throw new Error(
              `Insufficient finished goods stock for ${ded.productName} (${ded.productSku}): available 0, short by ${ded.qty} pkts.`,
            );
          }
          const bal = snap.data() as StockBalance;
          if (roundQuantity(bal.currentBalance) + 0.0001 < ded.qty) {
            const shortage = roundQuantity(ded.qty - bal.currentBalance);
            throw new Error(
              `Insufficient finished goods stock for ${ded.productName} (${ded.productSku}): available ${bal.currentBalance}, requested ${ded.qty}, short by ${shortage} pkts.`,
            );
          }
          fgStates.set(pid, bal);
        });

        const freshTotalDispatched = roundQuantity(
          freshOrder.totalDispatchedQty + clean.totalDispatchedQty,
        );
        const nextStatus: 'Partially Dispatched' | 'Dispatched' =
          freshTotalDispatched + 0.0001 >= freshOrder.totalOrderedQty
            ? 'Dispatched'
            : 'Partially Dispatched';
        const isPartialTx = nextStatus === 'Partially Dispatched';

        if (isPartialTx && !canAuthorizePartial) {
          throw new Error('Partial dispatch requires Owner or Admin authorization.');
        }

        // Perform ALL writes after reads
        uniqueProductIds.forEach((pid) => {
          const ded = productDeductions.get(pid)!;
          const bal = fgStates.get(pid)!;
          const newBalance = roundQuantity(bal.currentBalance - ded.qty);
          const fgRef = doc(db, 'stockBalances', `fg_${pid}`);
          tx.update(fgRef, {
            dispatchedThroughSales: roundQuantity(bal.dispatchedThroughSales + ded.qty),
            currentBalance: newBalance,
            updatedBy: firebaseUser.uid,
            updatedByName: userProfile.displayName,
            updatedAt: serverTimestamp(),
          });

          const ledgerRef = doc(collection(db, 'inventoryLedger'));
          tx.set(ledgerRef, {
            id: ledgerRef.id,
            orgId: ORG_ID,
            transactionDate: clean.dispatchDate,
            itemId: pid,
            itemCode: bal.itemCode,
            itemName: bal.itemName,
            stockCategory: 'finished_goods',
            unit: 'packets',
            transactionType: 'Sales Dispatch',
            quantityIn: 0,
            quantityOut: ded.qty,
            balance: newBalance,
            referenceDoc: clean.dispatchNumber,
            reason: `Dispatched against ${freshOrder.orderNumber} (${freshOrder.customerName})`.slice(
              0,
              300,
            ),
            userUid: firebaseUser.uid,
            userName: userProfile.displayName,
            createdAt: serverTimestamp(),
          });
        });

        orderItemSnaps.forEach((snap, idx) => {
          const item = snap.data() as SalesOrderItem;
          const line = clean.lines[idx];
          tx.update(doc(db, 'salesOrderItems', item.id), {
            dispatchedQuantity: roundQuantity(item.dispatchedQuantity + line.requestedDispatch),
            updatedAt: serverTimestamp(),
          });
        });

        tx.update(orderRef, {
          status: nextStatus,
          totalDispatchedQty:
            nextStatus === 'Dispatched' ? freshOrder.totalOrderedQty : freshTotalDispatched,
          updatedAt: serverTimestamp(),
        });

        const dispatchRef = doc(collection(db, 'dispatches'));
        tx.set(dispatchRef, {
          id: dispatchRef.id,
          orgId: ORG_ID,
          dispatchNumber: clean.dispatchNumber,
          salesOrderId: freshOrder.id,
          orderNumber: freshOrder.orderNumber,
          salesmanUid: freshOrder.salesmanUid,
          salesmanName: freshOrder.salesmanName,
          customerId: freshOrder.customerId,
          customerName: freshOrder.customerName,
          customerAddress: freshOrder.customerAddress,
          dispatchDate: clean.dispatchDate,
          vehicleNumber: clean.vehicleNumber,
          driverName: clean.driverName,
          transporterName: clean.transporterName,
          ewayBillNumber: clean.ewayBillNumber,
          notes: clean.notes,
          isPartial: clean.isPartial,
          partialAuthorizedBy: clean.isPartial ? firebaseUser.uid : '',
          partialAuthorizedByName: clean.isPartial ? userProfile.displayName : '',
          itemCount: clean.lines.length,
          totalDispatchedQty: clean.totalDispatchedQty,
          dispatchedBy: firebaseUser.uid,
          dispatchedByName: userProfile.displayName,
          createdAt: serverTimestamp(),
        });

        clean.lines.forEach((line) => {
          const dItemRef = doc(collection(db, 'dispatchItems'));
          tx.set(dItemRef, {
            id: dItemRef.id,
            orgId: ORG_ID,
            dispatchId: dispatchRef.id,
            salesOrderId: freshOrder.id,
            salesOrderItemId: line.salesOrderItemId,
            salesmanUid: freshOrder.salesmanUid,
            productId: line.productId,
            productName: line.productName,
            productSku: line.productSku,
            packetSize: line.packetSize,
            orderedQuantity: line.orderedQuantity,
            dispatchedQuantity: line.requestedDispatch,
            createdBy: firebaseUser.uid,
            createdAt: serverTimestamp(),
          });
        });
      });

      setSelectedOrder(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Dispatch transaction failed.';
      if (msg.toLowerCase().includes('permission')) {
        handleFirestoreError(err, OperationType.CREATE, 'dispatches');
      }
      setFormError(msg);
    } finally {
      setSaving(false);
    }
  };

  const viewingItems = viewingDispatch
    ? dispatchItemsByDispatchId.get(viewingDispatch.id) ?? []
    : [];

  return (
    <div className="space-y-6">
      <div className={viewingDispatch ? 'no-print space-y-6' : 'space-y-6'}>
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-[#3B4F4E]">Sales &amp; Fulfillment</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#3B4F4E]">
              Dispatch Management
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Validate finished goods availability, block short shipments, record carrier details, and deduct stock atomically.
            </p>
          </div>

          <div className="text-xs text-slate-500">
            {canExecuteDispatch
              ? canAuthorizePartial
                ? 'Full & Partial Dispatch Authorized'
                : 'Full Dispatch Authorized (Partial requires Owner/Admin)'
              : `View-only for ${activeRole}`}
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white border border-[#DCE6E6] rounded-xl p-4">
            <p className="text-xs font-medium text-slate-500">Approved Orders Ready to Ship</p>
            <p className="mt-2 text-2xl font-semibold font-mono tabular-nums text-[#3B4F4E]">
              {approvedQueue.length}
            </p>
          </div>
          <div className="bg-white border border-[#DCE6E6] rounded-xl p-4">
            <p className="text-xs font-medium text-slate-500">Completed Dispatches</p>
            <p className="mt-2 text-2xl font-semibold font-mono tabular-nums text-[#3B4F4E]">
              {dispatches.length}
            </p>
          </div>
          <div className="bg-white border border-[#DCE6E6] rounded-xl p-4">
            <p className="text-xs font-medium text-slate-500">Total Packets Shipped</p>
            <p className="mt-2 text-2xl font-semibold font-mono tabular-nums text-emerald-700">
              {roundQuantity(dispatches.reduce((s, d) => s + d.totalDispatchedQty, 0))}
            </p>
          </div>
        </div>

        {loadError && (
          <div role="alert" className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3 text-sm text-red-800">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            <span>{loadError}</span>
          </div>
        )}

        {/* Approved Orders Ready for Dispatch */}
        <section className="bg-white border border-[#DCE6E6] rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-[#DCE6E6] flex items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-[#3B4F4E]">
                Approved Orders Pending Dispatch
              </h2>
              <p className="text-xs text-slate-500">
                Only orders approved by Owner/Admin can be dispatched. Unapproved orders are blocked.
              </p>
            </div>
            <span className="text-xs font-mono text-slate-500">{approvedQueue.length} ready</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#DCE6E6] bg-slate-50/70">
                  <th className="px-5 py-3 text-xs font-semibold text-slate-600">Order No.</th>
                  <th className="px-5 py-3 text-xs font-semibold text-slate-600">Customer</th>
                  <th className="px-5 py-3 text-xs font-semibold text-slate-600">Delivery Date</th>
                  <th className="px-5 py-3 text-xs font-semibold text-slate-600 text-right">Remaining</th>
                  <th className="px-5 py-3 text-xs font-semibold text-slate-600">Stock Readiness</th>
                  <th className="px-5 py-3 text-xs font-semibold text-slate-600 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {approvedQueue.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-8 text-center text-sm text-slate-500">
                      No approved sales orders waiting for dispatch.
                    </td>
                  </tr>
                ) : (
                  approvedQueue.map((order) => {
                    const lines = orderItemsByOrderId.get(order.id) ?? [];
                    const remainingTotal = roundQuantity(
                      Math.max(0, order.totalOrderedQty - order.totalDispatchedQty),
                    );
                    const totalShortage = lines.reduce((sum, l) => {
                      const rem = Math.max(0, l.quantity - l.dispatchedQuantity);
                      const avail = fgStockByProductId.get(l.productId) ?? 0;
                      return sum + Math.max(0, rem - avail);
                    }, 0);

                    return (
                      <tr key={order.id} className="hover:bg-slate-50/70">
                        <td className="px-5 py-3.5 whitespace-nowrap">
                          <p className="font-mono text-xs font-semibold text-[#3B4F4E]">
                            {order.orderNumber}
                          </p>
                          <p className="text-[11px] text-slate-500">{order.status}</p>
                        </td>
                        <td className="px-5 py-3.5">
                          <p className="text-sm font-medium text-[#3B4F4E]">{order.customerName}</p>
                          <p className="text-xs text-slate-500 truncate max-w-[260px]">
                            {order.customerAddress}
                          </p>
                        </td>
                        <td className="px-5 py-3.5 font-mono text-xs text-slate-700 whitespace-nowrap">
                          {order.expectedDeliveryDate}
                        </td>
                        <td className="px-5 py-3.5 font-mono text-xs text-[#3B4F4E] text-right tabular-nums whitespace-nowrap">
                          {remainingTotal} / {order.totalOrderedQty} pkts
                        </td>
                        <td className="px-5 py-3.5 whitespace-nowrap">
                          {totalShortage > 0 ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-medium rounded-md border bg-red-50 text-red-700 border-red-200">
                              <ShieldAlert className="w-3.5 h-3.5" />
                              Short by {roundQuantity(totalShortage)} pkts
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-medium rounded-md border bg-emerald-50 text-emerald-700 border-emerald-200">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Stock Available
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3.5 text-right whitespace-nowrap">
                          {canExecuteDispatch ? (
                            <button
                              type="button"
                              onClick={() => openDispatchModal(order)}
                              className="min-h-[34px] inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#CF9C2D] hover:bg-[#BC8B22] rounded-md transition-colors"
                            >
                              <Truck className="w-3.5 h-3.5" />
                              Create Dispatch
                            </button>
                          ) : (
                            <span className="text-xs text-slate-400">Authorized staff only</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Dispatch History */}
        <section className="bg-white border border-[#DCE6E6] rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-[#DCE6E6] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <h2 className="text-base font-semibold text-[#3B4F4E]">Dispatch History</h2>
            <div className="relative w-full sm:max-w-xs">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search dispatch, order, vehicle..."
                aria-label="Search dispatch history"
                className="w-full h-9 pl-9 pr-3 text-sm text-[#3B4F4E] bg-slate-50 border border-[#DCE6E6] rounded-lg focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#CF9C2D]"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#DCE6E6] bg-slate-50/70">
                  <th className="px-5 py-3 text-xs font-semibold text-slate-600">Dispatch No.</th>
                  <th className="px-5 py-3 text-xs font-semibold text-slate-600">Order Ref</th>
                  <th className="px-5 py-3 text-xs font-semibold text-slate-600">Customer</th>
                  <th className="px-5 py-3 text-xs font-semibold text-slate-600">Vehicle / Driver</th>
                  <th className="px-5 py-3 text-xs font-semibold text-slate-600 text-right">Dispatched Qty</th>
                  <th className="px-5 py-3 text-xs font-semibold text-slate-600">Date</th>
                  <th className="px-5 py-3 text-xs font-semibold text-slate-600 text-right">Document</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-10 text-center text-sm text-slate-500">
                      Loading dispatch records...
                    </td>
                  </tr>
                ) : filteredDispatches.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-12 text-center text-sm text-slate-500">
                      {dispatches.length === 0
                        ? 'No shipments dispatched yet.'
                        : 'No dispatches match your search filter.'}
                    </td>
                  </tr>
                ) : (
                  filteredDispatches.map((d) => (
                    <tr key={d.id} className="hover:bg-slate-50/70">
                      <td className="px-5 py-3.5 whitespace-nowrap">
                        <p className="font-mono text-xs font-semibold text-[#3B4F4E]">
                          {d.dispatchNumber}
                        </p>
                        {d.isPartial && (
                          <span className="text-[11px] font-medium text-indigo-700">
                            Partial Dispatch
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 font-mono text-xs text-slate-700 whitespace-nowrap">
                        {d.orderNumber}
                      </td>
                      <td className="px-5 py-3.5 text-sm text-[#3B4F4E]">{d.customerName}</td>
                      <td className="px-5 py-3.5 text-xs text-slate-700 whitespace-nowrap">
                        <p className="font-mono font-medium">{d.vehicleNumber}</p>
                        <p className="text-[11px] text-slate-500">{d.driverName}</p>
                      </td>
                      <td className="px-5 py-3.5 font-mono text-xs text-[#3B4F4E] text-right tabular-nums whitespace-nowrap">
                        {d.totalDispatchedQty} pkts
                      </td>
                      <td className="px-5 py-3.5 font-mono text-xs text-slate-600 whitespace-nowrap">
                        {d.dispatchDate}
                      </td>
                      <td className="px-5 py-3.5 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setViewingDispatch(d)}
                          className="min-h-[32px] inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-[#3B4F4E] bg-[#EEF3F3] hover:bg-[#E5EDED] rounded-md transition-colors"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          Challan / PDF
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* Create Dispatch Modal */}
      {selectedOrder && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="dispatch-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/50 overflow-y-auto no-print"
        >
          <div className="w-full max-w-4xl bg-white border border-[#DCE6E6] rounded-xl overflow-hidden my-8">
            <div className="px-6 py-4 border-b border-[#DCE6E6] flex items-center justify-between">
              <div>
                <h2 id="dispatch-modal-title" className="text-base font-semibold text-[#3B4F4E]">
                  Dispatch Stock for {selectedOrder.orderNumber}
                </h2>
                <p className="text-xs text-slate-500">
                  {selectedOrder.customerName} · {selectedOrder.customerAddress}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedOrder(null)}
                aria-label="Close dispatch modal"
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleConfirmDispatch} className="p-6 space-y-5 max-h-[82vh] overflow-y-auto">
              {formError && (
                <div role="alert" className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label htmlFor="dsp-num" className="block text-xs font-medium text-slate-700 mb-1">
                    Dispatch Number *
                  </label>
                  <input
                    id="dsp-num"
                    type="text"
                    value={formDispatchNumber}
                    onChange={(e) => setFormDispatchNumber(e.target.value.toUpperCase())}
                    className="w-full h-9 px-3 font-mono text-sm border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                  />
                </div>
                <div>
                  <label htmlFor="dsp-date" className="block text-xs font-medium text-slate-700 mb-1">
                    Dispatch Date *
                  </label>
                  <input
                    id="dsp-date"
                    type="date"
                    value={formDispatchDate}
                    onChange={(e) => setFormDispatchDate(e.target.value)}
                    className="w-full h-9 px-3 font-mono text-sm border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                  />
                </div>
                <div>
                  <label htmlFor="dsp-veh" className="block text-xs font-medium text-slate-700 mb-1">
                    Vehicle Number *
                  </label>
                  <input
                    id="dsp-veh"
                    type="text"
                    placeholder="e.g. TN-38-AB-4521"
                    value={formVehicleNumber}
                    onChange={(e) => setFormVehicleNumber(e.target.value.toUpperCase())}
                    className="w-full h-9 px-3 font-mono text-sm border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                  />
                </div>
                <div>
                  <label htmlFor="dsp-drv" className="block text-xs font-medium text-slate-700 mb-1">
                    Driver Name *
                  </label>
                  <input
                    id="dsp-drv"
                    type="text"
                    value={formDriverName}
                    onChange={(e) => setFormDriverName(e.target.value)}
                    className="w-full h-9 px-3 text-sm border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                  />
                </div>
                <div>
                  <label htmlFor="dsp-tr" className="block text-xs font-medium text-slate-700 mb-1">
                    Transporter / Logistics
                  </label>
                  <input
                    id="dsp-tr"
                    type="text"
                    placeholder="Optional carrier name"
                    value={formTransporter}
                    onChange={(e) => setFormTransporter(e.target.value)}
                    className="w-full h-9 px-3 text-sm border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                  />
                </div>
                <div>
                  <label htmlFor="dsp-ewb" className="block text-xs font-medium text-slate-700 mb-1">
                    E-Way Bill No.
                  </label>
                  <input
                    id="dsp-ewb"
                    type="text"
                    placeholder="Optional"
                    value={formEwayBill}
                    onChange={(e) => setFormEwayBill(e.target.value.toUpperCase())}
                    className="w-full h-9 px-3 font-mono text-sm border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                  />
                </div>
              </div>

              {/* FG Stock Check Table */}
              <div className="border border-[#DCE6E6] rounded-lg overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-[#DCE6E6] text-[11px] font-semibold text-slate-600">
                      <th className="px-3 py-2">Finished Product</th>
                      <th className="px-3 py-2 text-right">Ordered</th>
                      <th className="px-3 py-2 text-right">Shipped</th>
                      <th className="px-3 py-2 text-right">Remaining</th>
                      <th className="px-3 py-2 text-right">Available FG</th>
                      <th className="px-3 py-2 w-32 text-right">Dispatch Now</th>
                      <th className="px-3 py-2 text-right">Shortage</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-xs">
                    {modalPreview.rows.map(({ line, remaining, available, shortage }) => {
                      const draftVal =
                        formLines.find((l) => l.salesOrderItemId === line.id)?.dispatchQuantity ?? '0';
                      return (
                        <tr key={line.id}>
                          <td className="px-3 py-2.5">
                            <p className="font-medium text-[#3B4F4E]">{line.productName}</p>
                            <p className="font-mono text-[11px] text-slate-500">
                              {line.productSku} · {line.packetSize}
                            </p>
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono">{line.quantity}</td>
                          <td className="px-3 py-2.5 text-right font-mono">{line.dispatchedQuantity}</td>
                          <td className="px-3 py-2.5 text-right font-mono font-semibold">{remaining}</td>
                          <td
                            className={`px-3 py-2.5 text-right font-mono font-semibold ${
                              available < remaining ? 'text-amber-700' : 'text-emerald-700'
                            }`}
                          >
                            {available}
                          </td>
                          <td className="px-3 py-2.5">
                            <input
                              type="number"
                              min="0"
                              max={remaining}
                              step="1"
                              value={draftVal}
                              onChange={(e) => {
                                const val = e.target.value;
                                setFormLines((prev) =>
                                  prev.map((row) =>
                                    row.salesOrderItemId === line.id
                                      ? { ...row, dispatchQuantity: val }
                                      : row,
                                  ),
                                );
                              }}
                              className="w-full h-8 px-2 font-mono text-xs text-right border border-[#DCE6E6] rounded-md"
                            />
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono">
                            {shortage > 0 ? (
                              <span className="text-red-700 font-semibold">-{shortage}</span>
                            ) : (
                              <span className="text-slate-400">0</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {modalPreview.hasShortage && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800 flex items-start gap-2">
                  <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
                  <span>
                    Dispatch is blocked while any requested quantity exceeds available Finished Goods stock. Complete a Production batch or lower the dispatch quantity (with Partial Dispatch authorization).
                  </span>
                </div>
              )}

              {modalPreview.isPartial && (
                <div className="p-3.5 rounded-lg bg-indigo-50 border border-indigo-200 space-y-2">
                  <p className="text-xs font-semibold text-indigo-900">
                    Partial Dispatch Detected
                  </p>
                  {canAuthorizePartial ? (
                    <label className="flex items-center gap-2 text-xs text-indigo-900 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formConfirmPartial}
                        onChange={(e) => setFormConfirmPartial(e.target.checked)}
                        className="rounded border-indigo-300 text-[#3B4F4E] focus:ring-[#CF9C2D]"
                      />
                      <span>
                        Authorize Partial Dispatch as {activeRole} (Order will move to &ldquo;Partially Dispatched&rdquo;)
                      </span>
                    </label>
                  ) : (
                    <p className="text-xs text-red-700">
                      Only an Owner or Admin can authorize partial dispatches. Ship the full remaining quantity or escalate to management.
                    </p>
                  )}
                </div>
              )}

              <div>
                <label htmlFor="dsp-notes" className="block text-xs font-medium text-slate-700 mb-1">
                  Dispatch Notes
                </label>
                <input
                  id="dsp-notes"
                  type="text"
                  maxLength={500}
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  placeholder="Seal numbers, loading bay, carrier instructions..."
                  className="w-full h-9 px-3 text-sm border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                />
              </div>

              <div className="pt-4 border-t border-[#DCE6E6] flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setSelectedOrder(null)}
                  className="min-h-[38px] px-4 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-[#DCE6E6] rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || modalPreview.hasShortage}
                  className="min-h-[38px] inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-[#CF9C2D] hover:bg-[#BC8B22] disabled:opacity-60 rounded-lg"
                >
                  <Truck className="w-3.5 h-3.5" />
                  {saving ? 'Posting Dispatch & Stock...' : 'Confirm Dispatch & Deduct FG Stock'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delivery Challan Print / PDF Modal */}
      {viewingDispatch && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/50 overflow-y-auto print:static print:bg-white print:p-0"
        >
          <div className="w-full max-w-3xl bg-white border border-[#DCE6E6] rounded-xl overflow-hidden my-8 print-only-sheet">
            <div className="px-6 py-4 border-b border-[#DCE6E6] flex items-center justify-between no-print">
              <h2 className="text-base font-semibold text-[#3B4F4E]">
                Delivery Challan {viewingDispatch.dispatchNumber}
              </h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => downloadDispatchNotePdf(viewingDispatch, viewingItems)}
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
                  Print
                </button>
                <button
                  type="button"
                  onClick={() => setViewingDispatch(null)}
                  aria-label="Close delivery challan"
                  className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="p-6 space-y-5">
              <div className="bg-[#0B162C] text-white rounded-lg p-5 flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-wider text-blue-300">SnackFactory ERP</p>
                  <h3 className="text-lg font-semibold mt-0.5">DISPATCH DELIVERY CHALLAN</h3>
                  <p className="text-xs text-slate-300 mt-1">
                    {viewingDispatch.isPartial
                      ? `Partial Dispatch · Authorized by ${viewingDispatch.partialAuthorizedByName || 'Manager'}`
                      : 'Full Order Dispatch'}
                  </p>
                </div>
                <div className="text-right font-mono">
                  <p className="text-sm font-semibold">{viewingDispatch.dispatchNumber}</p>
                  <p className="text-xs text-slate-300 mt-1">Date: {viewingDispatch.dispatchDate}</p>
                  <p className="text-xs text-slate-300">Order: {viewingDispatch.orderNumber}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs border border-[#DCE6E6] rounded-lg p-4">
                <div>
                  <p className="text-slate-500 font-medium">Deliver To</p>
                  <p className="font-semibold text-[#3B4F4E] text-sm mt-1">
                    {viewingDispatch.customerName}
                  </p>
                  <p className="text-slate-600 mt-0.5">{viewingDispatch.customerAddress}</p>
                </div>
                <div className="space-y-1">
                  <p>
                    <span className="text-slate-500">Vehicle:</span>{' '}
                    <span className="font-mono font-medium">{viewingDispatch.vehicleNumber}</span>
                  </p>
                  <p>
                    <span className="text-slate-500">Driver:</span> {viewingDispatch.driverName}
                  </p>
                  <p>
                    <span className="text-slate-500">Transporter:</span>{' '}
                    {viewingDispatch.transporterName || 'Direct Factory Fleet'}
                  </p>
                  <p>
                    <span className="text-slate-500">E-Way Bill:</span>{' '}
                    <span className="font-mono">{viewingDispatch.ewayBillNumber || 'N/A'}</span>
                  </p>
                </div>
              </div>

              <div className="border border-[#DCE6E6] rounded-lg overflow-hidden">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-[#DCE6E6] text-xs font-semibold text-slate-600">
                      <th className="px-4 py-2.5">SKU</th>
                      <th className="px-4 py-2.5">Product</th>
                      <th className="px-4 py-2.5">Pack Size</th>
                      <th className="px-4 py-2.5 text-right">Ordered</th>
                      <th className="px-4 py-2.5 text-right">Dispatched Qty</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-xs">
                    {viewingItems.map((item) => (
                      <tr key={item.id}>
                        <td className="px-4 py-2.5 font-mono text-slate-600">{item.productSku}</td>
                        <td className="px-4 py-2.5 font-medium text-[#3B4F4E]">{item.productName}</td>
                        <td className="px-4 py-2.5 text-slate-600">{item.packetSize}</td>
                        <td className="px-4 py-2.5 text-right font-mono">{item.orderedQuantity}</td>
                        <td className="px-4 py-2.5 text-right font-mono font-semibold text-[#3B4F4E]">
                          {item.dispatchedQuantity} pkts
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between text-xs text-slate-600 pt-2">
                <span>Dispatched By: {viewingDispatch.dispatchedByName}</span>
                <span className="font-mono font-semibold text-sm text-[#3B4F4E]">
                  Total Shipped: {viewingDispatch.totalDispatchedQty} packets
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
