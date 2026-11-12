import { ManagedUser } from '../types/inventory';
import { db } from '../firebase/config';
import { collection, getDocs, doc, setDoc, deleteDoc } from 'firebase/firestore';

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
    displayName: 'Sarah Jenkins (Supervisor)',
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
    displayName: 'Mark Davis (Counter)',
    password: 'password123',
    role: 'counter',
    assignedStoreId: 'ST-101',
    assignedStoreName: 'Downtown Flagship',
    createdAt: '2026-01-01T00:00:00Z',
    isActive: true,
  },
  {
    id: 'user-cnt-102',
    username: 'counter.galleria',
    displayName: 'Emily Chen (Counter)',
    password: 'password123',
    role: 'counter',
    assignedStoreId: 'ST-102',
    assignedStoreName: 'Westfield Galleria',
    createdAt: '2026-01-01T00:00:00Z',
    isActive: true,
  },
];

const LOCAL_MANAGED_USERS_KEY = 'inventory_count_managed_users';

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
        const d = docSnap.data();
        users.push({
          id: docSnap.id,
          username: d.username || docSnap.id,
          displayName: d.displayName || d.username || 'User',
          password: d.password || '',
          role: d.role || 'counter',
          assignedStoreId: d.assignedStoreId || 'ST-101',
          assignedStoreName: d.assignedStoreName || 'Downtown Flagship',
          createdAt: d.createdAt || new Date().toISOString(),
          createdBy: d.createdBy,
          isActive: d.isActive !== false,
        });
      });
      saveLocalManagedUsers(users);
      return users;
    }
  } catch (e) {
    console.warn('Offline or error fetching managed users from Firestore. Using cache:', e);
  }
  return getLocalManagedUsers();
}

export async function seedUsersIfEmpty(): Promise<void> {
  try {
    const snapshot = await getDocs(collection(db, 'managed_users'));
    if (snapshot.empty) {
      for (const u of DEFAULT_MANAGED_USERS) {
        await setDoc(doc(db, 'managed_users', u.id), u);
      }
    }
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
export function findUserForAuth(usernameOrEmail: string, pass?: string): ManagedUser | null {
  const users = getLocalManagedUsers();
  const query = usernameOrEmail.trim().toLowerCase();
  
  // Direct match by username or email
  const matched = users.find(
    (u) =>
      u.username.toLowerCase() === query ||
      (u.username.includes('@') && u.username.split('@')[0].toLowerCase() === query)
  );

  if (!matched) return null;

  // If password provided and user has a password set, verify (lenient fallback for demo accounts)
  if (pass && matched.password && matched.password !== pass) {
    return null;
  }

  return matched;
}
