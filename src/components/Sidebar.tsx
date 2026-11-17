import type { ComponentType } from 'react';
import {
  BarChart3,
  Boxes,
  Calculator,
  ClipboardList,
  Factory,
  FileSpreadsheet,
  GitBranch,
  LayoutDashboard,
  Package,
  Receipt,
  ShoppingBag,
  Truck,
  UserCog,
  Users,
  Wallet,
  Wheat,
  X,
} from 'lucide-react';
import { getModulesForRole, NAV_SECTIONS } from '../config/navigation';
import { useAuth } from '../contexts/AuthContext';
import type { ErpRole, ModuleId } from '../types/erp';

const MODULE_ICONS: Record<ModuleId, ComponentType<{ className?: string }>> = {
  dashboard: LayoutDashboard,
  products: Package,
  customers: Users,
  suppliers: Factory,
  'raw-materials': Wheat,
  purchases: ShoppingBag,
  bom: GitBranch,
  production: ClipboardList,
  inventory: Boxes,
  'sales-orders': FileSpreadsheet,
  dispatch: Truck,
  invoices: Receipt,
  payments: Wallet,
  costing: Calculator,
  reports: BarChart3,
  'user-management': UserCog,
};

interface SidebarProps {
  activeModule: ModuleId;
  activeRole: ErpRole;
  actualRole: ErpRole;
  isPreviewing: boolean;
  mobileOpen: boolean;
  onSelectModule: (id: ModuleId) => void;
  onCloseMobile: () => void;
  onResetPreview: () => void;
}

export function Sidebar({
  activeModule,
  activeRole,
  actualRole,
  isPreviewing,
  mobileOpen,
  onSelectModule,
  onCloseMobile,
  onResetPreview,
}: SidebarProps) {
  const { userProfile } = useAuth();
  const allowedModules = getModulesForRole(activeRole);

  const displayName = userProfile?.displayName ?? 'Operator';
  const usernameText = userProfile?.username ?? userProfile?.email ?? 'snackfactory';
  const initials = displayName
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const sidebarContent = (
    <div className="flex flex-col h-full bg-[#3B4F4E] text-white select-none overflow-hidden">
      {/* Top Operator Profile Card (Exact circular golden-ring avatar + uppercase name) */}
      <div className="px-6 pt-7 pb-5 flex flex-col items-center text-center relative shrink-0">
        <button
          type="button"
          onClick={onCloseMobile}
          aria-label="Close navigation menu"
          className="lg:hidden absolute top-4 right-4 p-2 rounded-full text-[#C8D7D6] hover:text-white hover:bg-[#2C3C3B]"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="relative w-16 h-16 flex items-center justify-center">
          <svg
            viewBox="0 0 72 72"
            aria-hidden="true"
            className="absolute inset-0 w-full h-full -rotate-45"
          >
            <circle
              cx="36"
              cy="36"
              r="33"
              fill="none"
              stroke="#526968"
              strokeWidth="2"
            />
            <circle
              cx="36"
              cy="36"
              r="33"
              fill="none"
              stroke="#CF9C2D"
              strokeWidth="2.5"
              strokeDasharray="135 220"
              strokeLinecap="round"
            />
          </svg>
          {userProfile?.photoURL ? (
            <img
              src={userProfile.photoURL}
              alt={displayName}
              referrerPolicy="no-referrer"
              className="w-13 h-13 rounded-full object-cover bg-[#2C3C3B]"
            />
          ) : (
            <div className="w-13 h-13 rounded-full bg-[#2C3C3B] text-white text-sm font-semibold tracking-wider flex items-center justify-center">
              {initials || 'SF'}
            </div>
          )}
        </div>

        <p className="mt-3 text-sm font-semibold tracking-[0.06em] uppercase text-white truncate max-w-[190px]">
          {displayName}
        </p>
        <p className="mt-0.5 text-[11px] text-[#AFC2C0] truncate max-w-[200px]">
          {usernameText} · {activeRole}
        </p>
      </div>

      {/* Role-Filtered Navigation with Signature Curved White Active Pill */}
      <nav
        aria-label="Primary ERP Navigation"
        className="flex-1 overflow-y-auto pl-5 pr-0 py-2 space-y-4"
      >
        {NAV_SECTIONS.map((section) => {
          const items = allowedModules.filter((mod) => mod.section === section);
          if (items.length === 0) return null;

          return (
            <div key={section}>
              <p className="px-4 mb-1.5 text-[10px] font-semibold tracking-[0.12em] uppercase text-[#98AEAC]">
                {section}
              </p>
              <ul className="space-y-1">
                {items.map((item) => {
                  const Icon = MODULE_ICONS[item.id];
                  const isActive = activeModule === item.id;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => {
                          onSelectModule(item.id);
                          onCloseMobile();
                        }}
                        className={`w-full min-h-[40px] flex items-center gap-3.5 px-4 py-2 text-xs font-semibold tracking-[0.04em] uppercase transition-colors whitespace-nowrap text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#CF9C2D] ${
                          isActive
                            ? 'sidebar-active-tab text-[#3B4F4E]'
                            : 'text-[#DCE6E5] hover:text-white hover:bg-[#324443] rounded-l-full'
                        }`}
                      >
                        <Icon
                          className={`w-4 h-4 shrink-0 ${
                            isActive ? 'text-[#CF9C2D]' : 'text-[#CF9C2D]'
                          }`}
                        />
                        <span className="truncate">{item.label}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      {/* Bottom Governance & Dotted Supply Route Graphic */}
      <div className="px-6 pt-3 pb-5 border-t border-[#4B6160]/60 bg-[#354847] shrink-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-semibold tracking-[0.1em] uppercase text-[#CF9C2D]">
            SnackFactory ERP
          </span>
          <span className="text-[11px] font-mono tabular-nums text-[#C8D7D6]">
            {allowedModules.length}/16
          </span>
        </div>

        {/* Dotted World/Supply-Network Vector matching reference sidebar footer */}
        <svg
          viewBox="0 0 220 72"
          aria-hidden="true"
          className="w-full h-14 mt-2 opacity-90"
        >
          <g fill="#5C7473">
            {[20, 32, 44, 56, 68, 80, 92, 104, 116, 128, 140, 152, 164, 176, 188, 200].map((x) =>
              [14, 24, 34, 44, 54].map((y) => {
                const mask =
                  (x + y) % 16 !== 0 &&
                  !(x < 35 && y > 40) &&
                  !(x > 185 && y < 20) &&
                  !(x > 85 && x < 110 && y > 45);
                return mask ? <circle key={`${x}-${y}`} cx={x} cy={y} r="1.4" /> : null;
              }),
            )}
          </g>
          <path
            d="M 46 38 Q 85 12 126 30 T 182 42"
            fill="none"
            stroke="#CF9C2D"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <path
            d="M 52 24 Q 100 4 152 26"
            fill="none"
            stroke="#CF9C2D"
            strokeWidth="1.2"
            strokeDasharray="3 3"
          />
          <circle cx="46" cy="38" r="2.8" fill="#CF9C2D" />
          <circle cx="126" cy="30" r="2.8" fill="#CF9C2D" />
          <circle cx="182" cy="42" r="2.8" fill="#CF9C2D" />
        </svg>

        {isPreviewing && (
          <div className="mt-2 pt-2 border-t border-[#4B6160]/60 flex items-center justify-between gap-2">
            <span className="text-[11px] text-[#DCE6E5] truncate">
              Viewing: {activeRole} ({actualRole})
            </span>
            <button
              type="button"
              onClick={onResetPreview}
              className="text-[11px] font-semibold text-[#CF9C2D] hover:underline whitespace-nowrap shrink-0"
            >
              Reset
            </button>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Fixed Sidebar inside Rounded Shell */}
      <aside className="no-print hidden lg:block w-[256px] shrink-0 lg:h-full">
        {sidebarContent}
      </aside>

      {/* Mobile Drawer Overlay */}
      {mobileOpen && (
        <div className="no-print fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-[#1B2827]/60 backdrop-blur-xs"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <aside className="relative w-[264px] max-w-[85vw] h-full z-10 shadow-2xl">
            {sidebarContent}
          </aside>
        </div>
      )}
    </>
  );
}
