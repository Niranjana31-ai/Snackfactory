import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Edit3,
  Package,
  Plus,
  Search,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../lib/firebase';
import { handleFirestoreError, OperationType } from '../lib/firestoreError';
import { BLUEPRINT_CONSTRAINTS, validateProductInput } from '../lib/validation';
import {
  GST_RATES,
  ORG_ID,
  PACKET_SIZE_PRESETS,
  PRODUCT_CATEGORIES,
  PRODUCT_STATUSES,
  type Product,
  type ProductStatus,
} from '../types/erp';

type StatusFilter = 'All' | ProductStatus;

const INITIAL_FORM = {
  name: '',
  sku: '',
  category: PRODUCT_CATEGORIES[0],
  description: '',
  packetSize: '100g',
  sellingPrice: '',
  gstPercentage: '5',
  hsnCode: '',
  status: 'Active' as ProductStatus,
};

export function ProductsPage() {
  const { firebaseUser, userProfile, effectiveRole } = useAuth();
  const activeRole = effectiveRole ?? userProfile?.role ?? 'Salesman';
  const canManage = activeRole === 'Owner' || activeRole === 'Admin';

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('All');
  const [sizeFilter, setSizeFilter] = useState<string>('All');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All');

  const [modalOpen, setModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [form, setForm] = useState(INITIAL_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [deletingProduct, setDeletingProduct] = useState<Product | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!firebaseUser) return;
    setLoading(true);
    setLoadError(null);

    const q = query(collection(db, 'products'), where('orgId', '==', ORG_ID));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const rows = snapshot.docs.map((d) => d.data() as Product);
        rows.sort((a, b) => a.name.localeCompare(b.name));
        setProducts(rows);
        setLoading(false);
      },
      (error) => {
        setLoading(false);
        setLoadError('Unable to load products from Cloud Firestore.');
        handleFirestoreError(error, OperationType.LIST, 'products');
      },
    );

    return () => unsubscribe();
  }, [firebaseUser]);

  const availableSizes = useMemo(() => {
    const set = new Set<string>(PACKET_SIZE_PRESETS);
    products.forEach((p) => {
      if (p.packetSize) set.add(p.packetSize);
    });
    return Array.from(set);
  }, [products]);

  const filteredProducts = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return products.filter((product) => {
      const matchesStatus = statusFilter === 'All' || product.status === statusFilter;
      const matchesCategory = categoryFilter === 'All' || product.category === categoryFilter;
      const matchesSize = sizeFilter === 'All' || product.packetSize === sizeFilter;
      const matchesSearch =
        !term ||
        product.name.toLowerCase().includes(term) ||
        product.sku.toLowerCase().includes(term) ||
        product.description.toLowerCase().includes(term);
      return matchesStatus && matchesCategory && matchesSize && matchesSearch;
    });
  }, [products, searchTerm, categoryFilter, sizeFilter, statusFilter]);

  const activeCount = useMemo(
    () => products.filter((p) => p.status === 'Active').length,
    [products],
  );

  const openCreateModal = () => {
    setEditingProduct(null);
    setForm(INITIAL_FORM);
    setFormError(null);
    setModalOpen(true);
  };

  const openEditModal = (product: Product) => {
    setEditingProduct(product);
    setForm({
      name: product.name,
      sku: product.sku,
      category: product.category,
      description: product.description,
      packetSize: product.packetSize,
      sellingPrice: String(product.sellingPrice),
      gstPercentage: String(product.gstPercentage),
      hsnCode: product.hsnCode ?? '',
      status: product.status,
    });
    setFormError(null);
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !canManage) return;

    const validation = validateProductInput(form);
    if (!validation.valid) {
      setFormError(validation.error);
      return;
    }

    const duplicateSku = products.find(
      (p) => p.sku === validation.sanitized.sku && p.id !== editingProduct?.id,
    );
    if (duplicateSku) {
      setFormError(`SKU "${validation.sanitized.sku}" is already assigned to "${duplicateSku.name}".`);
      return;
    }

    setSaving(true);
    setFormError(null);

    try {
      if (editingProduct) {
        await updateDoc(doc(db, 'products', editingProduct.id), {
          ...validation.sanitized,
          updatedAt: serverTimestamp(),
        });
      } else {
        const newRef = doc(collection(db, 'products'));
        await setDoc(newRef, {
          id: newRef.id,
          orgId: ORG_ID,
          ...validation.sanitized,
          createdBy: firebaseUser.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      setModalOpen(false);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.toLowerCase().includes('permission')) {
        handleFirestoreError(
          error,
          editingProduct ? OperationType.UPDATE : OperationType.CREATE,
          editingProduct ? `products/${editingProduct.id}` : 'products',
        );
      }
      setFormError('Failed to save product to Cloud Firestore. Please verify your inputs and connection.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingProduct || !canManage) return;
    setDeleting(true);
    setDeleteError(null);

    try {
      await deleteDoc(doc(db, 'products', deletingProduct.id));
      setDeletingProduct(null);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.toLowerCase().includes('permission')) {
        handleFirestoreError(error, OperationType.DELETE, `products/${deletingProduct.id}`);
      }
      setDeleteError('Failed to delete product from Cloud Firestore.');
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
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#3B4F4E]">Products</h1>
          <p className="mt-1 text-sm text-slate-600">
            Finished snack SKUs, packet sizes, selling prices, GST percentages, and catalog status.
          </p>
        </div>

        <div className="flex items-center gap-4 shrink-0">
          <div className="hidden sm:block text-right text-xs text-slate-500">
            <span className="font-mono tabular-nums font-medium text-[#3B4F4E]">
              {products.length}
            </span>{' '}
            total ·{' '}
            <span className="font-mono tabular-nums font-medium text-emerald-700">
              {activeCount}
            </span>{' '}
            active
          </div>

          {canManage ? (
            <button
              type="button"
              onClick={openCreateModal}
              className="min-h-[40px] inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#CF9C2D] hover:bg-[#BC8B22] rounded-lg transition-colors whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3B4F4E]"
            >
              <Plus className="w-4 h-4 shrink-0" />
              Add Product
            </button>
          ) : (
            <span className="text-xs text-slate-500 whitespace-nowrap">
              View-only for {activeRole}
            </span>
          )}
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
                placeholder="Search by product name, SKU, or description..."
                aria-label="Search products"
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
              {PRODUCT_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>

            <select
              aria-label="Filter by packet size"
              value={sizeFilter}
              onChange={(e) => setSizeFilter(e.target.value)}
              className="h-9 px-3 text-xs font-medium text-slate-700 bg-slate-50 border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
            >
              <option value="All">All Sizes</option>
              {availableSizes.map((sz) => (
                <option key={sz} value={sz}>
                  {sz}
                </option>
              ))}
            </select>
          </div>

          <div
            role="tablist"
            aria-label="Filter by product status"
            className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg self-start xl:self-auto"
          >
            {(['All', ...PRODUCT_STATUSES] as const).map((status) => (
              <button
                key={status}
                type="button"
                role="tab"
                aria-selected={statusFilter === status}
                onClick={() => setStatusFilter(status)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  statusFilter === status
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
                  SKU
                </th>
                <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 whitespace-nowrap">
                  Product Name
                </th>
                <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 whitespace-nowrap">
                  Category
                </th>
                <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 whitespace-nowrap">
                  Packet Size
                </th>
                <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 text-right whitespace-nowrap">
                  Selling Price
                </th>
                <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 text-right whitespace-nowrap">
                  GST %
                </th>
                <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 whitespace-nowrap">
                  Status
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
                  <td colSpan={canManage ? 8 : 7} className="px-5 py-12 text-center text-sm text-slate-500">
                    Loading products from Cloud Firestore...
                  </td>
                </tr>
              ) : filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={canManage ? 8 : 7} className="px-6 py-16 text-center">
                    <div className="max-w-md mx-auto flex flex-col items-center">
                      <div className="w-11 h-11 rounded-xl bg-slate-100 border border-[#DCE6E6] flex items-center justify-center text-slate-500 mb-4">
                        <Package className="w-5 h-5" />
                      </div>
                      <h2 className="text-base font-semibold text-[#3B4F4E]">
                        {products.length === 0 ? 'No products registered yet' : 'No matching products'}
                      </h2>
                      <p className="mt-1.5 text-sm text-slate-600">
                        {products.length === 0
                          ? 'Add your first snack SKU with packet size, selling price, and GST rate.'
                          : 'Adjust your search query or filters to view other products.'}
                      </p>
                      {products.length === 0 && canManage && (
                        <button
                          type="button"
                          onClick={openCreateModal}
                          className="mt-4 min-h-[38px] inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-[#CF9C2D] hover:bg-[#BC8B22] rounded-lg transition-colors whitespace-nowrap"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          Add First Product
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                filteredProducts.map((product) => (
                  <tr key={product.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-5 py-3.5 font-mono text-xs font-medium text-[#3B4F4E] whitespace-nowrap">
                      {product.sku}
                    </td>
                    <td className="px-5 py-3.5 min-w-[200px]">
                      <p className="text-sm font-medium text-[#3B4F4E]">{product.name}</p>
                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        {product.hsnCode && (
                          <span className="font-mono text-[11px] text-slate-600">
                            HSN {product.hsnCode}
                          </span>
                        )}
                        {product.description && (
                          <span className="truncate max-w-[240px]">{product.description}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-sm text-slate-600 whitespace-nowrap">
                      {product.category}
                    </td>
                    <td className="px-5 py-3.5 font-mono text-xs text-slate-700 whitespace-nowrap">
                      {product.packetSize}
                    </td>
                    <td className="px-5 py-3.5 font-mono text-sm text-[#3B4F4E] text-right tabular-nums whitespace-nowrap">
                      ₹{product.sellingPrice.toFixed(2)}
                    </td>
                    <td className="px-5 py-3.5 font-mono text-xs text-slate-700 text-right tabular-nums whitespace-nowrap">
                      {product.gstPercentage}%
                    </td>
                    <td className="px-5 py-3.5 text-xs font-medium whitespace-nowrap">
                      {product.status === 'Active' ? (
                        <span className="inline-flex items-center gap-1.5 text-emerald-700">
                          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-slate-500">
                          <XCircle className="w-3.5 h-3.5 shrink-0" />
                          Inactive
                        </span>
                      )}
                    </td>
                    {canManage && (
                      <td className="px-5 py-3.5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => openEditModal(product)}
                            className="min-h-[32px] inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-[#DCE6E6] rounded-md transition-colors"
                          >
                            <Edit3 className="w-3.5 h-3.5 text-slate-500" />
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setDeleteError(null);
                              setDeletingProduct(product);
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
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit Product Modal */}
      {modalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="product-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/50 overflow-y-auto"
        >
          <div className="w-full max-w-lg bg-white border border-[#DCE6E6] rounded-xl overflow-hidden my-8">
            <div className="px-6 py-4 border-b border-[#DCE6E6] flex items-center justify-between">
              <h2 id="product-modal-title" className="text-base font-semibold text-[#3B4F4E]">
                {editingProduct ? 'Edit Product' : 'Add New Product'}
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
                  <label htmlFor="product-name" className="block text-xs font-medium text-slate-700 mb-1">
                    Product Name *
                  </label>
                  <input
                    id="product-name"
                    type="text"
                    required
                    maxLength={BLUEPRINT_CONSTRAINTS.masterName.maxLength}
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="Masala Potato Chips"
                    className="w-full h-9 px-3 text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                  />
                </div>

                <div>
                  <label htmlFor="product-sku" className="block text-xs font-medium text-slate-700 mb-1">
                    SKU *
                  </label>
                  <input
                    id="product-sku"
                    type="text"
                    required
                    maxLength={BLUEPRINT_CONSTRAINTS.code.maxLength}
                    value={form.sku}
                    onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value.toUpperCase() }))}
                    placeholder="SF-MPC-100G"
                    className="w-full h-9 px-3 font-mono text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="product-category" className="block text-xs font-medium text-slate-700 mb-1">
                    Category *
                  </label>
                  <select
                    id="product-category"
                    value={form.category}
                    onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                    className="w-full h-9 px-3 text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                  >
                    {PRODUCT_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="product-status" className="block text-xs font-medium text-slate-700 mb-1">
                    Status *
                  </label>
                  <select
                    id="product-status"
                    value={form.status}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, status: e.target.value as ProductStatus }))
                    }
                    className="w-full h-9 px-3 text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                  >
                    {PRODUCT_STATUSES.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="product-packet-size" className="block text-xs font-medium text-slate-700 mb-1">
                  Packet Size *
                </label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {PACKET_SIZE_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, packetSize: preset }))}
                      className={`px-2.5 py-1 text-xs font-mono rounded-md border transition-colors ${
                        form.packetSize === preset
                          ? 'bg-[#CF9C2D] text-white border-[#3B4F4E]'
                          : 'bg-slate-50 text-slate-700 border-[#DCE6E6] hover:bg-slate-100'
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
                <input
                  id="product-packet-size"
                  type="text"
                  required
                  maxLength={BLUEPRINT_CONSTRAINTS.packetSize.maxLength}
                  value={form.packetSize}
                  onChange={(e) => setForm((f) => ({ ...f, packetSize: e.target.value }))}
                  placeholder="e.g. 100g, 200g, 500g"
                  className="w-full h-9 px-3 font-mono text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label htmlFor="product-price" className="block text-xs font-medium text-slate-700 mb-1">
                    Selling Price (₹) *
                  </label>
                  <input
                    id="product-price"
                    type="number"
                    required
                    min="0"
                    step="0.01"
                    value={form.sellingPrice}
                    onChange={(e) => setForm((f) => ({ ...f, sellingPrice: e.target.value }))}
                    placeholder="20.00"
                    className="w-full h-9 px-3 font-mono text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                  />
                </div>

                <div>
                  <label htmlFor="product-gst" className="block text-xs font-medium text-slate-700 mb-1">
                    GST Percentage *
                  </label>
                  <select
                    id="product-gst"
                    value={form.gstPercentage}
                    onChange={(e) => setForm((f) => ({ ...f, gstPercentage: e.target.value }))}
                    className="w-full h-9 px-3 font-mono text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                  >
                    {GST_RATES.map((rate) => (
                      <option key={rate} value={String(rate)}>
                        {rate}%
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="product-hsn" className="block text-xs font-medium text-slate-700 mb-1">
                    HSN Code
                  </label>
                  <input
                    id="product-hsn"
                    type="text"
                    maxLength={16}
                    value={form.hsnCode}
                    onChange={(e) => setForm((f) => ({ ...f, hsnCode: e.target.value.toUpperCase() }))}
                    placeholder="21069099"
                    className="w-full h-9 px-3 font-mono text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="product-description" className="block text-xs font-medium text-slate-700 mb-1">
                  Description
                </label>
                <textarea
                  id="product-description"
                  rows={3}
                  maxLength={BLUEPRINT_CONSTRAINTS.description.maxLength}
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Optional product specification, flavor notes, or packaging detail."
                  className="w-full p-3 text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                />
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
                  {saving ? 'Saving to Firestore...' : editingProduct ? 'Update Product' : 'Save Product'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletingProduct && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-product-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/50"
        >
          <div className="w-full max-w-md bg-white border border-[#DCE6E6] rounded-xl p-6 space-y-4">
            <h2 id="delete-product-title" className="text-base font-semibold text-[#3B4F4E]">
              Delete Product
            </h2>
            <p className="text-sm text-slate-600">
              Permanently remove <span className="font-semibold text-[#3B4F4E]">{deletingProduct.name}</span> (
              <span className="font-mono text-xs">{deletingProduct.sku}</span>) from Firestore?
            </p>
            {deleteError && (
              <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
                {deleteError}
              </p>
            )}
            <div className="pt-2 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeletingProduct(null)}
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
                {deleting ? 'Deleting...' : 'Delete Product'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
