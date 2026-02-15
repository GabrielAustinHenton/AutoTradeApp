// ============================================================================
// Firestore Sync Service
// ============================================================================
// Syncs user data between localStorage (fast) and Firestore (persistent/cross-device).
//
// Strategy:
//  - localStorage is the primary store (Zustand persist) for fast reads/writes
//  - localStorage keys are namespaced by user UID for multi-user isolation
//  - Firestore acts as backup/cross-device sync
//  - On login: load from Firestore if localStorage is empty for that user
//  - On significant changes: debounced sync to Firestore
//  - On logout: user data stays in localStorage (fast re-login)
// ============================================================================

import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../config/firebase';

// Storage key prefixes
const MAIN_STORE_PREFIX = 'tradeapp-storage';
const SWING_STORE_PREFIX = 'swing-trader-storage';

/** Get user-namespaced localStorage key */
export function getUserStorageKey(prefix: string, uid: string): string {
  return `${prefix}-${uid}`;
}

/** Rename localStorage keys to user-namespaced versions on first login */
export function migrateLocalStorageToUser(uid: string): void {
  // If non-namespaced data exists and user-namespaced data doesn't, migrate
  const mainData = localStorage.getItem(MAIN_STORE_PREFIX);
  const userMainKey = getUserStorageKey(MAIN_STORE_PREFIX, uid);
  if (mainData && !localStorage.getItem(userMainKey)) {
    localStorage.setItem(userMainKey, mainData);
    console.log('[FirestoreSync] Migrated main store data to user namespace');
  }

  const swingData = localStorage.getItem(SWING_STORE_PREFIX);
  const userSwingKey = getUserStorageKey(SWING_STORE_PREFIX, uid);
  if (swingData && !localStorage.getItem(userSwingKey)) {
    localStorage.setItem(userSwingKey, swingData);
    console.log('[FirestoreSync] Migrated swing store data to user namespace');
  }
}

/** Save store data to Firestore for cross-device sync */
export async function saveToFirestore(uid: string): Promise<void> {
  const mainKey = getUserStorageKey(MAIN_STORE_PREFIX, uid);
  const swingKey = getUserStorageKey(SWING_STORE_PREFIX, uid);

  const mainData = localStorage.getItem(mainKey);
  const swingData = localStorage.getItem(swingKey);

  try {
    await setDoc(doc(db, 'userData', uid), {
      mainStore: mainData || null,
      swingStore: swingData || null,
      lastSynced: new Date().toISOString(),
    }, { merge: true });
    console.log('[FirestoreSync] Saved to Firestore');
  } catch (err) {
    console.error('[FirestoreSync] Failed to save to Firestore:', err);
  }
}

/** Load store data from Firestore (used on login if localStorage is empty) */
export async function loadFromFirestore(uid: string): Promise<boolean> {
  const mainKey = getUserStorageKey(MAIN_STORE_PREFIX, uid);
  const swingKey = getUserStorageKey(SWING_STORE_PREFIX, uid);

  // Only load from Firestore if localStorage is empty for this user
  const hasLocalData = localStorage.getItem(mainKey);
  if (hasLocalData) {
    console.log('[FirestoreSync] Local data exists, skipping Firestore load');
    return false;
  }

  try {
    const docSnap = await getDoc(doc(db, 'userData', uid));
    if (docSnap.exists()) {
      const data = docSnap.data();
      if (data.mainStore) {
        localStorage.setItem(mainKey, data.mainStore);
      }
      if (data.swingStore) {
        localStorage.setItem(swingKey, data.swingStore);
      }
      console.log('[FirestoreSync] Loaded from Firestore');
      return true;
    }
  } catch (err) {
    console.error('[FirestoreSync] Failed to load from Firestore:', err);
  }

  return false;
}

// ============================================================================
// Debounced Auto-Sync
// ============================================================================

let syncTimeout: ReturnType<typeof setTimeout> | null = null;

/** Schedule a debounced sync to Firestore (5 second delay) */
export function scheduleSyncToFirestore(uid: string): void {
  if (syncTimeout) {
    clearTimeout(syncTimeout);
  }
  syncTimeout = setTimeout(() => {
    saveToFirestore(uid);
    syncTimeout = null;
  }, 5000);
}

/** Cancel any pending sync */
export function cancelPendingSync(): void {
  if (syncTimeout) {
    clearTimeout(syncTimeout);
    syncTimeout = null;
  }
}

// ============================================================================
// Store Rehydration Helper
// ============================================================================

/**
 * Configure Zustand persist to use user-namespaced localStorage.
 * Call this after login to point stores at the correct storage key.
 */
export function getStoreStorageName(prefix: string, uid: string | null): string {
  if (uid) {
    return getUserStorageKey(prefix, uid);
  }
  return prefix; // Fallback to default (pre-auth or no-auth mode)
}
