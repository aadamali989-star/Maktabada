import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  Bell,
  BellRing,
  Check,
  Search,
  BookOpen,
  Heart,
  LogOut,
  LogIn,
  Moon,
  Sun,
  HardDriveDownload,
  Image as ImageIcon,
  Palette,
  WifiOff,
  Trash2,
  X,
} from 'lucide-react';
import {
  computeReadingStreak,
  deleteBookRecord,
  extractErrorMessage,
  fetchUserBookRatings,
  getLocalDateKey,
  logoutUser,
  rateBook,
  recordDailyReadingSeconds,
  saveReadingProgress,
  seedStarterBooksIfEmpty,
  subscribeAuthAndProfile,
  subscribeBooks,
  subscribeUserReadingLogs,
  subscribeUserReadingProgress,
  toggleBookDownloadable,
  toggleFavoriteBook,
  updateDailyReminderSettings,
  upgradeStarterBookCovers,
} from './services/libraryService';
import {
  clearAllOfflineBooks,
  formatOfflineBytes,
  readOfflineBooksMap,
  readOfflineProgressMap,
  removeBookFromOffline,
  saveBookForOffline,
  saveOfflineProgress,
} from './services/offlineStorage';
import { STARTER_BOOKS } from './data/starterBooks';
import type {
  AppSection,
  Book,
  DailyReadingLog,
  OfflineBookRecord,
  ReadingProgress,
  UserProfile,
} from './types';
import { AuthModal } from './components/AuthModal';
import { BookCard } from './components/BookCard';
import { ReaderModal } from './components/ReaderModal';
import { AdminPanel } from './components/AdminPanel';
import { RecentlyRead, type RecentlyReadItem } from './components/RecentlyRead';
import { ProfileDrawer } from './components/ProfileDrawer';
import { DailyNotificationModal } from './components/DailyNotificationModal';
import { UserAvatar } from './components/UserAvatar';
import { PWAInstallButton } from './components/PWAInstallButton';
import { heroLibrarySanctuaryUrl } from './assets/starterAssets';
import {
  getBrowserNotificationPermission,
  getLastReminderSentDate,
  getLocalTimeHHMM,
  getReminderDismissedDate,
  markReminderDismissedDate,
  markReminderSentDate,
  normalizeReminderTime,
  readCachedDailyReminder,
  requestBrowserNotificationPermission,
  showDailyReadingBrowserNotification,
  writeCachedDailyReminder,
  type DailyReminderSettings,
} from './services/dailyReminderService';

const READER_DARK_MODE_KEY = 'maktabada_reader_dark_mode';
const RECENTLY_READ_STORAGE_PREFIX = 'maktabada_recently_read_';

function readStoredReaderDarkMode(): boolean {
  try {
    return window.localStorage.getItem(READER_DARK_MODE_KEY) === 'true';
  } catch {
    return false;
  }
}

function getRecentStorageKey(uid: string | undefined): string {
  return `${RECENTLY_READ_STORAGE_PREFIX}${uid || 'guest'}`;
}

function readRecentViewedMap(uid: string | undefined): Record<string, number> {
  try {
    const raw = window.localStorage.getItem(getRecentStorageKey(uid));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const cleaned: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'number' && Number.isFinite(v)) {
        cleaned[k] = v;
      }
    }
    return cleaned;
  } catch {
    return {};
  }
}

function toTimestampMillis(val: unknown): number {
  if (!val) return 0;
  if (typeof val === 'number') return val;
  if (typeof val === 'object' && val !== null && 'toMillis' in val) {
    return (val as { toMillis: () => number }).toMillis();
  }
  return 0;
}

interface PendingReadingLog {
  uid: string;
  dateKey: string;
  seconds: number;
}

function restorePendingReadingLog(
  ref: { current: PendingReadingLog | null },
  pending: PendingReadingLog
): void {
  const current = ref.current;
  if (current && current.uid === pending.uid && current.dateKey === pending.dateKey) {
    current.seconds += pending.seconds;
  } else if (!current) {
    ref.current = pending;
  }
}

export default function App() {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);

  const [firestoreBooks, setFirestoreBooks] = useState<Book[]>([]);
  const [booksLoaded, setBooksLoaded] = useState(false);
  const seededRef = useRef(false);

  const [section, setSection] = useState<AppSection>('library');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [coverDisplayMode, setCoverDisplayMode] = useState<'image' | 'styled'>('image');
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [profileDrawerOpen, setProfileDrawerOpen] = useState(false);
  const [notificationModalOpen, setNotificationModalOpen] = useState(false);
  const openProfileOnAuthRef = useRef(false);
  const [activeBookId, setActiveBookId] = useState<string | null>(null);
  const [readerInitialTab, setReaderInitialTab] = useState<'read' | 'comments'>('read');
  const [userRatings, setUserRatings] = useState<Record<string, number>>({});
  const [readingProgressMap, setReadingProgressMap] = useState<Record<string, ReadingProgress>>({});
  const [offlineProgressMap, setOfflineProgressMap] = useState<Record<string, ReadingProgress>>(() =>
    readOfflineProgressMap(undefined)
  );
  const [offlineBooksMap, setOfflineBooksMap] = useState<Record<string, OfflineBookRecord>>(() =>
    readOfflineBooksMap()
  );
  const [offlineBusyBookId, setOfflineBusyBookId] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [ratingBusyBookId, setRatingBusyBookId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [readerDarkMode, setReaderDarkMode] = useState<boolean>(readStoredReaderDarkMode);
  const [recentViewedMap, setRecentViewedMap] = useState<Record<string, number>>(() =>
    readRecentViewedMap(undefined)
  );
  const [sessionSecondsByBook, setSessionSecondsByBook] = useState<Record<string, number>>({});
  const [readingLogsMap, setReadingLogsMap] = useState<Record<string, DailyReadingLog>>({});
  const [readingStreakLoading, setReadingStreakLoading] = useState<boolean>(false);
  const [reminderSettings, setReminderSettings] = useState<DailyReminderSettings>(() =>
    readCachedDailyReminder(undefined)
  );
  const [reminderSaving, setReminderSaving] = useState<boolean>(false);
  const [reminderErrorMsg, setReminderErrorMsg] = useState<string | null>(null);
  const [notificationPermission, setNotificationPermission] = useState<
    NotificationPermission | 'unsupported'
  >(() => getBrowserNotificationPermission());
  const [dailyReminderBanner, setDailyReminderBanner] = useState<{
    title: string;
    body: string;
  } | null>(null);
  const pendingReadingLogRef = useRef<PendingReadingLog | null>(null);

  const flushPendingReadingLog = useCallback(async () => {
    const pending = pendingReadingLogRef.current;
    if (!pending || pending.seconds <= 0 || !isOnline) return;
    pendingReadingLogRef.current = null;
    try {
      await recordDailyReadingSeconds(pending.uid, pending.dateKey, pending.seconds);
    } catch {
      restorePendingReadingLog(pendingReadingLogRef, pending);
    }
  }, [isOnline]);

  const handleReadingTick = useCallback(
    (bookId: string) => {
      setSessionSecondsByBook((prev) => ({
        ...prev,
        [bookId]: (prev[bookId] || 0) + 1,
      }));

      if (!user || !profile) return;
      const dateKey = getLocalDateKey();
      const current = pendingReadingLogRef.current;
      if (current && (current.uid !== user.uid || current.dateKey !== dateKey)) {
        void flushPendingReadingLog();
        pendingReadingLogRef.current = { uid: user.uid, dateKey, seconds: 1 };
        return;
      }

      if (current) {
        current.seconds += 1;
        if (current.seconds >= 30) {
          void flushPendingReadingLog();
        }
      } else {
        pendingReadingLogRef.current = { uid: user.uid, dateKey, seconds: 1 };
      }
    },
    [user, profile, flushPendingReadingLog]
  );

  const handleSetReaderDarkMode = (nextValue?: boolean) => {
    setReaderDarkMode((prev) => {
      const resolved = typeof nextValue === 'boolean' ? nextValue : !prev;
      try {
        window.localStorage.setItem(READER_DARK_MODE_KEY, String(resolved));
      } catch {
        // Ignore storage restrictions
      }
      return resolved;
    });
  };

  const openBookReader = (book: Book, tab: 'read' | 'comments' = 'read') => {
    const now = Date.now();
    setRecentViewedMap((prev) => {
      const next = { ...prev, [book.id]: now };
      const trimmed = Object.fromEntries(
        Object.entries(next)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 12)
      );
      try {
        window.localStorage.setItem(getRecentStorageKey(user?.uid), JSON.stringify(trimmed));
      } catch {
        // Ignore storage restrictions
      }
      return trimmed;
    });
    setReaderInitialTab(tab);
    setActiveBookId(book.id);
  };

  const isAdmin = profile?.role === 'admin';

  // Sync Tailwind v4 site-wide dark mode class on <html>
  useEffect(() => {
    document.documentElement.classList.toggle('dark', readerDarkMode);
  }, [readerDarkMode]);

  // Track browser online / offline connectivity
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Watch auth & user profile
  useEffect(() => {
    const unsub = subscribeAuthAndProfile(({ authReady: ready, user: u, profile: p }) => {
      setAuthReady(ready);
      setUser(u);
      setProfile(p);
      if (!u) {
        openProfileOnAuthRef.current = false;
        setProfileDrawerOpen(false);
      }
    });
    return () => unsub();
  }, []);

  // Automatically open ProfileDrawer immediately after user logs in or signs up
  useEffect(() => {
    if (openProfileOnAuthRef.current && user && profile) {
      setProfileDrawerOpen(true);
      openProfileOnAuthRef.current = false;
    }
  }, [user, profile]);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    window.setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 3500);
  }, []);

  const handleSelectSection = (nextSection: AppSection) => {
    setSection(nextSection);
    setSelectedCategories([]);
  };

  const toggleCategoryFilter = (category: string) => {
    if (category === 'Dhammaan') {
      setSelectedCategories([]);
      return;
    }
    setSelectedCategories((prev) =>
      prev.includes(category) ? prev.filter((item) => item !== category) : [...prev, category]
    );
  };

  // Subscribe to Firestore books once auth state is known
  useEffect(() => {
    if (!authReady) return;
    const unsub = subscribeBooks(
      isAdmin,
      (items) => {
        setFirestoreBooks(items);
        setBooksLoaded(true);
      },
      () => {
        setBooksLoaded(true);
      }
    );
    return () => unsub();
  }, [authReady, isAdmin]);

  // Seed starter Somali books into Firestore when an Admin signs into an empty database,
  // and refresh legacy starter cover URLs if they were seeded with earlier placeholder covers.
  useEffect(() => {
    if (!authReady || !booksLoaded || !isAdmin || !user || seededRef.current) return;
    if (firestoreBooks.length === 0) {
      seededRef.current = true;
      void seedStarterBooksIfEmpty(user.uid).catch((err) => {
        console.error('Failed to seed starter books:', err);
      });
    } else {
      seededRef.current = true;
      void upgradeStarterBookCovers(firestoreBooks);
    }
  }, [authReady, booksLoaded, isAdmin, user, firestoreBooks]);

  // Fetch current user's existing star ratings for Firestore-backed books
  useEffect(() => {
    if (!authReady || !user || firestoreBooks.length === 0) {
      setUserRatings({});
      return;
    }
    let cancelled = false;
    void fetchUserBookRatings(
      user.uid,
      firestoreBooks.map((b) => b.id)
    )
      .then((ratingsMap) => {
        if (!cancelled) setUserRatings(ratingsMap);
      })
      .catch(() => {
        // Ignore transient offline/rating lookup errors
      });
    return () => {
      cancelled = true;
    };
  }, [authReady, user, firestoreBooks]);

  // Subscribe to signed-in user's per-book reading progress
  useEffect(() => {
    if (!authReady) return;
    setRecentViewedMap(readRecentViewedMap(user?.uid));
    setOfflineProgressMap(readOfflineProgressMap(user?.uid));
    if (!user) {
      setReadingProgressMap({});
      return;
    }
    const unsub = subscribeUserReadingProgress(user.uid, (progressMap) => {
      setReadingProgressMap(progressMap);
    });
    return () => unsub();
  }, [authReady, user]);

  // Subscribe to signed-in user's daily reading logs for Firestore-backed 15-minute Reading Streak
  useEffect(() => {
    if (!authReady) return;
    if (!user) {
      setReadingLogsMap({});
      setReadingStreakLoading(false);
      return;
    }
    setReadingStreakLoading(true);
    const unsub = subscribeUserReadingLogs(
      user.uid,
      (logsMap) => {
        setReadingLogsMap(logsMap);
        setReadingStreakLoading(false);
      },
      () => {
        setReadingStreakLoading(false);
      }
    );
    return () => unsub();
  }, [authReady, user]);

  // Flush pending reading seconds when the page hides or connectivity returns
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        void flushPendingReadingLog();
      }
    };
    const handlePageHide = () => {
      void flushPendingReadingLog();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pagehide', handlePageHide);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, [flushPendingReadingLog]);

  useEffect(() => {
    if (isOnline) {
      void flushPendingReadingLog();
    }
  }, [isOnline, flushPendingReadingLog]);

  const readingStreak = useMemo(() => computeReadingStreak(readingLogsMap), [readingLogsMap]);

  const totalSessionSeconds = useMemo(
    () => Object.values(sessionSecondsByBook).reduce((sum, sec) => sum + (sec || 0), 0),
    [sessionSecondsByBook]
  );

  const effectiveTodaySeconds = user
    ? Math.max(readingStreak.todaySeconds, totalSessionSeconds)
    : totalSessionSeconds;

  const effectiveGoalMinutes =
    typeof profile?.dailyReadingGoalMinutes === 'number' &&
    profile.dailyReadingGoalMinutes >= 5 &&
    profile.dailyReadingGoalMinutes <= 480
      ? profile.dailyReadingGoalMinutes
      : 15;

  // Sync reminder settings from Firestore profile (when logged in) or localStorage cache (guest/offline)
  useEffect(() => {
    const cached = readCachedDailyReminder(user?.uid);
    if (user && profile) {
      const resolved: DailyReminderSettings = {
        enabled:
          typeof profile.dailyReminderEnabled === 'boolean'
            ? profile.dailyReminderEnabled
            : cached.enabled,
        time: normalizeReminderTime(profile.dailyReminderTime || cached.time),
      };
      setReminderSettings(resolved);
      writeCachedDailyReminder(user.uid, resolved);
    } else {
      setReminderSettings(cached);
    }
    setNotificationPermission(getBrowserNotificationPermission());
  }, [user, profile?.uid, profile?.dailyReminderEnabled, profile?.dailyReminderTime]);

  const handleRequestReminderPermission = useCallback(async () => {
    const permission = await requestBrowserNotificationPermission();
    setNotificationPermission(permission);
    if (permission === 'granted') {
      showToast('Ogeysiisyada browser-ka waa la oggolaaday.');
    } else if (permission === 'denied') {
      showToast(
        'Browser-ku wuu diiday ogeysiiska tooska ah; xasuusinta gudaha website-ka ayaad weli heli doontaa.'
      );
    }
  }, [showToast]);

  const saveReminderSettings = useCallback(
    async (nextEnabled: boolean, nextTime: string) => {
      const cleanTime = normalizeReminderTime(nextTime);
      setReminderErrorMsg(null);
      setReminderSaving(true);
      try {
        if (nextEnabled && getBrowserNotificationPermission() === 'default') {
          const permission = await requestBrowserNotificationPermission();
          setNotificationPermission(permission);
        }

        if (user && profile) {
          const saved = await updateDailyReminderSettings(user.uid, nextEnabled, cleanTime);
          setReminderSettings(saved);
          writeCachedDailyReminder(user.uid, saved);
          showToast(
            saved.enabled
              ? `Xasuusinta maalinlaha ah waa la daaray (${saved.time}).`
              : 'Xasuusinta maalinlaha ah waa la damiyay.'
          );
        } else {
          const saved: DailyReminderSettings = { enabled: nextEnabled, time: cleanTime };
          setReminderSettings(saved);
          writeCachedDailyReminder(undefined, saved);
          showToast(
            saved.enabled
              ? `Xasuusinta maalinlaha ah waa la daaray (${saved.time}).`
              : 'Xasuusinta maalinlaha ah waa la damiyay.'
          );
        }
      } catch (err) {
        setReminderErrorMsg(
          err instanceof Error ? err.message : 'Xasuusinta maalinlaha ah lama kaydin karin.'
        );
      } finally {
        setReminderSaving(false);
      }
    },
    [user, profile, showToast]
  );

  const triggerDailyReminder = useCallback(
    async (isTest = false) => {
      if (isTest && getBrowserNotificationPermission() === 'default') {
        const perm = await requestBrowserNotificationPermission();
        setNotificationPermission(perm);
      }

      const todayMinutes = Math.floor(effectiveTodaySeconds / 60);
      const remainingMinutes = Math.max(0, effectiveGoalMinutes - todayMinutes);

      const title = isTest
        ? 'Tijaabada Xasuusinta Akhriska · maktabada.so'
        : 'Waqtigii Akhriska Maanta · maktabada.so';
      const body =
        remainingMinutes > 0
          ? `Waxaa kuu haray ${remainingMinutes} daqiiqo si aad u gaarto hadafkaaga maanta (${effectiveGoalMinutes} daqiiqo).${
              readingStreak.currentStreak > 0
                ? ` Ilaali ${readingStreak.currentStreak}-maalmood streak-kaaga!`
                : ''
            }`
          : `Hadafkaaga maanta (${effectiveGoalMinutes} daqiiqo) waad buuxisay! Waad sii akhrisan kartaa bogagga cusub.`;

      setDailyReminderBanner({ title, body });
      const nativeShown = await showDailyReadingBrowserNotification({
        title,
        body,
        tag: isTest ? `maktabada-reminder-test-${Date.now()}` : 'maktabada-daily-reading-reminder',
      });
      if (isTest) {
        showToast(
          nativeShown
            ? 'Ogeysiiska tijaabada waa la diray (Browser + Website).'
            : 'Ogeysiiska tijaabada waxaa laga muujiyay bogga sare ee website-ka.'
        );
      }
    },
    [
      effectiveTodaySeconds,
      effectiveGoalMinutes,
      readingStreak.currentStreak,
      showToast,
    ]
  );

  useEffect(() => {
    if (!authReady) return;

    const checkDailyReminder = () => {
      if (!reminderSettings.enabled) {
        setDailyReminderBanner(null);
        return;
      }

      const targetTime = normalizeReminderTime(reminderSettings.time);
      const goalCompleted = effectiveTodaySeconds >= effectiveGoalMinutes * 60;
      if (goalCompleted) {
        setDailyReminderBanner(null);
        return;
      }

      const todayKey = getLocalDateKey();
      const dismissedToday = getReminderDismissedDate(user?.uid) === todayKey;
      if (dismissedToday) {
        return;
      }

      const nowTime = getLocalTimeHHMM();
      if (nowTime < targetTime) {
        return;
      }

      const alreadySentToday = getLastReminderSentDate(user?.uid) === todayKey;
      if (!alreadySentToday) {
        markReminderSentDate(user?.uid, todayKey);
        void triggerDailyReminder(false);
      } else if (!dailyReminderBanner) {
        const remainingMinutes = Math.max(
          1,
          effectiveGoalMinutes - Math.floor(effectiveTodaySeconds / 60)
        );
        setDailyReminderBanner({
          title: 'Xasuusinta Akhriska Maanta · maktabada.so',
          body: `Waxaa kuu haray ${remainingMinutes} daqiiqo si aad u gaarto hadafkaaga maanta (${effectiveGoalMinutes} daqiiqo).`,
        });
      }
    };

    checkDailyReminder();
    const interval = window.setInterval(checkDailyReminder, 20000);
    return () => window.clearInterval(interval);
  }, [
    authReady,
    user?.uid,
    reminderSettings.enabled,
    reminderSettings.time,
    effectiveTodaySeconds,
    effectiveGoalMinutes,
    dailyReminderBanner,
    triggerDailyReminder,
  ]);

  const effectiveProgressMap = useMemo(() => {
    const merged: Record<string, ReadingProgress> = { ...offlineProgressMap };
    for (const [bookId, remote] of Object.entries(readingProgressMap)) {
      const local = merged[bookId];
      if (!local) {
        merged[bookId] = remote;
        continue;
      }
      const remoteMs = toTimestampMillis(remote.updatedAt) || toTimestampMillis(remote.createdAt);
      const localMs = toTimestampMillis(local.updatedAt) || toTimestampMillis(local.createdAt);
      merged[bookId] = remoteMs >= localMs ? remote : local;
    }
    return merged;
  }, [offlineProgressMap, readingProgressMap]);

  const offlineRecords = useMemo(
    () => Object.values(offlineBooksMap).sort((a, b) => b.savedAt - a.savedAt),
    [offlineBooksMap]
  );

  const totalOfflineBytes = useMemo(
    () => offlineRecords.reduce((sum, rec) => sum + (rec.sizeBytes || 0), 0),
    [offlineRecords]
  );

  // Prune offline-cached books when online Firestore confirms deletion, unpublishing, or revoked download permission
  useEffect(() => {
    if (!isOnline || !booksLoaded || firestoreBooks.length === 0) return;
    const remoteById = new Map(firestoreBooks.map((b) => [b.id, b]));
    let nextMap: Record<string, OfflineBookRecord> | null = null;

    for (const rec of Object.values(offlineBooksMap)) {
      const remote = remoteById.get(rec.book.id);
      const shouldRemove = remote
        ? !remote.allowDownload || (!remote.published && !isAdmin)
        : !rec.book.isStarter;
      if (shouldRemove) {
        nextMap = removeBookFromOffline(rec.book.id);
      }
    }

    if (nextMap) {
      setOfflineBooksMap(nextMap);
    }
  }, [isOnline, booksLoaded, firestoreBooks, offlineBooksMap, isAdmin]);

  // Show Firestore books when online and loaded; otherwise fall back to starter + offline-saved localStorage books
  const books: Book[] = useMemo(() => {
    if (isOnline && firestoreBooks.length > 0) {
      return firestoreBooks;
    }
    const base = firestoreBooks.length > 0 ? firestoreBooks : STARTER_BOOKS;
    const byId = new Map<string, Book>();
    for (const b of base) {
      byId.set(b.id, b);
    }
    for (const rec of offlineRecords) {
      byId.set(rec.book.id, rec.book);
    }
    return Array.from(byId.values());
  }, [firestoreBooks, offlineRecords, isOnline]);

  const activeBook = useMemo(
    () => (activeBookId ? books.find((b) => b.id === activeBookId) ?? null : null),
    [books, activeBookId]
  );

  const recentlyReadItems = useMemo<RecentlyReadItem[]>(() => {
    const items: RecentlyReadItem[] = [];
    for (const book of books) {
      const progress = effectiveProgressMap[book.id];
      const progressAt =
        toTimestampMillis(progress?.updatedAt) || toTimestampMillis(progress?.createdAt);
      const viewedAt = recentViewedMap[book.id] || 0;
      const lastActivityAt = Math.max(viewedAt, progressAt);
      if (lastActivityAt > 0) {
        items.push({ book, progress, lastActivityAt });
      }
    }
    return items.sort((a, b) => b.lastActivityAt - a.lastActivityAt).slice(0, 3);
  }, [books, effectiveProgressMap, recentViewedMap]);

  const categories = useMemo(() => {
    const unique = Array.from(new Set(books.map((b) => b.category).filter(Boolean)));
    return ['Dhammaan', ...unique];
  }, [books]);

  const favorites = profile?.favorites ?? [];

  const sectionBooks = useMemo(() => {
    return books.filter((book) => {
      if (section === 'favorites' && !favorites.includes(book.id)) {
        return false;
      }
      if (section === 'offline' && !offlineBooksMap[book.id]) {
        return false;
      }
      return true;
    });
  }, [books, section, favorites, offlineBooksMap]);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { Dhammaan: sectionBooks.length };
    for (const book of sectionBooks) {
      if (book.category) {
        counts[book.category] = (counts[book.category] || 0) + 1;
      }
    }
    return counts;
  }, [sectionBooks]);

  const activeCategories = useMemo(
    () => selectedCategories.filter((cat) => categories.includes(cat)),
    [selectedCategories, categories]
  );

  const filteredBooks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return sectionBooks.filter((book) => {
      if (activeCategories.length > 0 && !activeCategories.includes(book.category)) {
        return false;
      }
      if (!q) return true;
      return (
        book.title.toLowerCase().includes(q) ||
        book.author.toLowerCase().includes(q) ||
        book.category.toLowerCase().includes(q) ||
        book.description.toLowerCase().includes(q)
      );
    });
  }, [sectionBooks, activeCategories, searchQuery]);

  const handleToggleFavorite = async (bookId: string) => {
    if (!user || !profile) {
      setAuthModalOpen(true);
      showToast('Fadlan soo gal akoonkaaga si aad u kaydsato buugagga aad jeceshahay.');
      return;
    }
    const alreadyFav = favorites.includes(bookId);
    try {
      await toggleFavoriteBook(user.uid, favorites, bookId);
      showToast(alreadyFav ? 'Buugga waa laga saaray kaydkaaga.' : 'Buugga waxaa lagu daray Favorites.');
    } catch (err) {
      showToast(`Favorites lama cusboonaysiin karin: ${extractErrorMessage(err)}`);
    }
  };

  const handleRateBook = async (bookId: string, rating: number) => {
    if (!user || !profile) {
      setAuthModalOpen(true);
      showToast('Fadlan soo gal akoonkaaga si aad u qiimayso buugagga.');
      return;
    }
    if (firestoreBooks.length === 0) {
      showToast('Fadlan ku gal Admin si buugagga tijaabada loogu kaydiyo Firestore.');
      return;
    }
    const previousRating = userRatings[bookId];
    setUserRatings((prev) => ({ ...prev, [bookId]: rating }));
    setRatingBusyBookId(bookId);
    try {
      await rateBook(user.uid, bookId, rating);
      showToast(`Waad ku mahadsan tahay qiimayntaada (${rating}/5).`);
    } catch (err) {
      setUserRatings((prev) => {
        const next = { ...prev };
        if (previousRating !== undefined) {
          next[bookId] = previousRating;
        } else {
          delete next[bookId];
        }
        return next;
      });
      let msg = err instanceof Error ? err.message : String(err);
      try {
        const parsed = JSON.parse(msg) as { error?: string };
        if (parsed.error) msg = parsed.error;
      } catch {
        // Plain error message
      }
      showToast(`Qiimaynta lama kaydin karin: ${msg}`);
    } finally {
      setRatingBusyBookId(null);
    }
  };

  const handleSaveProgress = (
    bookId: string,
    next: { percentage: number; currentPage: number; totalPages: number }
  ) => {
    if (!isOnline || Boolean(offlineBooksMap[bookId]) || !user) {
      setOfflineProgressMap(saveOfflineProgress(user?.uid, bookId, next));
    }
    if (!user) return;

    // Update local state immediately for snappy UX
    setReadingProgressMap((prev) => ({
      ...prev,
      [bookId]: {
        userId: user.uid,
        bookId,
        percentage: next.percentage,
        currentPage: next.currentPage,
        totalPages: next.totalPages,
        createdAt: prev[bookId]?.createdAt ?? Date.now(),
        updatedAt: Date.now(),
      },
    }));

    // Persist to Firestore when online and the book document exists in Firestore
    if (isOnline && firestoreBooks.some((b) => b.id === bookId)) {
      void saveReadingProgress(user.uid, bookId, next).catch((err) => {
        console.error('Failed to save reading progress:', err);
      });
    }
  };

  const handleToggleOffline = async (book: Book) => {
    if (!book.allowDownload) {
      showToast('Buuggan waa Akhris Kaliya; looma oggola kaydinta Offline.');
      return;
    }

    if (offlineBooksMap[book.id]) {
      setOfflineBooksMap(removeBookFromOffline(book.id));
      showToast('Buugga waa laga saaray kaydka Offline.');
      return;
    }

    setOfflineBusyBookId(book.id);
    try {
      const nextMap = await saveBookForOffline(book);
      setOfflineBooksMap(nextMap);
      showToast('Buugga waxaa loo kaydiyay akhriska Offline (localStorage).');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Buugga lama kaydin karin.');
    } finally {
      setOfflineBusyBookId(null);
    }
  };

  const handleClearAllOffline = () => {
    setOfflineBooksMap(clearAllOfflineBooks());
    showToast('Dhammaan buugagga kaydka Offline waa la tirtiray.');
  };

  const handleDeleteBook = async (bookId: string) => {
    try {
      await deleteBookRecord(bookId);
      setOfflineBooksMap(removeBookFromOffline(bookId));
      setConfirmDeleteId(null);
      showToast('Buugga waa la tirtiray.');
    } catch (err) {
      showToast(`Buugga lama tirtiri karin: ${extractErrorMessage(err)}`);
    }
  };

  const handleToggleDownloadable = async (book: Book) => {
    try {
      const nextAllow = !book.allowDownload;
      await toggleBookDownloadable(book.id, nextAllow);
      if (!nextAllow && offlineBooksMap[book.id]) {
        setOfflineBooksMap(removeBookFromOffline(book.id));
      }
      showToast(
        nextAllow
          ? 'Soo dejinta (Download) waa loo furay buuggan.'
          : 'Buuggan waxaa laga dhigay Akhris Kaliya.'
      );
    } catch (err) {
      showToast(`Oggolaanshaha download-ka lama beddeli karin: ${extractErrorMessage(err)}`);
    }
  };

  const handleLogout = async () => {
    try {
      await flushPendingReadingLog();
      await logoutUser(user?.uid);
      if (section === 'admin') {
        handleSelectSection('library');
      }
      showToast('Waad ka baxday akoonkaaga.');
    } catch (err) {
      showToast(`Ka bixidda akoonka way fashilantay: ${extractErrorMessage(err)}`);
    }
  };

  const navItems: Array<{ id: AppSection; label: string }> = [
    { id: 'library', label: 'Maktabadda' },
    { id: 'favorites', label: 'Kaydkaaga' },
    {
      id: 'offline',
      label: offlineRecords.length > 0 ? `Offline (${offlineRecords.length})` : 'Offline',
    },
    ...(isAdmin ? [{ id: 'admin' as AppSection, label: 'Admin Panel' }] : []),
  ];

  const downloadableCount = books.filter((b) => b.allowDownload).length;

  return (
    <div className="min-h-screen flex flex-col bg-[#F8F6F1] dark:bg-[#111110] text-[#1C1917] dark:text-[#F5F2EB] transition-colors">
      {/* Top Bar Contract: 1 row, 3 zones separated by gap-8 */}
      <header className="sticky top-0 z-30 bg-[#F8F6F1]/95 dark:bg-[#111110]/95 backdrop-blur-sm border-b border-[#E5E0D5] dark:border-[#2E2C29]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
          {/* Zone 1: Single text wordmark */}
          <button
            type="button"
            onClick={() => handleSelectSection('library')}
            className="font-serif text-xl font-semibold tracking-tight text-[#1C1917] dark:text-[#F5F2EB] whitespace-nowrap shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#14532D] rounded"
          >
            maktabada.so
          </button>

          {/* Zone 2: Concise single-line text nav links */}
          <nav
            aria-label="Bogagga muhiimka ah"
            className="hidden md:flex items-center gap-6 text-sm font-medium"
          >
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelectSection(item.id)}
                className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                  section === item.id
                    ? 'border-[#14532D] dark:border-[#4ADE80] text-[#1C1917] dark:text-[#F5F2EB]'
                    : 'border-transparent text-[#57534E] dark:text-[#A8A29E] hover:text-[#1C1917] dark:hover:text-[#F5F2EB]'
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>

          {/* Zone 3: PWA Install, Daily Notification Bell, Dark Mode toggle, Profile Drawer trigger & auth action */}
          <div className="flex items-center gap-2 shrink-0">
            <PWAInstallButton />
            <button
              type="button"
              onClick={() => {
                setNotificationPermission(getBrowserNotificationPermission());
                setNotificationModalOpen(true);
              }}
              aria-label="Xasuusinta Maalinlaha ah (Daily Notification)"
              title="Xasuusinta Maalinlaha ah (Daily Notification)"
              className={`relative inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                reminderSettings.enabled
                  ? 'bg-[#14532D]/10 dark:bg-[#15803D]/25 border-[#14532D]/30 dark:border-[#22C55E]/40 text-[#14532D] dark:text-[#4ADE80] hover:bg-[#14532D]/15 dark:hover:bg-[#15803D]/35'
                  : 'bg-white dark:bg-[#1C1B19] border-[#D6CEBE] dark:border-[#383531] text-[#57534E] dark:text-[#D6D3CD] hover:text-[#1C1917] dark:hover:text-[#F5F2EB] hover:bg-[#EFECE5] dark:hover:bg-[#292724]'
              }`}
            >
              {reminderSettings.enabled ? (
                <BellRing className="w-3.5 h-3.5 shrink-0" />
              ) : (
                <Bell className="w-3.5 h-3.5 shrink-0" />
              )}
              <span className="hidden min-[440px]:inline">
                {reminderSettings.enabled ? `Xasuusin · ${reminderSettings.time}` : 'Xasuusin'}
              </span>
              {(reminderSettings.enabled || dailyReminderBanner) && (
                <span
                  aria-hidden="true"
                  className="w-2 h-2 rounded-full bg-[#15803D] dark:bg-[#4ADE80]"
                />
              )}
            </button>
            <button
              type="button"
              onClick={() => handleSetReaderDarkMode()}
              aria-pressed={readerDarkMode}
              aria-label={
                readerDarkMode
                  ? 'Demi Dark Mode-ka bogga'
                  : 'Shid Dark Mode-ka bogga'
              }
              title="Qaabka Madow (Dark Mode)"
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                readerDarkMode
                  ? 'bg-[#242320] border-[#383531] text-[#F5F2EB] hover:bg-[#2E2C29]'
                  : 'bg-white border-[#D6CEBE] text-[#57534E] hover:text-[#1C1917] hover:bg-[#EFECE5]'
              }`}
            >
              {readerDarkMode ? (
                <Sun className="w-3.5 h-3.5 text-[#FBBF24]" />
              ) : (
                <Moon className="w-3.5 h-3.5" />
              )}
              <span className="hidden min-[440px]:inline">Dark Mode</span>
            </button>

            {user ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    void flushPendingReadingLog();
                    setProfileDrawerOpen(true);
                  }}
                  aria-label="Fur bogga akoonkaaga (Profile)"
                  className="inline-flex items-center gap-2 pl-1.5 pr-3 py-1.5 text-xs font-medium border border-[#D6CEBE] dark:border-[#383531] bg-white dark:bg-[#1C1B19] text-[#1C1917] dark:text-[#F5F2EB] rounded-lg hover:bg-[#EFECE5] dark:hover:bg-[#292724] transition-colors whitespace-nowrap shrink-0"
                >
                  <UserAvatar
                    src={profile?.avatarUrl || user?.photoURL}
                    name={profile?.name || user?.displayName || 'Akhriste'}
                    sizeClass="w-6 h-6"
                    textClass="text-[10px]"
                  />
                  <span className="max-w-[96px] truncate hidden sm:inline">
                    {profile?.name || 'Akoonka'}
                  </span>
                  <span className="sm:hidden">Akoonka</span>
                </button>

                <button
                  type="button"
                  onClick={handleLogout}
                  aria-label="Ka bax akoonka"
                  title="Ka Bax"
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-[#D6CEBE] dark:border-[#383531] bg-white dark:bg-[#1C1B19] text-[#1C1917] dark:text-[#F5F2EB] rounded-lg hover:bg-[#EFECE5] dark:hover:bg-[#292724] transition-colors whitespace-nowrap shrink-0"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span className="hidden lg:inline">Ka Bax</span>
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setAuthModalOpen(true)}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium bg-[#14532D] dark:bg-[#15803D] text-white rounded-lg hover:bg-[#0F3F22] dark:hover:bg-[#166534] transition-colors whitespace-nowrap shrink-0"
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>Soo Gal</span>
              </button>
            )}
          </div>
        </div>

        {/* Mobile navigation row */}
        <nav
          aria-label="Menu-ga taleefanka"
          className="md:hidden border-t border-[#EFECE5] dark:border-[#2E2C29] px-4 py-2 flex items-center gap-4 overflow-x-auto text-xs font-medium"
        >
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => handleSelectSection(item.id)}
              className={`py-1 whitespace-nowrap shrink-0 border-b-2 ${
                section === item.id
                  ? 'border-[#14532D] dark:border-[#4ADE80] text-[#1C1917] dark:text-[#F5F2EB]'
                  : 'border-transparent text-[#57534E] dark:text-[#A8A29E]'
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </header>

      {/* Main Content */}
      <main className="flex-1">
        {!isOnline && (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-5">
            <div
              role="status"
              className="bg-white dark:bg-[#1C1B19] border border-[#D6CEBE] dark:border-[#383531] rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3"
            >
              <div className="flex items-center gap-2.5 text-xs sm:text-sm text-[#1C1917] dark:text-[#F5F2EB]">
                <WifiOff className="w-4 h-4 text-[#9A3412] dark:text-[#FB923C] shrink-0" />
                <span>
                  Internet ma jiro (Offline). Waxaad akhrisan kartaa{' '}
                  <strong className="font-mono tabular-nums">{offlineRecords.length}</strong> buug oo ku kaydsan localStorage.
                </span>
              </div>
              {section !== 'offline' && (
                <button
                  type="button"
                  onClick={() => handleSelectSection('offline')}
                  className="px-3 py-1.5 text-xs font-medium bg-[#14532D] dark:bg-[#15803D] text-white rounded-lg hover:bg-[#0F3F22] dark:hover:bg-[#166534] transition-colors whitespace-nowrap shrink-0"
                >
                  Eeg Kaydka Offline
                </button>
              )}
            </div>
          </div>
        )}

        {dailyReminderBanner && (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-5">
            <div
              role="status"
              className="bg-[#14532D]/[0.06] dark:bg-[#15803D]/15 border border-[#14532D]/25 dark:border-[#22C55E]/30 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3"
            >
              <div className="flex items-start sm:items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-[#14532D] dark:bg-[#15803D] text-white flex items-center justify-center shrink-0">
                  <BellRing className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-[#14532D] dark:text-[#4ADE80]">
                    {dailyReminderBanner.title}
                  </p>
                  <p className="text-xs sm:text-sm text-[#1C1917] dark:text-[#F5F2EB]">
                    {dailyReminderBanner.body}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    const latestBook = recentlyReadItems[0]?.book || filteredBooks[0] || books[0];
                    setDailyReminderBanner(null);
                    markReminderDismissedDate(user?.uid, getLocalDateKey());
                    if (latestBook) {
                      openBookReader(latestBook, 'read');
                    }
                  }}
                  className="px-3 py-1.5 text-xs font-medium bg-[#14532D] dark:bg-[#15803D] text-white rounded-lg hover:bg-[#0F3F22] dark:hover:bg-[#166534] transition-colors whitespace-nowrap"
                >
                  Akhri Hadda
                </button>
                <button
                  type="button"
                  onClick={() => {
                    markReminderDismissedDate(user?.uid, getLocalDateKey());
                    setDailyReminderBanner(null);
                  }}
                  aria-label="Xir xasuusinta maanta"
                  className="p-1.5 rounded-lg text-[#57534E] dark:text-[#A8A29E] hover:text-[#1C1917] dark:hover:text-[#F5F2EB] hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}

        {section === 'library' && (
          <>
            {/* Editorial Hero Showcase */}
            <section className="max-w-7xl mx-auto px-4 sm:px-6 pt-8 sm:pt-12 pb-10">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
                <div className="lg:col-span-6 flex flex-col justify-between bg-white dark:bg-[#1C1B19] border border-[#E5E0D5] dark:border-[#2E2C29] rounded-xl p-8 sm:p-10">
                  <div>
                    <p className="text-xs tracking-widest uppercase text-[#78716C] dark:text-[#A8A29E] mb-3">
                      Maktabadda Dhijitaalka ah · Af-Soomaali
                    </p>
                    <h1 className="font-serif text-3xl sm:text-5xl font-semibold text-[#1C1917] dark:text-[#F5F2EB] leading-[1.12] tracking-tight mb-5">
                      Aqoon la wadaago oo meel kasta laga akhriyo.
                    </h1>
                    <p className="text-base text-[#57534E] dark:text-[#A8A29E] leading-relaxed max-w-xl mb-8">
                      Ka hel buugag cilmi ah, suugaan, taariikh, iyo qoraallo casri ah oo Af-Soomaali ah. Ku akhriso qaabka Light, Sepia, ama Dark, kaydso kuwaad jeceshahay, ama soo dejiso buugagga furan.
                    </p>
                    <div className="flex flex-wrap items-center gap-3">
                      <a
                        href="#catalog"
                        className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium bg-[#14532D] dark:bg-[#15803D] text-white rounded-lg hover:bg-[#0F3F22] dark:hover:bg-[#166534] transition-colors whitespace-nowrap shrink-0"
                      >
                        <BookOpen className="w-4 h-4" />
                        Eeg Buugagga
                      </a>
                      {user ? (
                        <button
                          type="button"
                          onClick={() => {
                            void flushPendingReadingLog();
                            setProfileDrawerOpen(true);
                          }}
                          className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium border border-[#D6CEBE] dark:border-[#383531] text-[#1C1917] dark:text-[#F5F2EB] rounded-lg hover:bg-[#F8F6F1] dark:hover:bg-[#292724] transition-colors whitespace-nowrap shrink-0"
                        >
                          Eeg Akoonkaaga ({favorites.length} Favorites)
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setAuthModalOpen(true)}
                          className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium border border-[#D6CEBE] dark:border-[#383531] text-[#1C1917] dark:text-[#F5F2EB] rounded-lg hover:bg-[#F8F6F1] dark:hover:bg-[#292724] transition-colors whitespace-nowrap shrink-0"
                        >
                          Sameyso Akoon
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Quiet typographic metrics footer inside hero */}
                  <div className="mt-10 pt-6 border-t border-[#EFECE5] dark:border-[#2E2C29] grid grid-cols-3 gap-4">
                    <div>
                      <p className="font-mono text-xl font-medium tabular-nums text-[#1C1917] dark:text-[#F5F2EB]">
                        {books.length}
                      </p>
                      <p className="text-xs text-[#78716C] dark:text-[#A8A29E]">Buugag Diyaar ah</p>
                    </div>
                    <div>
                      <p className="font-mono text-xl font-medium tabular-nums text-[#1C1917] dark:text-[#F5F2EB]">
                        {categories.length - 1}
                      </p>
                      <p className="text-xs text-[#78716C] dark:text-[#A8A29E]">Qaybood</p>
                    </div>
                    <div>
                      <p className="font-mono text-xl font-medium tabular-nums text-[#1C1917] dark:text-[#F5F2EB]">
                        {downloadableCount}
                      </p>
                      <p className="text-xs text-[#78716C] dark:text-[#A8A29E]">Soo Dejin Furan</p>
                    </div>
                  </div>
                </div>

                <div className="lg:col-span-6">
                  <div className="h-64 sm:h-80 lg:h-full rounded-xl overflow-hidden border border-[#E5E0D5] dark:border-[#2E2C29] bg-[#EFECE5] dark:bg-[#242320]">
                    <img
                      src={heroLibrarySanctuaryUrl}
                      alt="Qolka akhriska ee maktabada.so"
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  </div>
                </div>
              </div>
            </section>

            <RecentlyRead
              items={recentlyReadItems}
              sessionSecondsByBook={sessionSecondsByBook}
              preferStyledCover={coverDisplayMode === 'styled'}
              onResume={(b) => openBookReader(b, 'read')}
            />
          </>
        )}

        {(section === 'library' || section === 'favorites' || section === 'offline') && (
          <section id="catalog" className="max-w-7xl mx-auto px-4 sm:px-6 pb-16 pt-4">
            {/* Workspace Status & Filter Toolbar */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 mb-8 border-b border-[#E5E0D5] dark:border-[#2E2C29]">
              <div>
                <h2 className="font-serif text-2xl font-semibold text-[#1C1917] dark:text-[#F5F2EB]">
                  {section === 'favorites'
                    ? 'Buugagga Aad Jeceshahay (Favorites)'
                    : section === 'offline'
                    ? "Kaydka Offline (Akhris Internet La'aan)"
                    : 'Diiwaanka Buugagga'}
                </h2>
                <div className="flex flex-wrap items-center gap-2 text-xs text-[#78716C] dark:text-[#A8A29E] mt-1">
                  {section === 'offline' ? (
                    <>
                      <span className="font-mono tabular-nums">
                        {offlineRecords.length} Buug Kaydsan
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">
                        {formatOfflineBytes(totalOfflineBytes)} localStorage
                      </span>
                      {offlineRecords.length > 0 && (
                        <>
                          <span aria-hidden="true">·</span>
                          <button
                            type="button"
                            onClick={handleClearAllOffline}
                            className="inline-flex items-center gap-1 text-[#991B1B] dark:text-[#FCA5A5] hover:underline"
                          >
                            <Trash2 className="w-3 h-3" />
                            Nadiifi Dhammaan
                          </button>
                        </>
                      )}
                    </>
                  ) : profile ? (
                    <>
                      <span>
                        Akoonka:{' '}
                        <button
                          type="button"
                          onClick={() => setProfileDrawerOpen(true)}
                          className="font-medium text-[#1C1917] dark:text-[#F5F2EB] hover:underline"
                        >
                          {profile.name}
                        </button>
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>
                        Doorka:{' '}
                        <strong className="font-medium text-[#14532D] dark:text-[#4ADE80]">
                          {profile.role === 'admin' ? 'Admin (Maamule)' : 'Reader (Akhriste)'}
                        </strong>
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">
                        {favorites.length} Favorites
                      </span>
                      <span aria-hidden="true">·</span>
                      <button
                        type="button"
                        onClick={() => setNotificationModalOpen(true)}
                        className="inline-flex items-center gap-1 font-medium text-[#14532D] dark:text-[#4ADE80] hover:underline"
                      >
                        <BellRing className="w-3 h-3" />
                        <span>
                          {reminderSettings.enabled
                            ? `Xasuusin: ${reminderSettings.time}`
                            : 'Daar Xasuusinta Maalinlaha'}
                        </span>
                      </button>
                    </>
                  ) : (
                    <>
                      <span>
                        Soo gal akoonkaaga si aad u kaydsato Favorites oo aad u hesho khibrad buuxda.
                      </span>
                      <span aria-hidden="true">·</span>
                      <button
                        type="button"
                        onClick={() => setNotificationModalOpen(true)}
                        className="inline-flex items-center gap-1 font-medium text-[#14532D] dark:text-[#4ADE80] hover:underline"
                      >
                        <BellRing className="w-3 h-3" />
                        <span>
                          {reminderSettings.enabled
                            ? `Xasuusinta Maalinlaha: ${reminderSettings.time}`
                            : 'Deji Xasuusinta Maalinlaha ah'}
                        </span>
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Search Input */}
              <div className="relative w-full md:w-80">
                <Search className="w-4 h-4 text-[#78716C] dark:text-[#A8A29E] absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Raadi buug, qoraa, ama qayb..."
                  aria-label="Raadi buugagga"
                  className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-[#1C1B19] border border-[#D6CEBE] dark:border-[#383531] rounded-lg text-sm text-[#1C1917] dark:text-[#F5F2EB] placeholder:text-[#A8A29E] dark:placeholder:text-[#78716C] focus:outline-none focus:ring-2 focus:ring-[#14532D]/30 focus:border-[#14532D]"
                />
              </div>
            </div>

            {/* Category Multi-Select Filter Buttons & Cover Mode Toggle */}
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 pb-6">
              <div
                role="group"
                aria-label="Shaandhaynta qaybaha buugagga (waxaad dooran kartaa in ka badan hal qayb)"
                className="flex flex-wrap items-center gap-2"
              >
                {categories.map((cat) => {
                  const isAll = cat === 'Dhammaan';
                  const isSelected = isAll
                    ? activeCategories.length === 0
                    : activeCategories.includes(cat);
                  const count = categoryCounts[cat] ?? 0;

                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => toggleCategoryFilter(cat)}
                      aria-pressed={isSelected}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                        isSelected
                          ? 'bg-[#14532D] dark:bg-[#15803D] border-[#14532D] dark:border-[#15803D] text-white'
                          : 'bg-white dark:bg-[#1C1B19] border-[#E5E0D5] dark:border-[#2E2C29] text-[#57534E] dark:text-[#D6D3CD] hover:text-[#1C1917] dark:hover:text-[#F5F2EB] hover:border-[#D6CEBE] dark:hover:border-[#4A4640]'
                      }`}
                    >
                      {!isAll && isSelected && <Check className="w-3.5 h-3.5 shrink-0" />}
                      <span>{cat}</span>
                      <span
                        className={`font-mono tabular-nums text-[11px] ${
                          isSelected
                            ? 'text-white/80'
                            : 'text-[#78716C] dark:text-[#A8A29E]'
                        }`}
                      >
                        {count}
                      </span>
                    </button>
                  );
                })}

                {activeCategories.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelectedCategories([])}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-dashed border-[#D6CEBE] dark:border-[#4A4640] text-[#57534E] dark:text-[#A8A29E] hover:text-[#1C1917] dark:hover:text-[#F5F2EB] hover:bg-[#EFECE5]/60 dark:hover:bg-[#242320] transition-colors whitespace-nowrap shrink-0"
                  >
                    <X className="w-3.5 h-3.5" />
                    <span>Nadiifi ({activeCategories.length})</span>
                  </button>
                )}
              </div>

              <div
                role="group"
                aria-label="Qaabka jaldiga buugagga"
                className="inline-flex items-center gap-1 p-1 bg-[#EFECE5] dark:bg-[#1C1B19] border border-[#E5E0D5] dark:border-[#2E2C29] rounded-lg self-start sm:self-auto shrink-0"
              >
                <button
                  type="button"
                  onClick={() => setCoverDisplayMode('image')}
                  aria-pressed={coverDisplayMode === 'image'}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    coverDisplayMode === 'image'
                      ? 'bg-white dark:bg-[#292724] text-[#1C1917] dark:text-[#F5F2EB] shadow-sm'
                      : 'text-[#57534E] dark:text-[#A8A29E] hover:text-[#1C1917] dark:hover:text-[#F5F2EB]'
                  }`}
                >
                  <ImageIcon className="w-3.5 h-3.5" />
                  <span>Sawirro</span>
                </button>
                <button
                  type="button"
                  onClick={() => setCoverDisplayMode('styled')}
                  aria-pressed={coverDisplayMode === 'styled'}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    coverDisplayMode === 'styled'
                      ? 'bg-white dark:bg-[#292724] text-[#1C1917] dark:text-[#F5F2EB] shadow-sm'
                      : 'text-[#57534E] dark:text-[#A8A29E] hover:text-[#1C1917] dark:hover:text-[#F5F2EB]'
                  }`}
                >
                  <Palette className="w-3.5 h-3.5" />
                  <span>Midabbo &amp; Frame</span>
                </button>
              </div>
            </div>

            {/* Inline Delete Confirmation Banner (replaces window.confirm) */}
            {confirmDeleteId && (
              <div className="mb-6 p-4 bg-[#FEF2F2] dark:bg-[#451A1A]/40 border border-[#FECACA] dark:border-[#7F1D1D] rounded-xl flex flex-wrap items-center justify-between gap-4">
                <p className="text-sm text-[#991B1B] dark:text-[#FCA5A5]">
                  Ma hubtaa inaad tirtirayso buuggan maktabadda? Tallaabadan dib loogama noqon karo.
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteId(null)}
                    className="px-3 py-1.5 text-xs font-medium bg-white dark:bg-[#1C1B19] border border-[#E5E0D5] dark:border-[#383531] rounded-lg text-[#1C1917] dark:text-[#F5F2EB]"
                  >
                    Jooji
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteBook(confirmDeleteId)}
                    className="px-3 py-1.5 text-xs font-medium bg-[#991B1B] text-white rounded-lg hover:bg-[#7F1D1D]"
                  >
                    Haa, Tirtir
                  </button>
                </div>
              </div>
            )}

            {/* Books Grid */}
            {section === 'favorites' && !user ? (
              <div className="bg-white dark:bg-[#1C1B19] border border-[#E5E0D5] dark:border-[#2E2C29] rounded-xl p-12 text-center">
                <Heart className="w-8 h-8 text-[#78716C] dark:text-[#A8A29E] mx-auto mb-3" />
                <h3 className="font-serif text-xl font-semibold text-[#1C1917] dark:text-[#F5F2EB] mb-2">
                  Soo Gal Si Aad U Aragto Kaydkaaga
                </h3>
                <p className="text-sm text-[#57534E] dark:text-[#A8A29E] max-w-md mx-auto mb-6">
                  Markaad soo gasho akoonkaaga, buugagga aad calaamadaysato (Favorites) waxay si toos ah ugu kaydsamayaan akoonkaaga Firebase.
                </p>
                <button
                  type="button"
                  onClick={() => setAuthModalOpen(true)}
                  className="px-5 py-2.5 text-sm font-medium bg-[#14532D] dark:bg-[#15803D] text-white rounded-lg hover:bg-[#0F3F22] dark:hover:bg-[#166534]"
                >
                  Soo Gal Hadda
                </button>
              </div>
            ) : filteredBooks.length === 0 ? (
              <div className="bg-white dark:bg-[#1C1B19] border border-[#E5E0D5] dark:border-[#2E2C29] rounded-xl p-12 text-center">
                {section === 'offline' ? (
                  <HardDriveDownload className="w-8 h-8 text-[#78716C] dark:text-[#A8A29E] mx-auto mb-3" />
                ) : (
                  <BookOpen className="w-8 h-8 text-[#78716C] dark:text-[#A8A29E] mx-auto mb-3" />
                )}
                <h3 className="font-serif text-xl font-semibold text-[#1C1917] dark:text-[#F5F2EB] mb-2">
                  {section === 'offline' ? 'Kaydka Offline Waa Madhan Yahay' : 'Buug Lagama Helin'}
                </h3>
                <p className="text-sm text-[#57534E] dark:text-[#A8A29E] max-w-md mx-auto mb-5">
                  {section === 'favorites'
                    ? 'Weli wax buug ah kuma aadan darin Favorites. Guji calaamadda wadnaha ee buugagga si aad halkan ugu kaydsato.'
                    : section === 'offline'
                    ? 'Guji badhanka "Kaydi Offline" ee buug kasta oo leh Soo Dejin Furan si uu ugu kaydsamo localStorage oo aad u akhrido internet la\'aan.'
                    : 'Wax buug ah oo u dhigma raadintaada lama helin. Isku day erey kale ama dooro "Dhammaan".'}
                </p>
                {section === 'offline' && sectionBooks.length === 0 ? (
                  <button
                    type="button"
                    onClick={() => handleSelectSection('library')}
                    className="px-4 py-2 text-xs font-medium bg-[#14532D] dark:bg-[#15803D] text-white rounded-lg hover:bg-[#0F3F22] dark:hover:bg-[#166534] transition-colors"
                  >
                    U Gudub Maktabadda
                  </button>
                ) : (activeCategories.length > 0 || searchQuery.trim().length > 0) ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCategories([]);
                      setSearchQuery('');
                    }}
                    className="px-4 py-2 text-xs font-medium bg-[#14532D] dark:bg-[#15803D] text-white rounded-lg hover:bg-[#0F3F22] dark:hover:bg-[#166534] transition-colors"
                  >
                    Nadiifi Shaandhaynta
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
                {filteredBooks.map((book) => (
                  <BookCard
                    key={book.id}
                    book={book}
                    isFavorite={favorites.includes(book.id)}
                    isAdmin={isAdmin}
                    preferStyledCover={coverDisplayMode === 'styled'}
                    isOfflineSaved={Boolean(offlineBooksMap[book.id])}
                    offlineBusy={offlineBusyBookId === book.id}
                    isOnline={isOnline}
                    userRating={userRatings[book.id] || 0}
                    ratingBusy={ratingBusyBookId === book.id}
                    progress={effectiveProgressMap[book.id]}
                    sessionMinutes={Math.floor((sessionSecondsByBook[book.id] || 0) / 60)}
                    onRead={(b) => openBookReader(b, 'read')}
                    onOpenComments={(b) => openBookReader(b, 'comments')}
                    onToggleFavorite={handleToggleFavorite}
                    onToggleOffline={handleToggleOffline}
                    onRate={handleRateBook}
                    onDelete={(id) => setConfirmDeleteId(id)}
                    onToggleDownloadable={handleToggleDownloadable}
                  />
                ))}
              </div>
            )}
          </section>
        )}

        {section === 'admin' && isAdmin && user && (
          <AdminPanel
            adminUid={user.uid}
            books={books}
            firestoreBooksCount={firestoreBooks.length}
            existingCategories={categories.filter((c) => c !== 'Dhammaan')}
            onOpenBook={(b, tab = 'read') => openBookReader(b, tab)}
            onNotify={showToast}
          />
        )}
      </main>

      {/* Clean Editorial Footer */}
      <footer className="border-t border-[#E5E0D5] dark:border-[#2E2C29] bg-white dark:bg-[#1C1B19]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[#78716C] dark:text-[#A8A29E]">
          <p className="font-serif text-sm text-[#1C1917] dark:text-[#F5F2EB]">maktabada.so</p>
          <p>Maktabadda Dhijitaalka ah · Af-Soomaali</p>
        </div>
      </footer>

      {/* Toast Notification */}
      {toastMessage && (
        <div
          role="status"
          className="fixed bottom-5 right-5 z-40 max-w-sm bg-[#1C1917] dark:bg-[#292724] text-[#F8F6F1] text-xs px-4 py-3 rounded-lg shadow-lg border border-white/10"
        >
          {toastMessage}
        </div>
      )}

      {/* Modals & Drawers */}
      <AuthModal
        open={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        onAuthenticated={() => {
          openProfileOnAuthRef.current = true;
          if (user && profile) {
            setProfileDrawerOpen(true);
            openProfileOnAuthRef.current = false;
          }
        }}
      />

      <ProfileDrawer
        open={profileDrawerOpen}
        profile={profile}
        googlePhotoUrl={user?.photoURL || undefined}
        books={books}
        readingProgressMap={effectiveProgressMap}
        sessionSecondsByBook={sessionSecondsByBook}
        readingStreak={readingStreak}
        readingStreakLoading={readingStreakLoading}
        userRatings={userRatings}
        onClose={() => setProfileDrawerOpen(false)}
        onOpenBook={(b) => openBookReader(b, 'read')}
        onToggleFavorite={handleToggleFavorite}
        onOpenAdminPanel={isAdmin ? () => handleSelectSection('admin') : undefined}
        onTestDailyReminder={() => {
          void triggerDailyReminder(true);
        }}
        onReminderSettingsChange={(saved) => setReminderSettings(saved)}
        onLogout={handleLogout}
        onNotify={showToast}
      />

      <DailyNotificationModal
        open={notificationModalOpen}
        enabled={reminderSettings.enabled}
        time={reminderSettings.time}
        goalMinutes={effectiveGoalMinutes}
        todaySeconds={effectiveTodaySeconds}
        currentStreak={readingStreak.currentStreak}
        isLoggedIn={Boolean(user && profile)}
        saving={reminderSaving}
        errorMsg={reminderErrorMsg}
        permission={notificationPermission}
        activeBanner={dailyReminderBanner}
        onClose={() => setNotificationModalOpen(false)}
        onToggleEnabled={() => saveReminderSettings(!reminderSettings.enabled, reminderSettings.time)}
        onSaveTime={(nextTime) => saveReminderSettings(true, nextTime)}
        onRequestPermission={handleRequestReminderPermission}
        onSendTestNotification={() => triggerDailyReminder(true)}
        onStartReading={() => {
          const latestBook = recentlyReadItems[0]?.book || filteredBooks[0] || books[0];
          if (latestBook) {
            openBookReader(latestBook, 'read');
          }
        }}
        onOpenProfile={
          user && profile
            ? () => {
                void flushPendingReadingLog();
                setProfileDrawerOpen(true);
              }
            : undefined
        }
      />

      {activeBook && (
        <ReaderModal
          key={`${activeBook.id}-${readerInitialTab}`}
          book={activeBook}
          initialTab={readerInitialTab}
          darkMode={readerDarkMode}
          onDarkModeChange={handleSetReaderDarkMode}
          isFirestoreBacked={firestoreBooks.some((b) => b.id === activeBook.id)}
          isOfflineSaved={Boolean(offlineBooksMap[activeBook.id])}
          offlineBusy={offlineBusyBookId === activeBook.id}
          isOnline={isOnline}
          currentUserId={user?.uid ?? null}
          currentUserName={profile?.name || user?.displayName || 'Akhriste'}
          isAdmin={isAdmin}
          userRating={userRatings[activeBook.id] || 0}
          ratingBusy={ratingBusyBookId === activeBook.id}
          progress={effectiveProgressMap[activeBook.id]}
          onRate={handleRateBook}
          onToggleOffline={handleToggleOffline}
          onSaveProgress={handleSaveProgress}
          onReadingTick={handleReadingTick}
          onRequireAuth={() => {
            void flushPendingReadingLog();
            setActiveBookId(null);
            setAuthModalOpen(true);
          }}
          onNotify={showToast}
          onClose={() => {
            void flushPendingReadingLog();
            setActiveBookId(null);
          }}
        />
      )}
    </div>
  );
}
