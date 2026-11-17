import { deleteApp, initializeApp } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  deleteUser,
  getAuth,
  signOut,
} from 'firebase/auth';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

export const INTERNAL_AUTH_DOMAIN = 'users.snackfactory.internal';

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export function usernameToAuthEmail(username: string): string {
  return `${normalizeUsername(username)}@${INTERNAL_AUTH_DOMAIN}`;
}

export async function provisionSecondaryAuthAccount(
  username: string,
  password: string,
  onPersistProfile: (uid: string, authEmail: string) => Promise<void>,
): Promise<string> {
  const secondaryName = `SnackFactoryProvision_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const secondaryApp = initializeApp(firebaseConfig, secondaryName);
  const secondaryAuth = getAuth(secondaryApp);
  const authEmail = usernameToAuthEmail(username);

  try {
    const credential = await createUserWithEmailAndPassword(secondaryAuth, authEmail, password);
    try {
      await onPersistProfile(credential.user.uid, authEmail);
    } catch (persistError) {
      try {
        await deleteUser(credential.user);
      } catch {
        // Ignore cleanup failure if user deletion fails
      }
      throw persistError;
    }
    return credential.user.uid;
  } finally {
    try {
      await signOut(secondaryAuth);
    } catch {
      // Ignore signOut error during cleanup
    }
    try {
      await deleteApp(secondaryApp);
    } catch {
      // Ignore deleteApp error during cleanup
    }
  }
}

async function testConnection(): Promise<void> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Firestore connection failed: client is offline. Verify Firebase configuration.');
    }
  }
}

void testConnection();
