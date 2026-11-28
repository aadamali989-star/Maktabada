import { useCallback, useEffect, useRef, useState } from 'react';
import {
  X,
  Download,
  Lock,
  Minus,
  Plus,
  FileText,
  BookOpen,
  ExternalLink,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  MessageSquare,
  HardDriveDownload,
  Check,
  WifiOff,
  Clock,
  Loader2,
} from 'lucide-react';
import type { Book, ReaderTheme, ReadingProgress } from '../types';
import {
  extractErrorMessage,
  isMaktabadaCloudFileUrl,
  resolveBookFileUrl,
  triggerBookDownload,
} from '../services/libraryService';
import { normalizeGitHubAssetUrl } from '../services/githubHostService';
import { StarRating } from './StarRating';
import { BookComments } from './BookComments';
import { PdfCanvasViewer } from './PdfCanvasViewer';

interface ReaderModalProps {
  book: Book | null;
  initialTab?: 'read' | 'comments';
  darkMode?: boolean;
  onDarkModeChange?: (enabled: boolean) => void;
  isFirestoreBacked: boolean;
  isOfflineSaved?: boolean;
  offlineBusy?: boolean;
  isOnline?: boolean;
  currentUserId: string | null;
  currentUserName: string;
  isAdmin: boolean;
  userRating?: number;
  ratingBusy?: boolean;
  progress?: ReadingProgress;
  onRate?: (bookId: string, rating: number) => void;
  onToggleOffline?: (book: Book) => void;
  onSaveProgress?: (
    bookId: string,
    next: { percentage: number; currentPage: number; totalPages: number }
  ) => void;
  onReadingTick?: (bookId: string) => void;
  onRequireAuth: () => void;
  onNotify?: (msg: string) => void;
  onClose: () => void;
}

const THEME_STYLES: Record<
  ReaderTheme,
  {
    wrapper: string;
    bar: string;
    text: string;
    muted: string;
    border: string;
    button: string;
  }
> = {
  light: {
    wrapper: 'bg-[#FFFFFF] text-[#1C1917]',
    bar: 'bg-[#F8F6F1] border-[#E5E0D5]',
    text: 'text-[#1C1917]',
    muted: 'text-[#57534E]',
    border: 'border-[#E5E0D5]',
    button: 'bg-[#EFECE5] text-[#1C1917] hover:bg-[#E5E0D5]',
  },
  sepia: {
    wrapper: 'bg-[#F5ECD9] text-[#3B2F23]',
    bar: 'bg-[#EDE1C8] border-[#D9C8A9]',
    text: 'text-[#3B2F23]',
    muted: 'text-[#6E5B45]',
    border: 'border-[#D9C8A9]',
    button: 'bg-[#E2D3B4] text-[#3B2F23] hover:bg-[#D5C39E]',
  },
  dark: {
    wrapper: 'bg-[#161514] text-[#E7E5E4]',
    bar: 'bg-[#1F1E1C] border-[#2E2C29]',
    text: 'text-[#E7E5E4]',
    muted: 'text-[#A8A29E]',
    border: 'border-[#2E2C29]',
    button: 'bg-[#292724] text-[#E7E5E4] hover:bg-[#36332F]',
  },
};

export function ReaderModal({
  book,
  initialTab = 'read',
  darkMode = false,
  onDarkModeChange,
  isFirestoreBacked,
  isOfflineSaved = false,
  offlineBusy = false,
  isOnline = true,
  currentUserId,
  currentUserName,
  isAdmin,
  userRating = 0,
  ratingBusy = false,
  progress,
  onRate,
  onToggleOffline,
  onSaveProgress,
  onReadingTick,
  onRequireAuth,
  onNotify,
  onClose,
}: ReaderModalProps) {
  const [theme, setTheme] = useState<ReaderTheme>(() => (darkMode ? 'dark' : 'light'));
  const [fontSize, setFontSize] = useState<number>(17);

  useEffect(() => {
    setTheme((prev) => (darkMode ? 'dark' : prev === 'dark' ? 'light' : prev));
  }, [darkMode]);

  const handleSelectTheme = (mode: ReaderTheme) => {
    setTheme(mode);
    onDarkModeChange?.(mode === 'dark');
  };
  const [viewMode, setViewMode] = useState<'text' | 'file' | 'comments'>(() => {
    if (initialTab === 'comments') return 'comments';
    if (!isOnline && book?.contentText?.trim()) return 'text';
    return book?.fileUrl && (book.fileType === 'pdf' || !book.contentText) ? 'file' : 'text';
  });

  const hasFile = Boolean(book?.fileUrl);
  const hasText = Boolean(book?.contentText && book.contentText.trim().length > 0);
  const effectiveView: 'text' | 'file' | 'comments' =
    viewMode === 'comments'
      ? 'comments'
      : viewMode === 'file' && hasFile
      ? 'file'
      : hasText
      ? 'text'
      : hasFile
      ? 'file'
      : 'text';

  const estimatedTextPages = Math.max(1, Math.ceil((book?.contentText?.length || 0) / 1200));
  const initialTotalPages =
    progress?.totalPages && progress.totalPages >= 1
      ? progress.totalPages
      : effectiveView === 'file'
      ? 10
      : estimatedTextPages;

  const [totalPages, setTotalPages] = useState<number>(initialTotalPages);
  const [currentPage, setCurrentPage] = useState<number>(
    progress?.currentPage ? Math.min(initialTotalPages, Math.max(1, progress.currentPage)) : 1
  );
  const [percentage, setPercentage] = useState<number>(progress?.percentage ?? 0);
  const [resumedBanner, setResumedBanner] = useState<boolean>(
    Boolean(progress && (progress.percentage > 0 || progress.currentPage > 1))
  );

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const debounceRef = useRef<number | null>(null);
  const restoredScrollRef = useRef<boolean>(false);
  const userInteractedRef = useRef<boolean>(false);
  const prevViewRef = useRef<'text' | 'file' | 'comments'>(effectiveView);
  const latestProgressRef = useRef({ percentage, currentPage, totalPages });
  latestProgressRef.current = { percentage, currentPage, totalPages };

  const [sessionSeconds, setSessionSeconds] = useState<number>(0);
  const [isPageVisible, setIsPageVisible] = useState<boolean>(() =>
    typeof document === 'undefined' ? true : document.visibilityState !== 'hidden'
  );
  const onReadingTickRef = useRef(onReadingTick);
  onReadingTickRef.current = onReadingTick;

  const [resolvedFileUrl, setResolvedFileUrl] = useState<string>(() =>
    book?.fileUrl && !isMaktabadaCloudFileUrl(book.fileUrl)
      ? normalizeGitHubAssetUrl(book.fileUrl)
      : ''
  );
  const [resolvingFile, setResolvingFile] = useState<boolean>(false);
  const [fileResolveError, setFileResolveError] = useState<string>('');
  const [fileRetryTick, setFileRetryTick] = useState<number>(0);

  useEffect(() => {
    if (!book?.fileUrl) {
      setResolvedFileUrl('');
      setResolvingFile(false);
      setFileResolveError('');
      return;
    }

    if (!isMaktabadaCloudFileUrl(book.fileUrl)) {
      setResolvedFileUrl(normalizeGitHubAssetUrl(book.fileUrl));
      setResolvingFile(false);
      setFileResolveError('');
      return;
    }

    let cancelled = false;
    setResolvingFile(true);
    setFileResolveError('');
    setResolvedFileUrl('');

    resolveBookFileUrl(book, isAdmin)
      .then((url) => {
        if (cancelled) return;
        setResolvedFileUrl(url);
        setResolvingFile(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setFileResolveError(extractErrorMessage(err, 'Faylka buugga lama furi karin.'));
        setResolvingFile(false);
      });

    return () => {
      cancelled = true;
    };
  }, [book, isAdmin, fileRetryTick]);

  useEffect(() => {
    setSessionSeconds(0);
  }, [book?.id]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsPageVisible(document.visibilityState !== 'hidden');
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  useEffect(() => {
    if (!book || effectiveView === 'comments' || !isPageVisible) return;
    const bookId = book.id;
    const intervalId = window.setInterval(() => {
      setSessionSeconds((prev) => prev + 1);
      onReadingTickRef.current?.(bookId);
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [book, effectiveView, isPageVisible]);

  const sessionMinutes = Math.floor(sessionSeconds / 60);

  const persistNow = useCallback(
    (next: { percentage: number; currentPage: number; totalPages: number }) => {
      if (!book || !onSaveProgress) return;
      onSaveProgress(book.id, next);
    },
    [book, onSaveProgress]
  );

  const schedulePersist = useCallback(
    (next: { percentage: number; currentPage: number; totalPages: number }) => {
      if (!book || !onSaveProgress) return;
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
      }
      debounceRef.current = window.setTimeout(() => {
        onSaveProgress(book.id, next);
      }, 1000);
    },
    [book, onSaveProgress]
  );

  // Sync progress if it arrives asynchronously after opening before user interacts
  useEffect(() => {
    if (!progress || userInteractedRef.current) return;
    const targetTotal =
      effectiveView === 'text'
        ? estimatedTextPages
        : progress.totalPages >= 1
        ? progress.totalPages
        : 10;
    const pct = Math.min(100, Math.max(0, progress.percentage ?? 0));
    const derivedPage =
      effectiveView === 'text'
        ? Math.max(1, Math.min(targetTotal, Math.round((pct / 100) * (targetTotal - 1)) + 1))
        : Math.max(1, Math.min(targetTotal, progress.currentPage || 1));

    setTotalPages(targetTotal);
    setCurrentPage(derivedPage);
    setPercentage(pct);
    setResumedBanner(pct > 0 || derivedPage > 1);
  }, [progress, effectiveView, estimatedTextPages]);

  // Recalculate totalPages cleanly when switching between text and file reader views
  useEffect(() => {
    if (prevViewRef.current === effectiveView) return;
    prevViewRef.current = effectiveView;

    if (effectiveView === 'text') {
      const nextTotal = estimatedTextPages;
      const nextPage = Math.max(
        1,
        Math.min(nextTotal, Math.round((percentage / 100) * (nextTotal - 1)) + 1)
      );
      setTotalPages(nextTotal);
      setCurrentPage(nextPage);
    } else if (effectiveView === 'file') {
      const nextTotal =
        progress?.totalPages && progress.totalPages >= 1 ? progress.totalPages : 10;
      const nextPage = Math.max(
        1,
        Math.min(nextTotal, Math.round((percentage / 100) * (nextTotal - 1)) + 1)
      );
      setTotalPages(nextTotal);
      setCurrentPage(nextPage);
    }
  }, [effectiveView, estimatedTextPages, percentage, progress?.totalPages]);

  // Restore scroll position once when opening a text book with saved progress
  useEffect(() => {
    if (!book || effectiveView !== 'text' || restoredScrollRef.current) return;
    const savedPct = progress?.percentage ?? 0;
    if (savedPct <= 0) return;
    restoredScrollRef.current = true;

    const raf = window.requestAnimationFrame(() => {
      const el = scrollContainerRef.current;
      if (!el) return;
      const maxScroll = el.scrollHeight - el.clientHeight;
      if (maxScroll > 0) {
        el.scrollTo({
          top: Math.round((savedPct / 100) * maxScroll),
          behavior: 'auto',
        });
      }
    });
    return () => window.cancelAnimationFrame(raf);
  }, [book, effectiveView, progress?.percentage]);

  const handleClose = useCallback(() => {
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
      persistNow(latestProgressRef.current);
    }
    onClose();
  }, [onClose, persistNow]);

  // Close reader modal on Escape key
  useEffect(() => {
    if (!book) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [book, handleClose]);

  // Clear pending timer on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
      }
    };
  }, []);

  if (!book) return null;

  const styles = THEME_STYLES[theme];

  const handleTextScroll = () => {
    if (effectiveView !== 'text') return;
    const el = scrollContainerRef.current;
    if (!el) return;
    userInteractedRef.current = true;
    const maxScroll = el.scrollHeight - el.clientHeight;
    const nextPct =
      maxScroll <= 0 ? 100 : Math.min(100, Math.max(0, Math.round((el.scrollTop / maxScroll) * 100)));
    const nextPage = Math.max(
      1,
      Math.min(totalPages, Math.round((nextPct / 100) * (totalPages - 1)) + 1)
    );

    if (nextPct !== percentage || nextPage !== currentPage) {
      setPercentage(nextPct);
      setCurrentPage(nextPage);
      setResumedBanner(false);
      schedulePersist({ percentage: nextPct, currentPage: nextPage, totalPages });
    }
  };

  const handleStepFilePage = (nextPageRaw: number) => {
    userInteractedRef.current = true;
    const clampedPage = Math.max(1, Math.min(totalPages, nextPageRaw));
    const nextPct =
      totalPages <= 1
        ? 100
        : Math.min(100, Math.max(0, Math.round(((clampedPage - 1) / (totalPages - 1)) * 100)));
    setCurrentPage(clampedPage);
    setPercentage(nextPct);
    setResumedBanner(false);
    persistNow({ percentage: nextPct, currentPage: clampedPage, totalPages });
  };

  const handleTotalPagesChange = (rawTotal: number) => {
    userInteractedRef.current = true;
    const safeTotal = Math.max(1, Math.min(10000, Math.round(rawTotal || 1)));
    const clampedPage = Math.min(safeTotal, currentPage);
    const nextPct =
      safeTotal <= 1
        ? 100
        : Math.min(100, Math.max(0, Math.round(((clampedPage - 1) / (safeTotal - 1)) * 100)));
    setTotalPages(safeTotal);
    setCurrentPage(clampedPage);
    setPercentage(nextPct);
    schedulePersist({ percentage: nextPct, currentPage: clampedPage, totalPages: safeTotal });
  };

  const handleDetectedPdfTotalPages = useCallback(
    (detectedTotal: number) => {
      const safeTotal = Math.max(1, Math.min(10000, Math.round(detectedTotal || 1)));
      setTotalPages(safeTotal);
      setCurrentPage((prevPage) => {
        const clampedPage = Math.max(1, Math.min(safeTotal, prevPage));
        const nextPct =
          safeTotal <= 1
            ? 100
            : Math.min(100, Math.max(0, Math.round(((clampedPage - 1) / (safeTotal - 1)) * 100)));
        setPercentage(nextPct);
        return clampedPage;
      });
    },
    []
  );

  const handleResetProgress = () => {
    userInteractedRef.current = true;
    setCurrentPage(1);
    setPercentage(0);
    setResumedBanner(false);
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
    persistNow({ percentage: 0, currentPage: 1, totalPages });
  };

  const paragraphs = (book.contentText || '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  const normalizedFileUrl = resolvedFileUrl;
  const iframeSrc = normalizedFileUrl
    ? book.allowDownload
      ? `${normalizedFileUrl}#page=${currentPage}`
      : `${normalizedFileUrl}#toolbar=0&navpanes=0&page=${currentPage}`
    : '';

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex flex-col"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reader-book-title"
    >
      <div className={`flex-1 flex flex-col overflow-hidden ${styles.wrapper}`}>
        {/* Reader Toolbar */}
        <header
          className={`flex flex-wrap items-center justify-between gap-4 px-4 sm:px-8 py-3.5 border-b ${styles.bar}`}
        >
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={handleClose}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${styles.button}`}
            >
              <X className="w-4 h-4" />
              Xir Akhriska
            </button>
            <div className="min-w-0">
              <h2
                id="reader-book-title"
                className="font-serif text-sm sm:text-base font-semibold truncate"
              >
                {book.title}
              </h2>
              <p className={`text-xs truncate ${styles.muted}`}>
                {book.author} · {book.category}
                {!isOnline && ' · Offline'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
            {/* Reading Progress Pillless Indicator */}
            <div className={`flex items-center gap-2 text-xs font-mono tabular-nums ${styles.muted}`}>
              <span>
                Bogga {currentPage}/{totalPages} · {percentage}%
              </span>
              <span aria-hidden="true">·</span>
              <span
                className="inline-flex items-center gap-1"
                title="Waqtiga aad buuggan akhrinaysay kalfadhigan"
                aria-label={`Waqtiga akhriska: ${sessionMinutes} daqiiqo`}
              >
                <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>{sessionMinutes} daqiiqo</span>
              </span>
              {percentage > 0 && (
                <button
                  type="button"
                  onClick={handleResetProgress}
                  title="Dib u bilow bogga 1aad"
                  aria-label="Dib u bilow akhriska"
                  className="p-1 rounded hover:opacity-75 transition-opacity"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Switch between Reading View & Book Details / Comments */}
            <div className={`flex items-center p-0.5 rounded-lg border ${styles.border}`}>
              {hasText && (
                <button
                  type="button"
                  onClick={() => setViewMode('text')}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    effectiveView === 'text' ? 'bg-[#14532D] text-white' : styles.muted
                  }`}
                >
                  <BookOpen className="w-3.5 h-3.5" />
                  Qoraal
                </button>
              )}
              {hasFile && (
                <button
                  type="button"
                  onClick={() => setViewMode('file')}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    effectiveView === 'file' ? 'bg-[#14532D] text-white' : styles.muted
                  }`}
                >
                  <FileText className="w-3.5 h-3.5" />
                  Faylka ({book.fileType.toUpperCase()})
                </button>
              )}
              <button
                type="button"
                onClick={() => setViewMode('comments')}
                className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  effectiveView === 'comments' ? 'bg-[#14532D] text-white' : styles.muted
                }`}
              >
                <MessageSquare className="w-3.5 h-3.5" />
                Faallooyinka
              </button>
            </div>

            {/* Theme Switcher */}
            <div className={`flex items-center p-0.5 rounded-lg border ${styles.border}`}>
              {(['light', 'sepia', 'dark'] as ReaderTheme[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => handleSelectTheme(mode)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    theme === mode ? 'bg-[#14532D] text-white' : styles.muted
                  }`}
                >
                  {mode === 'light' ? 'Cad' : mode === 'sepia' ? 'Sepia' : 'Madow'}
                </button>
              ))}
            </div>

            {/* Font Size Stepper */}
            {effectiveView === 'text' && (
              <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded-lg border ${styles.border}`}>
                <button
                  type="button"
                  aria-label="Yaree farta"
                  onClick={() => setFontSize((s) => Math.max(14, s - 1))}
                  className="p-1 hover:opacity-75"
                >
                  <Minus className="w-3.5 h-3.5" />
                </button>
                <span className="text-xs font-mono tabular-nums px-1.5">{fontSize}px</span>
                <button
                  type="button"
                  aria-label="Weynee farta"
                  onClick={() => setFontSize((s) => Math.min(24, s + 1))}
                  className="p-1 hover:opacity-75"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Offline Save & Download or Read-Only Notice */}
            {book.allowDownload ? (
              <div className="flex items-center gap-2 shrink-0">
                {onToggleOffline && (
                  <button
                    type="button"
                    disabled={offlineBusy}
                    onClick={() => onToggleOffline(book)}
                    aria-pressed={isOfflineSaved}
                    title={
                      isOfflineSaved
                        ? 'Ka saar kaydka Offline (localStorage)'
                        : 'U kaydi akhris Offline (localStorage)'
                    }
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap shrink-0 disabled:opacity-60 ${
                      isOfflineSaved
                        ? 'border-[#14532D] bg-[#14532D]/15 text-[#14532D] dark:text-[#4ADE80]'
                        : `${styles.border} ${styles.button}`
                    }`}
                  >
                    {isOfflineSaved ? (
                      <Check className="w-3.5 h-3.5" />
                    ) : (
                      <HardDriveDownload className="w-3.5 h-3.5" />
                    )}
                    {offlineBusy
                      ? 'Kaydinaya...'
                      : isOfflineSaved
                      ? 'Waa Offline'
                      : 'Kaydi Offline'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void triggerBookDownload(book, isAdmin)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#14532D] text-white hover:bg-[#0F3F22] transition-colors whitespace-nowrap shrink-0"
                >
                  <Download className="w-3.5 h-3.5" />
                  Soo Deji
                </button>
              </div>
            ) : (
              <span
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 ${styles.muted}`}
              >
                <Lock className="w-3.5 h-3.5" />
                Akhris Kaliya
              </span>
            )}
          </div>
        </header>

        {/* Continuous Reading Progress Bar */}
        <div className={`h-0.5 w-full ${theme === 'dark' ? 'bg-[#2E2C29]' : 'bg-[#E5E0D5]'}`}>
          <div
            className="h-full bg-[#14532D] transition-all duration-150"
            style={{ width: `${Math.min(100, Math.max(0, percentage))}%` }}
          />
        </div>

        {/* Reader Body */}
        <main
          ref={scrollContainerRef}
          onScroll={effectiveView === 'text' ? handleTextScroll : undefined}
          className="flex-1 overflow-y-auto"
          onContextMenu={!book.allowDownload ? (e) => e.preventDefault() : undefined}
        >
          {effectiveView === 'file' && hasFile ? (
            <div className="h-full flex flex-col">
              <div
                className={`px-6 py-2.5 border-b text-xs flex flex-wrap items-center justify-between gap-4 ${styles.border} ${styles.muted}`}
              >
                <div className="flex items-center gap-3 flex-wrap">
                  <span>Faylka: {book.fileName || book.title}</span>
                  <div className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border ${styles.border}`}>
                    <button
                      type="button"
                      onClick={() => handleStepFilePage(currentPage - 1)}
                      disabled={currentPage <= 1}
                      aria-label="Bogga hore"
                      className="p-0.5 disabled:opacity-40"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </button>
                    <span className="font-mono tabular-nums">
                      Bogga{' '}
                      <input
                        type="number"
                        min={1}
                        max={totalPages}
                        value={currentPage}
                        onChange={(e) => handleStepFilePage(Number(e.target.value))}
                        aria-label="Bogga hadda"
                        className="w-11 text-center bg-transparent border-b border-current focus:outline-none"
                      />{' '}
                      /{' '}
                      <input
                        type="number"
                        min={1}
                        max={10000}
                        value={totalPages}
                        onChange={(e) => handleTotalPagesChange(Number(e.target.value))}
                        aria-label="Wadarta boggaga"
                        className="w-11 text-center bg-transparent border-b border-current focus:outline-none"
                      />
                    </span>
                    <button
                      type="button"
                      onClick={() => handleStepFilePage(currentPage + 1)}
                      disabled={currentPage >= totalPages}
                      aria-label="Bogga xiga"
                      className="p-0.5 disabled:opacity-40"
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-4 flex-wrap">
                  <StarRating
                    ratingSum={book.ratingSum}
                    ratingCount={book.ratingCount}
                    userRating={userRating}
                    disabled={ratingBusy}
                    darkSurface={theme === 'dark'}
                    variant="detail"
                    onRate={onRate ? (rating) => onRate(book.id, rating) : undefined}
                  />
                  {book.allowDownload && normalizedFileUrl && (
                    <a
                      href={normalizedFileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 underline hover:opacity-80"
                    >
                      Ku fur daaqad cusub <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              </div>
              {!isOnline && !normalizedFileUrl.startsWith('data:') && !normalizedFileUrl.startsWith('blob:') ? (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center max-w-md mx-auto">
                  <WifiOff className={`w-8 h-8 mb-3 ${styles.muted}`} />
                  <h3 className="font-serif text-lg font-semibold mb-2">
                    Faylka dibadda ah lama furi karo Offline
                  </h3>
                  <p className={`text-sm mb-5 ${styles.muted}`}>
                    Internet-kaagu hadda wuu go&apos;an yahay. Si aad u sii akhrido buuggan adigoon internet lahayn, u beddel qaybta Qoraalka ee ku kaydsan localStorage.
                  </p>
                  {hasText && (
                    <button
                      type="button"
                      onClick={() => setViewMode('text')}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-[#14532D] text-white rounded-lg hover:bg-[#0F3F22] transition-colors"
                    >
                      <BookOpen className="w-3.5 h-3.5" />
                      U Gudub Qoraalka Offline
                    </button>
                  )}
                </div>
              ) : resolvingFile ? (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
                  <Loader2 className={`w-7 h-7 mb-3 animate-spin ${styles.muted}`} />
                  <p className={`text-sm ${styles.muted}`}>
                    Soo furaya faylka buugga...
                  </p>
                </div>
              ) : fileResolveError ? (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center max-w-md mx-auto">
                  <FileText className={`w-8 h-8 mb-3 ${styles.muted}`} />
                  <h3 className="font-serif text-lg font-semibold mb-2">
                    Faylka lama furi karin
                  </h3>
                  <p className={`text-sm mb-5 ${styles.muted}`}>
                    {fileResolveError}
                  </p>
                  <button
                    type="button"
                    onClick={() => setFileRetryTick((t) => t + 1)}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-[#14532D] text-white rounded-lg hover:bg-[#0F3F22] transition-colors"
                  >
                    Isku day mar kale
                  </button>
                </div>
              ) : book.fileType === 'epub' ? (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center max-w-md mx-auto">
                  <FileText className={`w-9 h-9 mb-3 ${styles.muted}`} />
                  <h3 className="font-serif text-lg font-semibold mb-2">
                    Faylka EPUB-ka ({book.fileName || book.title})
                  </h3>
                  <p className={`text-sm mb-5 ${styles.muted}`}>
                    Browser-ku toos uguma furi karo faylasha EPUB gudaha boggan. Waxaad ku akhrisan kartaa Qoraalka Online (haddii uu jiro) ama waad soo dejin kartaa si aad ugu furto EPUB reader-ka telefoonkaaga.
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-3">
                    {hasText && (
                      <button
                        type="button"
                        onClick={() => setViewMode('text')}
                        className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-[#14532D] text-white rounded-lg hover:bg-[#0F3F22] transition-colors"
                      >
                        <BookOpen className="w-3.5 h-3.5" />
                        Akhri Qoraalka Online
                      </button>
                    )}
                    {book.allowDownload && (
                      <button
                        type="button"
                        onClick={() => void triggerBookDownload(book, isAdmin)}
                        className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium border border-current rounded-lg hover:opacity-80 transition-opacity"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Soo Deji EPUB
                      </button>
                    )}
                  </div>
                </div>
              ) : normalizedFileUrl &&
                (book.fileType === 'pdf' ||
                  /\.pdf(\?|$)/i.test(normalizedFileUrl) ||
                  /\.pdf$/i.test(book.fileName || '') ||
                  normalizedFileUrl.startsWith('data:application/pdf')) ? (
                <PdfCanvasViewer
                  fileUrl={normalizedFileUrl}
                  iframeSrc={iframeSrc}
                  title={book.title}
                  allowDownload={book.allowDownload}
                  theme={theme}
                  currentPage={currentPage}
                  totalPages={totalPages}
                  onTotalPagesChange={handleDetectedPdfTotalPages}
                  onPageChange={handleStepFilePage}
                />
              ) : iframeSrc ? (
                <iframe
                  src={iframeSrc}
                  title={book.title}
                  className={`w-full flex-1 border-0 min-h-[75vh] ${
                    theme === 'dark' ? 'bg-[#1F1E1C]' : 'bg-white'
                  }`}
                />
              ) : null}
            </div>
          ) : effectiveView === 'comments' ? (
            <div className="max-w-2xl mx-auto px-6 sm:px-10 py-10 sm:py-14">
              <div className={`pb-8 mb-8 border-b ${styles.border}`}>
                <p className={`text-xs tracking-widest uppercase mb-3 ${styles.muted}`}>
                  {book.category} · {book.author}
                </p>
                <h1 className="font-serif text-3xl sm:text-4xl font-semibold leading-tight mb-4">
                  {book.title}
                </h1>
                {book.description && (
                  <p className={`text-sm leading-relaxed mb-5 ${styles.muted}`}>
                    {book.description}
                  </p>
                )}
                <div className={`pt-4 border-t ${styles.border}`}>
                  <StarRating
                    ratingSum={book.ratingSum}
                    ratingCount={book.ratingCount}
                    userRating={userRating}
                    disabled={ratingBusy}
                    darkSurface={theme === 'dark'}
                    variant="detail"
                    onRate={onRate ? (rating) => onRate(book.id, rating) : undefined}
                  />
                </div>
              </div>

              <BookComments
                book={book}
                isFirestoreBacked={isFirestoreBacked}
                currentUserId={currentUserId}
                currentUserName={currentUserName}
                isAdmin={isAdmin}
                theme={theme}
                onRequireAuth={onRequireAuth}
                onNotify={onNotify}
              />
            </div>
          ) : (
            <article className="max-w-2xl mx-auto px-6 sm:px-10 py-12 sm:py-16">
              {resumedBanner && (
                <div
                  className={`mb-6 pb-3 border-b text-xs font-mono tabular-nums flex items-center justify-between gap-4 ${styles.border} ${styles.muted}`}
                >
                  <span>
                    Waxaa laga sii waday halkii aad maraysay: Bogga {currentPage}/{totalPages} ·{' '}
                    {percentage}% · {sessionMinutes} daqiiqo
                  </span>
                  <button
                    type="button"
                    onClick={handleResetProgress}
                    className="underline hover:opacity-80"
                  >
                    Ka bilow bilowga
                  </button>
                </div>
              )}

              <div className={`pb-8 mb-8 border-b ${styles.border}`}>
                <p className={`text-xs tracking-widest uppercase mb-3 ${styles.muted}`}>
                  {book.category} · {book.author}
                </p>
                <h1 className="font-serif text-3xl sm:text-4xl font-semibold leading-tight mb-4">
                  {book.title}
                </h1>
                {book.description && (
                  <p className={`text-sm leading-relaxed mb-5 ${styles.muted}`}>
                    {book.description}
                  </p>
                )}
                <div className={`pt-4 border-t ${styles.border} flex flex-wrap items-center justify-between gap-4`}>
                  <StarRating
                    ratingSum={book.ratingSum}
                    ratingCount={book.ratingCount}
                    userRating={userRating}
                    disabled={ratingBusy}
                    darkSurface={theme === 'dark'}
                    variant="detail"
                    onRate={onRate ? (rating) => onRate(book.id, rating) : undefined}
                  />
                  <button
                    type="button"
                    onClick={() => setViewMode('comments')}
                    className={`inline-flex items-center gap-1.5 text-xs font-medium underline hover:opacity-80 whitespace-nowrap shrink-0 ${styles.muted}`}
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    Doodda Akhristayaasha
                  </button>
                </div>
              </div>

              {paragraphs.length > 0 ? (
                <div
                  className="space-y-6 font-serif"
                  style={{ fontSize: `${fontSize}px`, lineHeight: 1.8 }}
                >
                  {paragraphs.map((para, idx) => {
                    const isHeading =
                      para.startsWith('Cutubka') || (para.length < 70 && !para.endsWith('.'));
                    if (isHeading && idx > 0) {
                      return (
                        <h3 key={idx} className="font-serif font-semibold pt-4 text-xl">
                          {para}
                        </h3>
                      );
                    }
                    return (
                      <p
                        key={idx}
                        className={
                          idx === 0
                            ? 'first-letter:text-5xl first-letter:font-serif first-letter:font-semibold first-letter:float-left first-letter:mr-3 first-letter:leading-none'
                            : ''
                        }
                      >
                        {para}
                      </p>
                    );
                  })}
                </div>
              ) : (
                <div className={`py-12 text-center text-sm ${styles.muted}`}>
                  Buuggan qoraal horudhac ah laguma darin; haddii fayl PDF/EPUB ah la soo geliyay fadlan ka fur qaybta faylka.
                </div>
              )}

              <div className={`mt-14 pt-10 border-t ${styles.border}`}>
                <BookComments
                  book={book}
                  isFirestoreBacked={isFirestoreBacked}
                  currentUserId={currentUserId}
                  currentUserName={currentUserName}
                  isAdmin={isAdmin}
                  theme={theme}
                  onRequireAuth={onRequireAuth}
                  onNotify={onNotify}
                />
              </div>
            </article>
          )}
        </main>
      </div>
    </div>
  );
}
