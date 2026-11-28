import { BookOpen, Clock } from 'lucide-react';
import type { Book, ReadingProgress } from '../types';
import { BookCover } from './BookCover';

export interface RecentlyReadItem {
  book: Book;
  progress?: ReadingProgress;
  lastActivityAt: number;
}

interface RecentlyReadProps {
  items: RecentlyReadItem[];
  sessionSecondsByBook?: Record<string, number>;
  preferStyledCover?: boolean;
  onResume: (book: Book) => void;
}

export function RecentlyRead({
  items,
  sessionSecondsByBook = {},
  preferStyledCover = false,
  onResume,
}: RecentlyReadProps) {
  if (items.length === 0) {
    return null;
  }

  return (
    <section
      aria-label="Buugagga ugu dambeeyay ee la akhriyay"
      className="max-w-7xl mx-auto px-4 sm:px-6 pb-10"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3 pb-4 mb-6 border-b border-[#E5E0D5] dark:border-[#2E2C29]">
        <div>
          <h2 className="font-serif text-2xl font-semibold text-[#1C1917] dark:text-[#F5F2EB]">
            Kuwa Ugu Dambeeyay ee La Akhriyay
          </h2>
          <p className="text-xs sm:text-sm text-[#78716C] dark:text-[#A8A29E] mt-1">
            Si degdeg ah uga sii wad saddexdii buug ee ugu dambeeyay ee aad daawanaysay.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 text-xs font-mono tabular-nums text-[#78716C] dark:text-[#A8A29E]">
          <Clock className="w-3.5 h-3.5" />
          {items.length}/3 Buug
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        {items.map(({ book, progress }) => {
          const hasProgress = Boolean(
            progress && (progress.percentage > 0 || progress.currentPage > 1)
          );
          const pct = progress?.percentage ?? 0;
          const sessionMinutes = Math.floor((sessionSecondsByBook[book.id] || 0) / 60);
          const ctaLabel = !hasProgress
            ? 'Sii Wad Akhriska'
            : pct >= 100
            ? 'Akhri Mar Kale'
            : `Sii Wad (${pct}%)`;

          return (
            <article
              key={book.id}
              className="group bg-white dark:bg-[#1C1B19] border border-[#E5E0D5] dark:border-[#2E2C29] rounded-xl overflow-hidden flex items-stretch transition-transform duration-200 hover:-translate-y-0.5 hover:shadow-sm"
            >
              <button
                type="button"
                onClick={() => onResume(book)}
                aria-label={`Sii wad ${book.title}`}
                className="w-20 sm:w-24 shrink-0 bg-[#EFECE5] dark:bg-[#171614] block overflow-hidden text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[#14532D]"
              >
                <BookCover
                  src={book.coverUrl}
                  title={book.title}
                  author={book.author}
                  category={book.category}
                  size="sm"
                  preferStyledFallback={preferStyledCover}
                  className="h-full"
                />
              </button>

              <div className="p-3 sm:p-3.5 flex-1 min-w-0 flex flex-col justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-[11px] text-[#78716C] dark:text-[#A8A29E] mb-0.5 truncate">
                    <span className="font-medium text-[#14532D] dark:text-[#4ADE80] truncate">{book.category}</span>
                    <span aria-hidden="true">·</span>
                    <span className="uppercase font-mono">{book.fileType}</span>
                  </div>

                  <h3 className="font-serif text-sm sm:text-base font-semibold text-[#1C1917] dark:text-[#F5F2EB] leading-snug line-clamp-1">
                    {book.title}
                  </h3>
                  <p className="text-[11px] sm:text-xs text-[#57534E] dark:text-[#A8A29E] truncate mt-0.5">{book.author}</p>
                </div>

                <div className="mt-2.5">
                  {hasProgress && progress ? (
                    <div className="space-y-1 mb-2.5">
                      <div
                        className="h-1.5 w-full bg-[#EFECE5] dark:bg-[#2E2C29] rounded-full overflow-hidden"
                        aria-hidden="true"
                      >
                        <div
                          className="h-full bg-[#14532D] dark:bg-[#22C55E] transition-all duration-300"
                          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between gap-2 text-[11px] font-mono tabular-nums text-[#14532D] dark:text-[#4ADE80]">
                        <span>
                          Bogga {progress.currentPage}/{progress.totalPages}
                        </span>
                        <span>
                          {pct >= 100 ? '100%' : `${pct}%`}
                          {sessionMinutes > 0 ? ` · ${sessionMinutes} daqiiqo` : ''}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-[11px] font-mono tabular-nums text-[#78716C] dark:text-[#A8A29E] mb-2.5">
                      Bogga 1 · Bilowga{sessionMinutes > 0 ? ` · ${sessionMinutes} daqiiqo` : ''}
                    </p>
                  )}

                  <button
                    type="button"
                    onClick={() => onResume(book)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-[#14532D] dark:bg-[#15803D] text-white rounded-lg hover:bg-[#0F3F22] dark:hover:bg-[#166534] transition-colors whitespace-nowrap shrink-0"
                  >
                    <BookOpen className="w-3.5 h-3.5" />
                    {ctaLabel}
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
