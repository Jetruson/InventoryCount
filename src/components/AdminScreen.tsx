import React, { useState, useMemo, useRef, useEffect } from 'react';
import { InventoryCount, Store, Product, MasterlistItem, CountVarianceItem, AppUser, ManagedUser, UserRole } from '../types/inventory';
import { bulkImportMasterlist, getLocalCatalog, deleteProductFromCatalog, clearAllProducts } from '../services/catalogService';
import { addStore, deleteStore, updateStore } from '../services/storeService';
import {
  getLocalManagedUsers,
  subscribeToManagedUsers,
  addManagedUser,
  updateManagedUser,
  deleteManagedUser,
} from '../services/userService';
import * as XLSX from 'xlsx';
import {
  ShieldAlert,
  Upload,
  Download,
  FileSpreadsheet,
  FileText,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Search,
  Trash2,
  Package,
  Layers,
  Building2,
  Calendar,
  MapPin,
  Check,
  X,
  Database,
  ArrowRight,
  TrendingDown,
  TrendingUp,
  FileCheck,
  Plus,
  Edit2,
  AlertCircle,
  Store as StoreIcon,
  Users,
  Key,
  ShieldCheck,
  UserPlus,
  Lock,
} from 'lucide-react';

interface AdminScreenProps {
  currentUser: AppUser;
  counts: InventoryCount[];
  stores: Store[];
  catalog: Product[];
  onCatalogUpdated: () => void;
  onStoresUpdated?: (stores: Store[]) => void;
  onUsersUpdated?: (users: ManagedUser[]) => void;
}

export const AdminScreen: React.FC<AdminScreenProps> = ({
  currentUser,
  counts,
  stores,
  catalog,
  onCatalogUpdated,
  onStoresUpdated,
  onUsersUpdated,
}) => {
  const [activeTab, setActiveTab] = useState<'upload_masterlist' | 'extract_counts' | 'manage_stores' | 'manage_users'>('upload_masterlist');

  // Masterlist upload state
  const [dragActive, setDragActive] = useState<boolean>(false);
  const [parsedItems, setParsedItems] = useState<MasterlistItem[]>([]);
  const [fileName, setFileName] = useState<string>('');
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const [importSuccessMessage, setImportSuccessMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Masterlist search & explore state
  const [catalogSearch, setCatalogSearch] = useState<string>('');
  const [selectedCatalogCategory, setSelectedCatalogCategory] = useState<string>('all');

  // Store Management state (Add / Delete / Edit stores)
  const [isAddStoreModalOpen, setIsAddStoreModalOpen] = useState<boolean>(false);
  const [newStoreId, setNewStoreId] = useState<string>('');
  const [newStoreName, setNewStoreName] = useState<string>('');
  const [newStoreLocation, setNewStoreLocation] = useState<string>('');
  const [storeActionError, setStoreActionError] = useState<string | null>(null);
  const [storeActionSuccess, setStoreActionSuccess] = useState<string | null>(null);
  const [storeSearchQuery, setStoreSearchQuery] = useState<string>('');
  const [storeToDelete, setStoreToDelete] = useState<Store | null>(null);
  const [storeToEdit, setStoreToEdit] = useState<Store | null>(null);
  const [editStoreName, setEditStoreName] = useState<string>('');
  const [editStoreLocation, setEditStoreLocation] = useState<string>('');
  const [isStoreSubmitting, setIsStoreSubmitting] = useState<boolean>(false);

  // Extract counts state
  const [selectedStore, setSelectedStore] = useState<string>('all');
  const [selectedDateRange, setSelectedDateRange] = useState<'all' | 'today' | 'yesterday' | '7days' | '30days'>('all');
  const [selectedLocation, setSelectedLocation] = useState<string>('all');
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  // User Management state (Admin only)
  const [managedUsers, setManagedUsers] = useState<ManagedUser[]>(getLocalManagedUsers());
  const [isAddUserModalOpen, setIsAddUserModalOpen] = useState<boolean>(false);
  const [newDisplayName, setNewDisplayName] = useState<string>('');
  const [newUsername, setNewUsername] = useState<string>('');
  const [newPassword, setNewPassword] = useState<string>('');
  const [newUserRole, setNewUserRole] = useState<UserRole>('counter');
  const [newUserStoreId, setNewUserStoreId] = useState<string>(stores[0]?.storeId || 'ST-101');
  const [userActionError, setUserActionError] = useState<string | null>(null);
  const [userActionSuccess, setUserActionSuccess] = useState<string | null>(null);
  const [userSearchQuery, setUserSearchQuery] = useState<string>('');
  const [userRoleFilter, setUserRoleFilter] = useState<'all' | UserRole>('all');
  const [userStoreFilter, setUserStoreFilter] = useState<string>('all');
  const [userToDelete, setUserToDelete] = useState<ManagedUser | null>(null);
  const [userToEdit, setUserToEdit] = useState<ManagedUser | null>(null);
  const [editDisplayName, setEditDisplayName] = useState<string>('');
  const [editPassword, setEditPassword] = useState<string>('');
  const [editUserRole, setEditUserRole] = useState<UserRole>('counter');
  const [editUserStoreId, setEditUserStoreId] = useState<string>('');
  const [isUserSubmitting, setIsUserSubmitting] = useState<boolean>(false);

  useEffect(() => {
    const unsub = subscribeToManagedUsers((fetched) => {
      setManagedUsers(fetched);
    });
    return () => unsub();
  }, []);

  const handleSelectNewUserRole = (role: UserRole) => {
    setNewUserRole(role);
    if (role === 'ops_counter' || role === 'ops_supervisor' || role === 'audit') {
      setNewUserStoreId('ALL');
    } else if (newUserStoreId === 'ALL') {
      setNewUserStoreId(stores[0]?.storeId || 'ST-101');
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setUserActionError(null);
    setUserActionSuccess(null);

    const trimmedUser = newUsername.trim().toLowerCase();
    const trimmedName = newDisplayName.trim();

    if (!trimmedName || !trimmedUser) {
      setUserActionError('Display name and username/email are required.');
      return;
    }

    if (managedUsers.some((u) => u.username.toLowerCase() === trimmedUser)) {
      setUserActionError(`A user with username "${trimmedUser}" already exists.`);
      return;
    }

    const isAllStores = newUserStoreId === 'ALL';
    const assignedStore = isAllStores ? null : stores.find((s) => s.storeId === newUserStoreId) || stores[0];
    const resolvedStoreId = isAllStores ? 'ALL' : (assignedStore?.storeId || 'ST-101');
    const resolvedStoreName = isAllStores
      ? newUserRole === 'audit'
        ? 'All Stores (Audit)'
        : 'All Stores (Operations)'
      : (assignedStore?.name || 'Downtown Flagship');

    setIsUserSubmitting(true);
    try {
      const updated = await addManagedUser({
        username: trimmedUser,
        displayName: trimmedName,
        password: newPassword.trim() || 'password123',
        role: newUserRole,
        assignedStoreId: resolvedStoreId,
        assignedStoreName: resolvedStoreName,
        createdBy: currentUser.email || currentUser.displayName,
      });
      setManagedUsers(updated);
      onUsersUpdated?.(updated);
      setUserActionSuccess(
        `User "${trimmedName}" (${newUserRole}) successfully provisioned for ${resolvedStoreName}.`
      );
      setIsAddUserModalOpen(false);
      setNewDisplayName('');
      setNewUsername('');
      setNewPassword('');
    } catch (err: any) {
      setUserActionError(err.message || 'Failed to create user. Please try again.');
    } finally {
      setIsUserSubmitting(false);
    }
  };

  const handleOpenEditUser = (user: ManagedUser) => {
    setUserToEdit(user);
    setEditDisplayName(user.displayName);
    setEditPassword(user.password || '');
    setEditUserRole(user.role);
    setEditUserStoreId(user.assignedStoreId);
    setUserActionError(null);
  };

  const handleSaveEditUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userToEdit) return;
    setUserActionError(null);
    setUserActionSuccess(null);

    const isAllStores = editUserStoreId === 'ALL';
    const assignedStore = isAllStores ? null : stores.find((s) => s.storeId === editUserStoreId) || stores[0];

    setIsUserSubmitting(true);
    try {
      const updatedUser: ManagedUser = {
        ...userToEdit,
        displayName: editDisplayName.trim() || userToEdit.displayName,
        password: editPassword.trim() || userToEdit.password,
        role: editUserRole,
        assignedStoreId: isAllStores ? 'ALL' : (assignedStore?.storeId || userToEdit.assignedStoreId),
        assignedStoreName: isAllStores
          ? editUserRole === 'audit'
            ? 'All Stores (Audit)'
            : 'All Stores (Operations)'
          : (assignedStore?.name || userToEdit.assignedStoreName),
      };

      const updated = await updateManagedUser(updatedUser);
      setManagedUsers(updated);
      onUsersUpdated?.(updated);
      setUserActionSuccess(`User "${updatedUser.displayName}" successfully updated.`);
      setUserToEdit(null);
    } catch (err: any) {
      setUserActionError(err.message || 'Failed to update user.');
    } finally {
      setIsUserSubmitting(false);
    }
  };

  const handleConfirmDeleteUser = async () => {
    if (!userToDelete) return;
    setUserActionError(null);
    setUserActionSuccess(null);

    if (userToDelete.username === 'jetgonzalgo@gmail.com') {
      setUserActionError('Cannot delete the primary Administrator account.');
      setUserToDelete(null);
      return;
    }

    setIsUserSubmitting(true);
    try {
      const updated = await deleteManagedUser(userToDelete.id);
      setManagedUsers(updated);
      onUsersUpdated?.(updated);
      setUserActionSuccess(`User "${userToDelete.displayName}" has been deleted.`);
      setUserToDelete(null);
    } catch (err: any) {
      setUserActionError(err.message || 'Failed to delete user.');
    } finally {
      setIsUserSubmitting(false);
    }
  };

  const filteredManagedUsers = useMemo(() => {
    return managedUsers.filter((u) => {
      if (userRoleFilter !== 'all' && u.role !== userRoleFilter) return false;
      if (userStoreFilter !== 'all' && u.assignedStoreId !== userStoreFilter) return false;
      if (userSearchQuery.trim()) {
        const q = userSearchQuery.trim().toLowerCase();
        const matchName = u.displayName.toLowerCase().includes(q);
        const matchUser = u.username.toLowerCase().includes(q);
        const matchStore = (u.assignedStoreName || '').toLowerCase().includes(q);
        const matchRole = u.role.toLowerCase().includes(q);
        if (!matchName && !matchUser && !matchStore && !matchRole) return false;
      }
      return true;
    });
  }, [managedUsers, userRoleFilter, userStoreFilter, userSearchQuery]);

  // Access Control Guard
  if (currentUser.role !== 'admin') {
    return (
      <div className="w-full max-w-2xl mx-auto py-12 px-4 text-center">
        <div className="rounded-3xl bg-slate-900 border border-rose-500/30 p-8 shadow-2xl space-y-4">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-rose-500/10 text-rose-400">
            <ShieldAlert className="w-9 h-9" />
          </div>
          <h2 className="text-xl font-black text-white">Administrator Access Required</h2>
          <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
            Uploading the item masterlist and extracting counted inventory data are restricted to System Administrators. Your current role is <strong className="text-white capitalize">{currentUser.role}</strong>.
          </p>
          <div className="text-[11px] text-slate-500">
            Please log in with an administrator account to access this management console.
          </div>
        </div>
      </div>
    );
  }

  // --- MASTERLIST UPLOAD HANDLERS ---
  const handleFileDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processSelectedFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processSelectedFile(e.target.files[0]);
    }
  };

  const processSelectedFile = async (file: File) => {
    setFileName(file.name);
    setParseErrors([]);
    setImportSuccessMessage(null);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const workbook = XLSX.read(data, { type: 'binary' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        
        // Convert sheet to JSON array with header detection
        const rawRows: Record<string, any>[] = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

        if (rawRows.length === 0) {
          setParseErrors(['The uploaded file appears to be empty. Please include rows with "Item No.", "Item Description", "Item Group", and "UoM".']);
          setParsedItems([]);
          return;
        }

        const items: MasterlistItem[] = [];
        const errors: string[] = [];

        rawRows.forEach((row, idx) => {
          // Normalize row keys: strip spaces, dashes, underscores, and dots for robust matching
          const normalized: Record<string, any> = {};
          Object.keys(row).forEach((k) => {
            const cleanKey = k.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
            normalized[cleanKey] = row[k];
          });

          // Match Item No. (SKU / Barcode)
          const itemNo = String(
            normalized['itemno'] ||
            normalized['itemnumber'] ||
            normalized['itemcode'] ||
            normalized['sku'] ||
            normalized['productcode'] ||
            normalized['code'] ||
            normalized['id'] ||
            ''
          ).trim();

          // Match Item Description
          const description = String(
            normalized['itemdescription'] ||
            normalized['description'] ||
            normalized['itemname'] ||
            normalized['name'] ||
            normalized['title'] ||
            ''
          ).trim();

          // Match Item Group (Category)
          const itemGroup = String(
            normalized['itemgroup'] ||
            normalized['group'] ||
            normalized['category'] ||
            normalized['department'] ||
            normalized['dept'] ||
            'General'
          ).trim();

          // Match UoM (Unit of Measure)
          const uom = String(
            normalized['uom'] ||
            normalized['unit'] ||
            normalized['unitofmeasure'] ||
            'pcs'
          ).trim();

          // If a dedicated Barcode column is provided, use it; otherwise, Item No. is the barcode
          const barcode = String(
            normalized['barcode'] ||
            normalized['barcodeno'] ||
            normalized['upc'] ||
            normalized['ean'] ||
            itemNo
          ).trim();

          const stockRaw = normalized['systemstock'] ?? normalized['stock'] ?? normalized['qty'] ?? normalized['quantity'] ?? 0;
          const parsedStock = Number(stockRaw);
          const systemStock = !isNaN(parsedStock) ? parsedStock : 0;

          if (!itemNo) {
            errors.push(`Row ${idx + 2}: Missing "Item No." identifier.`);
            return;
          }

          items.push({
            sku: itemNo,
            barcode: barcode || itemNo,
            description: description || `Item ${itemNo}`,
            category: itemGroup || 'General',
            unit: uom || 'pcs',
            systemStock,
          });
        });

        if (items.length === 0) {
          setParseErrors(['No valid items could be parsed. Required column headers: Item No., Item Description, Item Group, UoM.']);
        } else {
          setParsedItems(items);
          if (errors.length > 0) {
            setParseErrors(errors.slice(0, 5));
          }
        }
      } catch (err: any) {
        console.error('Masterlist parse error:', err);
        setParseErrors([`Failed to read file: ${err.message || 'Unknown format error.'}`]);
        setParsedItems([]);
      }
    };

    reader.readAsBinaryString(file);
  };

  const handleConfirmImport = async () => {
    if (parsedItems.length === 0) return;

    setIsImporting(true);
    setImportSuccessMessage(null);

    try {
      const result = await bulkImportMasterlist(parsedItems, importMode);
      onCatalogUpdated();
      setImportSuccessMessage(
        `Successfully imported ${result.successCount} masterlist items (${importMode === 'replace' ? 'Masterlist replaced' : 'Catalog merged'}).`
      );
      setParsedItems([]);
      setFileName('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err: any) {
      console.error('Import error:', err);
      setParseErrors([`Error saving masterlist: ${err.message || 'Check connection.'}`]);
    } finally {
      setIsImporting(false);
    }
  };

  // --- STORE MANAGEMENT HANDLERS (ADMIN ONLY) ---
  const handleCreateStore = async (e: React.FormEvent) => {
    e.preventDefault();
    setStoreActionError(null);
    setStoreActionSuccess(null);

    const cleanId = newStoreId.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '-');
    const cleanName = newStoreName.trim();
    const cleanLoc = newStoreLocation.trim();

    if (!cleanId || !cleanName) {
      setStoreActionError('Store ID and Store Name are required.');
      return;
    }

    if (stores.some((s) => s.storeId.toUpperCase() === cleanId)) {
      setStoreActionError(`Store with ID "${cleanId}" already exists. Please choose a unique Store ID.`);
      return;
    }

    setIsStoreSubmitting(true);
    try {
      const updated = await addStore({
        storeId: cleanId,
        name: cleanName,
        location: cleanLoc || 'Retail Floor',
      });
      if (onStoresUpdated) onStoresUpdated(updated);
      setStoreActionSuccess(`Store "${cleanName}" (${cleanId}) successfully added.`);
      setNewStoreId('');
      setNewStoreName('');
      setNewStoreLocation('');
      setIsAddStoreModalOpen(false);
    } catch (err: any) {
      setStoreActionError(`Failed to add store: ${err.message || 'Please check connection'}`);
    } finally {
      setIsStoreSubmitting(false);
    }
  };

  const handleConfirmDeleteStore = async () => {
    if (!storeToDelete) return;
    setIsStoreSubmitting(true);
    setStoreActionError(null);
    setStoreActionSuccess(null);

    try {
      const targetId = storeToDelete.storeId;
      const targetName = storeToDelete.name;
      const updated = await deleteStore(targetId);
      if (onStoresUpdated) onStoresUpdated(updated);
      setStoreActionSuccess(`Store "${targetName}" (${targetId}) has been deleted.`);
      setStoreToDelete(null);
    } catch (err: any) {
      setStoreActionError(`Failed to delete store: ${err.message || 'Please check connection'}`);
    } finally {
      setIsStoreSubmitting(false);
    }
  };

  const handleSaveEditStore = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!storeToEdit) return;
    const cleanName = editStoreName.trim();
    const cleanLoc = editStoreLocation.trim();
    if (!cleanName) {
      setStoreActionError('Store Name cannot be empty.');
      return;
    }

    setIsStoreSubmitting(true);
    try {
      const updated = await updateStore({
        storeId: storeToEdit.storeId,
        name: cleanName,
        location: cleanLoc,
      });
      if (onStoresUpdated) onStoresUpdated(updated);
      setStoreActionSuccess(`Store "${cleanName}" updated.`);
      setStoreToEdit(null);
    } catch (err: any) {
      setStoreActionError(`Failed to update store: ${err.message}`);
    } finally {
      setIsStoreSubmitting(false);
    }
  };

  const filteredStores = useMemo(() => {
    if (!storeSearchQuery.trim()) return stores;
    const q = storeSearchQuery.toLowerCase();
    return stores.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.storeId.toLowerCase().includes(q) ||
        (s.location || '').toLowerCase().includes(q)
    );
  }, [stores, storeSearchQuery]);

  // Download Sample Masterlist Template with format: Item No., Item Description, Item Group, UoM
  const handleDownloadTemplate = (format: 'xlsx' | 'csv') => {
    const templateData = [
      {
        'Item No.': 'APP-TEE-BLK-M',
        'Item Description': 'Cotton Crewneck T-Shirt - Black / Medium',
        'Item Group': 'Apparel',
        'UoM': 'pcs',
      },
      {
        'Item No.': 'APP-HDY-GRY-L',
        'Item Description': 'Heavyweight Fleece Hoodie - Grey / L',
        'Item Group': 'Apparel',
        'UoM': 'pcs',
      },
      {
        'Item No.': 'ELC-CHG-USBC',
        'Item Description': '65W GaN Dual USB-C Fast Charger',
        'Item Group': 'Electronics',
        'UoM': 'pcs',
      },
      {
        'Item No.': 'BEV-COF-DRK',
        'Item Description': 'Artisan Dark Roast Whole Bean Coffee',
        'Item Group': 'Grocery',
        'UoM': 'bag',
      },
      {
        'Item No.': 'HME-BTL-32OZ',
        'Item Description': 'Insulated Stainless Steel Bottle 32oz',
        'Item Group': 'Home & Living',
        'UoM': 'pcs',
      },
    ];

    const ws = XLSX.utils.json_to_sheet(templateData);
    ws['!cols'] = [
      { wch: 20 }, // Item No.
      { wch: 45 }, // Item Description
      { wch: 20 }, // Item Group
      { wch: 12 }, // UoM
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Item_Masterlist');

    if (format === 'xlsx') {
      XLSX.writeFile(wb, 'Item_Masterlist_Template.xlsx');
    } else {
      XLSX.writeFile(wb, 'Item_Masterlist_Template.csv', { bookType: 'csv' });
    }
  };

  // --- COUNT DATA EXTRACTION HANDLERS ---
  const filteredCountsForExtraction = useMemo(() => {
    return counts.filter((c) => {
      if (c.status === 'voided') return false;
      // Store filter
      if (selectedStore !== 'all') {
        const matchesStore = c.storeId === selectedStore || c.store.toLowerCase().includes(selectedStore.toLowerCase());
        if (!matchesStore) return false;
      }

      // Location filter
      if (selectedLocation !== 'all') {
        if (!c.location || !c.location.toLowerCase().includes(selectedLocation.toLowerCase())) {
          return false;
        }
      }

      // Date range filter
      if (selectedDateRange !== 'all') {
        const todayStr = new Date().toISOString().split('T')[0];
        const yesterdayDate = new Date();
        yesterdayDate.setDate(yesterdayDate.getDate() - 1);
        const yesterdayStr = yesterdayDate.toISOString().split('T')[0];

        if (selectedDateRange === 'today' && c.date !== todayStr) return false;
        if (selectedDateRange === 'yesterday' && c.date !== yesterdayStr) return false;

        if (selectedDateRange === '7days') {
          const sevenDaysAgo = new Date();
          sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
          const limitStr = sevenDaysAgo.toISOString().split('T')[0];
          if (c.date < limitStr) return false;
        }

        if (selectedDateRange === '30days') {
          const thirtyDaysAgo = new Date();
          thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
          const limitStr = thirtyDaysAgo.toISOString().split('T')[0];
          if (c.date < limitStr) return false;
        }
      }

      return true;
    });
  }, [counts, selectedStore, selectedLocation, selectedDateRange]);

  // Reconciliation Variance Analysis between Masterlist and Counted Items
  const reconciliationData: CountVarianceItem[] = useMemo(() => {
    // 1. Group counts by SKU
    const countMap = new Map<string, { qty: number; stores: Set<string>; locations: Set<string> }>();
    filteredCountsForExtraction.forEach((c) => {
      const key = c.sku.toLowerCase();
      const existing = countMap.get(key) || { qty: 0, stores: new Set(), locations: new Set() };
      existing.qty += c.countedQuantity;
      if (c.store) existing.stores.add(c.store);
      if (c.location) existing.locations.add(c.location);
      countMap.set(key, existing);
    });

    // 2. Iterate through catalog items
    const varianceItems: CountVarianceItem[] = [];
    const visitedSkus = new Set<string>();

    catalog.forEach((prod) => {
      const key = prod.sku.toLowerCase();
      visitedSkus.add(key);
      const countInfo = countMap.get(key);
      const countedQuantity = countInfo ? countInfo.qty : 0;
      const systemStock = prod.systemStock ?? 0;
      const variance = countedQuantity - systemStock;

      let status: 'matched' | 'over' | 'under' | 'uncounted' = 'matched';
      if (!countInfo || countedQuantity === 0) {
        status = 'uncounted';
      } else if (variance > 0) {
        status = 'over';
      } else if (variance < 0) {
        status = 'under';
      }

      varianceItems.push({
        sku: prod.sku,
        barcode: prod.barcode,
        description: prod.description,
        category: prod.category || 'General',
        systemStock,
        countedQuantity,
        variance,
        status,
        storesFound: countInfo ? Array.from(countInfo.stores) : [],
        locationsFound: countInfo ? Array.from(countInfo.locations) : [],
      });
    });

    // 3. Include any items counted that were not in the official catalog
    countMap.forEach((info, key) => {
      if (!visitedSkus.has(key)) {
        const sampleCount = filteredCountsForExtraction.find((c) => c.sku.toLowerCase() === key);
        varianceItems.push({
          sku: sampleCount?.sku || key.toUpperCase(),
          barcode: sampleCount?.barcode || '',
          description: sampleCount?.itemDescription || 'Uncataloged Item',
          category: 'Uncataloged',
          systemStock: 0,
          countedQuantity: info.qty,
          variance: info.qty,
          status: 'over',
          storesFound: Array.from(info.stores),
          locationsFound: Array.from(info.locations),
        });
      }
    });

    return varianceItems;
  }, [catalog, filteredCountsForExtraction]);

  // Export to Excel (.xlsx)
  const handleExtractToExcel = () => {
    if (filteredCountsForExtraction.length === 0) {
      alert('No counted records found matching the selected extraction criteria.');
      return;
    }

    setIsExporting(true);
    setExportNotice(null);

    try {
      const wb = XLSX.utils.book_new();

      // 1. Sheet 1: Detailed Physical Counts Audit
      const detailedData = filteredCountsForExtraction.map((c, idx) => ({
        '#': idx + 1,
        'Count ID': c.id,
        Date: c.date,
        Time: c.time,
        Store: c.store,
        'Store ID': c.storeId,
        'Shelf/Bin Location': c.location || 'Not Specified',
        SKU: c.sku,
        Barcode: c.barcode,
        'Item Description': c.itemDescription,
        'Counted Quantity': c.countedQuantity,
        Classification: c.condition || 'Good',
        Remarks: c.remarks || '',
        'Counter Username': c.username,
        'User ID': c.userId,
      }));

      const wsDetailed = XLSX.utils.json_to_sheet(detailedData);
      wsDetailed['!cols'] = [
        { wch: 6 },
        { wch: 22 },
        { wch: 12 },
        { wch: 10 },
        { wch: 22 },
        { wch: 12 },
        { wch: 20 },
        { wch: 18 },
        { wch: 16 },
        { wch: 38 },
        { wch: 16 },
        { wch: 14 },
        { wch: 26 },
        { wch: 18 },
        { wch: 28 },
      ];
      XLSX.utils.book_append_sheet(wb, wsDetailed, 'Detailed Counts');

      // 2. Sheet 2: Masterlist Reconciliation & Variance
      const varianceExportData = reconciliationData.map((v, idx) => ({
        '#': idx + 1,
        SKU: v.sku,
        Barcode: v.barcode,
        Description: v.description,
        Category: v.category,
        'System Stock': v.systemStock,
        'Physical Counted': v.countedQuantity,
        'Variance (+/-)': v.variance,
        'Variance Status': v.status.toUpperCase(),
        'Locations Found': v.locationsFound.join(', ') || 'N/A',
        'Stores Found': v.storesFound.join(', ') || 'N/A',
      }));

      const wsVariance = XLSX.utils.json_to_sheet(varianceExportData);
      wsVariance['!cols'] = [
        { wch: 6 },
        { wch: 18 },
        { wch: 16 },
        { wch: 36 },
        { wch: 16 },
        { wch: 14 },
        { wch: 16 },
        { wch: 14 },
        { wch: 16 },
        { wch: 26 },
        { wch: 26 },
      ];
      XLSX.utils.book_append_sheet(wb, wsVariance, 'Masterlist Reconciliation');

      // 3. Sheet 3: Store & Location Summary
      const locSummaryMap = new Map<string, { totalUnits: number; countRecords: number }>();
      filteredCountsForExtraction.forEach((c) => {
        const locKey = `${c.store} — ${c.location || 'General Floor'}`;
        const prev = locSummaryMap.get(locKey) || { totalUnits: 0, countRecords: 0 };
        prev.totalUnits += c.countedQuantity;
        prev.countRecords += 1;
        locSummaryMap.set(locKey, prev);
      });

      const locSummaryData = Array.from(locSummaryMap.entries()).map(([key, data]) => ({
        'Store & Location': key,
        'Total Physical Units': data.totalUnits,
        'Number of Counts': data.countRecords,
      }));

      const wsLocSummary = XLSX.utils.json_to_sheet(locSummaryData);
      wsLocSummary['!cols'] = [{ wch: 36 }, { wch: 20 }, { wch: 18 }];
      XLSX.utils.book_append_sheet(wb, wsLocSummary, 'Location Summary');

      // 4. Download file
      const dateTag = new Date().toISOString().split('T')[0];
      const filename = `Inventory_Count_Extraction_${dateTag}.xlsx`;
      XLSX.writeFile(wb, filename);

      setExportNotice(`Extracted ${filteredCountsForExtraction.length} records into ${filename}`);
    } catch (err: any) {
      console.error('Extraction error:', err);
      alert('Could not export file. Please try again.');
    } finally {
      setIsExporting(false);
    }
  };

  // Export to CSV
  const handleExtractToCSV = () => {
    if (filteredCountsForExtraction.length === 0) {
      alert('No counted records found matching the selected extraction criteria.');
      return;
    }

    try {
      const csvData = filteredCountsForExtraction.map((c) => ({
        Date: c.date,
        Time: c.time,
        Store: c.store,
        StoreID: c.storeId,
        Location: c.location || '',
        SKU: c.sku,
        Barcode: c.barcode,
        Description: c.itemDescription,
        CountedQuantity: c.countedQuantity,
        Classification: c.condition || 'Good',
        Remarks: c.remarks || '',
        Username: c.username,
        UserID: c.userId,
      }));

      const ws = XLSX.utils.json_to_sheet(csvData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Counts');

      const dateTag = new Date().toISOString().split('T')[0];
      const filename = `Inventory_Counts_${dateTag}.csv`;
      XLSX.writeFile(wb, filename, { bookType: 'csv' });
      setExportNotice(`Extracted CSV feed into ${filename}`);
    } catch (err: any) {
      console.error('CSV export error:', err);
      alert('Failed to generate CSV file.');
    }
  };

  // Filtered Catalog List for Explorer view
  const filteredCatalog = useMemo(() => {
    return catalog.filter((p) => {
      if (selectedCatalogCategory !== 'all' && p.category !== selectedCatalogCategory) {
        return false;
      }
      if (catalogSearch.trim()) {
        const q = catalogSearch.toLowerCase();
        return (
          p.sku.toLowerCase().includes(q) ||
          p.barcode.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [catalog, catalogSearch, selectedCatalogCategory]);

  const uniqueCategories = useMemo(() => {
    const set = new Set<string>();
    catalog.forEach((p) => {
      if (p.category) set.add(p.category);
    });
    return Array.from(set);
  }, [catalog]);

  // Unique locations from counts
  const uniqueCountLocations = useMemo(() => {
    const set = new Set<string>();
    counts.forEach((c) => {
      if (c.location) set.add(c.location);
    });
    return Array.from(set);
  }, [counts]);

  return (
    <div className="w-full max-w-4xl mx-auto pb-24 pt-2 px-3.5 space-y-4">
      {/* Top Admin Header Banner */}
      <div className="rounded-2xl bg-gradient-to-r from-slate-900 via-purple-950/40 to-slate-900 border border-purple-500/30 p-4 shadow-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-purple-600/20 text-purple-400 border border-purple-500/40 shadow-inner">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-purple-500/20 text-purple-300 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider">
                Admin Console
              </span>
              <span className="text-[11px] text-slate-400">Restricted Privileges</span>
            </div>
            <h2 className="text-lg font-black text-white mt-0.5">
              Masterlist Upload & Count Extraction
            </h2>
          </div>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="rounded-xl bg-slate-950/80 border border-slate-800 px-3 py-1.5 text-center flex-1 sm:flex-none">
            <span className="text-[10px] text-slate-400 uppercase font-semibold block">Masterlist</span>
            <span className="text-sm font-black text-purple-400 font-mono">{catalog.length} SKUs</span>
          </div>
          <div className="rounded-xl bg-slate-950/80 border border-slate-800 px-3 py-1.5 text-center flex-1 sm:flex-none">
            <span className="text-[10px] text-slate-400 uppercase font-semibold block">Recorded Counts</span>
            <span className="text-sm font-black text-emerald-400 font-mono">{counts.length}</span>
          </div>
          <div className="rounded-xl bg-slate-950/80 border border-slate-800 px-3 py-1.5 text-center flex-1 sm:flex-none">
            <span className="text-[10px] text-slate-400 uppercase font-semibold block">Retail Stores</span>
            <span className="text-sm font-black text-blue-400 font-mono">{stores.length}</span>
          </div>
          <div className="rounded-xl bg-slate-950/80 border border-slate-800 px-3 py-1.5 text-center flex-1 sm:flex-none">
            <span className="text-[10px] text-slate-400 uppercase font-semibold block">Managed Users</span>
            <span className="text-sm font-black text-amber-400 font-mono">{managedUsers.length}</span>
          </div>
        </div>
      </div>

      {/* Main Workspace Navigation Switcher (4 Tabs) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 p-1.5 rounded-2xl bg-slate-900 border border-slate-800 text-xs font-bold gap-1">
        <button
          onClick={() => setActiveTab('upload_masterlist')}
          className={`py-2.5 px-1.5 rounded-xl transition flex items-center justify-center gap-1.5 ${
            activeTab === 'upload_masterlist'
              ? 'bg-purple-600 text-white shadow-lg shadow-purple-950'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Upload className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">Masterlist</span>
        </button>

        <button
          onClick={() => setActiveTab('extract_counts')}
          className={`py-2.5 px-1.5 rounded-xl transition flex items-center justify-center gap-1.5 ${
            activeTab === 'extract_counts'
              ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-950'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Download className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">Extract Counts</span>
        </button>

        <button
          onClick={() => setActiveTab('manage_stores')}
          className={`py-2.5 px-1.5 rounded-xl transition flex items-center justify-center gap-1.5 ${
            activeTab === 'manage_stores'
              ? 'bg-blue-600 text-white shadow-lg shadow-blue-950'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Building2 className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">Stores ({stores.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('manage_users')}
          className={`py-2.5 px-1.5 rounded-xl transition flex items-center justify-center gap-1.5 ${
            activeTab === 'manage_users'
              ? 'bg-amber-600 text-white shadow-lg shadow-amber-950'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Users className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">Users ({managedUsers.length})</span>
        </button>
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: UPLOAD ITEM MASTERLIST */}
      {/* ========================================================================= */}
      {activeTab === 'upload_masterlist' && (
        <div className="space-y-4 animate-in fade-in duration-150">
          {/* Instructions and Download Template Bar */}
          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <FileCheck className="w-4 h-4 text-purple-400" />
                <span>Upload New Master Product List</span>
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed max-w-xl">
                Upload an Excel (<code className="text-purple-300">.xlsx, .xls</code>) or <code className="text-purple-300">.csv</code> file with required format:
                <strong className="text-purple-300"> Item No., Item Description, Item Group, UoM</strong>.
                Each Item No. is automatically recognized for instant barcode scanning and physical inventory counts.
              </p>
            </div>

            <div className="flex items-center gap-2 w-full md:w-auto shrink-0">
              <button
                onClick={() => handleDownloadTemplate('xlsx')}
                className="flex-1 md:flex-none h-10 px-3 rounded-xl bg-slate-950 border border-slate-700/80 hover:border-purple-400 text-slate-200 text-xs font-semibold flex items-center justify-center gap-1.5 transition active:scale-95"
                title="Download formatted sample Excel template with headers: Item No., Item Description, Item Group, UoM"
              >
                <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
                <span>Excel Template</span>
              </button>

              <button
                onClick={() => handleDownloadTemplate('csv')}
                className="flex-1 md:flex-none h-10 px-3 rounded-xl bg-slate-950 border border-slate-700/80 hover:border-purple-400 text-slate-200 text-xs font-semibold flex items-center justify-center gap-1.5 transition active:scale-95"
                title="Download formatted sample CSV template with headers: Item No., Item Description, Item Group, UoM"
              >
                <FileText className="w-4 h-4 text-amber-400" />
                <span>CSV Template</span>
              </button>
            </div>
          </div>

          {/* Success Banner */}
          {importSuccessMessage && (
            <div className="rounded-2xl bg-emerald-500/15 border border-emerald-500/30 p-4 text-xs font-semibold text-emerald-300 flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
              <span>{importSuccessMessage}</span>
            </div>
          )}

          {/* File Upload Drop Zone */}
          <div
            onDragEnter={(e) => { e.preventDefault(); setDragActive(true); }}
            onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
            onDragLeave={(e) => { e.preventDefault(); setDragActive(false); }}
            onDrop={handleFileDrop}
            className={`rounded-2xl border-2 border-dashed p-6 text-center transition flex flex-col items-center justify-center gap-3 cursor-pointer ${
              dragActive
                ? 'border-purple-400 bg-purple-500/10'
                : 'border-slate-700/80 bg-slate-900/60 hover:border-slate-600 hover:bg-slate-900'
            }`}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx, .xls, .csv"
              onChange={handleFileChange}
              className="hidden"
            />

            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-purple-600/20 text-purple-400 border border-purple-500/30">
              <Upload className="w-7 h-7" />
            </div>

            <div>
              <div className="text-sm font-bold text-white">
                {fileName ? fileName : 'Choose or drag & drop item masterlist file'}
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Upload format: <strong className="text-slate-200">Item No. | Item Description | Item Group | UoM</strong>
              </p>
            </div>

            <button
              type="button"
              className="mt-1 h-9 px-4 rounded-xl bg-purple-600 hover:bg-purple-500 text-xs font-bold text-white shadow-md active:scale-95 transition"
            >
              Browse Files (.xlsx / .csv)
            </button>
          </div>

          {/* Parse Errors List */}
          {parseErrors.length > 0 && (
            <div className="rounded-2xl bg-rose-500/15 border border-rose-500/30 p-4 space-y-1 text-xs text-rose-300">
              <div className="font-bold flex items-center gap-1.5 text-rose-400">
                <AlertTriangle className="w-4 h-4" />
                <span>Notice while reading masterlist:</span>
              </div>
              <ul className="list-disc pl-5 space-y-0.5 text-[11px] text-rose-200">
                {parseErrors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Parsed Items Preview & Import Confirmation */}
          {parsedItems.length > 0 && (
            <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4 shadow-xl space-y-4 animate-in fade-in duration-100">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
                <div>
                  <h4 className="text-sm font-bold text-white flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span>Parsed {parsedItems.length} Products Successfully</span>
                  </h4>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Review preview below before applying to inventory catalog
                  </p>
                </div>

                {/* Import Mode Options */}
                <div className="flex items-center gap-2">
                  <div className="flex items-center p-1 bg-slate-950 rounded-xl border border-slate-800 text-[11px] font-semibold">
                    <button
                      type="button"
                      onClick={() => setImportMode('merge')}
                      className={`px-3 py-1.5 rounded-lg transition ${
                        importMode === 'merge' ? 'bg-purple-600 text-white font-bold' : 'text-slate-400'
                      }`}
                    >
                      Merge & Upsert
                    </button>
                    <button
                      type="button"
                      onClick={() => setImportMode('replace')}
                      className={`px-3 py-1.5 rounded-lg transition ${
                        importMode === 'replace' ? 'bg-rose-600 text-white font-bold' : 'text-slate-400'
                      }`}
                      title="Deletes existing non-matching products and replaces with uploaded masterlist"
                    >
                      Replace Masterlist
                    </button>
                  </div>

                  <button
                    onClick={handleConfirmImport}
                    disabled={isImporting}
                    className="h-10 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 font-bold text-xs text-white shadow-lg active:scale-95 transition flex items-center gap-2 disabled:opacity-50"
                  >
                    <span>{isImporting ? 'Importing Products...' : `Confirm & Import (${parsedItems.length})`}</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Preview Table of First 10 Items */}
              <div className="overflow-x-auto rounded-xl border border-slate-800">
                <table className="w-full text-left text-xs text-slate-300">
                  <thead className="bg-slate-950 text-slate-400 uppercase text-[10px] tracking-wider font-semibold border-b border-slate-800">
                    <tr>
                      <th className="px-3 py-2">#</th>
                      <th className="px-3 py-2">Item No.</th>
                      <th className="px-3 py-2">Item Description</th>
                      <th className="px-3 py-2">Item Group</th>
                      <th className="px-3 py-2">UoM</th>
                      <th className="px-3 py-2 text-right">System Stock</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80 bg-slate-900/60 font-mono text-[11px]">
                    {parsedItems.slice(0, 10).map((item, idx) => (
                      <tr key={idx} className="hover:bg-slate-800/40">
                        <td className="px-3 py-2 text-slate-500">{idx + 1}</td>
                        <td className="px-3 py-2 font-bold text-purple-300">{item.sku}</td>
                        <td className="px-3 py-2 font-sans text-white truncate max-w-[240px]">{item.description}</td>
                        <td className="px-3 py-2 font-sans text-slate-300">{item.category}</td>
                        <td className="px-3 py-2 font-sans text-slate-300">{item.unit}</td>
                        <td className="px-3 py-2 text-right text-emerald-400 font-bold">{item.systemStock ?? 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {parsedItems.length > 10 && (
                <div className="text-center text-[11px] text-slate-500">
                  Showing first 10 of {parsedItems.length} items. All items will be imported upon confirmation.
                </div>
              )}
            </div>
          )}

          {/* Active Masterlist Catalog Explorer */}
          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4 shadow-sm space-y-3">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
              <div>
                <h4 className="text-sm font-bold text-white flex items-center gap-2">
                  <Database className="w-4 h-4 text-purple-400" />
                  <span>Current Active Masterlist ({catalog.length} SKUs)</span>
                </h4>
                <p className="text-xs text-slate-400">
                  Available for in-store barcode scanning and physical inventory counts
                </p>
              </div>

              {/* Search & Category Filter */}
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <div className="relative flex-1 sm:w-48">
                  <input
                    type="text"
                    value={catalogSearch}
                    onChange={(e) => setCatalogSearch(e.target.value)}
                    placeholder="Search SKU or tag..."
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 pl-8 text-xs text-white placeholder-slate-500 focus:border-purple-400 focus:outline-none"
                  />
                  <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-slate-400" />
                </div>

                <select
                  value={selectedCatalogCategory}
                  onChange={(e) => setSelectedCatalogCategory(e.target.value)}
                  className="rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white focus:border-purple-400 focus:outline-none"
                >
                  <option value="all">All Categories</option>
                  {uniqueCategories.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Catalog Table */}
            <div className="overflow-x-auto rounded-xl border border-slate-800 max-h-72 overflow-y-auto">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="sticky top-0 bg-slate-950 text-slate-400 uppercase text-[10px] tracking-wider font-semibold border-b border-slate-800">
                  <tr>
                    <th className="px-3 py-2">Item No.</th>
                    <th className="px-3 py-2">Item Description</th>
                    <th className="px-3 py-2">Item Group</th>
                    <th className="px-3 py-2">UoM</th>
                    <th className="px-3 py-2">Barcode</th>
                    <th className="px-3 py-2 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80 bg-slate-900/40 font-mono text-[11px]">
                  {filteredCatalog.map((prod) => (
                    <tr key={prod.id} className="hover:bg-slate-800/30">
                      <td className="px-3 py-2 font-bold text-white">{prod.sku}</td>
                      <td className="px-3 py-2 font-sans text-slate-200 truncate max-w-[220px]">{prod.description}</td>
                      <td className="px-3 py-2 font-sans text-slate-400">{prod.category || 'General'}</td>
                      <td className="px-3 py-2 font-sans text-slate-400">{prod.unit || 'pcs'}</td>
                      <td className="px-3 py-2 text-slate-400 font-mono text-[10px]">{prod.barcode}</td>
                      <td className="px-3 py-2 text-center">
                        <button
                          onClick={async () => {
                            if (confirm(`Remove item ${prod.sku} from catalog?`)) {
                              await deleteProductFromCatalog(prod.id);
                              onCatalogUpdated();
                            }
                          }}
                          className="p-1 text-slate-500 hover:text-rose-400 transition"
                          title="Delete product"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filteredCatalog.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-xs text-slate-500">
                        No catalog items match your search filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: EXTRACT COUNTED ITEMS (RESTRICTED TO ADMIN) */}
      {/* ========================================================================= */}
      {activeTab === 'extract_counts' && (
        <div className="space-y-4 animate-in fade-in duration-150">
          {/* Extraction Control Header */}
          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="rounded-md bg-emerald-500/20 text-emerald-300 px-2 py-0.5 text-[10px] font-black uppercase">
                  Extraction Engine
                </span>
                <h3 className="text-sm font-bold text-white">Extract Counted Stock Records</h3>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed max-w-xl">
                Extract physical stock counts recorded by store associates. Export includes detailed count entries,
                reconciliation variance against uploaded masterlist, and store/location summaries.
              </p>
            </div>

            {/* Direct Export Triggers */}
            <div className="flex items-center gap-2 w-full md:w-auto shrink-0">
              <button
                onClick={handleExtractToExcel}
                disabled={isExporting || filteredCountsForExtraction.length === 0}
                className="flex-1 md:flex-none h-11 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 font-bold text-xs text-white shadow-xl shadow-emerald-950 active:scale-95 transition flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <FileSpreadsheet className="w-4 h-4" />
                <span>{isExporting ? 'Generating Excel...' : 'Extract to Excel (.xlsx)'}</span>
              </button>

              <button
                onClick={handleExtractToCSV}
                disabled={filteredCountsForExtraction.length === 0}
                className="flex-1 md:flex-none h-11 px-4 rounded-xl bg-slate-950 border border-slate-700 hover:border-emerald-400 text-slate-200 font-bold text-xs shadow-md active:scale-95 transition flex items-center justify-center gap-2 disabled:opacity-50"
                title="Extract clean comma-separated values feed"
              >
                <FileText className="w-4 h-4 text-emerald-400" />
                <span>Extract CSV</span>
              </button>
            </div>
          </div>

          {/* Export Notice Message */}
          {exportNotice && (
            <div className="rounded-2xl bg-emerald-500/15 border border-emerald-500/30 p-3 text-xs font-semibold text-emerald-300 flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{exportNotice}</span>
            </div>
          )}

          {/* Extraction Filter Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {/* Store Filter */}
            <div className="rounded-xl bg-slate-900 border border-slate-800 p-3 space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>Filter Store</span>
              </label>
              <select
                value={selectedStore}
                onChange={(e) => setSelectedStore(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white focus:border-emerald-400 focus:outline-none"
              >
                <option value="all">All Retail Stores</option>
                {stores.map((s) => (
                  <option key={s.storeId} value={s.storeId}>
                    {s.name} ({s.storeId})
                  </option>
                ))}
              </select>
            </div>

            {/* Date Range Filter */}
            <div className="rounded-xl bg-slate-900 border border-slate-800 p-3 space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-emerald-400" />
                <span>Date Range</span>
              </label>
              <select
                value={selectedDateRange}
                onChange={(e) => setSelectedDateRange(e.target.value as any)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white focus:border-emerald-400 focus:outline-none"
              >
                <option value="all">All Dates</option>
                <option value="today">Today Only</option>
                <option value="yesterday">Yesterday</option>
                <option value="7days">Past 7 Days</option>
                <option value="30days">Past 30 Days</option>
              </select>
            </div>

            {/* Location Filter */}
            <div className="rounded-xl bg-slate-900 border border-slate-800 p-3 space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-emerald-400" />
                <span>Shelf / Location</span>
              </label>
              <select
                value={selectedLocation}
                onChange={(e) => setSelectedLocation(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white focus:border-emerald-400 focus:outline-none"
              >
                <option value="all">All Locations</option>
                {uniqueCountLocations.map((loc) => (
                  <option key={loc} value={loc}>{loc}</option>
                ))}
              </select>
            </div>
          </div>

          {/* KPI Summary of Filtered Extract */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
            <div className="rounded-2xl bg-slate-900 border border-slate-800 p-3.5">
              <span className="text-[10px] text-slate-400 uppercase font-semibold block">Records to Extract</span>
              <span className="text-xl font-black text-white font-mono mt-0.5 block">
                {filteredCountsForExtraction.length}
              </span>
            </div>

            <div className="rounded-2xl bg-slate-900 border border-slate-800 p-3.5">
              <span className="text-[10px] text-slate-400 uppercase font-semibold block">Total Units Counted</span>
              <span className="text-xl font-black text-emerald-400 font-mono mt-0.5 block">
                {filteredCountsForExtraction.reduce((acc, c) => acc + c.countedQuantity, 0).toLocaleString()}
              </span>
            </div>

            <div className="rounded-2xl bg-slate-900 border border-slate-800 p-3.5">
              <span className="text-[10px] text-slate-400 uppercase font-semibold block">Masterlist Reconciled</span>
              <span className="text-xl font-black text-purple-400 font-mono mt-0.5 block">
                {reconciliationData.filter((r) => r.status === 'matched').length} / {reconciliationData.length} SKUs
              </span>
            </div>

            <div className="rounded-2xl bg-slate-900 border border-slate-800 p-3.5">
              <span className="text-[10px] text-slate-400 uppercase font-semibold block">Discrepancies</span>
              <span className="text-xl font-black text-amber-400 font-mono mt-0.5 block">
                {reconciliationData.filter((r) => r.status === 'over' || r.status === 'under').length} SKUs
              </span>
            </div>
          </div>

          {/* Masterlist Reconciliation Preview */}
          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-bold text-white">Physical Count vs. Masterlist Variance</h4>
                <p className="text-xs text-slate-400">
                  Real-time variance calculation against uploaded system stock
                </p>
              </div>
              <span className="text-[10px] text-slate-500 font-mono">
                {reconciliationData.length} SKUs Reconciled
              </span>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-800 max-h-72 overflow-y-auto">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="sticky top-0 bg-slate-950 text-slate-400 uppercase text-[10px] tracking-wider font-semibold border-b border-slate-800">
                  <tr>
                    <th className="px-3 py-2">SKU</th>
                    <th className="px-3 py-2">Description</th>
                    <th className="px-3 py-2 text-right">System Stock</th>
                    <th className="px-3 py-2 text-right">Physical Count</th>
                    <th className="px-3 py-2 text-right">Variance</th>
                    <th className="px-3 py-2 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80 bg-slate-900/40 font-mono text-[11px]">
                  {reconciliationData.slice(0, 15).map((row, idx) => (
                    <tr key={idx} className="hover:bg-slate-800/30">
                      <td className="px-3 py-2 font-bold text-purple-300">{row.sku}</td>
                      <td className="px-3 py-2 font-sans text-slate-200 truncate max-w-[200px]">{row.description}</td>
                      <td className="px-3 py-2 text-right text-slate-400">{row.systemStock}</td>
                      <td className="px-3 py-2 text-right text-white font-bold">{row.countedQuantity}</td>
                      <td className={`px-3 py-2 text-right font-bold ${
                        row.variance === 0
                          ? 'text-slate-400'
                          : row.variance > 0
                          ? 'text-emerald-400'
                          : 'text-rose-400'
                      }`}>
                        {row.variance > 0 ? `+${row.variance}` : row.variance}
                      </td>
                      <td className="px-3 py-2 text-center font-sans">
                        <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                          row.status === 'matched'
                            ? 'bg-emerald-500/15 text-emerald-400'
                            : row.status === 'over'
                            ? 'bg-blue-500/15 text-blue-400'
                            : row.status === 'under'
                            ? 'bg-amber-500/15 text-amber-400'
                            : 'bg-slate-800 text-slate-400'
                        }`}>
                          {row.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Quick Extraction Action Footer */}
            <div className="pt-2 flex items-center justify-between text-xs text-slate-400">
              <span>Showing first 15 SKUs. Full variance analysis will be included in Sheet 2 of the Excel extract.</span>
              <button
                onClick={handleExtractToExcel}
                className="text-emerald-400 hover:text-emerald-300 font-bold flex items-center gap-1"
              >
                <span>Extract All Records Now</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: MANAGE RETAIL STORES (ADMIN ONLY) */}
      {/* ========================================================================= */}
      {activeTab === 'manage_stores' && (
        <div className="space-y-4 animate-in fade-in duration-150">
          {/* Top Store Action Banner */}
          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="rounded-md bg-blue-500/20 text-blue-300 px-2 py-0.5 text-[10px] font-black uppercase">
                  Store Management
                </span>
                <h3 className="text-sm font-bold text-white">Retail Store Locations & Branches</h3>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed max-w-xl">
                Add new retail store locations, modify branch names or addresses, and decommission closed stores. Changes immediately update the store selector for inventory counters.
              </p>
            </div>

            <button
              onClick={() => {
                setStoreActionError(null);
                setNewStoreId(`ST-${100 + stores.length + 1}`);
                setNewStoreName('');
                setNewStoreLocation('');
                setIsAddStoreModalOpen(true);
              }}
              className="w-full md:w-auto h-11 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 font-bold text-xs text-white shadow-xl shadow-blue-950 active:scale-95 transition flex items-center justify-center gap-2"
            >
              <Plus className="w-4 h-4" />
              <span>Add New Store Branch</span>
            </button>
          </div>

          {/* Action Success / Error Feedback */}
          {storeActionSuccess && (
            <div className="rounded-2xl bg-emerald-500/15 border border-emerald-500/30 p-3.5 text-xs font-semibold text-emerald-300 flex items-center justify-between gap-2 animate-in fade-in">
              <div className="flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>{storeActionSuccess}</span>
              </div>
              <button
                onClick={() => setStoreActionSuccess(null)}
                className="p-1 text-slate-400 hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {storeActionError && (
            <div className="rounded-2xl bg-rose-500/15 border border-rose-500/30 p-3.5 text-xs font-semibold text-rose-300 flex items-center justify-between gap-2 animate-in fade-in">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>{storeActionError}</span>
              </div>
              <button
                onClick={() => setStoreActionError(null)}
                className="p-1 text-slate-400 hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Search Stores Bar */}
          <div className="flex items-center justify-between gap-2">
            <div className="relative flex-1">
              <input
                type="text"
                value={storeSearchQuery}
                onChange={(e) => setStoreSearchQuery(e.target.value)}
                placeholder="Search store branch by name, code, or city..."
                className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-2.5 pl-9 text-xs text-white placeholder-slate-500 focus:border-blue-400 focus:outline-none"
              />
              <Search className="absolute left-3 top-3 w-3.5 h-3.5 text-slate-400" />
            </div>
            <div className="text-xs text-slate-400 font-mono shrink-0 px-1">
              {filteredStores.length} of {stores.length} Stores
            </div>
          </div>

          {/* Stores Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {filteredStores.map((st) => {
              const storeCountTotal = counts.filter(
                (c) => c.storeId === st.storeId || c.store.toLowerCase() === st.name.toLowerCase()
              ).length;
              const storeUnitsTotal = counts
                .filter((c) => c.storeId === st.storeId || c.store.toLowerCase() === st.name.toLowerCase())
                .reduce((acc, c) => acc + (Number(c.countedQuantity) || 0), 0);

              return (
                <div
                  key={st.storeId}
                  className="rounded-2xl bg-slate-900 border border-slate-800 p-4 shadow-sm hover:border-slate-700 transition space-y-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2.5">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600/20 text-blue-400 border border-blue-500/30">
                        <Building2 className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="rounded-md bg-blue-500/20 text-blue-300 px-2 py-0.5 text-[10px] font-black font-mono uppercase">
                            {st.storeId}
                          </span>
                        </div>
                        <h4 className="text-sm font-bold text-white mt-1">{st.name}</h4>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => {
                          setStoreToEdit(st);
                          setEditStoreName(st.name);
                          setEditStoreLocation(st.location);
                        }}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
                        title="Edit Store Branch"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setStoreToDelete(st)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition"
                        title="Delete Store Branch"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-xs text-slate-400 bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/80">
                    <MapPin className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span className="truncate">{st.location || 'Location address not specified'}</span>
                  </div>

                  <div className="flex items-center justify-between pt-1 border-t border-slate-800 text-[11px] text-slate-400 font-mono">
                    <span>{storeCountTotal} count submissions</span>
                    <span className="text-emerald-400 font-bold">{storeUnitsTotal.toLocaleString()} units counted</span>
                  </div>
                </div>
              );
            })}
          </div>

          {filteredStores.length === 0 && (
            <div className="rounded-2xl bg-slate-900 border border-slate-800 p-8 text-center space-y-2">
              <Building2 className="w-8 h-8 text-slate-500 mx-auto" />
              <div className="text-sm font-bold text-white">No store branches match your search</div>
              <p className="text-xs text-slate-400">Try adjusting your search query or add a new retail store branch.</p>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 4: MANAGE USERS & STORE ASSIGNMENTS (ADMIN ONLY) */}
      {/* ========================================================================= */}
      {activeTab === 'manage_users' && (
        <div className="space-y-4 animate-in fade-in duration-150">
          {/* Top Actions & Subtitle Bar */}
          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-amber-400">
                  User Management & Store Assignment
                </span>
                <span className="rounded-md bg-amber-500/20 text-amber-300 px-2 py-0.5 text-[10px] font-black uppercase">
                  Admin Restricted
                </span>
              </div>
              <h3 className="text-base font-black text-white mt-1">
                Store Counters & Supervisors ({managedUsers.length} Users)
              </h3>
              <p className="text-xs text-slate-400 mt-0.5 max-w-xl">
                Create user accounts, set credentials, and assign each supervisor and counter associate to their designated retail store branch.
              </p>
            </div>

            <button
              onClick={() => {
                setIsAddUserModalOpen(true);
                setUserActionError(null);
                setUserActionSuccess(null);
              }}
              className="h-10 px-4 rounded-xl bg-amber-600 hover:bg-amber-500 font-bold text-xs text-white shadow-md active:scale-95 transition flex items-center gap-2 shrink-0"
            >
              <UserPlus className="w-4 h-4" />
              <span>+ Add New User</span>
            </button>
          </div>

          {/* Action Success / Error Feedback */}
          {userActionSuccess && (
            <div className="flex items-center justify-between rounded-xl bg-emerald-600/20 border border-emerald-500/30 p-3 text-xs text-emerald-300">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span className="font-medium">{userActionSuccess}</span>
              </div>
              <button onClick={() => setUserActionSuccess(null)} className="text-emerald-400 hover:text-white p-1">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {userActionError && (
            <div className="flex items-center justify-between rounded-xl bg-rose-500/15 border border-rose-500/30 p-3 text-xs text-rose-300">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                <span className="font-medium">{userActionError}</span>
              </div>
              <button onClick={() => setUserActionError(null)} className="text-rose-400 hover:text-white p-1">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Search & Filters */}
          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-3.5 shadow-md space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              {/* Text Search */}
              <div className="relative sm:col-span-1">
                <input
                  type="text"
                  value={userSearchQuery}
                  onChange={(e) => setUserSearchQuery(e.target.value)}
                  placeholder="Search user by name, username..."
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 pl-9 text-xs text-white placeholder-slate-500 focus:border-amber-400 focus:outline-none"
                />
                <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-slate-400" />
              </div>

              {/* Role Filter */}
              <div>
                <select
                  value={userRoleFilter}
                  onChange={(e) => setUserRoleFilter(e.target.value as any)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-amber-400 focus:outline-none"
                >
                  <option value="all">All Roles (Store, Operations, Audit & Admin)</option>
                  <option value="counter">Store Counters Only</option>
                  <option value="ops_counter">Operations Counters Only</option>
                  <option value="supervisor">Store Supervisors Only</option>
                  <option value="ops_supervisor">Counter Supervisors (Ops) Only</option>
                  <option value="audit">Audit Users Only</option>
                  <option value="admin">Administrators Only</option>
                </select>
              </div>

              {/* Store Filter */}
              <div>
                <select
                  value={userStoreFilter}
                  onChange={(e) => setUserStoreFilter(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-amber-400 focus:outline-none"
                >
                  <option value="all">All Assigned Stores</option>
                  <option value="ALL">All Stores (Operations)</option>
                  {stores.map((s) => (
                    <option key={s.storeId} value={s.storeId}>
                      {s.name} ({s.storeId})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Users Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {filteredManagedUsers.map((u) => {
              const userCountsCount = counts.filter(
                (c) => c.userId === u.id || c.username.toLowerCase() === u.username.toLowerCase()
              ).length;

              return (
                <div
                  key={u.id}
                  className="rounded-2xl bg-slate-900 border border-slate-800 p-4 shadow-sm hover:border-slate-700 transition flex flex-col justify-between space-y-3"
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="text-sm font-bold text-white leading-snug">{u.displayName}</h4>
                          <span
                            className={`text-[10px] font-black uppercase px-2 py-0.5 rounded ${
                              u.role === 'admin'
                                ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                                : u.role === 'ops_supervisor'
                                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                                : u.role === 'supervisor'
                                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                : u.role === 'ops_counter'
                                ? 'bg-teal-500/20 text-teal-300 border border-teal-500/30'
                                : u.role === 'audit'
                                ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                                : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            }`}
                          >
                            {u.role === 'ops_counter'
                              ? 'Ops Counter'
                              : u.role === 'ops_supervisor'
                              ? 'Counter Sup (Ops)'
                              : u.role === 'audit'
                              ? 'Audit User'
                              : u.role}
                          </span>
                        </div>
                        <div className="text-xs text-slate-400 font-mono mt-0.5 flex items-center gap-1.5">
                          <span>@{u.username}</span>
                          {u.password && (
                            <span className="text-[10px] text-slate-500 font-sans">· Password: {u.password}</span>
                          )}
                        </div>
                      </div>

                      {/* Action buttons */}
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => handleOpenEditUser(u)}
                          className="p-1.5 text-slate-400 hover:text-amber-400 hover:bg-slate-800 rounded-lg transition"
                          title="Edit User & Assigned Store"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        {u.username !== 'jetgonzalgo@gmail.com' && (
                          <button
                            onClick={() => setUserToDelete(u)}
                            className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-lg transition"
                            title="Delete User"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Assigned Store Chip */}
                    <div className="rounded-xl bg-slate-950/80 border border-slate-800 p-2.5 flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <Building2 className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        <div className="truncate">
                          <span className="text-[10px] text-slate-500 uppercase block font-semibold">Assigned Branch</span>
                          <span className="font-bold text-slate-200 text-xs truncate block">{u.assignedStoreName}</span>
                        </div>
                      </div>
                      <span className="text-[10px] font-mono font-bold text-slate-400 bg-slate-800 px-2 py-0.5 rounded">
                        {u.assignedStoreId}
                      </span>
                    </div>
                  </div>

                  {/* Footer metadata */}
                  <div className="border-t border-slate-800 pt-2 flex items-center justify-between text-[11px] text-slate-400">
                    <div className="flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                      <span>{userCountsCount} scans recorded</span>
                    </div>
                    <span className="text-slate-500 text-[10px]">
                      Created {new Date(u.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {filteredManagedUsers.length === 0 && (
            <div className="rounded-2xl bg-slate-900 border border-slate-800 p-8 text-center space-y-2">
              <Users className="w-8 h-8 text-slate-500 mx-auto" />
              <div className="text-sm font-bold text-white">No users match your filter criteria</div>
              <p className="text-xs text-slate-400">Try adjusting your filters or click "+ Add New User" above.</p>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: ADD NEW USER (ADMIN ONLY) */}
      {/* ========================================================================= */}
      {isAddUserModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-3">
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 p-5 shadow-2xl text-slate-100 animate-in fade-in zoom-in-95 duration-100 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-amber-400" />
                <h3 className="text-sm font-bold text-white">Provision New Store User</h3>
              </div>
              <button
                onClick={() => setIsAddUserModalOpen(false)}
                className="p-1 text-slate-400 hover:text-white rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {userActionError && (
              <div className="rounded-xl bg-rose-500/15 border border-rose-500/30 p-2.5 text-xs text-rose-300 font-medium">
                {userActionError}
              </div>
            )}

            <form onSubmit={handleCreateUser} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Full Name / Display Name <span className="text-amber-400">*</span>
                </label>
                <input
                  type="text"
                  value={newDisplayName}
                  onChange={(e) => setNewDisplayName(e.target.value)}
                  placeholder="e.g. John Doe"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:border-amber-400 focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Username or Login ID <span className="text-amber-400">*</span>
                </label>
                <input
                  type="text"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  placeholder="e.g. john.doe or john@retail.local"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:border-amber-400 focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Password / Access PIN <span className="text-amber-400">*</span>
                </label>
                <input
                  type="text"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="e.g. password123"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:border-amber-400 focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Role & Permissions <span className="text-amber-400">*</span>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => handleSelectNewUserRole('counter')}
                    className={`py-2 px-2.5 rounded-xl border text-xs font-bold transition flex flex-col items-center justify-center gap-0.5 ${
                      newUserRole === 'counter'
                        ? 'bg-emerald-600 border-emerald-500 text-white shadow'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    <span>Store Counter</span>
                    <span className="text-[9px] font-normal opacity-80">1 store · Own counts</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSelectNewUserRole('ops_counter')}
                    className={`py-2 px-2.5 rounded-xl border text-xs font-bold transition flex flex-col items-center justify-center gap-0.5 ${
                      newUserRole === 'ops_counter'
                        ? 'bg-teal-600 border-teal-500 text-white shadow'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    <span>Ops Counter</span>
                    <span className="text-[9px] font-normal opacity-80">Switch stores · Own counts</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSelectNewUserRole('supervisor')}
                    className={`py-2 px-2.5 rounded-xl border text-xs font-bold transition flex flex-col items-center justify-center gap-0.5 ${
                      newUserRole === 'supervisor'
                        ? 'bg-amber-600 border-amber-500 text-white shadow'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    <span>Store Supervisor</span>
                    <span className="text-[9px] font-normal opacity-80">1 store · Add SKU</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSelectNewUserRole('ops_supervisor')}
                    className={`py-2 px-2.5 rounded-xl border text-xs font-bold transition flex flex-col items-center justify-center gap-0.5 ${
                      newUserRole === 'ops_supervisor'
                        ? 'bg-cyan-600 border-cyan-500 text-white shadow'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    <span>Counter Sup (Ops)</span>
                    <span className="text-[9px] font-normal opacity-80">All counts · Add SKU</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSelectNewUserRole('audit')}
                    className={`col-span-2 py-2 px-2.5 rounded-xl border text-xs font-bold transition flex flex-col items-center justify-center gap-0.5 ${
                      newUserRole === 'audit'
                        ? 'bg-indigo-600 border-indigo-500 text-white shadow'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    <span>Audit User</span>
                    <span className="text-[9px] font-normal opacity-80">History & Extract Counts Only</span>
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Designate Assigned Store <span className="text-amber-400">*</span>
                </label>
                <select
                  value={newUserStoreId}
                  onChange={(e) => setNewUserStoreId(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-xs text-white focus:border-amber-400 focus:outline-none"
                  required
                >
                  {(newUserRole === 'ops_counter' || newUserRole === 'ops_supervisor' || newUserRole === 'audit') && (
                    <option value="ALL">All Stores (Operations / Audit — All Branches)</option>
                  )}
                  {stores.map((s) => (
                    <option key={s.storeId} value={s.storeId}>
                      {s.name} ({s.storeId}) — {s.location}
                    </option>
                  ))}
                </select>
                <span className="text-[10px] text-slate-500 mt-1 block">
                  {newUserRole === 'audit'
                    ? 'Audit users can only view History and extract count reports.'
                    : newUserRole === 'ops_counter' || newUserRole === 'ops_supervisor'
                    ? 'Operations staff can switch store locations while conducting physical counts.'
                    : 'This store user will be strictly locked to the assigned store upon signing in.'}
                </span>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAddUserModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 text-xs font-semibold text-slate-300 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isUserSubmitting}
                  className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-xs font-bold text-white shadow-md active:scale-95 transition disabled:opacity-50"
                >
                  {isUserSubmitting ? 'Provisioning...' : 'Provision User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: EDIT USER & STORE ASSIGNMENT (ADMIN ONLY) */}
      {/* ========================================================================= */}
      {userToEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-3">
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 p-5 shadow-2xl text-slate-100 animate-in fade-in zoom-in-95 duration-100 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Edit2 className="w-5 h-5 text-amber-400" />
                <h3 className="text-sm font-bold text-white">Edit User: {userToEdit.displayName}</h3>
              </div>
              <button
                onClick={() => setUserToEdit(null)}
                className="p-1 text-slate-400 hover:text-white rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {userActionError && (
              <div className="rounded-xl bg-rose-500/15 border border-rose-500/30 p-2.5 text-xs text-rose-300 font-medium">
                {userActionError}
              </div>
            )}

            <form onSubmit={handleSaveEditUser} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Display Name
                </label>
                <input
                  type="text"
                  value={editDisplayName}
                  onChange={(e) => setEditDisplayName(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-xs text-white focus:border-amber-400 focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Password / Access PIN
                </label>
                <input
                  type="text"
                  value={editPassword}
                  onChange={(e) => setEditPassword(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-xs text-white focus:border-amber-400 focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Role
                </label>
                <select
                  value={editUserRole}
                  onChange={(e) => {
                    const nextRole = e.target.value as UserRole;
                    setEditUserRole(nextRole);
                    if (nextRole === 'ops_counter' || nextRole === 'ops_supervisor' || nextRole === 'audit') {
                      setEditUserStoreId('ALL');
                    } else if (editUserStoreId === 'ALL') {
                      setEditUserStoreId(stores[0]?.storeId || 'ST-101');
                    }
                  }}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-xs text-white focus:border-amber-400 focus:outline-none"
                >
                  <option value="counter">Store Counter (Assigned Store, Own Counts)</option>
                  <option value="ops_counter">Operations Counter (Multi-Store, Own Counts)</option>
                  <option value="supervisor">Store Supervisor (Assigned Store, Add SKU)</option>
                  <option value="ops_supervisor">Counter Supervisor - Ops (All Stores & Counts, Add SKU)</option>
                  <option value="audit">Audit User (History & Extract Counts Only)</option>
                  <option value="admin">Administrator</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Assigned Store Branch
                </label>
                <select
                  value={editUserStoreId}
                  onChange={(e) => setEditUserStoreId(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-xs text-white focus:border-amber-400 focus:outline-none"
                >
                  {(editUserRole === 'ops_counter' || editUserRole === 'ops_supervisor' || editUserRole === 'audit') && (
                    <option value="ALL">All Stores (Operations / Audit — All Branches)</option>
                  )}
                  {stores.map((s) => (
                    <option key={s.storeId} value={s.storeId}>
                      {s.name} ({s.storeId}) — {s.location}
                    </option>
                  ))}
                </select>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setUserToEdit(null)}
                  className="px-4 py-2 rounded-xl bg-slate-800 text-xs font-semibold text-slate-300 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isUserSubmitting}
                  className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-xs font-bold text-white shadow-md active:scale-95 transition disabled:opacity-50"
                >
                  {isUserSubmitting ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: DELETE USER CONFIRMATION (ADMIN ONLY) */}
      {/* ========================================================================= */}
      {userToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-3">
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 p-5 shadow-2xl text-slate-100 animate-in fade-in zoom-in-95 duration-100 space-y-4">
            <div className="flex items-center gap-2.5 text-rose-400 border-b border-slate-800 pb-3">
              <AlertTriangle className="w-5 h-5" />
              <h3 className="text-sm font-bold text-white">Delete User Account</h3>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Are you sure you want to delete user <strong className="text-white">{userToDelete.displayName}</strong> (<code className="text-amber-300">@{userToDelete.username}</code>)?
            </p>

            <div className="rounded-xl bg-slate-950 p-3 text-xs border border-slate-800 space-y-1">
              <div className="text-slate-400">Role: <span className="text-white uppercase font-bold text-[10px]">{userToDelete.role}</span></div>
              <div className="text-slate-400">Assigned Store: <span className="text-slate-200">{userToDelete.assignedStoreName} ({userToDelete.assignedStoreId})</span></div>
            </div>

            <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setUserToDelete(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-xs font-semibold text-slate-300 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteUser}
                disabled={isUserSubmitting}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-xs font-bold text-white shadow-md active:scale-95 transition disabled:opacity-50"
              >
                {isUserSubmitting ? 'Deleting...' : 'Yes, Delete User'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: ADD NEW STORE (ADMIN ONLY) */}
      {/* ========================================================================= */}
      {isAddStoreModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-3">
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 p-5 shadow-2xl text-slate-100 animate-in fade-in zoom-in-95 duration-100 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Building2 className="w-5 h-5 text-blue-400" />
                <h3 className="text-sm font-bold text-white">Add New Retail Store Branch</h3>
              </div>
              <button
                onClick={() => setIsAddStoreModalOpen(false)}
                className="p-1 text-slate-400 hover:text-white rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {storeActionError && (
              <div className="rounded-xl bg-rose-500/15 border border-rose-500/30 p-2.5 text-xs text-rose-300 font-medium">
                {storeActionError}
              </div>
            )}

            <form onSubmit={handleCreateStore} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Store Code / Identifier <span className="text-blue-400">*</span>
                </label>
                <input
                  type="text"
                  value={newStoreId}
                  onChange={(e) => setNewStoreId(e.target.value.toUpperCase())}
                  placeholder="e.g. ST-106"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-xs text-white uppercase font-mono placeholder-slate-500 focus:border-blue-400 focus:outline-none"
                  required
                />
                <span className="text-[10px] text-slate-500 mt-0.5 block">Unique uppercase identifier (e.g., ST-106)</span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Store Branch Name <span className="text-blue-400">*</span>
                </label>
                <input
                  type="text"
                  value={newStoreName}
                  onChange={(e) => setNewStoreName(e.target.value)}
                  placeholder="e.g. Northside Galleria"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:border-blue-400 focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Physical Location / Address
                </label>
                <input
                  type="text"
                  value={newStoreLocation}
                  onChange={(e) => setNewStoreLocation(e.target.value)}
                  placeholder="e.g. 500 North Ave, Level 2"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:border-blue-400 focus:outline-none"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAddStoreModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 text-xs font-semibold text-slate-300 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isStoreSubmitting}
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-xs font-bold text-white shadow-md active:scale-95 transition disabled:opacity-50"
                >
                  {isStoreSubmitting ? 'Registering...' : 'Register Store'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: DELETE STORE CONFIRMATION (ADMIN ONLY) */}
      {/* ========================================================================= */}
      {storeToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-3">
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 p-5 shadow-2xl text-slate-100 animate-in fade-in zoom-in-95 duration-100 space-y-4">
            <div className="flex items-center gap-2.5 text-rose-400 border-b border-slate-800 pb-3">
              <AlertTriangle className="w-5 h-5" />
              <h3 className="text-sm font-bold text-white">Delete Retail Store Branch</h3>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Are you sure you want to delete store <strong className="text-white">{storeToDelete.name}</strong> (<code className="text-blue-300">{storeToDelete.storeId}</code>)?
            </p>

            <div className="rounded-xl bg-slate-950 p-3 text-xs border border-slate-800 space-y-1">
              <div className="text-slate-400 font-mono text-[11px]">Location: {storeToDelete.location}</div>
              {counts.filter(c => c.storeId === storeToDelete.storeId || c.store === storeToDelete.name).length > 0 && (
                <div className="text-amber-400 font-semibold flex items-center gap-1.5 pt-1 border-t border-slate-800">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    Warning: {counts.filter(c => c.storeId === storeToDelete.storeId || c.store === storeToDelete.name).length} counts exist for this store in history.
                  </span>
                </div>
              )}
            </div>

            <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setStoreToDelete(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-xs font-semibold text-slate-300 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteStore}
                disabled={isStoreSubmitting}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-xs font-bold text-white shadow-md active:scale-95 transition disabled:opacity-50"
              >
                {isStoreSubmitting ? 'Deleting...' : 'Yes, Delete Store'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: EDIT STORE DETAILS (ADMIN ONLY) */}
      {/* ========================================================================= */}
      {storeToEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-3">
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 p-5 shadow-2xl text-slate-100 animate-in fade-in zoom-in-95 duration-100 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Edit2 className="w-5 h-5 text-blue-400" />
                <h3 className="text-sm font-bold text-white">Edit Store ({storeToEdit.storeId})</h3>
              </div>
              <button
                onClick={() => setStoreToEdit(null)}
                className="p-1 text-slate-400 hover:text-white rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEditStore} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Store Branch Name <span className="text-blue-400">*</span>
                </label>
                <input
                  type="text"
                  value={editStoreName}
                  onChange={(e) => setEditStoreName(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-xs text-white focus:border-blue-400 focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Location / Address
                </label>
                <input
                  type="text"
                  value={editStoreLocation}
                  onChange={(e) => setEditStoreLocation(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-xs text-white focus:border-blue-400 focus:outline-none"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setStoreToEdit(null)}
                  className="px-4 py-2 rounded-xl bg-slate-800 text-xs font-semibold text-slate-300 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isStoreSubmitting}
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-xs font-bold text-white shadow-md active:scale-95 transition disabled:opacity-50"
                >
                  {isStoreSubmitting ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
