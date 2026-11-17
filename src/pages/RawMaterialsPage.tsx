import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Edit3,
  Plus,
  Search,
  Trash2,
  Wheat,
  X,
} from 'lucide-react';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  where,
  writeBatch,
} from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../lib/firebase';
import { handleFirestoreError, OperationType } from '../lib/firestoreError';
import {
  BLUEPRINT_CONSTRAINTS,
  roundQuantity,
  validateRawMaterialInput,
} from '../lib/validation';
import {
  MATERIAL_CATEGORIES,
  MATERIAL_UNITS,
  ORG_ID,
  type MaterialUnit,
  type RawMaterial,
  type StockBalance,
} from '../types/erp';

function getTodayIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

type StockAlertFilter = 'All' | 'Low Stock' | 'In Stock';

const INITIAL_FORM = {
  name: '',
  materialCode: '',
  category: MATERIAL_CATEGORIES[0],
  unit: 'kg' as MaterialUnit,
  openingStock: '',
  currentStock: '',
  purchasePrice: '',
  minimumStockLevel: '',
};

export function RawMaterialsPage() {
  const { firebaseUser, userProfile, effectiveRole } = useAuth();
  const activeRole = effectiveRole ?? userProfile?.role ?? 'Salesman';
  const canManage =
    activeRole === 'Owner' ||
    activeRole === 'Admin' ||
    activeRole === 'Production Supervisor';

  const [materials, setMaterials] = useState<RawMaterial[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('All');
  const [unitFilter, setUnitFilter] = useState<string>('All');
  const [stockFilter, setStockFilter] = useState<StockAlertFilter>('All');

  const [modalOpen, setModalOpen] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState<RawMaterial | null>(null);
  const [form, setForm] = useState(INITIAL_FORM);
  const [currentStockTouched, setCurrentStockTouched] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [deletingMaterial, setDeletingMaterial] = useState<RawMaterial | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!firebaseUser) return;
    setLoading(true);
    setLoadError(null);

    const q = query(collection(db, 'rawMaterials'), where('orgId', '==', ORG_ID));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const rows = snapshot.docs.map((d) => d.data() as RawMaterial);
        rows.sort((a, b) => a.name.localeCompare(b.name));
        setMaterials(rows);
        setLoading(false);
      },
      (error) => {
        setLoading(false);
        setLoadError('Unable to load raw materials from Cloud Firestore.');
        handleFirestoreError(error, OperationType.LIST, 'rawMaterials');
      },
    );

    return () => unsubscribe();
  }, [firebaseUser]);

  const lowStockCount = useMemo(
    () => materials.filter((m) => m.currentStock <= m.minimumStockLevel).length,
    [materials],
  );

  const filteredMaterials = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return materials.filter((m) => {
      const isLow = m.currentStock <= m.minimumStockLevel;
      const matchesStock =
        stockFilter === 'All' ||
        (stockFilter === 'Low Stock' && isLow) ||
        (stockFilter === 'In Stock' && !isLow);
      const matchesCategory = categoryFilter === 'All' || m.category === categoryFilter;
      const matchesUnit = unitFilter === 'All' || m.unit === unitFilter;
      const matchesSearch =
        !term ||
        m.name.toLowerCase().includes(term) ||
        m.materialCode.toLowerCase().includes(term) ||
        m.category.toLowerCase().includes(term);
      return matchesStock && matchesCategory && matchesUnit && matchesSearch;
    });
  }, [materials, searchTerm, categoryFilter, unitFilter, stockFilter]);

  const openCreateModal = () => {
    setEditingMaterial(null);
    setForm(INITIAL_FORM);
    setCurrentStockTouched(false);
    setFormError(null);
    setModalOpen(true);
  };

  const openEditModal = (material: RawMaterial) => {
    setEditingMaterial(material);
    setForm({
      name: material.name,
      materialCode: material.materialCode,
      category: material.category,
      unit: material.unit,
      openingStock: String(material.openingStock),
      currentStock: String(material.currentStock),
      purchasePrice: String(material.purchasePrice),
      minimumStockLevel: String(material.minimumStockLevel),
    });
    setCurrentStockTouched(true);
    setFormError(null);
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !canManage) return;

    const validation = validateRawMaterialInput(form);
    if (!validation.valid) {
      setFormError(validation.error);
      return;
    }

    const duplicateCode = materials.find(
      (m) =>
        m.materialCode === validation.sanitized.materialCode && m.id !== editingMaterial?.id,
    );
    if (duplicateCode) {
      setFormError(
        `Material code "${validation.sanitized.materialCode}" is already used by "${duplicateCode.name}".`,
      );
      return;
    }

    setSaving(true);
    setFormError(null);

    const operatorName = (userProfile?.displayName || 'ERP Operator').slice(
      0,
      BLUEPRINT_CONSTRAINTS.displayName.maxLength,
    );
    const todayIso = getTodayIso();

    try {
      if (editingMaterial) {
        await runTransaction(db, async (transaction) => {
          const matRef = doc(db, 'rawMaterials', editingMaterial.id);
          const balRef = doc(db, 'stockBalances', `rm_${editingMaterial.id}`);
          const [matSnap, balSnap] = await Promise.all([
            transaction.get(matRef),
            transaction.get(balRef),
          ]);
          if (!matSnap.exists()) {
            throw new Error('Raw material record no longer exists.');
          }
          const prevMat = matSnap.data() as RawMaterial;
          const stockDelta = roundQuantity(
            validation.sanitized.currentStock - prevMat.currentStock,
          );

          transaction.update(matRef, {
            ...validation.sanitized,
            updatedAt: serverTimestamp(),
          });

          if (balSnap.exists()) {
            const prevBal = balSnap.data() as StockBalance;
            transaction.update(balRef, {
              itemCode: validation.sanitized.materialCode,
              itemName: validation.sanitized.name,
              unit: validation.sanitized.unit,
              openingStock: validation.sanitized.openingStock,
              adjustmentsNet: roundQuantity(prevBal.adjustmentsNet + stockDelta),
              currentBalance: validation.sanitized.currentStock,
              minimumStockLevel: validation.sanitized.minimumStockLevel,
              updatedBy: firebaseUser.uid,
              updatedByName: operatorName,
              updatedAt: serverTimestamp(),
            });
          } else {
            transaction.set(balRef, {
              id: balRef.id,
              orgId: ORG_ID,
              itemId: editingMaterial.id,
              itemCode: validation.sanitized.materialCode,
              itemName: validation.sanitized.name,
              stockCategory: 'raw_material',
              unit: validation.sanitized.unit,
              openingStock: validation.sanitized.openingStock,
              receivedFromPurchases: 0,
              issuedToProduction: 0,
              receivedFromProduction: 0,
              dispatchedThroughSales: 0,
              adjustmentsNet: roundQuantity(
                validation.sanitized.currentStock - validation.sanitized.openingStock,
              ),
              currentBalance: validation.sanitized.currentStock,
              minimumStockLevel: validation.sanitized.minimumStockLevel,
              updatedBy: firebaseUser.uid,
              updatedByName: operatorName,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }

          if (stockDelta !== 0) {
            const ledgerRef = doc(collection(db, 'inventoryLedger'));
            transaction.set(ledgerRef, {
              id: ledgerRef.id,
              orgId: ORG_ID,
              transactionDate: todayIso,
              itemId: editingMaterial.id,
              itemCode: validation.sanitized.materialCode,
              itemName: validation.sanitized.name,
              stockCategory: 'raw_material',
              unit: validation.sanitized.unit,
              transactionType: stockDelta > 0 ? 'Adjustment In' : 'Adjustment Out',
              quantityIn: stockDelta > 0 ? stockDelta : 0,
              quantityOut: stockDelta < 0 ? Math.abs(stockDelta) : 0,
              balance: validation.sanitized.currentStock,
              referenceDoc: validation.sanitized.materialCode,
              reason: 'Raw material master stock level updated',
              userUid: firebaseUser.uid,
              userName: operatorName,
              createdAt: serverTimestamp(),
            });
          }
        });
      } else {
        const batch = writeBatch(db);
        const newRef = doc(collection(db, 'rawMaterials'));
        batch.set(newRef, {
          id: newRef.id,
          orgId: ORG_ID,
          ...validation.sanitized,
          createdBy: firebaseUser.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        const balRef = doc(db, 'stockBalances', `rm_${newRef.id}`);
        batch.set(balRef, {
          id: balRef.id,
          orgId: ORG_ID,
          itemId: newRef.id,
          itemCode: validation.sanitized.materialCode,
          itemName: validation.sanitized.name,
          stockCategory: 'raw_material',
          unit: validation.sanitized.unit,
          openingStock: validation.sanitized.openingStock,
          receivedFromPurchases: 0,
          issuedToProduction: 0,
          receivedFromProduction: 0,
          dispatchedThroughSales: 0,
          adjustmentsNet: roundQuantity(
            validation.sanitized.currentStock - validation.sanitized.openingStock,
          ),
          currentBalance: validation.sanitized.currentStock,
          minimumStockLevel: validation.sanitized.minimumStockLevel,
          updatedBy: firebaseUser.uid,
          updatedByName: operatorName,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        if (validation.sanitized.currentStock > 0) {
          const ledgerRef = doc(collection(db, 'inventoryLedger'));
          batch.set(ledgerRef, {
            id: ledgerRef.id,
            orgId: ORG_ID,
            transactionDate: todayIso,
            itemId: newRef.id,
            itemCode: validation.sanitized.materialCode,
            itemName: validation.sanitized.name,
            stockCategory: 'raw_material',
            unit: validation.sanitized.unit,
            transactionType: 'Opening Stock',
            quantityIn: validation.sanitized.currentStock,
            quantityOut: 0,
            balance: validation.sanitized.currentStock,
            referenceDoc: validation.sanitized.materialCode,
            reason: 'Initial opening stock balance on material registration',
            userUid: firebaseUser.uid,
            userName: operatorName,
            createdAt: serverTimestamp(),
          });
        }

        await batch.commit();
      }
      setModalOpen(false);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.toLowerCase().includes('permission')) {
        handleFirestoreError(
          error,
          editingMaterial ? OperationType.UPDATE : OperationType.CREATE,
          editingMaterial ? `rawMaterials/${editingMaterial.id}` : 'rawMaterials',
        );
      }
      setFormError('Failed to save raw material to Cloud Firestore. Please verify inputs and retry.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingMaterial || !canManage) return;
    setDeleting(true);
    setDeleteError(null);

    try {
      await deleteDoc(doc(db, 'rawMaterials', deletingMaterial.id));
      setDeletingMaterial(null);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.toLowerCase().includes('permission')) {
        handleFirestoreError(error, OperationType.DELETE, `rawMaterials/${deletingMaterial.id}`);
      }
      setDeleteError('Failed to delete raw material from Cloud Firestore.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-[#3B4F4E]">Master Data</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#3B4F4E]">
            Raw Materials
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Ingredients, cooking oils, seasonings, and packaging stock with minimum reorder alerts.
          </p>
        </div>

        <div className="flex items-center gap-4 shrink-0">
          <div className="hidden sm:block text-right text-xs text-slate-500">
            <span className="font-mono tabular-nums font-medium text-[#3B4F4E]">
              {materials.length}
            </span>{' '}
            materials ·{' '}
            <span
              className={`font-mono tabular-nums font-medium ${
                lowStockCount > 0 ? 'text-amber-700' : 'text-emerald-700'
              }`}
            >
              {lowStockCount}
            </span>{' '}
            low stock
          </div>

          {canManage && (
            <button
              type="button"
              onClick={openCreateModal}
              className="min-h-[40px] inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#CF9C2D] hover:bg-[#BC8B22] rounded-lg transition-colors whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3B4F4E]"
            >
              <Plus className="w-4 h-4 shrink-0" />
              Add Raw Material
            </button>
          )}
        </div>
      </div>

      {/* Live Low-Stock Alert Banner */}
      {lowStockCount > 0 && (
        <div
          role="status"
          className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-amber-900">
                Low-Stock Alert: <span className="font-mono tabular-nums">{lowStockCount}</span>{' '}
                {lowStockCount === 1 ? 'material' : 'materials'} at or below minimum stock level
              </p>
              <p className="text-xs text-amber-800 mt-0.5">
                Review highlighted rows below to plan supplier replenishment purchases.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setStockFilter(stockFilter === 'Low Stock' ? 'All' : 'Low Stock')}
            className="min-h-[34px] px-3 py-1.5 text-xs font-medium text-amber-900 bg-white hover:bg-amber-100 border border-amber-300 rounded-lg transition-colors whitespace-nowrap self-start sm:self-auto"
          >
            {stockFilter === 'Low Stock' ? 'Show All Materials' : 'View Low Stock Only'}
          </button>
        </div>
      )}

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
                placeholder="Search by material name, code, or category..."
                aria-label="Search raw materials"
                className="w-full h-9 pl-9 pr-3 text-sm text-[#3B4F4E] bg-slate-50 border border-[#DCE6E6] rounded-lg placeholder:text-slate-400 focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#CF9C2D]"
              />
            </div>

            <select
              aria-label="Filter by category"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="h-9 px-3 text-xs font-medium text-slate-700 bg-slate-50 border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
            >
              <option value="All">All Categories</option>
              {MATERIAL_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>

            <select
              aria-label="Filter by unit"
              value={unitFilter}
              onChange={(e) => setUnitFilter(e.target.value)}
              className="h-9 px-3 text-xs font-medium text-slate-700 bg-slate-50 border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
            >
              <option value="All">All Units</option>
              {MATERIAL_UNITS.map((unit) => (
                <option key={unit} value={unit}>
                  {unit}
                </option>
              ))}
            </select>
          </div>

          <div
            role="tablist"
            aria-label="Filter by stock level"
            className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg self-start xl:self-auto"
          >
            {(['All', 'Low Stock', 'In Stock'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={stockFilter === tab}
                onClick={() => setStockFilter(tab)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  stockFilter === tab
                    ? 'bg-white text-[#3B4F4E] shadow-xs'
                    : 'text-slate-600 hover:text-[#3B4F4E]'
                }`}
              >
                {tab}
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
                  Material Name
                </th>
                <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 whitespace-nowrap">
                  Category
                </th>
                <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 text-right whitespace-nowrap">
                  Opening Stock
                </th>
                <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 text-right whitespace-nowrap">
                  Current Stock
                </th>
                <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 text-right whitespace-nowrap">
                  Min Level
                </th>
                <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 text-right whitespace-nowrap">
                  Price / Unit
                </th>
                <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 whitespace-nowrap">
                  Stock Alert
                </th>
                {canManage && (
                  <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 text-right whitespace-nowrap">
                    Actions
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {loading ? (
                <tr>
                  <td colSpan={canManage ? 9 : 8} className="px-5 py-12 text-center text-sm text-slate-500">
                    Loading raw materials from Cloud Firestore...
                  </td>
                </tr>
              ) : filteredMaterials.length === 0 ? (
                <tr>
                  <td colSpan={canManage ? 9 : 8} className="px-6 py-16 text-center">
                    <div className="max-w-md mx-auto flex flex-col items-center">
                      <div className="w-11 h-11 rounded-xl bg-slate-100 border border-[#DCE6E6] flex items-center justify-center text-slate-500 mb-4">
                        <Wheat className="w-5 h-5" />
                      </div>
                      <h2 className="text-base font-semibold text-[#3B4F4E]">
                        {materials.length === 0
                          ? 'No raw materials cataloged yet'
                          : 'No matching raw materials'}
                      </h2>
                      <p className="mt-1.5 text-sm text-slate-600">
                        {materials.length === 0
                          ? 'Register ingredients, oils, seasonings, and packaging with stock thresholds.'
                          : 'Adjust your search or stock alert filter to view other materials.'}
                      </p>
                      {materials.length === 0 && canManage && (
                        <button
                          type="button"
                          onClick={openCreateModal}
                          className="mt-4 min-h-[38px] inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-[#CF9C2D] hover:bg-[#BC8B22] rounded-lg transition-colors whitespace-nowrap"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          Add First Raw Material
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                filteredMaterials.map((material) => {
                  const isLow = material.currentStock <= material.minimumStockLevel;
                  return (
                    <tr
                      key={material.id}
                      className={`transition-colors ${
                        isLow ? 'bg-amber-50/40 hover:bg-amber-50/70' : 'hover:bg-slate-50/70'
                      }`}
                    >
                      <td className="px-5 py-3.5 font-mono text-xs font-medium text-[#3B4F4E] whitespace-nowrap">
                        {material.materialCode}
                      </td>
                      <td className="px-5 py-3.5 text-sm font-medium text-[#3B4F4E] whitespace-nowrap">
                        {material.name}
                      </td>
                      <td className="px-5 py-3.5 text-sm text-slate-600 whitespace-nowrap">
                        {material.category}
                      </td>
                      <td className="px-5 py-3.5 font-mono text-xs text-slate-600 text-right tabular-nums whitespace-nowrap">
                        {material.openingStock} {material.unit}
                      </td>
                      <td
                        className={`px-5 py-3.5 font-mono text-sm font-semibold text-right tabular-nums whitespace-nowrap ${
                          isLow ? 'text-amber-800' : 'text-[#3B4F4E]'
                        }`}
                      >
                        {material.currentStock} {material.unit}
                      </td>
                      <td className="px-5 py-3.5 font-mono text-xs text-slate-600 text-right tabular-nums whitespace-nowrap">
                        {material.minimumStockLevel} {material.unit}
                      </td>
                      <td className="px-5 py-3.5 font-mono text-xs text-slate-800 text-right tabular-nums whitespace-nowrap">
                        ₹{material.purchasePrice.toFixed(2)} / {material.unit}
                      </td>
                      <td className="px-5 py-3.5 text-xs font-medium whitespace-nowrap">
                        {isLow ? (
                          <span className="inline-flex items-center gap-1.5 text-amber-700">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                            Low Stock
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-emerald-700">
                            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                            In Stock
                          </span>
                        )}
                      </td>
                      {canManage && (
                        <td className="px-5 py-3.5 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => openEditModal(material)}
                              className="min-h-[32px] inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-[#DCE6E6] rounded-md transition-colors"
                            >
                              <Edit3 className="w-3.5 h-3.5 text-slate-500" />
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setDeleteError(null);
                                setDeletingMaterial(material);
                              }}
                              className="min-h-[32px] inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-red-700 bg-white hover:bg-red-50 border border-[#DCE6E6] rounded-md transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              Delete
                            </button>
                          </div>
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

      {/* Add / Edit Raw Material Modal */}
      {modalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="material-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/50 overflow-y-auto"
        >
          <div className="w-full max-w-lg bg-white border border-[#DCE6E6] rounded-xl overflow-hidden my-8">
            <div className="px-6 py-4 border-b border-[#DCE6E6] flex items-center justify-between">
              <h2 id="material-modal-title" className="text-base font-semibold text-[#3B4F4E]">
                {editingMaterial ? 'Edit Raw Material' : 'Add Raw Material'}
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

            <form onSubmit={(e) => void handleSubmit(e)} className="p-6 space-y-4">
              {formError && (
                <div role="alert" className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="rm-name" className="block text-xs font-medium text-slate-700 mb-1">
                    Material Name *
                  </label>
                  <input
                    id="rm-name"
                    type="text"
                    required
                    maxLength={BLUEPRINT_CONSTRAINTS.masterName.maxLength}
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="Refined Palmolein Oil"
                    className="w-full h-9 px-3 text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                  />
                </div>

                <div>
                  <label htmlFor="rm-code" className="block text-xs font-medium text-slate-700 mb-1">
                    Unique Material Code *
                  </label>
                  <input
                    id="rm-code"
                    type="text"
                    required
                    maxLength={BLUEPRINT_CONSTRAINTS.code.maxLength}
                    value={form.materialCode}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, materialCode: e.target.value.toUpperCase() }))
                    }
                    placeholder="RM-OIL-001"
                    className="w-full h-9 px-3 font-mono text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="rm-category" className="block text-xs font-medium text-slate-700 mb-1">
                    Category *
                  </label>
                  <select
                    id="rm-category"
                    value={form.category}
                    onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                    className="w-full h-9 px-3 text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                  >
                    {MATERIAL_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="rm-unit" className="block text-xs font-medium text-slate-700 mb-1">
                    Unit *
                  </label>
                  <select
                    id="rm-unit"
                    value={form.unit}
                    onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value as MaterialUnit }))}
                    className="w-full h-9 px-3 text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                  >
                    {MATERIAL_UNITS.map((unit) => (
                      <option key={unit} value={unit}>
                        {unit}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="rm-opening" className="block text-xs font-medium text-slate-700 mb-1">
                    Opening Stock ({form.unit}) *
                  </label>
                  <input
                    id="rm-opening"
                    type="number"
                    required
                    min="0"
                    step="0.001"
                    value={form.openingStock}
                    onChange={(e) => {
                      const val = e.target.value;
                      setForm((f) => ({
                        ...f,
                        openingStock: val,
                        currentStock: !editingMaterial && !currentStockTouched ? val : f.currentStock,
                      }));
                    }}
                    placeholder="0"
                    className="w-full h-9 px-3 font-mono text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                  />
                </div>

                <div>
                  <label htmlFor="rm-current" className="block text-xs font-medium text-slate-700 mb-1">
                    Current Stock ({form.unit}) *
                  </label>
                  <input
                    id="rm-current"
                    type="number"
                    required
                    min="0"
                    step="0.001"
                    value={form.currentStock}
                    onChange={(e) => {
                      setCurrentStockTouched(true);
                      setForm((f) => ({ ...f, currentStock: e.target.value }));
                    }}
                    placeholder="0"
                    className="w-full h-9 px-3 font-mono text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="rm-price" className="block text-xs font-medium text-slate-700 mb-1">
                    Purchase Price / {form.unit} (₹) *
                  </label>
                  <input
                    id="rm-price"
                    type="number"
                    required
                    min="0"
                    step="0.01"
                    value={form.purchasePrice}
                    onChange={(e) => setForm((f) => ({ ...f, purchasePrice: e.target.value }))}
                    placeholder="115.00"
                    className="w-full h-9 px-3 font-mono text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                  />
                </div>

                <div>
                  <label htmlFor="rm-min" className="block text-xs font-medium text-slate-700 mb-1">
                    Minimum Stock Level ({form.unit}) *
                  </label>
                  <input
                    id="rm-min"
                    type="number"
                    required
                    min="0"
                    step="0.001"
                    value={form.minimumStockLevel}
                    onChange={(e) => setForm((f) => ({ ...f, minimumStockLevel: e.target.value }))}
                    placeholder="50"
                    className="w-full h-9 px-3 font-mono text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                  />
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
                    : editingMaterial
                      ? 'Update Raw Material'
                      : 'Save Raw Material'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletingMaterial && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-material-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/50"
        >
          <div className="w-full max-w-md bg-white border border-[#DCE6E6] rounded-xl p-6 space-y-4">
            <h2 id="delete-material-title" className="text-base font-semibold text-[#3B4F4E]">
              Delete Raw Material
            </h2>
            <p className="text-sm text-slate-600">
              Permanently remove{' '}
              <span className="font-semibold text-[#3B4F4E]">{deletingMaterial.name}</span> (
              <span className="font-mono text-xs">{deletingMaterial.materialCode}</span>) from
              Firestore?
            </p>
            {deleteError && (
              <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
                {deleteError}
              </p>
            )}
            <div className="pt-2 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeletingMaterial(null)}
                className="min-h-[38px] px-4 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-[#DCE6E6] rounded-lg whitespace-nowrap"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleDelete()}
                disabled={deleting}
                className="min-h-[38px] px-4 py-2 text-xs font-medium text-white bg-red-600 hover:bg-red-700 disabled:bg-red-400 rounded-lg whitespace-nowrap"
              >
                {deleting ? 'Deleting...' : 'Delete Material'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
