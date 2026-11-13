import { AppUser, ManagedUser } from '../types/inventory';
import { auth, db } from '../firebase/config';
import { EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { collection, getDocs, doc, setDoc, deleteDoc, onSnapshot, query, limit } from 'firebase/firestore';

export const DEFAULT_MANAGED_USERS: ManagedUser[] = [
  {
    id: 'user-admin-1',
    username: 'jetgonzalgo@gmail.com',
    displayName: 'Jet Gonzalgo (Administrator)',
    password: 'admin',
    role: 'admin',
    assignedStoreId: 'ST-101',
    assignedStoreName: 'Downtown Flagship',
    createdAt: '2026-01-01T00:00:00Z',
    isActive: true,
  },
  {
    id: 'user-sup-101',
    username: 'supervisor.flagship',
    displayName: 'Sarah Jenkins (Store Supervisor)',
    password: 'password123',
    role: 'supervisor',
    assignedStoreId: 'ST-101',
    assignedStoreName: 'Downtown Flagship',
    createdAt: '2026-01-01T00:00:00Z',
    isActive: true,
  },
  {
    id: 'user-cnt-101',
    username: 'counter.flagship',
    displayName: 'Mark Davis (Store Counter)',
    password: 'password123',
    role: 'counter',
    assignedStoreId: 'ST-101',
    assignedStoreName: 'Downtown Flagship',
    createdAt: '2026-01-01T00:00:00Z',
    isActive: true,
  },
  {
    id: 'user-ops-cnt-1',
    username: 'ops.counter',
    displayName: 'Alex Rivera (Ops Counter)',
    password: 'password123',
    role: 'ops_counter',
    assignedStoreId: 'ALL',
    assignedStoreName: 'All Stores (Operations)',
    createdAt: '2026-01-01T00:00:00Z',
    isActive: true,
  },
  {
    id: 'user-ops-sup-1',
    username: 'ops.supervisor',
    displayName: 'Rachel Lim (Counter Supervisor)',
    password: 'password123',
    role: 'ops_supervisor',
    assignedStoreId: 'ALL',
    assignedStoreName: 'All Stores (Operations)',
    createdAt: '2026-01-01T00:00:00Z',
    isActive: true,
  },
];

const LOCAL_MANAGED_USERS_KEY = 'inventory_count_managed_users';
const OPS_SEEDED_KEY = 'inventory_count_ops_roles_seeded';

function parseUserDoc(id: string, d: Record<string, any>): ManagedUser {
  return {
    id,
    username: d.username || id,
    displayName: d.displayName || d.username || 'User',
    password: d.password || '',
    role: d.role || 'counter',
    assignedStoreId: d.assignedStoreId || 'ST-101',
    assignedStoreName: d.assignedStoreName || 'Downtown Flagship',
    createdAt: d.createdAt || new Date().toISOString(),
    createdBy: d.createdBy,
    isActive: d.isActive !== false,
  };
}

export function getLocalManagedUsers(): ManagedUser[] {
  try {
    const raw = localStorage.getItem(LOCAL_MANAGED_USERS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn('Error reading local managed users:', e);
  }
  return DEFAULT_MANAGED_USERS;
}

export function saveLocalManagedUsers(users: ManagedUser[]): void {
  try {
    localStorage.setItem(LOCAL_MANAGED_USERS_KEY, JSON.stringify(users));
  } catch (e) {
    console.warn('Error saving local managed users:', e);
  }
}

export async function fetchManagedUsers(): Promise<ManagedUser[]> {
  try {
    const snapshot = await getDocs(collection(db, 'managed_users'));
    if (!snapshot.empty) {
      const users: ManagedUser[] = [];
      snapshot.forEach((docSnap) => {
        users.push(parseUserDoc(docSnap.id, docSnap.data()));
      });
      saveLocalManagedUsers(users);
      return users;
    }
  } catch (e) {
    console.warn('Offline or error fetching managed users from Firestore. Using cache:', e);
  }
  return getLocalManagedUsers();
}

export function subscribeToManagedUsers(onUpdate: (users: ManagedUser[]) => void): () => void {
  try {
    return onSnapshot(
      collection(db, 'managed_users'),
      (snapshot) => {
        if (!snapshot.empty) {
          const users: ManagedUser[] = [];
          snapshot.forEach((docSnap) => {
            users.push(parseUserDoc(docSnap.id, docSnap.data()));
          });
          saveLocalManagedUsers(users);
          onUpdate(users);
        } else {
          onUpdate(getLocalManagedUsers());
        }
      },
      (err) => {
        console.warn('Realtime managed_users listener error:', err);
        onUpdate(getLocalManagedUsers());
      }
    );
  } catch (err) {
    console.warn('Could not attach realtime managed_users listener:', err);
    onUpdate(getLocalManagedUsers());
    return () => {};
  }
}

export async function seedUsersIfEmpty(): Promise<void> {
  try {
    if (localStorage.getItem(OPS_SEEDED_KEY) === 'true') return;
    const checkSnap = await getDocs(query(collection(db, 'managed_users'), limit(1)));
    if (checkSnap.empty) {
      for (const u of DEFAULT_MANAGED_USERS) {
        await setDoc(doc(db, 'managed_users', u.id), u);
      }
      localStorage.setItem(OPS_SEEDED_KEY, 'true');
      return;
    }

    // Ensure default Operations role sample accounts exist once on upgrade if not already seeded
    const snapshot = await getDocs(collection(db, 'managed_users'));
    const existingIds = new Set(snapshot.docs.map(d => d.id));
    for (const u of DEFAULT_MANAGED_USERS) {
      if ((u.role === 'ops_counter' || u.role === 'ops_supervisor') && !existingIds.has(u.id)) {
        await setDoc(doc(db, 'managed_users', u.id), u);
      }
    }
    localStorage.setItem(OPS_SEEDED_KEY, 'true');
  } catch (e) {
    console.warn('Managed users seeding skipped or offline:', e);
  }
}

/**
 * Admin action: Adds a new managed user with assigned store and role.
 */
export async function addManagedUser(
  newUser: Omit<ManagedUser, 'id' | 'createdAt' | 'isActive'>
): Promise<ManagedUser[]> {
  const currentUsers = getLocalManagedUsers();
  const userId = `usr_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const created: ManagedUser = {
    ...newUser,
    id: userId,
    createdAt: new Date().toISOString(),
    isActive: true,
  };

  const updatedUsers = [created, ...currentUsers];
  saveLocalManagedUsers(updatedUsers);

  try {
    await setDoc(doc(db, 'managed_users', userId), created);
  } catch (e) {
    console.warn('Offline: user saved locally and will sync when online.', e);
  }

  return updatedUsers;
}

/**
 * Admin action: Updates an existing user's assigned store, role, or credentials.
 */
export async function updateManagedUser(updatedUser: ManagedUser): Promise<ManagedUser[]> {
  const currentUsers = getLocalManagedUsers();
  const updatedUsers = currentUsers.map((u) => (u.id === updatedUser.id ? updatedUser : u));

  saveLocalManagedUsers(updatedUsers);

  try {
    await setDoc(doc(db, 'managed_users', updatedUser.id), updatedUser);
  } catch (e) {
    console.warn('Offline: updated user saved locally and will sync when online.', e);
  }

  return updatedUsers;
}

/**
 * Admin action: Deletes a user.
 */
export async function deleteManagedUser(userId: string): Promise<ManagedUser[]> {
  const currentUsers = getLocalManagedUsers();
  const updatedUsers = currentUsers.filter((u) => u.id !== userId);

  saveLocalManagedUsers(updatedUsers);

  try {
    await deleteDoc(doc(db, 'managed_users', userId));
  } catch (e) {
    console.warn('Offline: user deleted locally and will sync when online.', e);
  }

  return updatedUsers;
}

/**
 * Look up user credentials during login.
 */
export function findUserForAuth(
  usernameOrEmail: string,
  pass?: string,
  usersList?: ManagedUser[]
): ManagedUser | null {
  const users = usersList && usersList.length > 0 ? usersList : getLocalManagedUsers();
  const query = usernameOrEmail.trim().toLowerCase();

  // Direct match by username or email
  const matched = users.find(
    (u) =>
      u.username.toLowerCase() === query ||
      (u.username.includes('@') && u.username.split('@')[0].toLowerCase() === query)
  );

  if (!matched) return null;

  // If password provided and user has a password set, verify
  if (pass && matched.password && matched.password !== pass) {
    return null;
  }

  return matched;
}

/**
 * Verifies the logged-in administrator's password before destructive actions.
 */
export async function verifyAdminPassword(
  currentUser: AppUser,
  enteredPassword: string,
  usersList?: ManagedUser[]
): Promise<boolean> {
  if (currentUser.role !== 'admin') return false;
  const trimmed = enteredPassword.trim();
  if (!trimmed) return false;

  const users = usersList && usersList.length > 0 ? usersList : getLocalManagedUsers();
  const emailLower = (currentUser.email || '').trim().toLowerCase();
  const matchedAdmin = users.find(
    (u) =>
      u.role === 'admin' &&
      (u.id === currentUser.uid ||
        u.username.toLowerCase() === emailLower ||
        (u.username.includes('@') && u.username.split('@')[0].toLowerCase() === emailLower.split('@')[0]))
  );

  if (matchedAdmin?.password) {
    if (matchedAdmin.password === trimmed || matchedAdmin.password === enteredPassword) {
      return true;
    }
  }

  if (auth.currentUser && auth.currentUser.email) {
    try {
      const cred = EmailAuthProvider.credential(auth.currentUser.email, enteredPassword);
      await reauthenticateWithCredential(auth.currentUser, cred);
      return true;
    } catch {
      return false;
    }
  }

  return false;
}
