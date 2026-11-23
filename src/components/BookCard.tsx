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
      : 'Akhri Online'
    : pct >= 100
    ? 'Akhri Mar Kale'
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

      <div className="p-5 flex-1 flex flex-col">
        {/* Clean unboxed metadata kicker */}
        <div className="flex items-center gap-2 text-xs text-[#78716C] dark:text-[#A8A29E] mb-2 truncate">
          <span className="font-medium text-[#14532D] dark:text-[#4ADE80]">{book.category}</span>
          <span aria-hidden="true">·</span>
          <span className="uppercase font-mono">{book.fileType}</span>
          <span aria-hidden="true">·</span>
          <span>{book.allowDownload ? 'Soo Dejin Furan' : 'Akhris Kaliya'}</span>
          {isOfflineSaved && (
            <>
              <span aria-hidden="true">·</span>
              <span className="font-medium text-[#14532D] dark:text-[#4ADE80]">Offline Diyaar</span>
            </>
          )}
        </div>

        <h3 className="font-serif text-lg font-semibold text-[#1C1917] dark:text-[#F5F2EB] leading-snug line-clamp-2 mb-1">
          {book.title}
        </h3>
        <p className="text-xs font-medium text-[#57534E] dark:text-[#A8A29E] mb-3 truncate">
          {book.author}
        </p>

        <p className="text-sm text-[#57534E] dark:text-[#D6D3CD] leading-relaxed line-clamp-2 mb-4">
          {book.description || 'Buug dijitaal ah oo ku jira kaydka maktabada.so.'}
        </p>

        {(hasProgress && progress) || sessionMinutes > 0 ? (
          <div className="mb-3 flex items-center justify-between gap-2 text-xs text-[#14532D] dark:text-[#4ADE80] font-mono tabular-nums">
            <span>
              {hasProgress && progress
                ? `Bogga ${progress.currentPage}/${progress.totalPages}`
                : 'Kalfadhigan'}
            </span>
            <span>
              {hasProgress && progress
                ? pct >= 100
                  ? 'Dhammaystay · 100%'
                  : `${pct}% la akhriyay`
                : ''}
              {sessionMinutes > 0
                ? `${hasProgress && progress ? ' · ' : ''}${sessionMinutes} daqiiqo`
                : ''}
            </span>
          </div>
        ) : null}

        <div className="mt-auto pt-3 pb-3 border-t border-[#EFECE5] dark:border-[#2E2C29]">
          <StarRating
            ratingSum={book.ratingSum}
            ratingCount={book.ratingCount}
            userRating={userRating}
            disabled={ratingBusy}
            variant="card"
            onRate={onRate ? (rating) => onRate(book.id, rating) : undefined}
          />
        </div>

        <div className="pt-3 border-t border-[#EFECE5] dark:border-[#2E2C29] flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => onRead(book)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-[#14532D] dark:bg-[#15803D] text-white rounded-lg hover:bg-[#0F3F22] dark:hover:bg-[#166534] transition-colors whitespace-nowrap shrink-0"
            >
              <BookOpen className="w-3.5 h-3.5" />
              {readLabel}
            </button>

            {book.allowDownload ? (
              <>
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
                    className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-60 ${
                      isOfflineSaved
                        ? 'border-[#14532D] dark:border-[#22C55E] bg-[#14532D]/10 dark:bg-[#22C55E]/15 text-[#14532D] dark:text-[#4ADE80] hover:bg-[#14532D]/15'
                        : 'border-[#D6CEBE] dark:border-[#383531] text-[#1C1917] dark:text-[#F5F2EB] hover:bg-[#F8F6F1] dark:hover:bg-[#292724]'
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
                  className="p-2 text-xs font-medium border border-[#D6CEBE] dark:border-[#383531] text-[#57534E] dark:text-[#A8A29E] hover:text-[#1C1917] dark:hover:text-[#F5F2EB] rounded-lg hover:bg-[#F8F6F1] dark:hover:bg-[#292724] transition-colors shrink-0 disabled:opacity-60"
                >
                  {downloading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Download className="w-3.5 h-3.5" />
                  )}
                </button>
              </>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-2 text-xs text-[#78716C] dark:text-[#A8A29E] whitespace-nowrap shrink-0">
                <Lock className="w-3.5 h-3.5" />
                Xaddidan
              </span>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {onOpenComments && (
              <button
                type="button"
                onClick={() => onOpenComments(book)}
                aria-label="Doodda iyo faallooyinka buugga"
                title="Doodda & Faallooyinka"
                className="p-2 rounded-lg text-[#78716C] dark:text-[#A8A29E] hover:text-[#14532D] dark:hover:text-[#4ADE80] hover:bg-[#F8F6F1] dark:hover:bg-[#292724] transition-colors"
              >
                <MessageSquare className="w-4 h-4" />
              </button>
            )}

            <button
              type="button"
              onClick={() => onToggleFavorite(book.id)}
              aria-label={isFavorite ? 'Ka saar Favorites' : 'Ku dar Favorites'}
              title={isFavorite ? 'Ka saar Favorites' : 'Ku dar Favorites'}
              className={`p-2 rounded-lg transition-colors ${
                isFavorite
                  ? 'text-[#9A3412] dark:text-[#FB923C] bg-[#9A3412]/10 dark:bg-[#FB923C]/15'
                  : 'text-[#78716C] dark:text-[#A8A29E] hover:text-[#1C1917] dark:hover:text-[#F5F2EB] hover:bg-[#F8F6F1] dark:hover:bg-[#292724]'
              }`}
            >
              <Heart className={`w-4 h-4 ${isFavorite ? 'fill-current' : ''}`} />
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
                className="p-2 rounded-lg text-[#78716C] dark:text-[#A8A29E] hover:text-[#1C1917] dark:hover:text-[#F5F2EB] hover:bg-[#F8F6F1] dark:hover:bg-[#292724] transition-colors"
              >
                <Lock className="w-4 h-4" />
              </button>
            )}

            {isAdmin && !book.isStarter && onDelete && (
              <button
                type="button"
                onClick={() => onDelete(book.id)}
                aria-label="Tirtir buugga"
                title="Tirtir buugga"
                className="p-2 rounded-lg text-[#78716C] dark:text-[#A8A29E] hover:text-[#991B1B] dark:hover:text-[#FCA5A5] hover:bg-[#FEF2F2] dark:hover:bg-[#451A1A]/30 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
