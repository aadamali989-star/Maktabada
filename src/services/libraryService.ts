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

const BOOTSTRAPPED_ADMIN_EMAIL = 'aadamali989@gmail.com';

function sanitizeString(value: string, maxLength: number): string {
  return value.trim().slice(0, maxLength);
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
}

const MAX_COVER_FILE_BYTES = 10 * 1024 * 1024;
const MAX_BOOK_FILE_BYTES = 50 * 1024 * 1024;
const STORAGE_STALL_TIMEOUT_MS = 12000;
const STORAGE_COVER_TIMEOUT_MS = 5000;
const FIRESTORE_WRITE_TIMEOUT_MS = 15000;
let storageUnavailableInSession = false;

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

function validateOptionalHttpUrl(rawUrl: string | undefined, label: string): string {
  const normalized = normalizeGitHubAssetUrl((rawUrl || '').trim());
  if (!normalized) return '';
  if (!normalized.startsWith('https://') && !normalized.startsWith('http://')) {
    throw new Error(`${label} waa inuu ku bilaabmaa https:// ama http://`);
  }
  if (normalized.length > BLUEPRINT_LIMITS.book.urlMax) {
    throw new Error(`${label} wuu ka dheer yahay xadka (${BLUEPRINT_LIMITS.book.urlMax} xaraf).`);
  }
  return normalized;
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

export async function logoutUser(uid?: string): Promise<void> {
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

async function createCompactCoverDataUrl(
  file: File,
  maxLength: number
): Promise<string | null> {
  try {
    const img = await loadImageFromFile(file);
    const srcW = img.naturalWidth || img.width || 300;
    const srcH = img.naturalHeight || img.height || 400;
    const targetAspect = 3 / 4;
    const srcAspect = srcW / srcH;

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

    const widths = [90, 72, 60, 48];
    const qualities = [0.68, 0.52, 0.38, 0.25];

    for (const w of widths) {
      const h = Math.round((w * 4) / 3);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.fillStyle = '#F8F6F1';
      ctx.fillRect(0, 0, w, h);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, sx, sy, cropW, cropH, 0, 0, w, h);

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
  let profileUnsub: Unsubscribe | null = null;
  let presenceCleanup: (() => void) | null = null;

  const authUnsub = onAuthStateChanged(auth, async (user) => {
    if (profileUnsub) {
      profileUnsub();
      profileUnsub = null;
    }
    if (presenceCleanup) {
      presenceCleanup();
      presenceCleanup = null;
    }

    if (!user) {
      onUpdate({ authReady: true, user: null, profile: null });
      return;
    }

    try {
      await ensureUserProfile(user);
    } catch (err) {
      console.error('Failed to ensure user profile:', err);
    }

    presenceCleanup = setupUserPresence(user.uid);

    const userPath = `users/${user.uid}`;
    profileUnsub = onSnapshot(
      doc(db, 'users', user.uid),
      (snap) => {
        if (snap.exists()) {
          onUpdate({
            authReady: true,
            user,
            profile: snap.data() as UserProfile,
          });
        } else {
          onUpdate({ authReady: true, user, profile: null });
        }
      },
      (error) => {
        logSnapshotError(error, OperationType.GET, userPath);
        onUpdate({ authReady: true, user, profile: null });
      }
    );
  });

  return () => {
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

async function uploadBookAssetWithGitHubFirst(params: {
  folder: 'covers' | 'books';
  file: File;
  storagePath: string;
  onStatus?: (label: string) => void;
  allowTextFallback?: boolean;
  hasExtractedText?: boolean;
}): Promise<{ url: string; usedTextFallback: boolean }> {
  const { folder, file, storagePath, onStatus, allowTextFallback, hasExtractedText } = params;
  const isCover = folder === 'covers';
  const itemLabel = isCover ? 'sawirka jaldiga' : 'faylka buugga';

  const ghStatus = await fetchGitHubHostStatus();

  if (ghStatus.configured && auth.currentUser) {
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
        url: sanitizeString(uploaded.cdnUrl, BLUEPRINT_LIMITS.book.urlMax),
        usedTextFallback: false,
      };
    } catch (err) {
      if (err instanceof GitHubHostUploadError) {
        if (err.code === 'UNAUTHORIZED' || err.code === 'FORBIDDEN' || err.code === 'FILE_TOO_LARGE') {
          if (allowTextFallback && hasExtractedText) {
            return { url: '', usedTextFallback: true };
          }
          throw err;
        }
        if (err.code === 'UPLOAD_FAILED') {
          if (allowTextFallback && hasExtractedText) {
            return { url: '', usedTextFallback: true };
          }
          if (!isCover) {
            throw err;
          }
        }
        // GITHUB_NOT_CONFIGURED or SERVER_UNAVAILABLE -> continue to fallback path below
      } else if (!isCover) {
        if (allowTextFallback && hasExtractedText) {
          return { url: '', usedTextFallback: true };
        }
        throw err;
      }
    }
  }

  // Fast local fallbacks when GitHub direct upload isn't active yet
  if (isCover) {
    if (!storageUnavailableInSession && ghStatus.reachable === false) {
      try {
        onStatus?.('Soo gelinaya jaldiga (0%)...');
        const uploadedCover = await uploadFileWithProgress(storagePath, file, {
          contentType: file.type || undefined,
          stallTimeoutMs: STORAGE_COVER_TIMEOUT_MS,
          itemLabel,
          onProgress: (pct) => {
            onStatus?.(`Soo gelinaya jaldiga (${pct}%)...`);
          },
        });
        return {
          url: sanitizeString(uploadedCover, BLUEPRINT_LIMITS.book.urlMax),
          usedTextFallback: false,
        };
      } catch {
        // Fall through to compact cover fallback
      }
    }

    onStatus?.('Kaydinaya sawirka jaldiga...');
    const compactCover = await createCompactCoverDataUrl(file, BLUEPRINT_LIMITS.book.urlMax);
    if (compactCover) {
      return { url: compactCover, usedTextFallback: false };
    }
    throw new Error(
      'Sawirka jaldiga lama kaydin karin. Ku dar GITHUB_TOKEN qaybta Secrets / Netlify Env Vars ama geli link HTTPS toos ah.'
    );
  }

  if (allowTextFallback && hasExtractedText) {
    return { url: '', usedTextFallback: true };
  }

  if (!ghStatus.configured) {
    if (!storageUnavailableInSession) {
      try {
        onStatus?.('Soo gelinaya faylka buugga (0%)...');
        const uploadedBookUrl = await uploadFileWithProgress(storagePath, file, {
          contentType: file.type || undefined,
          itemLabel,
          onProgress: (pct) => {
            onStatus?.(`Soo gelinaya faylka buugga (${pct}%)...`);
          },
        });
        return {
          url: sanitizeString(uploadedBookUrl, BLUEPRINT_LIMITS.book.urlMax),
          usedTextFallback: false,
        };
      } catch {
        // Fall through to clear GitHub token instruction below
      }
    }

    throw new Error(
      `Si faylasha PDF/EPUB toos loogu shubo GitHub markaad gujiso Kaydi, ku dar GITHUB_TOKEN qaybta Secrets / Netlify Environment Variables — ama faylka ku tuur GitHub (${getSavedGitHubHostRepo()}) kadibna ka dooro liiska GitHub Free Host.`
    );
  }

  throw new Error(
    `Faylka buugga lama soo gelin karin. Hubi in xisaabtaadu tahay Admin ama ka dooro liiska GitHub Free Host (${getSavedGitHubHostRepo()}).`
  );
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

  let coverUrl = validateOptionalHttpUrl(input.coverFallbackUrl, 'Link-ga sawirka jaldiga');
  let fileUrl = validateOptionalHttpUrl(input.fileFallbackUrl, 'Link-ga faylka buugga');

  if (input.coverFile) {
    if (!input.coverFile.type.startsWith('image/')) {
      throw new Error('Sawirka jaldiga waa inuu noqdaa PNG, JPG, ama WebP.');
    }
    if (input.coverFile.size > MAX_COVER_FILE_BYTES) {
      throw new Error('Sawirka jaldigu waa inuu ka yaraadaa 10 MB.');
    }
  }

  if (input.bookFile && input.bookFile.size > MAX_BOOK_FILE_BYTES) {
    throw new Error('Faylka buuggu waa inuu ka yaraadaa 50 MB.');
  }

  const stamp = Date.now();

  if (input.coverFile) {
    const safeCoverName = sanitizeFileName(input.coverFile.name);
    const coverResult = await uploadBookAssetWithGitHubFirst({
      folder: 'covers',
      file: input.coverFile,
      storagePath: `covers/${stamp}_${safeCoverName}`,
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

  if (input.bookFile) {
    fileName = sanitizeString(input.bookFile.name, BLUEPRINT_LIMITS.book.fileNameMax);
    if (!extractedText.trim() && isTextBookFile) {
      try {
        extractedText = await input.bookFile.text();
      } catch {
        // Ignore read error
      }
    }

    const safeBookName = sanitizeFileName(input.bookFile.name);
    const bookResult = await uploadBookAssetWithGitHubFirst({
      folder: 'books',
      file: input.bookFile,
      storagePath: `books/${stamp}_${safeBookName}`,
      onStatus: input.onProgress,
      allowTextFallback: isTextBookFile,
      hasExtractedText: Boolean(extractedText.trim()),
    });
    fileUrl = bookResult.usedTextFallback ? '' : bookResult.url;
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

  const payload = {
    title: cleanTitle,
    author: cleanAuthor,
    category: cleanCategory,
    description: sanitizeString(input.description, BLUEPRINT_LIMITS.book.descriptionMax),
    coverUrl,
    fileUrl,
    fileName,
    fileType: input.fileType,
    allowDownload: Boolean(input.allowDownload),
    published: true,
    contentText: sanitizeString(extractedText, BLUEPRINT_LIMITS.book.contentTextMax),
    createdBy: input.adminUid,
    ratingSum: 0,
    ratingCount: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    const docRef = await withTimeout(
      addDoc(collection(db, 'books'), payload),
      FIRESTORE_WRITE_TIMEOUT_MS,
      'Kaydinta Firestore way daahday. Hubi internet-kaaga ama xisaabta Admin-ka.'
    );
    return docRef.id;
  } catch (error) {
    if (error instanceof Error && error.message.includes('Kaydinta Firestore way daahday')) {
      throw error;
    }
    handleFirestoreError(error, OperationType.CREATE, 'books');
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
    if (!input.coverFile.type.startsWith('image/')) {
      throw new Error('Sawirka jaldiga waa inuu noqdaa PNG, JPG, ama WebP.');
    }
    if (input.coverFile.size > MAX_COVER_FILE_BYTES) {
      throw new Error('Sawirka jaldigu waa inuu ka yaraadaa 10 MB.');
    }
  }

  if (input.bookFile && input.bookFile.size > MAX_BOOK_FILE_BYTES) {
    throw new Error('Faylka buuggu waa inuu ka yaraadaa 50 MB.');
  }

  const stamp = Date.now();
  let coverUrl =
    input.coverFallbackUrl !== undefined
      ? validateOptionalHttpUrl(input.coverFallbackUrl, 'Link-ga sawirka jaldiga')
      : sanitizeString(input.existingCoverUrl || '', BLUEPRINT_LIMITS.book.urlMax);

  if (input.coverFile) {
    const safeCoverName = sanitizeFileName(input.coverFile.name);
    const coverResult = await uploadBookAssetWithGitHubFirst({
      folder: 'covers',
      file: input.coverFile,
      storagePath: `covers/${stamp}_${safeCoverName}`,
      onStatus: input.onProgress,
    });
    coverUrl = coverResult.url;
  }

  let fileUrl =
    input.fileFallbackUrl !== undefined
      ? validateOptionalHttpUrl(input.fileFallbackUrl, 'Link-ga faylka buugga')
      : sanitizeString(input.existingFileUrl || '', BLUEPRINT_LIMITS.book.urlMax);
  let fileName = sanitizeString(input.existingFileName || '', BLUEPRINT_LIMITS.book.fileNameMax);
  if (fileUrl && !input.bookFile && input.fileFallbackUrl !== undefined && fileUrl !== input.existingFileUrl) {
    const cleanUrlPart = fileUrl.split('?')[0].split('/').pop() || '';
    if (cleanUrlPart) {
      fileName = sanitizeString(decodeURIComponent(cleanUrlPart), BLUEPRINT_LIMITS.book.fileNameMax);
    }
  }
  let contentText = input.contentText;
  const isTextBookFile = Boolean(
    input.bookFile &&
      (input.bookFile.type.startsWith('text/') || /\.(txt|md|csv)$/i.test(input.bookFile.name))
  );

  if (input.bookFile) {
    fileName = sanitizeString(input.bookFile.name, BLUEPRINT_LIMITS.book.fileNameMax);
    if (!contentText.trim() && isTextBookFile) {
      try {
        contentText = await input.bookFile.text();
      } catch {
        // Ignore read error
      }
    }

    const safeBookName = sanitizeFileName(input.bookFile.name);
    const bookResult = await uploadBookAssetWithGitHubFirst({
      folder: 'books',
      file: input.bookFile,
      storagePath: `books/${stamp}_${safeBookName}`,
      onStatus: input.onProgress,
      allowTextFallback: isTextBookFile,
      hasExtractedText: Boolean(contentText.trim()),
    });
    if (!bookResult.usedTextFallback) {
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
  } catch (error) {
    if (error instanceof Error && error.message.includes('Kaydinta Firestore way daahday')) {
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

export function triggerBookDownload(book: Book): void {
  if (!book.allowDownload) return;

  if (book.fileUrl) {
    const link = document.createElement('a');
    link.href = normalizeGitHubAssetUrl(book.fileUrl);
    link.download = book.fileName || `${book.title}.pdf`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
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
