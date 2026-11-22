import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { Upload, CheckCircle2, Image as ImageIcon, FileText, X, FolderGit2, Loader2 } from 'lucide-react';
import { fetchGitHubHostStatus, type GitHubUploadStatus } from '../services/githubHostService';
import { createBookRecord, extractErrorMessage } from '../services/libraryService';
import { BLUEPRINT_LIMITS, type BookFileType } from '../types';
import { BookCover } from './BookCover';
import { GitHubHostPicker } from './GitHubHostPicker';

interface AdminUploadPanelProps {
  adminUid: string;
  existingCategories: string[];
  onPublished: () => void;
  embedded?: boolean;
}

const DEFAULT_CATEGORIES = ['Taariikh', 'Saynis', 'Suugaan', 'Tignoolajiyada', 'Diin', 'Dhaqaale'];

export function AdminUploadPanel({
  adminUid,
  existingCategories,
  onPublished,
  embedded = false,
}: AdminUploadPanelProps) {
  const categoryOptions = Array.from(
    new Set([...DEFAULT_CATEGORIES, ...existingCategories])
  );

  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [selectedCategory, setSelectedCategory] = useState(categoryOptions[0] || 'Taariikh');
  const [customCategory, setCustomCategory] = useState('');
  const [useCustomCategory, setUseCustomCategory] = useState(false);
  const [description, setDescription] = useState('');
  const [fileType, setFileType] = useState<BookFileType>('pdf');
  const [allowDownload, setAllowDownload] = useState(true);
  const [contentText, setContentText] = useState('');
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreviewUrl, setCoverPreviewUrl] = useState('');
  const [bookFile, setBookFile] = useState<File | null>(null);
  const [showExternalUrls, setShowExternalUrls] = useState(true);
  const [coverFallbackUrl, setCoverFallbackUrl] = useState('');
  const [fileFallbackUrl, setFileFallbackUrl] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [ghStatus, setGhStatus] = useState<GitHubUploadStatus | null>(null);

  useEffect(() => {
    let active = true;
    fetchGitHubHostStatus().then((status) => {
      if (active) setGhStatus(status);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!coverFile) {
      setCoverPreviewUrl('');
      return;
    }
    const url = URL.createObjectURL(coverFile);
    setCoverPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [coverFile]);

  const activeCategory = useCustomCategory
    ? customCategory.trim() || 'Guud'
    : selectedCategory;

  const handleBookFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    e.target.value = '';
    setBookFile(file);
    if (!file) return;
    setFileFallbackUrl('');

    const lower = file.name.toLowerCase();
    if (lower.endsWith('.pdf')) setFileType('pdf');
    else if (lower.endsWith('.epub')) setFileType('epub');
    else if (lower.endsWith('.txt') || lower.endsWith('.md')) {
      setFileType('txt');
      try {
        const text = await file.text();
        setContentText(text.slice(0, BLUEPRINT_LIMITS.book.contentTextMax));
      } catch {
        // Ignore read failure
      }
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    if (!title.trim() || !author.trim()) {
      setErrorMsg('Fadlan buuxi cinwaanka buugga iyo magaca qoraaga.');
      return;
    }
    if (useCustomCategory && !customCategory.trim()) {
      setErrorMsg('Fadlan qor magaca qaybta gaarka ah (Custom Category).');
      return;
    }

    setSubmitting(true);
    setUploadStatus('Hubinaya xogta buugga...');
    try {
      await createBookRecord({
        title,
        author,
        category: activeCategory,
        description,
        fileType,
        allowDownload,
        contentText,
        coverFile,
        bookFile,
        coverFallbackUrl,
        fileFallbackUrl,
        adminUid,
        onProgress: (status) => setUploadStatus(status),
      });

      setTitle('');
      setAuthor('');
      setDescription('');
      setContentText('');
      setCustomCategory('');
      setUseCustomCategory(false);
      setCoverFile(null);
      setBookFile(null);
      setCoverFallbackUrl('');
      setFileFallbackUrl('');
      setSuccessMsg('Buugga cusub si guul leh ayaa loogu kaydiyay maktabada.so!');
      onPublished();
    } catch (err) {
      const msg = extractErrorMessage(err);
      setErrorMsg(
        msg.includes('storage/') || msg.includes('Firebase Storage')
          ? msg
          : `Kaydintu way fashilantay: ${msg}`
      );
    } finally {
      setSubmitting(false);
      setUploadStatus('');
    }
  };

  return (
    <div className={embedded ? '' : 'max-w-6xl mx-auto px-6 py-10'}>
      {!embedded && (
        <div className="mb-8 border-b border-[#E5E0D5] dark:border-[#2E2C29] pb-5">
          <p className="text-xs tracking-widest uppercase text-[#78716C] dark:text-[#A8A29E] mb-1">
            Maamulka Maktabadda (Admin)
          </p>
          <h2 className="font-serif text-2xl sm:text-3xl font-semibold text-[#1C1917] dark:text-[#F5F2EB]">
            Geli Buug Cusub
          </h2>
          <p className="text-sm text-[#57534E] dark:text-[#A8A29E] mt-1">
            Ku soo dar buug cusub oo leh sawirka jaldiga (covers/), faylka buugga (books/), iyo horudhaca akhriska tooska ah.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
        {/* Form */}
        <form
          onSubmit={handleSubmit}
          className="lg:col-span-8 bg-white dark:bg-[#1C1B19] border border-[#E5E0D5] dark:border-[#2E2C29] rounded-xl p-6 sm:p-8 space-y-6"
        >
          {errorMsg && (
            <div className="p-3.5 rounded-lg bg-[#FEF2F2] dark:bg-[#451A1A]/40 border border-[#FECACA] dark:border-[#7F1D1D] text-xs text-[#991B1B] dark:text-[#FCA5A5] leading-relaxed">
              {errorMsg}
            </div>
          )}
          {successMsg && (
            <div className="p-3.5 rounded-lg bg-[#F0FDF4] dark:bg-[#14532D]/30 border border-[#BBF7D0] dark:border-[#166534] text-xs text-[#14532D] dark:text-[#4ADE80] flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <label htmlFor="book-title" className="block text-xs font-medium text-[#44403C] dark:text-[#D6D3CD] mb-1.5">
                Cinwaanka Buugga *
              </label>
              <input
                id="book-title"
                type="text"
                required
                maxLength={BLUEPRINT_LIMITS.book.titleMax}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Tusaale: Taariikhda Sayniska"
                className="w-full px-3.5 py-2.5 bg-[#F8F6F1] dark:bg-[#141312] border border-[#D6CEBE] dark:border-[#383531] rounded-lg text-sm text-[#1C1917] dark:text-[#F5F2EB] placeholder:text-[#A8A29E] dark:placeholder:text-[#78716C] focus:outline-none focus:ring-2 focus:ring-[#14532D]/30 focus:border-[#14532D]"
              />
            </div>

            <div>
              <label htmlFor="book-author" className="block text-xs font-medium text-[#44403C] dark:text-[#D6D3CD] mb-1.5">
                Qoraaga *
              </label>
              <input
                id="book-author"
                type="text"
                required
                maxLength={BLUEPRINT_LIMITS.book.authorMax}
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                placeholder="Tusaale: Dr. Faarax Cabdi"
                className="w-full px-3.5 py-2.5 bg-[#F8F6F1] dark:bg-[#141312] border border-[#D6CEBE] dark:border-[#383531] rounded-lg text-sm text-[#1C1917] dark:text-[#F5F2EB] placeholder:text-[#A8A29E] dark:placeholder:text-[#78716C] focus:outline-none focus:ring-2 focus:ring-[#14532D]/30 focus:border-[#14532D]"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="book-category" className="text-xs font-medium text-[#44403C] dark:text-[#D6D3CD]">
                  Qaybta (Category)
                </label>
                <button
                  type="button"
                  onClick={() => setUseCustomCategory((v) => !v)}
                  className="text-xs font-medium text-[#14532D] dark:text-[#4ADE80] hover:underline"
                >
                  {useCustomCategory ? 'Dooro liiska' : '+ Qayb gaar ah qor'}
                </button>
              </div>
              {useCustomCategory ? (
                <input
                  id="book-category"
                  type="text"
                  maxLength={BLUEPRINT_LIMITS.book.categoryMax}
                  value={customCategory}
                  onChange={(e) => setCustomCategory(e.target.value)}
                  placeholder="Qor qayb cusub..."
                  className="w-full px-3.5 py-2.5 bg-[#F8F6F1] dark:bg-[#141312] border border-[#D6CEBE] dark:border-[#383531] rounded-lg text-sm text-[#1C1917] dark:text-[#F5F2EB] focus:outline-none focus:ring-2 focus:ring-[#14532D]/30 focus:border-[#14532D]"
                />
              ) : (
                <select
                  id="book-category"
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-[#F8F6F1] dark:bg-[#141312] border border-[#D6CEBE] dark:border-[#383531] rounded-lg text-sm text-[#1C1917] dark:text-[#F5F2EB] focus:outline-none focus:ring-2 focus:ring-[#14532D]/30 focus:border-[#14532D]"
                >
                  {categoryOptions.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div>
              <label htmlFor="book-format" className="block text-xs font-medium text-[#44403C] dark:text-[#D6D3CD] mb-1.5">
                Nooca Faylka
              </label>
              <select
                id="book-format"
                value={fileType}
                onChange={(e) => setFileType(e.target.value as BookFileType)}
                className="w-full px-3.5 py-2.5 bg-[#F8F6F1] dark:bg-[#141312] border border-[#D6CEBE] dark:border-[#383531] rounded-lg text-sm text-[#1C1917] dark:text-[#F5F2EB] focus:outline-none focus:ring-2 focus:ring-[#14532D]/30 focus:border-[#14532D]"
              >
                <option value="pdf">PDF</option>
                <option value="epub">EPUB</option>
                <option value="txt">TXT</option>
                <option value="article">Maqaal / Qoraal Toos ah</option>
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="book-description" className="block text-xs font-medium text-[#44403C] dark:text-[#D6D3CD] mb-1.5">
              Faahfaahin Kooban
            </label>
            <textarea
              id="book-description"
              rows={3}
              maxLength={BLUEPRINT_LIMITS.book.descriptionMax}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Qor dulmar kooban oo ku saabsan nuxurka buugga..."
              className="w-full px-3.5 py-2.5 bg-[#F8F6F1] dark:bg-[#141312] border border-[#D6CEBE] dark:border-[#383531] rounded-lg text-sm text-[#1C1917] dark:text-[#F5F2EB] placeholder:text-[#A8A29E] dark:placeholder:text-[#78716C] focus:outline-none focus:ring-2 focus:ring-[#14532D]/30 focus:border-[#14532D]"
            />
          </div>

          {/* Free GitHub Host & Local File Uploads */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setShowExternalUrls((v) => !v)}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-[#14532D] dark:text-[#4ADE80] hover:underline"
              >
                <FolderGit2 className="w-3.5 h-3.5" />
                <span>
                  {showExternalUrls
                    ? 'Qari GitHub Free Host / Link-yada Tooska ah'
                    : 'Fur GitHub Free Host (0$) ama Link Toos ah'}
                </span>
              </button>
            </div>

            {showExternalUrls && (
              <GitHubHostPicker
                disabled={submitting}
                coverUrl={coverFallbackUrl}
                fileUrl={fileFallbackUrl}
                onCoverUrlChange={(url) => {
                  setCoverFallbackUrl(url);
                  if (url) setCoverFile(null);
                }}
                onFileUrlChange={(url, meta) => {
                  setFileFallbackUrl(url);
                  if (url) setBookFile(null);
                  if (meta?.fileType) setFileType(meta.fileType);
                  if (meta?.suggestedTitle && !title.trim()) {
                    setTitle(meta.suggestedTitle);
                  }
                  if (meta?.extractedText && !contentText.trim()) {
                    setContentText(meta.extractedText);
                  }
                }}
              />
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div className="relative">
                <label className="block border border-dashed border-[#D6CEBE] dark:border-[#383531] rounded-xl p-4 pr-9 bg-[#F8F6F1]/70 dark:bg-[#141312] hover:bg-[#EFECE5]/60 dark:hover:bg-[#242320] transition-colors cursor-pointer">
                  <div className="flex items-center gap-2.5 text-xs font-medium text-[#1C1917] dark:text-[#F5F2EB] mb-1">
                    <ImageIcon className="w-4 h-4 text-[#14532D] dark:text-[#4ADE80]" />
                    <span>Sawirka Jaldiga (Device)</span>
                  </div>
                  <p className="text-xs text-[#78716C] dark:text-[#A8A29E] truncate">
                    {coverFile ? coverFile.name : 'Dooro PNG / JPG (toos ayuu u kaydsamayaa)'}
                  </p>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0] || null;
                      e.target.value = '';
                      setCoverFile(file);
                      if (file) setCoverFallbackUrl('');
                    }}
                    className="sr-only"
                  />
                </label>
                {coverFile && !submitting && (
                  <button
                    type="button"
                    onClick={() => setCoverFile(null)}
                    aria-label="Ka saar sawirka jaldiga"
                    title="Ka saar sawirka"
                    className="absolute top-2.5 right-2.5 p-1 rounded-md text-[#78716C] hover:text-[#1C1917] dark:text-[#A8A29E] dark:hover:text-[#F5F2EB] hover:bg-[#EFECE5] dark:hover:bg-[#292724]"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <div className="relative">
                <label className="block border border-dashed border-[#D6CEBE] dark:border-[#383531] rounded-xl p-4 pr-9 bg-[#F8F6F1]/70 dark:bg-[#141312] hover:bg-[#EFECE5]/60 dark:hover:bg-[#242320] transition-colors cursor-pointer">
                  <div className="flex items-center gap-2.5 text-xs font-medium text-[#1C1917] dark:text-[#F5F2EB] mb-1">
                    <FileText className="w-4 h-4 text-[#14532D] dark:text-[#4ADE80]" />
                    <span>
                      {ghStatus?.configured
                        ? 'Faylka Buugga (GitHub Upload)'
                        : 'Faylka Buugga (TXT / GitHub)'}
                    </span>
                  </div>
                  <p className="text-xs text-[#78716C] dark:text-[#A8A29E] truncate">
                    {bookFile
                      ? bookFile.name
                      : ghStatus?.configured
                      ? 'Dooro PDF, EPUB ama TXT (toos GitHub ayuu u galayaa)'
                      : 'TXT toos buu u galayaa · PDF/EPUB ku dar GITHUB_TOKEN ama GitHub'}
                  </p>
                  <input
                    type="file"
                    accept=".pdf,.epub,.txt,.md,application/pdf,text/plain"
                    onChange={handleBookFileChange}
                    className="sr-only"
                  />
                </label>
                {bookFile && !submitting && (
                  <button
                    type="button"
                    onClick={() => setBookFile(null)}
                    aria-label="Ka saar faylka buugga"
                    title="Ka saar faylka"
                    className="absolute top-2.5 right-2.5 p-1 rounded-md text-[#78716C] hover:text-[#1C1917] dark:text-[#A8A29E] dark:hover:text-[#F5F2EB] hover:bg-[#EFECE5] dark:hover:bg-[#292724]"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
            {bookFile && !/\.(txt|md|csv)$/i.test(bookFile.name) && (
              <p className="text-xs text-[#57534E] dark:text-[#A8A29E] leading-relaxed">
                {ghStatus?.configured
                  ? `Faylkan si toos ah ayaa loogu shubayaa GitHub (${ghStatus.repo}) markaad gujiso Kaydi. (Fiiro: haddii aad ku jirto Netlify, xadka tooska ah ee function-ku waa ~4.5 MB.)`
                  : 'Fiiro gaar ah: Si faylasha PDF/EPUB ee Device-ka toos loogu shubo GitHub markaad gujiso Kaydi, ku dar GITHUB_TOKEN qaybta Secrets / Netlify Env Vars — ama ku tuur GitHub repo-ga kadibna ka dooro qaybta sare.'}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="book-content" className="block text-xs font-medium text-[#44403C] dark:text-[#D6D3CD] mb-1.5">
              Qoraalka Online Reader-ka (Ikhtiyaari — si toos ah ayuu u soo bixiyaa haddii faylkaagu yahay TXT)
            </label>
            <textarea
              id="book-content"
              rows={5}
              maxLength={BLUEPRINT_LIMITS.book.contentTextMax}
              value={contentText}
              onChange={(e) => setContentText(e.target.value)}
              placeholder="Halkan ku qor ama ku dheji cutubyada buugga si akhristayaashu ugu akhristaan Light / Sepia / Dark reader-ka..."
              className="w-full px-3.5 py-2.5 bg-[#F8F6F1] dark:bg-[#141312] border border-[#D6CEBE] dark:border-[#383531] rounded-lg text-sm text-[#1C1917] dark:text-[#F5F2EB] placeholder:text-[#A8A29E] dark:placeholder:text-[#78716C] focus:outline-none focus:ring-2 focus:ring-[#14532D]/30 focus:border-[#14532D]"
            />
          </div>

          <label className="flex items-center gap-3 text-sm text-[#1C1917] dark:text-[#F5F2EB] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={allowDownload}
              onChange={(e) => setAllowDownload(e.target.checked)}
              className="w-4 h-4 accent-[#14532D] rounded"
            />
            <span>U oggolow akhristayaasha inay soo dejiyaan faylka (Download)</span>
          </label>

          <div className="pt-2">
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 px-6 py-3 bg-[#14532D] dark:bg-[#15803D] text-white rounded-lg text-sm font-medium hover:bg-[#0F3F22] dark:hover:bg-[#166534] transition-colors disabled:opacity-50 whitespace-nowrap"
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Upload className="w-4 h-4" />
              )}
              <span>
                {submitting
                  ? uploadStatus || 'Waa la soo gelinayaa...'
                  : 'Kaydi oo Daabac Buugga'}
              </span>
            </button>
          </div>
        </form>

        {/* Live Card Preview */}
        <aside className="lg:col-span-4">
          <p className="text-xs tracking-widest uppercase text-[#78716C] dark:text-[#A8A29E] mb-3">
            Horudhac Toos ah (Live Preview)
          </p>
          <div className="bg-white dark:bg-[#1C1B19] border border-[#E5E0D5] dark:border-[#2E2C29] rounded-xl overflow-hidden">
            <BookCover
              src={coverPreviewUrl || coverFallbackUrl.trim()}
              title={title || 'Cinwaanka Buugga Cusub'}
              author={author || 'Magaca Qoraaga'}
              category={activeCategory}
            />
            <div className="p-5">
              <div className="flex items-center gap-2 text-xs text-[#78716C] dark:text-[#A8A29E] mb-2 truncate">
                <span className="font-medium text-[#14532D] dark:text-[#4ADE80]">{activeCategory}</span>
                <span aria-hidden="true">·</span>
                <span className="uppercase font-mono">{fileType}</span>
                <span aria-hidden="true">·</span>
                <span>{allowDownload ? 'Soo Dejin Furan' : 'Akhris Kaliya'}</span>
              </div>
              <h3 className="font-serif text-lg font-semibold text-[#1C1917] dark:text-[#F5F2EB] leading-snug mb-1">
                {title || 'Cinwaanka Buugga Cusub'}
              </h3>
              <p className="text-xs font-medium text-[#57534E] dark:text-[#A8A29E] mb-3">
                {author || 'Magaca Qoraaga'}
              </p>
              <p className="text-sm text-[#57534E] dark:text-[#D6D3CD] leading-relaxed line-clamp-3">
                {description || 'Faahfaahinta kooban ee buugga halkan ayay ka muuqan doontaa ka hor kaydinta.'}
              </p>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
