import { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  Factory,
  Lock,
  ShieldCheck,
  User,
} from 'lucide-react';
import { ROLE_DESCRIPTIONS } from '../config/navigation';
import { useAuth } from '../contexts/AuthContext';
import { ERP_ROLES } from '../types/erp';

const LOGIN_FACILITY_IMAGE = '/src/assets/images/login_facility_panel_1794900119286.jpg';
const REMEMBERED_USERNAME_KEY = 'snackfactory_remembered_username';

export function LoginPage() {
  const { signInWithUsername, initializeOwnerAccount, signingIn, authError, clearAuthError } =
    useAuth();

  const [imageFailed, setImageFailed] = useState(false);
  const [setupMode, setSetupMode] = useState(false);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberUsername, setRememberUsername] = useState(false);

  useEffect(() => {
    try {
      const savedUsername = localStorage.getItem(REMEMBERED_USERNAME_KEY);
      if (savedUsername) {
        setUsername(savedUsername);
        setRememberUsername(true);
      }
    } catch {
      // Ignore storage read error in restricted contexts
    }
  }, []);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (rememberUsername && username.trim()) {
        localStorage.setItem(REMEMBERED_USERNAME_KEY, username.trim().toLowerCase());
      } else {
        localStorage.removeItem(REMEMBERED_USERNAME_KEY);
      }
    } catch {
      // Ignore storage write error
    }

    await signInWithUsername(username, password);
  };

  const handleSetupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await initializeOwnerAccount({
      username,
      displayName,
      password,
    });
    if (ok && rememberUsername && username.trim()) {
      try {
        localStorage.setItem(REMEMBERED_USERNAME_KEY, username.trim().toLowerCase());
      } catch {
        // Ignore storage write error
      }
    }
  };

  const switchMode = (nextSetupMode: boolean) => {
    clearAuthError();
    setPassword('');
    setShowPassword(false);
    setSetupMode(nextSetupMode);
  };

  return (
    <div className="min-h-screen bg-[#D5E1E2] relative overflow-hidden flex items-center justify-center p-0 sm:p-6 lg:p-10">
      {/* Ambient Golden & Soft Sage Backdrop Accents matching Reference */}
      <div
        aria-hidden="true"
        className="hidden lg:block fixed -top-24 -left-24 w-72 h-72 rounded-full bg-[#CF9C2D] opacity-90 pointer-events-none"
      />
      <div
        aria-hidden="true"
        className="hidden lg:block fixed -bottom-32 -right-24 w-[420px] h-[420px] rounded-full bg-[#C7D8DA] opacity-70 pointer-events-none"
      />

      <div className="relative z-10 w-full max-w-[1280px] min-h-screen sm:min-h-[680px] bg-[#EEF3F3] sm:rounded-[28px] sm:shadow-[0_24px_60px_-18px_rgba(32,48,47,0.22)] grid grid-cols-1 lg:grid-cols-12 overflow-hidden">
        {/* Left Eucalyptus Teal Brand & Manufacturing Context Panel */}
        <section className="lg:col-span-7 bg-[#3B4F4E] text-white relative overflow-hidden flex flex-col justify-between p-8 sm:p-12 lg:p-14">
          {!imageFailed && (
            <img
              src={LOGIN_FACILITY_IMAGE}
              alt="Modern stainless steel snack manufacturing and packaging facility"
              referrerPolicy="no-referrer"
              onError={() => setImageFailed(true)}
              className="absolute inset-0 w-full h-full object-cover opacity-15 mix-blend-luminosity"
            />
          )}
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-br from-[#3B4F4E]/95 via-[#3B4F4E]/90 to-[#2C3C3B]/95"
          />

          {/* Brand Mark */}
          <div className="relative z-10 flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-full bg-[#2C3C3B] border-2 border-[#CF9C2D] flex items-center justify-center shrink-0">
              <Factory className="w-5 h-5 text-[#CF9C2D]" />
            </div>
            <div>
              <p className="text-base font-bold tracking-[0.06em] uppercase text-white">
                SnackFactory
              </p>
              <p className="text-xs text-[#AFC2C0]">Order-to-Audit Management System</p>
            </div>
          </div>

          {/* Hero Headline & Role Architecture */}
          <div className="relative z-10 my-10 lg:my-0 max-w-xl">
            <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-white leading-tight [text-wrap:balance]">
              Manufacturing control from raw material intake to financial audit.
            </h1>
            <p className="mt-4 text-sm sm:text-base text-[#D4E1E0] leading-relaxed">
              Unified workspace for snack production scheduling, Bill of Materials costing,
              dispatch verification, and role-governed audit accountability.
            </p>

            <div className="mt-8 pt-6 border-t border-[#526968]/70">
              <p className="text-[11px] font-semibold tracking-[0.12em] uppercase text-[#CF9C2D] mb-4">
                Five-Role Access Governance
              </p>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3.5">
                {ERP_ROLES.map((role) => (
                  <div key={role} className="border-b border-[#526968]/60 pb-2.5">
                    <dt className="text-xs font-semibold uppercase tracking-wide text-white">
                      {role}
                    </dt>
                    <dd className="mt-0.5 text-xs text-[#AFC2C0] leading-relaxed">
                      {ROLE_DESCRIPTIONS[role].defaultDepartment}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>

          {/* Quiet Footer + Dotted Route Vector */}
          <div className="relative z-10 flex flex-wrap items-center justify-between gap-4 text-xs text-[#AFC2C0]">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="inline-flex items-center gap-1.5 text-[#CF9C2D] font-medium">
                <ShieldCheck className="w-4 h-4 shrink-0" />
                Firebase Auth Credentials
              </span>
              <span aria-hidden="true">·</span>
              <span>Cloud Firestore Persistence</span>
            </div>

            <svg viewBox="0 0 120 32" aria-hidden="true" className="w-28 h-8 opacity-85">
              <path
                d="M 8 24 Q 42 4 76 18 T 112 10"
                fill="none"
                stroke="#CF9C2D"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
              <circle cx="8" cy="24" r="3" fill="#CF9C2D" />
              <circle cx="76" cy="18" r="2.5" fill="#CF9C2D" />
              <circle cx="112" cy="10" r="3" fill="#CF9C2D" />
            </svg>
          </div>
        </section>

        {/* Right Username & Password Sign-In Panel */}
        <section className="lg:col-span-5 flex items-center justify-center p-6 sm:p-10 lg:p-12 bg-[#EEF3F3]">
          <div className="w-full max-w-md bg-white rounded-[24px] p-6 sm:p-8 shadow-sm border border-[#DCE6E6]">
            <div className="mb-6">
              <h2 className="text-2xl font-semibold tracking-tight text-[#3B4F4E]">
                {setupMode ? 'Initialize Owner Account' : 'Sign in to SnackFactory'}
              </h2>
              <p className="mt-1.5 text-xs sm:text-sm text-[#6C7E7D] leading-relaxed">
                {setupMode
                  ? 'One-time setup to create the primary Owner username and password for your workspace.'
                  : 'Enter your assigned SnackFactory username and password to access your ERP workspace.'}
              </p>
            </div>

            {authError && (
              <div
                role="alert"
                className="mb-5 rounded-2xl border border-red-200 bg-red-50 p-4 flex items-start gap-3"
              >
                <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                <div className="flex-1 text-sm text-red-800">
                  <p className="font-semibold">
                    {setupMode ? 'Setup Error' : 'Authentication Failed'}
                  </p>
                  <p className="mt-1 text-red-700 text-xs leading-relaxed">{authError}</p>
                </div>
                <button
                  type="button"
                  onClick={clearAuthError}
                  className="text-xs font-semibold text-red-700 hover:text-red-900 whitespace-nowrap"
                >
                  Dismiss
                </button>
              </div>
            )}

            {!setupMode ? (
              <form onSubmit={(e) => void handleLoginSubmit(e)} className="space-y-4">
                <div>
                  <label
                    htmlFor="login-username"
                    className="block text-[11px] font-semibold uppercase tracking-wider text-[#6C7E7D] mb-1.5"
                  >
                    Username
                  </label>
                  <div className="relative">
                    <User className="w-4 h-4 text-[#6C7E7D] absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      id="login-username"
                      type="text"
                      required
                      autoComplete="username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="Enter your username"
                      className="w-full h-11 pl-11 pr-4 text-sm text-[#3B4F4E] bg-[#E5EDED] border border-transparent rounded-full placeholder:text-[#7D908F] focus:outline-none focus:bg-white focus:border-[#3B4F4E]"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="login-password"
                    className="block text-[11px] font-semibold uppercase tracking-wider text-[#6C7E7D] mb-1.5"
                  >
                    Password
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-[#6C7E7D] absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      id="login-password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter your password"
                      className="w-full h-11 pl-11 pr-11 text-sm text-[#3B4F4E] bg-[#E5EDED] border border-transparent rounded-full placeholder:text-[#7D908F] focus:outline-none focus:bg-white focus:border-[#3B4F4E]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-[#6C7E7D] hover:text-[#3B4F4E] rounded-full"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 pt-1">
                  <label className="inline-flex items-center gap-2 text-xs text-[#6C7E7D] cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={rememberUsername}
                      onChange={(e) => setRememberUsername(e.target.checked)}
                      className="w-4 h-4 rounded border-[#AFC2C0] text-[#3B4F4E] focus:ring-[#CF9C2D]"
                    />
                    <span>Remember username</span>
                  </label>
                </div>

                <button
                  type="submit"
                  disabled={signingIn}
                  className="w-full min-h-[44px] flex items-center justify-center px-6 py-2.5 bg-[#CF9C2D] hover:bg-[#BC8B22] disabled:opacity-60 text-white text-xs font-semibold tracking-[0.08em] uppercase rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3B4F4E] whitespace-nowrap"
                >
                  {signingIn ? 'Signing in...' : 'Sign In'}
                </button>

                <div className="pt-4 border-t border-dashed border-[#DCE6E6] text-xs text-[#6C7E7D]">
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-[#CF9C2D] shrink-0 mt-0.5" />
                    <span>
                      Passwords are verified directly by Firebase Authentication and never stored in
                      plain text.
                    </span>
                  </div>
                </div>
              </form>
            ) : (
              <form onSubmit={(e) => void handleSetupSubmit(e)} className="space-y-4">
                <div>
                  <label
                    htmlFor="setup-display-name"
                    className="block text-[11px] font-semibold uppercase tracking-wider text-[#6C7E7D] mb-1.5"
                  >
                    Owner Full Name
                  </label>
                  <input
                    id="setup-display-name"
                    type="text"
                    required
                    maxLength={100}
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Enter full name"
                    className="w-full h-11 px-4 text-sm text-[#3B4F4E] bg-[#E5EDED] border border-transparent rounded-full placeholder:text-[#7D908F] focus:outline-none focus:bg-white focus:border-[#3B4F4E]"
                  />
                </div>

                <div>
                  <label
                    htmlFor="setup-username"
                    className="block text-[11px] font-semibold uppercase tracking-wider text-[#6C7E7D] mb-1.5"
                  >
                    Owner Username
                  </label>
                  <input
                    id="setup-username"
                    type="text"
                    required
                    maxLength={30}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="e.g. owner or admin.sf"
                    className="w-full h-11 px-4 text-sm text-[#3B4F4E] bg-[#E5EDED] border border-transparent rounded-full placeholder:text-[#7D908F] focus:outline-none focus:bg-white focus:border-[#3B4F4E]"
                  />
                  <p className="mt-1 px-2 text-[11px] text-[#6C7E7D]">
                    3–30 chars: lowercase letters, numbers, dots, underscores, or hyphens.
                  </p>
                </div>

                <div>
                  <label
                    htmlFor="setup-password"
                    className="block text-[11px] font-semibold uppercase tracking-wider text-[#6C7E7D] mb-1.5"
                  >
                    Password
                  </label>
                  <div className="relative">
                    <input
                      id="setup-password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      minLength={6}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Minimum 6 characters"
                      className="w-full h-11 pl-4 pr-11 text-sm text-[#3B4F4E] bg-[#E5EDED] border border-transparent rounded-full placeholder:text-[#7D908F] focus:outline-none focus:bg-white focus:border-[#3B4F4E]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-[#6C7E7D] hover:text-[#3B4F4E] rounded-full"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={signingIn}
                  className="w-full min-h-[44px] flex items-center justify-center px-6 py-2.5 bg-[#CF9C2D] hover:bg-[#BC8B22] disabled:opacity-60 text-white text-xs font-semibold tracking-[0.08em] uppercase rounded-full transition-colors whitespace-nowrap"
                >
                  {signingIn ? 'Creating Owner Account...' : 'Create Owner Account'}
                </button>
              </form>
            )}

            <div className="mt-5 pt-4 border-t border-dashed border-[#DCE6E6] flex items-center justify-between gap-4 text-xs text-[#6C7E7D]">
              {!setupMode ? (
                <>
                  <span>Need employee access? Contact Owner/Admin.</span>
                  <button
                    type="button"
                    onClick={() => switchMode(true)}
                    className="font-semibold text-[#3B4F4E] hover:text-[#CF9C2D] whitespace-nowrap"
                  >
                    First-time setup
                  </button>
                </>
              ) : (
                <>
                  <span>Already have an account?</span>
                  <button
                    type="button"
                    onClick={() => switchMode(false)}
                    className="font-semibold text-[#3B4F4E] hover:text-[#CF9C2D] whitespace-nowrap"
                  >
                    Back to Sign In
                  </button>
                </>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
