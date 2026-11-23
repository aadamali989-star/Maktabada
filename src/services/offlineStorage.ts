import {
  BLUEPRINT_LIMITS,
  type Book,
  type OfflineBookRecord,
  type ReadingProgress,
} from '../types';
import { isMaktabadaCloudFileUrl, resolveBookFileUrl } from './libraryService';

const OFFLINE_BOOKS_STORAGE_KEY = 'maktabada_offline_books_v1';
const OFFLINE_PROGRESS_STORAGE_PREFIX = 'maktabada_offline_progress_';
const MAX_INLINE_FILE_BYTES = 900 * 1024; // Keep binary fallback safely within localStorage ~5MB budget

function normalizeTimestamp(val: unknown): number {
  if (!val) return 0;
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (typeof val === 'object' && val !== null && 'toMillis' in val) {
    try {
      return (val as { toMillis: () => number }).toMillis();
    } catch {
      return 0;
    }
  }
  return 0;
}

function getUtf8ByteLength(text: string): number {
  try {
    return new TextEncoder().encode(text).length;
  } catch {
    return text.length * 2;
  }
}

export function formatOfflineBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.max(1, Math.round(kb))} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

export function readOfflineBooksMap(): Record<string, OfflineBookRecord> {
  try {
    const raw = window.localStorage.getItem(OFFLINE_BOOKS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};

    const result: Record<string, OfflineBookRecord> = {};
    for (const [bookId, entry] of Object.entries(parsed)) {
      if (!entry || typeof entry !== 'object') continue;
      const rec = entry as Partial<OfflineBookRecord>;
      if (!rec.book || typeof rec.book !== 'object' || typeof rec.book.id !== 'string') {
        continue;
      }
      if (!rec.book.allowDownload) continue;
      result[bookId] = {
        book: rec.book,
        savedAt: typeof rec.savedAt === 'number' ? rec.savedAt : Date.now(),
        sizeBytes: typeof rec.sizeBytes === 'number' ? rec.sizeBytes : 0,
      };
    }
    return result;
  } catch {
    return {};
  }
}

function writeOfflineBooksMap(map: Record<string, OfflineBookRecord>): void {
  try {
    window.localStorage.setItem(OFFLINE_BOOKS_STORAGE_KEY, JSON.stringify(map));
  } catch (err) {
    const isQuotaError =
      err instanceof DOMException &&
      (err.name === 'QuotaExceededError' ||
        err.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
        err.code === 22);
    if (isQuotaError) {
      throw new Error(
        'Kaydka localStorage waa buuxsamay. Fadlan ka saar buugagga qaar kaydka Offline si aad mid cusub u kaydiso.'
      );
    }
    throw new Error('Kaydinta localStorage way fashilantay. Hubi in browser-ku oggol yahay kaydinta.');
  }
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Faylka lama beddeli karin.'));
      }
    };
    reader.onerror = () => reject(new Error('Faylka lama akhrin karin.'));
    reader.readAsDataURL(blob);
  });
}

export async function saveBookForOffline(
  book: Book
): Promise<Record<string, OfflineBookRecord>> {
  if (!book.allowDownload) {
    throw new Error('Buuggan waa Akhris Kaliya; looma oggola kaydinta Offline.');
  }

  let contentText = book.contentText || '';
  let fileUrl = book.fileUrl || '';

  // If this is a downloadable text book without inline contentText, try fetching the text file
  if (!contentText.trim() && fileUrl && book.fileType === 'txt') {
    try {
      const response = await fetch(fileUrl);
      if (response.ok) {
        const fetchedText = await response.text();
        if (fetchedText.trim()) {
          contentText = fetchedText.slice(0, BLUEPRINT_LIMITS.book.contentTextMax);
        }
      }
    } catch {
      // Best-effort fetch; proceed with available metadata/description
    }
  } else if (
    !contentText.trim() &&
    fileUrl &&
    !fileUrl.startsWith('data:') &&
    book.fileType === 'pdf'
  ) {
    // Best-effort inline cache for small PDFs so they can even render offline
    try {
      const fetchTarget = isMaktabadaCloudFileUrl(fileUrl)
        ? await resolveBookFileUrl(book)
        : fileUrl;
      const response = await fetch(fetchTarget);
      if (response.ok) {
        const blob = await response.blob();
        if (blob.size > 0 && blob.size <= MAX_INLINE_FILE_BYTES) {
          fileUrl = await blobToDataUrl(blob);
        }
      }
    } catch {
      // Ignore CORS or network restrictions
    }
  }

  const snapshot: Book = {
    id: book.id,
    title: book.title,
    author: book.author,
    category: book.category,
    description: book.description || '',
    coverUrl: book.coverUrl || '',
    fileUrl,
    fileName: book.fileName || '',
    fileType: book.fileType,
    allowDownload: true,
    published: book.published,
    contentText:
      contentText.trim() ||
      (book.description
        ? `${book.title}\nQoraaga: ${book.author}\n\n${book.description}`
        : ''),
    createdBy: book.createdBy || '',
    ratingSum: book.ratingSum ?? 0,
    ratingCount: book.ratingCount ?? 0,
    createdAt: normalizeTimestamp(book.createdAt),
    updatedAt: normalizeTimestamp(book.updatedAt),
    ...(book.isStarter ? { isStarter: true } : {}),
  };

  const draftRecord: OfflineBookRecord = {
    book: snapshot,
    savedAt: Date.now(),
    sizeBytes: 0,
  };
  draftRecord.sizeBytes = getUtf8ByteLength(JSON.stringify(draftRecord));

  const current = readOfflineBooksMap();
  const nextMap: Record<string, OfflineBookRecord> = {
    ...current,
    [book.id]: draftRecord,
  };

  writeOfflineBooksMap(nextMap);
  return nextMap;
}

export function removeBookFromOffline(
  bookId: string
): Record<string, OfflineBookRecord> {
  const current = readOfflineBooksMap();
  if (!(bookId in current)) return current;
  const nextMap = { ...current };
  delete nextMap[bookId];
  writeOfflineBooksMap(nextMap);
  return nextMap;
}

export function clearAllOfflineBooks(): Record<string, OfflineBookRecord> {
  try {
    window.localStorage.removeItem(OFFLINE_BOOKS_STORAGE_KEY);
  } catch {
    // Ignore storage removal errors
  }
  return {};
}

function getOfflineProgressKey(uid: string | undefined): string {
  return `${OFFLINE_PROGRESS_STORAGE_PREFIX}${uid || 'guest'}`;
}

export function readOfflineProgressMap(
  uid: string | undefined
): Record<string, ReadingProgress> {
  try {
    const raw = window.localStorage.getItem(getOfflineProgressKey(uid));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const cleaned: Record<string, ReadingProgress> = {};
    for (const [bookId, val] of Object.entries(parsed)) {
      if (!val || typeof val !== 'object') continue;
      const p = val as Partial<ReadingProgress>;
      if (typeof p.percentage === 'number' && typeof p.currentPage === 'number') {
        cleaned[bookId] = {
          userId: typeof p.userId === 'string' ? p.userId : uid || 'guest',
          bookId,
          percentage: p.percentage,
          currentPage: p.currentPage,
          totalPages: typeof p.totalPages === 'number' ? p.totalPages : 1,
          createdAt: p.createdAt ?? Date.now(),
          updatedAt: p.updatedAt ?? Date.now(),
        };
      }
    }
    return cleaned;
  } catch {
    return {};
  }
}

export function saveOfflineProgress(
  uid: string | undefined,
  bookId: string,
  next: { percentage: number; currentPage: number; totalPages: number }
): Record<string, ReadingProgress> {
  const current = readOfflineProgressMap(uid);
  const now = Date.now();
  const updated: Record<string, ReadingProgress> = {
    ...current,
    [bookId]: {
      userId: uid || 'guest',
      bookId,
      percentage: next.percentage,
      currentPage: next.currentPage,
      totalPages: next.totalPages,
      createdAt: current[bookId]?.createdAt ?? now,
      updatedAt: now,
    },
  };
  try {
    window.localStorage.setItem(getOfflineProgressKey(uid), JSON.stringify(updated));
  } catch {
    // Ignore quota errors for lightweight progress metadata
  }
  return updated;
}
