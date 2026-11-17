import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Edit3,
  Factory,
  Plus,
  Search,
  Trash2,
  X,
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
import { findStateByCode, INDIAN_STATES } from '../config/indianStates';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../lib/firebase';
import { handleFirestoreError, OperationType } from '../lib/firestoreError';
import { BLUEPRINT_CONSTRAINTS, validateSupplierInput } from '../lib/validation';
import { ORG_ID, type Supplier } from '../types/erp';

const DEFAULT_STATE = INDIAN_STATES.find((s) => s.code === '27') ?? INDIAN_STATES[0];

const INITIAL_FORM = {
  name: '',
  contactPerson: '',
  phone: '',
  email: '',
  gstin: '',
  address: '',
  state: DEFAULT_STATE.name,
};

export function SuppliersPage() {
  const { firebaseUser, userProfile, effectiveRole } = useAuth();
  const activeRole = effectiveRole ?? userProfile?.role ?? 'Salesman';
  const canManage =
    activeRole === 'Owner' ||
    activeRole === 'Admin' ||
    activeRole === 'Production Supervisor';
  const canDelete = activeRole === 'Owner' || activeRole === 'Admin';

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [stateFilter, setStateFilter] = useState<string>('All');

  const [modalOpen, setModalOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [form, setForm] = useState(INITIAL_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [deletingSupplier, setDeletingSupplier] = useState<Supplier | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!firebaseUser) return;
    setLoading(true);
    setLoadError(null);

    const q = query(collection(db, 'suppliers'), where('orgId', '==', ORG_ID));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const rows = snapshot.docs.map((d) => d.data() as Supplier);
        rows.sort((a, b) => a.name.localeCompare(b.name));
        setSuppliers(rows);
        setLoading(false);
      },
      (error) => {
        setLoading(false);
        setLoadError('Unable to load suppliers from Cloud Firestore.');
        handleFirestoreError(error, OperationType.LIST, 'suppliers');
      },
    );

    return () => unsubscribe();
  }, [firebaseUser]);

  const activeStates = useMemo(() => {
    const set = new Set<string>();
    suppliers.forEach((s) => {
      if (s.state) set.add(s.state);
    });
    return Array.from(set).sort();
  }, [suppliers]);

  const filteredSuppliers = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return suppliers.filter((s) => {
      const matchesState = stateFilter === 'All' || s.state === stateFilter;
      const matchesSearch =
        !term ||
        s.name.toLowerCase().includes(term) ||
        s.contactPerson.toLowerCase().includes(term) ||
        s.phone.toLowerCase().includes(term) ||
        s.email.toLowerCase().includes(term) ||
        s.gstin.toLowerCase().includes(term) ||
        s.state.toLowerCase().includes(term);
      return matchesState && matchesSearch;
    });
  }, [suppliers, searchTerm, stateFilter]);

  const openCreateModal = () => {
    setEditingSupplier(null);
    setForm(INITIAL_FORM);
    setFormError(null);
    setModalOpen(true);
  };

  const openEditModal = (supplier: Supplier) => {
    setEditingSupplier(supplier);
    setForm({
      name: supplier.name,
      contactPerson: supplier.contactPerson,
      phone: supplier.phone,
      email: supplier.email,
      gstin: supplier.gstin,
      address: supplier.address,
      state: supplier.state,
    });
    setFormError(null);
    setModalOpen(true);
  };

  const handleGstinChange = (value: string) => {
    const upper = value.toUpperCase();
    const matched = upper.length >= 2 ? findStateByCode(upper.slice(0, 2)) : undefined;
    setForm((f) => ({
      ...f,
      gstin: upper,
      ...(matched ? { state: matched.name } : {}),
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !canManage) return;

    const validation = validateSupplierInput(form);
    if (!validation.valid) {
      setFormError(validation.error);
      return;
    }

    setSaving(true);
    setFormError(null);

    try {
      if (editingSupplier) {
        await updateDoc(doc(db, 'suppliers', editingSupplier.id), {
          ...validation.sanitized,
          updatedAt: serverTimestamp(),
        });
      } else {
        const newRef = doc(collection(db, 'suppliers'));
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
          editingSupplier ? OperationType.UPDATE : OperationType.CREATE,
          editingSupplier ? `suppliers/${editingSupplier.id}` : 'suppliers',
        );
      }
      setFormError('Failed to save supplier to Cloud Firestore. Please verify inputs and retry.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingSupplier || !canDelete) return;
    setDeleting(true);
    setDeleteError(null);

    try {
      await deleteDoc(doc(db, 'suppliers', deletingSupplier.id));
      setDeletingSupplier(null);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.toLowerCase().includes('permission')) {
        handleFirestoreError(error, OperationType.DELETE, `suppliers/${deletingSupplier.id}`);
      }
      setDeleteError('Failed to delete supplier from Cloud Firestore.');
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
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#3B4F4E]">Suppliers</h1>
          <p className="mt-1 text-sm text-slate-600">
            Approved raw material and packaging vendors with contact details, GSTIN, and state.
          </p>
        </div>

        <div className="flex items-center gap-4 shrink-0">
          <div className="hidden sm:block text-right text-xs text-slate-500">
            <span className="font-mono tabular-nums font-medium text-[#3B4F4E]">
              {suppliers.length}
            </span>{' '}
            {suppliers.length === 1 ? 'supplier' : 'suppliers'}
          </div>

          {canManage ? (
            <button
              type="button"
              onClick={openCreateModal}
              className="min-h-[40px] inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#CF9C2D] hover:bg-[#BC8B22] rounded-lg transition-colors whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3B4F4E]"
            >
              <Plus className="w-4 h-4 shrink-0" />
              Add Supplier
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

      {/* Search, Filter & Table */}
      <div className="bg-white border border-[#DCE6E6] rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#DCE6E6] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by supplier, contact, phone, or GSTIN..."
              aria-label="Search suppliers"
              className="w-full h-9 pl-9 pr-3 text-sm text-[#3B4F4E] bg-slate-50 border border-[#DCE6E6] rounded-lg placeholder:text-slate-400 focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#CF9C2D]"
            />
          </div>

          <select
            aria-label="Filter by state"
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value)}
            className="h-9 px-3 text-xs font-medium text-slate-700 bg-slate-50 border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D] self-start sm:self-auto"
          >
            <option value="All">All States</option>
            {activeStates.map((st) => (
              <option key={st} value={st}>
                {st}
              </option>
            ))}
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#DCE6E6] bg-slate-50/70">
                <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 whitespace-nowrap">
                  Supplier
                </th>
                <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 whitespace-nowrap">
                  Contact
                </th>
                <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 whitespace-nowrap">
                  GSTIN
                </th>
                <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 whitespace-nowrap">
                  Address
                </th>
                <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 whitespace-nowrap">
                  State
                </th>
                {(canManage || canDelete) && (
                  <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 text-right whitespace-nowrap">
                    Actions
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {loading ? (
                <tr>
                  <td colSpan={canManage || canDelete ? 6 : 5} className="px-5 py-12 text-center text-sm text-slate-500">
                    Loading suppliers from Cloud Firestore...
                  </td>
                </tr>
              ) : filteredSuppliers.length === 0 ? (
                <tr>
                  <td colSpan={canManage || canDelete ? 6 : 5} className="px-6 py-16 text-center">
                    <div className="max-w-md mx-auto flex flex-col items-center">
                      <div className="w-11 h-11 rounded-xl bg-slate-100 border border-[#DCE6E6] flex items-center justify-center text-slate-500 mb-4">
                        <Factory className="w-5 h-5" />
                      </div>
                      <h2 className="text-base font-semibold text-[#3B4F4E]">
                        {suppliers.length === 0 ? 'No suppliers registered yet' : 'No matching suppliers'}
                      </h2>
                      <p className="mt-1.5 text-sm text-slate-600">
                        {suppliers.length === 0
                          ? 'Register ingredient and packaging suppliers with GSTIN and state details.'
                          : 'Adjust your search query or state filter to view other suppliers.'}
                      </p>
                      {suppliers.length === 0 && canManage && (
                        <button
                          type="button"
                          onClick={openCreateModal}
                          className="mt-4 min-h-[38px] inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-[#CF9C2D] hover:bg-[#BC8B22] rounded-lg transition-colors whitespace-nowrap"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          Add First Supplier
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                filteredSuppliers.map((supplier) => (
                  <tr key={supplier.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-5 py-3.5 min-w-[180px]">
                      <p className="text-sm font-medium text-[#3B4F4E]">{supplier.name}</p>
                      <p className="text-xs text-slate-500">{supplier.contactPerson}</p>
                    </td>
                    <td className="px-5 py-3.5 whitespace-nowrap">
                      <p className="font-mono text-xs text-slate-800">{supplier.phone}</p>
                      {supplier.email && (
                        <p className="text-xs text-slate-500 truncate max-w-[190px]">
                          {supplier.email}
                        </p>
                      )}
                    </td>
                    <td className="px-5 py-3.5 font-mono text-xs text-slate-800 whitespace-nowrap">
                      {supplier.gstin || 'Unregistered'}
                    </td>
                    <td className="px-5 py-3.5 text-xs text-slate-600 max-w-[260px]">
                      <p className="line-clamp-2">{supplier.address}</p>
                    </td>
                    <td className="px-5 py-3.5 text-xs text-slate-700 whitespace-nowrap">
                      {supplier.state}
                    </td>
                    {(canManage || canDelete) && (
                      <td className="px-5 py-3.5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-2">
                          {canManage && (
                            <button
                              type="button"
                              onClick={() => openEditModal(supplier)}
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
                                setDeletingSupplier(supplier);
                              }}
                              className="min-h-[32px] inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-red-700 bg-white hover:bg-red-50 border border-[#DCE6E6] rounded-md transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              Delete
                            </button>
                          )}
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

      {/* Add / Edit Supplier Modal */}
      {modalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="supplier-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/50 overflow-y-auto"
        >
          <div className="w-full max-w-lg bg-white border border-[#DCE6E6] rounded-xl overflow-hidden my-8">
            <div className="px-6 py-4 border-b border-[#DCE6E6] flex items-center justify-between">
              <h2 id="supplier-modal-title" className="text-base font-semibold text-[#3B4F4E]">
                {editingSupplier ? 'Edit Supplier' : 'Add New Supplier'}
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
                  <label htmlFor="sup-name" className="block text-xs font-medium text-slate-700 mb-1">
                    Supplier / Vendor Name *
                  </label>
                  <input
                    id="sup-name"
                    type="text"
                    required
                    maxLength={BLUEPRINT_CONSTRAINTS.masterName.maxLength}
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="Kaveri Agro Oils Pvt Ltd"
                    className="w-full h-9 px-3 text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                  />
                </div>

                <div>
                  <label htmlFor="sup-contact" className="block text-xs font-medium text-slate-700 mb-1">
                    Contact Person *
                  </label>
                  <input
                    id="sup-contact"
                    type="text"
                    required
                    maxLength={BLUEPRINT_CONSTRAINTS.contactPerson.maxLength}
                    value={form.contactPerson}
                    onChange={(e) => setForm((f) => ({ ...f, contactPerson: e.target.value }))}
                    placeholder="Suresh Nair"
                    className="w-full h-9 px-3 text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="sup-phone" className="block text-xs font-medium text-slate-700 mb-1">
                    Phone Number *
                  </label>
                  <input
                    id="sup-phone"
                    type="tel"
                    required
                    maxLength={BLUEPRINT_CONSTRAINTS.phone.maxLength}
                    value={form.phone}
                    onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                    placeholder="+91 98450 22334"
                    className="w-full h-9 px-3 font-mono text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                  />
                </div>

                <div>
                  <label htmlFor="sup-email" className="block text-xs font-medium text-slate-700 mb-1">
                    Email
                  </label>
                  <input
                    id="sup-email"
                    type="email"
                    maxLength={BLUEPRINT_CONSTRAINTS.email.maxLength}
                    value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    placeholder="dispatch@kaverioils.in"
                    className="w-full h-9 px-3 text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="sup-gstin" className="block text-xs font-medium text-slate-700 mb-1">
                    GSTIN (15 chars, optional)
                  </label>
                  <input
                    id="sup-gstin"
                    type="text"
                    maxLength={15}
                    value={form.gstin}
                    onChange={(e) => handleGstinChange(e.target.value)}
                    placeholder="29AABCK1234F1Z5"
                    className="w-full h-9 px-3 font-mono text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                  />
                </div>

                <div>
                  <label htmlFor="sup-state" className="block text-xs font-medium text-slate-700 mb-1">
                    State *
                  </label>
                  <select
                    id="sup-state"
                    value={form.state}
                    onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))}
                    className="w-full h-9 px-3 text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                  >
                    {INDIAN_STATES.map((st) => (
                      <option key={st.code} value={st.name}>
                        {st.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="sup-address" className="block text-xs font-medium text-slate-700 mb-1">
                  Supplier Address *
                </label>
                <textarea
                  id="sup-address"
                  rows={2}
                  required
                  maxLength={BLUEPRINT_CONSTRAINTS.address.maxLength}
                  value={form.address}
                  onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                  placeholder="Unit 14, Peenya Industrial Area Phase II, Bengaluru"
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
                  {saving
                    ? 'Saving to Firestore...'
                    : editingSupplier
                      ? 'Update Supplier'
                      : 'Save Supplier'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletingSupplier && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-supplier-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/50"
        >
          <div className="w-full max-w-md bg-white border border-[#DCE6E6] rounded-xl p-6 space-y-4">
            <h2 id="delete-supplier-title" className="text-base font-semibold text-[#3B4F4E]">
              Delete Supplier
            </h2>
            <p className="text-sm text-slate-600">
              Permanently remove <span className="font-semibold text-[#3B4F4E]">{deletingSupplier.name}</span> from Firestore?
            </p>
            {deleteError && (
              <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
                {deleteError}
              </p>
            )}
            <div className="pt-2 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeletingSupplier(null)}
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
                {deleting ? 'Deleting...' : 'Delete Supplier'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
