import React, { useState, useEffect } from 'react';
import { auth } from '../firebase/config';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { Store, AppUser, ManagedUser, UserRole } from '../types/inventory';
import { DEFAULT_STORES, setStoredActiveStore } from '../services/storeService';
import {
  getLocalManagedUsers,
  subscribeToManagedUsers,
  findUserForAuth,
  seedUsersIfEmpty,
} from '../services/userService';
import {
  Barcode,
  Lock,
  User,
  ArrowRight,
  Eye,
  EyeOff,
} from 'lucide-react';

interface AuthScreenProps {
  stores: Store[];
  onLoginSuccess: (user: AppUser, selectedStore: Store) => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({ stores, onLoginSuccess }) => {
  const availableStores = stores && stores.length > 0 ? stores : DEFAULT_STORES;
  const [usernameOrEmail, setUsernameOrEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [managedUsers, setManagedUsers] = useState<ManagedUser[]>(getLocalManagedUsers());

  useEffect(() => {
    seedUsersIfEmpty();
    const unsub = subscribeToManagedUsers((users) => {
      setManagedUsers(users);
    });
    return () => unsub();
  }, []);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const inputId = usernameOrEmail.trim();
    const inputPass = password.trim();

    if (!inputId) {
      setErrorMessage('Please enter your Username or Email.');
      return;
    }
    if (!inputPass) {
      setErrorMessage('Please enter your Password.');
      return;
    }

    setIsLoading(true);

    try {
      // 1. Verify against Admin-provisioned Managed Users (cloud-synced) with strict password check
      const matchedManaged = findUserForAuth(inputId, inputPass, managedUsers);

      if (matchedManaged) {
        if (!matchedManaged.isActive) {
          setErrorMessage('This user account has been deactivated by the Administrator.');
          setIsLoading(false);
          return;
        }

        const designatedStore =
          matchedManaged.assignedStoreId === 'ALL'
            ? availableStores[0]
            : availableStores.find((s) => s.storeId === matchedManaged.assignedStoreId) ||
              availableStores[0];

        const sessionUser: AppUser = {
          uid: matchedManaged.id,
          email: matchedManaged.username.includes('@')
            ? matchedManaged.username
            : `${matchedManaged.username}@retailstore.local`,
          displayName: matchedManaged.displayName,
          role: matchedManaged.role,
          activeStoreId: designatedStore.storeId,
          assignedStoreId: matchedManaged.assignedStoreId,
          assignedStoreName: matchedManaged.assignedStoreName,
        };

        localStorage.setItem('inventory_count_session_user', JSON.stringify(sessionUser));
        setStoredActiveStore(designatedStore);
        onLoginSuccess(sessionUser, designatedStore);
        return;
      }

      // Check if username exists in managedUsers (meaning password was incorrect)
      const query = inputId.toLowerCase();
      const userExistsWithWrongPass = managedUsers.some(
        (u) =>
          u.username.toLowerCase() === query ||
          (u.username.includes('@') && u.username.split('@')[0].toLowerCase() === query)
      );

      if (userExistsWithWrongPass) {
        setErrorMessage('Incorrect password. Please verify your credentials and try again.');
        return;
      }

      // 2. Fallback to Firebase Auth with email if configured
      if (inputId.includes('@')) {
        try {
          const cred = await signInWithEmailAndPassword(auth, inputId, inputPass);
          const isUserAdmin =
            inputId.toLowerCase() === 'jetgonzalgo@gmail.com' ||
            inputId.toLowerCase().includes('admin');
          const isUserSupervisor = inputId.toLowerCase().includes('supervisor');
          const fallbackRole: UserRole = isUserAdmin
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

      setErrorMessage(
        'Invalid username or password. Please contact your Administrator if you need an account.'
      );
    } catch (err: any) {
      setErrorMessage(err.message || 'Authentication failed. Please verify credentials.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex flex-col justify-center items-center px-4 py-8 bg-slate-950 text-slate-100">
      <div className="w-full max-w-md space-y-6">
        {/* Brand Lockup */}
        <div className="text-center space-y-2">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-600 shadow-xl shadow-emerald-950 border border-emerald-400/30">
            <Barcode className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-black tracking-tight text-white">
            Inventory Count
          </h1>
          <p className="text-xs text-slate-400">
            Sign in with your assigned username and password
          </p>
        </div>

        {/* Clean Username & Password Login Card */}
        <div className="rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl space-y-4">
          {errorMessage && (
            <div className="rounded-xl bg-rose-500/15 border border-rose-500/30 p-3 text-xs font-medium text-rose-300 leading-relaxed">
              {errorMessage}
            </div>
          )}

          <form onSubmit={handleLoginSubmit} className="space-y-4">
            {/* Username or Email */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Username <span className="text-emerald-400">*</span>
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={usernameOrEmail}
                  onChange={(e) => setUsernameOrEmail(e.target.value)}
                  placeholder="Enter your username or email"
                  autoComplete="username"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-3 pl-10 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                  required
                />
                <User className="absolute left-3.5 top-3.5 w-4 h-4 text-slate-400" />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Password <span className="text-emerald-400">*</span>
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-3 pl-10 pr-10 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                  required
                />
                <Lock className="absolute left-3.5 top-3.5 w-4 h-4 text-slate-400" />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-3 p-0.5 text-slate-400 hover:text-slate-200 transition"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full h-12 rounded-xl bg-emerald-600 text-sm font-bold text-white shadow-xl shadow-emerald-950 hover:bg-emerald-500 active:scale-98 transition flex items-center justify-center gap-2 disabled:opacity-50 mt-2"
            >
              <span>{isLoading ? 'Signing In...' : 'Sign In'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
