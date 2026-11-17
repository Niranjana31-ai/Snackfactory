import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Edit3,
  Eye,
  EyeOff,
  Search,
  ShieldAlert,
  Trash2,
  UserPlus,
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
import { ERP_MODULES, ROLE_DESCRIPTIONS } from '../config/navigation';
import { useAuth } from '../contexts/AuthContext';
import { db, provisionSecondaryAuthAccount } from '../lib/firebase';
import { handleFirestoreError, OperationType } from '../lib/firestoreError';
import {
  BLUEPRINT_CONSTRAINTS,
  validateCreateEmployeeInput,
  validateUserUpdateInput,
} from '../lib/validation';
import { ERP_ROLES, USER_STATUSES, type ErpRole, type ErpUser, type UserStatus } from '../types/erp';

type RoleFilter = 'All' | ErpRole;

const INITIAL_CREATE_FORM = {
  username: '',
  displayName: '',
  password: '',
  role: 'Salesman' as ErpRole,
  department: ROLE_DESCRIPTIONS.Salesman.defaultDepartment,
  status: 'Active' as UserStatus,
};

export function UserManagementPage() {
  const { firebaseUser, userProfile } = useAuth();
  const isOwnerOrAdmin =
    userProfile?.role === 'Owner' || userProfile?.role === 'Admin';

  const [users, setUsers] = useState<ErpUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('All');

  // Create Employee Modal state
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState(INITIAL_CREATE_FORM);
  const [deptTouched, setDeptTouched] = useState(false);
  const [showCreatePassword, setShowCreatePassword] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Edit Operator Modal state
  const [editingUser, setEditingUser] = useState<ErpUser | null>(null);
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editDepartment, setEditDepartment] = useState('');
  const [editRole, setEditRole] = useState<ErpRole>('Salesman');
  const [editStatus, setEditStatus] = useState<UserStatus>('Active');
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Delete Operator Modal state
  const [deletingUser, setDeletingUser] = useState<ErpUser | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!firebaseUser) return;

    setLoading(true);
    const usersPath = 'users';
    const usersQuery = isOwnerOrAdmin
      ? collection(db, usersPath)
      : query(collection(db, usersPath), where('uid', '==', firebaseUser.uid));

    const unsubscribe = onSnapshot(
      usersQuery,
      (snapshot) => {
        const list = snapshot.docs.map((d) => d.data() as ErpUser);
        list.sort((a, b) => a.displayName.localeCompare(b.displayName));
        setUsers(list);
        setLoading(false);
      },
      (error) => {
        setLoading(false);
        handleFirestoreError(error, OperationType.LIST, usersPath);
      },
    );

    return () => unsubscribe();
  }, [firebaseUser, isOwnerOrAdmin]);

  const filteredUsers = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return users.filter((u) => {
      const matchesRole = roleFilter === 'All' || u.role === roleFilter;
      const matchesSearch =
        !term ||
        u.displayName.toLowerCase().includes(term) ||
        (u.username && u.username.toLowerCase().includes(term)) ||
        u.email.toLowerCase().includes(term) ||
        u.department.toLowerCase().includes(term);
      return matchesRole && matchesSearch;
    });
  }, [users, searchTerm, roleFilter]);

  const openCreateModal = () => {
    setCreateForm(INITIAL_CREATE_FORM);
    setDeptTouched(false);
    setShowCreatePassword(false);
    setCreateError(null);
    setCreateOpen(true);
  };

  const handleCreateEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOwnerOrAdmin) return;

    const validation = validateCreateEmployeeInput(createForm);
    if (!validation.valid) {
      setCreateError(validation.error);
      return;
    }

    const duplicate = users.find(
      (u) => u.username?.toLowerCase() === validation.sanitized.username,
    );
    if (duplicate) {
      setCreateError(
        `Username "${validation.sanitized.username}" is already assigned to ${duplicate.displayName}.`,
      );
      return;
    }

    setCreating(true);
    setCreateError(null);

    try {
      await provisionSecondaryAuthAccount(
        validation.sanitized.username,
        validation.sanitized.password,
        async (newUid, authEmail) => {
          await setDoc(doc(db, 'users', newUid), {
            uid: newUid,
            username: validation.sanitized.username,
            displayName: validation.sanitized.displayName,
            email: authEmail,
            role: validation.sanitized.role,
            department: validation.sanitized.department,
            status: validation.sanitized.status,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            lastLoginAt: serverTimestamp(),
          });
        },
      );
      setCreateOpen(false);
    } catch (error) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? String((error as { code?: unknown }).code)
          : '';
      const message = error instanceof Error ? error.message : String(error);

      if (code === 'auth/email-already-in-use') {
        setCreateError(
          `Username "${validation.sanitized.username}" is already taken in Firebase Authentication.`,
        );
      } else if (code === 'auth/weak-password') {
        setCreateError('Password must be at least 6 characters.');
      } else if (code === 'auth/operation-not-allowed') {
        setCreateError(
          'Email/Password provider is disabled. Enable Email/Password in Firebase Console (Authentication -> Sign-in method).',
        );
      } else if (message.toLowerCase().includes('permission')) {
        handleFirestoreError(error, OperationType.CREATE, 'users');
      } else {
        setCreateError('Failed to create employee account. Please verify inputs and try again.');
      }
    } finally {
      setCreating(false);
    }
  };

  const openEditModal = (user: ErpUser) => {
    setEditingUser(user);
    setEditDisplayName(user.displayName);
    setEditDepartment(user.department);
    setEditRole(user.role);
    setEditStatus(user.status);
    setFormError(null);
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;

    const validation = validateUserUpdateInput({
      displayName: editDisplayName,
      department: editDepartment,
      role: editRole,
      status: editStatus,
    });

    if (!validation.valid) {
      setFormError(validation.error);
      return;
    }

    setSaving(true);
    setFormError(null);
    const targetPath = `users/${editingUser.uid}`;

    try {
      await updateDoc(doc(db, 'users', editingUser.uid), {
        displayName: validation.sanitized.displayName,
        department: validation.sanitized.department,
        role: validation.sanitized.role,
        status: validation.sanitized.status,
        updatedAt: serverTimestamp(),
      });
      setEditingUser(null);
    } catch (error) {
      setSaving(false);
      handleFirestoreError(error, OperationType.UPDATE, targetPath);
    }
    setSaving(false);
  };

  const handleDeleteUser = async () => {
    if (!deletingUser) return;
    setDeleting(true);
    const targetPath = `users/${deletingUser.uid}`;

    try {
      await deleteDoc(doc(db, 'users', deletingUser.uid));
      setDeletingUser(null);
    } catch (error) {
      setDeleting(false);
      handleFirestoreError(error, OperationType.DELETE, targetPath);
    }
    setDeleting(false);
  };

  const formatTimestamp = (ts: ErpUser['lastLoginAt']) => {
    if (!ts) return '—';
    try {
      return ts.toDate().toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
    } catch {
      return '—';
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-[#3B4F4E]">Finance & Governance</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#3B4F4E]">
            User Management
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Create employee accounts with unique usernames, assign ERP roles, and manage access
            status.
          </p>
        </div>

        <div className="flex items-center gap-4 shrink-0">
          <div className="hidden sm:flex items-center gap-2 text-xs text-slate-600 whitespace-nowrap">
            <Users className="w-4 h-4 text-slate-500 shrink-0" />
            <span className="font-mono tabular-nums font-medium text-[#3B4F4E]">
              {users.length} {users.length === 1 ? 'employee' : 'employees'}
            </span>
          </div>

          {isOwnerOrAdmin && (
            <button
              type="button"
              onClick={openCreateModal}
              className="min-h-[40px] inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#CF9C2D] hover:bg-[#BC8B22] rounded-lg transition-colors whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3B4F4E]"
            >
              <UserPlus className="w-4 h-4 shrink-0" />
              Create Employee
            </button>
          )}
        </div>
      </div>

      {/* Directory Table */}
      <section className="bg-white border border-[#DCE6E6] rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#DCE6E6] flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search employees by name, username, or department..."
              aria-label="Search employees"
              className="w-full h-9 pl-9 pr-3 text-sm text-[#3B4F4E] bg-slate-50 border border-[#DCE6E6] rounded-lg placeholder:text-slate-400 focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#CF9C2D]"
            />
          </div>

          <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {(['All', ...ERP_ROLES] as const).map((role) => (
              <button
                key={role}
                type="button"
                onClick={() => setRoleFilter(role)}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  roleFilter === role
                    ? 'bg-white text-[#3B4F4E] shadow-xs'
                    : 'text-slate-600 hover:text-[#3B4F4E]'
                }`}
              >
                {role}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#DCE6E6] bg-slate-50/70">
                <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 whitespace-nowrap">
                  Employee
                </th>
                <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 whitespace-nowrap">
                  Username
                </th>
                <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 whitespace-nowrap">
                  Role
                </th>
                <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 whitespace-nowrap">
                  Department
                </th>
                <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 whitespace-nowrap">
                  Status
                </th>
                <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 whitespace-nowrap">
                  Last Login
                </th>
                <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 text-right whitespace-nowrap">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-sm text-slate-500">
                    Loading employee directory from Cloud Firestore...
                  </td>
                </tr>
              ) : filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-sm text-slate-500">
                    No employees match the current search or role filter.
                  </td>
                </tr>
              ) : (
                filteredUsers.map((operator) => {
                  const isSelf = operator.uid === userProfile?.uid;
                  return (
                    <tr key={operator.uid} className="hover:bg-slate-50/70 transition-colors">
                      <td className="px-5 py-3.5 text-sm font-medium text-[#3B4F4E] whitespace-nowrap">
                        {operator.displayName}
                        {isSelf && (
                          <span className="ml-2 text-xs font-normal text-slate-500">(You)</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 font-mono text-xs text-slate-700 whitespace-nowrap">
                        {operator.username ?? operator.email}
                      </td>
                      <td className="px-5 py-3.5 text-sm text-slate-800 whitespace-nowrap">
                        {operator.role}
                      </td>
                      <td className="px-5 py-3.5 text-sm text-slate-600 whitespace-nowrap">
                        {operator.department}
                      </td>
                      <td className="px-5 py-3.5 text-xs font-medium whitespace-nowrap">
                        {operator.status === 'Active' ? (
                          <span className="inline-flex items-center gap-1.5 text-emerald-700">
                            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                            Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-red-700">
                            <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                            Suspended
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 font-mono text-xs text-slate-500 tabular-nums whitespace-nowrap">
                        {formatTimestamp(operator.lastLoginAt)}
                      </td>
                      <td className="px-5 py-3.5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => openEditModal(operator)}
                            className="min-h-[32px] inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-[#DCE6E6] rounded-md transition-colors"
                          >
                            <Edit3 className="w-3.5 h-3.5 text-slate-500" />
                            Edit
                          </button>
                          {!isSelf && (
                            <button
                              type="button"
                              onClick={() => setDeletingUser(operator)}
                              className="min-h-[32px] inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-red-700 bg-white hover:bg-red-50 border border-[#DCE6E6] rounded-md transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              Remove
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
      </section>

      {/* Role-Based Access Matrix */}
      <section className="bg-white border border-[#DCE6E6] rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-[#DCE6E6]">
          <h2 className="text-base font-semibold text-[#3B4F4E]">
            Role-Based Navigation Matrix
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Module visibility enforced per SnackFactory ERP role across all 16 workspace pages.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#DCE6E6] bg-slate-50/70">
                <th scope="col" className="px-5 py-3 text-xs font-semibold text-slate-600 whitespace-nowrap">
                  Module
                </th>
                {ERP_ROLES.map((role) => (
                  <th
                    key={role}
                    scope="col"
                    className="px-4 py-3 text-xs font-semibold text-slate-600 text-center whitespace-nowrap"
                  >
                    {role}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {ERP_MODULES.map((mod) => (
                <tr key={mod.id} className="hover:bg-slate-50/70">
                  <td className="px-5 py-2.5 text-sm font-medium text-slate-800 whitespace-nowrap">
                    {mod.label}
                    <span className="ml-2 text-xs font-normal text-slate-400">
                      · {mod.section}
                    </span>
                  </td>
                  {ERP_ROLES.map((role) => {
                    const allowed = mod.allowedRoles.includes(role);
                    return (
                      <td key={role} className="px-4 py-2.5 text-center text-xs whitespace-nowrap">
                        {allowed ? (
                          <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                            Allowed
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Create Employee Modal */}
      {createOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-employee-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/50 overflow-y-auto"
        >
          <div className="w-full max-w-md bg-white border border-[#DCE6E6] rounded-xl overflow-hidden my-8">
            <div className="px-6 py-4 border-b border-[#DCE6E6] flex items-center justify-between">
              <h3 id="create-employee-title" className="text-base font-semibold text-[#3B4F4E]">
                Create Employee Account
              </h3>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                aria-label="Close modal"
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={(e) => void handleCreateEmployee(e)} className="p-6 space-y-4">
              {createError && (
                <div
                  role="alert"
                  className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-start gap-2"
                >
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{createError}</span>
                </div>
              )}

              <div>
                <label htmlFor="create-username" className="block text-xs font-medium text-slate-700 mb-1">
                  Username *
                </label>
                <input
                  id="create-username"
                  type="text"
                  required
                  maxLength={30}
                  value={createForm.username}
                  onChange={(e) =>
                    setCreateForm((f) => ({ ...f, username: e.target.value.toLowerCase() }))
                  }
                  placeholder="ramesh.sales"
                  className="w-full h-9 px-3 font-mono text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  3–30 chars: lowercase letters, numbers, dots, underscores, or hyphens.
                </p>
              </div>

              <div>
                <label htmlFor="create-display-name" className="block text-xs font-medium text-slate-700 mb-1">
                  Full Name *
                </label>
                <input
                  id="create-display-name"
                  type="text"
                  required
                  maxLength={BLUEPRINT_CONSTRAINTS.displayName.maxLength}
                  value={createForm.displayName}
                  onChange={(e) =>
                    setCreateForm((f) => ({ ...f, displayName: e.target.value }))
                  }
                  placeholder="Ramesh Kulkarni"
                  className="w-full h-9 px-3 text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                />
              </div>

              <div>
                <label htmlFor="create-password" className="block text-xs font-medium text-slate-700 mb-1">
                  Password *
                </label>
                <div className="relative">
                  <input
                    id="create-password"
                    type={showCreatePassword ? 'text' : 'password'}
                    required
                    minLength={6}
                    value={createForm.password}
                    onChange={(e) =>
                      setCreateForm((f) => ({ ...f, password: e.target.value }))
                    }
                    placeholder="Minimum 6 characters"
                    className="w-full h-9 pl-3 pr-10 text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCreatePassword((prev) => !prev)}
                    aria-label={showCreatePassword ? 'Hide password' : 'Show password'}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 rounded"
                  >
                    {showCreatePassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
                <p className="mt-1 text-[11px] text-slate-500">
                  Secured by Firebase Authentication. Never stored in Firestore.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="create-role" className="block text-xs font-medium text-slate-700 mb-1">
                    Assigned Role *
                  </label>
                  <select
                    id="create-role"
                    value={createForm.role}
                    onChange={(e) => {
                      const nextRole = e.target.value as ErpRole;
                      setCreateForm((f) => ({
                        ...f,
                        role: nextRole,
                        department: deptTouched
                          ? f.department
                          : ROLE_DESCRIPTIONS[nextRole].defaultDepartment,
                      }));
                    }}
                    className="w-full h-9 px-3 text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                  >
                    {ERP_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="create-status" className="block text-xs font-medium text-slate-700 mb-1">
                    Status *
                  </label>
                  <select
                    id="create-status"
                    value={createForm.status}
                    onChange={(e) =>
                      setCreateForm((f) => ({ ...f, status: e.target.value as UserStatus }))
                    }
                    className="w-full h-9 px-3 text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                  >
                    {USER_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="create-department" className="block text-xs font-medium text-slate-700 mb-1">
                  Department *
                </label>
                <input
                  id="create-department"
                  type="text"
                  required
                  maxLength={BLUEPRINT_CONSTRAINTS.department.maxLength}
                  value={createForm.department}
                  onChange={(e) => {
                    setDeptTouched(true);
                    setCreateForm((f) => ({ ...f, department: e.target.value }));
                  }}
                  className="w-full h-9 px-3 text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                />
              </div>

              <div className="pt-4 border-t border-[#DCE6E6] flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  className="min-h-[38px] px-4 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-[#DCE6E6] rounded-lg whitespace-nowrap"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="min-h-[38px] px-4 py-2 text-xs font-medium text-white bg-[#CF9C2D] hover:bg-[#BC8B22] disabled:opacity-60 rounded-lg whitespace-nowrap"
                >
                  {creating ? 'Creating Account...' : 'Create Employee'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Operator Modal */}
      {editingUser && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-operator-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/50"
        >
          <div className="w-full max-w-md bg-white border border-[#DCE6E6] rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-[#DCE6E6] flex items-center justify-between">
              <h3 id="edit-operator-title" className="text-base font-semibold text-[#3B4F4E]">
                Edit Employee Access
              </h3>
              <button
                type="button"
                onClick={() => setEditingUser(null)}
                aria-label="Close modal"
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={(e) => void handleSaveUser(e)} className="p-6 space-y-4">
              {formError && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                  {formError}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Username
                </label>
                <input
                  type="text"
                  value={editingUser.username ?? editingUser.email}
                  disabled
                  className="w-full h-9 px-3 text-xs font-mono text-slate-500 bg-slate-100 border border-[#DCE6E6] rounded-lg"
                />
              </div>

              <div>
                <label htmlFor="edit-display-name" className="block text-xs font-medium text-slate-700 mb-1">
                  Full Name
                </label>
                <input
                  id="edit-display-name"
                  type="text"
                  required
                  maxLength={BLUEPRINT_CONSTRAINTS.displayName.maxLength}
                  value={editDisplayName}
                  onChange={(e) => setEditDisplayName(e.target.value)}
                  className="w-full h-9 px-3 text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                />
              </div>

              <div>
                <label htmlFor="edit-role" className="block text-xs font-medium text-slate-700 mb-1">
                  ERP Role
                </label>
                <select
                  id="edit-role"
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value as ErpRole)}
                  className="w-full h-9 px-3 text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                >
                  {ERP_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="edit-department" className="block text-xs font-medium text-slate-700 mb-1">
                  Department
                </label>
                <input
                  id="edit-department"
                  type="text"
                  required
                  maxLength={BLUEPRINT_CONSTRAINTS.department.maxLength}
                  value={editDepartment}
                  onChange={(e) => setEditDepartment(e.target.value)}
                  className="w-full h-9 px-3 text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                />
              </div>

              <div>
                <label htmlFor="edit-status" className="block text-xs font-medium text-slate-700 mb-1">
                  Account Status
                </label>
                <select
                  id="edit-status"
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value as UserStatus)}
                  className="w-full h-9 px-3 text-sm text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
                >
                  {USER_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </div>

              <div className="pt-4 border-t border-[#DCE6E6] flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
                  className="min-h-[38px] px-4 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-[#DCE6E6] rounded-lg whitespace-nowrap"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="min-h-[38px] px-4 py-2 text-xs font-medium text-white bg-[#CF9C2D] hover:bg-[#BC8B22] disabled:opacity-60 rounded-lg whitespace-nowrap"
                >
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletingUser && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-operator-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/50"
        >
          <div className="w-full max-w-md bg-white border border-[#DCE6E6] rounded-xl p-6 space-y-4">
            <h3 id="delete-operator-title" className="text-base font-semibold text-[#3B4F4E]">
              Remove Employee Record
            </h3>
            <p className="text-sm text-slate-600 leading-relaxed">
              Remove <span className="font-semibold text-[#3B4F4E]">{deletingUser.displayName}</span> (
              <span className="font-mono text-xs">{deletingUser.username ?? deletingUser.email}</span>) from the SnackFactory
              users collection?
            </p>
            <div className="pt-3 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeletingUser(null)}
                className="min-h-[38px] px-4 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-[#DCE6E6] rounded-lg whitespace-nowrap"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteUser()}
                disabled={deleting}
                className="min-h-[38px] px-4 py-2 text-xs font-medium text-white bg-red-600 hover:bg-red-700 disabled:bg-red-400 rounded-lg whitespace-nowrap"
              >
                {deleting ? 'Removing...' : 'Remove Employee'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
