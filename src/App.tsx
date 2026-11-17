/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import { Factory, ShieldAlert } from 'lucide-react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LoginPage } from './components/LoginPage';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { isModuleAllowedForRole } from './config/navigation';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { BomPage } from './pages/BomPage';
import { CostingPage } from './pages/CostingPage';
import { CustomersPage } from './pages/CustomersPage';
import { DashboardPage } from './pages/DashboardPage';
import { DispatchPage } from './pages/DispatchPage';
import { InventoryPage } from './pages/InventoryPage';
import { InvoicesPage } from './pages/InvoicesPage';
import { PaymentsPage } from './pages/PaymentsPage';
import { ProductionPage } from './pages/ProductionPage';
import { ProductsPage } from './pages/ProductsPage';
import { PurchasesPage } from './pages/PurchasesPage';
import { RawMaterialsPage } from './pages/RawMaterialsPage';
import { ReportsPage } from './pages/ReportsPage';
import { SalesOrdersPage } from './pages/SalesOrdersPage';
import { SuppliersPage } from './pages/SuppliersPage';
import { UserManagementPage } from './pages/UserManagementPage';
import type { ModuleId } from './types/erp';

function ErpShell() {
  const {
    authReady,
    firebaseUser,
    userProfile,
    loadingProfile,
    authError,
    effectiveRole,
    previewRole,
    setPreviewRole,
    retryProfileSync,
    logout,
  } = useAuth();

  const [activeModule, setActiveModule] = useState<ModuleId>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const activeRole = effectiveRole ?? userProfile?.role ?? 'Salesman';

  useEffect(() => {
    if (firebaseUser) {
      setActiveModule('dashboard');
    }
  }, [firebaseUser?.uid]);

  useEffect(() => {
    if (!isModuleAllowedForRole(activeModule, activeRole)) {
      setActiveModule('dashboard');
    }
  }, [activeModule, activeRole]);

  if (!authReady || (firebaseUser && loadingProfile)) {
    return (
      <div className="min-h-screen bg-[#D5E1E2] flex items-center justify-center p-6">
        <div className="flex flex-col items-center gap-3 text-center bg-white rounded-[24px] px-8 py-7 border border-[#DCE6E6] shadow-sm">
          <div className="w-11 h-11 rounded-full bg-[#3B4F4E] flex items-center justify-center text-[#CF9C2D]">
            <Factory className="w-5 h-5" />
          </div>
          <p className="text-sm font-semibold text-[#3B4F4E]">Loading SnackFactory ERP</p>
          <p className="text-xs text-[#6C7E7D]">Verifying authentication and role permissions...</p>
        </div>
      </div>
    );
  }

  if (!firebaseUser) {
    return <LoginPage />;
  }

  if (!userProfile) {
    return (
      <div className="min-h-screen bg-[#D5E1E2] flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white border border-[#DCE6E6] rounded-[24px] p-8 text-center shadow-sm">
          <div className="w-12 h-12 rounded-full bg-[#EEF3F3] border border-[#DCE6E6] flex items-center justify-center text-[#3B4F4E] mx-auto mb-4">
            <Factory className="w-5 h-5" />
          </div>
          <h1 className="text-lg font-semibold text-[#3B4F4E]">Syncing Operator Profile</h1>
          <p className="mt-2 text-sm text-[#6C7E7D] leading-relaxed">
            Authenticated as{' '}
            <span className="font-mono text-xs text-[#3B4F4E]">
              {firebaseUser.email?.replace('@users.snackfactory.internal', '') ?? firebaseUser.uid}
            </span>
            . {authError ? authError : 'Waiting for Firestore user profile synchronization.'}
          </p>
          <div className="mt-6 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => void retryProfileSync()}
              className="min-h-[40px] px-5 py-2 text-xs font-semibold uppercase tracking-wide text-white bg-[#CF9C2D] hover:bg-[#BC8B22] rounded-full transition-colors whitespace-nowrap"
            >
              Retry Sync
            </button>
            <button
              type="button"
              onClick={() => void logout()}
              className="min-h-[40px] px-5 py-2 text-xs font-semibold uppercase tracking-wide text-[#3B4F4E] bg-[#EEF3F3] hover:bg-[#E5EDED] border border-[#DCE6E6] rounded-full transition-colors whitespace-nowrap"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (userProfile.status === 'Suspended') {
    return (
      <div className="min-h-screen bg-[#D5E1E2] flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white border border-[#DCE6E6] rounded-[24px] p-8 text-center shadow-sm">
          <div className="w-12 h-12 rounded-full bg-red-50 border border-red-200 flex items-center justify-center text-red-700 mx-auto mb-4">
            <ShieldAlert className="w-5 h-5" />
          </div>
          <h1 className="text-lg font-semibold text-[#3B4F4E]">Account Suspended</h1>
          <p className="mt-2 text-sm text-[#6C7E7D] leading-relaxed">
            Access for <span className="font-mono text-xs">{userProfile.email}</span> is currently
            suspended. Contact a SnackFactory Owner or Admin to restore permissions.
          </p>
          <button
            type="button"
            onClick={() => void logout()}
            className="mt-6 min-h-[40px] px-6 py-2 text-xs font-semibold uppercase tracking-wide text-white bg-[#3B4F4E] hover:bg-[#2C3C3B] rounded-full transition-colors whitespace-nowrap"
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#D5E1E2] relative overflow-x-clip lg:p-5 xl:p-7 flex">
      {/* Ambient Golden & Soft Sage Backdrop Accents matching Reference */}
      <div
        aria-hidden="true"
        className="no-print hidden lg:block fixed -top-24 -left-24 w-72 h-72 rounded-full bg-[#CF9C2D] opacity-90 pointer-events-none"
      />
      <div
        aria-hidden="true"
        className="no-print hidden lg:block fixed -bottom-32 -right-24 w-[420px] h-[420px] rounded-full bg-[#C7D8DA] opacity-70 pointer-events-none"
      />

      {/* Rounded App Shell Container */}
      <div className="relative z-10 flex-1 w-full max-w-[1460px] mx-auto bg-[#EEF3F3] lg:rounded-[28px] lg:shadow-[0_24px_60px_-18px_rgba(32,48,47,0.22)] flex lg:overflow-hidden min-h-screen lg:min-h-[calc(100vh-3.5rem)]">
        <Sidebar
          activeModule={activeModule}
          activeRole={activeRole}
          actualRole={userProfile.role}
          isPreviewing={Boolean(previewRole)}
          mobileOpen={mobileMenuOpen}
          onSelectModule={setActiveModule}
          onCloseMobile={() => setMobileMenuOpen(false)}
          onResetPreview={() => setPreviewRole(null)}
        />

        <div className="flex-1 min-w-0 flex flex-col bg-[#EEF3F3]">
          <TopBar
            activeModule={activeModule}
            onOpenMobileMenu={() => setMobileMenuOpen(true)}
          />

          <main className="flex-1 p-4 sm:p-6 lg:p-7 w-full">
            {activeModule === 'dashboard' && (
              <DashboardPage onNavigate={setActiveModule} />
            )}

            {activeModule === 'products' && <ProductsPage />}

            {activeModule === 'raw-materials' && <RawMaterialsPage />}

            {activeModule === 'customers' && <CustomersPage />}

            {activeModule === 'suppliers' && <SuppliersPage />}

            {activeModule === 'purchases' && <PurchasesPage />}

            {activeModule === 'bom' && <BomPage />}

            {activeModule === 'production' && <ProductionPage />}

            {activeModule === 'inventory' && <InventoryPage />}

            {activeModule === 'sales-orders' && <SalesOrdersPage />}

            {activeModule === 'dispatch' && <DispatchPage />}

            {activeModule === 'invoices' && <InvoicesPage />}

            {activeModule === 'payments' && <PaymentsPage />}

            {activeModule === 'user-management' && (
              <UserManagementPage />
            )}

            {activeModule === 'costing' && <CostingPage />}

            {activeModule === 'reports' && <ReportsPage />}
          </main>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <ErpShell />
      </AuthProvider>
    </ErrorBoundary>
  );
}
