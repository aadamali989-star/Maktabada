import { useState } from 'react';
import {
  BookOpen,
  Check,
  Download,
  HardDriveDownload,
  Heart,
  Loader2,
  Lock,
  MessageSquare,
  Trash2,
} from 'lucide-react';
import type { Book, ReadingProgress } from '../types';
import { BookCover } from './BookCover';
import { StarRating } from './StarRating';
import { triggerBookDownload } from '../services/libraryService';

interface BookCardProps {
  book: Book;
  isFavorite: boolean;
  isAdmin: boolean;
  preferStyledCover?: boolean;
  isOfflineSaved?: boolean;
  offlineBusy?: boolean;
  isOnline?: boolean;
  userRating?: number;
  ratingBusy?: boolean;
  progress?: ReadingProgress;
  sessionMinutes?: number;
  onRead: (book: Book) => void;
  onOpenComments?: (book: Book) => void;
  onToggleFavorite: (bookId: string) => void;
  onToggleOffline?: (book: Book) => void;
  onRate?: (bookId: string, rating: number) => void;
  onDelete?: (bookId: string) => void;
  onToggleDownloadable?: (book: Book) => void;
}

export function BookCard({
  book,
  isFavorite,
  isAdmin,
  preferStyledCover = false,
  isOfflineSaved = false,
  offlineBusy = false,
  isOnline = true,
  userRating = 0,
  ratingBusy = false,
  progress,
  sessionMinutes = 0,
  onRead,
  onOpenComments,
  onToggleFavorite,
  onToggleOffline,
  onRate,
  onDelete,
  onToggleDownloadable,
}: BookCardProps) {
  const [downloading, setDownloading] = useState(false);
  const hasProgress = Boolean(progress && (progress.percentage > 0 || progress.currentPage > 1));
  const pct = progress?.percentage ?? 0;

  const readLabel = !hasProgress
    ? !isOnline && isOfflineSaved
      ? 'Akhri Offline'
      : 'Akhri'
    : pct >= 100
    ? 'Akhri Kale'
    : `Sii Wad (${pct}%)`;

  return (
    <article className="group bg-white dark:bg-[#1C1B19] border border-[#E5E0D5] dark:border-[#2E2C29] rounded-xl overflow-hidden flex flex-col transition-transform duration-200 hover:-translate-y-0.5 hover:shadow-sm">
      <button
        type="button"
        onClick={() => onRead(book)}
        className="w-full block text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[#14532D] relative"
      >
        <BookCover
          src={book.coverUrl}
          title={book.title}
          author={book.author}
          category={book.category}
          size="sm"
          preferStyledFallback={preferStyledCover}
        />
        {hasProgress && (
          <div className="h-1 w-full bg-[#E5E0D5] dark:bg-[#2E2C29]" aria-hidden="true">
            <div
              className="h-full bg-[#14532D] dark:bg-[#22C55E] transition-all duration-300"
              style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
            />
          </div>
        )}
      </button>

      <div className="p-2.5 sm:p-3.5 flex-1 flex flex-col min-w-0">
        {/* Clean unboxed metadata kicker */}
        <div className="flex items-center gap-1 text-[11px] text-[#78716C] dark:text-[#A8A29E] mb-1 truncate">
          <span className="font-medium text-[#14532D] dark:text-[#4ADE80] truncate">{book.category}</span>
          <span aria-hidden="true">·</span>
          <span className="uppercase font-mono shrink-0">{book.fileType}</span>
          {isOfflineSaved && (
            <>
              <span aria-hidden="true">·</span>
              <span className="font-medium text-[#14532D] dark:text-[#4ADE80] shrink-0">Offline</span>
            </>
          )}
        </div>

        <h3 className="font-serif text-sm sm:text-base font-semibold text-[#1C1917] dark:text-[#F5F2EB] leading-snug line-clamp-2 mb-0.5">
          {book.title}
        </h3>
        <p className="text-[11px] sm:text-xs font-medium text-[#57534E] dark:text-[#A8A29E] mb-2 truncate">
          {book.author}
        </p>

        <p className="hidden sm:line-clamp-2 text-xs text-[#57534E] dark:text-[#D6D3CD] leading-relaxed mb-2.5">
          {book.description || 'Buug dijitaal ah oo ku jira kaydka maktabada.so.'}
        </p>

        {(hasProgress && progress) || sessionMinutes > 0 ? (
          <div className="mb-2 flex items-center justify-between gap-1 text-[11px] text-[#14532D] dark:text-[#4ADE80] font-mono tabular-nums truncate">
            <span className="truncate">
              {hasProgress && progress
                ? `Bogga ${progress.currentPage}/${progress.totalPages}`
                : 'Kalfadhi'}
            </span>
            <span className="shrink-0">
              {hasProgress && progress ? `${pct}%` : ''}
              {sessionMinutes > 0
                ? `${hasProgress && progress ? ' · ' : ''}${sessionMinutes}m`
                : ''}
            </span>
          </div>
        ) : null}

        <div className="mt-auto pt-2 pb-2 border-t border-[#EFECE5] dark:border-[#2E2C29]">
          <StarRating
            ratingSum={book.ratingSum}
            ratingCount={book.ratingCount}
            userRating={userRating}
            disabled={ratingBusy}
            variant="card"
            onRate={onRate ? (rating) => onRate(book.id, rating) : undefined}
          />
        </div>

        <div className="pt-2 border-t border-[#EFECE5] dark:border-[#2E2C29] flex flex-col gap-1.5">
          <button
            type="button"
            onClick={() => onRead(book)}
            className="w-full inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-[#14532D] dark:bg-[#15803D] text-white rounded-lg hover:bg-[#0F3F22] dark:hover:bg-[#166534] transition-colors whitespace-nowrap"
          >
            <BookOpen className="w-3.5 h-3.5 shrink-0" />
            <span>{readLabel}</span>
          </button>

          <div className="flex items-center justify-between gap-1">
            <div className="flex items-center gap-0.5 min-w-0">
              {book.allowDownload ? (
                <>
                  {onToggleOffline && (
                    <button
                      type="button"
                      disabled={offlineBusy}
                      onClick={() => onToggleOffline(book)}
                      aria-pressed={isOfflineSaved}
                      aria-label={
                        isOfflineSaved
                          ? 'Ka saar kaydka Offline'
                          : 'U kaydi akhris Offline'
                      }
                      title={
                        isOfflineSaved
                          ? 'Ka saar kaydka Offline (localStorage)'
                          : 'U kaydi akhris Offline (localStorage)'
                      }
                      className={`p-1.5 rounded-md border transition-colors shrink-0 disabled:opacity-60 ${
                        isOfflineSaved
                          ? 'border-[#14532D] dark:border-[#22C55E] bg-[#14532D]/10 dark:bg-[#22C55E]/15 text-[#14532D] dark:text-[#4ADE80]'
                          : 'border-[#E5E0D5] dark:border-[#383531] text-[#57534E] dark:text-[#A8A29E] hover:bg-[#F8F6F1] dark:hover:bg-[#292724]'
                      }`}
                    >
                      {isOfflineSaved ? (
                        <Check className="w-3.5 h-3.5" />
                      ) : (
                        <HardDriveDownload className="w-3.5 h-3.5" />
                      )}
                    </button>
                  )}

                  <button
                    type="button"
                    disabled={downloading}
                    onClick={() => {
                      setDownloading(true);
                      void triggerBookDownload(book, isAdmin)
                        .catch(() => {
                          // Download error handled gracefully without unhandled rejection
                        })
                        .finally(() => {
                          setDownloading(false);
                        });
                    }}
                    aria-label="Soo Deji Faylka"
                    title="Soo Deji Faylka (Download)"
                    className="p-1.5 border border-[#E5E0D5] dark:border-[#383531] text-[#57534E] dark:text-[#A8A29E] hover:text-[#1C1917] dark:hover:text-[#F5F2EB] rounded-md hover:bg-[#F8F6F1] dark:hover:bg-[#292724] transition-colors shrink-0 disabled:opacity-60"
                  >
                    {downloading ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Download className="w-3.5 h-3.5" />
                    )}
                  </button>
                </>
              ) : (
                <span className="inline-flex items-center gap-1 px-1 py-1 text-[11px] text-[#78716C] dark:text-[#A8A29E] whitespace-nowrap truncate">
                  <Lock className="w-3 h-3 shrink-0" />
                  <span className="truncate">Xaddidan</span>
                </span>
              )}
            </div>

            <div className="flex items-center gap-0.5 shrink-0">
              {onOpenComments && (
                <button
                  type="button"
                  onClick={() => onOpenComments(book)}
                  aria-label="Doodda iyo faallooyinka buugga"
                  title="Doodda & Faallooyinka"
                  className="p-1.5 rounded-md text-[#78716C] dark:text-[#A8A29E] hover:text-[#14532D] dark:hover:text-[#4ADE80] hover:bg-[#F8F6F1] dark:hover:bg-[#292724] transition-colors"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                </button>
              )}

              <button
                type="button"
                onClick={() => onToggleFavorite(book.id)}
                aria-label={isFavorite ? 'Ka saar Favorites' : 'Ku dar Favorites'}
                title={isFavorite ? 'Ka saar Favorites' : 'Ku dar Favorites'}
                className={`p-1.5 rounded-md transition-colors ${
                  isFavorite
                    ? 'text-[#9A3412] dark:text-[#FB923C] bg-[#9A3412]/10 dark:bg-[#FB923C]/15'
                    : 'text-[#78716C] dark:text-[#A8A29E] hover:text-[#1C1917] dark:hover:text-[#F5F2EB] hover:bg-[#F8F6F1] dark:hover:bg-[#292724]'
                }`}
              >
                <Heart className={`w-3.5 h-3.5 ${isFavorite ? 'fill-current' : ''}`} />
              </button>

              {isAdmin && !book.isStarter && onToggleDownloadable && (
                <button
                  type="button"
                  onClick={() => onToggleDownloadable(book)}
                  title={
                    book.allowDownload
                      ? 'Ka dhig Akhris Kaliya'
                      : 'U oggolow Download'
                  }
                  className="p-1.5 rounded-md text-[#78716C] dark:text-[#A8A29E] hover:text-[#1C1917] dark:hover:text-[#F5F2EB] hover:bg-[#F8F6F1] dark:hover:bg-[#292724] transition-colors"
                >
                  <Lock className="w-3.5 h-3.5" />
                </button>
              )}

              {isAdmin && !book.isStarter && onDelete && (
                <button
                  type="button"
                  onClick={() => onDelete(book.id)}
                  aria-label="Tirtir buugga"
                  title="Tirtir buugga"
                  className="p-1.5 rounded-md text-[#78716C] dark:text-[#A8A29E] hover:text-[#991B1B] dark:hover:text-[#FCA5A5] hover:bg-[#FEF2F2] dark:hover:bg-[#451A1A]/30 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}
