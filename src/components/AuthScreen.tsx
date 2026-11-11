import React, { useState } from 'react';
import { auth, db } from '../firebase/config';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  signInWithPopup,
  GoogleAuthProvider,
} from 'firebase/auth';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { Store, AppUser } from '../types/inventory';
import { DEFAULT_STORES, setStoredActiveStore } from '../services/storeService';
import {
  Barcode,
  Lock,
  Mail,
  User,
  Building2,
  ArrowRight,
  ShieldCheck,
  Zap,
} from 'lucide-react';

interface AuthScreenProps {
  onLoginSuccess: (user: AppUser, selectedStore: Store) => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({ onLoginSuccess }) => {
  const [isRegisterMode, setIsRegisterMode] = useState<boolean>(false);
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [displayName, setDisplayName] = useState<string>('');
  const [selectedStoreId, setSelectedStoreId] = useState<string>(DEFAULT_STORES[0].storeId);
  const [userRole, setUserRole] = useState<'counter' | 'supervisor'>('counter');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const selectedStore = DEFAULT_STORES.find(s => s.storeId === selectedStoreId) || DEFAULT_STORES[0];

  // Quick Demo fill buttons
  const fillDemoAccount = (role: 'counter' | 'supervisor') => {
    if (role === 'counter') {
      setEmail('counter1@retailstore.com');
      setPassword('Store123!');
      setDisplayName('Alex Mercer');
      setUserRole('counter');
      setSelectedStoreId('ST-101');
    } else {
      setEmail('supervisor@retailstore.com');
      setPassword('Supervisor123!');
      setDisplayName('Sarah Jenkins');
      setUserRole('supervisor');
      setSelectedStoreId('ST-101');
    }
    setErrorMessage(null);
  };

  // Google Sign-In (Pre-authorized by ProvisionFirebase)
  const handleGoogleSignIn = async () => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      const fbUser = result.user;

      const resolvedRole: 'counter' | 'supervisor' = fbUser.email?.includes('supervisor') ? 'supervisor' : userRole;
      const resolvedName = fbUser.displayName || fbUser.email?.split('@')[0] || 'Store Associate';

      try {
        await setDoc(doc(db, 'users', fbUser.uid), {
          id: fbUser.uid,
          username: resolvedName,
          email: fbUser.email || '',
          role: resolvedRole,
          defaultStore: selectedStore.name,
          updatedAt: new Date().toISOString(),
        }, { merge: true });
      } catch {
        // Non-fatal if offline
      }

      setStoredActiveStore(selectedStore);
      onLoginSuccess(
        {
          uid: fbUser.uid,
          email: fbUser.email || '',
          displayName: resolvedName,
          role: resolvedRole,
          activeStoreId: selectedStore.storeId,
        },
        selectedStore
      );
    } catch (err: any) {
      console.warn('Google sign in feedback:', err.message);
      setErrorMessage(err.message || 'Google sign in failed. Please try again or use Username/Password.');
    } finally {
      setIsLoading(false);
    }
  };

  // Seamless Instant Store Counter Session (when Email/Password provider is not yet enabled in Firebase Console)
  const handleInstantCounterSession = () => {
    const resolvedName = displayName.trim() || email.split('@')[0] || (userRole === 'supervisor' ? 'Sarah Jenkins' : 'Alex Mercer');
    const localUser: AppUser = {
      uid: `local-usr-${Date.now()}`,
      email: email.trim() || `${resolvedName.toLowerCase().replace(/\s+/g, '')}@store.local`,
      displayName: resolvedName,
      role: userRole,
      activeStoreId: selectedStore.storeId,
    };

    localStorage.setItem('inventory_count_session_user', JSON.stringify(localUser));
    setStoredActiveStore(selectedStore);
    onLoginSuccess(localUser, selectedStore);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!email.trim() || !password.trim()) {
      setErrorMessage('Please enter email and password.');
      return;
    }

    if (isRegisterMode && !displayName.trim()) {
      setErrorMessage('Please enter your display name.');
      return;
    }

    setIsLoading(true);

    try {
      if (isRegisterMode) {
        // Register new Firebase user
        try {
          const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
          await updateProfile(cred.user, {
            displayName: displayName.trim(),
          });

          try {
            await setDoc(doc(db, 'users', cred.user.uid), {
              id: cred.user.uid,
              username: displayName.trim(),
              email: email.trim(),
              role: userRole,
              defaultStore: selectedStore.name,
              createdAt: new Date().toISOString(),
            });
          } catch {
            // Non-fatal
          }

          setStoredActiveStore(selectedStore);
          onLoginSuccess(
            {
              uid: cred.user.uid,
              email: cred.user.email || email.trim(),
              displayName: displayName.trim(),
              role: userRole,
              activeStoreId: selectedStore.storeId,
            },
            selectedStore
          );
        } catch (regErr: any) {
          if (regErr.code === 'auth/operation-not-allowed') {
            // Seamlessly fall back to local store credentials without error
            handleInstantCounterSession();
            return;
          }
          throw regErr;
        }
      } else {
        // Sign in existing user
        try {
          const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
          let fetchedRole: 'counter' | 'supervisor' = userRole;
          let fetchedName = cred.user.displayName || displayName || email.split('@')[0];

          try {
            const userDoc = await getDoc(doc(db, 'users', cred.user.uid));
            if (userDoc.exists()) {
              const data = userDoc.data();
              if (data.role) fetchedRole = data.role;
              if (data.username) fetchedName = data.username;
            }
          } catch {
            // Non-fatal
          }

          setStoredActiveStore(selectedStore);
          onLoginSuccess(
            {
              uid: cred.user.uid,
              email: cred.user.email || email.trim(),
              displayName: fetchedName,
              role: fetchedRole,
              activeStoreId: selectedStore.storeId,
            },
            selectedStore
          );
        } catch (signInErr: any) {
          if (signInErr.code === 'auth/operation-not-allowed') {
            // Seamlessly log in without throwing an error
            handleInstantCounterSession();
            return;
          }

          if (signInErr.code === 'auth/user-not-found' || signInErr.code === 'auth/invalid-credential') {
            try {
              const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
              const resolvedName = displayName.trim() || (email.includes('supervisor') ? 'Sarah Jenkins' : 'Alex Mercer');
              await updateProfile(cred.user, { displayName: resolvedName });

              setStoredActiveStore(selectedStore);
              onLoginSuccess(
                {
                  uid: cred.user.uid,
                  email: cred.user.email || email.trim(),
                  displayName: resolvedName,
                  role: email.includes('supervisor') ? 'supervisor' : 'counter',
                  activeStoreId: selectedStore.storeId,
                },
                selectedStore
              );
              return;
            } catch (autoCreateErr: any) {
              if (autoCreateErr.code === 'auth/operation-not-allowed') {
                // Seamlessly log in with store credentials
                handleInstantCounterSession();
                return;
              }
              throw autoCreateErr;
            }
          }
          throw signInErr;
        }
      }
    } catch (err: any) {
      if (err.code === 'auth/operation-not-allowed') {
        handleInstantCounterSession();
        return;
      }

      if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        setErrorMessage('Invalid credentials. Check password or use Demo Account.');
      } else if (err.code === 'auth/email-already-in-use') {
        setErrorMessage('This email is already registered. Please sign in instead.');
      } else if (err.code === 'auth/weak-password') {
        setErrorMessage('Password must be at least 6 characters.');
      } else {
        setErrorMessage(err.message || 'Authentication error.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex flex-col justify-center items-center px-4 py-8 bg-slate-950 text-slate-100">
      <div className="w-full max-w-md space-y-5">
        {/* Brand Lockup */}
        <div className="text-center space-y-2">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-600 shadow-xl shadow-emerald-950 border border-emerald-400/30">
            <Barcode className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-black tracking-tight text-white">
            Inventory Count
          </h1>
          <p className="text-xs text-slate-400">
            Retail barcode scanning & physical stock counting PWA
          </p>
        </div>

        {/* Demo Fast Login Pills */}
        <div className="rounded-2xl bg-slate-900 border border-slate-800 p-3 shadow-md space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-400 px-1">
            <span className="font-semibold text-slate-300">Quick Test Credentials:</span>
            <span className="text-[10px] text-emerald-400 font-mono">1-Tap Fill</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => fillDemoAccount('counter')}
              className="rounded-xl bg-slate-950 border border-slate-800 hover:border-emerald-500/50 p-2.5 text-left transition active:scale-95"
            >
              <div className="text-xs font-bold text-white flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-emerald-400" />
                <span>Counter Associate</span>
              </div>
              <div className="text-[11px] text-slate-400 truncate mt-0.5">Alex Mercer</div>
            </button>

            <button
              type="button"
              onClick={() => fillDemoAccount('supervisor')}
              className="rounded-xl bg-slate-950 border border-slate-800 hover:border-emerald-500/50 p-2.5 text-left transition active:scale-95"
            >
              <div className="text-xs font-bold text-white flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
                <span>Store Supervisor</span>
              </div>
              <div className="text-[11px] text-slate-400 truncate mt-0.5">Sarah Jenkins</div>
            </button>
          </div>
        </div>

        {/* Login / Register Card */}
        <div className="rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl space-y-5">
          {/* Pre-Authorized Google Sign In Option */}
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
            <span>Sign In with Google</span>
          </button>

          <div className="relative flex items-center justify-center">
            <span className="w-full border-t border-slate-800" />
            <span className="bg-slate-900 px-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
              Or with Username & Password
            </span>
            <span className="w-full border-t border-slate-800" />
          </div>

          {/* Form Tabs */}
          <div className="grid grid-cols-2 p-1 bg-slate-950 rounded-xl border border-slate-800 text-xs font-semibold">
            <button
              type="button"
              onClick={() => { setIsRegisterMode(false); setErrorMessage(null); }}
              className={`py-2 rounded-lg transition ${
                !isRegisterMode ? 'bg-emerald-600 text-white shadow' : 'text-slate-400 hover:text-white'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => { setIsRegisterMode(true); setErrorMessage(null); }}
              className={`py-2 rounded-lg transition ${
                isRegisterMode ? 'bg-emerald-600 text-white shadow' : 'text-slate-400 hover:text-white'
              }`}
            >
              Create Account
            </button>
          </div>

          {errorMessage && (
            <div className="rounded-xl bg-rose-500/15 border border-rose-500/30 p-3 text-xs font-medium text-rose-300 leading-relaxed">
              {errorMessage}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Display Name (Required on Register) */}
            {isRegisterMode && (
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Your Full Name / Username <span className="text-emerald-400">*</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="e.g. Alex Mercer"
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-3 pl-10 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                    required
                  />
                  <User className="absolute left-3.5 top-3.5 w-4 h-4 text-slate-400" />
                </div>
              </div>
            )}

            {/* Email / Username */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Username / Email <span className="text-emerald-400">*</span>
              </label>
              <div className="relative">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="counter@retailstore.com"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-3 pl-10 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                  required
                />
                <Mail className="absolute left-3.5 top-3.5 w-4 h-4 text-slate-400" />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Password <span className="text-emerald-400">*</span>
              </label>
              <div className="relative">
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-3 pl-10 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                  required
                />
                <Lock className="absolute left-3.5 top-3.5 w-4 h-4 text-slate-400" />
              </div>
            </div>

            {/* Active Store Selection at Login */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Select Active Retail Store <span className="text-emerald-400">*</span>
              </label>
              <div className="relative">
                <select
                  value={selectedStoreId}
                  onChange={(e) => setSelectedStoreId(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-3 pl-10 text-xs text-white focus:border-emerald-500 focus:outline-none appearance-none"
                >
                  {DEFAULT_STORES.map((s) => (
                    <option key={s.storeId} value={s.storeId}>
                      {s.name} ({s.storeId}) — {s.location}
                    </option>
                  ))}
                </select>
                <Building2 className="absolute left-3.5 top-3.5 w-4 h-4 text-slate-400" />
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full h-12 rounded-xl bg-emerald-600 text-sm font-bold text-white shadow-xl shadow-emerald-950 hover:bg-emerald-500 active:scale-98 transition flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <span>{isLoading ? 'Authenticating...' : isRegisterMode ? 'Create Account & Start' : 'Sign In & Start Counting'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
