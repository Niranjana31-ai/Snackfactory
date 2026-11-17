import { useState } from 'react';
import { CheckCircle2, LogOut, Menu } from 'lucide-react';
import { getModuleById } from '../config/navigation';
import { useAuth } from '../contexts/AuthContext';
import { ERP_ROLES, type ErpRole, type ModuleId } from '../types/erp';

interface TopBarProps {
  activeModule: ModuleId;
  onOpenMobileMenu: () => void;
}

export function TopBar({ activeModule, onOpenMobileMenu }: TopBarProps) {
  const { userProfile, effectiveRole, previewRole, setPreviewRole, logout } = useAuth();
  const [signingOut, setSigningOut] = useState(false);

  const currentModule = getModuleById(activeModule);
  const displayName = userProfile?.displayName ?? 'Operator';

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await logout();
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <header className="no-print h-16 bg-[#EEF3F3]/95 backdrop-blur-xs border-b border-[#DCE6E6] px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-4 sticky top-0 z-30">
      {/* Left: Mobile Trigger + Clean Breadcrumb */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onOpenMobileMenu}
          aria-label="Open navigation menu"
          className="lg:hidden min-h-[40px] min-w-[40px] flex items-center justify-center rounded-full bg-white border border-[#DCE6E6] text-[#3B4F4E] hover:bg-[#E5EDED] shrink-0"
        >
          <Menu className="w-5 h-5" />
        </button>

        <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-xs sm:text-sm min-w-0">
          <span className="hidden sm:inline text-[#6C7E7D] whitespace-nowrap font-medium">
            SnackFactory
          </span>
          <span className="hidden sm:inline text-[#AFC2C0]" aria-hidden="true">
            /
          </span>
          <span className="hidden md:inline text-[#6C7E7D] whitespace-nowrap">
            {currentModule.section}
          </span>
          <span className="hidden md:inline text-[#AFC2C0]" aria-hidden="true">
            /
          </span>
          <span className="font-semibold tracking-wide text-[#3B4F4E] uppercase truncate">
            {currentModule.label}
          </span>
        </nav>
      </div>

      {/* Right: Optional Owner Role Preview + Operator Summary + Sign Out Pill */}
      <div className="flex items-center gap-3 shrink-0">
        {userProfile?.role === 'Owner' && (
          <div className="hidden xl:flex items-center gap-2">
            <label
              htmlFor="role-preview-select"
              className="text-[11px] font-semibold uppercase tracking-wider text-[#6C7E7D] whitespace-nowrap"
            >
              Preview
            </label>
            <select
              id="role-preview-select"
              value={previewRole ?? 'Owner'}
              onChange={(e) => setPreviewRole(e.target.value as ErpRole)}
              className="h-9 px-4 text-xs font-semibold text-[#3B4F4E] bg-white border border-[#DCE6E6] rounded-full focus:outline-none focus:ring-2 focus:ring-[#CF9C2D]"
            >
              {ERP_ROLES.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="hidden sm:flex items-center gap-2 bg-white border border-[#DCE6E6] rounded-full px-3.5 py-1.5 min-w-0">
          <CheckCircle2 className="w-3.5 h-3.5 text-[#CF9C2D] shrink-0" />
          <span className="text-xs font-semibold text-[#3B4F4E] truncate max-w-[140px]">
            {displayName}
          </span>
          <span className="text-[#AFC2C0]" aria-hidden="true">
            ·
          </span>
          <span className="text-[11px] font-medium text-[#6C7E7D] truncate max-w-[130px]">
            {effectiveRole ?? userProfile?.role ?? 'Verified'}
          </span>
        </div>

        <button
          type="button"
          onClick={() => void handleSignOut()}
          disabled={signingOut}
          className="min-h-[38px] inline-flex items-center gap-2 px-4 py-1.5 text-xs font-semibold tracking-wide uppercase text-[#3B4F4E] bg-white hover:bg-[#3B4F4E] hover:text-white border border-[#DCE6E6] rounded-full transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#CF9C2D]"
        >
          <LogOut className="w-3.5 h-3.5 shrink-0" />
          <span>{signingOut ? 'Signing out...' : 'Sign out'}</span>
        </button>
      </div>
    </header>
  );
}
