// ============================================================================
// Authentication Context
// ============================================================================
// Provides Firebase Auth state to the entire app.
// Handles sign up, sign in, sign out, and auth state persistence.
// ============================================================================

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
  type User,
} from 'firebase/auth';
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../config/firebase';

// ============================================================================
// Types
// ============================================================================

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  createdAt: Date;
  ibkrAccountId?: string;
  ibkrGatewayUrl?: string;
}

interface AuthContextType {
  user: User | null;
  userProfile: UserProfile | null;
  loading: boolean;
  signUp: (email: string, password: string, displayName: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  logOut: () => Promise<void>;
  updateUserProfile: (updates: Partial<UserProfile>) => Promise<void>;
  isConfigured: boolean; // Whether Firebase is configured
}

// ============================================================================
// Context
// ============================================================================

const AuthContext = createContext<AuthContextType | null>(null);

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

// ============================================================================
// Provider
// ============================================================================

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // Check if Firebase is configured (has API key)
  const isConfigured = Boolean(import.meta.env.VITE_FIREBASE_API_KEY);

  // Listen for auth state changes
  useEffect(() => {
    if (!isConfigured) {
      setLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);

      if (firebaseUser) {
        // Load user profile from Firestore
        try {
          const profileDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
          if (profileDoc.exists()) {
            const data = profileDoc.data();
            setUserProfile({
              uid: firebaseUser.uid,
              email: firebaseUser.email || '',
              displayName: data.displayName || firebaseUser.displayName || '',
              createdAt: data.createdAt?.toDate?.() || new Date(),
              ibkrAccountId: data.ibkrAccountId,
              ibkrGatewayUrl: data.ibkrGatewayUrl,
            });
          } else {
            // Profile doesn't exist yet, create basic one
            setUserProfile({
              uid: firebaseUser.uid,
              email: firebaseUser.email || '',
              displayName: firebaseUser.displayName || '',
              createdAt: new Date(),
            });
          }
        } catch (err) {
          console.error('Failed to load user profile:', err);
          setUserProfile({
            uid: firebaseUser.uid,
            email: firebaseUser.email || '',
            displayName: firebaseUser.displayName || '',
            createdAt: new Date(),
          });
        }
      } else {
        setUserProfile(null);
      }

      setLoading(false);
    });

    return unsubscribe;
  }, [isConfigured]);

  // Sign up with email and password
  const signUp = async (email: string, password: string, displayName: string) => {
    const credential = await createUserWithEmailAndPassword(auth, email, password);

    // Set display name
    await updateProfile(credential.user, { displayName });

    // Create user profile in Firestore
    await setDoc(doc(db, 'users', credential.user.uid), {
      email,
      displayName,
      createdAt: serverTimestamp(),
      ibkrAccountId: null,
      ibkrGatewayUrl: null,
    });

    setUserProfile({
      uid: credential.user.uid,
      email,
      displayName,
      createdAt: new Date(),
    });
  };

  // Sign in with email and password
  const signIn = async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
  };

  // Sign out
  const logOut = async () => {
    await signOut(auth);
    setUser(null);
    setUserProfile(null);
  };

  // Update user profile in Firestore
  const updateUserProfile = async (updates: Partial<UserProfile>) => {
    if (!user) return;

    await setDoc(doc(db, 'users', user.uid), updates, { merge: true });

    setUserProfile((prev) => prev ? { ...prev, ...updates } : null);
  };

  const value: AuthContextType = {
    user,
    userProfile,
    loading,
    signUp,
    signIn,
    logOut,
    updateUserProfile,
    isConfigured,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
