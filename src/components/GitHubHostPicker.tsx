import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  ExternalLink,
  FolderGit2,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import {
  fetchGitHubHostStatus,
  fetchPublicGitHubLibraryFiles,
  formatBytesCompact,
  formatTitleFromFileName,
  getSavedGitHubHostRepo,
  normalizeGitHubAssetUrl,
  parseGitHubRepoInput,
  saveGitHubHostRepo,
  type GitHubRepoScanResult,
  type GitHubUploadStatus,
} from '../services/githubHostService';
import { extractErrorMessage } from '../services/libraryService';
import { BLUEPRINT_LIMITS, type BookFileType } from '../types';

interface GitHubHostPickerProps {
  coverUrl: string;
  fileUrl: string;
  onCoverUrlChange: (url: string) => void;
  onFileUrlChange: (
    url: string,
    meta?: {
      fileType?: BookFileType;
      suggestedTitle?: string;
      extractedText?: string;
    }
  ) => void;
  disabled?: boolean;
}

export function GitHubHostPicker({
  coverUrl,
  fileUrl,
  onCoverUrlChange,
  onFileUrlChange,
  disabled = false,
}: GitHubHostPickerProps) {
  const [repoInput, setRepoInput] = useState<string>(() => getSavedGitHubHostRepo());
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<GitHubRepoScanResult | null>(null);
  const [scanError, setScanError] = useState('');
  const [loadingTxt, setLoadingTxt] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<GitHubUploadStatus | null>(null);

  const resolvedRepoUrl = (() => {
    try {
      const parsed = parseGitHubRepoInput(repoInput);
      return `https://github.com/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}`;
    } catch {
      return 'https://github.com/new';
    }
  })();

  useEffect(() => {
    let active = true;
    fetchGitHubHostStatus().then((status) => {
      if (active) setUploadStatus(status);
    });

    const initial = getSavedGitHubHostRepo().trim();
    if (!initial) {
      return () => {
        active = false;
      };
    }
    setScanning(true);
    fetchPublicGitHubLibraryFiles(initial)
      .then((result) => {
        if (!active) return;
        setScanResult(result);
      })
      .catch(() => {
        // Silent on initial auto-scan if repo is newly created / empty
      })
      .finally(() => {
        if (active) setScanning(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const handleScanRepo = async () => {
    setScanError('');
    setScanning(true);
    try {
      const result = await fetchPublicGitHubLibraryFiles(repoInput);
      setScanResult(result);
      if (result.covers.length === 0 && result.books.length === 0) {
        setScanError(
          `Repo-ga "${result.owner}/${result.repo}" wuu furan yahay (${result.branch}), laakiin lagama helin PDF, EPUB, TXT, ama sawirro.`
        );
      }
    } catch (err) {
      setScanResult(null);
      setScanError(extractErrorMessage(err));
    } finally {
      setScanning(false);
    }
  };

  const handleSelectGitHubCover = (cdnUrl: string) => {
    onCoverUrlChange(cdnUrl);
  };

  const handleSelectGitHubBook = async (cdnUrl: string) => {
    if (!cdnUrl || !scanResult) {
      onFileUrlChange(cdnUrl);
      return;
    }

    const picked = scanResult.books.find((b) => b.cdnUrl === cdnUrl);
    if (!picked) {
      onFileUrlChange(cdnUrl);
      return;
    }

    const nextType: BookFileType =
      picked.ext === 'pdf'
        ? 'pdf'
        : picked.ext === 'epub'
        ? 'epub'
        : 'txt';
    const suggestedTitle = formatTitleFromFileName(picked.name);

    if (picked.ext === 'txt' || picked.ext === 'md') {
      setLoadingTxt(true);
      try {
        const res = await fetch(picked.cdnUrl);
        if (res.ok) {
          const text = await res.text();
          onFileUrlChange(cdnUrl, {
            fileType: nextType,
            suggestedTitle,
            extractedText: text.slice(0, BLUEPRINT_LIMITS.book.contentTextMax),
          });
          return;
        }
      } catch {
        // Fallback to URL only
      } finally {
        setLoadingTxt(false);
      }
    }

    onFileUrlChange(cdnUrl, {
      fileType: nextType,
      suggestedTitle,
    });
  };

  return (
    <div className="p-4 rounded-xl bg-[#F8F6F1]/80 dark:bg-[#141312] border border-[#E5E0D5] dark:border-[#2E2C29] space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-[#1C1917] dark:text-[#F5F2EB]">
            <FolderGit2 className="w-4 h-4 text-[#14532D] dark:text-[#4ADE80]" />
            <span>GitHub Free Host (0$ · Billing La&apos;aan)</span>
          </div>
          <p className="text-xs text-[#57534E] dark:text-[#A8A29E] mt-1 leading-relaxed">
            Ku shub PDF/EPUB &amp; sawirradaada repo <strong>Public</strong> ah oo GitHub ah, kadibna halkan ka soo qaado si toos ah (jsDelivr CDN).
          </p>
        </div>

        <a
          href={resolvedRepoUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-white dark:bg-[#1C1B19] border border-[#D6CEBE] dark:border-[#383531] text-[#1C1917] dark:text-[#F5F2EB] rounded-lg hover:bg-[#EFECE5] dark:hover:bg-[#292724] transition-colors whitespace-nowrap shrink-0"
        >
          <span>{resolvedRepoUrl.endsWith('/new') ? 'Samee Repo GitHub' : 'Fur Repo-ga GitHub'}</span>
          <ExternalLink className="w-3 h-3" />
        </a>
      </div>

      {uploadStatus && (
        <p
          className={`text-xs leading-relaxed ${
            uploadStatus.tokenError
              ? 'text-[#991B1B] dark:text-[#FCA5A5]'
              : uploadStatus.configured
              ? 'text-[#14532D] dark:text-[#4ADE80]'
              : 'text-[#57534E] dark:text-[#A8A29E]'
          }`}
        >
          {uploadStatus.tokenError
            ? uploadStatus.tokenError
            : uploadStatus.configured
            ? `Isku xirka tooska ah wuu shaqaynayaa (${uploadStatus.repo}): fayl kasta oo aad hoos ka doorato si toos ah ayuu GitHub ugu kaydsamayaa markaad gujiso Kaydi.`
            : 'Soo gelinta tooska ah ee PDF/EPUB (1-gujis) waxay sugaysaa GITHUB_TOKEN in lagu daro Secrets / Netlify Env Vars. Hadda waad ka soo dooran kartaa faylasha repo-ga ama toos baad u gelin kartaa TXT & sawirro.'}
        </p>
      )}

      {/* Repo Scanner */}
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          disabled={disabled || scanning}
          value={repoInput}
          onChange={(e) => setRepoInput(e.target.value)}
          onBlur={() => {
            try {
              const parsed = parseGitHubRepoInput(repoInput);
              saveGitHubHostRepo(`${parsed.owner}/${parsed.repo}`);
            } catch {
              // Ignore invalid partial input on blur
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void handleScanRepo();
            }
          }}
          placeholder="magacaaga/maktabada-files ama https://github.com/..."
          aria-label="Magaca GitHub public repository"
          className="flex-1 px-3 py-2 bg-white dark:bg-[#1C1B19] border border-[#D6CEBE] dark:border-[#383531] rounded-lg text-xs text-[#1C1917] dark:text-[#F5F2EB] placeholder:text-[#A8A29E] dark:placeholder:text-[#78716C] focus:outline-none focus:ring-2 focus:ring-[#14532D]/30 focus:border-[#14532D]"
        />
        <button
          type="button"
          disabled={disabled || scanning || !repoInput.trim()}
          onClick={handleScanRepo}
          className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-[#14532D] dark:bg-[#15803D] text-white rounded-lg hover:bg-[#0F3F22] dark:hover:bg-[#166534] transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
        >
          {scanning ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <RefreshCw className="w-3.5 h-3.5" />
          )}
          <span>{scanning ? 'Raadinaya...' : 'Soo Hel Faylasha'}</span>
        </button>
      </div>

      {scanError && (
        <p className="text-xs text-[#991B1B] dark:text-[#FCA5A5] leading-relaxed">
          {scanError}
        </p>
      )}

      {scanResult && (scanResult.covers.length > 0 || scanResult.books.length > 0) && (
        <div className="space-y-3 pt-1 border-t border-[#E5E0D5] dark:border-[#2E2C29]">
          <div className="flex items-center gap-1.5 text-xs text-[#14532D] dark:text-[#4ADE80] font-medium">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            <span>
              {scanResult.owner}/{scanResult.repo} ({scanResult.branch}):{' '}
              {scanResult.books.length} buug · {scanResult.covers.length} sawir
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="gh-cover-select"
                className="block text-xs font-medium text-[#44403C] dark:text-[#D6D3CD] mb-1"
              >
                Dooro Sawirka Jaldiga (GitHub)
              </label>
              <select
                id="gh-cover-select"
                disabled={disabled || scanResult.covers.length === 0}
                value={
                  scanResult.covers.some((c) => c.cdnUrl === coverUrl) ? coverUrl : ''
                }
                onChange={(e) => handleSelectGitHubCover(e.target.value)}
                className="w-full px-3 py-2 bg-white dark:bg-[#1C1B19] border border-[#D6CEBE] dark:border-[#383531] rounded-lg text-xs text-[#1C1917] dark:text-[#F5F2EB] focus:outline-none focus:ring-2 focus:ring-[#14532D]/30 focus:border-[#14532D]"
              >
                <option value="">
                  {scanResult.covers.length > 0
                    ? `-- Dooro sawir (${scanResult.covers.length}) --`
                    : 'Sawir lagama helin repo-ga'}
                </option>
                {scanResult.covers.map((c) => (
                  <option key={c.path} value={c.cdnUrl}>
                    {c.path} {c.size ? `(${formatBytesCompact(c.size)})` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="gh-book-select"
                className="block text-xs font-medium text-[#44403C] dark:text-[#D6D3CD] mb-1"
              >
                Dooro Faylka Buugga (GitHub)
              </label>
              <select
                id="gh-book-select"
                disabled={disabled || scanResult.books.length === 0 || loadingTxt}
                value={
                  scanResult.books.some((b) => b.cdnUrl === fileUrl) ? fileUrl : ''
                }
                onChange={(e) => void handleSelectGitHubBook(e.target.value)}
                className="w-full px-3 py-2 bg-white dark:bg-[#1C1B19] border border-[#D6CEBE] dark:border-[#383531] rounded-lg text-xs text-[#1C1917] dark:text-[#F5F2EB] focus:outline-none focus:ring-2 focus:ring-[#14532D]/30 focus:border-[#14532D]"
              >
                <option value="">
                  {scanResult.books.length > 0
                    ? `-- Dooro PDF/EPUB/TXT (${scanResult.books.length}) --`
                    : 'Fayl buug lagama helin repo-ga'}
                </option>
                {scanResult.books.map((b) => (
                  <option key={b.path} value={b.cdnUrl}>
                    {b.path} {b.size ? `(${formatBytesCompact(b.size)})` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Direct HTTPS / Auto-normalized GitHub URLs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-[#E5E0D5] dark:border-[#2E2C29]">
        <div>
          <label
            htmlFor="external-cover-url"
            className="block text-xs font-medium text-[#44403C] dark:text-[#D6D3CD] mb-1"
          >
            Link-ga Sawirka Jaldiga (HTTPS / GitHub)
          </label>
          <input
            id="external-cover-url"
            type="url"
            disabled={disabled}
            maxLength={BLUEPRINT_LIMITS.book.coverUrlMax}
            value={coverUrl}
            onChange={(e) => onCoverUrlChange(e.target.value)}
            onBlur={(e) => {
              const normalized = normalizeGitHubAssetUrl(e.target.value);
              if (normalized !== e.target.value) onCoverUrlChange(normalized);
            }}
            placeholder="https://cdn.jsdelivr.net/gh/..."
            className="w-full px-3 py-2 bg-white dark:bg-[#1C1B19] border border-[#D6CEBE] dark:border-[#383531] rounded-lg text-xs text-[#1C1917] dark:text-[#F5F2EB] focus:outline-none focus:ring-2 focus:ring-[#14532D]/30 focus:border-[#14532D]"
          />
        </div>

        <div>
          <label
            htmlFor="external-file-url"
            className="block text-xs font-medium text-[#44403C] dark:text-[#D6D3CD] mb-1"
          >
            Link-ga Faylka Buugga (PDF/EPUB HTTPS)
          </label>
          <input
            id="external-file-url"
            type="url"
            disabled={disabled}
            maxLength={BLUEPRINT_LIMITS.book.urlMax}
            value={fileUrl}
            onChange={(e) => onFileUrlChange(e.target.value)}
            onBlur={(e) => {
              const normalized = normalizeGitHubAssetUrl(e.target.value);
              if (normalized !== e.target.value) onFileUrlChange(normalized);
            }}
            placeholder="https://cdn.jsdelivr.net/gh/.../buug.pdf"
            className="w-full px-3 py-2 bg-white dark:bg-[#1C1B19] border border-[#D6CEBE] dark:border-[#383531] rounded-lg text-xs text-[#1C1917] dark:text-[#F5F2EB] focus:outline-none focus:ring-2 focus:ring-[#14532D]/30 focus:border-[#14532D]"
          />
        </div>
      </div>

      <p className="text-[11px] text-[#78716C] dark:text-[#A8A29E] leading-relaxed">
        Tallaabada: 1) Samee repo <strong>Public</strong> ah GitHub → 2) Ku tuur faylasha (Add file → Upload files) → 3) Halkan ku qor <code className="font-mono">owner/repo</code> oo dooro faylka. Link-ga <code className="font-mono">github.com/.../blob/...</code> si toos ah ayuu isugu beddelayaa CDN si PDF-ku gudaha uga furmo.
      </p>
    </div>
  );
}
