import { useEffect, useState, type FormEvent } from 'react';
import { MessageSquare, Pencil, Send, Trash2 } from 'lucide-react';
import {
  BLUEPRINT_LIMITS,
  type Book,
  type BookComment,
  type ReaderTheme,
} from '../types';
import {
  addBookComment,
  deleteBookComment,
  subscribeBookComments,
  updateBookComment,
} from '../services/libraryService';

interface BookCommentsProps {
  book: Book;
  isFirestoreBacked: boolean;
  currentUserId: string | null;
  currentUserName: string;
  isAdmin: boolean;
  theme?: ReaderTheme;
  onRequireAuth: () => void;
  onNotify?: (msg: string) => void;
}

const THEME_TOKENS: Record<
  ReaderTheme,
  {
    text: string;
    muted: string;
    border: string;
    input: string;
    subtleBg: string;
    ghostBtn: string;
  }
> = {
  light: {
    text: 'text-[#1C1917]',
    muted: 'text-[#57534E]',
    border: 'border-[#E5E0D5]',
    input: 'bg-white border-[#D6CEBE] text-[#1C1917] placeholder:text-[#A8A29E]',
    subtleBg: 'bg-[#F8F6F1]',
    ghostBtn: 'text-[#57534E] hover:text-[#1C1917] hover:bg-[#EFECE5]',
  },
  sepia: {
    text: 'text-[#3B2F23]',
    muted: 'text-[#6E5B45]',
    border: 'border-[#D9C8A9]',
    input: 'bg-[#FBF6EA] border-[#CBB896] text-[#3B2F23] placeholder:text-[#8E7A62]',
    subtleBg: 'bg-[#EDE1C8]/60',
    ghostBtn: 'text-[#6E5B45] hover:text-[#3B2F23] hover:bg-[#E2D3B4]',
  },
  dark: {
    text: 'text-[#E7E5E4]',
    muted: 'text-[#A8A29E]',
    border: 'border-[#2E2C29]',
    input: 'bg-[#1F1E1C] border-[#383531] text-[#E7E5E4] placeholder:text-[#78716C]',
    subtleBg: 'bg-[#1F1E1C]',
    ghostBtn: 'text-[#A8A29E] hover:text-[#E7E5E4] hover:bg-[#292724]',
  },
};

function formatCommentDate(value: unknown): string {
  if (!value) return 'Hadda';
  let date: Date | null = null;
  if (typeof value === 'number') {
    date = new Date(value);
  } else if (typeof value === 'object' && value !== null && 'toDate' in value) {
    date = (value as { toDate: () => Date }).toDate();
  }
  if (!date || Number.isNaN(date.getTime())) return 'Hadda';

  return date.toLocaleDateString('so-SO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function getTimestampMillis(value: unknown): number {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'object' && value !== null && 'toMillis' in value) {
    return (value as { toMillis: () => number }).toMillis();
  }
  return 0;
}

export function BookComments({
  book,
  isFirestoreBacked,
  currentUserId,
  currentUserName,
  isAdmin,
  theme = 'light',
  onRequireAuth,
  onNotify,
}: BookCommentsProps) {
  const [comments, setComments] = useState<BookComment[]>([]);
  const [loading, setLoading] = useState<boolean>(isFirestoreBacked);
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const tokens = THEME_TOKENS[theme];

  useEffect(() => {
    if (!isFirestoreBacked) {
      setComments([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsub = subscribeBookComments(
      book.id,
      isAdmin,
      (items) => {
        setComments(items);
        setLoading(false);
      },
      () => {
        setLoading(false);
        setErrorMsg('Faallooyinka lama soo dejin karin hadda.');
      }
    );
    return () => unsub();
  }, [book.id, isAdmin, isFirestoreBacked]);

  const handleCreateComment = async (e: FormEvent) => {
    e.preventDefault();
    if (!currentUserId) {
      onRequireAuth();
      return;
    }
    const clean = draft.trim();
    if (!clean) {
      setErrorMsg('Fadlan qor faalladaada ka hor intaadan dirin.');
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);
    try {
      await addBookComment(book.id, currentUserId, currentUserName, clean);
      setDraft('');
      onNotify?.('Faalladaada waa la daabacay.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Faallada lama diri karin.';
      setErrorMsg(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveEdit = async (commentId: string) => {
    const clean = editDraft.trim();
    if (!clean) return;
    setSavingEdit(true);
    try {
      await updateBookComment(book.id, commentId, clean);
      setEditingId(null);
      setEditDraft('');
      onNotify?.('Faallada waa la cusboonaysiiyay.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Wax ka beddelka waa uu fashilmay.';
      setErrorMsg(msg);
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDelete = async (commentId: string) => {
    setDeletingId(commentId);
    try {
      await deleteBookComment(book.id, commentId);
      setConfirmDeleteId(null);
      onNotify?.('Faallada waa la tirtiray.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Faallada lama tirtiri karin.';
      setErrorMsg(msg);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <section id="book-discussion" aria-label="Doodda iyo faallooyinka akhristayaasha">
      <div className={`flex flex-wrap items-baseline justify-between gap-3 pb-4 border-b ${tokens.border}`}>
        <div>
          <h2 className={`font-serif text-xl sm:text-2xl font-semibold ${tokens.text}`}>
            Doodda Akhristayaasha
          </h2>
          <p className={`text-xs sm:text-sm mt-1 ${tokens.muted}`}>
            La wadaag aragtidaada, su&apos;aalahaaga, iyo falanqaynta buuggan akhristayaasha kale.
          </p>
        </div>
        <span className={`text-xs font-mono tabular-nums ${tokens.muted}`}>
          {comments.length} {comments.length === 1 ? 'Faallo' : 'Faallooyin'}
        </span>
      </div>

      {/* Composer */}
      <div className="py-6">
        {!isFirestoreBacked ? (
          <div className={`p-4 rounded-xl border ${tokens.border} ${tokens.subtleBg}`}>
            <p className={`text-xs sm:text-sm leading-relaxed ${tokens.muted}`}>
              Buugagga tijaabada weli laguma kaydin Firestore. Marka Admin-ku soo galo ama buug cusub la geliyo, akhristayaashu waxay halkan ku qori karaan faallooyin toos u kaydsama.
            </p>
          </div>
        ) : !currentUserId ? (
          <div className={`p-5 rounded-xl border ${tokens.border} ${tokens.subtleBg} flex flex-col sm:flex-row sm:items-center justify-between gap-4`}>
            <div className="min-w-0">
              <p className={`text-sm font-medium ${tokens.text}`}>
                Ma rabtaa inaad ka qayb qaadato doodda buuggan?
              </p>
              <p className={`text-xs mt-1 ${tokens.muted}`}>
                Soo gal akoonkaaga si aad u qorto faallo ama uga jawaabto akhristayaasha kale.
              </p>
            </div>
            <button
              type="button"
              onClick={onRequireAuth}
              className="px-4 py-2 text-xs font-medium bg-[#14532D] text-white rounded-lg hover:bg-[#0F3F22] transition-colors whitespace-nowrap shrink-0 self-start sm:self-auto"
            >
              Soo Gal Hadda
            </button>
          </div>
        ) : (
          <form onSubmit={handleCreateComment} className="space-y-3">
            <label htmlFor={`comment-input-${book.id}`} className="sr-only">
              Qor faalladaada ku saabsan {book.title}
            </label>
            <textarea
              id={`comment-input-${book.id}`}
              rows={3}
              maxLength={BLUEPRINT_LIMITS.comment.textMax}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                if (errorMsg) setErrorMsg(null);
              }}
              placeholder={`Maxaad ka baratay ama ka aragtaa "${book.title}"?`}
              className={`w-full px-3.5 py-2.5 text-sm rounded-xl border focus:outline-none focus:ring-2 focus:ring-[#14532D]/30 focus:border-[#14532D] resize-y ${tokens.input}`}
            />

            {errorMsg && (
              <p className="text-xs text-[#991B1B]" role="alert">
                {errorMsg}
              </p>
            )}

            <div className="flex items-center justify-between gap-4">
              <span className={`text-xs font-mono tabular-nums ${tokens.muted}`}>
                {draft.length}/{BLUEPRINT_LIMITS.comment.textMax} · Adiga: {currentUserName}
              </span>
              <button
                type="submit"
                disabled={submitting || !draft.trim()}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-[#14532D] text-white rounded-lg hover:bg-[#0F3F22] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
              >
                <Send className="w-3.5 h-3.5" />
                {submitting ? 'Waa la dirayaa...' : 'Dir Faallada'}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Comments Feed */}
      {loading ? (
        <div className={`py-8 text-center text-xs ${tokens.muted}`}>
          Waa la soo dejinayaa faallooyinka...
        </div>
      ) : comments.length === 0 ? (
        <div className={`py-10 border-t ${tokens.border} text-center`}>
          <MessageSquare className={`w-6 h-6 mx-auto mb-2 opacity-60 ${tokens.muted}`} />
          <p className={`text-sm font-medium ${tokens.text}`}>
            Weli faallo lagama qorin buuggan.
          </p>
          <p className={`text-xs mt-1 ${tokens.muted}`}>
            Noqo qofka ugu horreeya ee bilaaba doodda akhristayaasha.
          </p>
        </div>
      ) : (
        <ul className={`divide-y ${theme === 'dark' ? 'divide-[#2E2C29]' : theme === 'sepia' ? 'divide-[#D9C8A9]' : 'divide-[#E5E0D5]'} border-t ${tokens.border}`}>
          {comments.map((comment) => {
            const isAuthor = currentUserId === comment.userId;
            const canDelete = isAuthor || isAdmin;
            const isEditing = editingId === comment.id;
            const isConfirmingDelete = confirmDeleteId === comment.id;
            const createdMs = getTimestampMillis(comment.createdAt);
            const updatedMs = getTimestampMillis(comment.updatedAt);
            const wasEdited = createdMs > 0 && updatedMs - createdMs > 2000;

            return (
              <li key={comment.id} className="py-5">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <div className={`flex flex-wrap items-center gap-2 text-xs ${tokens.muted}`}>
                    <span className={`font-semibold ${tokens.text}`}>
                      {comment.authorName}
                    </span>
                    {isAuthor && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="text-[#14532D] font-medium">Adiga</span>
                      </>
                    )}
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">
                      {formatCommentDate(comment.createdAt)}
                    </span>
                    {wasEdited && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>La beddelay</span>
                      </>
                    )}
                  </div>

                  {(isAuthor || canDelete) && !isEditing && (
                    <div className="flex items-center gap-1">
                      {isAuthor && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(comment.id);
                            setEditDraft(comment.text);
                            setConfirmDeleteId(null);
                          }}
                          aria-label="Wax ka beddel faallada"
                          className={`inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md transition-colors whitespace-nowrap ${tokens.ghostBtn}`}
                        >
                          <Pencil className="w-3 h-3" />
                          Beddel
                        </button>
                      )}
                      {canDelete && !isConfirmingDelete && (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(comment.id)}
                          aria-label="Tirtir faallada"
                          className={`inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md transition-colors whitespace-nowrap ${tokens.ghostBtn}`}
                        >
                          <Trash2 className="w-3 h-3" />
                          Tirtir
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {isConfirmingDelete && (
                  <div className="mb-3 p-3 rounded-lg bg-[#FEF2F2] border border-[#FECACA] flex flex-wrap items-center justify-between gap-3">
                    <span className="text-xs text-[#991B1B]">
                      Ma hubtaa inaad tirtirayso faalladan?
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        disabled={deletingId === comment.id}
                        className="px-2.5 py-1 text-xs font-medium bg-white border border-[#E5E0D5] text-[#1C1917] rounded-md"
                      >
                        Maya
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(comment.id)}
                        disabled={deletingId === comment.id}
                        className="px-2.5 py-1 text-xs font-medium bg-[#991B1B] text-white rounded-md hover:bg-[#7F1D1D] disabled:opacity-50"
                      >
                        {deletingId === comment.id ? 'Tirtiraya...' : 'Haa, Tirtir'}
                      </button>
                    </div>
                  </div>
                )}

                {isEditing ? (
                  <div className="space-y-2.5 mt-2">
                    <textarea
                      rows={3}
                      maxLength={BLUEPRINT_LIMITS.comment.textMax}
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                      className={`w-full px-3 py-2 text-sm rounded-lg border focus:outline-none focus:ring-2 focus:ring-[#14532D]/30 focus:border-[#14532D] ${tokens.input}`}
                    />
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(null);
                          setEditDraft('');
                        }}
                        disabled={savingEdit}
                        className={`px-3 py-1.5 text-xs font-medium rounded-lg border ${tokens.border} ${tokens.text}`}
                      >
                        Jooji
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSaveEdit(comment.id)}
                        disabled={savingEdit || !editDraft.trim()}
                        className="px-3.5 py-1.5 text-xs font-medium bg-[#14532D] text-white rounded-lg hover:bg-[#0F3F22] disabled:opacity-50"
                      >
                        {savingEdit ? 'Kaydinaya...' : 'Kaydi'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className={`text-sm leading-relaxed whitespace-pre-wrap ${tokens.text}`}>
                    {comment.text}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
