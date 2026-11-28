import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type Unsubscribe,
  type User,
} from 'firebase/auth';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  getDownloadURL,
  ref as storageRef,
  uploadBytesResumable,
} from 'firebase/storage';
import {
  onDisconnect,
  onValue,
  ref as dbRef,
  serverTimestamp as rtdbServerTimestamp,
  set as rtdbSet,
} from 'firebase/database';
import {
  auth,
  db,
  googleProvider,
  handleFirestoreError,
  OperationType,
  rtdb,
  storage,
} from '../firebase';
import {
  BLUEPRINT_LIMITS,
  type Book,
  type BookComment,
  type BookFileType,
  type DailyReadingLog,
  type PresenceRecord,
  type ReadingProgress,
  type UserProfile,
  type UserRole,
} from '../types';
import { STARTER_BOOKS } from '../data/starterBooks';
import {
  fetchGitHubHostStatus,
  getSavedGitHubHostRepo,
  GitHubHostUploadError,
  normalizeGitHubAssetUrl,
  uploadFileToGitHubHost,
} from './githubHostService';
import {
  fetchR2StorageStatus,
  R2StorageUploadError,
  uploadFileToR2Storage,
} from './r2StorageService';

const BOOTSTRAPPED_ADMIN_EMAIL = 'aadamali989@gmail.com';

function sanitizeString(value: string, maxLength: number): string {
  return value.trim().slice(0, maxLength);
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
}

const MAX_COVER_FILE_BYTES = 10 * 1024 * 1024;
const MAX_BOOK_FILE_BYTES = 100 * 1024 * 1024;
const MAX_FIRESTORE_CHUNKED_BOOK_BYTES = 20 * 1024 * 1024;
const FIRESTORE_CHUNK_RAW_BYTES = 420 * 1024;
const MAX_FIRESTORE_CHUNK_COUNT = 60;
const MAKTABADA_CLOUD_SCHEME = 'maktabada-cloud://';
const STORAGE_STALL_TIMEOUT_MS = 12000;
const FIRESTORE_WRITE_TIMEOUT_MS = 15000;
let storageUnavailableInSession = false;

const resolvedBlobUrlCache = new Map<string, string>();
const inFlightBlobResolvers = new Map<string, Promise<string>>();

function assertBrowserOnline(): void {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error(
      'Internet ma jiro. Fadlan hubi khadkaaga ka hor intaadan buug soo gelin.'
    );
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

function validateCoverUrlInput(rawUrl: string | undefined, label: string): string {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('data:image/') || trimmed.startsWith('maktabada-cover://')) {
    if (trimmed.length > BLUEPRINT_LIMITS.book.coverUrlMax) {
      throw new Error(`${label} wuu ka weyn yahay xadka la oggol yahay.`);
    }
    return trimmed;
  }
  if (
    trimmed.startsWith('/src/assets/') ||
    trimmed.startsWith('/assets/') ||
    trimmed.startsWith('/api/r2-storage/file/')
  ) {
    return trimmed.slice(0, BLUEPRINT_LIMITS.book.coverUrlMax);
  }
  const normalized = normalizeGitHubAssetUrl(trimmed);
  if (!normalized.startsWith('https://') && !normalized.startsWith('http://')) {
    throw new Error(`${label} waa inuu ku bilaabmaa https:// ama http://`);
  }
  if (normalized.length > BLUEPRINT_LIMITS.book.coverUrlMax) {
    throw new Error(`${label} wuu ka dheer yahay xadka.`);
  }
  return normalized;
}

function validateBookFileUrlInput(rawUrl: string | undefined, label: string): string {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) return '';
  if (trimmed.startsWith(MAKTABADA_CLOUD_SCHEME) || trimmed.startsWith('/api/r2-storage/file/')) {
    if (trimmed.length > BLUEPRINT_LIMITS.book.urlMax) {
      throw new Error(`${label} wuu ka dheer yahay xadka.`);
    }
    return trimmed;
  }
  const normalized = normalizeGitHubAssetUrl(trimmed);
  if (!normalized.startsWith('https://') && !normalized.startsWith('http://')) {
    throw new Error(`${label} waa inuu ku bilaabmaa https:// ama http://`);
  }
  if (normalized.length > BLUEPRINT_LIMITS.book.urlMax) {
    throw new Error(`${label} wuu ka dheer yahay xadka (${BLUEPRINT_LIMITS.book.urlMax} xaraf).`);
  }
  return normalized;
}

export function isMaktabadaCloudFileUrl(url?: string): boolean {
  return Boolean(url && url.trim().startsWith(MAKTABADA_CLOUD_SCHEME));
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  const sliceSize = 0x8000;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += sliceSize) {
    const sub = bytes.subarray(i, i + sliceSize);
    parts.push(String.fromCharCode(...sub));
  }
  return btoa(parts.join(''));
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const len = binary.length;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function inferBookFileMimeType(fileName: string, explicitType?: string): string {
  if (explicitType && explicitType.trim()) {
    return sanitizeString(explicitType, 120);
  }
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.epub')) return 'application/epub+zip';
  if (lower.endsWith('.txt') || lower.endsWith('.md')) return 'text/plain; charset=utf-8';
  return 'application/octet-stream';
}

async function uploadBookFileChunksToFirestore(params: {
  bookId: string;
  adminUid: string;
  file: File;
  published: boolean;
  stamp: number;
  onStatus?: (label: string) => void;
}): Promise<string> {
  const { bookId, adminUid, file, published, stamp, onStatus } = params;
  if (file.size > MAX_FIRESTORE_CHUNKED_BOOK_BYTES) {
    throw new Error(
      `Faylka buuggu wuu ka weyn yahay xadka kaydka tooska ah (20 MB). Fadlan dooro PDF ka yar 20 MB ama isticmaal Link HTTPS toos ah.`
    );
  }

  onStatus?.('Diyaarinaya faylka buugga...');
  const buffer = await file.arrayBuffer();
  const allBytes = new Uint8Array(buffer);
  if (allBytes.length === 0) {
    throw new Error('Faylka aad dooratay waa mid madhan (0 bytes).');
  }

  const totalChunks = Math.max(1, Math.ceil(allBytes.length / FIRESTORE_CHUNK_RAW_BYTES));
  if (totalChunks > MAX_FIRESTORE_CHUNK_COUNT) {
    throw new Error('Faylku aad buu u weyn yahay (xadka waa 20 MB).');
  }

  const mimeType = inferBookFileMimeType(file.name, file.type);
  const chunkPrefix = `chunk_${stamp}_`;
  const createdChunkIds: string[] = [];

  try {
    for (let i = 0; i < totalChunks; i += 1) {
      const start = i * FIRESTORE_CHUNK_RAW_BYTES;
      const end = Math.min(allBytes.length, start + FIRESTORE_CHUNK_RAW_BYTES);
      const dataBase64 = uint8ArrayToBase64(allBytes.subarray(start, end));
      const chunkId = `${chunkPrefix}${i}`;

      await withTimeout(
        setDoc(doc(db, 'books', bookId, 'fileChunks', chunkId), {
          bookId,
          index: i,
          totalChunks,
          mimeType,
          dataBase64,
          published,
          createdBy: adminUid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }),
        FIRESTORE_WRITE_TIMEOUT_MS,
        'Kaydinta faylka ee Firestore way daahday. Hubi khadkaaga.'
      );

      createdChunkIds.push(chunkId);
      const pct = Math.min(99, Math.round(((i + 1) / totalChunks) * 100));
      onStatus?.(`Kaydinaya faylka Maktabadda (${pct}%)...`);
    }
  } catch (err) {
    await Promise.all(
      createdChunkIds.map((cid) =>
        deleteDoc(doc(db, 'books', bookId, 'fileChunks', cid)).catch(() => {})
      )
    );
    throw err;
  }

  return `${MAKTABADA_CLOUD_SCHEME}${bookId}?v=${stamp}`;
}

async function deleteExistingBookFileChunks(
  bookId: string,
  keepPrefix?: string
): Promise<void> {
  try {
    const snap = await getDocs(collection(db, 'books', bookId, 'fileChunks'));
    const targets = keepPrefix
      ? snap.docs.filter((d) => !d.id.startsWith(keepPrefix))
      : snap.docs;
    await Promise.all(targets.map((d) => deleteDoc(d.ref).catch(() => {})));
  } catch {
    // Best-effort cleanup
  }
}

export function clearCachedBookBlobUrl(bookId: string): void {
  for (const [key, blobUrl] of resolvedBlobUrlCache.entries()) {
    if (key.startsWith(`${bookId}:`)) {
      try {
        URL.revokeObjectURL(blobUrl);
      } catch {
        // Ignore revoke errors
      }
      resolvedBlobUrlCache.delete(key);
    }
  }
}

export async function resolveBookFileUrl(book: Book, isAdmin = false): Promise<string> {
  const rawUrl = (book.fileUrl || '').trim();
  if (!rawUrl) return '';
  if (!isMaktabadaCloudFileUrl(rawUrl)) {
    return normalizeGitHubAssetUrl(rawUrl);
  }

  const cacheKey = `${book.id}:${rawUrl}`;
  const cached = resolvedBlobUrlCache.get(cacheKey);
  if (cached) return cached;

  const existingTask = inFlightBlobResolvers.get(cacheKey);
  if (existingTask) return existingTask;

  const task = (async (): Promise<string> => {
    const chunksCol = collection(db, 'books', book.id, 'fileChunks');
    const q = isAdmin ? chunksCol : query(chunksCol, where('published', '==', true));
    const snap = await getDocs(q);

    if (snap.empty) {
      throw new Error('Faylka buuggan lagama helin kaydka Firestore.');
    }

    const sorted = snap.docs
      .map((d) => d.data() as { index?: number; mimeType?: string; dataBase64?: string })
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

    const mimeType = sorted[0]?.mimeType || inferBookFileMimeType(book.fileName || '');
    const byteArrays = sorted.map((c) => base64ToUint8Array(c.dataBase64 || ''));
    const blobParts = byteArrays.map((arr) => arr.buffer as ArrayBuffer);
    const blob = new Blob(blobParts, { type: mimeType });
    const objectUrl = URL.createObjectURL(blob);

    clearCachedBookBlobUrl(book.id);
    resolvedBlobUrlCache.set(cacheKey, objectUrl);
    return objectUrl;
  })();

  inFlightBlobResolvers.set(cacheKey, task);
  try {
    return await task;
  } finally {
    inFlightBlobResolvers.delete(cacheKey);
  }
}

function formatStorageUploadError(err: unknown, itemLabel: string): Error {
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code?: unknown }).code || '')
      : '';
  const rawMessage = err instanceof Error ? err.message : String(err || '');

  if (
    code === 'storage/unauthorized' ||
    code === 'storage/unauthenticated' ||
    rawMessage.includes('storage/unauthorized')
  ) {
    return new Error(
      `Firebase Storage waa la diiday markii la soo gelinayay ${itemLabel} (storage/unauthorized). Hubi Firebase Console -> Storage -> Rules, ama geli link HTTPS toos ah.`
    );
  }

  if (
    code === 'storage/canceled' ||
    code === 'storage/retry-limit-exceeded' ||
    code === 'storage/unknown' ||
    rawMessage.includes('STORAGE_TIMEOUT') ||
    rawMessage.includes('ERR_FAILED')
  ) {
    return new Error(
      `Firebase Storage wuu daahay ama lama daarin markii la soo gelinayay ${itemLabel}. Hubi Firebase Console -> Storage (Rules/CORS), ama isticmaal Link HTTPS toos ah / qoraalka buugga.`
    );
  }

  return new Error(`Soo gelinta ${itemLabel} way fashilantay: ${rawMessage || 'Cilad aan la garan'}`);
}

async function uploadFileWithProgress(
  path: string,
  file: Blob | File,
  options?: {
    contentType?: string;
    stallTimeoutMs?: number;
    onProgress?: (percent: number) => void;
    itemLabel?: string;
  }
): Promise<string> {
  assertBrowserOnline();
  const itemLabel = options?.itemLabel ?? 'faylka';
  if (storageUnavailableInSession) {
    throw formatStorageUploadError(new Error('STORAGE_TIMEOUT'), itemLabel);
  }
  const targetRef = storageRef(storage, path);
  const stallTimeoutMs = options?.stallTimeoutMs ?? STORAGE_STALL_TIMEOUT_MS;

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let lastBytesTransferred = -1;
    let stallTimer: ReturnType<typeof setTimeout> | null = null;

    const uploadTask = uploadBytesResumable(
      targetRef,
      file,
      options?.contentType ? { contentType: options.contentType } : undefined
    );

    const clearStallTimer = () => {
      if (stallTimer !== null) {
        clearTimeout(stallTimer);
        stallTimer = null;
      }
    };

    const resetStallTimer = () => {
      clearStallTimer();
      stallTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        storageUnavailableInSession = true;
        try {
          uploadTask.cancel();
        } catch {
          // Ignore cancel error
        }
        reject(formatStorageUploadError(new Error('STORAGE_TIMEOUT'), itemLabel));
      }, stallTimeoutMs);
    };

    resetStallTimer();

    uploadTask.on(
      'state_changed',
      (snapshot) => {
        if (settled) return;
        if (snapshot.bytesTransferred > lastBytesTransferred) {
          lastBytesTransferred = snapshot.bytesTransferred;
          resetStallTimer();
        }
        if (snapshot.totalBytes > 0) {
          const pct = Math.min(
            100,
            Math.max(0, Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100))
          );
          options?.onProgress?.(pct);
        }
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearStallTimer();
        storageUnavailableInSession = true;
        reject(formatStorageUploadError(error, itemLabel));
      },
      async () => {
        if (settled) return;
        clearStallTimer();
        try {
          const url = await withTimeout(
            getDownloadURL(uploadTask.snapshot.ref),
            10000,
            `Soo qaadista link-ga ${itemLabel} way daahday.`
          );
          settled = true;
          resolve(url);
        } catch (err) {
          settled = true;
          reject(formatStorageUploadError(err, itemLabel));
        }
      }
    );
  });
}

export function extractErrorMessage(
  err: unknown,
  fallback = 'Hawsha lama dhammaystiri karin.'
): string {
  const raw = err instanceof Error ? err.message : String(err || '');
  if (!raw) return fallback;
  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw) as { error?: string };
      if (parsed.error) return parsed.error;
    } catch {
      // Fall through to raw string
    }
  }
  return raw;
}

function logSnapshotError(
  error: unknown,
  operationType: OperationType,
  path: string
): string {
  const message = error instanceof Error ? error.message : String(error);
  console.error(
    'Firestore Listener Error: ',
    JSON.stringify({
      error: message,
      operationType,
      path,
      userId: auth.currentUser?.uid ?? null,
    })
  );
  return message;
}

const inFlightProfileEnsures = new Map<string, Promise<UserProfile>>();
const pendingSignupNames = new Map<string, string>();

export async function signInWithGoogle(): Promise<User> {
  const result = await signInWithPopup(auth, googleProvider);
  await ensureUserProfile(result.user);
  return result.user;
}

export async function registerWithEmail(
  name: string,
  email: string,
  password: string
): Promise<User> {
  const cleanName = sanitizeString(name, BLUEPRINT_LIMITS.user.nameMax) || 'Akhriste';
  const cleanEmail = sanitizeString(email, BLUEPRINT_LIMITS.user.emailMax);
  pendingSignupNames.set(cleanEmail.toLowerCase(), cleanName);
  try {
    const cred = await createUserWithEmailAndPassword(auth, cleanEmail, password);
    await updateProfile(cred.user, { displayName: cleanName });
    await ensureUserProfile(cred.user, cleanName);
    return cred.user;
  } finally {
    pendingSignupNames.delete(cleanEmail.toLowerCase());
  }
}

export async function loginWithEmail(email: string, password: string): Promise<User> {
  const cleanEmail = sanitizeString(email, BLUEPRINT_LIMITS.user.emailMax);
  const cred = await signInWithEmailAndPassword(auth, cleanEmail, password);
  await ensureUserProfile(cred.user);
  return cred.user;
}

const PROFILE_CACHE_PREFIX = 'maktabada_cached_profile_v1_';

function readCachedUserProfile(uid: string): UserProfile | null {
  try {
    const raw = window.localStorage.getItem(`${PROFILE_CACHE_PREFIX}${uid}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<UserProfile> | null;
    if (!parsed || parsed.uid !== uid || typeof parsed.email !== 'string') {
      return null;
    }
    return {
      uid,
      name: typeof parsed.name === 'string' && parsed.name ? parsed.name : 'Akhriste',
      email: parsed.email,
      role: parsed.role === 'admin' ? 'admin' : 'user',
      bio: typeof parsed.bio === 'string' ? parsed.bio : '',
      avatarUrl: typeof parsed.avatarUrl === 'string' ? parsed.avatarUrl : '',
      favorites: Array.isArray(parsed.favorites)
        ? parsed.favorites.filter((id): id is string => typeof id === 'string')
        : [],
      online: true,
      lastSeen: parsed.lastSeen ?? Date.now(),
      createdAt: parsed.createdAt ?? Date.now(),
      updatedAt: parsed.updatedAt ?? Date.now(),
      dailyReadingGoalMinutes:
        typeof parsed.dailyReadingGoalMinutes === 'number'
          ? parsed.dailyReadingGoalMinutes
          : undefined,
      dailyReminderEnabled:
        typeof parsed.dailyReminderEnabled === 'boolean'
          ? parsed.dailyReminderEnabled
          : undefined,
      dailyReminderTime:
        typeof parsed.dailyReminderTime === 'string'
          ? parsed.dailyReminderTime
          : undefined,
    };
  } catch {
    return null;
  }
}

function writeCachedUserProfile(profile: UserProfile): void {
  try {
    const serializable: UserProfile = {
      uid: profile.uid,
      name: profile.name,
      email: profile.email,
      role: profile.role,
      bio: profile.bio || '',
      avatarUrl: profile.avatarUrl || '',
      favorites: Array.isArray(profile.favorites) ? profile.favorites : [],
      online: Boolean(profile.online),
      lastSeen: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      dailyReadingGoalMinutes: profile.dailyReadingGoalMinutes,
      dailyReminderEnabled: profile.dailyReminderEnabled,
      dailyReminderTime: profile.dailyReminderTime,
    };
    window.localStorage.setItem(
      `${PROFILE_CACHE_PREFIX}${profile.uid}`,
      JSON.stringify(serializable)
    );
  } catch {
    // Ignore storage quota / privacy mode errors
  }
}

function clearCachedUserProfile(uid?: string): void {
  if (!uid) return;
  try {
    window.localStorage.removeItem(`${PROFILE_CACHE_PREFIX}${uid}`);
  } catch {
    // Ignore storage errors
  }
}

function buildFallbackUserProfile(user: User): UserProfile {
  const isBootstrappedAdmin =
    user.email?.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL && user.emailVerified;
  const now = Date.now();
  return {
    uid: user.uid,
    name:
      sanitizeString(
        user.displayName || user.email?.split('@')[0] || 'Akhriste',
        BLUEPRINT_LIMITS.user.nameMax
      ) || 'Akhriste',
    email:
      sanitizeString(user.email || 'user@maktabada.so', BLUEPRINT_LIMITS.user.emailMax) ||
      'user@maktabada.so',
    role: isBootstrappedAdmin ? 'admin' : 'user',
    bio: '',
    avatarUrl: sanitizeString(user.photoURL || '', BLUEPRINT_LIMITS.user.avatarUrlMax),
    favorites: [],
    online: true,
    lastSeen: now,
    createdAt: now,
    updatedAt: now,
  };
}

export async function logoutUser(uid?: string): Promise<void> {
  clearCachedUserProfile(uid || auth.currentUser?.uid);
  if (uid) {
    try {
      await updatePresenceOffline(uid);
    } catch {
      // Best-effort offline update before signOut
    }
  }
  await signOut(auth);
}

export async function ensureUserProfile(user: User, preferredName?: string): Promise<UserProfile> {
  const existingTask = inFlightProfileEnsures.get(user.uid);
  if (existingTask) {
    return existingTask;
  }

  const task = (async (): Promise<UserProfile> => {
    const userPath = `users/${user.uid}`;
    const userDocRef = doc(db, 'users', user.uid);
    const isBootstrappedAdmin =
      user.email?.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL && user.emailVerified;

    const pendingName = user.email ? pendingSignupNames.get(user.email.toLowerCase()) : undefined;
    const displayName =
      sanitizeString(
        preferredName || pendingName || user.displayName || user.email?.split('@')[0] || 'Akhriste',
        BLUEPRINT_LIMITS.user.nameMax
      ) || 'Akhriste';
    const email =
      sanitizeString(user.email || 'user@maktabada.so', BLUEPRINT_LIMITS.user.emailMax) ||
      'user@maktabada.so';

    let opType: OperationType = OperationType.GET;

    try {
      return await runTransaction(db, async (tx) => {
        const snap = await tx.get(userDocRef);

        if (snap.exists()) {
          opType = OperationType.UPDATE;
          const data = snap.data() as UserProfile;
          const shouldPromoteBootstrapped = isBootstrappedAdmin && data.role !== 'admin';
          tx.update(userDocRef, {
            ...(shouldPromoteBootstrapped ? { role: 'admin' as UserRole } : {}),
            online: true,
            lastSeen: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          return {
            ...data,
            ...(shouldPromoteBootstrapped ? { role: 'admin' as UserRole } : {}),
            online: true,
          };
        }

        opType = OperationType.CREATE;
        const initialAvatar = sanitizeString(
          user.photoURL || '',
          BLUEPRINT_LIMITS.user.avatarUrlMax
        );
        const newProfile: UserProfile = {
          uid: user.uid,
          name: displayName,
          email,
          role: isBootstrappedAdmin ? 'admin' : 'user',
          bio: '',
          avatarUrl: initialAvatar,
          favorites: [],
          online: true,
          lastSeen: serverTimestamp(),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };

        tx.set(userDocRef, newProfile);
        return newProfile;
      });
    } catch (error) {
      handleFirestoreError(error, opType, userPath);
    }
  })();

  inFlightProfileEnsures.set(user.uid, task);
  try {
    return await task;
  } finally {
    inFlightProfileEnsures.delete(user.uid);
  }
}

export async function updateUserProfileDetails(
  uid: string,
  updates: { name: string; bio: string; avatarUrl?: string }
): Promise<void> {
  if (!BLUEPRINT_LIMITS.idPattern.test(uid)) {
    throw new Error('Aqoonsiga isticmaalaha ma saxna.');
  }

  const cleanName = sanitizeString(updates.name, BLUEPRINT_LIMITS.user.nameMax);
  if (cleanName.length < BLUEPRINT_LIMITS.user.nameMin) {
    throw new Error('Magacu ma noqon karo mid madhan.');
  }
  const cleanBio = sanitizeString(updates.bio, BLUEPRINT_LIMITS.user.bioMax);

  const payload: {
    name: string;
    bio: string;
    avatarUrl?: string;
    updatedAt: ReturnType<typeof serverTimestamp>;
  } = {
    name: cleanName,
    bio: cleanBio,
    updatedAt: serverTimestamp(),
  };

  if (updates.avatarUrl !== undefined) {
    payload.avatarUrl = sanitizeString(updates.avatarUrl, BLUEPRINT_LIMITS.user.avatarUrlMax);
  }

  const userPath = `users/${uid}`;
  try {
    await updateDoc(doc(db, 'users', uid), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, userPath);
  }
}

export async function updateDailyReadingGoal(uid: string, minutes: number): Promise<number> {
  if (!BLUEPRINT_LIMITS.idPattern.test(uid)) {
    throw new Error('Aqoonsiga isticmaalaha ma saxna.');
  }

  const parsed = Math.round(Number(minutes));
  if (!Number.isFinite(parsed)) {
    throw new Error('Fadlan geli tiro sax ah oo daqiiqo ah.');
  }

  const clamped = Math.min(
    BLUEPRINT_LIMITS.user.dailyGoalMax,
    Math.max(BLUEPRINT_LIMITS.user.dailyGoalMin, parsed)
  );

  const userPath = `users/${uid}`;
  try {
    await updateDoc(doc(db, 'users', uid), {
      dailyReadingGoalMinutes: clamped,
      updatedAt: serverTimestamp(),
    });
    return clamped;
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, userPath);
  }
}

export async function updateDailyReminderSettings(
  uid: string,
  enabled: boolean,
  time: string
): Promise<{ enabled: boolean; time: string }> {
  if (!BLUEPRINT_LIMITS.idPattern.test(uid)) {
    throw new Error('Aqoonsiga isticmaalaha ma saxna.');
  }

  const trimmedTime = (time || '').trim();
  if (!BLUEPRINT_LIMITS.user.reminderTimePattern.test(trimmedTime)) {
    throw new Error('Fadlan dooro saacad sax ah (tusaale: 20:00).');
  }

  const cleanEnabled = Boolean(enabled);
  const userPath = `users/${uid}`;
  try {
    await updateDoc(doc(db, 'users', uid), {
      dailyReminderEnabled: cleanEnabled,
      dailyReminderTime: trimmedTime,
      updatedAt: serverTimestamp(),
    });
    return { enabled: cleanEnabled, time: trimmedTime };
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, userPath);
  }
}

async function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Sawirka lama akhrin karin. Fadlan dooro PNG, JPG, ama WebP.'));
    };
    img.src = objectUrl;
  });
}

function renderSquareAvatarCanvas(
  img: HTMLImageElement,
  size: number
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Browser-ku ma taageerayo habaynta sawirka.');
  }

  const srcW = img.naturalWidth || img.width || size;
  const srcH = img.naturalHeight || img.height || size;
  const cropSide = Math.min(srcW, srcH);
  const sx = Math.max(0, (srcW - cropSide) / 2);
  const sy = Math.max(0, (srcH - cropSide) / 2);

  ctx.drawImage(img, sx, sy, cropSide, cropSide, 0, 0, size, size);
  return canvas;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}

async function createCompactAvatarDataUrl(
  img: HTMLImageElement,
  maxLength: number
): Promise<string> {
  const sizes = [128, 96, 72];
  const qualities = [0.82, 0.68, 0.54, 0.4];

  for (const size of sizes) {
    const canvas = renderSquareAvatarCanvas(img, size);
    for (const mime of ['image/webp', 'image/jpeg']) {
      for (const quality of qualities) {
        const dataUrl = canvas.toDataURL(mime, quality);
        if (dataUrl.length <= maxLength && dataUrl.startsWith('data:image/')) {
          return dataUrl;
        }
      }
    }
  }

  throw new Error('Sawirku aad buu u weyn yahay xitaa ka dib marka la yareeyay. Fadlan dooro sawir kale.');
}

function isSupportedImageFile(file: File): boolean {
  if (file.type && file.type.startsWith('image/')) return true;
  return /\.(png|jpe?g|webp|gif|bmp|avif|svg|heic|heif|tiff?)$/i.test(file.name);
}

async function createCompactCoverDataUrl(
  file: File,
  maxLength: number
): Promise<string | null> {
  try {
    const img = await loadImageFromFile(file);
    const srcW = img.naturalWidth || img.width || 600;
    const srcH = img.naturalHeight || img.height || 800;
    const targetAspect = 3 / 4;
    const srcAspect = srcW / srcH;
    const isCloseToBookPortrait = srcAspect >= 0.56 && srcAspect <= 0.92;

    const widths = [600, 480, 360, 300, 240, 180, 144];
    const qualities = [0.88, 0.80, 0.70, 0.58, 0.44];

    for (const w of widths) {
      const h = Math.round((w * 4) / 3);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      ctx.fillStyle = '#1C1917';
      ctx.fillRect(0, 0, w, h);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      if (isCloseToBookPortrait) {
        let sx = 0;
        let sy = 0;
        let cropW = srcW;
        let cropH = srcH;
        if (srcAspect > targetAspect) {
          cropW = Math.round(srcH * targetAspect);
          sx = Math.max(0, Math.round((srcW - cropW) / 2));
        } else if (srcAspect < targetAspect) {
          cropH = Math.round(srcW / targetAspect);
          sy = Math.max(0, Math.round((srcH - cropH) / 2));
        }
        ctx.drawImage(img, sx, sy, cropW, cropH, 0, 0, w, h);
      } else {
        // Wide or square cover: blurred ambient cover backdrop + full uncropped cover centered
        const bgScale = Math.max(w / srcW, h / srcH);
        const bgW = srcW * bgScale;
        const bgH = srcH * bgScale;
        const bgX = (w - bgW) / 2;
        const bgY = (h - bgH) / 2;

        ctx.save();
        if ('filter' in ctx) {
          ctx.filter = 'blur(18px) brightness(0.55)';
        }
        ctx.drawImage(img, bgX, bgY, bgW, bgH);
        ctx.restore();

        ctx.fillStyle = 'rgba(17, 17, 16, 0.25)';
        ctx.fillRect(0, 0, w, h);

        const pad = Math.round(w * 0.05);
        const availW = w - pad * 2;
        const availH = h - pad * 2;
        const fgScale = Math.min(availW / srcW, availH / srcH);
        const fgW = Math.round(srcW * fgScale);
        const fgH = Math.round(srcH * fgScale);
        const fgX = Math.round((w - fgW) / 2);
        const fgY = Math.round((h - fgH) / 2);

        ctx.save();
        ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
        ctx.shadowBlur = Math.round(w * 0.04);
        ctx.shadowOffsetY = Math.round(w * 0.015);
        ctx.drawImage(img, fgX, fgY, fgW, fgH);
        ctx.restore();
      }

      for (const mime of ['image/webp', 'image/jpeg']) {
        for (const quality of qualities) {
          const dataUrl = canvas.toDataURL(mime, quality);
          if (dataUrl.length <= maxLength && dataUrl.startsWith('data:image/')) {
            return dataUrl;
          }
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

export async function updateUserAvatarUrl(uid: string, rawUrl: string): Promise<string> {
  if (!BLUEPRINT_LIMITS.idPattern.test(uid)) {
    throw new Error('Aqoonsiga isticmaalaha ma saxna.');
  }

  const trimmed = rawUrl.trim();
  if (
    trimmed !== '' &&
    !trimmed.startsWith('https://') &&
    !trimmed.startsWith('http://') &&
    !trimmed.startsWith('data:image/')
  ) {
    throw new Error('Fadlan geli link sawir oo sax ah (https://...).');
  }

  const cleanUrl = sanitizeString(trimmed, BLUEPRINT_LIMITS.user.avatarUrlMax);
  if (trimmed.length > BLUEPRINT_LIMITS.user.avatarUrlMax) {
    throw new Error('Link-ga sawirku wuu ka dheer yahay xadka la oggol yahay.');
  }

  const userPath = `users/${uid}`;
  try {
    await updateDoc(doc(db, 'users', uid), {
      avatarUrl: cleanUrl,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, userPath);
  }

  if (auth.currentUser && auth.currentUser.uid === uid) {
    if (cleanUrl === '' || (cleanUrl.startsWith('https://') && cleanUrl.length <= 2000)) {
      try {
        await updateProfile(auth.currentUser, { photoURL: cleanUrl || null });
      } catch {
        // Non-fatal Auth metadata sync
      }
    }
  }

  return cleanUrl;
}

export async function uploadUserAvatar(uid: string, file: File): Promise<string> {
  if (!BLUEPRINT_LIMITS.idPattern.test(uid)) {
    throw new Error('Aqoonsiga isticmaalaha ma saxna.');
  }
  if (!file.type.startsWith('image/')) {
    throw new Error('Fadlan dooro sawir sax ah (PNG, JPG, ama WebP).');
  }
  if (file.size > 10 * 1024 * 1024) {
    throw new Error('Sawirku waa inuu ka yaraadaa 10 MB.');
  }

  const img = await loadImageFromFile(file);
  const hiResCanvas = renderSquareAvatarCanvas(img, 240);
  const compressedBlob =
    (await canvasToBlob(hiResCanvas, 'image/webp', 0.85)) ||
    (await canvasToBlob(hiResCanvas, 'image/jpeg', 0.85)) ||
    file;

  let finalAvatarUrl = '';

  try {
    const safeName = sanitizeFileName(file.name.replace(/\.[^.]+$/, '') || 'avatar');
    const ext = compressedBlob.type === 'image/webp' ? 'webp' : 'jpg';
    const avatarPath = `avatars/${uid}/${Date.now()}_${safeName}.${ext}`;
    const uploadedUrl = await uploadFileWithProgress(avatarPath, compressedBlob, {
      contentType: compressedBlob.type || 'image/jpeg',
      stallTimeoutMs: 8000,
      itemLabel: 'sawirka profile-ka',
    });
    finalAvatarUrl = sanitizeString(uploadedUrl, BLUEPRINT_LIMITS.user.avatarUrlMax);
  } catch {
    // Graceful fallback when Firebase Storage rules are not yet enabled in Console
    finalAvatarUrl = await createCompactAvatarDataUrl(
      img,
      BLUEPRINT_LIMITS.user.avatarUrlMax
    );
  }

  return updateUserAvatarUrl(uid, finalAvatarUrl);
}

export function subscribeAuthAndProfile(
  onUpdate: (state: {
    authReady: boolean;
    user: User | null;
    profile: UserProfile | null;
  }) => void
): () => void {
  let disposed = false;
  let authInitialized = false;
  let profileUnsub: Unsubscribe | null = null;
  let presenceCleanup: (() => void) | null = null;
  let activeUid: string | null = null;
  let lastKnownProfile: UserProfile | null = null;

  void auth
    .authStateReady()
    .catch(() => undefined)
    .finally(() => {
      if (disposed) return;
      authInitialized = true;
      if (!auth.currentUser && !activeUid) {
        onUpdate({ authReady: true, user: null, profile: null });
      }
    });

  const authUnsub = onAuthStateChanged(auth, (user) => {
    if (disposed) return;

    if (profileUnsub) {
      profileUnsub();
      profileUnsub = null;
    }
    if (presenceCleanup) {
      presenceCleanup();
      presenceCleanup = null;
    }

    if (!user) {
      activeUid = null;
      lastKnownProfile = null;
      if (authInitialized) {
        onUpdate({ authReady: true, user: null, profile: null });
      }
      return;
    }

    authInitialized = true;
    activeUid = user.uid;

    // Emit cached or fallback profile immediately so reload never flickers or drops session UI
    const initialProfile = readCachedUserProfile(user.uid) || buildFallbackUserProfile(user);
    lastKnownProfile = initialProfile;
    onUpdate({ authReady: true, user, profile: initialProfile });

    // Ensure profile exists/updates in Firestore without blocking UI hydration
    void ensureUserProfile(user)
      .then((ensured) => {
        if (disposed || activeUid !== user.uid) return;
        lastKnownProfile = ensured;
        writeCachedUserProfile(ensured);
        onUpdate({ authReady: true, user, profile: ensured });
      })
      .catch((err) => {
        console.error('Failed to ensure user profile:', err);
      });

    presenceCleanup = setupUserPresence(user.uid);

    const userPath = `users/${user.uid}`;
    profileUnsub = onSnapshot(
      doc(db, 'users', user.uid),
      (snap) => {
        if (disposed || activeUid !== user.uid) return;
        if (snap.exists()) {
          const freshProfile = snap.data() as UserProfile;
          lastKnownProfile = freshProfile;
          writeCachedUserProfile(freshProfile);
          onUpdate({
            authReady: true,
            user,
            profile: freshProfile,
          });
        } else if (lastKnownProfile) {
          onUpdate({ authReady: true, user, profile: lastKnownProfile });
        }
      },
      (error) => {
        if (disposed || activeUid !== user.uid) return;
        logSnapshotError(error, OperationType.GET, userPath);
        // Preserve last known/cached profile on transient network or permission hiccups
        if (lastKnownProfile) {
          onUpdate({ authReady: true, user, profile: lastKnownProfile });
        }
      }
    );
  });

  return () => {
    disposed = true;
    authUnsub();
    if (profileUnsub) profileUnsub();
    if (presenceCleanup) presenceCleanup();
  };
}

function setupUserPresence(uid: string): () => void {
  const userDocRef = doc(db, 'users', uid);

  const setFirestoreOnline = async (online: boolean) => {
    try {
      await updateDoc(userDocRef, {
        online,
        lastSeen: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch {
      // Ignore transient offline errors during unload
    }
  };

  void setFirestoreOnline(true);

  let rtdbConnectedUnsub: (() => void) | null = null;
  if (rtdb) {
    try {
      const userStatusRef = dbRef(rtdb, `status/${uid}`);
      const connectedRef = dbRef(rtdb, '.info/connected');

      rtdbConnectedUnsub = onValue(
        connectedRef,
        (snap) => {
          if (snap.val() === false) return;
          onDisconnect(userStatusRef)
            .set({
              online: false,
              lastSeen: rtdbServerTimestamp(),
            })
            .then(() =>
              rtdbSet(userStatusRef, {
                online: true,
                lastSeen: rtdbServerTimestamp(),
              })
            )
            .catch(() => {
              // RTDB may not be provisioned yet; Firestore presence continues cleanly
            });
        },
        () => {
          // Ignore RTDB read permission warnings if RTDB rules aren't enabled yet
        }
      );
    } catch {
      // RTDB optional fallback
    }
  }

  const handleVisibility = () => {
    if (document.visibilityState === 'visible') {
      void setFirestoreOnline(true);
    }
  };

  const handlePageHide = () => {
    void setFirestoreOnline(false);
  };

  document.addEventListener('visibilitychange', handleVisibility);
  window.addEventListener('pagehide', handlePageHide);

  const heartbeat = window.setInterval(() => {
    if (document.visibilityState === 'visible') {
      void setFirestoreOnline(true);
    }
  }, 45000);

  return () => {
    document.removeEventListener('visibilitychange', handleVisibility);
    window.removeEventListener('pagehide', handlePageHide);
    window.clearInterval(heartbeat);
    if (rtdbConnectedUnsub) rtdbConnectedUnsub();
  };
}

async function updatePresenceOffline(uid: string): Promise<void> {
  if (rtdb) {
    try {
      await rtdbSet(dbRef(rtdb, `status/${uid}`), {
        online: false,
        lastSeen: rtdbServerTimestamp(),
      });
    } catch {
      // Ignore RTDB error if not configured
    }
  }

  try {
    await updateDoc(doc(db, 'users', uid), {
      online: false,
      lastSeen: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `users/${uid}`);
  }
}

export function subscribeBooks(
  isAdmin: boolean,
  onBooks: (books: Book[]) => void,
  onError?: (message: string) => void
): Unsubscribe {
  const booksPath = 'books';
  const booksRef = collection(db, 'books');
  const q = isAdmin ? booksRef : query(booksRef, where('published', '==', true));

  const toMillis = (val: unknown): number => {
    if (!val) return 0;
    if (typeof val === 'number') return val;
    if (typeof val === 'object' && val !== null && 'toMillis' in val) {
      return (val as { toMillis: () => number }).toMillis();
    }
    return 0;
  };

  return onSnapshot(
    q,
    (snapshot) => {
      const items: Book[] = snapshot.docs
        .map((d) => ({
          id: d.id,
          ...(d.data() as Omit<Book, 'id'>),
        }))
        .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
      onBooks(items);
    },
    (error) => {
      const msg = logSnapshotError(error, OperationType.LIST, booksPath);
      onError?.(msg);
    }
  );
}

export async function seedStarterBooksIfEmpty(adminUid: string): Promise<number> {
  const booksPath = 'books';
  let existing;
  try {
    existing = await getDocs(collection(db, booksPath));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, booksPath);
  }

  if (!existing.empty) return 0;

  let seeded = 0;
  for (const starter of STARTER_BOOKS) {
    try {
      await setDoc(doc(db, booksPath, starter.id), {
        title: sanitizeString(starter.title, BLUEPRINT_LIMITS.book.titleMax),
        author: sanitizeString(starter.author, BLUEPRINT_LIMITS.book.authorMax),
        category: sanitizeString(starter.category, BLUEPRINT_LIMITS.book.categoryMax),
        description: sanitizeString(starter.description, BLUEPRINT_LIMITS.book.descriptionMax),
        coverUrl: sanitizeString(starter.coverUrl, BLUEPRINT_LIMITS.book.urlMax),
        fileUrl: sanitizeString(starter.fileUrl, BLUEPRINT_LIMITS.book.urlMax),
        fileName: sanitizeString(starter.fileName, BLUEPRINT_LIMITS.book.fileNameMax),
        fileType: starter.fileType,
        allowDownload: starter.allowDownload,
        published: true,
        contentText: sanitizeString(starter.contentText, BLUEPRINT_LIMITS.book.contentTextMax),
        createdBy: adminUid,
        ratingSum: 0,
        ratingCount: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      seeded += 1;
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `${booksPath}/${starter.id}`);
    }
  }
  return seeded;
}

const LEGACY_STARTER_COVER_PATHS = new Set([
  '/src/assets/images/cover_taariikhda_soomaaliya_1795275336344.jpg',
  '/src/assets/images/cover_sayniska_xiddigiska_1795275336746.jpg',
  '/src/assets/images/art_xiddigiska_dhaqanka_1795420923302.jpg',
  '/src/assets/images/cover_suugaanta_soomaaliyeed_1795275336487.jpg',
  '/src/assets/images/cover_tignoolajiyada_casriga_1795275335465.jpg',
]);

export async function upgradeStarterBookCovers(books: Book[]): Promise<void> {
  const starterMap = new Map(STARTER_BOOKS.map((b) => [b.id, b.coverUrl]));
  const targets = books.filter((b) => {
    const nextCover = starterMap.get(b.id);
    return Boolean(
      nextCover &&
        b.coverUrl !== nextCover &&
        (!b.coverUrl || LEGACY_STARTER_COVER_PATHS.has(b.coverUrl))
    );
  });

  if (targets.length === 0) return;

  await Promise.all(
    targets.map(async (book) => {
      const nextCover = starterMap.get(book.id);
      if (!nextCover) return;
      try {
        await updateDoc(doc(db, 'books', book.id), {
          coverUrl: sanitizeString(nextCover, BLUEPRINT_LIMITS.book.urlMax),
          updatedAt: serverTimestamp(),
        });
      } catch {
        // Best-effort sync; BookCover also maps legacy URLs locally
      }
    })
  );
}

export async function toggleFavoriteBook(
  uid: string,
  currentFavorites: string[],
  bookId: string
): Promise<void> {
  if (!BLUEPRINT_LIMITS.idPattern.test(uid) || !BLUEPRINT_LIMITS.idPattern.test(bookId)) {
    throw new Error('Aqoonsiga isticmaalaha ama buugga ma saxna.');
  }

  const userPath = `users/${uid}`;
  const isFav = currentFavorites.includes(bookId);
  if (!isFav && currentFavorites.length >= BLUEPRINT_LIMITS.user.favoritesMax) {
    throw new Error(
      `Kaydka Favorites wuxuu gaaray xadka (${BLUEPRINT_LIMITS.user.favoritesMax} buug). Fadlan ka saar qaar si aad mid cusub ugu darto.`
    );
  }
  const nextFavorites = isFav
    ? currentFavorites.filter((id) => id !== bookId)
    : [...currentFavorites, bookId];

  try {
    await updateDoc(doc(db, 'users', uid), {
      favorites: nextFavorites,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, userPath);
  }
}

export interface CreateBookInput {
  title: string;
  author: string;
  category: string;
  description: string;
  fileType: BookFileType;
  allowDownload: boolean;
  contentText: string;
  coverFile: File | null;
  bookFile: File | null;
  coverFallbackUrl?: string;
  fileFallbackUrl?: string;
  adminUid: string;
  onProgress?: (statusLabel: string) => void;
}

async function uploadBookAssetWithCloudFirst(params: {
  folder: 'covers' | 'books';
  file: File;
  onStatus?: (label: string) => void;
  allowTextFallback?: boolean;
  hasExtractedText?: boolean;
}): Promise<{ url: string; usedTextFallback: boolean; useFirestoreChunks?: boolean }> {
  const { folder, file, onStatus, allowTextFallback, hasExtractedText } = params;
  const isCover = folder === 'covers';

  const r2Status = await fetchR2StorageStatus();

  // Primary Cloud Upgrade: Cloudflare R2 (10 GB free, $0 egress, 100 MB+ PDFs)
  if (r2Status.configured && auth.currentUser) {
    onStatus?.(
      isCover
        ? 'Soo gelinaya jaldiga Cloudflare R2 (0%)...'
        : 'Soo gelinaya faylka buugga Cloudflare R2 (0%)...'
    );
    try {
      const idToken = await auth.currentUser.getIdToken();
      const uploaded = await uploadFileToR2Storage({
        folder,
        file,
        idToken,
        canPresign: r2Status.canPresign,
        onProgress: (pct) => {
          onStatus?.(
            isCover
              ? `Soo gelinaya jaldiga Cloudflare R2 (${pct}%)...`
              : `Soo gelinaya buugga Cloudflare R2 (${pct}%)...`
          );
        },
      });
      return {
        url: sanitizeString(
          uploaded.publicUrl,
          isCover ? BLUEPRINT_LIMITS.book.coverUrlMax : BLUEPRINT_LIMITS.book.urlMax
        ),
        usedTextFallback: false,
      };
    } catch (err) {
      if (err instanceof R2StorageUploadError) {
        if (
          err.code === 'UNAUTHORIZED' ||
          err.code === 'FORBIDDEN' ||
          err.code === 'FILE_TOO_LARGE'
        ) {
          if (allowTextFallback && hasExtractedText && err.code !== 'FILE_TOO_LARGE') {
            return { url: '', usedTextFallback: true };
          }
          throw err;
        }
      }
    }
  }

  const ghStatus = await fetchGitHubHostStatus();

  // Optional Upgrade: GitHub Free Host (when write-verified)
  if (ghStatus.configured && ghStatus.canWrite && auth.currentUser) {
    onStatus?.(
      isCover
        ? 'Soo gelinaya jaldiga GitHub (0%)...'
        : 'Soo gelinaya faylka buugga GitHub (0%)...'
    );
    try {
      const idToken = await auth.currentUser.getIdToken();
      const uploaded = await uploadFileToGitHubHost({
        folder,
        file,
        idToken,
        repo: getSavedGitHubHostRepo(),
        onProgress: (pct) => {
          onStatus?.(
            isCover
              ? `Soo gelinaya jaldiga GitHub (${pct}%)...`
              : `Soo gelinaya buugga GitHub (${pct}%)...`
          );
        },
      });
      return {
        url: sanitizeString(
          uploaded.cdnUrl,
          isCover ? BLUEPRINT_LIMITS.book.coverUrlMax : BLUEPRINT_LIMITS.book.urlMax
        ),
        usedTextFallback: false,
      };
    } catch (err) {
      if (err instanceof GitHubHostUploadError) {
        if (err.code === 'UNAUTHORIZED' || err.code === 'FORBIDDEN') {
          if (allowTextFallback && hasExtractedText) {
            return { url: '', usedTextFallback: true };
          }
          throw err;
        }
      }
    }
  }

  // Zero-Config Built-in Storage (Works immediately without any external setup!)
  if (isCover) {
    onStatus?.('Habaynaya sawirka jaldiga HD...');
    const compactCover = await createCompactCoverDataUrl(file, BLUEPRINT_LIMITS.book.coverUrlMax);
    if (compactCover) {
      return { url: compactCover, usedTextFallback: false };
    }
    // If browser cannot decode image format (e.g. HEIC/TIFF), fall back cleanly to built-in Color + Frame + Icon hardcover
    return { url: '', usedTextFallback: false };
  }

  if (allowTextFallback && hasExtractedText) {
    return { url: '', usedTextFallback: true };
  }

  return {
    url: '',
    usedTextFallback: false,
    useFirestoreChunks: true,
  };
}

export async function createBookRecord(input: CreateBookInput): Promise<string> {
  assertBrowserOnline();

  const cleanTitle = sanitizeString(input.title, BLUEPRINT_LIMITS.book.titleMax);
  const cleanAuthor = sanitizeString(input.author, BLUEPRINT_LIMITS.book.authorMax);
  const cleanCategory = sanitizeString(input.category, BLUEPRINT_LIMITS.book.categoryMax);

  if (
    cleanTitle.length < BLUEPRINT_LIMITS.book.titleMin ||
    cleanAuthor.length < BLUEPRINT_LIMITS.book.authorMin ||
    cleanCategory.length < BLUEPRINT_LIMITS.book.categoryMin
  ) {
    throw new Error('Cinwaanka, qoraaga, iyo qaybta buugga waa lama huraan.');
  }

  let coverUrl = validateCoverUrlInput(input.coverFallbackUrl, 'Link-ga sawirka jaldiga');
  let fileUrl = validateBookFileUrlInput(input.fileFallbackUrl, 'Link-ga faylka buugga');

  if (input.coverFile) {
    if (!isSupportedImageFile(input.coverFile)) {
      throw new Error('Sawirka jaldiga waa inuu noqdaa PNG, JPG, ama WebP.');
    }
    if (input.coverFile.size > MAX_COVER_FILE_BYTES) {
      throw new Error('Sawirka jaldigu waa inuu ka yaraadaa 10 MB.');
    }
  }

  if (input.bookFile && input.bookFile.size > MAX_BOOK_FILE_BYTES) {
    throw new Error('Faylka buuggu waa inuu ka yaraadaa 100 MB.');
  }

  const stamp = Date.now();

  if (input.coverFile) {
    const coverResult = await uploadBookAssetWithCloudFirst({
      folder: 'covers',
      file: input.coverFile,
      onStatus: input.onProgress,
    });
    coverUrl = coverResult.url;
  }

  let fileName = '';
  let extractedText = input.contentText;
  const isTextBookFile = Boolean(
    input.bookFile &&
      (input.bookFile.type.startsWith('text/') || /\.(txt|md|csv)$/i.test(input.bookFile.name))
  );
  let uploadViaFirestoreChunks = false;

  if (input.bookFile) {
    fileName = sanitizeString(input.bookFile.name, BLUEPRINT_LIMITS.book.fileNameMax);
    if (!extractedText.trim() && isTextBookFile) {
      try {
        extractedText = await input.bookFile.text();
      } catch {
        // Ignore read error
      }
    }

    const bookResult = await uploadBookAssetWithCloudFirst({
      folder: 'books',
      file: input.bookFile,
      onStatus: input.onProgress,
      allowTextFallback: isTextBookFile,
      hasExtractedText: Boolean(extractedText.trim()),
    });

    if (bookResult.useFirestoreChunks) {
      if (input.bookFile.size > MAX_FIRESTORE_CHUNKED_BOOK_BYTES) {
        throw new Error(
          'Faylka buuggu wuu ka weyn yahay 20 MB. Fadlan dooro PDF ka yar 20 MB ama geli Link HTTPS toos ah.'
        );
      }
      uploadViaFirestoreChunks = true;
    } else {
      fileUrl = bookResult.usedTextFallback ? '' : bookResult.url;
    }
  } else if (fileUrl) {
    const cleanUrlPart = fileUrl.split('?')[0].split('/').pop() || '';
    fileName = sanitizeString(
      decodeURIComponent(cleanUrlPart) ||
        `${input.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'buug'}.${input.fileType}`,
      BLUEPRINT_LIMITS.book.fileNameMax
    );
  } else {
    fileName = sanitizeString(
      `${input.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'buug'}.txt`,
      BLUEPRINT_LIMITS.book.fileNameMax
    );
  }

  input.onProgress?.('Kaydinaya buugga...');

  const bookRef = doc(collection(db, 'books'));
  const cloudFileUrl = uploadViaFirestoreChunks
    ? `${MAKTABADA_CLOUD_SCHEME}${bookRef.id}?v=${stamp}`
    : fileUrl;

  const payload = {
    title: cleanTitle,
    author: cleanAuthor,
    category: cleanCategory,
    description: sanitizeString(input.description, BLUEPRINT_LIMITS.book.descriptionMax),
    coverUrl,
    fileUrl: cloudFileUrl,
    fileName,
    fileType: input.fileType,
    allowDownload: Boolean(input.allowDownload),
    published: uploadViaFirestoreChunks ? false : true,
    contentText: sanitizeString(extractedText, BLUEPRINT_LIMITS.book.contentTextMax),
    createdBy: input.adminUid,
    ratingSum: 0,
    ratingCount: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await withTimeout(
      setDoc(bookRef, payload),
      FIRESTORE_WRITE_TIMEOUT_MS,
      'Kaydinta Firestore way daahday. Hubi internet-kaaga ama xisaabta Admin-ka.'
    );

    if (uploadViaFirestoreChunks && input.bookFile) {
      try {
        await uploadBookFileChunksToFirestore({
          bookId: bookRef.id,
          adminUid: input.adminUid,
          file: input.bookFile,
          published: true,
          stamp,
          onStatus: input.onProgress,
        });
        await updateDoc(bookRef, {
          published: true,
          updatedAt: serverTimestamp(),
        });
      } catch (chunkErr) {
        await deleteDoc(bookRef).catch(() => {});
        throw chunkErr;
      }
    }

    return bookRef.id;
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes('Kaydinta Firestore way daahday') ||
        error.message.includes('Kaydinta faylka'))
    ) {
      throw error;
    }
    handleFirestoreError(error, OperationType.CREATE, `books/${bookRef.id}`);
  }
}

export interface UpdateBookInput {
  title: string;
  author: string;
  category: string;
  description: string;
  fileType: BookFileType;
  allowDownload: boolean;
  published: boolean;
  contentText: string;
  existingCoverUrl: string;
  existingFileUrl: string;
  existingFileName: string;
  coverFallbackUrl?: string;
  fileFallbackUrl?: string;
  coverFile?: File | null;
  bookFile?: File | null;
  adminUid?: string;
  onProgress?: (statusLabel: string) => void;
}

export async function updateBookRecord(
  bookId: string,
  input: UpdateBookInput
): Promise<void> {
  assertBrowserOnline();

  if (!BLUEPRINT_LIMITS.idPattern.test(bookId)) {
    throw new Error('Aqoonsiga buugga ma saxna.');
  }

  const cleanTitle = sanitizeString(input.title, BLUEPRINT_LIMITS.book.titleMax);
  const cleanAuthor = sanitizeString(input.author, BLUEPRINT_LIMITS.book.authorMax);
  const cleanCategory = sanitizeString(input.category, BLUEPRINT_LIMITS.book.categoryMax);

  if (
    cleanTitle.length < BLUEPRINT_LIMITS.book.titleMin ||
    cleanAuthor.length < BLUEPRINT_LIMITS.book.authorMin ||
    cleanCategory.length < BLUEPRINT_LIMITS.book.categoryMin
  ) {
    throw new Error('Cinwaanka, qoraaga, iyo qaybta buugga waa lama huraan.');
  }

  if (input.coverFile) {
    if (!isSupportedImageFile(input.coverFile)) {
      throw new Error('Sawirka jaldiga waa inuu noqdaa PNG, JPG, ama WebP.');
    }
    if (input.coverFile.size > MAX_COVER_FILE_BYTES) {
      throw new Error('Sawirka jaldigu waa inuu ka yaraadaa 10 MB.');
    }
  }

  if (input.bookFile && input.bookFile.size > MAX_BOOK_FILE_BYTES) {
    throw new Error('Faylka buuggu waa inuu ka yaraadaa 100 MB.');
  }

  const stamp = Date.now();
  let coverUrl =
    input.coverFallbackUrl !== undefined
      ? validateCoverUrlInput(input.coverFallbackUrl, 'Link-ga sawirka jaldiga')
      : sanitizeString(input.existingCoverUrl || '', BLUEPRINT_LIMITS.book.coverUrlMax);

  if (input.coverFile) {
    const coverResult = await uploadBookAssetWithCloudFirst({
      folder: 'covers',
      file: input.coverFile,
      onStatus: input.onProgress,
    });
    coverUrl = coverResult.url;
  }

  let fileUrl =
    input.fileFallbackUrl !== undefined
      ? validateBookFileUrlInput(input.fileFallbackUrl, 'Link-ga faylka buugga')
      : sanitizeString(input.existingFileUrl || '', BLUEPRINT_LIMITS.book.urlMax);
  let fileName = sanitizeString(input.existingFileName || '', BLUEPRINT_LIMITS.book.fileNameMax);
  if (fileUrl && !input.bookFile && input.fileFallbackUrl !== undefined && fileUrl !== input.existingFileUrl) {
    const cleanUrlPart = fileUrl.split('?')[0].split('/').pop() || '';
    if (cleanUrlPart && !isMaktabadaCloudFileUrl(fileUrl)) {
      fileName = sanitizeString(decodeURIComponent(cleanUrlPart), BLUEPRINT_LIMITS.book.fileNameMax);
    }
  }
  let contentText = input.contentText;
  const isTextBookFile = Boolean(
    input.bookFile &&
      (input.bookFile.type.startsWith('text/') || /\.(txt|md|csv)$/i.test(input.bookFile.name))
  );

  let uploadedChunkPrefix: string | undefined;

  if (input.bookFile) {
    fileName = sanitizeString(input.bookFile.name, BLUEPRINT_LIMITS.book.fileNameMax);
    if (!contentText.trim() && isTextBookFile) {
      try {
        contentText = await input.bookFile.text();
      } catch {
        // Ignore read error
      }
    }

    const bookResult = await uploadBookAssetWithCloudFirst({
      folder: 'books',
      file: input.bookFile,
      onStatus: input.onProgress,
      allowTextFallback: isTextBookFile,
      hasExtractedText: Boolean(contentText.trim()),
    });

    if (bookResult.useFirestoreChunks) {
      if (input.bookFile.size > MAX_FIRESTORE_CHUNKED_BOOK_BYTES) {
        throw new Error(
          'Faylka buuggu wuu ka weyn yahay 20 MB. Fadlan dooro PDF ka yar 20 MB ama geli Link HTTPS toos ah.'
        );
      }
      const uploaderUid = input.adminUid || auth.currentUser?.uid || '';
      if (!uploaderUid) {
        throw new Error('Fadlan dib u soo gal xisaabtaada Admin-ka.');
      }
      fileUrl = await uploadBookFileChunksToFirestore({
        bookId,
        adminUid: uploaderUid,
        file: input.bookFile,
        published: Boolean(input.published),
        stamp,
        onStatus: input.onProgress,
      });
      uploadedChunkPrefix = `chunk_${stamp}_`;
    } else if (!bookResult.usedTextFallback) {
      fileUrl = bookResult.url;
    }
  }

  input.onProgress?.('Kaydinaya isbeddelka...');

  const bookPath = `books/${bookId}`;
  try {
    await withTimeout(
      updateDoc(doc(db, 'books', bookId), {
        title: cleanTitle,
        author: cleanAuthor,
        category: cleanCategory,
        description: sanitizeString(input.description, BLUEPRINT_LIMITS.book.descriptionMax),
        coverUrl,
        fileUrl,
        fileName,
        fileType: input.fileType,
        allowDownload: Boolean(input.allowDownload),
        published: Boolean(input.published),
        contentText: sanitizeString(contentText, BLUEPRINT_LIMITS.book.contentTextMax),
        updatedAt: serverTimestamp(),
      }),
      FIRESTORE_WRITE_TIMEOUT_MS,
      'Kaydinta Firestore way daahday. Hubi internet-kaaga ama xisaabta Admin-ka.'
    );

    if (uploadedChunkPrefix) {
      clearCachedBookBlobUrl(bookId);
      await deleteExistingBookFileChunks(bookId, uploadedChunkPrefix);
    } else if (!isMaktabadaCloudFileUrl(fileUrl) && isMaktabadaCloudFileUrl(input.existingFileUrl)) {
      clearCachedBookBlobUrl(bookId);
      await deleteExistingBookFileChunks(bookId);
    } else if (isMaktabadaCloudFileUrl(fileUrl)) {
      // Keep fileChunks published state aligned when editing metadata
      const snap = await getDocs(collection(db, 'books', bookId, 'fileChunks')).catch(() => null);
      if (snap && !snap.empty) {
        await Promise.all(
          snap.docs.map((d) =>
            updateDoc(d.ref, {
              published: Boolean(input.published),
              updatedAt: serverTimestamp(),
            }).catch(() => {})
          )
        );
      }
    }
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes('Kaydinta Firestore way daahday') ||
        error.message.includes('Kaydinta faylka'))
    ) {
      throw error;
    }
    handleFirestoreError(error, OperationType.UPDATE, bookPath);
  }
}

export async function toggleBookPublished(
  bookId: string,
  published: boolean
): Promise<void> {
  const bookPath = `books/${bookId}`;
  try {
    await updateDoc(doc(db, 'books', bookId), {
      published,
      updatedAt: serverTimestamp(),
    });
    const chunkSnap = await getDocs(collection(db, 'books', bookId, 'fileChunks')).catch(() => null);
    if (chunkSnap && !chunkSnap.empty) {
      await Promise.all(
        chunkSnap.docs.map((d) =>
          updateDoc(d.ref, {
            published,
            updatedAt: serverTimestamp(),
          }).catch(() => {})
        )
      );
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, bookPath);
  }
}

export async function toggleBookDownloadable(
  bookId: string,
  allowDownload: boolean
): Promise<void> {
  const bookPath = `books/${bookId}`;
  try {
    await updateDoc(doc(db, 'books', bookId), {
      allowDownload,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, bookPath);
  }
}

export async function deleteBookRecord(bookId: string): Promise<void> {
  const bookPath = `books/${bookId}`;
  try {
    await deleteExistingBookFileChunks(bookId);
    clearCachedBookBlobUrl(bookId);
    await deleteDoc(doc(db, 'books', bookId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, bookPath);
  }
}

export async function fetchUserBookRatings(
  uid: string,
  bookIds: string[]
): Promise<Record<string, number>> {
  const validIds = bookIds.filter((id) => BLUEPRINT_LIMITS.idPattern.test(id));
  if (validIds.length === 0) return {};

  const entries = await Promise.all(
    validIds.map(async (bookId) => {
      const ratingPath = `books/${bookId}/ratings/${uid}`;
      try {
        const snap = await getDoc(doc(db, 'books', bookId, 'ratings', uid));
        if (snap.exists()) {
          const val = Number(snap.data()?.rating);
          if (Number.isInteger(val) && val >= BLUEPRINT_LIMITS.book.ratingMin && val <= BLUEPRINT_LIMITS.book.ratingMax) {
            return [bookId, val] as const;
          }
        }
        return null;
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, ratingPath);
      }
    })
  );

  const map: Record<string, number> = {};
  for (const item of entries) {
    if (item) map[item[0]] = item[1];
  }
  return map;
}

export async function rateBook(
  uid: string,
  bookId: string,
  rating: number
): Promise<void> {
  const cleanRating = Math.round(rating);
  if (
    !Number.isInteger(cleanRating) ||
    cleanRating < BLUEPRINT_LIMITS.book.ratingMin ||
    cleanRating > BLUEPRINT_LIMITS.book.ratingMax
  ) {
    throw new Error('Qiimayntu waa inay u dhaxaysaa 1 ilaa 5.');
  }

  const bookPath = `books/${bookId}`;
  const ratingPath = `books/${bookId}/ratings/${uid}`;
  const bookRef = doc(db, 'books', bookId);
  const ratingRef = doc(db, 'books', bookId, 'ratings', uid);

  try {
    await runTransaction(db, async (tx) => {
      const bookSnap = await tx.get(bookRef);
      if (!bookSnap.exists()) {
        throw new Error('Buuggan lagama helin kaydka Firestore.');
      }

      const ratingSnap = await tx.get(ratingRef);
      const bookData = bookSnap.data();
      const prevSum = typeof bookData.ratingSum === 'number' ? bookData.ratingSum : 0;
      const prevCount = typeof bookData.ratingCount === 'number' ? bookData.ratingCount : 0;

      if (ratingSnap.exists()) {
        const prevUserRating = Number(ratingSnap.data()?.rating || 0);
        tx.update(ratingRef, {
          rating: cleanRating,
          updatedAt: serverTimestamp(),
        });
        tx.update(bookRef, {
          ratingSum: Math.max(0, prevSum - prevUserRating + cleanRating),
          ratingCount: prevCount,
          updatedAt: serverTimestamp(),
        });
      } else {
        tx.set(ratingRef, {
          userId: uid,
          bookId,
          rating: cleanRating,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        tx.update(bookRef, {
          ratingSum: prevSum + cleanRating,
          ratingCount: prevCount + 1,
          updatedAt: serverTimestamp(),
        });
      }
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, ratingPath || bookPath);
  }
}

export function subscribeUserReadingProgress(
  uid: string,
  onProgress: (progressMap: Record<string, ReadingProgress>) => void,
  onError?: (message: string) => void
): Unsubscribe {
  const progressPath = `users/${uid}/progress`;
  const q = query(collection(db, 'users', uid, 'progress'), where('userId', '==', uid));

  return onSnapshot(
    q,
    (snapshot) => {
      const map: Record<string, ReadingProgress> = {};
      for (const d of snapshot.docs) {
        const data = d.data() as ReadingProgress;
        map[d.id] = data;
      }
      onProgress(map);
    },
    (error) => {
      const msg = logSnapshotError(error, OperationType.LIST, progressPath);
      onError?.(msg);
    }
  );
}

export async function saveReadingProgress(
  uid: string,
  bookId: string,
  input: { percentage: number; currentPage: number; totalPages: number }
): Promise<void> {
  if (!BLUEPRINT_LIMITS.idPattern.test(uid) || !BLUEPRINT_LIMITS.idPattern.test(bookId)) {
    return;
  }

  const totalPages = Math.max(
    BLUEPRINT_LIMITS.progress.pageMin,
    Math.min(BLUEPRINT_LIMITS.progress.pageMax, Math.round(input.totalPages || 1))
  );
  const currentPage = Math.max(
    BLUEPRINT_LIMITS.progress.pageMin,
    Math.min(totalPages, Math.round(input.currentPage || 1))
  );
  const percentage = Math.max(
    BLUEPRINT_LIMITS.progress.percentageMin,
    Math.min(BLUEPRINT_LIMITS.progress.percentageMax, Math.round(input.percentage || 0))
  );

  const progressPath = `users/${uid}/progress/${bookId}`;
  const progressRef = doc(db, 'users', uid, 'progress', bookId);

  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(progressRef);
      if (snap.exists()) {
        tx.update(progressRef, {
          percentage,
          currentPage,
          totalPages,
          updatedAt: serverTimestamp(),
        });
      } else {
        tx.set(progressRef, {
          userId: uid,
          bookId,
          percentage,
          currentPage,
          totalPages,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, progressPath);
  }
}

export function getLocalDateKey(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function subscribeUserReadingLogs(
  uid: string,
  onLogs: (logsMap: Record<string, DailyReadingLog>) => void,
  onError?: (message: string) => void
): Unsubscribe {
  if (!BLUEPRINT_LIMITS.idPattern.test(uid)) {
    onLogs({});
    return () => {};
  }

  const logsPath = `users/${uid}/readingLogs`;
  const q = query(collection(db, 'users', uid, 'readingLogs'), where('userId', '==', uid));

  return onSnapshot(
    q,
    (snapshot) => {
      const map: Record<string, DailyReadingLog> = {};
      for (const d of snapshot.docs) {
        const data = d.data() as DailyReadingLog;
        map[d.id] = data;
      }
      onLogs(map);
    },
    (error) => {
      const msg = logSnapshotError(error, OperationType.LIST, logsPath);
      onError?.(msg);
    }
  );
}

export async function recordDailyReadingSeconds(
  uid: string,
  dateKey: string,
  deltaSeconds: number
): Promise<void> {
  if (
    !BLUEPRINT_LIMITS.idPattern.test(uid) ||
    !BLUEPRINT_LIMITS.readingLog.dateKeyPattern.test(dateKey)
  ) {
    return;
  }

  const cleanDelta = Math.max(0, Math.round(deltaSeconds));
  if (cleanDelta <= 0) return;

  const logPath = `users/${uid}/readingLogs/${dateKey}`;
  const logRef = doc(db, 'users', uid, 'readingLogs', dateKey);

  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(logRef);
      if (snap.exists()) {
        const existingSeconds = Math.max(
          BLUEPRINT_LIMITS.readingLog.secondsMin,
          Math.round(Number(snap.data()?.secondsRead || 0))
        );
        const nextSeconds = Math.min(
          BLUEPRINT_LIMITS.readingLog.secondsMax,
          existingSeconds + cleanDelta
        );
        if (nextSeconds <= existingSeconds) return;
        tx.update(logRef, {
          secondsRead: nextSeconds,
          updatedAt: serverTimestamp(),
        });
      } else {
        const initialSeconds = Math.min(BLUEPRINT_LIMITS.readingLog.secondsMax, cleanDelta);
        tx.set(logRef, {
          userId: uid,
          dateKey,
          secondsRead: initialSeconds,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, logPath);
  }
}

export interface ReadingStreakSummary {
  currentStreak: number;
  longestStreak: number;
  todaySeconds: number;
  todayMinutes: number;
  todayCompleted: boolean;
  totalQualifyingDays: number;
}

function parseDateKey(dateKey: string): Date | null {
  if (!BLUEPRINT_LIMITS.readingLog.dateKeyPattern.test(dateKey)) return null;
  const [y, m, d] = dateKey.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

export function computeReadingStreak(
  logsMap: Record<string, DailyReadingLog>,
  referenceDate: Date = new Date()
): ReadingStreakSummary {
  const threshold = BLUEPRINT_LIMITS.readingLog.streakThresholdSeconds;
  const todayKey = getLocalDateKey(referenceDate);
  const todaySeconds = Math.max(0, Math.round(logsMap[todayKey]?.secondsRead || 0));
  const todayMinutes = Math.floor(todaySeconds / 60);
  const todayCompleted = todaySeconds >= threshold;

  const qualifies = (key: string) => (logsMap[key]?.secondsRead || 0) >= threshold;

  // Count consecutive qualifying days ending today, or ending yesterday if today isn't completed yet
  let currentStreak = 0;
  const cursor = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate()
  );

  if (!qualifies(todayKey)) {
    cursor.setDate(cursor.getDate() - 1);
  }

  for (let i = 0; i < 36500; i += 1) {
    const key = getLocalDateKey(cursor);
    if (!qualifies(key)) break;
    currentStreak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  // Compute longest consecutive streak across all stored logs
  const qualifyingDates = Object.keys(logsMap)
    .filter((key) => qualifies(key))
    .sort();

  let longestStreak = 0;
  let running = 0;
  let prevTime: number | null = null;

  for (const key of qualifyingDates) {
    const parsed = parseDateKey(key);
    if (!parsed) continue;
    const dayTime = parsed.getTime();
    if (prevTime !== null) {
      const diffDays = Math.round((dayTime - prevTime) / (1000 * 60 * 60 * 24));
      running = diffDays === 1 ? running + 1 : 1;
    } else {
      running = 1;
    }
    if (running > longestStreak) longestStreak = running;
    prevTime = dayTime;
  }

  return {
    currentStreak,
    longestStreak: Math.max(longestStreak, currentStreak),
    todaySeconds,
    todayMinutes,
    todayCompleted,
    totalQualifyingDays: qualifyingDates.length,
  };
}

export function subscribeBookComments(
  bookId: string,
  isAdmin: boolean,
  onComments: (comments: BookComment[]) => void,
  onError?: (message: string) => void
): Unsubscribe {
  if (!BLUEPRINT_LIMITS.idPattern.test(bookId)) {
    onComments([]);
    return () => {};
  }

  const commentsPath = `books/${bookId}/comments`;
  const commentsCol = collection(db, 'books', bookId, 'comments');
  const q = isAdmin ? commentsCol : query(commentsCol, where('published', '==', true));

  const toMillis = (val: unknown): number => {
    if (!val) return Date.now();
    if (typeof val === 'number') return val;
    if (typeof val === 'object' && val !== null && 'toMillis' in val) {
      return (val as { toMillis: () => number }).toMillis();
    }
    return 0;
  };

  return onSnapshot(
    q,
    (snapshot) => {
      const items: BookComment[] = snapshot.docs
        .map((d) => ({
          id: d.id,
          ...(d.data() as Omit<BookComment, 'id'>),
        }))
        .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
      onComments(items);
    },
    (error) => {
      const msg = logSnapshotError(error, OperationType.LIST, commentsPath);
      onError?.(msg);
    }
  );
}

export async function addBookComment(
  bookId: string,
  uid: string,
  authorName: string,
  text: string
): Promise<string> {
  if (!BLUEPRINT_LIMITS.idPattern.test(bookId) || !BLUEPRINT_LIMITS.idPattern.test(uid)) {
    throw new Error('Aqoonsiga buugga ama isticmaalaha ma saxna.');
  }

  const cleanText = sanitizeString(text, BLUEPRINT_LIMITS.comment.textMax);
  if (cleanText.length < BLUEPRINT_LIMITS.comment.textMin) {
    throw new Error('Fadlan qor faalladaada ka hor intaadan dirin.');
  }

  const cleanAuthor =
    sanitizeString(authorName, BLUEPRINT_LIMITS.comment.authorNameMax) || 'Akhriste';

  const commentsPath = `books/${bookId}/comments`;
  try {
    const docRef = await addDoc(collection(db, 'books', bookId, 'comments'), {
      userId: uid,
      bookId,
      authorName: cleanAuthor,
      text: cleanText,
      published: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return docRef.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, commentsPath);
  }
}

export async function updateBookComment(
  bookId: string,
  commentId: string,
  text: string
): Promise<void> {
  if (!BLUEPRINT_LIMITS.idPattern.test(bookId) || !BLUEPRINT_LIMITS.idPattern.test(commentId)) {
    throw new Error('Aqoonsiga faallada ma saxna.');
  }

  const cleanText = sanitizeString(text, BLUEPRINT_LIMITS.comment.textMax);
  if (cleanText.length < BLUEPRINT_LIMITS.comment.textMin) {
    throw new Error('Faalladu ma noqon karto mid madhan.');
  }

  const commentPath = `books/${bookId}/comments/${commentId}`;
  try {
    await updateDoc(doc(db, 'books', bookId, 'comments', commentId), {
      text: cleanText,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, commentPath);
  }
}

export async function deleteBookComment(bookId: string, commentId: string): Promise<void> {
  if (!BLUEPRINT_LIMITS.idPattern.test(bookId) || !BLUEPRINT_LIMITS.idPattern.test(commentId)) {
    return;
  }

  const commentPath = `books/${bookId}/comments/${commentId}`;
  try {
    await deleteDoc(doc(db, 'books', bookId, 'comments', commentId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, commentPath);
  }
}

export interface AdminCommentItem extends BookComment {
  bookTitle: string;
}

export async function fetchAllCommentsForAdmin(
  books: Book[]
): Promise<AdminCommentItem[]> {
  const firestoreBooks = books.filter(
    (b) => !b.isStarter && BLUEPRINT_LIMITS.idPattern.test(b.id)
  );
  if (firestoreBooks.length === 0) return [];

  const toMillis = (val: unknown): number => {
    if (!val) return 0;
    if (typeof val === 'number') return val;
    if (typeof val === 'object' && val !== null && 'toMillis' in val) {
      return (val as { toMillis: () => number }).toMillis();
    }
    return 0;
  };

  const results = await Promise.all(
    firestoreBooks.map(async (book) => {
      const commentsPath = `books/${book.id}/comments`;
      try {
        const snap = await getDocs(collection(db, 'books', book.id, 'comments'));
        return snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<BookComment, 'id'>),
          bookTitle: book.title,
        }));
      } catch (error) {
        handleFirestoreError(error, OperationType.LIST, commentsPath);
        return [];
      }
    })
  );

  return results
    .flat()
    .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
}

export async function toggleCommentPublished(
  bookId: string,
  commentId: string,
  published: boolean
): Promise<void> {
  if (!BLUEPRINT_LIMITS.idPattern.test(bookId) || !BLUEPRINT_LIMITS.idPattern.test(commentId)) {
    throw new Error('Aqoonsiga faallada ma saxna.');
  }

  const commentPath = `books/${bookId}/comments/${commentId}`;
  try {
    await updateDoc(doc(db, 'books', bookId, 'comments', commentId), {
      published,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, commentPath);
  }
}

export function subscribeUsersAndPresence(
  onUpdate: (
    users: Array<UserProfile & { presence: PresenceRecord }>
  ) => void,
  onError?: (message: string) => void
): () => void {
  let usersList: UserProfile[] = [];
  let rtdbPresenceMap: Record<string, PresenceRecord> = {};

  const emit = () => {
    const merged = usersList.map((u) => {
      const rtdbEntry = rtdbPresenceMap[u.uid];
      const presence: PresenceRecord = rtdbEntry
        ? {
            online: Boolean(rtdbEntry.online),
            lastSeen: rtdbEntry.lastSeen ?? u.lastSeen ?? null,
          }
        : {
            online: Boolean(u.online),
            lastSeen: u.lastSeen ?? null,
          };
      return { ...u, presence };
    });
    onUpdate(merged);
  };

  const usersUnsub = onSnapshot(
    query(collection(db, 'users'), orderBy('createdAt', 'desc')),
    (snapshot) => {
      usersList = snapshot.docs.map((d) => d.data() as UserProfile);
      emit();
    },
    (error) => {
      const msg = logSnapshotError(error, OperationType.LIST, 'users');
      onError?.(msg);
    }
  );

  let rtdbUnsub: (() => void) | null = null;
  if (rtdb) {
    try {
      rtdbUnsub = onValue(
        dbRef(rtdb, 'status'),
        (snap) => {
          rtdbPresenceMap = (snap.val() as Record<string, PresenceRecord>) || {};
          emit();
        },
        () => {
          // Ignore RTDB listener error if RTDB rules aren't configured
        }
      );
    } catch {
      // RTDB optional
    }
  }

  return () => {
    usersUnsub();
    if (rtdbUnsub) rtdbUnsub();
  };
}

export async function updateUserRole(uid: string, role: UserRole): Promise<void> {
  const userPath = `users/${uid}`;
  try {
    await updateDoc(doc(db, 'users', uid), {
      role,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, userPath);
  }
}

export async function triggerBookDownload(book: Book, isAdmin = false): Promise<void> {
  if (!book.allowDownload) return;

  if (book.fileUrl) {
    const resolvedHref = isMaktabadaCloudFileUrl(book.fileUrl)
      ? await resolveBookFileUrl(book, isAdmin)
      : normalizeGitHubAssetUrl(book.fileUrl);
    const link = document.createElement('a');
    link.href = resolvedHref;
    link.download = book.fileName || `${book.title}.${book.fileType || 'pdf'}`;
    if (!resolvedHref.startsWith('blob:') && !resolvedHref.startsWith('data:')) {
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    }
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    return;
  }

  if (book.contentText) {
    const content = `${book.title}\nQoraaga: ${book.author}\nQaybta: ${book.category}\n\n${book.contentText}`;
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = book.fileName || `${book.title.toLowerCase().replace(/\s+/g, '-')}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(objectUrl);
  }
}
