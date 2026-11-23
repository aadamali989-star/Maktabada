import { useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  Database,
  Download,
  Eye,
  EyeOff,
  Lock,
  MessageSquare,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Star,
  Trash2,
  Users,
} from 'lucide-react';
import {
  deleteBookComment,
  deleteBookRecord,
  extractErrorMessage,
  fetchAllCommentsForAdmin,
  seedStarterBooksIfEmpty,
  subscribeUsersAndPresence,
  toggleBookDownloadable,
  toggleBookPublished,
  toggleCommentPublished,
  type AdminCommentItem,
} from '../services/libraryService';
import type { Book } from '../types';
import { AdminBookEditModal } from './AdminBookEditModal';
import { AdminUploadPanel } from './AdminUploadPanel';
import { AdminUsersPanel, type AdminUserWithPresence } from './AdminUsersPanel';
import { BookCover } from './BookCover';

type AdminTab = 'books' | 'upload' | 'users' | 'comments';

interface AdminPanelProps {
  adminUid: string;
  books: Book[];
  firestoreBooksCount: number;
  existingCategories: string[];
  onOpenBook: (book: Book, tab?: 'read' | 'comments') => void;
  onNotify: (msg: string) => void;
}

function formatDate(value: unknown): string {
  if (!value) return 'Hadda';
  try {
    if (typeof value === 'number') {
      return new Date(value).toLocaleDateString('so-SO', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    }
    if (typeof value === 'object' && value !== null && 'toDate' in value) {
      return (value as { toDate: () => Date }).toDate().toLocaleDateString('so-SO', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    }
  } catch {
    return 'Hadda';
  }
  return 'Hadda';
}

export function AdminPanel({
  adminUid,
  books,
  firestoreBooksCount,
  existingCategories,
  onOpenBook,
  onNotify,
}: AdminPanelProps) {
  const [activeTab, setActiveTab] = useState<AdminTab>('books');

  // Shared users & presence state for KPIs + Users tab
  const [users, setUsers] = useState<AdminUserWithPresence[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);

  // Books management state
  const [bookSearch, setBookSearch] = useState('');
  const [bookFilter, setBookFilter] = useState<'all' | 'published' | 'hidden'>('all');
  const [editingBook, setEditingBook] = useState<Book | null>(null);
  const [confirmDeleteBookId, setConfirmDeleteBookId] = useState<string | null>(null);
  const [busyBookId, setBusyBookId] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);

  // Comments moderation state
  const [comments, setComments] = useState<AdminCommentItem[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsLoadedOnce, setCommentsLoadedOnce] = useState(false);
  const [commentSearch, setCommentSearch] = useState('');
  const [commentFilter, setCommentFilter] = useState<'all' | 'published' | 'hidden'>('all');
  const [busyCommentId, setBusyCommentId] = useState<string | null>(null);
  const [confirmDeleteCommentKey, setConfirmDeleteCommentKey] = useState<string | null>(null);

  useEffect(() => {
    const unsub = subscribeUsersAndPresence(
      (merged) => {
        setUsers(merged);
        setUsersLoading(false);
      },
      (errMsg) => {
        setUsersLoading(false);
        onNotify(`Xogta isticmaalayaasha lama soo dejin karin: ${errMsg}`);
      }
    );
    return () => unsub();
  }, [onNotify]);

  const loadComments = async () => {
    setCommentsLoading(true);
    try {
      const items = await fetchAllCommentsForAdmin(books);
      setComments(items);
      setCommentsLoadedOnce(true);
    } catch (err) {
      onNotify(`Faallooyinka lama soo dejin karin: ${extractErrorMessage(err)}`);
    } finally {
      setCommentsLoading(false);
    }
  };

  useEffect(() => {
    if (!commentsLoadedOnce && firestoreBooksCount > 0) {
      void loadComments();
    }
  }, [firestoreBooksCount, commentsLoadedOnce]);

  // Aggregate KPI metrics
  const publishedBooksCount = books.filter((b) => b.published).length;
  const hiddenBooksCount = books.length - publishedBooksCount;
  const onlineUsersCount = users.filter((u) => u.presence.online).length;
  const adminUsersCount = users.filter((u) => u.role === 'admin').length;

  const { totalRatingsCount, averageLibraryRating } = useMemo(() => {
    let sum = 0;
    let count = 0;
    for (const b of books) {
      if (typeof b.ratingSum === 'number' && typeof b.ratingCount === 'number' && b.ratingCount > 0) {
        sum += b.ratingSum;
        count += b.ratingCount;
      }
    }
    return {
      totalRatingsCount: count,
      averageLibraryRating: count > 0 ? sum / count : 0,
    };
  }, [books]);

  const hiddenCommentsCount = comments.filter((c) => !c.published).length;

  // Filtered Books
  const filteredBooks = useMemo(() => {
    const q = bookSearch.trim().toLowerCase();
    return books.filter((b) => {
      if (bookFilter === 'published' && !b.published) return false;
      if (bookFilter === 'hidden' && b.published) return false;
      if (!q) return true;
      return (
        b.title.toLowerCase().includes(q) ||
        b.author.toLowerCase().includes(q) ||
        b.category.toLowerCase().includes(q)
      );
    });
  }, [books, bookSearch, bookFilter]);

  // Filtered Comments
  const filteredComments = useMemo(() => {
    const q = commentSearch.trim().toLowerCase();
    return comments.filter((c) => {
      if (commentFilter === 'published' && !c.published) return false;
      if (commentFilter === 'hidden' && c.published) return false;
      if (!q) return true;
      return (
        c.text.toLowerCase().includes(q) ||
        c.authorName.toLowerCase().includes(q) ||
        c.bookTitle.toLowerCase().includes(q)
      );
    });
  }, [comments, commentSearch, commentFilter]);

  const handleSeedStarterBooks = async () => {
    setSeeding(true);
    try {
      const count = await seedStarterBooksIfEmpty(adminUid);
      if (count > 0) {
        onNotify(`${count} buug oo tijaabo ah ayaa lagu kaydiyay Firestore.`);
      } else {
        onNotify('Buugag Firestore hore ayay uga jiraan.');
      }
    } catch (err) {
      onNotify(`Kaydinta buugagga tijaabada way fashilantay: ${extractErrorMessage(err)}`);
    } finally {
      setSeeding(false);
    }
  };

  const handleTogglePublished = async (book: Book) => {
    if (book.isStarter) {
      onNotify('Fadlan ku kaydi buugagga Firestore si aad u maamusho daabacaaddooda.');
      return;
    }
    setBusyBookId(book.id);
    try {
      await toggleBookPublished(book.id, !book.published);
      onNotify(
        !book.published
          ? `"${book.title}" hadda wuu u muuqdaa akhristayaasha.`
          : `"${book.title}" waa laga qariyay maktabadda.`
      );
    } catch (err) {
      onNotify(`Daabacaadda lama beddeli karin: ${extractErrorMessage(err)}`);
    } finally {
      setBusyBookId(null);
    }
  };

  const handleToggleDownload = async (book: Book) => {
    if (book.isStarter) {
      onNotify('Fadlan ku kaydi buugagga Firestore si aad u beddesho oggolaanshaha download-ka.');
      return;
    }
    setBusyBookId(book.id);
    try {
      await toggleBookDownloadable(book.id, !book.allowDownload);
      onNotify(
        !book.allowDownload
          ? `Soo dejinta waa loo furay "${book.title}".`
          : `"${book.title}" waxaa laga dhigay Akhris Kaliya.`
      );
    } catch (err) {
      onNotify(`Oggolaanshaha download-ka lama beddeli karin: ${extractErrorMessage(err)}`);
    } finally {
      setBusyBookId(null);
    }
  };

  const handleDeleteBook = async (book: Book) => {
    if (book.isStarter) return;
    setBusyBookId(book.id);
    try {
      await deleteBookRecord(book.id);
      setConfirmDeleteBookId(null);
      onNotify(`Buugga "${book.title}" waa la tirtiray.`);
    } catch (err) {
      onNotify(`Buugga lama tirtiri karin: ${extractErrorMessage(err)}`);
    } finally {
      setBusyBookId(null);
    }
  };

  const handleToggleCommentVisibility = async (comment: AdminCommentItem) => {
    setBusyCommentId(comment.id);
    try {
      const nextPub = !comment.published;
      await toggleCommentPublished(comment.bookId, comment.id, nextPub);
      setComments((prev) =>
        prev.map((c) => (c.id === comment.id ? { ...c, published: nextPub } : c))
      );
      onNotify(nextPub ? 'Faallada waa la muujiyay.' : 'Faallada waa la qariyay.');
    } catch (err) {
      onNotify(`Faallada lama beddeli karin: ${extractErrorMessage(err)}`);
    } finally {
      setBusyCommentId(null);
    }
  };

  const handleDeleteComment = async (comment: AdminCommentItem) => {
    setBusyCommentId(comment.id);
    try {
      await deleteBookComment(comment.bookId, comment.id);
      setComments((prev) => prev.filter((c) => c.id !== comment.id));
      setConfirmDeleteCommentKey(null);
      onNotify('Faallada waa la tirtiray.');
    } catch (err) {
      onNotify(`Faallada lama tirtiri karin: ${extractErrorMessage(err)}`);
    } finally {
      setBusyCommentId(null);
    }
  };

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
      {/* Header Row */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-6 mb-8 border-b border-[#E5E0D5] dark:border-[#2E2C29]">
        <div>
          <p className="text-xs tracking-widest uppercase text-[#78716C] dark:text-[#A8A29E] mb-1">
            Xarunta Maamulka · maktabada.so
          </p>
          <h1 className="font-serif text-3xl sm:text-4xl font-semibold text-[#1C1917] dark:text-[#F5F2EB] tracking-tight">
            Admin Panel
          </h1>
          <p className="text-sm text-[#57534E] dark:text-[#A8A29E] mt-1">
            Maamul buugagga maktabadda, daabacaadda, isticmaalayaasha, iyo faallooyinka akhristayaasha.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {firestoreBooksCount === 0 && (
            <button
              type="button"
              disabled={seeding}
              onClick={handleSeedStarterBooks}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium border border-[#D6CEBE] dark:border-[#383531] bg-white dark:bg-[#1C1B19] text-[#1C1917] dark:text-[#F5F2EB] rounded-lg hover:bg-[#EFECE5] dark:hover:bg-[#292724] transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <Database className="w-3.5 h-3.5" />
              <span>{seeding ? 'Kaydinaya...' : 'Ku Kaydi Starter Books Firestore'}</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setActiveTab('upload')}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-[#14532D] dark:bg-[#15803D] text-white rounded-lg hover:bg-[#0F3F22] dark:hover:bg-[#166534] transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Geli Buug Cusub</span>
          </button>
        </div>
      </div>

      {/* 4-Column KPI Summary Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="bg-white dark:bg-[#1C1B19] border border-[#E5E0D5] dark:border-[#2E2C29] rounded-xl p-5">
          <p className="text-xs text-[#78716C] dark:text-[#A8A29E] mb-1">Buugagga Maktabadda</p>
          <p className="font-mono text-2xl font-medium tabular-nums text-[#1C1917] dark:text-[#F5F2EB]">
            {books.length}
          </p>
          <p className="text-xs text-[#57534E] dark:text-[#A8A29E] mt-1 font-mono tabular-nums">
            {publishedBooksCount} daabacan · {hiddenBooksCount} qarsoon
          </p>
        </div>

        <div className="bg-white dark:bg-[#1C1B19] border border-[#E5E0D5] dark:border-[#2E2C29] rounded-xl p-5">
          <p className="text-xs text-[#78716C] dark:text-[#A8A29E] mb-1">Isticmaalayaasha</p>
          <p className="font-mono text-2xl font-medium tabular-nums text-[#14532D] dark:text-[#4ADE80]">
            {users.length}
          </p>
          <p className="text-xs text-[#57534E] dark:text-[#A8A29E] mt-1 font-mono tabular-nums">
            {onlineUsersCount} online · {adminUsersCount} admin
          </p>
        </div>

        <div className="bg-white dark:bg-[#1C1B19] border border-[#E5E0D5] dark:border-[#2E2C29] rounded-xl p-5">
          <p className="text-xs text-[#78716C] dark:text-[#A8A29E] mb-1">Qiimaynta Xiddigaha</p>
          <p className="font-mono text-2xl font-medium tabular-nums text-[#1C1917] dark:text-[#F5F2EB]">
            {averageLibraryRating > 0 ? averageLibraryRating.toFixed(1) : '—'}
          </p>
          <p className="text-xs text-[#57534E] dark:text-[#A8A29E] mt-1 font-mono tabular-nums">
            {totalRatingsCount} wadar qiimayn ah
          </p>
        </div>

        <div className="bg-white dark:bg-[#1C1B19] border border-[#E5E0D5] dark:border-[#2E2C29] rounded-xl p-5">
          <p className="text-xs text-[#78716C] dark:text-[#A8A29E] mb-1">Faallooyinka Akhristayaasha</p>
          <p className="font-mono text-2xl font-medium tabular-nums text-[#1C1917] dark:text-[#F5F2EB]">
            {comments.length}
          </p>
          <p className="text-xs text-[#57534E] dark:text-[#A8A29E] mt-1 font-mono tabular-nums">
            {hiddenCommentsCount} qarsoon
          </p>
        </div>
      </div>

      {/* Segmented Workspace Tabs */}
      <div
        role="tablist"
        aria-label="Qaybaha Admin Panel-ka"
        className="flex items-center gap-1 p-1 bg-[#EFECE5] dark:bg-[#1C1B19] border border-[#E5E0D5] dark:border-[#2E2C29] rounded-xl overflow-x-auto mb-6 w-full sm:w-fit"
      >
        {[
          { id: 'books' as const, label: `Buugagga (${books.length})`, icon: BookOpen },
          { id: 'upload' as const, label: 'Geli Buug', icon: Plus },
          { id: 'users' as const, label: `Isticmaalayaasha (${users.length})`, icon: Users },
          { id: 'comments' as const, label: `Faallooyinka (${comments.length})`, icon: MessageSquare },
        ].map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => {
                setActiveTab(tab.id);
                if (tab.id === 'comments' && !commentsLoadedOnce && firestoreBooksCount > 0) {
                  void loadComments();
                }
              }}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                active
                  ? 'bg-white dark:bg-[#292724] text-[#1C1917] dark:text-[#F5F2EB] shadow-sm'
                  : 'text-[#57534E] dark:text-[#A8A29E] hover:text-[#1C1917] dark:hover:text-[#F5F2EB]'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab 1: Books Catalog Management */}
      {activeTab === 'books' && (
        <div>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-1.5 overflow-x-auto">
              {[
                { id: 'all' as const, label: `Dhammaan (${books.length})` },
                { id: 'published' as const, label: `Daabacan (${publishedBooksCount})` },
                { id: 'hidden' as const, label: `Qarsoon (${hiddenBooksCount})` },
              ].map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setBookFilter(f.id)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                    bookFilter === f.id
                      ? 'bg-[#14532D] dark:bg-[#15803D] border-[#14532D] dark:border-[#15803D] text-white'
                      : 'bg-white dark:bg-[#1C1B19] border-[#E5E0D5] dark:border-[#2E2C29] text-[#57534E] dark:text-[#D6D3CD] hover:text-[#1C1917] dark:hover:text-[#F5F2EB]'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <div className="relative w-full sm:w-80">
              <Search className="w-3.5 h-3.5 text-[#78716C] dark:text-[#A8A29E] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={bookSearch}
                onChange={(e) => setBookSearch(e.target.value)}
                placeholder="Raadi buug, qoraa, ama qayb..."
                aria-label="Raadi buugagga admin-ka"
                className="w-full pl-9 pr-3 py-2 bg-white dark:bg-[#1C1B19] border border-[#D6CEBE] dark:border-[#383531] rounded-lg text-xs text-[#1C1917] dark:text-[#F5F2EB] placeholder:text-[#A8A29E] dark:placeholder:text-[#78716C] focus:outline-none focus:ring-2 focus:ring-[#14532D]/30 focus:border-[#14532D]"
              />
            </div>
          </div>

          <div className="bg-white dark:bg-[#1C1B19] border border-[#E5E0D5] dark:border-[#2E2C29] rounded-xl overflow-hidden">
            {filteredBooks.length === 0 ? (
              <div className="p-10 text-center">
                <BookOpen className="w-7 h-7 mx-auto mb-2 text-[#78716C] dark:text-[#A8A29E]" />
                <p className="text-sm font-medium text-[#1C1917] dark:text-[#F5F2EB]">
                  Wax buug ah lagama helin.
                </p>
                <p className="text-xs text-[#78716C] dark:text-[#A8A29E] mt-1 mb-4">
                  Isku day shaandhayn kale ama ku dar buug cusub maktabadda.
                </p>
                <button
                  type="button"
                  onClick={() => setActiveTab('upload')}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-[#14532D] dark:bg-[#15803D] text-white rounded-lg"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Geli Buug Cusub</span>
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[#E5E0D5] dark:border-[#2E2C29] bg-[#F8F6F1] dark:bg-[#161514] text-xs font-medium text-[#57534E] dark:text-[#A8A29E]">
                      <th className="py-3 px-4">Buugga</th>
                      <th className="py-3 px-4">Qaybta / Nooca</th>
                      <th className="py-3 px-4">Qiimaynta</th>
                      <th className="py-3 px-4">Daabacaadda</th>
                      <th className="py-3 px-4">Soo Dejinta</th>
                      <th className="py-3 px-4 text-right">Ficillada</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EFECE5] dark:divide-[#2E2C29] text-sm">
                    {filteredBooks.map((book) => {
                      const avg =
                        book.ratingCount && book.ratingCount > 0 && typeof book.ratingSum === 'number'
                          ? (book.ratingSum / book.ratingCount).toFixed(1)
                          : null;
                      const isBusy = busyBookId === book.id;
                      const confirmingDelete = confirmDeleteBookId === book.id;

                      return (
                        <tr
                          key={book.id}
                          className="hover:bg-[#F8F6F1]/60 dark:hover:bg-[#242320] transition-colors"
                        >
                          <td className="py-3 px-4 min-w-[240px]">
                            <div className="flex items-center gap-3">
                              <div className="w-9 shrink-0">
                                <BookCover
                                  src={book.coverUrl}
                                  title={book.title}
                                  author={book.author}
                                  category={book.category}
                                  size="xs"
                                  className="rounded"
                                />
                              </div>
                              <div className="min-w-0">
                                <button
                                  type="button"
                                  onClick={() => onOpenBook(book, 'read')}
                                  className="font-serif font-semibold text-[#1C1917] dark:text-[#F5F2EB] hover:text-[#14532D] dark:hover:text-[#4ADE80] text-left truncate max-w-[240px] block"
                                >
                                  {book.title}
                                </button>
                                <p className="text-xs text-[#78716C] dark:text-[#A8A29E] truncate max-w-[240px]">
                                  {book.author}
                                  {book.isStarter ? ' · Starter' : ''}
                                </p>
                              </div>
                            </div>
                          </td>

                          <td className="py-3 px-4 whitespace-nowrap text-xs text-[#57534E] dark:text-[#D6D3CD]">
                            <span>{book.category}</span>
                            <span className="mx-1.5 text-[#A8A29E]" aria-hidden="true">·</span>
                            <span className="font-mono uppercase">{book.fileType}</span>
                          </td>

                          <td className="py-3 px-4 whitespace-nowrap text-xs font-mono tabular-nums text-[#1C1917] dark:text-[#F5F2EB]">
                            {avg ? (
                              <span className="inline-flex items-center gap-1">
                                <Star className="w-3.5 h-3.5 text-[#D97706] fill-[#D97706]" />
                                {avg} ({book.ratingCount})
                              </span>
                            ) : (
                              <span className="text-[#78716C] dark:text-[#A8A29E]">—</span>
                            )}
                          </td>

                          <td className="py-3 px-4 whitespace-nowrap">
                            <button
                              type="button"
                              disabled={isBusy || Boolean(book.isStarter)}
                              onClick={() => handleTogglePublished(book)}
                              title={book.published ? 'Qari buugga' : 'Daabac buugga'}
                              className={`inline-flex items-center gap-1 text-xs font-medium transition-colors disabled:opacity-50 ${
                                book.published
                                  ? 'text-[#14532D] dark:text-[#4ADE80] hover:underline'
                                  : 'text-[#92400E] dark:text-[#FBBF24] hover:underline'
                              }`}
                            >
                              {book.published ? (
                                <>
                                  <Eye className="w-3.5 h-3.5" />
                                  <span>Daabacan</span>
                                </>
                              ) : (
                                <>
                                  <EyeOff className="w-3.5 h-3.5" />
                                  <span>Qarsoon</span>
                                </>
                              )}
                            </button>
                          </td>

                          <td className="py-3 px-4 whitespace-nowrap">
                            <button
                              type="button"
                              disabled={isBusy || Boolean(book.isStarter)}
                              onClick={() => handleToggleDownload(book)}
                              className="inline-flex items-center gap-1 text-xs font-medium text-[#57534E] dark:text-[#D6D3CD] hover:text-[#1C1917] dark:hover:text-[#F5F2EB] disabled:opacity-50"
                            >
                              {book.allowDownload ? (
                                <>
                                  <Download className="w-3.5 h-3.5 text-[#14532D] dark:text-[#4ADE80]" />
                                  <span>Furan</span>
                                </>
                              ) : (
                                <>
                                  <Lock className="w-3.5 h-3.5" />
                                  <span>Akhris Kaliya</span>
                                </>
                              )}
                            </button>
                          </td>

                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            {confirmingDelete ? (
                              <div className="inline-flex items-center gap-1.5">
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => handleDeleteBook(book)}
                                  className="px-2.5 py-1 text-xs font-medium bg-[#991B1B] text-white rounded-md hover:bg-[#7F1D1D]"
                                >
                                  Tirtir
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteBookId(null)}
                                  className="px-2 py-1 text-xs text-[#57534E] dark:text-[#A8A29E] hover:text-[#1C1917] dark:hover:text-[#F5F2EB]"
                                >
                                  Jooji
                                </button>
                              </div>
                            ) : (
                              <div className="inline-flex items-center gap-1.5">
                                <button
                                  type="button"
                                  disabled={Boolean(book.isStarter)}
                                  onClick={() => setEditingBook(book)}
                                  title={
                                    book.isStarter
                                      ? 'Kaydi starter books Firestore ka hor wax ka beddelka'
                                      : 'Wax ka beddel buugga'
                                  }
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium border border-[#D6CEBE] dark:border-[#383531] text-[#1C1917] dark:text-[#F5F2EB] rounded-lg hover:bg-[#EFECE5] dark:hover:bg-[#292724] disabled:opacity-40 transition-colors"
                                >
                                  <Pencil className="w-3 h-3" />
                                  <span>Beddel</span>
                                </button>
                                {!book.isStarter && (
                                  <button
                                    type="button"
                                    onClick={() => setConfirmDeleteBookId(book.id)}
                                    aria-label={`Tirtir ${book.title}`}
                                    title="Tirtir buugga"
                                    className="p-1.5 rounded-lg text-[#78716C] dark:text-[#A8A29E] hover:text-[#991B1B] dark:hover:text-[#FCA5A5] hover:bg-[#FEF2F2] dark:hover:bg-[#451A1A]/30 transition-colors"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 2: Upload New Book */}
      {activeTab === 'upload' && (
        <AdminUploadPanel
          embedded
          adminUid={adminUid}
          existingCategories={existingCategories}
          onPublished={() => {
            setActiveTab('books');
            onNotify('Buugga cusub hadda wuu ka muuqdaa maktabadda.');
          }}
        />
      )}

      {/* Tab 3: Users & Realtime Presence */}
      {activeTab === 'users' && (
        <AdminUsersPanel
          embedded
          currentAdminUid={adminUid}
          totalBooksCount={books.length}
          usersOverride={users}
          loadingOverride={usersLoading}
          onNotify={onNotify}
        />
      )}

      {/* Tab 4: Reader Comments Moderation */}
      {activeTab === 'comments' && (
        <div>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-1.5 overflow-x-auto">
              {[
                { id: 'all' as const, label: `Dhammaan (${comments.length})` },
                { id: 'published' as const, label: `Muuqda (${comments.length - hiddenCommentsCount})` },
                { id: 'hidden' as const, label: `Qarsoon (${hiddenCommentsCount})` },
              ].map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setCommentFilter(f.id)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                    commentFilter === f.id
                      ? 'bg-[#14532D] dark:bg-[#15803D] border-[#14532D] dark:border-[#15803D] text-white'
                      : 'bg-white dark:bg-[#1C1B19] border-[#E5E0D5] dark:border-[#2E2C29] text-[#57534E] dark:text-[#D6D3CD] hover:text-[#1C1917] dark:hover:text-[#F5F2EB]'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <div className="relative w-full sm:w-72">
                <Search className="w-3.5 h-3.5 text-[#78716C] dark:text-[#A8A29E] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="search"
                  value={commentSearch}
                  onChange={(e) => setCommentSearch(e.target.value)}
                  placeholder="Raadi faallo, akhriste, ama buug..."
                  aria-label="Raadi faallooyinka"
                  className="w-full pl-9 pr-3 py-2 bg-white dark:bg-[#1C1B19] border border-[#D6CEBE] dark:border-[#383531] rounded-lg text-xs text-[#1C1917] dark:text-[#F5F2EB] placeholder:text-[#A8A29E] dark:placeholder:text-[#78716C] focus:outline-none focus:ring-2 focus:ring-[#14532D]/30 focus:border-[#14532D]"
                />
              </div>

              <button
                type="button"
                disabled={commentsLoading}
                onClick={loadComments}
                aria-label="Cusboonaysii faallooyinka"
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-[#D6CEBE] dark:border-[#383531] bg-white dark:bg-[#1C1B19] text-[#1C1917] dark:text-[#F5F2EB] rounded-lg hover:bg-[#EFECE5] dark:hover:bg-[#292724] transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${commentsLoading ? 'animate-spin' : ''}`} />
                <span className="hidden sm:inline">Cusboonaysii</span>
              </button>
            </div>
          </div>

          <div className="bg-white dark:bg-[#1C1B19] border border-[#E5E0D5] dark:border-[#2E2C29] rounded-xl overflow-hidden">
            {commentsLoading ? (
              <div className="p-8 text-sm text-[#57534E] dark:text-[#A8A29E]">
                Waa la soo ururinayaa faallooyinka buugagga...
              </div>
            ) : filteredComments.length === 0 ? (
              <div className="p-10 text-center">
                <MessageSquare className="w-7 h-7 mx-auto mb-2 text-[#78716C] dark:text-[#A8A29E]" />
                <p className="text-sm font-medium text-[#1C1917] dark:text-[#F5F2EB]">
                  {comments.length === 0
                    ? 'Weli wax faallo ah laguma qorin buugagga.'
                    : 'Faallo u dhigma raadintaada lama helin.'}
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-[#EFECE5] dark:divide-[#2E2C29]">
                {filteredComments.map((c) => {
                  const key = `${c.bookId}_${c.id}`;
                  const confirming = confirmDeleteCommentKey === key;
                  const isBusy = busyCommentId === c.id;
                  const targetBook = books.find((b) => b.id === c.bookId);

                  return (
                    <li
                      key={key}
                      className="p-4 sm:px-5 hover:bg-[#F8F6F1]/50 dark:hover:bg-[#242320] transition-colors flex flex-col sm:flex-row sm:items-start justify-between gap-4"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 text-xs text-[#78716C] dark:text-[#A8A29E] mb-1">
                          <span className="font-medium text-[#1C1917] dark:text-[#F5F2EB]">
                            {c.authorName}
                          </span>
                          <span aria-hidden="true">·</span>
                          {targetBook ? (
                            <button
                              type="button"
                              onClick={() => onOpenBook(targetBook, 'comments')}
                              className="text-[#14532D] dark:text-[#4ADE80] hover:underline font-medium truncate max-w-[240px]"
                            >
                              {c.bookTitle}
                            </button>
                          ) : (
                            <span>{c.bookTitle}</span>
                          )}
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums">
                            {formatDate(c.createdAt)}
                          </span>
                          {!c.published && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="text-[#92400E] dark:text-[#FBBF24] font-medium">
                                Qarsoon
                              </span>
                            </>
                          )}
                        </div>
                        <p className="text-sm text-[#44403C] dark:text-[#D6D3CD] leading-relaxed whitespace-pre-wrap">
                          {c.text}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleToggleCommentVisibility(c)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium border border-[#D6CEBE] dark:border-[#383531] text-[#1C1917] dark:text-[#F5F2EB] rounded-lg hover:bg-[#EFECE5] dark:hover:bg-[#292724] transition-colors disabled:opacity-50"
                        >
                          {c.published ? (
                            <>
                              <EyeOff className="w-3.5 h-3.5" />
                              <span>Qari</span>
                            </>
                          ) : (
                            <>
                              <Eye className="w-3.5 h-3.5 text-[#14532D] dark:text-[#4ADE80]" />
                              <span>Muuji</span>
                            </>
                          )}
                        </button>

                        {confirming ? (
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => handleDeleteComment(c)}
                              className="px-2.5 py-1.5 text-xs font-medium bg-[#991B1B] text-white rounded-lg hover:bg-[#7F1D1D]"
                            >
                              Tirtir
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteCommentKey(null)}
                              className="px-2 py-1.5 text-xs text-[#57534E] dark:text-[#A8A29E]"
                            >
                              Jooji
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteCommentKey(key)}
                            aria-label="Tirtir faallada"
                            title="Tirtir faallada"
                            className="p-1.5 rounded-lg text-[#78716C] dark:text-[#A8A29E] hover:text-[#991B1B] dark:hover:text-[#FCA5A5] hover:bg-[#FEF2F2] dark:hover:bg-[#451A1A]/30 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Edit Book Modal */}
      <AdminBookEditModal
        key={editingBook?.id || 'closed'}
        book={editingBook}
        adminUid={adminUid}
        existingCategories={existingCategories}
        onClose={() => setEditingBook(null)}
        onSaved={onNotify}
      />
    </section>
  );
}
