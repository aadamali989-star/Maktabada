import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  BookOpen,
  Camera,
  Check,
  Flame,
  Heart,
  LogOut,
  Shield,
  Trash2,
  X,
} from 'lucide-react';
import {
  BLUEPRINT_LIMITS,
  type Book,
  type ReadingProgress,
  type UserProfile,
} from '../types';
import {
  type ReadingStreakSummary,
  updateUserAvatarUrl,
  updateUserProfileDetails,
  uploadUserAvatar,
} from '../services/libraryService';
import { BookCover } from './BookCover';

interface ProfileDrawerProps {
  open: boolean;
  profile: UserProfile | null;
  googlePhotoUrl?: string;
  books: Book[];
  readingProgressMap: Record<string, ReadingProgress>;
  sessionSecondsByBook?: Record<string, number>;
  readingStreak?: ReadingStreakSummary;
  readingStreakLoading?: boolean;
  userRatings: Record<string, number>;
  onClose: () => void;
  onOpenBook: (book: Book) => void;
  onToggleFavorite: (bookId: string) => void;
  onLogout: () => void;
  onOpenAdminPanel?: () => void;
  onNotify?: (msg: string) => void;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'A';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function ProfileDrawer({
  open,
  profile,
  googlePhotoUrl,
  books,
  readingProgressMap,
  sessionSecondsByBook = {},
  readingStreak,
  readingStreakLoading = false,
  userRatings,
  onClose,
  onOpenBook,
  onToggleFavorite,
  onLogout,
  onOpenAdminPanel,
  onNotify,
}: ProfileDrawerProps) {
  const [nameInput, setNameInput] = useState(profile?.name || '');
  const [bioInput, setBioInput] = useState(profile?.bio || '');
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null);
  const [avatarLoadError, setAvatarLoadError] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [savedFlag, setSavedFlag] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setNameInput(profile.name || '');
    setBioInput(profile.bio || '');
    setAvatarLoadError(false);
  }, [profile?.uid, profile?.name, profile?.bio, profile?.avatarUrl]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open || !profile) return null;

  const favoriteIds = Array.isArray(profile.favorites) ? profile.favorites : [];
  const favoriteBooks = favoriteIds
    .map((id) => books.find((b) => b.id === id))
    .filter((b): b is Book => Boolean(b));

  const progressEntries = books
    .map((book) => {
      const progress = readingProgressMap[book.id];
      const sessionMinutes = Math.floor((sessionSecondsByBook[book.id] || 0) / 60);
      return { book, progress, sessionMinutes };
    })
    .filter(
      (item) =>
        Boolean(item.progress && (item.progress.percentage > 0 || item.progress.currentPage > 1)) ||
        item.sessionMinutes > 0
    )
    .sort((a, b) => {
      const toMs = (v: unknown) =>
        typeof v === 'number'
          ? v
          : v && typeof v === 'object' && 'toMillis' in v
          ? (v as { toMillis: () => number }).toMillis()
          : 0;
      const timeDiff = toMs(b.progress?.updatedAt) - toMs(a.progress?.updatedAt);
      return timeDiff !== 0 ? timeDiff : b.sessionMinutes - a.sessionMinutes;
    });

  const completedCount = progressEntries.filter((e) => (e.progress?.percentage ?? 0) >= 100).length;
  const inProgressCount = progressEntries.filter((e) => {
    const pct = e.progress?.percentage ?? 0;
    return (pct > 0 && pct < 100) || (pct === 0 && e.sessionMinutes > 0);
  }).length;
  const ratingsCount = Object.keys(userRatings).length;

  const isDirty =
    nameInput.trim() !== (profile.name || '').trim() ||
    bioInput.trim() !== (profile.bio || '').trim();

  const handleSaveProfile = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSavingProfile(true);
    try {
      await updateUserProfileDetails(profile.uid, {
        name: nameInput,
        bio: bioInput,
      });
      setSavedFlag(true);
      window.setTimeout(() => setSavedFlag(false), 2500);
      onNotify?.('Xogta boggaaga waa la kaydiyay.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Xogta lama kaydin karin.';
      setErrorMsg(msg);
    } finally {
      setSavingProfile(false);
    }
  };

  const handleAvatarFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const localPreview = URL.createObjectURL(file);
    setAvatarPreviewUrl(localPreview);
    setAvatarLoadError(false);
    setErrorMsg(null);
    setUploadingAvatar(true);

    try {
      await uploadUserAvatar(profile.uid, file);
      onNotify?.('Sawirka akoonkaaga waa la cusboonaysiiyay.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Sawirka lama kaydin karin.');
    } finally {
      URL.revokeObjectURL(localPreview);
      setAvatarPreviewUrl(null);
      setUploadingAvatar(false);
    }
  };

  const handleUseGooglePhoto = async () => {
    if (!googlePhotoUrl) return;
    setErrorMsg(null);
    setUploadingAvatar(true);
    try {
      await updateUserAvatarUrl(profile.uid, googlePhotoUrl);
      setAvatarLoadError(false);
      onNotify?.('Sawirka Google ayaa loo adeegsaday akoonkaaga.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Sawirka Google lama soo gelin karin.');
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleRemoveAvatar = async () => {
    setErrorMsg(null);
    setUploadingAvatar(true);
    try {
      await updateUserAvatarUrl(profile.uid, '');
      onNotify?.('Sawirka waa laga saaray akoonkaaga.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Sawirka lama saari karin.');
    } finally {
      setUploadingAvatar(false);
    }
  };

  const displayedAvatarUrl = avatarPreviewUrl || profile.avatarUrl || '';

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="profile-drawer-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside className="w-full max-w-lg h-full overflow-y-auto bg-[#F8F6F1] dark:bg-[#161514] text-[#1C1917] dark:text-[#F5F2EB] border-l border-[#E5E0D5] dark:border-[#2E2C29] shadow-2xl flex flex-col">
        {/* Drawer Header */}
        <div className="sticky top-0 z-10 px-6 py-5 bg-[#F8F6F1]/95 dark:bg-[#161514]/95 backdrop-blur-sm border-b border-[#E5E0D5] dark:border-[#2E2C29] flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs tracking-widest uppercase text-[#78716C] dark:text-[#A8A29E]">
              Akoonkaaga · {profile.role === 'admin' ? 'Admin (Maamule)' : 'Akhriste'}
            </p>
            <h2
              id="profile-drawer-title"
              className="font-serif text-2xl font-semibold text-[#1C1917] dark:text-[#F5F2EB] truncate mt-0.5"
            >
              {profile.name}
            </h2>
            <p className="text-xs font-mono text-[#57534E] dark:text-[#A8A29E] truncate mt-0.5">
              {profile.email}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Xir bogga akoonka"
            className="p-2 rounded-lg text-[#57534E] dark:text-[#A8A29E] hover:text-[#1C1917] dark:hover:text-[#F5F2EB] hover:bg-[#EFECE5] dark:hover:bg-[#292724] transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-8 flex-1">
          {/* Avatar + Editable Profile Form */}
          <section aria-label="Xogta iyo sawirka isticmaalaha">
            <div className="flex items-start gap-4 mb-5">
              <div className="relative w-16 h-16 rounded-full overflow-hidden border border-[#E5E0D5] dark:border-[#2E2C29] bg-[#14532D] text-white flex items-center justify-center shrink-0">
                {displayedAvatarUrl && !avatarLoadError ? (
                  <img
                    src={displayedAvatarUrl}
                    alt={`Sawirka ${profile.name}`}
                    referrerPolicy="no-referrer"
                    onError={() => setAvatarLoadError(true)}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="font-serif text-xl font-semibold select-none">
                    {getInitials(profile.name)}
                  </span>
                )}
                {uploadingAvatar && (
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center text-[10px] font-medium text-white">
                    ...
                  </div>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white dark:bg-[#242320] border border-[#D6CEBE] dark:border-[#383531] text-[#1C1917] dark:text-[#F5F2EB] rounded-lg hover:bg-[#EFECE5] dark:hover:bg-[#2E2C29] transition-colors cursor-pointer whitespace-nowrap shrink-0">
                    <Camera className="w-3.5 h-3.5" />
                    <span>{uploadingAvatar ? 'Soo gelinaya...' : 'Soo Geli Sawir'}</span>
                    <input
                      type="file"
                      accept="image/*"
                      disabled={uploadingAvatar}
                      onChange={handleAvatarFileChange}
                      className="sr-only"
                    />
                  </label>

                  {googlePhotoUrl && profile.avatarUrl !== googlePhotoUrl && (
                    <button
                      type="button"
                      disabled={uploadingAvatar}
                      onClick={handleUseGooglePhoto}
                      className="px-2.5 py-1.5 text-xs font-medium text-[#14532D] dark:text-[#4ADE80] hover:underline whitespace-nowrap"
                    >
                      Sawirka Google
                    </button>
                  )}

                  {profile.avatarUrl && (
                    <button
                      type="button"
                      disabled={uploadingAvatar}
                      onClick={handleRemoveAvatar}
                      className="px-2 py-1.5 text-xs text-[#78716C] dark:text-[#A8A29E] hover:text-[#991B1B] dark:hover:text-[#FCA5A5] transition-colors whitespace-nowrap"
                    >
                      Ka saar
                    </button>
                  )}
                </div>

                <p className="text-xs text-[#78716C] dark:text-[#A8A29E] mt-1.5">
                  Dooro sawir PNG, JPG, ama WebP — si toos ah ayaa loo cabbirayaa loona kaydinayaa.
                </p>
              </div>
            </div>

            {errorMsg && (
              <div
                role="alert"
                className="mb-4 p-3 rounded-lg bg-[#FEF2F2] dark:bg-[#451A1A]/40 border border-[#FECACA] dark:border-[#7F1D1D] text-xs text-[#991B1B] dark:text-[#FCA5A5]"
              >
                {errorMsg}
              </div>
            )}

            <form onSubmit={handleSaveProfile} className="space-y-4">
              <div>
                <label
                  htmlFor="profile-name"
                  className="block text-xs font-medium text-[#44403C] dark:text-[#D6D3CD] mb-1.5"
                >
                  Magacaaga Muuqda
                </label>
                <input
                  id="profile-name"
                  type="text"
                  required
                  maxLength={BLUEPRINT_LIMITS.user.nameMax}
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-white dark:bg-[#1F1E1C] border border-[#D6CEBE] dark:border-[#383531] rounded-lg text-sm text-[#1C1917] dark:text-[#F5F2EB] focus:outline-none focus:ring-2 focus:ring-[#14532D]/40 focus:border-[#14532D]"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label
                    htmlFor="profile-bio"
                    className="text-xs font-medium text-[#44403C] dark:text-[#D6D3CD]"
                  >
                    Faahfaahin Kooban (Bio)
                  </label>
                  <span className="text-xs font-mono tabular-nums text-[#78716C] dark:text-[#A8A29E]">
                    {bioInput.length}/{BLUEPRINT_LIMITS.user.bioMax}
                  </span>
                </div>
                <textarea
                  id="profile-bio"
                  rows={3}
                  maxLength={BLUEPRINT_LIMITS.user.bioMax}
                  value={bioInput}
                  onChange={(e) => setBioInput(e.target.value)}
                  placeholder="Ku qor waxyaabaha aad jeceshahay inaad akhrido (suugaan, taariikh, saynis...)"
                  className="w-full px-3.5 py-2.5 bg-white dark:bg-[#1F1E1C] border border-[#D6CEBE] dark:border-[#383531] rounded-lg text-sm text-[#1C1917] dark:text-[#F5F2EB] placeholder:text-[#A8A29E] dark:placeholder:text-[#78716C] focus:outline-none focus:ring-2 focus:ring-[#14532D]/40 focus:border-[#14532D] resize-y"
                />
              </div>

              <div className="flex items-center justify-between gap-3">
                <button
                  type="submit"
                  disabled={savingProfile || !nameInput.trim() || (!isDirty && !savedFlag)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-[#14532D] dark:bg-[#15803D] text-white rounded-lg hover:bg-[#0F3F22] dark:hover:bg-[#166534] transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  {savedFlag ? (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>La Kaydiyay</span>
                    </>
                  ) : (
                    <span>{savingProfile ? 'Kaydinaya...' : 'Kaydi Xogta'}</span>
                  )}
                </button>
              </div>
            </form>
          </section>

          {/* 4-Column Reading Statistics Strip */}
          <section
            aria-label="Tirakoobka akhriska"
            className="pt-6 border-t border-[#E5E0D5] dark:border-[#2E2C29]"
          >
            <p className="text-xs tracking-widest uppercase text-[#78716C] dark:text-[#A8A29E] mb-3">
              Tirakoobka Akhriska
            </p>

            {/* Firestore-Backed 15-Minute Daily Reading Streak Counter */}
            <div
              aria-label="Reading Streak"
              className="mb-3 bg-white dark:bg-[#1F1E1C] border border-[#E5E0D5] dark:border-[#2E2C29] rounded-xl p-4"
            >
              <div className="flex items-start justify-between gap-3 mb-2.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div
                    className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                      (readingStreak?.currentStreak ?? 0) > 0
                        ? 'bg-[#9A3412]/10 dark:bg-[#FB923C]/15 text-[#9A3412] dark:text-[#FB923C]'
                        : 'bg-[#F8F6F1] dark:bg-[#292724] text-[#78716C] dark:text-[#A8A29E]'
                    }`}
                  >
                    <Flame className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs tracking-widest uppercase text-[#78716C] dark:text-[#A8A29E]">
                      Reading Streak
                    </p>
                    <p className="font-mono text-xl font-semibold tabular-nums text-[#1C1917] dark:text-[#F5F2EB] leading-tight mt-0.5">
                      {readingStreakLoading
                        ? '...'
                        : `${readingStreak?.currentStreak ?? 0} ${
                            (readingStreak?.currentStreak ?? 0) === 1 ? 'Maalin' : 'Maalmood'
                          }`}
                    </p>
                  </div>
                </div>

                {!readingStreakLoading && (
                  <div className="text-right shrink-0">
                    <p className="text-xs font-mono tabular-nums text-[#14532D] dark:text-[#4ADE80]">
                      Maanta: {Math.min(15, readingStreak?.todayMinutes ?? 0)}/15 daqiiqo
                    </p>
                    {(readingStreak?.longestStreak ?? 0) > 0 && (
                      <p className="text-[11px] font-mono tabular-nums text-[#78716C] dark:text-[#A8A29E] mt-0.5">
                        Rikoor: {readingStreak?.longestStreak} maalmood
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div
                className="h-1.5 w-full bg-[#EFECE5] dark:bg-[#2E2C29] rounded-full overflow-hidden mb-2"
                aria-hidden="true"
              >
                <div
                  className={`h-full transition-all duration-300 ${
                    readingStreak?.todayCompleted
                      ? 'bg-[#14532D] dark:bg-[#22C55E]'
                      : 'bg-[#9A3412] dark:bg-[#FB923C]'
                  }`}
                  style={{
                    width: `${Math.min(
                      100,
                      Math.round(((readingStreak?.todaySeconds ?? 0) / 900) * 100)
                    )}%`,
                  }}
                />
              </div>

              <p className="text-xs text-[#57534E] dark:text-[#A8A29E]">
                {readingStreakLoading
                  ? 'Waxaa laga soo rarayaa xogta akhriska Firestore...'
                  : readingStreak?.todayCompleted
                  ? 'Hadafka maanta (15+ daqiiqo) waa la dhammaystiray!'
                  : (readingStreak?.currentStreak ?? 0) > 0
                  ? `Akhri ${Math.max(
                      1,
                      15 - (readingStreak?.todayMinutes ?? 0)
                    )} daqiiqo oo kale maanta si aad u sii waddo streak-kaaga.`
                  : 'Akhri ugu yaraan 15 daqiiqo maalintii si aad u dhisto maalmaha isxiga.'}
              </p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-white dark:bg-[#1F1E1C] border border-[#E5E0D5] dark:border-[#2E2C29] rounded-xl p-3.5">
                <p className="font-mono text-xl font-medium tabular-nums text-[#1C1917] dark:text-[#F5F2EB]">
                  {favoriteBooks.length}
                </p>
                <p className="text-xs text-[#78716C] dark:text-[#A8A29E] mt-0.5">Favorites</p>
              </div>
              <div className="bg-white dark:bg-[#1F1E1C] border border-[#E5E0D5] dark:border-[#2E2C29] rounded-xl p-3.5">
                <p className="font-mono text-xl font-medium tabular-nums text-[#1C1917] dark:text-[#F5F2EB]">
                  {inProgressCount}
                </p>
                <p className="text-xs text-[#78716C] dark:text-[#A8A29E] mt-0.5">Socda</p>
              </div>
              <div className="bg-white dark:bg-[#1F1E1C] border border-[#E5E0D5] dark:border-[#2E2C29] rounded-xl p-3.5">
                <p className="font-mono text-xl font-medium tabular-nums text-[#14532D] dark:text-[#4ADE80]">
                  {completedCount}
                </p>
                <p className="text-xs text-[#78716C] dark:text-[#A8A29E] mt-0.5">Dhammaystay</p>
              </div>
              <div className="bg-white dark:bg-[#1F1E1C] border border-[#E5E0D5] dark:border-[#2E2C29] rounded-xl p-3.5">
                <p className="font-mono text-xl font-medium tabular-nums text-[#1C1917] dark:text-[#F5F2EB]">
                  {ratingsCount}
                </p>
                <p className="text-xs text-[#78716C] dark:text-[#A8A29E] mt-0.5">Qiimayn</p>
              </div>
            </div>
          </section>

          {/* Favorite Books List */}
          <section
            aria-label="Buugagga aad jeceshahay"
            className="pt-6 border-t border-[#E5E0D5] dark:border-[#2E2C29]"
          >
            <div className="flex items-baseline justify-between gap-2 mb-4">
              <h3 className="font-serif text-lg font-semibold text-[#1C1917] dark:text-[#F5F2EB]">
                Buugagga Aad Jeceshahay (Favorites)
              </h3>
              <span className="text-xs font-mono tabular-nums text-[#78716C] dark:text-[#A8A29E]">
                {favoriteBooks.length} Buug
              </span>
            </div>

            {favoriteBooks.length === 0 ? (
              <div className="p-5 bg-white dark:bg-[#1F1E1C] border border-[#E5E0D5] dark:border-[#2E2C29] rounded-xl text-center">
                <Heart className="w-6 h-6 mx-auto mb-2 text-[#78716C] dark:text-[#A8A29E]" />
                <p className="text-sm font-medium text-[#1C1917] dark:text-[#F5F2EB]">
                  Weli wax buug ah ma aadan calaamadaysan.
                </p>
                <p className="text-xs text-[#78716C] dark:text-[#A8A29E] mt-1">
                  Guji calaamadda wadnaha ee buug kasta si uu halkan ugu kaydsamo.
                </p>
              </div>
            ) : (
              <ul className="space-y-3">
                {favoriteBooks.map((book) => {
                  const prog = readingProgressMap[book.id];
                  const pct = prog?.percentage ?? 0;
                  return (
                    <li
                      key={book.id}
                      className="bg-white dark:bg-[#1F1E1C] border border-[#E5E0D5] dark:border-[#2E2C29] rounded-xl p-3 flex items-center gap-3"
                    >
                      <div className="w-12 shrink-0">
                        <BookCover
                          src={book.coverUrl}
                          title={book.title}
                          author={book.author}
                          category={book.category}
                          className="rounded-md"
                        />
                      </div>

                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-[#78716C] dark:text-[#A8A29E] truncate">
                          {book.category} · {book.author}
                        </p>
                        <h4 className="font-serif text-sm font-semibold text-[#1C1917] dark:text-[#F5F2EB] truncate">
                          {book.title}
                        </h4>
                        {((prog && pct > 0) || Math.floor((sessionSecondsByBook[book.id] || 0) / 60) > 0) && (
                          <p className="text-xs font-mono tabular-nums text-[#14532D] dark:text-[#4ADE80] mt-0.5">
                            {prog && pct > 0
                              ? `Bogga ${prog.currentPage}/${prog.totalPages} · ${pct}%`
                              : 'La bilaabay'}
                            {Math.floor((sessionSecondsByBook[book.id] || 0) / 60) > 0
                              ? ` · ${Math.floor((sessionSecondsByBook[book.id] || 0) / 60)} daqiiqo`
                              : ''}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            onClose();
                            onOpenBook(book);
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-[#14532D] dark:bg-[#15803D] text-white rounded-lg hover:bg-[#0F3F22] dark:hover:bg-[#166534] transition-colors whitespace-nowrap"
                        >
                          <BookOpen className="w-3.5 h-3.5" />
                          <span>{pct > 0 && pct < 100 ? 'Sii Wad' : 'Akhri'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onToggleFavorite(book.id)}
                          aria-label={`Ka saar ${book.title} favorites`}
                          title="Ka saar Favorites"
                          className="p-1.5 rounded-lg text-[#78716C] dark:text-[#A8A29E] hover:text-[#991B1B] dark:hover:text-[#FCA5A5] hover:bg-[#FEF2F2] dark:hover:bg-[#451A1A]/30 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Active Reading Progress List */}
          {progressEntries.length > 0 && (
            <section
              aria-label="Horumarkaaga akhriska"
              className="pt-6 border-t border-[#E5E0D5] dark:border-[#2E2C29]"
            >
              <div className="flex items-baseline justify-between gap-2 mb-4">
                <h3 className="font-serif text-lg font-semibold text-[#1C1917] dark:text-[#F5F2EB]">
                  Horumarka Akhriskaaga
                </h3>
                <span className="text-xs font-mono tabular-nums text-[#78716C] dark:text-[#A8A29E]">
                  {progressEntries.length} Buug
                </span>
              </div>

              <ul className="space-y-3">
                {progressEntries.map(({ book, progress, sessionMinutes }) => {
                  const pct = progress?.percentage ?? 0;
                  const curPage = progress?.currentPage ?? 1;
                  const totPages = progress?.totalPages ?? 1;
                  return (
                    <li
                      key={book.id}
                      className="bg-white dark:bg-[#1F1E1C] border border-[#E5E0D5] dark:border-[#2E2C29] rounded-xl p-3.5"
                    >
                      <div className="flex items-center justify-between gap-3 mb-2">
                        <div className="min-w-0">
                          <h4 className="font-serif text-sm font-semibold text-[#1C1917] dark:text-[#F5F2EB] truncate">
                            {book.title}
                          </h4>
                          <p className="text-xs font-mono tabular-nums text-[#78716C] dark:text-[#A8A29E]">
                            Bogga {curPage}/{totPages} · {pct}%
                            {sessionMinutes > 0 ? ` · ${sessionMinutes} daqiiqo` : ''}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            onClose();
                            onOpenBook(book);
                          }}
                          className="px-3 py-1.5 text-xs font-medium border border-[#D6CEBE] dark:border-[#383531] text-[#1C1917] dark:text-[#F5F2EB] rounded-lg hover:bg-[#F8F6F1] dark:hover:bg-[#292724] transition-colors whitespace-nowrap shrink-0"
                        >
                          {pct >= 100 ? 'Akhri Mar Kale' : 'Sii Wad'}
                        </button>
                      </div>
                      <div className="h-1.5 w-full bg-[#EFECE5] dark:bg-[#2E2C29] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[#14532D] dark:bg-[#22C55E]"
                          style={{
                            width: `${Math.min(100, Math.max(0, pct))}%`,
                          }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>

        {/* Drawer Footer */}
        <div className="px-6 py-4 border-t border-[#E5E0D5] dark:border-[#2E2C29] bg-white dark:bg-[#1C1B19] flex flex-wrap items-center justify-between gap-3">
          {profile.role === 'admin' && onOpenAdminPanel ? (
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenAdminPanel();
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-[#14532D] dark:bg-[#15803D] text-white rounded-lg hover:bg-[#0F3F22] dark:hover:bg-[#166534] transition-colors whitespace-nowrap shrink-0"
            >
              <Shield className="w-3.5 h-3.5" />
              <span>Fur Admin Panel</span>
            </button>
          ) : (
            <span className="text-xs text-[#78716C] dark:text-[#A8A29E]">
              maktabada.so · Profile
            </span>
          )}
          <button
            type="button"
            onClick={() => {
              onClose();
              onLogout();
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium border border-[#D6CEBE] dark:border-[#383531] text-[#1C1917] dark:text-[#F5F2EB] rounded-lg hover:bg-[#F8F6F1] dark:hover:bg-[#292724] transition-colors whitespace-nowrap shrink-0"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Ka Bax Akoonka</span>
          </button>
        </div>
      </aside>
    </div>
  );
}
