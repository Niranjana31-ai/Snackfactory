import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Boxes,
  CheckCircle2,
  ClipboardList,
  Search,
  SlidersHorizontal,
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
import {
  BLUEPRINT_CONSTRAINTS,
  roundQuantity,
  validateStockAdjustmentInput,
} from '../lib/validation';
import {
  LEDGER_TRANSACTION_TYPES,
  ORG_ID,
  type InventoryLedgerEntry,
  type LedgerTransactionType,
  type Product,
  type RawMaterial,
  type StockBalance,
  type StockCategory,
} from '../types/erp';

type InventoryTab = 'balances' | 'ledger';
type CategoryFilter = 'All' | StockCategory;
type TxTypeFilter = 'All' | LedgerTransactionType;

const CATEGORY_LABELS: Record<StockCategory, string> = {
  raw_material: 'Raw Material',
  wip: 'Work in Progress',
  finished_goods: 'Finished Goods',
  damaged: 'Damaged / Rejected',
};

function getTodayIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function InventoryPage() {
  const { firebaseUser, userProfile, effectiveRole } = useAuth();
  const activeRole = effectiveRole ?? userProfile?.role ?? 'Salesman';
  const canManage =
    activeRole === 'Owner' ||
    activeRole === 'Admin' ||
    activeRole === 'Production Supervisor';
  const canReadRawMaterials = activeRole !== 'Salesman';

  const [activeTab, setActiveTab] = useState<InventoryTab>('balances');
  const [balances, setBalances] = useState<StockBalance[]>([]);
  const [ledgerEntries, setLedgerEntries] = useState<InventoryLedgerEntry[]>([]);
  const [rawMaterials, setRawMaterials] = useState<RawMaterial[]>([]);
  const [products, setProducts] = useState<Product[]>([]);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionBanner, setActionBanner] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('All');
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [txTypeFilter, setTxTypeFilter] = useState<TxTypeFilter>('All');

  // Stock Adjustment Modal
  const [adjustModalOpen, setAdjustModalOpen] = useState(false);
  const [adjustTargetType, setAdjustTargetType] = useState<'raw_material' | 'finished_goods' | 'damaged'>('raw_material');
  const [adjustItemId, setAdjustItemId] = useState('');
  const [adjustDirection, setAdjustDirection] = useState<'In' | 'Out'>('In');
  const [adjustQty, setAdjustQty] = useState('');
  const [adjustDate, setAdjustDate] = useState(getTodayIso());
  const [adjustRefDoc, setAdjustRefDoc] = useState('');
  const [adjustReason, setAdjustReason] = useState('');
  const [adjustError, setAdjustError] = useState<string | null>(null);
  const [adjusting, setAdjusting] = useState(false);

  useEffect(() => {
    if (!firebaseUser) return;
    setLoading(true);
    setLoadError(null);

    let loadedBalances = false;
    let loadedLedger = false;
    const finishIfReady = () => {
      if (loadedBalances && loadedLedger) {
        setLoading(false);
      }
    };

    const unsubBalances = onSnapshot(
      query(collection(db, 'stockBalances'), where('orgId', '==', ORG_ID)),
      (snap) => {
        const rows = snap.docs.map((d) => d.data() as StockBalance);
        rows.sort((a, b) => a.itemName.localeCompare(b.itemName));
        setBalances(rows);
        loadedBalances = true;
        finishIfReady();
      },
      (error) => {
        setLoading(false);
        setLoadError('Unable to load stock balances from Cloud Firestore.');
        handleFirestoreError(error, OperationType.LIST, 'stockBalances');
      },
    );

    const unsubLedger = onSnapshot(
      query(collection(db, 'inventoryLedger'), where('orgId', '==', ORG_ID)),
      (snap) => {
        const rows = snap.docs.map((d) => d.data() as InventoryLedgerEntry);
        rows.sort((a, b) => {
          const dateCmp = b.transactionDate.localeCompare(a.transactionDate);
          if (dateCmp !== 0) return dateCmp;
          const aSec = a.createdAt?.seconds ?? 0;
          const bSec = b.createdAt?.seconds ?? 0;
          return bSec - aSec;
        });
        setLedgerEntries(rows);
        loadedLedger = true;
        finishIfReady();
      },
      (error) => {
        setLoading(false);
        setLoadError('Unable to load inventory ledger from Cloud Firestore.');
        handleFirestoreError(error, OperationType.LIST, 'inventoryLedger');
      },
    );

    const unsubProducts = onSnapshot(
      query(collection(db, 'products'), where('orgId', '==', ORG_ID)),
      (snap) => {
        const rows = snap.docs.map((d) => d.data() as Product);
        rows.sort((a, b) => a.name.localeCompare(b.name));
        setProducts(rows);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'products');
      },
    );

    let unsubMaterials = () => {};
    if (canReadRawMaterials) {
      unsubMaterials = onSnapshot(
        query(collection(db, 'rawMaterials'), where('orgId', '==', ORG_ID)),
        (snap) => {
          const rows = snap.docs.map((d) => d.data() as RawMaterial);
          rows.sort((a, b) => a.name.localeCompare(b.name));
          setRawMaterials(rows);
        },
        (error) => {
          handleFirestoreError(error, OperationType.LIST, 'rawMaterials');
        },
      );
    }

    return () => {
      unsubBalances();
      unsubLedger();
      unsubProducts();
      unsubMaterials();
    };
  }, [firebaseUser, canReadRawMaterials]);

  // Merge rawMaterials that might predate Stage 4 stockBalances docs so nothing is invisible
  const unifiedBalances = useMemo(() => {
    const map = new Map(balances.map((b) => [b.id, b]));
    if (canReadRawMaterials) {
      rawMaterials.forEach((mat) => {
        const key = `rm_${mat.id}`;
        if (!map.has(key)) {
          map.set(key, {
            id: key,
            orgId: ORG_ID,
            itemId: mat.id,
            itemCode: mat.materialCode,
            itemName: mat.name,
            stockCategory: 'raw_material',
            unit: mat.unit,
            openingStock: mat.openingStock,
            receivedFromPurchases: 0,
            issuedToProduction: 0,
            receivedFromProduction: 0,
            dispatchedThroughSales: 0,
            adjustmentsNet: roundQuantity(mat.currentStock - mat.openingStock),
            currentBalance: mat.currentStock,
            minimumStockLevel: mat.minimumStockLevel,
            updatedBy: mat.createdBy,
            updatedByName: 'Master Catalog',
            createdAt: mat.createdAt,
            updatedAt: mat.updatedAt,
          });
        }
      });
    }
    return Array.from(map.values()).sort((a, b) => a.itemName.localeCompare(b.itemName));
  }, [balances, rawMaterials, canReadRawMaterials]);

  const summary = useMemo(() => {
    let rawCount = 0;
    let wipPackets = 0;
    let finishedPackets = 0;
    let damagedCount = 0;
    let lowStockCount = 0;

    unifiedBalances.forEach((b) => {
      if (b.stockCategory === 'raw_material') {
        rawCount += 1;
        if (b.currentBalance <= b.minimumStockLevel) {
          lowStockCount += 1;
        }
      } else if (b.stockCategory === 'wip') {
        wipPackets += b.currentBalance;
      } else if (b.stockCategory === 'finished_goods') {
        finishedPackets += b.currentBalance;
      } else if (b.stockCategory === 'damaged') {
        damagedCount += b.currentBalance;
      }
    });

    return {
      rawCount,
      wipPackets: roundQuantity(wipPackets),
      finishedPackets: roundQuantity(finishedPackets),
      damagedCount: roundQuantity(damagedCount),
      lowStockCount,
    };
  }, [unifiedBalances]);

  const filteredBalances = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return unifiedBalances.filter((b) => {
      const matchesCat = categoryFilter === 'All' || b.stockCategory === categoryFilter;
      const isLow =
        b.stockCategory === 'raw_material' && b.currentBalance <= b.minimumStockLevel;
      const matchesLow = !lowStockOnly || isLow;
      const matchesSearch =
        !term ||
        b.itemName.toLowerCase().includes(term) ||
        b.itemCode.toLowerCase().includes(term) ||
        CATEGORY_LABELS[b.stockCategory].toLowerCase().includes(term);
      return matchesCat && matchesLow && matchesSearch;
    });
  }, [unifiedBalances, searchTerm, categoryFilter, lowStockOnly]);

  const filteredLedger = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return ledgerEntries.filter((e) => {
      const matchesCat = categoryFilter === 'All' || e.stockCategory === categoryFilter;
      const matchesType = txTypeFilter === 'All' || e.transactionType === txTypeFilter;
      const matchesSearch =
        !term ||
        e.itemName.toLowerCase().includes(term) ||
        e.itemCode.toLowerCase().includes(term) ||
        e.referenceDoc.toLowerCase().includes(term) ||
        e.reason.toLowerCase().includes(term) ||
        e.userName.toLowerCase().includes(term);
      return matchesCat && matchesType && matchesSearch;
    });
  }, [ledgerEntries, searchTerm, categoryFilter, txTypeFilter]);

  const adjustableItems = useMemo(() => {
    if (adjustTargetType === 'raw_material') {
      return rawMaterials.map((m) => ({
        balanceId: `rm_${m.id}`,
        itemId: m.id,
        itemCode: m.materialCode,
        itemName: m.name,
        unit: m.unit,
        currentBalance: m.currentStock,
        category: 'raw_material' as StockCategory,
      }));
    }
    if (adjustTargetType === 'finished_goods') {
      return products.map((p) => {
        const bal = unifiedBalances.find((b) => b.id === `fg_${p.id}`);
        return {
          balanceId: `fg_${p.id}`,
          itemId: p.id,
          itemCode: p.sku,
          itemName: p.name,
          unit: 'packets' as const,
          currentBalance: bal?.currentBalance ?? 0,
          category: 'finished_goods' as StockCategory,
        };
      });
    }
    return unifiedBalances
      .filter((b) => b.stockCategory === 'damaged')
      .map((b) => ({
        balanceId: b.id,
        itemId: b.itemId,
        itemCode: b.itemCode,
        itemName: b.itemName,
        unit: b.unit,
        currentBalance: b.currentBalance,
        category: 'damaged' as StockCategory,
      }));
  }, [adjustTargetType, rawMaterials, products, unifiedBalances]);

  const selectedAdjustItem = useMemo(
    () => adjustableItems.find((i) => i.balanceId === adjustItemId) ?? adjustableItems[0] ?? null,
    [adjustableItems, adjustItemId],
  );

  const openAdjustModal = (presetBalance?: StockBalance) => {
    if (presetBalance) {
      if (presetBalance.stockCategory === 'raw_material') {
        setAdjustTargetType('raw_material');
      } else if (presetBalance.stockCategory === 'finished_goods') {
        setAdjustTargetType('finished_goods');
      } else if (presetBalance.stockCategory === 'damaged') {
        setAdjustTargetType('damaged');
      } else {
        setAdjustTargetType('raw_material');
      }
      setAdjustItemId(presetBalance.id);
    } else {
      setAdjustTargetType('raw_material');
      setAdjustItemId(rawMaterials[0] ? `rm_${rawMaterials[0].id}` : '');
    }
    setAdjustDirection('In');
    setAdjustQty('');
    setAdjustDate(getTodayIso());
    setAdjustRefDoc(`ADJ-${new Date().getFullYear()}-${String(ledgerEntries.length + 1).padStart(4, '0')}`);
    setAdjustReason('');
    setAdjustError(null);
    setAdjustModalOpen(true);
  };

  const handleConfirmAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !canManage || !selectedAdjustItem) return;

    const validation = validateStockAdjustmentInput(
      {
        direction: adjustDirection,
        quantity: adjustQty,
        transactionDate: adjustDate,
        referenceDoc: adjustRefDoc,
        reason: adjustReason,
      },
      selectedAdjustItem.currentBalance,
    );

    if (!validation.valid) {
      setAdjustError(validation.error);
      return;
    }

    setAdjusting(true);
    setAdjustError(null);
    const operatorName = (userProfile?.displayName || 'ERP Operator').slice(
      0,
      BLUEPRINT_CONSTRAINTS.displayName.maxLength,
    );

    try {
      await runTransaction(db, async (transaction) => {
        const balRef = doc(db, 'stockBalances', selectedAdjustItem.balanceId);
        const isRawMaterial = selectedAdjustItem.category === 'raw_material';
        const matRef = isRawMaterial
          ? doc(db, 'rawMaterials', selectedAdjustItem.itemId)
          : null;

        const [balSnap, matSnap] = await Promise.all([
          transaction.get(balRef),
          matRef ? transaction.get(matRef) : Promise.resolve(null),
        ]);

        let liveBalance = 0;
        let liveMat: RawMaterial | null = null;
        if (matSnap && matSnap.exists()) {
          liveMat = matSnap.data() as RawMaterial;
          liveBalance = liveMat.currentStock;
        } else if (balSnap.exists()) {
          liveBalance = (balSnap.data() as StockBalance).currentBalance;
        }

        const recheck = validateStockAdjustmentInput(
          {
            direction: adjustDirection,
            quantity: adjustQty,
            transactionDate: adjustDate,
            referenceDoc: adjustRefDoc,
            reason: adjustReason,
          },
          liveBalance,
        );
        if (!recheck.valid) {
          throw new Error(recheck.error);
        }

        const signedDelta =
          recheck.sanitized.direction === 'In'
            ? recheck.sanitized.quantity
            : -recheck.sanitized.quantity;

        if (matRef && liveMat) {
          transaction.update(matRef, {
            currentStock: recheck.sanitized.newBalance,
            updatedAt: serverTimestamp(),
          });
        }

        if (balSnap.exists()) {
          const prevBal = balSnap.data() as StockBalance;
          transaction.update(balRef, {
            itemCode: liveMat?.materialCode ?? prevBal.itemCode,
            itemName: liveMat?.name ?? prevBal.itemName,
            unit: liveMat?.unit ?? prevBal.unit,
            adjustmentsNet: roundQuantity(prevBal.adjustmentsNet + signedDelta),
            currentBalance: recheck.sanitized.newBalance,
            minimumStockLevel: liveMat?.minimumStockLevel ?? prevBal.minimumStockLevel,
            updatedBy: firebaseUser.uid,
            updatedByName: operatorName,
            updatedAt: serverTimestamp(),
          });
        } else {
          transaction.set(balRef, {
            id: balRef.id,
            orgId: ORG_ID,
            itemId: selectedAdjustItem.itemId,
            itemCode: liveMat?.materialCode ?? selectedAdjustItem.itemCode,
            itemName: liveMat?.name ?? selectedAdjustItem.itemName,
            stockCategory: selectedAdjustItem.category,
            unit: liveMat?.unit ?? selectedAdjustItem.unit,
            openingStock: liveMat?.openingStock ?? 0,
            receivedFromPurchases: 0,
            issuedToProduction: 0,
            receivedFromProduction: 0,
            dispatchedThroughSales: 0,
            adjustmentsNet: signedDelta,
            currentBalance: recheck.sanitized.newBalance,
            minimumStockLevel: liveMat?.minimumStockLevel ?? 0,
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
          transactionDate: recheck.sanitized.transactionDate,
          itemId: selectedAdjustItem.itemId,
          itemCode: liveMat?.materialCode ?? selectedAdjustItem.itemCode,
          itemName: liveMat?.name ?? selectedAdjustItem.itemName,
          stockCategory: selectedAdjustItem.category,
          unit: liveMat?.unit ?? selectedAdjustItem.unit,
          transactionType:
            recheck.sanitized.direction === 'In' ? 'Adjustment In' : 'Adjustment Out',
          quantityIn: recheck.sanitized.direction === 'In' ? recheck.sanitized.quantity : 0,
          quantityOut: recheck.sanitized.direction === 'Out' ? recheck.sanitized.quantity : 0,
          balance: recheck.sanitized.newBalance,
          referenceDoc: recheck.sanitized.referenceDoc,
          reason: recheck.sanitized.reason,
          userUid: firebaseUser.uid,
          userName: operatorName,
          createdAt: serverTimestamp(),
        });
      });

      setActionBanner(
        `Stock adjustment posted for ${selectedAdjustItem.itemName} and logged to inventory ledger.`,
      );
      setAdjustModalOpen(false);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.toLowerCase().includes('permission')) {
        handleFirestoreError(error, OperationType.UPDATE, `stockBalances/${selectedAdjustItem.balanceId}`);
      }
      setAdjustError(msg || 'Failed to adjust stock.');
    } finally {
      setAdjusting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-[#3B4F4E]">Procurement & Production</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#3B4F4E]">
            Inventory & Stock Ledger
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Real-time balances across raw materials, WIP, finished goods, and damaged stock with an
            immutable movement ledger.
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {canManage && (
            <button
              type="button"
              onClick={() => openAdjustModal()}
              disabled={rawMaterials.length === 0 && products.length === 0}
              className="min-h-[40px] inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#CF9C2D] hover:bg-[#BC8B22] disabled:bg-slate-300 disabled:cursor-not-allowed rounded-lg transition-colors whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3B4F4E]"
            >
              <SlidersHorizontal className="w-4 h-4 shrink-0" />
              Adjust Stock
            </button>
          )}
        </div>
      </div>

      {/* Low Stock Alert Banner */}
      {summary.lowStockCount > 0 && (
        <div
          role="status"
          className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-amber-900">
                Low-Stock Alert:{' '}
                <span className="font-mono tabular-nums">{summary.lowStockCount}</span> raw{' '}
                {summary.lowStockCount === 1 ? 'material' : 'materials'} at or below minimum level
              </p>
              <p className="text-xs text-amber-800 mt-0.5">
                Replenish low-stock items before scheduling dependent production runs.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              setActiveTab('balances');
              setCategoryFilter('raw_material');
              setLowStockOnly((prev) => !prev);
            }}
            className="min-h-[34px] px-3 py-1.5 text-xs font-medium text-amber-900 bg-white hover:bg-amber-100 border border-amber-300 rounded-lg transition-colors whitespace-nowrap self-start sm:self-auto"
          >
            {lowStockOnly ? 'Show All Stock' : 'Filter Low Stock'}
          </button>
        </div>
      )}

      {actionBanner && (
        <div
          role="status"
          className="bg-emerald-50 border border-emerald-200 rounded-xl p-3.5 flex items-center justify-between gap-3 text-xs text-emerald-900"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
            <span>{actionBanner}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionBanner(null)}
            className="text-emerald-700 hover:text-emerald-900"
            aria-label="Dismiss message"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {loadError && (
        <div
          role="alert"
          className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3 text-sm text-red-800"
        >
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
          <span>{loadError}</span>
        </div>
      )}

      {/* KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white border border-[#DCE6E6] rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500">Raw Material SKUs</p>
          <p className="mt-2 text-2xl font-semibold font-mono tabular-nums text-[#3B4F4E]">
            {summary.rawCount}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            <span className="font-mono tabular-nums">{summary.lowStockCount}</span> below minimum
            threshold
          </p>
        </div>

        <div className="bg-white border border-[#DCE6E6] rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500">Work in Progress (WIP)</p>
          <p className="mt-2 text-2xl font-semibold font-mono tabular-nums text-[#3B4F4E]">
            {summary.wipPackets} pkts
          </p>
          <p className="mt-1 text-xs text-slate-500">Active batches on production floor</p>
        </div>

        <div className="bg-white border border-[#DCE6E6] rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500">Finished Goods Stock</p>
          <p className="mt-2 text-2xl font-semibold font-mono tabular-nums text-emerald-700">
            {summary.finishedPackets} pkts
          </p>
          <p className="mt-1 text-xs text-slate-500">Ready for sales dispatch</p>
        </div>

        <div className="bg-white border border-[#DCE6E6] rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500">Damaged / Rejected Stock</p>
          <p
            className={`mt-2 text-2xl font-semibold font-mono tabular-nums ${
              summary.damagedCount > 0 ? 'text-amber-700' : 'text-[#3B4F4E]'
            }`}
          >
            {summary.damagedCount}
          </p>
          <p className="mt-1 text-xs text-slate-500">Segregated packets & materials</p>
        </div>
      </div>

      {/* Tabs */}
      <div
        role="tablist"
        aria-label="Inventory views"
        className="inline-flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'balances'}
          onClick={() => setActiveTab('balances')}
          className={`px-4 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap inline-flex items-center gap-2 ${
            activeTab === 'balances'
              ? 'bg-white text-[#3B4F4E] shadow-xs'
              : 'text-slate-600 hover:text-[#3B4F4E]'
          }`}
        >
          <Boxes className="w-3.5 h-3.5 shrink-0" />
          Stock Balances ({unifiedBalances.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'ledger'}
          onClick={() => setActiveTab('ledger')}
          className={`px-4 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap inline-flex items-center gap-2 ${
            activeTab === 'ledger'
              ? 'bg-white text-[#3B4F4E] shadow-xs'
              : 'text-slate-600 hover:text-[#3B4F4E]'
          }`}
        >
          <ClipboardList className="w-3.5 h-3.5 shrink-0" />
          Transaction Ledger ({ledgerEntries.length})
        </button>
      </div>

      {activeTab === 'balances' ? (
        <div className="bg-white border border-[#DCE6E6] rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-[#DCE6E6] flex flex-col xl:flex-row xl:items-center justify-between gap-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 flex-1">
              <div className="relative flex-1 max-w-sm">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="search"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search item code, name, or stock category..."
                  aria-label="Search stock balances"
                  className="w-full h-9 pl-9 pr-3 text-sm text-[#3B4F4E] bg-slate-50 border border-[#DCE6E6] rounded-lg placeholder:text-slate-400 focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#CF9C2D]"
                />
              </div>

              <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={lowStockOnly}
                  onChange={(e) => setLowStockOnly(e.target.checked)}
                  className="rounded border-slate-300 text-[#3B4F4E] focus:ring-[#CF9C2D]"
                />
                Low-stock alerts only
              </label>
            </div>

            <div
              role="tablist"
              aria-label="Filter by stock category"
              className="inline-flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg self-start xl:self-auto"
            >
              {(
                [
                  { id: 'All', label: 'All' },
                  { id: 'raw_material', label: 'Raw Materials' },
                  { id: 'wip', label: 'WIP' },
                  { id: 'finished_goods', label: 'Finished Goods' },
                  { id: 'damaged', label: 'Damaged' },
                ] as const
              ).map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  role="tab"
                  aria-selected={categoryFilter === cat.id}
                  onClick={() => setCategoryFilter(cat.id)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    categoryFilter === cat.id
                      ? 'bg-white text-[#3B4F4E] shadow-xs'
                      : 'text-slate-600 hover:text-[#3B4F4E]'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#DCE6E6] bg-slate-50/70">
                  <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 whitespace-nowrap">
                    Code
                  </th>
                  <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 whitespace-nowrap">
                    Item Name
                  </th>
                  <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 whitespace-nowrap">
                    Category
                  </th>
                  <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 text-right whitespace-nowrap">
                    Opening
                  </th>
                  <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 text-right whitespace-nowrap">
                    In (Purch / Prod)
                  </th>
                  <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 text-right whitespace-nowrap">
                    Out (Prod / Sales)
                  </th>
                  <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 text-right whitespace-nowrap">
                    Adj. Net
                  </th>
                  <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 text-right whitespace-nowrap">
                    Current Balance
                  </th>
                  <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 whitespace-nowrap">
                    Status
                  </th>
                  {canManage && (
                    <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 text-right whitespace-nowrap">
                      Action
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {loading ? (
                  <tr>
                    <td colSpan={canManage ? 10 : 9} className="px-5 py-12 text-center text-sm text-slate-500">
                      Loading stock balances from Cloud Firestore...
                    </td>
                  </tr>
                ) : filteredBalances.length === 0 ? (
                  <tr>
                    <td colSpan={canManage ? 10 : 9} className="px-6 py-16 text-center">
                      <div className="max-w-md mx-auto flex flex-col items-center">
                        <div className="w-11 h-11 rounded-xl bg-slate-100 border border-[#DCE6E6] flex items-center justify-center text-slate-500 mb-4">
                          <Boxes className="w-5 h-5" />
                        </div>
                        <h2 className="text-base font-semibold text-[#3B4F4E]">
                          {unifiedBalances.length === 0
                            ? 'No inventory stock balances yet'
                            : 'No matching stock items'}
                        </h2>
                        <p className="mt-1.5 text-sm text-slate-600">
                          {unifiedBalances.length === 0
                            ? 'Stock balances populate automatically as raw materials, purchases, and production runs are recorded.'
                            : 'Adjust your search query or category filter.'}
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredBalances.map((b) => {
                    const isLow =
                      b.stockCategory === 'raw_material' && b.currentBalance <= b.minimumStockLevel;
                    const totalIn = roundQuantity(
                      b.receivedFromPurchases + b.receivedFromProduction,
                    );
                    const totalOut = roundQuantity(b.issuedToProduction + b.dispatchedThroughSales);
                    return (
                      <tr
                        key={b.id}
                        className={`transition-colors ${
                          isLow ? 'bg-amber-50/40 hover:bg-amber-50/70' : 'hover:bg-slate-50/70'
                        }`}
                      >
                        <td className="px-5 py-3.5 font-mono text-xs font-medium text-[#3B4F4E] whitespace-nowrap">
                          {b.itemCode}
                        </td>
                        <td className="px-5 py-3.5 text-sm font-medium text-[#3B4F4E] whitespace-nowrap">
                          {b.itemName}
                        </td>
                        <td className="px-5 py-3.5 text-xs text-slate-600 whitespace-nowrap">
                          {CATEGORY_LABELS[b.stockCategory]}
                        </td>
                        <td className="px-5 py-3.5 font-mono text-xs text-slate-600 text-right tabular-nums whitespace-nowrap">
                          {b.openingStock} {b.unit}
                        </td>
                        <td className="px-5 py-3.5 font-mono text-xs text-emerald-700 text-right tabular-nums whitespace-nowrap">
                          +{totalIn} {b.unit}
                        </td>
                        <td className="px-5 py-3.5 font-mono text-xs text-slate-700 text-right tabular-nums whitespace-nowrap">
                          -{totalOut} {b.unit}
                        </td>
                        <td className="px-5 py-3.5 font-mono text-xs text-slate-600 text-right tabular-nums whitespace-nowrap">
                          {b.adjustmentsNet > 0 ? '+' : ''}
                          {b.adjustmentsNet}
                        </td>
                        <td
                          className={`px-5 py-3.5 font-mono text-sm font-semibold text-right tabular-nums whitespace-nowrap ${
                            isLow ? 'text-amber-800' : 'text-[#3B4F4E]'
                          }`}
                        >
                          {b.currentBalance} {b.unit}
                        </td>
                        <td className="px-5 py-3.5 text-xs font-medium whitespace-nowrap">
                          {isLow ? (
                            <span className="inline-flex items-center gap-1.5 text-amber-700">
                              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                              Low (Min {b.minimumStockLevel})
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-emerald-700">
                              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                              Nominal
                            </span>
                          )}
                        </td>
                        {canManage && (
                          <td className="px-5 py-3.5 text-right whitespace-nowrap">
                            {b.stockCategory !== 'wip' ? (
                              <button
                                type="button"
                                onClick={() => openAdjustModal(b)}
                                className="min-h-[30px] inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-[#DCE6E6] rounded-md transition-colors"
                              >
                                <SlidersHorizontal className="w-3 h-3 text-slate-500" />
                                Adjust
                              </button>
                            ) : (
                              <span className="text-[11px] text-slate-400">Batch managed</span>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* Inventory Ledger Tab */
        <div className="bg-white border border-[#DCE6E6] rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-[#DCE6E6] flex flex-col xl:flex-row xl:items-center justify-between gap-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 flex-1">
              <div className="relative flex-1 max-w-sm">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="search"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search item, reference doc, reason, or operator..."
                  aria-label="Search inventory ledger"
                  className="w-full h-9 pl-9 pr-3 text-sm text-[#3B4F4E] bg-slate-50 border border-[#DCE6E6] rounded-lg placeholder:text-slate-400 focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#CF9C2D]"
                />
              </div>

              <select
                aria-label="Filter by transaction type"
                value={txTypeFilter}
                onChange={(e) => setTxTypeFilter(e.target.value as TxTypeFilter)}
                className="h-9 px-3 text-xs font-medium text-slate-700 bg-slate-50 border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
              >
                <option value="All">All Transaction Types</option>
                {LEDGER_TRANSACTION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            <span className="text-xs font-mono tabular-nums text-slate-500 whitespace-nowrap">
              {filteredLedger.length} ledger entries
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#DCE6E6] bg-slate-50/70">
                  <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 whitespace-nowrap">
                    Date
                  </th>
                  <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 whitespace-nowrap">
                    Material / Product
                  </th>
                  <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 whitespace-nowrap">
                    Transaction Type
                  </th>
                  <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 text-right whitespace-nowrap">
                    Qty In
                  </th>
                  <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 text-right whitespace-nowrap">
                    Qty Out
                  </th>
                  <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 text-right whitespace-nowrap">
                    Balance
                  </th>
                  <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 whitespace-nowrap">
                    Reference Doc
                  </th>
                  <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 whitespace-nowrap">
                    User Responsible
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {loading ? (
                  <tr>
                    <td colSpan={8} className="px-5 py-12 text-center text-sm text-slate-500">
                      Loading inventory transaction history from Cloud Firestore...
                    </td>
                  </tr>
                ) : filteredLedger.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-6 py-16 text-center">
                      <div className="max-w-md mx-auto flex flex-col items-center">
                        <div className="w-11 h-11 rounded-xl bg-slate-100 border border-[#DCE6E6] flex items-center justify-center text-slate-500 mb-4">
                          <ClipboardList className="w-5 h-5" />
                        </div>
                        <h2 className="text-base font-semibold text-[#3B4F4E]">
                          {ledgerEntries.length === 0
                            ? 'No inventory ledger entries yet'
                            : 'No matching ledger entries'}
                        </h2>
                        <p className="mt-1.5 text-sm text-slate-600">
                          {ledgerEntries.length === 0
                            ? 'Every opening balance, purchase receipt, production movement, and stock adjustment writes an immutable audit entry here.'
                            : 'Adjust your search query or transaction type filter.'}
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredLedger.map((entry) => (
                    <tr key={entry.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="px-5 py-3.5 font-mono text-xs text-slate-600 tabular-nums whitespace-nowrap">
                        {entry.transactionDate}
                      </td>
                      <td className="px-5 py-3.5 min-w-[200px]">
                        <p className="text-sm font-medium text-[#3B4F4E]">{entry.itemName}</p>
                        <p className="text-xs text-slate-500 font-mono">
                          {entry.itemCode} · {CATEGORY_LABELS[entry.stockCategory]}
                        </p>
                      </td>
                      <td className="px-5 py-3.5 text-xs whitespace-nowrap">
                        <p className="font-medium text-[#3B4F4E] inline-flex items-center gap-1.5">
                          {entry.quantityIn > 0 ? (
                            <ArrowDownLeft className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                          ) : (
                            <ArrowUpRight className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                          )}
                          {entry.transactionType}
                        </p>
                        {entry.reason && (
                          <p className="text-[11px] text-slate-500 truncate max-w-[240px]">
                            {entry.reason}
                          </p>
                        )}
                      </td>
                      <td className="px-5 py-3.5 font-mono text-xs font-medium text-emerald-700 text-right tabular-nums whitespace-nowrap">
                        {entry.quantityIn > 0 ? `+${entry.quantityIn} ${entry.unit}` : '—'}
                      </td>
                      <td className="px-5 py-3.5 font-mono text-xs font-medium text-amber-700 text-right tabular-nums whitespace-nowrap">
                        {entry.quantityOut > 0 ? `-${entry.quantityOut} ${entry.unit}` : '—'}
                      </td>
                      <td className="px-5 py-3.5 font-mono text-xs font-semibold text-[#3B4F4E] text-right tabular-nums whitespace-nowrap">
                        {entry.balance} {entry.unit}
                      </td>
                      <td className="px-5 py-3.5 font-mono text-xs text-slate-700 whitespace-nowrap">
                        {entry.referenceDoc}
                      </td>
                      <td className="px-5 py-3.5 text-xs text-slate-700 whitespace-nowrap">
                        {entry.userName}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Stock Adjustment Modal */}
      {adjustModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="adjust-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/50 overflow-y-auto"
        >
          <div className="w-full max-w-lg bg-white border border-[#DCE6E6] rounded-xl overflow-hidden my-8">
            <div className="px-6 py-4 border-b border-[#DCE6E6] flex items-center justify-between">
              <div>
                <h2 id="adjust-modal-title" className="text-base font-semibold text-[#3B4F4E]">
                  Stock Adjustment
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Updates stock atomically, prevents negative balances, and writes an audit ledger
                  entry.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAdjustModalOpen(false)}
                aria-label="Close modal"
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={(e) => void handleConfirmAdjustment(e)} className="p-6 space-y-4">
              {adjustError && (
                <div
                  role="alert"
                  className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-start gap-2"
                >
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{adjustError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="adj-cat" className="block text-xs font-medium text-slate-700 mb-1">
                    Stock Category *
                  </label>
                  <select
                    id="adj-cat"
                    value={adjustTargetType}
                    onChange={(e) => {
                      setAdjustTargetType(
                        e.target.value as 'raw_material' | 'finished_goods' | 'damaged',
                      );
                      setAdjustItemId('');
                    }}
                    className="w-full h-9 px-3 text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                  >
                    <option value="raw_material">Raw Material</option>
                    <option value="finished_goods">Finished Goods</option>
                    <option value="damaged">Damaged / Rejected</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="adj-dir" className="block text-xs font-medium text-slate-700 mb-1">
                    Adjustment Type *
                  </label>
                  <select
                    id="adj-dir"
                    value={adjustDirection}
                    onChange={(e) => setAdjustDirection(e.target.value as 'In' | 'Out')}
                    className="w-full h-9 px-3 text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                  >
                    <option value="In">Adjustment In (+)</option>
                    <option value="Out">Adjustment Out (-)</option>
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="adj-item" className="block text-xs font-medium text-slate-700 mb-1">
                  Material / Product *
                </label>
                <select
                  id="adj-item"
                  required
                  value={selectedAdjustItem?.balanceId ?? ''}
                  onChange={(e) => setAdjustItemId(e.target.value)}
                  className="w-full h-9 px-3 text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                >
                  {adjustableItems.length === 0 ? (
                    <option value="">No items available in this category</option>
                  ) : (
                    adjustableItems.map((item) => (
                      <option key={item.balanceId} value={item.balanceId}>
                        {item.itemName} ({item.itemCode}) — Bal: {item.currentBalance} {item.unit}
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label htmlFor="adj-qty" className="block text-xs font-medium text-slate-700 mb-1">
                    Quantity ({selectedAdjustItem?.unit ?? 'units'}) *
                  </label>
                  <input
                    id="adj-qty"
                    type="number"
                    required
                    min="0.001"
                    step="0.001"
                    value={adjustQty}
                    onChange={(e) => setAdjustQty(e.target.value)}
                    placeholder="10"
                    className="w-full h-9 px-3 font-mono text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                  />
                </div>

                <div>
                  <label htmlFor="adj-date" className="block text-xs font-medium text-slate-700 mb-1">
                    Date *
                  </label>
                  <input
                    id="adj-date"
                    type="date"
                    required
                    value={adjustDate}
                    onChange={(e) => setAdjustDate(e.target.value)}
                    className="w-full h-9 px-3 font-mono text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                  />
                </div>

                <div>
                  <label htmlFor="adj-ref" className="block text-xs font-medium text-slate-700 mb-1">
                    Reference Doc *
                  </label>
                  <input
                    id="adj-ref"
                    type="text"
                    required
                    maxLength={60}
                    value={adjustRefDoc}
                    onChange={(e) => setAdjustRefDoc(e.target.value.toUpperCase())}
                    className="w-full h-9 px-3 font-mono text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="adj-reason" className="block text-xs font-medium text-slate-700 mb-1">
                  Audit Reason *
                </label>
                <input
                  id="adj-reason"
                  type="text"
                  required
                  maxLength={300}
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  placeholder="Cycle count reconciliation, spoilage write-off, or sample test"
                  className="w-full h-9 px-3 text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                />
              </div>

              <div className="pt-4 border-t border-[#DCE6E6] flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setAdjustModalOpen(false)}
                  className="min-h-[38px] px-4 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-[#DCE6E6] rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={adjusting || !selectedAdjustItem}
                  className="min-h-[38px] px-4 py-2 text-xs font-medium text-white bg-[#CF9C2D] hover:bg-[#BC8B22] disabled:bg-slate-300 rounded-lg"
                >
                  {adjusting ? 'Posting Adjustment...' : 'Post Stock Adjustment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
