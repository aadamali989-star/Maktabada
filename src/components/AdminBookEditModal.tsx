import { useEffect, useState, type FormEvent } from 'react';
import { FileText, Image as ImageIcon, Loader2, Save, X } from 'lucide-react';
import { extractErrorMessage, updateBookRecord } from '../services/libraryService';
import { BLUEPRINT_LIMITS, type Book, type BookFileType } from '../types';

interface AdminBookEditModalProps {
  book: Book | null;
  existingCategories: string[];
  onClose: () => void;
  onSaved: (msg: string) => void;
}

const DEFAULT_CATEGORIES = ['Taariikh', 'Saynis', 'Suugaan', 'Tignoolajiyada', 'Diin', 'Dhaqaale'];

export function AdminBookEditModal({
  book,
  existingCategories,
  onClose,
  onSaved,
}: AdminBookEditModalProps) {
  const categoryOptions = Array.from(
    new Set([...DEFAULT_CATEGORIES, ...existingCategories, book?.category || ''].filter(Boolean))
  );

  const [title, setTitle] = useState(book?.title ?? '');
  const [author, setAuthor] = useState(book?.author ?? '');
  const [category, setCategory] = useState(book?.category || categoryOptions[0] || 'Taariikh');
  const [description, setDescription] = useState(book?.description || '');
  const [fileType, setFileType] = useState<BookFileType>(book?.fileType || 'pdf');
  const [allowDownload, setAllowDownload] = useState(Boolean(book?.allowDownload));
  const [published, setPublished] = useState(Boolean(book?.published));
  const [contentText, setContentText] = useState(book?.contentText || '');
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [bookFile, setBookFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!book) return;
    setTitle(book.title);
    setAuthor(book.author);
    setCategory(book.category || 'Taariikh');
    setDescription(book.description || '');
    setFileType(book.fileType || 'pdf');
    setAllowDownload(Boolean(book.allowDownload));
    setPublished(Boolean(book.published));
    setContentText(book.contentText || '');
    setCoverFile(null);
    setBookFile(null);
    setErrorMsg('');
  }, [book]);

  useEffect(() => {
    if (!book) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [book, onClose]);

  if (!book) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (!title.trim() || !author.trim() || !category.trim()) {
      setErrorMsg('Fadlan buuxi cinwaanka, qoraaga, iyo qaybta buugga.');
      return;
    }

    setSaving(true);
    setSaveStatus('Hubinaya xogta...');
    try {
      await updateBookRecord(book.id, {
        title,
        author,
        category,
        description,
        fileType,
        allowDownload,
        published,
        contentText,
        existingCoverUrl: book.coverUrl || '',
        existingFileUrl: book.fileUrl || '',
        existingFileName: book.fileName || '',
        coverFile,
        bookFile,
        onProgress: (status) => setSaveStatus(status),
      });
      onSaved(`Buugga "${title.trim()}" waa la cusboonaysiiyay.`);
      onClose();
    } catch (err) {
      const msg = extractErrorMessage(err);
      setErrorMsg(
        msg.includes('storage/') || msg.includes('Firebase Storage')
          ? msg
          : `Cusboonaysiintu way fashilantay: ${msg}`
      );
    } finally {
      setSaving(false);
      setSaveStatus('');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/55 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-book-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-white dark:bg-[#1C1B19] border border-[#E5E0D5] dark:border-[#2E2C29] rounded-xl shadow-2xl">
        <div className="sticky top-0 z-10 px-6 py-4 bg-white/95 dark:bg-[#1C1B19]/95 backdrop-blur-sm border-b border-[#E5E0D5] dark:border-[#2E2C29] flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs tracking-widest uppercase text-[#78716C] dark:text-[#A8A29E]">
              Wax Ka Beddel Buugga
            </p>
            <h3
              id="edit-book-modal-title"
              className="font-serif text-xl font-semibold text-[#1C1917] dark:text-[#F5F2EB] truncate"
            >
              {book.title}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Xir daaqadda wax ka beddelka"
            className="p-2 rounded-lg text-[#57534E] dark:text-[#A8A29E] hover:text-[#1C1917] dark:hover:text-[#F5F2EB] hover:bg-[#EFECE5] dark:hover:bg-[#292724] transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {errorMsg && (
            <div
              role="alert"
              className="p-3 rounded-lg bg-[#FEF2F2] dark:bg-[#451A1A]/40 border border-[#FECACA] dark:border-[#7F1D1D] text-xs text-[#991B1B] dark:text-[#FCA5A5]"
            >
              {errorMsg}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="edit-title" className="block text-xs font-medium text-[#44403C] dark:text-[#D6D3CD] mb-1.5">
                Cinwaanka Buugga *
              </label>
              <input
                id="edit-title"
                type="text"
                required
                maxLength={BLUEPRINT_LIMITS.book.titleMax}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3.5 py-2 bg-[#F8F6F1] dark:bg-[#141312] border border-[#D6CEBE] dark:border-[#383531] rounded-lg text-sm text-[#1C1917] dark:text-[#F5F2EB] focus:outline-none focus:ring-2 focus:ring-[#14532D]/30 focus:border-[#14532D]"
              />
            </div>

            <div>
              <label htmlFor="edit-author" className="block text-xs font-medium text-[#44403C] dark:text-[#D6D3CD] mb-1.5">
                Qoraaga *
              </label>
              <input
                id="edit-author"
                type="text"
                required
                maxLength={BLUEPRINT_LIMITS.book.authorMax}
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                className="w-full px-3.5 py-2 bg-[#F8F6F1] dark:bg-[#141312] border border-[#D6CEBE] dark:border-[#383531] rounded-lg text-sm text-[#1C1917] dark:text-[#F5F2EB] focus:outline-none focus:ring-2 focus:ring-[#14532D]/30 focus:border-[#14532D]"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="edit-category" className="block text-xs font-medium text-[#44403C] dark:text-[#D6D3CD] mb-1.5">
                Qaybta (Category) *
              </label>
              <input
                id="edit-category"
                type="text"
                list="admin-edit-categories"
                required
                maxLength={BLUEPRINT_LIMITS.book.categoryMax}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-3.5 py-2 bg-[#F8F6F1] dark:bg-[#141312] border border-[#D6CEBE] dark:border-[#383531] rounded-lg text-sm text-[#1C1917] dark:text-[#F5F2EB] focus:outline-none focus:ring-2 focus:ring-[#14532D]/30 focus:border-[#14532D]"
              />
              <datalist id="admin-edit-categories">
                {categoryOptions.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>

            <div>
              <label htmlFor="edit-format" className="block text-xs font-medium text-[#44403C] dark:text-[#D6D3CD] mb-1.5">
                Nooca Faylka
              </label>
              <select
                id="edit-format"
                value={fileType}
                onChange={(e) => setFileType(e.target.value as BookFileType)}
                className="w-full px-3.5 py-2 bg-[#F8F6F1] dark:bg-[#141312] border border-[#D6CEBE] dark:border-[#383531] rounded-lg text-sm text-[#1C1917] dark:text-[#F5F2EB] focus:outline-none focus:ring-2 focus:ring-[#14532D]/30 focus:border-[#14532D]"
              >
                <option value="pdf">PDF</option>
                <option value="epub">EPUB</option>
                <option value="txt">TXT</option>
                <option value="article">Maqaal / Qoraal Toos ah</option>
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="edit-description" className="block text-xs font-medium text-[#44403C] dark:text-[#D6D3CD] mb-1.5">
              Faahfaahin Kooban
            </label>
            <textarea
              id="edit-description"
              rows={3}
              maxLength={BLUEPRINT_LIMITS.book.descriptionMax}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3.5 py-2 bg-[#F8F6F1] dark:bg-[#141312] border border-[#D6CEBE] dark:border-[#383531] rounded-lg text-sm text-[#1C1917] dark:text-[#F5F2EB] focus:outline-none focus:ring-2 focus:ring-[#14532D]/30 focus:border-[#14532D]"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="relative">
              <label className="block border border-dashed border-[#D6CEBE] dark:border-[#383531] rounded-xl p-3.5 pr-9 bg-[#F8F6F1]/70 dark:bg-[#141312] hover:bg-[#EFECE5]/60 dark:hover:bg-[#242320] transition-colors cursor-pointer">
                <div className="flex items-center gap-2 text-xs font-medium text-[#1C1917] dark:text-[#F5F2EB] mb-1">
                  <ImageIcon className="w-3.5 h-3.5 text-[#14532D] dark:text-[#4ADE80]" />
                  <span>Beddel Sawirka Jaldiga (Ikhtiyaari)</span>
                </div>
                <p className="text-xs text-[#78716C] dark:text-[#A8A29E] truncate">
                  {coverFile ? coverFile.name : book.coverUrl ? 'Sawir hore wuu jiraa' : 'Dooro sawir cusub'}
                </p>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0] || null;
                    e.target.value = '';
                    setCoverFile(file);
                  }}
                  className="sr-only"
                />
              </label>
              {coverFile && !saving && (
                <button
                  type="button"
                  onClick={() => setCoverFile(null)}
                  aria-label="Ka saar sawirka cusub"
                  title="Ka saar sawirka"
                  className="absolute top-2.5 right-2.5 p-1 rounded-md text-[#78716C] hover:text-[#1C1917] dark:text-[#A8A29E] dark:hover:text-[#F5F2EB] hover:bg-[#EFECE5] dark:hover:bg-[#292724]"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="relative">
              <label className="block border border-dashed border-[#D6CEBE] dark:border-[#383531] rounded-xl p-3.5 pr-9 bg-[#F8F6F1]/70 dark:bg-[#141312] hover:bg-[#EFECE5]/60 dark:hover:bg-[#242320] transition-colors cursor-pointer">
                <div className="flex items-center gap-2 text-xs font-medium text-[#1C1917] dark:text-[#F5F2EB] mb-1">
                  <FileText className="w-3.5 h-3.5 text-[#14532D] dark:text-[#4ADE80]" />
                  <span>Beddel Faylka Buugga (Ikhtiyaari)</span>
                </div>
                <p className="text-xs text-[#78716C] dark:text-[#A8A29E] truncate">
                  {bookFile ? bookFile.name : book.fileName || 'Dooro fayl cusub'}
                </p>
                <input
                  type="file"
                  accept=".pdf,.epub,.txt,.md,application/pdf,text/plain"
                  onChange={(e) => {
                    const file = e.target.files?.[0] || null;
                    e.target.value = '';
                    setBookFile(file);
                  }}
                  className="sr-only"
                />
              </label>
              {bookFile && !saving && (
                <button
                  type="button"
                  onClick={() => setBookFile(null)}
                  aria-label="Ka saar faylka cusub"
                  title="Ka saar faylka"
                  className="absolute top-2.5 right-2.5 p-1 rounded-md text-[#78716C] hover:text-[#1C1917] dark:text-[#A8A29E] dark:hover:text-[#F5F2EB] hover:bg-[#EFECE5] dark:hover:bg-[#292724]"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          <div>
            <label htmlFor="edit-content" className="block text-xs font-medium text-[#44403C] dark:text-[#D6D3CD] mb-1.5">
              Qoraalka Online Reader-ka
            </label>
            <textarea
              id="edit-content"
              rows={5}
              maxLength={BLUEPRINT_LIMITS.book.contentTextMax}
              value={contentText}
              onChange={(e) => setContentText(e.target.value)}
              className="w-full px-3.5 py-2 bg-[#F8F6F1] dark:bg-[#141312] border border-[#D6CEBE] dark:border-[#383531] rounded-lg text-sm text-[#1C1917] dark:text-[#F5F2EB] focus:outline-none focus:ring-2 focus:ring-[#14532D]/30 focus:border-[#14532D]"
            />
          </div>

          <div className="flex flex-wrap items-center gap-6 pt-1">
            <label className="flex items-center gap-2.5 text-xs font-medium text-[#1C1917] dark:text-[#F5F2EB] cursor-pointer select-none">
              <input
                type="checkbox"
                checked={published}
                onChange={(e) => setPublished(e.target.checked)}
                className="w-4 h-4 accent-[#14532D] rounded"
              />
              <span>U muuji akhristayaasha (Published)</span>
            </label>

            <label className="flex items-center gap-2.5 text-xs font-medium text-[#1C1917] dark:text-[#F5F2EB] cursor-pointer select-none">
              <input
                type="checkbox"
                checked={allowDownload}
                onChange={(e) => setAllowDownload(e.target.checked)}
                className="w-4 h-4 accent-[#14532D] rounded"
              />
              <span>Soo Dejinta Furan (Download)</span>
            </label>
          </div>

          <div className="pt-4 border-t border-[#EFECE5] dark:border-[#2E2C29] flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium border border-[#D6CEBE] dark:border-[#383531] text-[#1C1917] dark:text-[#F5F2EB] rounded-lg hover:bg-[#F8F6F1] dark:hover:bg-[#292724] transition-colors"
            >
              Jooji
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-5 py-2 text-xs font-medium bg-[#14532D] dark:bg-[#15803D] text-white rounded-lg hover:bg-[#0F3F22] dark:hover:bg-[#166534] transition-colors disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              <span>{saving ? saveStatus || 'Kaydinaya...' : 'Kaydi Isbeddelka'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
