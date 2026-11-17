import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ClipboardList,
  Edit3,
  Eye,
  PackageCheck,
  Plus,
  Search,
  ShoppingCart,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import {
  collection,
  doc,
  onSnapshot,
  query,
  runTransaction,
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
  roundCurrency,
  roundQuantity,
  validatePurchaseInput,
  type PurchaseLineDraft,
} from '../lib/validation';
import {
  GST_RATES,
  ORG_ID,
  PAYMENT_STATUSES,
  PURCHASE_RECEIPT_STATUSES,
  type PaymentStatus,
  type Purchase,
  type PurchaseItem,
  type PurchaseReceiptStatus,
  type RawMaterial,
  type StockBalance,
  type Supplier,
} from '../types/erp';

type ReceiptFilter = 'All' | PurchaseReceiptStatus;
type PaymentFilter = 'All' | PaymentStatus;

function getTodayIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function generateDefaultPoNumber(existingCount: number): string {
  const year = new Date().getFullYear();
  return `PO-${year}-${String(existingCount + 1).padStart(4, '0')}`;
}

export function PurchasesPage() {
  const { firebaseUser, userProfile, effectiveRole } = useAuth();
  const activeRole = effectiveRole ?? userProfile?.role ?? 'Salesman';
  const canManage =
    activeRole === 'Owner' ||
    activeRole === 'Admin' ||
    activeRole === 'Production Supervisor';
  const canDelete = activeRole === 'Owner' || activeRole === 'Admin';

  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [purchaseItems, setPurchaseItems] = useState<PurchaseItem[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [materials, setMaterials] = useState<RawMaterial[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [receiptFilter, setReceiptFilter] = useState<ReceiptFilter>('All');
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>('All');

  // Create / Edit Ordered Purchase Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingPurchase, setEditingPurchase] = useState<Purchase | null>(null);
  const [poNumber, setPoNumber] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(getTodayIso());
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>('Unpaid');
  const [notes, setNotes] = useState('');
  const [lineItems, setLineItems] = useState<PurchaseLineDraft[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Detail / History Modal
  const [viewingPurchase, setViewingPurchase] = useState<Purchase | null>(null);
  const [detailPaymentStatus, setDetailPaymentStatus] = useState<PaymentStatus>('Unpaid');
  const [detailInvoiceNumber, setDetailInvoiceNumber] = useState('');
  const [detailNotes, setDetailNotes] = useState('');
  const [detailSaving, setDetailSaving] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Receive Goods Modal
  const [receivingPurchase, setReceivingPurchase] = useState<Purchase | null>(null);
  const [receiveInvoiceNumber, setReceiveInvoiceNumber] = useState('');
  const [receivePaymentStatus, setReceivePaymentStatus] = useState<PaymentStatus>('Unpaid');
  const [receiveNotes, setReceiveNotes] = useState('');
  const [receiving, setReceiving] = useState(false);
  const [receiveError, setReceiveError] = useState<string | null>(null);

  // Delete Confirmation Modal
  const [deletingPurchase, setDeletingPurchase] = useState<Purchase | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!firebaseUser) return;
    setLoading(true);
    setLoadError(null);

    let loadedPurchases = false;
    let loadedItems = false;
    const finishIfReady = () => {
      if (loadedPurchases && loadedItems) {
        setLoading(false);
      }
    };

    const unsubPurchases = onSnapshot(
      query(collection(db, 'purchases'), where('orgId', '==', ORG_ID)),
      (snap) => {
        const rows = snap.docs.map((d) => d.data() as Purchase);
        rows.sort((a, b) => {
          const dateCmp = b.purchaseDate.localeCompare(a.purchaseDate);
          if (dateCmp !== 0) return dateCmp;
          return b.poNumber.localeCompare(a.poNumber);
        });
        setPurchases(rows);
        loadedPurchases = true;
        finishIfReady();
      },
      (error) => {
        setLoading(false);
        setLoadError('Unable to load purchase orders from Cloud Firestore.');
        handleFirestoreError(error, OperationType.LIST, 'purchases');
      },
    );

    const unsubItems = onSnapshot(
      query(collection(db, 'purchaseItems'), where('orgId', '==', ORG_ID)),
      (snap) => {
        setPurchaseItems(snap.docs.map((d) => d.data() as PurchaseItem));
        loadedItems = true;
        finishIfReady();
      },
      (error) => {
        setLoading(false);
        setLoadError('Unable to load purchase items from Cloud Firestore.');
        handleFirestoreError(error, OperationType.LIST, 'purchaseItems');
      },
    );

    const unsubSuppliers = onSnapshot(
      query(collection(db, 'suppliers'), where('orgId', '==', ORG_ID)),
      (snap) => {
        const rows = snap.docs.map((d) => d.data() as Supplier);
        rows.sort((a, b) => a.name.localeCompare(b.name));
        setSuppliers(rows);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'suppliers');
      },
    );

    const unsubMaterials = onSnapshot(
      query(collection(db, 'rawMaterials'), where('orgId', '==', ORG_ID)),
      (snap) => {
        const rows = snap.docs.map((d) => d.data() as RawMaterial);
        rows.sort((a, b) => a.name.localeCompare(b.name));
        setMaterials(rows);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'rawMaterials');
      },
    );

    return () => {
      unsubPurchases();
      unsubItems();
      unsubSuppliers();
      unsubMaterials();
    };
  }, [firebaseUser]);

  const itemsByPurchaseId = useMemo(() => {
    const map = new Map<string, PurchaseItem[]>();
    purchaseItems.forEach((item) => {
      const existing = map.get(item.purchaseId);
      if (existing) {
        existing.push(item);
      } else {
        map.set(item.purchaseId, [item]);
      }
    });
    return map;
  }, [purchaseItems]);

  const materialMap = useMemo(
    () => new Map(materials.map((m) => [m.id, m])),
    [materials],
  );

  const summary = useMemo(() => {
    let orderedCount = 0;
    let receivedCount = 0;
    let unpaidAmount = 0;
    let totalSpend = 0;
    purchases.forEach((p) => {
      if (p.receiptStatus === 'Ordered') orderedCount += 1;
      if (p.receiptStatus === 'Received') receivedCount += 1;
      if (p.receiptStatus !== 'Cancelled') {
        totalSpend += p.grandTotal;
        if (p.paymentStatus !== 'Paid') {
          unpaidAmount += p.grandTotal;
        }
      }
    });
    return {
      totalCount: purchases.length,
      orderedCount,
      receivedCount,
      unpaidAmount: roundCurrency(unpaidAmount),
      totalSpend: roundCurrency(totalSpend),
    };
  }, [purchases]);

  const filteredPurchases = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return purchases.filter((p) => {
      const matchesReceipt = receiptFilter === 'All' || p.receiptStatus === receiptFilter;
      const matchesPayment = paymentFilter === 'All' || p.paymentStatus === paymentFilter;
      const matchesSearch =
        !term ||
        p.poNumber.toLowerCase().includes(term) ||
        p.supplierName.toLowerCase().includes(term) ||
        p.invoiceNumber.toLowerCase().includes(term) ||
        p.purchaseDate.includes(term);
      return matchesReceipt && matchesPayment && matchesSearch;
    });
  }, [purchases, searchTerm, receiptFilter, paymentFilter]);

  const liveTotals = useMemo(() => {
    let subtotal = 0;
    let gstTotal = 0;
    lineItems.forEach((row) => {
      const q = Number(row.quantity);
      const price = Number(row.unitPrice);
      const gst = Number(row.gstPercentage);
      if (Number.isFinite(q) && q > 0 && Number.isFinite(price) && price >= 0) {
        const lineSub = roundCurrency(roundQuantity(q) * roundCurrency(price));
        const lineGst =
          Number.isFinite(gst) && gst >= 0 && gst <= 28
            ? roundCurrency((lineSub * roundCurrency(gst)) / 100)
            : 0;
        subtotal += lineSub;
        gstTotal += lineGst;
      }
    });
    subtotal = roundCurrency(subtotal);
    gstTotal = roundCurrency(gstTotal);
    return {
      subtotal,
      gstTotal,
      grandTotal: roundCurrency(subtotal + gstTotal),
    };
  }, [lineItems]);

  const createEmptyLine = (defaultMaterial?: RawMaterial): PurchaseLineDraft => {
    const mat = defaultMaterial ?? materials[0];
    return {
      rawMaterialId: mat?.id ?? '',
      quantity: '1',
      unitPrice: mat ? String(mat.purchasePrice) : '0',
      gstPercentage: '5',
    };
  };

  const openCreateModal = () => {
    setEditingPurchase(null);
    setPoNumber(generateDefaultPoNumber(purchases.length));
    setSupplierId(suppliers[0]?.id ?? '');
    setPurchaseDate(getTodayIso());
    setInvoiceNumber('');
    setPaymentStatus('Unpaid');
    setNotes('');
    setLineItems(materials.length > 0 ? [createEmptyLine(materials[0])] : []);
    setFormError(null);
    setModalOpen(true);
  };

  const openEditModal = (purchase: Purchase) => {
    if (purchase.receiptStatus !== 'Ordered') {
      openDetailModal(purchase);
      return;
    }
    const items = itemsByPurchaseId.get(purchase.id) ?? [];
    setEditingPurchase(purchase);
    setPoNumber(purchase.poNumber);
    setSupplierId(purchase.supplierId);
    setPurchaseDate(purchase.purchaseDate);
    setInvoiceNumber(purchase.invoiceNumber);
    setPaymentStatus(purchase.paymentStatus);
    setNotes(purchase.notes);
    setLineItems(
      items.length > 0
        ? items.map((item) => ({
            rawMaterialId: item.rawMaterialId,
            quantity: String(item.quantity),
            unitPrice: String(item.unitPrice),
            gstPercentage: String(item.gstPercentage),
          }))
        : materials.length > 0
          ? [createEmptyLine(materials[0])]
          : [],
    );
    setFormError(null);
    setModalOpen(true);
  };

  const openDetailModal = (purchase: Purchase) => {
    setViewingPurchase(purchase);
    setDetailPaymentStatus(purchase.paymentStatus);
    setDetailInvoiceNumber(purchase.invoiceNumber);
    setDetailNotes(purchase.notes);
    setDetailError(null);
  };

  const openReceiveModal = (purchase: Purchase) => {
    setReceivingPurchase(purchase);
    setReceiveInvoiceNumber(purchase.invoiceNumber);
    setReceivePaymentStatus(purchase.paymentStatus);
    setReceiveNotes(purchase.notes);
    setReceiveError(null);
  };

  const handleMaterialChange = (index: number, rawMaterialId: string) => {
    const mat = materialMap.get(rawMaterialId);
    setLineItems((prev) =>
      prev.map((row, idx) =>
        idx === index
          ? {
              ...row,
              rawMaterialId,
              unitPrice: mat ? String(mat.purchasePrice) : row.unitPrice,
            }
          : row,
      ),
    );
  };

  const handleSavePurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !canManage) return;

    const validation = validatePurchaseInput(
      {
        poNumber,
        supplierId,
        purchaseDate,
        invoiceNumber,
        paymentStatus,
        notes,
        items: lineItems,
      },
      suppliers,
      materials,
    );

    if (!validation.valid) {
      setFormError(validation.error);
      return;
    }

    const duplicatePo = purchases.find(
      (p) => p.poNumber === validation.sanitized.poNumber && p.id !== editingPurchase?.id,
    );
    if (duplicatePo) {
      setFormError(`PO number "${validation.sanitized.poNumber}" already exists.`);
      return;
    }

    setSaving(true);
    setFormError(null);

    try {
      const batch = writeBatch(db);
      const { items: sanitizedItems, ...headerFields } = validation.sanitized;

      if (editingPurchase) {
        const purchaseRef = doc(db, 'purchases', editingPurchase.id);
        batch.update(purchaseRef, {
          ...headerFields,
          updatedAt: serverTimestamp(),
        });

        const existingItems = itemsByPurchaseId.get(editingPurchase.id) ?? [];
        existingItems.forEach((oldItem) => {
          batch.delete(doc(db, 'purchaseItems', oldItem.id));
        });

        sanitizedItems.forEach((item) => {
          const itemRef = doc(collection(db, 'purchaseItems'));
          batch.set(itemRef, {
            id: itemRef.id,
            orgId: ORG_ID,
            purchaseId: editingPurchase.id,
            ...item,
            createdBy: firebaseUser.uid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        });
      } else {
        const purchaseRef = doc(collection(db, 'purchases'));
        batch.set(purchaseRef, {
          id: purchaseRef.id,
          orgId: ORG_ID,
          ...headerFields,
          receiptStatus: 'Ordered',
          createdBy: firebaseUser.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        sanitizedItems.forEach((item) => {
          const itemRef = doc(collection(db, 'purchaseItems'));
          batch.set(itemRef, {
            id: itemRef.id,
            orgId: ORG_ID,
            purchaseId: purchaseRef.id,
            ...item,
            createdBy: firebaseUser.uid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        });
      }

      await batch.commit();
      setModalOpen(false);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.toLowerCase().includes('permission')) {
        handleFirestoreError(
          error,
          editingPurchase ? OperationType.UPDATE : OperationType.CREATE,
          editingPurchase ? `purchases/${editingPurchase.id}` : 'purchases',
        );
      }
      setFormError('Failed to save purchase order to Cloud Firestore. Please verify inputs and retry.');
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmReceive = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !canManage || !receivingPurchase) return;

    const cleanInvoice = receiveInvoiceNumber.trim().slice(0, 60);
    if (!cleanInvoice) {
      setReceiveError('Enter the supplier invoice or delivery challan number before receiving goods.');
      return;
    }

    const items = itemsByPurchaseId.get(receivingPurchase.id) ?? [];
    if (items.length === 0) {
      setReceiveError('Cannot receive a purchase with zero line items.');
      return;
    }

    setReceiving(true);
    setReceiveError(null);

    const operatorName = (userProfile?.displayName || 'ERP Operator').slice(
      0,
      BLUEPRINT_CONSTRAINTS.displayName.maxLength,
    );
    const todayIso = getTodayIso();

    try {
      await runTransaction(db, async (transaction) => {
        const purchaseRef = doc(db, 'purchases', receivingPurchase.id);
        const purchaseSnap = await transaction.get(purchaseRef);
        if (!purchaseSnap.exists()) {
          throw new Error('Purchase record no longer exists.');
        }
        const livePurchase = purchaseSnap.data() as Purchase;
        if (livePurchase.receiptStatus !== 'Ordered') {
          throw new Error(`This purchase is already marked as ${livePurchase.receiptStatus}.`);
        }

        // Group quantities per rawMaterialId in case the same material appears in multiple lines
        const qtyByMaterial = new Map<string, number>();
        items.forEach((item) => {
          qtyByMaterial.set(
            item.rawMaterialId,
            roundQuantity((qtyByMaterial.get(item.rawMaterialId) ?? 0) + item.quantity),
          );
        });

        const materialUpdates: Array<{
          matId: string;
          matRef: ReturnType<typeof doc>;
          balRef: ReturnType<typeof doc>;
          matData: RawMaterial;
          balExists: boolean;
          balData: StockBalance | null;
          addQty: number;
          newStock: number;
        }> = [];

        for (const [matId, addQty] of qtyByMaterial.entries()) {
          const matRef = doc(db, 'rawMaterials', matId);
          const balRef = doc(db, 'stockBalances', `rm_${matId}`);
          const [matSnap, balSnap] = await Promise.all([
            transaction.get(matRef),
            transaction.get(balRef),
          ]);
          if (!matSnap.exists()) {
            throw new Error(`Referenced raw material (${matId}) was removed.`);
          }
          const matData = matSnap.data() as RawMaterial;
          materialUpdates.push({
            matId,
            matRef,
            balRef,
            matData,
            balExists: balSnap.exists(),
            balData: balSnap.exists() ? (balSnap.data() as StockBalance) : null,
            addQty,
            newStock: roundQuantity(matData.currentStock + addQty),
          });
        }

        for (const update of materialUpdates) {
          transaction.update(update.matRef, {
            currentStock: update.newStock,
            updatedAt: serverTimestamp(),
          });

          if (update.balExists && update.balData) {
            transaction.update(update.balRef, {
              itemCode: update.matData.materialCode,
              itemName: update.matData.name,
              unit: update.matData.unit,
              receivedFromPurchases: roundQuantity(
                update.balData.receivedFromPurchases + update.addQty,
              ),
              currentBalance: update.newStock,
              minimumStockLevel: update.matData.minimumStockLevel,
              updatedBy: firebaseUser.uid,
              updatedByName: operatorName,
              updatedAt: serverTimestamp(),
            });
          } else {
            transaction.set(update.balRef, {
              id: update.balRef.id,
              orgId: ORG_ID,
              itemId: update.matId,
              itemCode: update.matData.materialCode,
              itemName: update.matData.name,
              stockCategory: 'raw_material',
              unit: update.matData.unit,
              openingStock: update.matData.openingStock,
              receivedFromPurchases: update.addQty,
              issuedToProduction: 0,
              receivedFromProduction: 0,
              dispatchedThroughSales: 0,
              adjustmentsNet: 0,
              currentBalance: update.newStock,
              minimumStockLevel: update.matData.minimumStockLevel,
              updatedBy: firebaseUser.uid,
              updatedByName: operatorName,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }

          const ledgerRef = doc(collection(db, 'inventoryLedger'));
          transaction.set(ledgerRef, {
            id: ledgerRef.id,
            orgId: ORG_ID,
            transactionDate: todayIso,
            itemId: update.matId,
            itemCode: update.matData.materialCode,
            itemName: update.matData.name,
            stockCategory: 'raw_material',
            unit: update.matData.unit,
            transactionType: 'Purchase Receipt',
            quantityIn: update.addQty,
            quantityOut: 0,
            balance: update.newStock,
            referenceDoc: livePurchase.poNumber,
            reason: `Purchase goods received from ${livePurchase.supplierName} (Inv: ${cleanInvoice})`.slice(
              0,
              300,
            ),
            userUid: firebaseUser.uid,
            userName: operatorName,
            createdAt: serverTimestamp(),
          });
        }

        transaction.update(purchaseRef, {
          receiptStatus: 'Received',
          receivedBy: firebaseUser.uid,
          receivedAt: serverTimestamp(),
          invoiceNumber: cleanInvoice,
          paymentStatus: receivePaymentStatus,
          notes: receiveNotes.trim().slice(0, BLUEPRINT_CONSTRAINTS.description.maxLength),
          updatedAt: serverTimestamp(),
        });
      });

      setReceivingPurchase(null);
      if (viewingPurchase?.id === receivingPurchase.id) {
        setViewingPurchase(null);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.toLowerCase().includes('permission')) {
        handleFirestoreError(error, OperationType.UPDATE, `purchases/${receivingPurchase.id}`);
      }
      setReceiveError(msg || 'Failed to receive purchase and update raw material inventory.');
    } finally {
      setReceiving(false);
    }
  };

  const handleUpdatePaymentAndInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !canManage || !viewingPurchase) return;

    setDetailSaving(true);
    setDetailError(null);

    try {
      await updateDoc(doc(db, 'purchases', viewingPurchase.id), {
        paymentStatus: detailPaymentStatus,
        invoiceNumber: detailInvoiceNumber.trim().slice(0, 60),
        notes: detailNotes.trim().slice(0, BLUEPRINT_CONSTRAINTS.description.maxLength),
        updatedAt: serverTimestamp(),
      });
      setViewingPurchase(null);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.toLowerCase().includes('permission')) {
        handleFirestoreError(error, OperationType.UPDATE, `purchases/${viewingPurchase.id}`);
      }
      setDetailError('Failed to update purchase payment or invoice details.');
    } finally {
      setDetailSaving(false);
    }
  };

  const handleCancelOrderedPurchase = async (purchase: Purchase) => {
    if (!firebaseUser || !canManage || purchase.receiptStatus !== 'Ordered') return;
    setDetailSaving(true);
    setDetailError(null);
    try {
      await updateDoc(doc(db, 'purchases', purchase.id), {
        receiptStatus: 'Cancelled',
        updatedAt: serverTimestamp(),
      });
      setViewingPurchase(null);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.toLowerCase().includes('permission')) {
        handleFirestoreError(error, OperationType.UPDATE, `purchases/${purchase.id}`);
      }
      setDetailError('Failed to cancel purchase order.');
    } finally {
      setDetailSaving(false);
    }
  };

  const handleDeletePurchase = async () => {
    if (!deletingPurchase || !canDelete || deletingPurchase.receiptStatus === 'Received') return;
    setDeleting(true);
    setDeleteError(null);

    try {
      const batch = writeBatch(db);
      const items = itemsByPurchaseId.get(deletingPurchase.id) ?? [];
      items.forEach((item) => {
        batch.delete(doc(db, 'purchaseItems', item.id));
      });
      batch.delete(doc(db, 'purchases', deletingPurchase.id));
      await batch.commit();
      setDeletingPurchase(null);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.toLowerCase().includes('permission')) {
        handleFirestoreError(error, OperationType.DELETE, `purchases/${deletingPurchase.id}`);
      }
      setDeleteError('Failed to delete purchase order from Cloud Firestore.');
    } finally {
      setDeleting(false);
    }
  };

  const prerequisitesMissing = suppliers.length === 0 || materials.length === 0;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-[#3B4F4E]">Procurement & Production</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#3B4F4E]">Purchases</h1>
          <p className="mt-1 text-sm text-slate-600">
            Create supplier purchase orders, compute GST totals, track payments, and update raw
            material stock on verified receipt.
          </p>
        </div>

        <div className="flex items-center gap-4 shrink-0">
          {canManage ? (
            <button
              type="button"
              onClick={openCreateModal}
              disabled={prerequisitesMissing}
              title={
                prerequisitesMissing
                  ? 'Add at least one Supplier and one Raw Material first'
                  : 'Create Purchase Order'
              }
              className="min-h-[40px] inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#CF9C2D] hover:bg-[#BC8B22] disabled:bg-slate-300 disabled:cursor-not-allowed rounded-lg transition-colors whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3B4F4E]"
            >
              <Plus className="w-4 h-4 shrink-0" />
              New Purchase Order
            </button>
          ) : (
            <span className="text-xs text-slate-500 whitespace-nowrap">
              Audit view for {activeRole}
            </span>
          )}
        </div>
      </div>

      {/* Prerequisite Notice */}
      {!loading && prerequisitesMissing && (
        <div
          role="status"
          className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3 text-sm text-amber-900"
        >
          <AlertCircle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Master Data Required Before Creating Purchases</p>
            <p className="mt-0.5 text-xs text-amber-800">
              {suppliers.length === 0 && 'No suppliers registered yet. '}
              {materials.length === 0 && 'No raw materials registered yet. '}
              Add suppliers and raw materials in Master Data to issue purchase orders.
            </p>
          </div>
        </div>
      )}

      {/* Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white border border-[#DCE6E6] rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500">Purchase Orders</p>
          <p className="mt-2 text-2xl font-semibold font-mono tabular-nums text-[#3B4F4E]">
            {summary.totalCount}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            <span className="font-mono tabular-nums">{summary.orderedCount}</span> awaiting receipt
          </p>
        </div>

        <div className="bg-white border border-[#DCE6E6] rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500">Goods Received</p>
          <p className="mt-2 text-2xl font-semibold font-mono tabular-nums text-emerald-700">
            {summary.receivedCount}
          </p>
          <p className="mt-1 text-xs text-slate-500">Stock synced to raw materials</p>
        </div>

        <div className="bg-white border border-[#DCE6E6] rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500">Total Procurement Value</p>
          <p className="mt-2 text-2xl font-semibold font-mono tabular-nums text-[#3B4F4E]">
            ₹{summary.totalSpend.toFixed(2)}
          </p>
          <p className="mt-1 text-xs text-slate-500">Inclusive of GST (excl. cancelled)</p>
        </div>

        <div className="bg-white border border-[#DCE6E6] rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500">Unpaid / Partial Value</p>
          <p className="mt-2 text-2xl font-semibold font-mono tabular-nums text-amber-700">
            ₹{summary.unpaidAmount.toFixed(2)}
          </p>
          <p className="mt-1 text-xs text-slate-500">Pending supplier settlement</p>
        </div>
      </div>

      {loadError && (
        <div role="alert" className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3 text-sm text-red-800">
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
          <span>{loadError}</span>
        </div>
      )}

      {/* Search, Filters & Table */}
      <div className="bg-white border border-[#DCE6E6] rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#DCE6E6] flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 flex-1">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search PO number, supplier, or invoice..."
                aria-label="Search purchases"
                className="w-full h-9 pl-9 pr-3 text-sm text-[#3B4F4E] bg-slate-50 border border-[#DCE6E6] rounded-lg placeholder:text-slate-400 focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#CF9C2D]"
              />
            </div>

            <select
              aria-label="Filter by payment status"
              value={paymentFilter}
              onChange={(e) => setPaymentFilter(e.target.value as PaymentFilter)}
              className="h-9 px-3 text-xs font-medium text-slate-700 bg-slate-50 border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
            >
              <option value="All">All Payment Statuses</option>
              {PAYMENT_STATUSES.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
          </div>

          <div
            role="tablist"
            aria-label="Filter by receipt status"
            className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg self-start xl:self-auto"
          >
            {(['All', ...PURCHASE_RECEIPT_STATUSES] as const).map((status) => (
              <button
                key={status}
                type="button"
                role="tab"
                aria-selected={receiptFilter === status}
                onClick={() => setReceiptFilter(status)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  receiptFilter === status
                    ? 'bg-white text-[#3B4F4E] shadow-xs'
                    : 'text-slate-600 hover:text-[#3B4F4E]'
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
                  PO Number
                </th>
                <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 whitespace-nowrap">
                  Date
                </th>
                <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 whitespace-nowrap">
                  Supplier & Invoice
                </th>
                <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 text-right whitespace-nowrap">
                  Items
                </th>
                <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 text-right whitespace-nowrap">
                  Grand Total
                </th>
                <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 whitespace-nowrap">
                  Payment
                </th>
                <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 whitespace-nowrap">
                  Receipt Status
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
                    Loading purchase history from Cloud Firestore...
                  </td>
                </tr>
              ) : filteredPurchases.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-16 text-center">
                    <div className="max-w-md mx-auto flex flex-col items-center">
                      <div className="w-11 h-11 rounded-xl bg-slate-100 border border-[#DCE6E6] flex items-center justify-center text-slate-500 mb-4">
                        <ShoppingCart className="w-5 h-5" />
                      </div>
                      <h2 className="text-base font-semibold text-[#3B4F4E]">
                        {purchases.length === 0 ? 'No purchase orders recorded yet' : 'No matching purchases'}
                      </h2>
                      <p className="mt-1.5 text-sm text-slate-600">
                        {purchases.length === 0
                          ? 'Issue a supplier purchase order to procure raw materials and track GST invoices.'
                          : 'Adjust your search query or receipt/payment filters.'}
                      </p>
                      {purchases.length === 0 && canManage && !prerequisitesMissing && (
                        <button
                          type="button"
                          onClick={openCreateModal}
                          className="mt-4 min-h-[38px] inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-[#CF9C2D] hover:bg-[#BC8B22] rounded-lg transition-colors whitespace-nowrap"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          Create First Purchase
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                filteredPurchases.map((purchase) => (
                  <tr key={purchase.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-5 py-3.5 font-mono text-xs font-semibold text-[#3B4F4E] whitespace-nowrap">
                      {purchase.poNumber}
                    </td>
                    <td className="px-5 py-3.5 font-mono text-xs text-slate-600 tabular-nums whitespace-nowrap">
                      {purchase.purchaseDate}
                    </td>
                    <td className="px-5 py-3.5 min-w-[200px]">
                      <p className="text-sm font-medium text-[#3B4F4E]">{purchase.supplierName}</p>
                      <p className="text-xs text-slate-500 font-mono">
                        {purchase.invoiceNumber ? `Inv: ${purchase.invoiceNumber}` : 'Invoice pending'}
                      </p>
                    </td>
                    <td className="px-5 py-3.5 font-mono text-xs text-slate-700 text-right tabular-nums whitespace-nowrap">
                      {purchase.itemCount}
                    </td>
                    <td className="px-5 py-3.5 text-right whitespace-nowrap">
                      <p className="font-mono text-sm font-semibold text-[#3B4F4E] tabular-nums">
                        ₹{purchase.grandTotal.toFixed(2)}
                      </p>
                      <p className="font-mono text-[11px] text-slate-500 tabular-nums">
                        GST ₹{purchase.gstTotal.toFixed(2)}
                      </p>
                    </td>
                    <td className="px-5 py-3.5 text-xs font-medium whitespace-nowrap">
                      <span
                        className={
                          purchase.paymentStatus === 'Paid'
                            ? 'text-emerald-700'
                            : purchase.paymentStatus === 'Partially Paid'
                              ? 'text-amber-700'
                              : 'text-red-700'
                        }
                      >
                        {purchase.paymentStatus}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-xs font-medium whitespace-nowrap">
                      {purchase.receiptStatus === 'Received' ? (
                        <span className="inline-flex items-center gap-1.5 text-emerald-700">
                          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                          Received
                        </span>
                      ) : purchase.receiptStatus === 'Ordered' ? (
                        <span className="inline-flex items-center gap-1.5 text-[#3B4F4E]">
                          <ClipboardList className="w-3.5 h-3.5 shrink-0" />
                          Ordered
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-slate-500">
                          <XCircle className="w-3.5 h-3.5 shrink-0" />
                          Cancelled
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-2">
                        {canManage && purchase.receiptStatus === 'Ordered' && (
                          <button
                            type="button"
                            onClick={() => openReceiveModal(purchase)}
                            className="min-h-[32px] inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-md transition-colors whitespace-nowrap"
                          >
                            <PackageCheck className="w-3.5 h-3.5 shrink-0" />
                            Receive
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => openDetailModal(purchase)}
                          className="min-h-[32px] inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-[#DCE6E6] rounded-md transition-colors"
                        >
                          <Eye className="w-3.5 h-3.5 text-slate-500" />
                          View
                        </button>
                        {canManage && purchase.receiptStatus === 'Ordered' && (
                          <button
                            type="button"
                            onClick={() => openEditModal(purchase)}
                            className="min-h-[32px] inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-[#DCE6E6] rounded-md transition-colors"
                          >
                            <Edit3 className="w-3.5 h-3.5 text-slate-500" />
                            Edit
                          </button>
                        )}
                        {canDelete && purchase.receiptStatus !== 'Received' && (
                          <button
                            type="button"
                            onClick={() => {
                              setDeleteError(null);
                              setDeletingPurchase(purchase);
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
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit Purchase Order Modal */}
      {modalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="purchase-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/50 overflow-y-auto"
        >
          <div className="w-full max-w-4xl bg-white border border-[#DCE6E6] rounded-xl overflow-hidden my-8">
            <div className="px-6 py-4 border-b border-[#DCE6E6] flex items-center justify-between">
              <div>
                <h2 id="purchase-modal-title" className="text-base font-semibold text-[#3B4F4E]">
                  {editingPurchase ? `Edit Purchase Order (${editingPurchase.poNumber})` : 'New Purchase Order'}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Raw material inventory updates only after goods are marked Received.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                aria-label="Close modal"
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={(e) => void handleSavePurchase(e)} className="p-6 space-y-5 max-h-[82vh] overflow-y-auto">
              {formError && (
                <div role="alert" className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div>
                  <label htmlFor="po-number" className="block text-xs font-medium text-slate-700 mb-1">
                    PO Number *
                  </label>
                  <input
                    id="po-number"
                    type="text"
                    required
                    maxLength={BLUEPRINT_CONSTRAINTS.code.maxLength}
                    value={poNumber}
                    onChange={(e) => setPoNumber(e.target.value.toUpperCase())}
                    placeholder="PO-2026-0001"
                    className="w-full h-9 px-3 font-mono text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                  />
                </div>

                <div>
                  <label htmlFor="po-supplier" className="block text-xs font-medium text-slate-700 mb-1">
                    Supplier *
                  </label>
                  <select
                    id="po-supplier"
                    required
                    value={supplierId}
                    onChange={(e) => setSupplierId(e.target.value)}
                    className="w-full h-9 px-3 text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                  >
                    <option value="">Select supplier...</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.state})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="po-date" className="block text-xs font-medium text-slate-700 mb-1">
                    Purchase Date *
                  </label>
                  <input
                    id="po-date"
                    type="date"
                    required
                    value={purchaseDate}
                    onChange={(e) => setPurchaseDate(e.target.value)}
                    className="w-full h-9 px-3 font-mono text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                  />
                </div>

                <div>
                  <label htmlFor="po-invoice" className="block text-xs font-medium text-slate-700 mb-1">
                    Supplier Invoice Number
                  </label>
                  <input
                    id="po-invoice"
                    type="text"
                    maxLength={60}
                    value={invoiceNumber}
                    onChange={(e) => setInvoiceNumber(e.target.value)}
                    placeholder="INV-SUP-4092"
                    className="w-full h-9 px-3 font-mono text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                  />
                </div>

                <div>
                  <label htmlFor="po-payment-status" className="block text-xs font-medium text-slate-700 mb-1">
                    Payment Status *
                  </label>
                  <select
                    id="po-payment-status"
                    value={paymentStatus}
                    onChange={(e) => setPaymentStatus(e.target.value as PaymentStatus)}
                    className="w-full h-9 px-3 text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                  >
                    {PAYMENT_STATUSES.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="po-notes" className="block text-xs font-medium text-slate-700 mb-1">
                    Notes
                  </label>
                  <input
                    id="po-notes"
                    type="text"
                    maxLength={BLUEPRINT_CONSTRAINTS.description.maxLength}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Delivery terms or lot notes"
                    className="w-full h-9 px-3 text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                  />
                </div>
              </div>

              {/* Line Items Section */}
              <div className="border-t border-[#DCE6E6] pt-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-[#3B4F4E]">Raw Material Line Items</h3>
                    <p className="text-xs text-slate-500">
                      Add one or more raw materials with quantity, unit price, and GST rate.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setLineItems((prev) => [...prev, createEmptyLine()])}
                    className="min-h-[34px] inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#3B4F4E] bg-[#EEF3F3] hover:bg-[#E5EDED] rounded-lg transition-colors whitespace-nowrap"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Material Row
                  </button>
                </div>

                <div className="overflow-x-auto border border-[#DCE6E6] rounded-lg">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-[#DCE6E6] bg-slate-50">
                        <th className="px-3 py-2 text-xs font-semibold text-slate-600">Raw Material *</th>
                        <th className="px-3 py-2 text-xs font-semibold text-slate-600">Qty *</th>
                        <th className="px-3 py-2 text-xs font-semibold text-slate-600">Unit Price (₹) *</th>
                        <th className="px-3 py-2 text-xs font-semibold text-slate-600">GST % *</th>
                        <th className="px-3 py-2 text-xs font-semibold text-slate-600 text-right">Line Total</th>
                        <th className="px-3 py-2 text-xs font-semibold text-slate-600 text-right">Remove</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {lineItems.map((row, index) => {
                        const mat = materialMap.get(row.rawMaterialId);
                        const qty = Number(row.quantity);
                        const price = Number(row.unitPrice);
                        const gst = Number(row.gstPercentage);
                        const lineSub =
                          Number.isFinite(qty) && qty > 0 && Number.isFinite(price) && price >= 0
                            ? roundCurrency(roundQuantity(qty) * roundCurrency(price))
                            : 0;
                        const lineGst =
                          Number.isFinite(gst) && gst >= 0 && gst <= 28
                            ? roundCurrency((lineSub * roundCurrency(gst)) / 100)
                            : 0;
                        const lineTotal = roundCurrency(lineSub + lineGst);

                        return (
                          <tr key={index}>
                            <td className="px-3 py-2 min-w-[210px]">
                              <select
                                aria-label={`Line ${index + 1} raw material`}
                                value={row.rawMaterialId}
                                onChange={(e) => handleMaterialChange(index, e.target.value)}
                                className="w-full h-8 px-2 text-xs text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-md focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                              >
                                <option value="">Select material...</option>
                                {materials.map((m) => (
                                  <option key={m.id} value={m.id}>
                                    {m.name} ({m.materialCode} · {m.unit})
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="px-3 py-2 min-w-[120px]">
                              <div className="flex items-center gap-1.5">
                                <input
                                  aria-label={`Line ${index + 1} quantity`}
                                  type="number"
                                  required
                                  min="0.001"
                                  step="0.001"
                                  value={row.quantity}
                                  onChange={(e) =>
                                    setLineItems((prev) =>
                                      prev.map((item, idx) =>
                                        idx === index ? { ...item, quantity: e.target.value } : item,
                                      ),
                                    )
                                  }
                                  className="w-24 h-8 px-2 font-mono text-xs text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-md focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                                />
                                <span className="text-[11px] font-mono text-slate-500">
                                  {mat?.unit ?? ''}
                                </span>
                              </div>
                            </td>
                            <td className="px-3 py-2 min-w-[115px]">
                              <input
                                aria-label={`Line ${index + 1} unit price`}
                                type="number"
                                required
                                min="0"
                                step="0.01"
                                value={row.unitPrice}
                                onChange={(e) =>
                                  setLineItems((prev) =>
                                    prev.map((item, idx) =>
                                      idx === index ? { ...item, unitPrice: e.target.value } : item,
                                    ),
                                  )
                                }
                                className="w-24 h-8 px-2 font-mono text-xs text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-md focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                              />
                            </td>
                            <td className="px-3 py-2 min-w-[95px]">
                              <select
                                aria-label={`Line ${index + 1} GST`}
                                value={row.gstPercentage}
                                onChange={(e) =>
                                  setLineItems((prev) =>
                                    prev.map((item, idx) =>
                                      idx === index
                                        ? { ...item, gstPercentage: e.target.value }
                                        : item,
                                    ),
                                  )
                                }
                                className="w-20 h-8 px-2 font-mono text-xs text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-md focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                              >
                                {GST_RATES.map((rate) => (
                                  <option key={rate} value={String(rate)}>
                                    {rate}%
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="px-3 py-2 font-mono text-xs font-medium text-[#3B4F4E] text-right tabular-nums whitespace-nowrap">
                              ₹{lineTotal.toFixed(2)}
                            </td>
                            <td className="px-3 py-2 text-right">
                              <button
                                type="button"
                                disabled={lineItems.length <= 1}
                                onClick={() =>
                                  setLineItems((prev) => prev.filter((_, idx) => idx !== index))
                                }
                                aria-label={`Remove line ${index + 1}`}
                                className="p-1.5 text-slate-400 hover:text-red-600 disabled:opacity-30 rounded"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Live Totals */}
                <div className="flex justify-end">
                  <dl className="w-full sm:w-72 border border-[#DCE6E6] rounded-lg bg-slate-50 p-4 space-y-2 text-xs">
                    <div className="flex items-center justify-between text-slate-600">
                      <dt>Subtotal</dt>
                      <dd className="font-mono tabular-nums text-[#3B4F4E]">
                        ₹{liveTotals.subtotal.toFixed(2)}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between text-slate-600">
                      <dt>Total GST</dt>
                      <dd className="font-mono tabular-nums text-[#3B4F4E]">
                        ₹{liveTotals.gstTotal.toFixed(2)}
                      </dd>
                    </div>
                    <div className="pt-2 border-t border-[#DCE6E6] flex items-center justify-between text-sm font-semibold text-[#3B4F4E]">
                      <dt>Grand Total</dt>
                      <dd className="font-mono tabular-nums">
                        ₹{liveTotals.grandTotal.toFixed(2)}
                      </dd>
                    </div>
                  </dl>
                </div>
              </div>

              <div className="pt-4 border-t border-[#DCE6E6] flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="min-h-[38px] px-4 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-[#DCE6E6] rounded-lg whitespace-nowrap"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="min-h-[38px] px-4 py-2 text-xs font-medium text-white bg-[#CF9C2D] hover:bg-[#BC8B22] disabled:opacity-60 rounded-lg whitespace-nowrap"
                >
                  {saving
                    ? 'Saving to Firestore...'
                    : editingPurchase
                      ? 'Update Purchase Order'
                      : 'Create Purchase Order'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Receive Goods Modal (Atomic Inventory Update) */}
      {receivingPurchase && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="receive-purchase-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/50 overflow-y-auto"
        >
          <div className="w-full max-w-lg bg-white border border-[#DCE6E6] rounded-xl overflow-hidden my-8">
            <div className="px-6 py-4 border-b border-[#DCE6E6] flex items-center justify-between">
              <h2 id="receive-purchase-title" className="text-base font-semibold text-[#3B4F4E]">
                Receive Purchase ({receivingPurchase.poNumber})
              </h2>
              <button
                type="button"
                onClick={() => setReceivingPurchase(null)}
                aria-label="Close modal"
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={(e) => void handleConfirmReceive(e)} className="p-6 space-y-4">
              {receiveError && (
                <div role="alert" className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{receiveError}</span>
                </div>
              )}

              <div className="p-3.5 rounded-lg bg-slate-50 border border-[#DCE6E6] text-xs text-slate-700 space-y-1.5">
                <p className="font-semibold text-[#3B4F4E]">
                  Stock Additions on Confirmation ({receivingPurchase.supplierName}):
                </p>
                <ul className="space-y-1">
                  {(itemsByPurchaseId.get(receivingPurchase.id) ?? []).map((item) => (
                    <li key={item.id} className="flex items-center justify-between font-mono">
                      <span>{item.materialName}</span>
                      <span className="text-emerald-700 font-semibold">
                        +{item.quantity} {item.unit}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <label htmlFor="receive-invoice" className="block text-xs font-medium text-slate-700 mb-1">
                  Supplier Invoice / Challan Number *
                </label>
                <input
                  id="receive-invoice"
                  type="text"
                  required
                  maxLength={60}
                  value={receiveInvoiceNumber}
                  onChange={(e) => setReceiveInvoiceNumber(e.target.value)}
                  placeholder="INV-2026-8812"
                  className="w-full h-9 px-3 font-mono text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                />
              </div>

              <div>
                <label htmlFor="receive-payment" className="block text-xs font-medium text-slate-700 mb-1">
                  Payment Status *
                </label>
                <select
                  id="receive-payment"
                  value={receivePaymentStatus}
                  onChange={(e) => setReceivePaymentStatus(e.target.value as PaymentStatus)}
                  className="w-full h-9 px-3 text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                >
                  {PAYMENT_STATUSES.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="receive-notes" className="block text-xs font-medium text-slate-700 mb-1">
                  Inspection / Receipt Notes
                </label>
                <textarea
                  id="receive-notes"
                  rows={2}
                  maxLength={BLUEPRINT_CONSTRAINTS.description.maxLength}
                  value={receiveNotes}
                  onChange={(e) => setReceiveNotes(e.target.value)}
                  placeholder="Optional lot weight check or quality sign-off note"
                  className="w-full p-2.5 text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                />
              </div>

              <div className="pt-3 border-t border-[#DCE6E6] flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setReceivingPurchase(null)}
                  className="min-h-[38px] px-4 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-[#DCE6E6] rounded-lg whitespace-nowrap"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={receiving}
                  className="min-h-[38px] px-4 py-2 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 rounded-lg whitespace-nowrap"
                >
                  {receiving ? 'Updating Inventory...' : 'Confirm Receipt & Add Stock'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Purchase Detail & Payment Update Modal */}
      {viewingPurchase && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="view-purchase-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/50 overflow-y-auto"
        >
          <div className="w-full max-w-3xl bg-white border border-[#DCE6E6] rounded-xl overflow-hidden my-8">
            <div className="px-6 py-4 border-b border-[#DCE6E6] flex items-center justify-between">
              <div>
                <h2 id="view-purchase-title" className="text-base font-semibold text-[#3B4F4E]">
                  Purchase Details · {viewingPurchase.poNumber}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {viewingPurchase.supplierName} · Date {viewingPurchase.purchaseDate} ·{' '}
                  {viewingPurchase.receiptStatus}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setViewingPurchase(null)}
                aria-label="Close modal"
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-5 max-h-[82vh] overflow-y-auto">
              <div className="overflow-x-auto border border-[#DCE6E6] rounded-lg">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[#DCE6E6] bg-slate-50">
                      <th className="px-4 py-2.5 text-xs font-semibold text-slate-600">Material</th>
                      <th className="px-4 py-2.5 text-xs font-semibold text-slate-600 text-right">Qty</th>
                      <th className="px-4 py-2.5 text-xs font-semibold text-slate-600 text-right">Unit Price</th>
                      <th className="px-4 py-2.5 text-xs font-semibold text-slate-600 text-right">GST</th>
                      <th className="px-4 py-2.5 text-xs font-semibold text-slate-600 text-right">Line Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {(itemsByPurchaseId.get(viewingPurchase.id) ?? []).map((item) => (
                      <tr key={item.id}>
                        <td className="px-4 py-2.5">
                          <p className="text-sm font-medium text-[#3B4F4E]">{item.materialName}</p>
                          <p className="text-xs font-mono text-slate-500">{item.materialCode}</p>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs text-slate-700 text-right tabular-nums">
                          {item.quantity} {item.unit}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs text-slate-700 text-right tabular-nums">
                          ₹{item.unitPrice.toFixed(2)}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs text-slate-600 text-right tabular-nums">
                          {item.gstPercentage}% (₹{item.lineGst.toFixed(2)})
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs font-semibold text-[#3B4F4E] text-right tabular-nums">
                          ₹{item.lineTotal.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                <div className="text-xs text-slate-600 space-y-1">
                  <p>
                    <span className="font-medium text-slate-800">Supplier GSTIN:</span>{' '}
                    <span className="font-mono">{viewingPurchase.supplierGstin || 'Unregistered'}</span>
                  </p>
                  <p>
                    <span className="font-medium text-slate-800">Receipt Audit:</span>{' '}
                    {viewingPurchase.receiptStatus === 'Received' && viewingPurchase.receivedAt
                      ? `Received on ${viewingPurchase.receivedAt.toDate().toLocaleString()}`
                      : viewingPurchase.receiptStatus}
                  </p>
                </div>

                <dl className="w-full sm:w-64 border border-[#DCE6E6] rounded-lg bg-slate-50 p-3.5 space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <dt className="text-slate-600">Subtotal</dt>
                    <dd className="font-mono tabular-nums text-[#3B4F4E]">
                      ₹{viewingPurchase.subtotal.toFixed(2)}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-600">Total GST</dt>
                    <dd className="font-mono tabular-nums text-[#3B4F4E]">
                      ₹{viewingPurchase.gstTotal.toFixed(2)}
                    </dd>
                  </div>
                  <div className="pt-1.5 border-t border-[#DCE6E6] flex justify-between font-semibold text-sm text-[#3B4F4E]">
                    <dt>Grand Total</dt>
                    <dd className="font-mono tabular-nums">
                      ₹{viewingPurchase.grandTotal.toFixed(2)}
                    </dd>
                  </div>
                </dl>
              </div>

              {canManage && viewingPurchase.receiptStatus !== 'Cancelled' && (
                <form onSubmit={(e) => void handleUpdatePaymentAndInvoice(e)} className="pt-4 border-t border-[#DCE6E6] space-y-4">
                  {detailError && (
                    <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
                      {detailError}
                    </p>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="detail-payment" className="block text-xs font-medium text-slate-700 mb-1">
                        Payment Status
                      </label>
                      <select
                        id="detail-payment"
                        value={detailPaymentStatus}
                        onChange={(e) => setDetailPaymentStatus(e.target.value as PaymentStatus)}
                        className="w-full h-9 px-3 text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                      >
                        {PAYMENT_STATUSES.map((st) => (
                          <option key={st} value={st}>
                            {st}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="detail-invoice" className="block text-xs font-medium text-slate-700 mb-1">
                        Supplier Invoice Number
                      </label>
                      <input
                        id="detail-invoice"
                        type="text"
                        maxLength={60}
                        value={detailInvoiceNumber}
                        onChange={(e) => setDetailInvoiceNumber(e.target.value)}
                        className="w-full h-9 px-3 font-mono text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                      />
                    </div>
                  </div>
                  <div>
                    <label htmlFor="detail-notes" className="block text-xs font-medium text-slate-700 mb-1">
                      Notes
                    </label>
                    <input
                      id="detail-notes"
                      type="text"
                      maxLength={BLUEPRINT_CONSTRAINTS.description.maxLength}
                      value={detailNotes}
                      onChange={(e) => setDetailNotes(e.target.value)}
                      className="w-full h-9 px-3 text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                    />
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    {viewingPurchase.receiptStatus === 'Ordered' ? (
                      <button
                        type="button"
                        onClick={() => void handleCancelOrderedPurchase(viewingPurchase)}
                        disabled={detailSaving}
                        className="min-h-[38px] px-3 py-2 text-xs font-medium text-red-700 bg-white hover:bg-red-50 border border-[#DCE6E6] rounded-lg whitespace-nowrap"
                      >
                        Cancel Purchase Order
                      </button>
                    ) : (
                      <span className="text-xs text-slate-500">
                        Line quantities locked after inventory receipt.
                      </span>
                    )}
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setViewingPurchase(null)}
                        className="min-h-[38px] px-4 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-[#DCE6E6] rounded-lg whitespace-nowrap"
                      >
                        Close
                      </button>
                      <button
                        type="submit"
                        disabled={detailSaving}
                        className="min-h-[38px] px-4 py-2 text-xs font-medium text-white bg-[#CF9C2D] hover:bg-[#BC8B22] disabled:opacity-60 rounded-lg whitespace-nowrap"
                      >
                        {detailSaving ? 'Saving...' : 'Update Payment / Invoice'}
                      </button>
                    </div>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletingPurchase && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-purchase-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/50"
        >
          <div className="w-full max-w-md bg-white border border-[#DCE6E6] rounded-xl p-6 space-y-4">
            <h2 id="delete-purchase-title" className="text-base font-semibold text-[#3B4F4E]">
              Delete Purchase Order
            </h2>
            <p className="text-sm text-slate-600">
              Permanently remove{' '}
              <span className="font-mono font-semibold text-[#3B4F4E]">
                {deletingPurchase.poNumber}
              </span>{' '}
              ({deletingPurchase.supplierName}) from Firestore?
            </p>
            {deleteError && (
              <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
                {deleteError}
              </p>
            )}
            <div className="pt-2 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeletingPurchase(null)}
                className="min-h-[38px] px-4 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-[#DCE6E6] rounded-lg whitespace-nowrap"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleDeletePurchase()}
                disabled={deleting}
                className="min-h-[38px] px-4 py-2 text-xs font-medium text-white bg-red-600 hover:bg-red-700 disabled:bg-red-400 rounded-lg whitespace-nowrap"
              >
                {deleting ? 'Deleting...' : 'Delete Purchase'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
