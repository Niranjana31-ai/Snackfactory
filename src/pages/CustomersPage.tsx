import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Edit3,
  Plus,
  Search,
  Trash2,
  Users,
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
import { findStateByCode, findStateByName, INDIAN_STATES } from '../config/indianStates';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../lib/firebase';
import { handleFirestoreError, OperationType } from '../lib/firestoreError';
import { BLUEPRINT_CONSTRAINTS, validateCustomerInput } from '../lib/validation';
import {
  CUSTOMER_TYPES,
  ORG_ID,
  type Customer,
  type CustomerType,
} from '../types/erp';

type TypeFilter = 'All' | CustomerType;

const DEFAULT_STATE = INDIAN_STATES.find((s) => s.code === '27') ?? INDIAN_STATES[0];

const INITIAL_FORM = {
  name: '',
  contactPerson: '',
  phone: '',
  email: '',
  gstin: '',
  billingAddress: '',
  state: DEFAULT_STATE.name,
  stateCode: DEFAULT_STATE.code,
  customerType: 'Retailer' as CustomerType,
};

export function CustomersPage() {
  const { firebaseUser, userProfile, effectiveRole } = useAuth();
  const activeRole = effectiveRole ?? userProfile?.role ?? 'Salesman';
  const canManage =
    activeRole === 'Owner' || activeRole === 'Admin' || activeRole === 'Salesman';
  const canDelete = activeRole === 'Owner' || activeRole === 'Admin';

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('All');
  const [stateFilter, setStateFilter] = useState<string>('All');

  const [modalOpen, setModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [form, setForm] = useState(INITIAL_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [deletingCustomer, setDeletingCustomer] = useState<Customer | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!firebaseUser) return;
    setLoading(true);
    setLoadError(null);

    const q = query(collection(db, 'customers'), where('orgId', '==', ORG_ID));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const rows = snapshot.docs.map((d) => d.data() as Customer);
        rows.sort((a, b) => a.name.localeCompare(b.name));
        setCustomers(rows);
        setLoading(false);
      },
      (error) => {
        setLoading(false);
        setLoadError('Unable to load customers from Cloud Firestore.');
        handleFirestoreError(error, OperationType.LIST, 'customers');
      },
    );

    return () => unsubscribe();
  }, [firebaseUser]);

  const activeStates = useMemo(() => {
    const set = new Set<string>();
    customers.forEach((c) => {
      if (c.state) set.add(c.state);
    });
    return Array.from(set).sort();
  }, [customers]);

  const filteredCustomers = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return customers.filter((c) => {
      const matchesType = typeFilter === 'All' || c.customerType === typeFilter;
      const matchesState = stateFilter === 'All' || c.state === stateFilter;
      const matchesSearch =
        !term ||
        c.name.toLowerCase().includes(term) ||
        c.contactPerson.toLowerCase().includes(term) ||
        c.phone.toLowerCase().includes(term) ||
        c.email.toLowerCase().includes(term) ||
        c.gstin.toLowerCase().includes(term) ||
        c.state.toLowerCase().includes(term);
      return matchesType && matchesState && matchesSearch;
    });
  }, [customers, searchTerm, typeFilter, stateFilter]);

  const openCreateModal = () => {
    setEditingCustomer(null);
    setForm(INITIAL_FORM);
    setFormError(null);
    setModalOpen(true);
  };

  const openEditModal = (customer: Customer) => {
    setEditingCustomer(customer);
    setForm({
      name: customer.name,
      contactPerson: customer.contactPerson,
      phone: customer.phone,
      email: customer.email,
      gstin: customer.gstin,
      billingAddress: customer.billingAddress,
      state: customer.state,
      stateCode: customer.stateCode,
      customerType: customer.customerType,
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
      ...(matched ? { state: matched.name, stateCode: matched.code } : {}),
    }));
  };

  const handleStateSelect = (stateName: string) => {
    const matched = findStateByName(stateName);
    setForm((f) => ({
      ...f,
      state: stateName,
      stateCode: matched ? matched.code : f.stateCode,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !canManage) return;

    const validation = validateCustomerInput(form);
    if (!validation.valid) {
      setFormError(validation.error);
      return;
    }

    setSaving(true);
    setFormError(null);

    try {
      if (editingCustomer) {
        await updateDoc(doc(db, 'customers', editingCustomer.id), {
          ...validation.sanitized,
          updatedAt: serverTimestamp(),
        });
      } else {
        const newRef = doc(collection(db, 'customers'));
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
          editingCustomer ? OperationType.UPDATE : OperationType.CREATE,
          editingCustomer ? `customers/${editingCustomer.id}` : 'customers',
        );
      }
      setFormError('Failed to save customer to Cloud Firestore. Please verify inputs and retry.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingCustomer || !canDelete) return;
    setDeleting(true);
    setDeleteError(null);

    try {
      await deleteDoc(doc(db, 'customers', deletingCustomer.id));
      setDeletingCustomer(null);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.toLowerCase().includes('permission')) {
        handleFirestoreError(error, OperationType.DELETE, `customers/${deletingCustomer.id}`);
      }
      setDeleteError('Failed to delete customer from Cloud Firestore.');
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
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#3B4F4E]">Customers</h1>
          <p className="mt-1 text-sm text-slate-600">
            Retailer and distributor accounts with GSTIN, billing addresses, and state codes.
          </p>
        </div>

        <div className="flex items-center gap-4 shrink-0">
          <div className="hidden sm:block text-right text-xs text-slate-500">
            <span className="font-mono tabular-nums font-medium text-[#3B4F4E]">
              {customers.length}
            </span>{' '}
            {customers.length === 1 ? 'customer' : 'customers'}
          </div>

          {canManage ? (
            <button
              type="button"
              onClick={openCreateModal}
              className="min-h-[40px] inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#CF9C2D] hover:bg-[#BC8B22] rounded-lg transition-colors whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3B4F4E]"
            >
              <Plus className="w-4 h-4 shrink-0" />
              Add Customer
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
        <div className="px-5 py-4 border-b border-[#DCE6E6] flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 flex-1">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search by customer, contact, phone, or GSTIN..."
                aria-label="Search customers"
                className="w-full h-9 pl-9 pr-3 text-sm text-[#3B4F4E] bg-slate-50 border border-[#DCE6E6] rounded-lg placeholder:text-slate-400 focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#CF9C2D]"
              />
            </div>

            <select
              aria-label="Filter by state"
              value={stateFilter}
              onChange={(e) => setStateFilter(e.target.value)}
              className="h-9 px-3 text-xs font-medium text-slate-700 bg-slate-50 border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
            >
              <option value="All">All States</option>
              {activeStates.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
          </div>

          <div
            role="tablist"
            aria-label="Filter by customer type"
            className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg self-start lg:self-auto"
          >
            {(['All', ...CUSTOMER_TYPES] as const).map((type) => (
              <button
                key={type}
                type="button"
                role="tab"
                aria-selected={typeFilter === type}
                onClick={() => setTypeFilter(type)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  typeFilter === type
                    ? 'bg-white text-[#3B4F4E] shadow-xs'
                    : 'text-slate-600 hover:text-[#3B4F4E]'
                }`}
              >
                {type}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#DCE6E6] bg-slate-50/70">
                <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 whitespace-nowrap">
                  Customer
                </th>
                <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 whitespace-nowrap">
                  Type
                </th>
                <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 whitespace-nowrap">
                  Contact
                </th>
                <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 whitespace-nowrap">
                  GSTIN
                </th>
                <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 whitespace-nowrap">
                  Billing Address
                </th>
                <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 whitespace-nowrap">
                  State / Code
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
                  <td colSpan={canManage || canDelete ? 7 : 6} className="px-5 py-12 text-center text-sm text-slate-500">
                    Loading customers from Cloud Firestore...
                  </td>
                </tr>
              ) : filteredCustomers.length === 0 ? (
                <tr>
                  <td colSpan={canManage || canDelete ? 7 : 6} className="px-6 py-16 text-center">
                    <div className="max-w-md mx-auto flex flex-col items-center">
                      <div className="w-11 h-11 rounded-xl bg-slate-100 border border-[#DCE6E6] flex items-center justify-center text-slate-500 mb-4">
                        <Users className="w-5 h-5" />
                      </div>
                      <h2 className="text-base font-semibold text-[#3B4F4E]">
                        {customers.length === 0 ? 'No customers added yet' : 'No matching customers'}
                      </h2>
                      <p className="mt-1.5 text-sm text-slate-600">
                        {customers.length === 0
                          ? 'Register retailers and distributors with GSTIN, billing address, and state code.'
                          : 'Adjust your search or filters to view other customer accounts.'}
                      </p>
                      {customers.length === 0 && canManage && (
                        <button
                          type="button"
                          onClick={openCreateModal}
                          className="mt-4 min-h-[38px] inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-[#CF9C2D] hover:bg-[#BC8B22] rounded-lg transition-colors whitespace-nowrap"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          Add First Customer
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                filteredCustomers.map((customer) => (
                  <tr key={customer.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-5 py-3.5 min-w-[180px]">
                      <p className="text-sm font-medium text-[#3B4F4E]">{customer.name}</p>
                      <p className="text-xs text-slate-500">{customer.contactPerson}</p>
                    </td>
                    <td className="px-5 py-3.5 text-sm text-slate-700 whitespace-nowrap">
                      {customer.customerType}
                    </td>
                    <td className="px-5 py-3.5 whitespace-nowrap">
                      <p className="font-mono text-xs text-slate-800">{customer.phone}</p>
                      {customer.email && (
                        <p className="text-xs text-slate-500 truncate max-w-[190px]">
                          {customer.email}
                        </p>
                      )}
                    </td>
                    <td className="px-5 py-3.5 font-mono text-xs text-slate-800 whitespace-nowrap">
                      {customer.gstin || 'Unregistered'}
                    </td>
                    <td className="px-5 py-3.5 text-xs text-slate-600 max-w-[240px]">
                      <p className="line-clamp-2">{customer.billingAddress}</p>
                    </td>
                    <td className="px-5 py-3.5 text-xs text-slate-700 whitespace-nowrap">
                      <span>{customer.state}</span>{' '}
                      <span className="font-mono text-slate-500">({customer.stateCode})</span>
                    </td>
                    {(canManage || canDelete) && (
                      <td className="px-5 py-3.5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-2">
                          {canManage && (
                            <button
                              type="button"
                              onClick={() => openEditModal(customer)}
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
                                setDeletingCustomer(customer);
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

      {/* Add / Edit Customer Modal */}
      {modalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="customer-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/50 overflow-y-auto"
        >
          <div className="w-full max-w-lg bg-white border border-[#DCE6E6] rounded-xl overflow-hidden my-8">
            <div className="px-6 py-4 border-b border-[#DCE6E6] flex items-center justify-between">
              <h2 id="customer-modal-title" className="text-base font-semibold text-[#3B4F4E]">
                {editingCustomer ? 'Edit Customer' : 'Add New Customer'}
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
                  <label htmlFor="cust-name" className="block text-xs font-medium text-slate-700 mb-1">
                    Customer / Business Name *
                  </label>
                  <input
                    id="cust-name"
                    type="text"
                    required
                    maxLength={BLUEPRINT_CONSTRAINTS.masterName.maxLength}
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="Shree Ganesh Distributors"
                    className="w-full h-9 px-3 text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                  />
                </div>

                <div>
                  <label htmlFor="cust-type" className="block text-xs font-medium text-slate-700 mb-1">
                    Customer Type *
                  </label>
                  <select
                    id="cust-type"
                    value={form.customerType}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, customerType: e.target.value as CustomerType }))
                    }
                    className="w-full h-9 px-3 text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                  >
                    {CUSTOMER_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="cust-contact" className="block text-xs font-medium text-slate-700 mb-1">
                    Contact Person *
                  </label>
                  <input
                    id="cust-contact"
                    type="text"
                    required
                    maxLength={BLUEPRINT_CONSTRAINTS.contactPerson.maxLength}
                    value={form.contactPerson}
                    onChange={(e) => setForm((f) => ({ ...f, contactPerson: e.target.value }))}
                    placeholder="Ramesh Kulkarni"
                    className="w-full h-9 px-3 text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                  />
                </div>

                <div>
                  <label htmlFor="cust-phone" className="block text-xs font-medium text-slate-700 mb-1">
                    Phone Number *
                  </label>
                  <input
                    id="cust-phone"
                    type="tel"
                    required
                    maxLength={BLUEPRINT_CONSTRAINTS.phone.maxLength}
                    value={form.phone}
                    onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                    placeholder="+91 98200 11223"
                    className="w-full h-9 px-3 font-mono text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="cust-email" className="block text-xs font-medium text-slate-700 mb-1">
                    Email
                  </label>
                  <input
                    id="cust-email"
                    type="email"
                    maxLength={BLUEPRINT_CONSTRAINTS.email.maxLength}
                    value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    placeholder="orders@distributor.in"
                    className="w-full h-9 px-3 text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                  />
                </div>

                <div>
                  <label htmlFor="cust-gstin" className="block text-xs font-medium text-slate-700 mb-1">
                    GSTIN (15 chars, optional)
                  </label>
                  <input
                    id="cust-gstin"
                    type="text"
                    maxLength={15}
                    value={form.gstin}
                    onChange={(e) => handleGstinChange(e.target.value)}
                    placeholder="27AABCU9603R1ZM"
                    className="w-full h-9 px-3 font-mono text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="cust-address" className="block text-xs font-medium text-slate-700 mb-1">
                  Billing Address *
                </label>
                <textarea
                  id="cust-address"
                  rows={2}
                  required
                  maxLength={BLUEPRINT_CONSTRAINTS.address.maxLength}
                  value={form.billingAddress}
                  onChange={(e) => setForm((f) => ({ ...f, billingAddress: e.target.value }))}
                  placeholder="Plot 42, APMC Market Yard, Vashi, Navi Mumbai"
                  className="w-full p-3 text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-2">
                  <label htmlFor="cust-state" className="block text-xs font-medium text-slate-700 mb-1">
                    State *
                  </label>
                  <select
                    id="cust-state"
                    value={form.state}
                    onChange={(e) => handleStateSelect(e.target.value)}
                    className="w-full h-9 px-3 text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                  >
                    {INDIAN_STATES.map((st) => (
                      <option key={st.code} value={st.name}>
                        {st.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="cust-state-code" className="block text-xs font-medium text-slate-700 mb-1">
                    State Code *
                  </label>
                  <input
                    id="cust-state-code"
                    type="text"
                    required
                    maxLength={BLUEPRINT_CONSTRAINTS.stateCode.maxLength}
                    value={form.stateCode}
                    onChange={(e) => setForm((f) => ({ ...f, stateCode: e.target.value }))}
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
                    : editingCustomer
                      ? 'Update Customer'
                      : 'Save Customer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletingCustomer && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-customer-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/50"
        >
          <div className="w-full max-w-md bg-white border border-[#DCE6E6] rounded-xl p-6 space-y-4">
            <h2 id="delete-customer-title" className="text-base font-semibold text-[#3B4F4E]">
              Delete Customer
            </h2>
            <p className="text-sm text-slate-600">
              Permanently remove <span className="font-semibold text-[#3B4F4E]">{deletingCustomer.name}</span> from Firestore?
            </p>
            {deleteError && (
              <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
                {deleteError}
              </p>
            )}
            <div className="pt-2 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeletingCustomer(null)}
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
                {deleting ? 'Deleting...' : 'Delete Customer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
