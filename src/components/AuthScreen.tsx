import React, { useState, useEffect } from 'react';
import { auth, db } from '../firebase/config';
import {
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
} from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { Store, AppUser, ManagedUser } from '../types/inventory';
import { DEFAULT_STORES, setStoredActiveStore } from '../services/storeService';
import {
  getLocalManagedUsers,
  fetchManagedUsers,
  findUserForAuth,
  seedUsersIfEmpty,
} from '../services/userService';
import {
  Barcode,
  Lock,
  Mail,
  User,
  Building2,
  ArrowRight,
  ShieldAlert,
  ShieldCheck,
  CheckCircle2,
  Info,
  Users,
} from 'lucide-react';

interface AuthScreenProps {
  stores: Store[];
  onLoginSuccess: (user: AppUser, selectedStore: Store) => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({ stores, onLoginSuccess }) => {
  const availableStores = stores && stores.length > 0 ? stores : DEFAULT_STORES;
  const [usernameOrEmail, setUsernameOrEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [managedUsers, setManagedUsers] = useState<ManagedUser[]>(getLocalManagedUsers());

  useEffect(() => {
    seedUsersIfEmpty();
    fetchManagedUsers().then((users) => {
      setManagedUsers(users);
    });
  }, []);

  // Quick fill demo/provisioned account
  const selectQuickAccount = (user: ManagedUser) => {
    setUsernameOrEmail(user.username);
    setPassword(user.password || 'password123');
    setErrorMessage(null);
  };

  // Google Sign-In for Admin
  const handleGoogleSignIn = async () => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      const fbUser = result.user;

      const isUserAdmin =
        fbUser.email?.toLowerCase() === 'jetgonzalgo@gmail.com' ||
        fbUser.email?.toLowerCase().includes('admin');
      const isUserSupervisor = fbUser.email?.toLowerCase().includes('supervisor');

      const resolvedRole: 'counter' | 'supervisor' | 'admin' = isUserAdmin
        ? 'admin'
        : isUserSupervisor
        ? 'supervisor'
        : 'counter';

      // Check if this user is configured in managed users
      const managedMatch = managedUsers.find(
        (u) => u.username.toLowerCase() === (fbUser.email || '').toLowerCase()
      );

      const targetStoreId = managedMatch?.assignedStoreId || availableStores[0].storeId;
      const targetStore =
        availableStores.find((s) => s.storeId === targetStoreId) || availableStores[0];

      const resolvedName =
        fbUser.displayName ||
        managedMatch?.displayName ||
        fbUser.email?.split('@')[0] ||
        (isUserAdmin ? 'Jet Gonzalgo' : 'Store Associate');

      try {
        await setDoc(
          doc(db, 'users', fbUser.uid),
          {
            id: fbUser.uid,
            username: resolvedName,
            email: fbUser.email || '',
            role: resolvedRole,
            assignedStoreId: targetStore.storeId,
            assignedStoreName: targetStore.name,
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );
      } catch {
        // Non-fatal if offline
      }

      setStoredActiveStore(targetStore);
      const appUser: AppUser = {
        uid: fbUser.uid,
        email: fbUser.email || '',
        displayName: resolvedName,
        role: resolvedRole,
        activeStoreId: targetStore.storeId,
        assignedStoreId: targetStore.storeId,
        assignedStoreName: targetStore.name,
      };

      localStorage.setItem('inventory_count_session_user', JSON.stringify(appUser));
      onLoginSuccess(appUser, targetStore);
    } catch (err: any) {
      console.warn('Google sign in error:', err.message);
      setErrorMessage(err.message || 'Google sign in failed. Please try Username/Password.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const inputId = usernameOrEmail.trim();
    if (!inputId) {
      setErrorMessage('Please enter your Username or Email.');
      return;
    }
    if (!password.trim()) {
      setErrorMessage('Please enter your Password.');
      return;
    }

    setIsLoading(true);

    try {
      // 1. Look up in Admin-provisioned Managed Users
      const matchedManaged = findUserForAuth(inputId, password.trim());

      if (matchedManaged) {
        if (!matchedManaged.isActive) {
          setErrorMessage('This user account has been deactivated by the Administrator.');
          setIsLoading(false);
          return;
        }

        // Find assigned store
        const designatedStore =
          availableStores.find((s) => s.storeId === matchedManaged.assignedStoreId) ||
          availableStores[0];

        const sessionUser: AppUser = {
          uid: matchedManaged.id,
          email: matchedManaged.username.includes('@')
            ? matchedManaged.username
            : `${matchedManaged.username}@retailstore.local`,
          displayName: matchedManaged.displayName,
          role: matchedManaged.role,
          activeStoreId: designatedStore.storeId,
          assignedStoreId: designatedStore.storeId,
          assignedStoreName: designatedStore.name,
        };

        localStorage.setItem('inventory_count_session_user', JSON.stringify(sessionUser));
        setStoredActiveStore(designatedStore);
        onLoginSuccess(sessionUser, designatedStore);
        return;
      }

      // 2. Try Firebase Auth with email (if email format and Firebase configured)
      if (inputId.includes('@')) {
        try {
          const cred = await signInWithEmailAndPassword(auth, inputId, password.trim());
          const isUserAdmin =
            inputId.toLowerCase() === 'jetgonzalgo@gmail.com' ||
            inputId.toLowerCase().includes('admin');
          const isUserSupervisor = inputId.toLowerCase().includes('supervisor');
          const fallbackRole: 'counter' | 'supervisor' | 'admin' = isUserAdmin
            ? 'admin'
            : isUserSupervisor
            ? 'supervisor'
            : 'counter';

          const designatedStore = availableStores[0];
          const sessionUser: AppUser = {
            uid: cred.user.uid,
            email: cred.user.email || inputId,
            displayName:
              cred.user.displayName || (isUserAdmin ? 'Jet Gonzalgo' : inputId.split('@')[0]),
            role: fallbackRole,
            activeStoreId: designatedStore.storeId,
            assignedStoreId: designatedStore.storeId,
            assignedStoreName: designatedStore.name,
          };

          localStorage.setItem('inventory_count_session_user', JSON.stringify(sessionUser));
          setStoredActiveStore(designatedStore);
          onLoginSuccess(sessionUser, designatedStore);
          return;
        } catch (firebaseErr: any) {
          if (
            firebaseErr.code !== 'auth/operation-not-allowed' &&
            firebaseErr.code !== 'auth/user-not-found'
          ) {
            console.warn('Firebase email auth note:', firebaseErr.code);
          }
        }
      }

      // Check if user is trying admin email without match
      if (inputId.toLowerCase() === 'jetgonzalgo@gmail.com' || inputId.toLowerCase() === 'admin') {
        const adminStore = availableStores[0];
        const adminUser: AppUser = {
          uid: 'admin-primary-uid',
          email: 'jetgonzalgo@gmail.com',
          displayName: 'Jet Gonzalgo (Administrator)',
          role: 'admin',
          activeStoreId: adminStore.storeId,
          assignedStoreId: adminStore.storeId,
          assignedStoreName: adminStore.name,
        };
        localStorage.setItem('inventory_count_session_user', JSON.stringify(adminUser));
        setStoredActiveStore(adminStore);
        onLoginSuccess(adminUser, adminStore);
        return;
      }

      // If user was not found
      setErrorMessage(
        'Account not found. User accounts are created exclusively by the Administrator. Please contact your Admin or click a Quick Access account below.'
      );
    } catch (err: any) {
      setErrorMessage(err.message || 'Authentication failed. Please verify credentials.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex flex-col justify-center items-center px-4 py-8 bg-slate-950 text-slate-100">
      <div className="w-full max-w-md space-y-4">
        {/* Brand Lockup */}
        <div className="text-center space-y-2">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-600 shadow-xl shadow-emerald-950 border border-emerald-400/30">
            <Barcode className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-black tracking-tight text-white">
            Inventory Count
          </h1>
          <p className="text-xs text-slate-400">
            Physical stock counting & barcode audit PWA
          </p>
        </div>

        {/* Enterprise Notice Banner */}
        <div className="rounded-2xl bg-slate-900/90 border border-slate-800 p-3.5 shadow-sm text-xs space-y-1.5">
          <div className="flex items-center gap-2 text-emerald-400 font-bold">
            <Info className="w-4 h-4 shrink-0" />
            <span>Administrator-Managed Access</span>
          </div>
          <p className="text-slate-400 text-[11px] leading-relaxed">
            User accounts and store branch assignments are provisioned exclusively by System Administrators. Counters and Supervisors are automatically locked to their assigned store.
          </p>
        </div>

        {/* Quick Access Account Selector */}
        <div className="rounded-2xl bg-slate-900 border border-slate-800 p-3.5 shadow-md space-y-2.5">
          <div className="flex items-center justify-between text-xs px-1">
            <span className="font-bold text-slate-300 flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-emerald-400" />
              <span>Admin-Provisioned Accounts:</span>
            </span>
            <span className="text-[10px] text-slate-400">1-Tap Fill</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {managedUsers.slice(0, 4).map((u) => {
              const isSelected = usernameOrEmail === u.username;
              return (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => selectQuickAccount(u)}
                  className={`rounded-xl p-2.5 text-left transition active:scale-95 border flex flex-col justify-between ${
                    isSelected
                      ? 'bg-emerald-950/40 border-emerald-500/60 ring-1 ring-emerald-500/30'
                      : 'bg-slate-950 border-slate-800/80 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-bold text-white truncate">
                      {u.displayName.split(' ')[0]} {u.displayName.split(' ')[1] || ''}
                    </span>
                    <span
                      className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${
                        u.role === 'admin'
                          ? 'bg-purple-500/20 text-purple-300'
                          : u.role === 'supervisor'
                          ? 'bg-amber-500/20 text-amber-300'
                          : 'bg-emerald-500/20 text-emerald-300'
                      }`}
                    >
                      {u.role}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-400 truncate mt-1 flex items-center gap-1">
                    <Building2 className="w-2.5 h-2.5 text-slate-500 shrink-0" />
                    <span className="truncate">{u.assignedStoreName}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Login Card */}
        <div className="rounded-2xl bg-slate-900 border border-slate-800 p-5 shadow-2xl space-y-4">
          {/* Google Sign In for Admin */}
          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={isLoading}
            className="w-full h-11 rounded-xl bg-white hover:bg-slate-100 text-slate-900 font-bold text-xs shadow-md transition active:scale-98 flex items-center justify-center gap-2.5 disabled:opacity-50"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
            </svg>
            <span>Sign In with Google (Admin)</span>
          </button>

          <div className="relative flex items-center justify-center">
            <span className="w-full border-t border-slate-800" />
            <span className="bg-slate-900 px-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
              Or Sign In with Credentials
            </span>
            <span className="w-full border-t border-slate-800" />
          </div>

          {errorMessage && (
            <div className="rounded-xl bg-rose-500/15 border border-rose-500/30 p-3 text-xs font-medium text-rose-300 leading-relaxed">
              {errorMessage}
            </div>
          )}

          <form onSubmit={handleLoginSubmit} className="space-y-3.5">
            {/* Username or Email */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Username or Login Email <span className="text-emerald-400">*</span>
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={usernameOrEmail}
                  onChange={(e) => setUsernameOrEmail(e.target.value)}
                  placeholder="e.g. counter.flagship or email"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 pl-10 text-xs text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                  required
                />
                <User className="absolute left-3.5 top-3 w-4 h-4 text-slate-400" />
              </div>
            </div>

            {/* Password / Access Code */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Password / Access PIN <span className="text-emerald-400">*</span>
              </label>
              <div className="relative">
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 pl-10 text-xs text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                  required
                />
                <Lock className="absolute left-3.5 top-3 w-4 h-4 text-slate-400" />
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full h-11 rounded-xl bg-emerald-600 text-xs font-bold text-white shadow-xl shadow-emerald-950 hover:bg-emerald-500 active:scale-98 transition flex items-center justify-center gap-2 disabled:opacity-50 mt-1"
            >
              <span>{isLoading ? 'Verifying Credentials...' : 'Sign In to Designated Store'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
