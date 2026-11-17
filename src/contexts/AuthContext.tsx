import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  createUserWithEmailAndPassword,
  deleteUser,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { ROLE_DESCRIPTIONS } from '../config/navigation';
import { auth, db, usernameToAuthEmail } from '../lib/firebase';
import { handleFirestoreError, OperationType } from '../lib/firestoreError';
import {
  BLUEPRINT_CONSTRAINTS,
  isValidDocumentId,
  sanitizeString,
  validateUsernameAndPassword,
} from '../lib/validation';
import type { ErpRole, ErpUser } from '../types/erp';

interface AuthContextValue {
  authReady: boolean;
  firebaseUser: User | null;
  userProfile: ErpUser | null;
  loadingProfile: boolean;
  authError: string | null;
  signingIn: boolean;
  previewRole: ErpRole | null;
  effectiveRole: ErpRole | null;
  setPreviewRole: (role: ErpRole | null) => void;
  signInWithUsername: (username: string, password: string) => Promise<boolean>;
  initializeOwnerAccount: (input: {
    username: string;
    displayName: string;
    password: string;
  }) => Promise<boolean>;
  retryProfileSync: () => Promise<void>;
  logout: () => Promise<void>;
  clearAuthError: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function mapFirebaseAuthError(error: unknown, mode: 'login' | 'bootstrap'): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code)
      : '';
  const message = error instanceof Error ? error.message : String(error);

  if (
    code === 'auth/invalid-credential' ||
    code === 'auth/wrong-password' ||
    code === 'auth/user-not-found' ||
    code === 'auth/invalid-login-credentials' ||
    code === 'auth/invalid-email'
  ) {
    return 'Incorrect username or password.';
  }
  if (code === 'auth/user-disabled') {
    return 'This operator account has been disabled.';
  }
  if (code === 'auth/too-many-requests') {
    return 'Too many failed login attempts. Please wait a few minutes and try again.';
  }
  if (code === 'auth/operation-not-allowed') {
    return 'Email/Password sign-in is not enabled in Firebase Authentication. Enable Email/Password in Firebase Console (Authentication -> Sign-in method) and try again.';
  }
  if (code === 'auth/email-already-in-use') {
    return mode === 'bootstrap'
      ? 'This username is already registered. Sign in with your username and password.'
      : 'This username is already in use.';
  }
  if (code === 'auth/weak-password') {
    return 'Password must be at least 6 characters.';
  }
  if (code === 'auth/network-request-failed') {
    return 'Network error while connecting to Firebase Authentication. Check your connection and retry.';
  }
  if (message.toLowerCase().includes('permission')) {
    return 'An Owner account has already been initialized. Please sign in with your username and password.';
  }
  return mode === 'bootstrap'
    ? 'Unable to initialize Owner account. Please verify your details and try again.'
    : 'Unable to sign in. Please verify your username and password.';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authReady, setAuthReady] = useState(false);
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<ErpUser | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [previewRole, setPreviewRoleState] = useState<ErpRole | null>(null);

  const bootstrappingRef = useRef(false);

  const attachProfileListener = useCallback((user: User) => {
    const userDocPath = `users/${user.uid}`;
    const userRef = doc(db, 'users', user.uid);

    return onSnapshot(
      userRef,
      (docSnap) => {
        if (docSnap.exists()) {
          setUserProfile(docSnap.data() as ErpUser);
        } else {
          setUserProfile(null);
        }
        setLoadingProfile(false);
        setAuthReady(true);
      },
      (error) => {
        setLoadingProfile(false);
        setAuthReady(true);
        handleFirestoreError(error, OperationType.GET, userDocPath);
      },
    );
  }, []);

  const touchLastLogin = useCallback(async (user: User) => {
    if (!isValidDocumentId(user.uid)) return;

    const userDocPath = `users/${user.uid}`;
    const userRef = doc(db, 'users', user.uid);

    let snapshot;
    try {
      snapshot = await getDoc(userRef);
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, userDocPath);
    }

    if (snapshot.exists()) {
      try {
        await updateDoc(userRef, {
          updatedAt: serverTimestamp(),
          lastLoginAt: serverTimestamp(),
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, userDocPath);
      }
    }
  }, []);

  useEffect(() => {
    let unsubscribeProfile: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      if (unsubscribeProfile) {
        unsubscribeProfile();
        unsubscribeProfile = null;
      }

      setFirebaseUser(user);
      setPreviewRoleState(null);

      if (!user) {
        setUserProfile(null);
        setLoadingProfile(false);
        setAuthReady(true);
        return;
      }

      if (bootstrappingRef.current) {
        return;
      }

      setLoadingProfile(true);
      setAuthError(null);

      try {
        await touchLastLogin(user);
        unsubscribeProfile = attachProfileListener(user);
      } catch (error) {
        setAuthError(
          error instanceof Error
            ? error.message
            : 'Unable to verify your ERP user profile. Please try again.',
        );
        setLoadingProfile(false);
        setAuthReady(true);
      }
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeProfile) {
        unsubscribeProfile();
      }
    };
  }, [touchLastLogin, attachProfileListener]);

  const signInWithUsername = useCallback(async (username: string, password: string) => {
    const check = validateUsernameAndPassword(username, password);
    if (!check.valid) {
      setAuthError(check.error);
      return false;
    }

    setSigningIn(true);
    setAuthError(null);

    try {
      const authEmail = usernameToAuthEmail(check.username);
      await signInWithEmailAndPassword(auth, authEmail, password);
      return true;
    } catch (error) {
      setAuthError(mapFirebaseAuthError(error, 'login'));
      return false;
    } finally {
      setSigningIn(false);
    }
  }, []);

  const initializeOwnerAccount = useCallback(
    async (input: { username: string; displayName: string; password: string }) => {
      const credCheck = validateUsernameAndPassword(input.username, input.password);
      if (!credCheck.valid) {
        setAuthError(credCheck.error);
        return false;
      }

      const displayName = sanitizeString(
        input.displayName,
        BLUEPRINT_CONSTRAINTS.displayName.maxLength,
      );
      if (!displayName) {
        setAuthError('Full name is required for the Owner account.');
        return false;
      }

      setSigningIn(true);
      setAuthError(null);
      bootstrappingRef.current = true;

      const authEmail = usernameToAuthEmail(credCheck.username);

      try {
        const credential = await createUserWithEmailAndPassword(auth, authEmail, input.password);
        const uid = credential.user.uid;

        try {
          const batch = writeBatch(db);
          batch.set(doc(db, 'users', uid), {
            uid,
            username: credCheck.username,
            displayName,
            email: authEmail,
            role: 'Owner',
            department: ROLE_DESCRIPTIONS.Owner.defaultDepartment,
            status: 'Active',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            lastLoginAt: serverTimestamp(),
          });
          batch.set(doc(db, 'system', 'bootstrap'), {
            initialized: true,
            ownerUid: uid,
            createdAt: serverTimestamp(),
          });
          await batch.commit();

          bootstrappingRef.current = false;
          setFirebaseUser(credential.user);
          setLoadingProfile(true);
          const snap = await getDoc(doc(db, 'users', uid));
          if (snap.exists()) {
            setUserProfile(snap.data() as ErpUser);
          }
          setLoadingProfile(false);
          setAuthReady(true);
          return true;
        } catch (firestoreError) {
          try {
            await deleteUser(credential.user);
          } catch {
            await signOut(auth);
          }
          setAuthError(mapFirebaseAuthError(firestoreError, 'bootstrap'));
          return false;
        }
      } catch (authErr) {
        setAuthError(mapFirebaseAuthError(authErr, 'bootstrap'));
        return false;
      } finally {
        bootstrappingRef.current = false;
        setSigningIn(false);
      }
    },
    [],
  );

  const retryProfileSync = useCallback(async () => {
    if (!auth.currentUser) return;
    setLoadingProfile(true);
    setAuthError(null);
    try {
      await touchLastLogin(auth.currentUser);
      const snap = await getDoc(doc(db, 'users', auth.currentUser.uid));
      if (snap.exists()) {
        setUserProfile(snap.data() as ErpUser);
      }
    } catch (error) {
      setAuthError(
        error instanceof Error ? error.message : 'Unable to synchronize user profile.',
      );
    } finally {
      setLoadingProfile(false);
    }
  }, [touchLastLogin]);

  const logout = useCallback(async () => {
    setAuthError(null);
    setPreviewRoleState(null);
    await signOut(auth);
  }, []);

  const setPreviewRole = useCallback(
    (role: ErpRole | null) => {
      if (userProfile?.role === 'Owner') {
        setPreviewRoleState(role === 'Owner' ? null : role);
      }
    },
    [userProfile?.role],
  );

  const clearAuthError = useCallback(() => setAuthError(null), []);

  const effectiveRole = useMemo<ErpRole | null>(() => {
    if (!userProfile) return null;
    if (userProfile.role === 'Owner' && previewRole) {
      return previewRole;
    }
    return userProfile.role;
  }, [userProfile, previewRole]);

  const value = useMemo<AuthContextValue>(
    () => ({
      authReady,
      firebaseUser,
      userProfile,
      loadingProfile,
      authError,
      signingIn,
      previewRole,
      effectiveRole,
      setPreviewRole,
      signInWithUsername,
      initializeOwnerAccount,
      retryProfileSync,
      logout,
      clearAuthError,
    }),
    [
      authReady,
      firebaseUser,
      userProfile,
      loadingProfile,
      authError,
      signingIn,
      previewRole,
      effectiveRole,
      setPreviewRole,
      signInWithUsername,
      initializeOwnerAccount,
      retryProfileSync,
      logout,
      clearAuthError,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider.');
  }
  return ctx;
}
