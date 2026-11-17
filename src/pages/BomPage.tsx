import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  CopyPlus,
  Edit3,
  Eye,
  Layers,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../lib/firebase';
import { handleFirestoreError, OperationType } from '../lib/firestoreError';
import {
  BLUEPRINT_CONSTRAINTS,
  convertBomQuantityToStockUnit,
  getCompatibleBomUnits,
  roundCurrency,
  roundQuantity,
  validateBomInput,
  type BomLineDraft,
} from '../lib/validation';
import {
  BOM_STATUSES,
  ORG_ID,
  type Bom,
  type BomItem,
  type BomStatus,
  type BomUnit,
  type Product,
  type RawMaterial,
} from '../types/erp';

type BomStatusFilter = 'All' | BomStatus;

function suggestBomCode(product: Product | undefined, version: number): string {
  const base = product?.sku ? `BOM-${product.sku}` : 'BOM-NEW';
  const suffix = `-V${version}`;
  return `${base.slice(0, 40 - suffix.length)}${suffix}`;
}

export function BomPage() {
  const { firebaseUser, userProfile, effectiveRole } = useAuth();
  const activeRole = effectiveRole ?? userProfile?.role ?? 'Salesman';
  const canManage =
    activeRole === 'Owner' ||
    activeRole === 'Admin' ||
    activeRole === 'Production Supervisor';
  const canDelete = activeRole === 'Owner' || activeRole === 'Admin';

  const [boms, setBoms] = useState<Bom[]>([]);
  const [bomItems, setBomItems] = useState<BomItem[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [materials, setMaterials] = useState<RawMaterial[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [productFilter, setProductFilter] = useState<string>('All');
  const [statusFilter, setStatusFilter] = useState<BomStatusFilter>('All');

  // Create / Edit / Version Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingBom, setEditingBom] = useState<Bom | null>(null);
  const [bomCode, setBomCode] = useState('');
  const [productId, setProductId] = useState('');
  const [version, setVersion] = useState(1);
  const [batchSize, setBatchSize] = useState('100');
  const [status, setStatus] = useState<BomStatus>('Active');
  const [notes, setNotes] = useState('');
  const [lineItems, setLineItems] = useState<BomLineDraft[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // View Recipe Modal
  const [viewingBom, setViewingBom] = useState<Bom | null>(null);

  // Delete Confirmation Modal
  const [deletingBom, setDeletingBom] = useState<Bom | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!firebaseUser) return;
    setLoading(true);
    setLoadError(null);

    let loadedBoms = false;
    let loadedItems = false;
    const finishIfReady = () => {
      if (loadedBoms && loadedItems) setLoading(false);
    };

    const unsubBoms = onSnapshot(
      query(collection(db, 'bom'), where('orgId', '==', ORG_ID)),
      (snap) => {
        const rows = snap.docs.map((d) => d.data() as Bom);
        rows.sort((a, b) => {
          const nameCmp = a.productName.localeCompare(b.productName);
          if (nameCmp !== 0) return nameCmp;
          return b.version - a.version;
        });
        setBoms(rows);
        loadedBoms = true;
        finishIfReady();
      },
      (error) => {
        setLoading(false);
        setLoadError('Unable to load Bills of Materials from Cloud Firestore.');
        handleFirestoreError(error, OperationType.LIST, 'bom');
      },
    );

    const unsubItems = onSnapshot(
      query(collection(db, 'bomItems'), where('orgId', '==', ORG_ID)),
      (snap) => {
        setBomItems(snap.docs.map((d) => d.data() as BomItem));
        loadedItems = true;
        finishIfReady();
      },
      (error) => {
        setLoading(false);
        setLoadError('Unable to load BOM components from Cloud Firestore.');
        handleFirestoreError(error, OperationType.LIST, 'bomItems');
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
      unsubBoms();
      unsubItems();
      unsubProducts();
      unsubMaterials();
    };
  }, [firebaseUser]);

  const itemsByBomId = useMemo(() => {
    const map = new Map<string, BomItem[]>();
    bomItems.forEach((item) => {
      const list = map.get(item.bomId);
      if (list) list.push(item);
      else map.set(item.bomId, [item]);
    });
    return map;
  }, [bomItems]);

  const productMap = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const materialMap = useMemo(() => new Map(materials.map((m) => [m.id, m])), [materials]);

  const nextVersionForProduct = (targetProductId: string): number => {
    const versions = boms
      .filter((b) => b.productId === targetProductId)
      .map((b) => b.version);
    return versions.length > 0 ? Math.max(...versions) + 1 : 1;
  };

  const summary = useMemo(() => {
    const activeBoms = boms.filter((b) => b.status === 'Active');
    const coveredProducts = new Set(activeBoms.map((b) => b.productId));
    const avgCostPerUnit =
      activeBoms.length > 0
        ? roundCurrency(
            activeBoms.reduce((sum, b) => sum + b.costPerUnit, 0) / activeBoms.length,
          )
        : 0;
    return {
      totalBoms: boms.length,
      activeCount: activeBoms.length,
      coveredProductsCount: coveredProducts.size,
      avgCostPerUnit,
    };
  }, [boms]);

  const filteredBoms = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return boms.filter((bom) => {
      const matchesStatus = statusFilter === 'All' || bom.status === statusFilter;
      const matchesProduct = productFilter === 'All' || bom.productId === productFilter;
      const matchesSearch =
        !term ||
        bom.bomCode.toLowerCase().includes(term) ||
        bom.productName.toLowerCase().includes(term) ||
        bom.productSku.toLowerCase().includes(term);
      return matchesStatus && matchesProduct && matchesSearch;
    });
  }, [boms, searchTerm, productFilter, statusFilter]);

  const liveCosting = useMemo(() => {
    let totalCost = 0;
    lineItems.forEach((row) => {
      const mat = materialMap.get(row.rawMaterialId);
      const qty = Number(row.quantity);
      if (mat && Number.isFinite(qty) && qty > 0) {
        const converted = convertBomQuantityToStockUnit(qty, row.unit, mat.unit);
        if (converted !== null) {
          totalCost += roundCurrency(converted * mat.purchasePrice);
        }
      }
    });
    const batch = Number(batchSize);
    const total = roundCurrency(totalCost);
    const perUnit = Number.isFinite(batch) && batch > 0 ? roundCurrency(total / batch) : 0;
    return { total, perUnit };
  }, [lineItems, batchSize, materialMap]);

  const createEmptyLine = (defaultMaterial?: RawMaterial): BomLineDraft => {
    const mat = defaultMaterial ?? materials[0];
    return {
      rawMaterialId: mat?.id ?? '',
      quantity: '1',
      unit: mat?.unit ?? 'kg',
    };
  };

  const openCreateModal = () => {
    const defaultProduct = products[0];
    const nextVer = defaultProduct ? nextVersionForProduct(defaultProduct.id) : 1;
    setEditingBom(null);
    setProductId(defaultProduct?.id ?? '');
    setVersion(nextVer);
    setBomCode(suggestBomCode(defaultProduct, nextVer));
    setBatchSize('100');
    setStatus('Active');
    setNotes('');
    setLineItems(materials.length > 0 ? [createEmptyLine(materials[0])] : []);
    setFormError(null);
    setModalOpen(true);
  };

  const openEditModal = (bom: Bom) => {
    const items = itemsByBomId.get(bom.id) ?? [];
    setEditingBom(bom);
    setProductId(bom.productId);
    setVersion(bom.version);
    setBomCode(bom.bomCode);
    setBatchSize(String(bom.batchSize));
    setStatus(bom.status);
    setNotes(bom.notes);
    setLineItems(
      items.length > 0
        ? items.map((i) => ({
            rawMaterialId: i.rawMaterialId,
            quantity: String(i.quantity),
            unit: i.unit,
          }))
        : materials.length > 0
          ? [createEmptyLine(materials[0])]
          : [],
    );
    setFormError(null);
    setModalOpen(true);
  };

  const handleProductSelectionChange = (nextProductId: string) => {
    setProductId(nextProductId);
    if (!editingBom) {
      const prod = productMap.get(nextProductId);
      const nextVer = nextProductId ? nextVersionForProduct(nextProductId) : 1;
      setVersion(nextVer);
      setBomCode(suggestBomCode(prod, nextVer));
    }
  };

  const handleLineMaterialChange = (index: number, rawMaterialId: string) => {
    const mat = materialMap.get(rawMaterialId);
    setLineItems((prev) =>
      prev.map((row, idx) =>
        idx === index
          ? {
              ...row,
              rawMaterialId,
              unit: mat?.unit ?? row.unit,
            }
          : row,
      ),
    );
  };

  const saveBom = async (asNewVersion: boolean) => {
    if (!firebaseUser || !canManage) return;

    const targetVersion = asNewVersion
      ? nextVersionForProduct(productId)
      : version;
    const targetBomCode =
      asNewVersion && editingBom
        ? suggestBomCode(productMap.get(productId), targetVersion)
        : bomCode;
    const targetStatus: BomStatus = asNewVersion ? 'Active' : status;

    const validation = validateBomInput(
      {
        bomCode: targetBomCode,
        productId,
        version: targetVersion,
        batchSize,
        status: targetStatus,
        notes,
        items: lineItems,
      },
      products,
      materials,
    );

    if (!validation.valid) {
      setFormError(validation.error);
      return;
    }

    const duplicateCode = boms.find(
      (b) =>
        b.bomCode === validation.sanitized.bomCode &&
        (asNewVersion || b.id !== editingBom?.id),
    );
    if (duplicateCode) {
      setFormError(`BOM code "${validation.sanitized.bomCode}" already exists.`);
      return;
    }

    setSaving(true);
    setFormError(null);

    try {
      const batch = writeBatch(db);
      const { items: sanitizedItems, ...headerFields } = validation.sanitized;

      // If this BOM is Active, automatically archive older Active versions for the same product
      if (headerFields.status === 'Active') {
        boms
          .filter(
            (b) =>
              b.productId === headerFields.productId &&
              b.status === 'Active' &&
              (asNewVersion || b.id !== editingBom?.id),
          )
          .forEach((otherActive) => {
            batch.update(doc(db, 'bom', otherActive.id), {
              status: 'Archived',
              updatedAt: serverTimestamp(),
            });
          });
      }

      if (editingBom && !asNewVersion) {
        batch.update(doc(db, 'bom', editingBom.id), {
          ...headerFields,
          updatedAt: serverTimestamp(),
        });

        const existingItems = itemsByBomId.get(editingBom.id) ?? [];
        existingItems.forEach((oldItem) => {
          batch.delete(doc(db, 'bomItems', oldItem.id));
        });

        sanitizedItems.forEach((item) => {
          const itemRef = doc(collection(db, 'bomItems'));
          batch.set(itemRef, {
            id: itemRef.id,
            orgId: ORG_ID,
            bomId: editingBom.id,
            ...item,
            createdBy: firebaseUser.uid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        });
      } else {
        const bomRef = doc(collection(db, 'bom'));
        batch.set(bomRef, {
          id: bomRef.id,
          orgId: ORG_ID,
          ...headerFields,
          createdBy: firebaseUser.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        sanitizedItems.forEach((item) => {
          const itemRef = doc(collection(db, 'bomItems'));
          batch.set(itemRef, {
            id: itemRef.id,
            orgId: ORG_ID,
            bomId: bomRef.id,
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
          editingBom && !asNewVersion ? OperationType.UPDATE : OperationType.CREATE,
          editingBom && !asNewVersion ? `bom/${editingBom.id}` : 'bom',
        );
      }
      setFormError('Failed to save Bill of Materials to Cloud Firestore.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteBom = async () => {
    if (!deletingBom || !canDelete) return;
    setDeleting(true);
    setDeleteError(null);

    try {
      const batch = writeBatch(db);
      const items = itemsByBomId.get(deletingBom.id) ?? [];
      items.forEach((item) => {
        batch.delete(doc(db, 'bomItems', item.id));
      });
      batch.delete(doc(db, 'bom', deletingBom.id));
      await batch.commit();
      setDeletingBom(null);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.toLowerCase().includes('permission')) {
        handleFirestoreError(error, OperationType.DELETE, `bom/${deletingBom.id}`);
      }
      setDeleteError('Failed to delete BOM from Cloud Firestore.');
    } finally {
      setDeleting(false);
    }
  };

  const prerequisitesMissing = products.length === 0 || materials.length === 0;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-[#3B4F4E]">Master Data</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#3B4F4E]">
            Bill of Materials (BOM)
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Define product recipes, ingredient units, batch yields, version history, and estimated
            material costing.
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
                  ? 'Add at least one Finished Product and one Raw Material first'
                  : 'Create BOM'
              }
              className="min-h-[40px] inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#CF9C2D] hover:bg-[#BC8B22] disabled:bg-slate-300 disabled:cursor-not-allowed rounded-lg transition-colors whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3B4F4E]"
            >
              <Plus className="w-4 h-4 shrink-0" />
              Create BOM
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
            <p className="font-semibold">Products and Raw Materials Required</p>
            <p className="mt-0.5 text-xs text-amber-800">
              {products.length === 0 && 'No finished products registered yet. '}
              {materials.length === 0 && 'No raw materials registered yet. '}
              Register products and raw materials first to build Bills of Materials.
            </p>
          </div>
        </div>
      )}

      {/* Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white border border-[#DCE6E6] rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500">Total BOM Versions</p>
          <p className="mt-2 text-2xl font-semibold font-mono tabular-nums text-[#3B4F4E]">
            {summary.totalBoms}
          </p>
          <p className="mt-1 text-xs text-slate-500">Across all recipe revisions</p>
        </div>

        <div className="bg-white border border-[#DCE6E6] rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500">Active Recipes</p>
          <p className="mt-2 text-2xl font-semibold font-mono tabular-nums text-emerald-700">
            {summary.activeCount}
          </p>
          <p className="mt-1 text-xs text-slate-500">Approved for production</p>
        </div>

        <div className="bg-white border border-[#DCE6E6] rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500">Products Covered</p>
          <p className="mt-2 text-2xl font-semibold font-mono tabular-nums text-[#3B4F4E]">
            {summary.coveredProductsCount} / {products.length}
          </p>
          <p className="mt-1 text-xs text-slate-500">SKUs with active BOMs</p>
        </div>

        <div className="bg-white border border-[#DCE6E6] rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500">Avg. Material Cost / Pack</p>
          <p className="mt-2 text-2xl font-semibold font-mono tabular-nums text-[#3B4F4E]">
            ₹{summary.avgCostPerUnit.toFixed(2)}
          </p>
          <p className="mt-1 text-xs text-slate-500">Active BOM unit estimate</p>
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
                placeholder="Search by BOM code, product name, or SKU..."
                aria-label="Search BOMs"
                className="w-full h-9 pl-9 pr-3 text-sm text-[#3B4F4E] bg-slate-50 border border-[#DCE6E6] rounded-lg placeholder:text-slate-400 focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#CF9C2D]"
              />
            </div>

            <select
              aria-label="Filter by product"
              value={productFilter}
              onChange={(e) => setProductFilter(e.target.value)}
              className="h-9 px-3 text-xs font-medium text-slate-700 bg-slate-50 border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
            >
              <option value="All">All Finished Products</option>
              {products.map((prod) => (
                <option key={prod.id} value={prod.id}>
                  {prod.name} ({prod.packetSize})
                </option>
              ))}
            </select>
          </div>

          <div
            role="tablist"
            aria-label="Filter by BOM status"
            className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg self-start xl:self-auto"
          >
            {(['All', ...BOM_STATUSES] as const).map((st) => (
              <button
                key={st}
                type="button"
                role="tab"
                aria-selected={statusFilter === st}
                onClick={() => setStatusFilter(st)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  statusFilter === st
                    ? 'bg-white text-[#3B4F4E] shadow-xs'
                    : 'text-slate-600 hover:text-[#3B4F4E]'
                }`}
              >
                {st}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#DCE6E6] bg-slate-50/70">
                <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 whitespace-nowrap">
                  BOM Code
                </th>
                <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 whitespace-nowrap">
                  Finished Product
                </th>
                <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 text-right whitespace-nowrap">
                  Version
                </th>
                <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 text-right whitespace-nowrap">
                  Batch Yield
                </th>
                <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 text-right whitespace-nowrap">
                  Est. Batch Cost
                </th>
                <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 text-right whitespace-nowrap">
                  Cost / Pack
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
                    Loading Bills of Materials from Cloud Firestore...
                  </td>
                </tr>
              ) : filteredBoms.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-16 text-center">
                    <div className="max-w-md mx-auto flex flex-col items-center">
                      <div className="w-11 h-11 rounded-xl bg-slate-100 border border-[#DCE6E6] flex items-center justify-center text-slate-500 mb-4">
                        <Layers className="w-5 h-5" />
                      </div>
                      <h2 className="text-base font-semibold text-[#3B4F4E]">
                        {boms.length === 0 ? 'No Bills of Materials created yet' : 'No matching BOMs'}
                      </h2>
                      <p className="mt-1.5 text-sm text-slate-600">
                        {boms.length === 0
                          ? 'Link a finished snack product to its raw materials and packaging to compute recipe cost.'
                          : 'Adjust your search query or status filter to view other BOM versions.'}
                      </p>
                      {boms.length === 0 && canManage && !prerequisitesMissing && (
                        <button
                          type="button"
                          onClick={openCreateModal}
                          className="mt-4 min-h-[38px] inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-[#CF9C2D] hover:bg-[#BC8B22] rounded-lg transition-colors whitespace-nowrap"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          Create First BOM
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                filteredBoms.map((bom) => (
                  <tr key={bom.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-5 py-3.5 font-mono text-xs font-semibold text-[#3B4F4E] whitespace-nowrap">
                      {bom.bomCode}
                    </td>
                    <td className="px-5 py-3.5 min-w-[200px]">
                      <p className="text-sm font-medium text-[#3B4F4E]">{bom.productName}</p>
                      <p className="text-xs text-slate-500 font-mono">
                        {bom.productSku} · {bom.packetSize} · {bom.itemCount} materials
                      </p>
                    </td>
                    <td className="px-5 py-3.5 font-mono text-xs font-semibold text-slate-700 text-right tabular-nums whitespace-nowrap">
                      v{bom.version}
                    </td>
                    <td className="px-5 py-3.5 font-mono text-xs text-slate-700 text-right tabular-nums whitespace-nowrap">
                      {bom.batchSize} packs
                    </td>
                    <td className="px-5 py-3.5 font-mono text-sm font-semibold text-[#3B4F4E] text-right tabular-nums whitespace-nowrap">
                      ₹{bom.estimatedMaterialCost.toFixed(2)}
                    </td>
                    <td className="px-5 py-3.5 font-mono text-xs text-slate-700 text-right tabular-nums whitespace-nowrap">
                      ₹{bom.costPerUnit.toFixed(2)}
                    </td>
                    <td className="px-5 py-3.5 text-xs font-medium whitespace-nowrap">
                      {bom.status === 'Active' ? (
                        <span className="inline-flex items-center gap-1.5 text-emerald-700">
                          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                          Active
                        </span>
                      ) : bom.status === 'Draft' ? (
                        <span className="text-[#3B4F4E]">Draft</span>
                      ) : (
                        <span className="text-slate-500">Archived</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setViewingBom(bom)}
                          className="min-h-[32px] inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-[#DCE6E6] rounded-md transition-colors"
                        >
                          <Eye className="w-3.5 h-3.5 text-slate-500" />
                          View
                        </button>
                        {canManage && (
                          <button
                            type="button"
                            onClick={() => openEditModal(bom)}
                            className="min-h-[32px] inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-[#DCE6E6] rounded-md transition-colors"
                          >
                            <Edit3 className="w-3.5 h-3.5 text-slate-500" />
                            Edit
                          </button>
                        )}
                        {canDelete && (
                          <button
                            type="button"
                            onClick={() => {
                              setDeleteError(null);
                              setDeletingBom(bom);
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

      {/* Add / Edit / Version BOM Modal */}
      {modalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="bom-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/50 overflow-y-auto"
        >
          <div className="w-full max-w-4xl bg-white border border-[#DCE6E6] rounded-xl overflow-hidden my-8">
            <div className="px-6 py-4 border-b border-[#DCE6E6] flex items-center justify-between">
              <div>
                <h2 id="bom-modal-title" className="text-base font-semibold text-[#3B4F4E]">
                  {editingBom ? `Edit BOM · ${editingBom.bomCode} (v${editingBom.version})` : 'Create Bill of Materials'}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Costs are estimated automatically using each raw material's purchase price per unit.
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

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void saveBom(false);
              }}
              className="p-6 space-y-5 max-h-[82vh] overflow-y-auto"
            >
              {formError && (
                <div role="alert" className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div>
                  <label htmlFor="bom-product" className="block text-xs font-medium text-slate-700 mb-1">
                    Finished Product *
                  </label>
                  <select
                    id="bom-product"
                    required
                    value={productId}
                    onChange={(e) => handleProductSelectionChange(e.target.value)}
                    className="w-full h-9 px-3 text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                  >
                    <option value="">Select finished product...</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.sku} · {p.packetSize})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="bom-code" className="block text-xs font-medium text-slate-700 mb-1">
                    BOM Code *
                  </label>
                  <input
                    id="bom-code"
                    type="text"
                    required
                    maxLength={BLUEPRINT_CONSTRAINTS.code.maxLength}
                    value={bomCode}
                    onChange={(e) => setBomCode(e.target.value.toUpperCase())}
                    placeholder="BOM-SF-MPC-V1"
                    className="w-full h-9 px-3 font-mono text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="bom-version" className="block text-xs font-medium text-slate-700 mb-1">
                      Version *
                    </label>
                    <input
                      id="bom-version"
                      type="number"
                      required
                      min="1"
                      max="1000"
                      value={version}
                      onChange={(e) => setVersion(Math.max(1, Number(e.target.value) || 1))}
                      className="w-full h-9 px-3 font-mono text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                    />
                  </div>

                  <div>
                    <label htmlFor="bom-status" className="block text-xs font-medium text-slate-700 mb-1">
                      Status *
                    </label>
                    <select
                      id="bom-status"
                      value={status}
                      onChange={(e) => setStatus(e.target.value as BomStatus)}
                      className="w-full h-9 px-2.5 text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                    >
                      {BOM_STATUSES.map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label htmlFor="bom-batch-size" className="block text-xs font-medium text-slate-700 mb-1">
                    Batch Yield (Packets Produced) *
                  </label>
                  <input
                    id="bom-batch-size"
                    type="number"
                    required
                    min="1"
                    step="1"
                    value={batchSize}
                    onChange={(e) => setBatchSize(e.target.value)}
                    placeholder="100"
                    className="w-full h-9 px-3 font-mono text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label htmlFor="bom-notes" className="block text-xs font-medium text-slate-700 mb-1">
                    Recipe / Process Notes
                  </label>
                  <input
                    id="bom-notes"
                    type="text"
                    maxLength={BLUEPRINT_CONSTRAINTS.description.maxLength}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Frying yield assumptions, spice dusting tolerances, or pouch specs"
                    className="w-full h-9 px-3 text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                  />
                </div>
              </div>

              {/* Recipe Components */}
              <div className="border-t border-[#DCE6E6] pt-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-[#3B4F4E]">Required Raw Materials</h3>
                    <p className="text-xs text-slate-500">
                      Specify ingredient quantities and units per batch of {batchSize || '0'} packets.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setLineItems((prev) => [...prev, createEmptyLine()])}
                    className="min-h-[34px] inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#3B4F4E] bg-[#EEF3F3] hover:bg-[#E5EDED] rounded-lg transition-colors whitespace-nowrap"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Material
                  </button>
                </div>

                <div className="overflow-x-auto border border-[#DCE6E6] rounded-lg">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-[#DCE6E6] bg-slate-50">
                        <th className="px-3 py-2 text-xs font-semibold text-slate-600">Raw Material *</th>
                        <th className="px-3 py-2 text-xs font-semibold text-slate-600">Required Qty *</th>
                        <th className="px-3 py-2 text-xs font-semibold text-slate-600">Unit *</th>
                        <th className="px-3 py-2 text-xs font-semibold text-slate-600 text-right">Stock Price</th>
                        <th className="px-3 py-2 text-xs font-semibold text-slate-600 text-right">Est. Cost</th>
                        <th className="px-3 py-2 text-xs font-semibold text-slate-600 text-right">Remove</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {lineItems.map((row, index) => {
                        const mat = materialMap.get(row.rawMaterialId);
                        const compatibleUnits = mat ? getCompatibleBomUnits(mat.unit) : [row.unit];
                        const qty = Number(row.quantity);
                        const converted =
                          mat && Number.isFinite(qty) && qty > 0
                            ? convertBomQuantityToStockUnit(qty, row.unit, mat.unit)
                            : null;
                        const estLineCost =
                          mat && converted !== null ? roundCurrency(converted * mat.purchasePrice) : 0;

                        return (
                          <tr key={index}>
                            <td className="px-3 py-2 min-w-[220px]">
                              <select
                                aria-label={`Ingredient ${index + 1}`}
                                value={row.rawMaterialId}
                                onChange={(e) => handleLineMaterialChange(index, e.target.value)}
                                className="w-full h-8 px-2 text-xs text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-md focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                              >
                                <option value="">Select material...</option>
                                {materials.map((m) => (
                                  <option key={m.id} value={m.id}>
                                    {m.name} ({m.materialCode})
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="px-3 py-2 min-w-[115px]">
                              <input
                                aria-label={`Quantity ${index + 1}`}
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
                                className="w-28 h-8 px-2 font-mono text-xs text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-md focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                              />
                            </td>
                            <td className="px-3 py-2 min-w-[100px]">
                              <select
                                aria-label={`Unit ${index + 1}`}
                                value={row.unit}
                                onChange={(e) =>
                                  setLineItems((prev) =>
                                    prev.map((item, idx) =>
                                      idx === index
                                        ? { ...item, unit: e.target.value as BomUnit }
                                        : item,
                                    ),
                                  )
                                }
                                className="w-24 h-8 px-2 font-mono text-xs text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-md focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                              >
                                {compatibleUnits.map((u) => (
                                  <option key={u} value={u}>
                                    {u}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="px-3 py-2 font-mono text-xs text-slate-600 text-right tabular-nums whitespace-nowrap">
                              {mat ? `₹${mat.purchasePrice.toFixed(2)} / ${mat.unit}` : '—'}
                            </td>
                            <td className="px-3 py-2 font-mono text-xs font-medium text-[#3B4F4E] text-right tabular-nums whitespace-nowrap">
                              ₹{estLineCost.toFixed(2)}
                            </td>
                            <td className="px-3 py-2 text-right">
                              <button
                                type="button"
                                disabled={lineItems.length <= 1}
                                onClick={() =>
                                  setLineItems((prev) => prev.filter((_, idx) => idx !== index))
                                }
                                aria-label={`Remove material ${index + 1}`}
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

                {/* Live Cost Summary */}
                <div className="flex justify-end">
                  <dl className="w-full sm:w-80 border border-[#DCE6E6] rounded-lg bg-slate-50 p-4 space-y-2 text-xs">
                    <div className="flex items-center justify-between text-slate-600">
                      <dt>Estimated Batch Material Cost</dt>
                      <dd className="font-mono tabular-nums font-semibold text-[#3B4F4E]">
                        ₹{liveCosting.total.toFixed(2)}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between text-slate-600">
                      <dt>Estimated Cost per Packet</dt>
                      <dd className="font-mono tabular-nums font-semibold text-[#3B4F4E]">
                        ₹{liveCosting.perUnit.toFixed(2)}
                      </dd>
                    </div>
                    {productMap.get(productId) && (
                      <div className="pt-2 border-t border-[#DCE6E6] flex items-center justify-between text-slate-600">
                        <dt>Product Selling Price</dt>
                        <dd className="font-mono tabular-nums text-[#3B4F4E]">
                          ₹{productMap.get(productId)!.sellingPrice.toFixed(2)}
                        </dd>
                      </div>
                    )}
                  </dl>
                </div>
              </div>

              <div className="pt-4 border-t border-[#DCE6E6] flex flex-wrap items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="min-h-[38px] px-4 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-[#DCE6E6] rounded-lg whitespace-nowrap"
                >
                  Cancel
                </button>
                {editingBom && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void saveBom(true)}
                    className="min-h-[38px] inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-[#3B4F4E] bg-[#EEF3F3] hover:bg-[#E5EDED] border border-[#DCE6E6] rounded-lg whitespace-nowrap"
                  >
                    <CopyPlus className="w-3.5 h-3.5" />
                    Save as Version v{nextVersionForProduct(productId)}
                  </button>
                )}
                <button
                  type="submit"
                  disabled={saving}
                  className="min-h-[38px] px-4 py-2 text-xs font-medium text-white bg-[#CF9C2D] hover:bg-[#BC8B22] disabled:opacity-60 rounded-lg whitespace-nowrap"
                >
                  {saving
                    ? 'Saving to Firestore...'
                    : editingBom
                      ? 'Save Changes'
                      : 'Save BOM'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* View BOM Detail Modal */}
      {viewingBom && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="view-bom-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/50 overflow-y-auto"
        >
          <div className="w-full max-w-3xl bg-white border border-[#DCE6E6] rounded-xl overflow-hidden my-8">
            <div className="px-6 py-4 border-b border-[#DCE6E6] flex items-center justify-between">
              <div>
                <h2 id="view-bom-title" className="text-base font-semibold text-[#3B4F4E]">
                  {viewingBom.bomCode} · {viewingBom.productName} (v{viewingBom.version})
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  SKU {viewingBom.productSku} · Pack {viewingBom.packetSize} · Batch Yield{' '}
                  {viewingBom.batchSize} packs · {viewingBom.status}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setViewingBom(null)}
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
                      <th className="px-4 py-2.5 text-xs font-semibold text-slate-600 text-right">Required Qty</th>
                      <th className="px-4 py-2.5 text-xs font-semibold text-slate-600 text-right">Stock Rate</th>
                      <th className="px-4 py-2.5 text-xs font-semibold text-slate-600 text-right">Est. Cost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {(itemsByBomId.get(viewingBom.id) ?? []).map((item) => (
                      <tr key={item.id}>
                        <td className="px-4 py-2.5">
                          <p className="text-sm font-medium text-[#3B4F4E]">{item.materialName}</p>
                          <p className="text-xs font-mono text-slate-500">{item.materialCode}</p>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs text-slate-800 text-right tabular-nums">
                          {roundQuantity(item.quantity)} {item.unit}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs text-slate-600 text-right tabular-nums">
                          ₹{item.unitCost.toFixed(2)} / {item.stockUnit}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs font-semibold text-[#3B4F4E] text-right tabular-nums">
                          ₹{item.estimatedCost.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                <div className="text-xs text-slate-600 space-y-1 max-w-md">
                  <p className="font-medium text-slate-800">Process & Recipe Notes</p>
                  <p>{viewingBom.notes || 'No notes recorded for this revision.'}</p>
                </div>

                <dl className="w-full sm:w-72 border border-[#DCE6E6] rounded-lg bg-slate-50 p-4 space-y-2 text-xs">
                  <div className="flex justify-between">
                    <dt className="text-slate-600">Batch Output Yield</dt>
                    <dd className="font-mono tabular-nums text-[#3B4F4E]">
                      {viewingBom.batchSize} packs
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-600">Est. Material Cost</dt>
                    <dd className="font-mono tabular-nums font-semibold text-[#3B4F4E]">
                      ₹{viewingBom.estimatedMaterialCost.toFixed(2)}
                    </dd>
                  </div>
                  <div className="pt-1.5 border-t border-[#DCE6E6] flex justify-between font-semibold text-sm text-[#3B4F4E]">
                    <dt>Cost per Packet</dt>
                    <dd className="font-mono tabular-nums">₹{viewingBom.costPerUnit.toFixed(2)}</dd>
                  </div>
                </dl>
              </div>

              <div className="pt-3 border-t border-[#DCE6E6] flex items-center justify-end gap-3">
                {canManage && (
                  <button
                    type="button"
                    onClick={() => {
                      const target = viewingBom;
                      setViewingBom(null);
                      openEditModal(target);
                    }}
                    className="min-h-[38px] px-4 py-2 text-xs font-medium text-[#3B4F4E] bg-[#EEF3F3] hover:bg-[#E5EDED] rounded-lg whitespace-nowrap"
                  >
                    Edit / Create New Version
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setViewingBom(null)}
                  className="min-h-[38px] px-4 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-[#DCE6E6] rounded-lg whitespace-nowrap"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletingBom && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-bom-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/50"
        >
          <div className="w-full max-w-md bg-white border border-[#DCE6E6] rounded-xl p-6 space-y-4">
            <h2 id="delete-bom-title" className="text-base font-semibold text-[#3B4F4E]">
              Delete Bill of Materials
            </h2>
            <p className="text-sm text-slate-600">
              Permanently remove{' '}
              <span className="font-mono font-semibold text-[#3B4F4E]">
                {deletingBom.bomCode}
              </span>{' '}
              (v{deletingBom.version} for {deletingBom.productName}) from Firestore?
            </p>
            {deleteError && (
              <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
                {deleteError}
              </p>
            )}
            <div className="pt-2 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeletingBom(null)}
                className="min-h-[38px] px-4 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-[#DCE6E6] rounded-lg whitespace-nowrap"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteBom()}
                disabled={deleting}
                className="min-h-[38px] px-4 py-2 text-xs font-medium text-white bg-red-600 hover:bg-red-700 disabled:bg-red-400 rounded-lg whitespace-nowrap"
              >
                {deleting ? 'Deleting...' : 'Delete BOM'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
