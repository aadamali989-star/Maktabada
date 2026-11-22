export interface GitHubHostedFile {
  path: string;
  name: string;
  size: number;
  cdnUrl: string;
  rawUrl: string;
  ext: string;
}

export interface GitHubRepoScanResult {
  owner: string;
  repo: string;
  branch: string;
  covers: GitHubHostedFile[];
  books: GitHubHostedFile[];
}

export const DEFAULT_GITHUB_HOST_REPO = 'aadamali989-star/Maktabadda';

const GITHUB_REPO_STORAGE_KEY = 'maktabada_github_host_repo';
const COVER_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'avif', 'gif', 'svg']);
const BOOK_EXTENSIONS = new Set(['pdf', 'epub', 'txt', 'md']);

export function getSavedGitHubHostRepo(): string {
  try {
    return localStorage.getItem(GITHUB_REPO_STORAGE_KEY) || DEFAULT_GITHUB_HOST_REPO;
  } catch {
    return DEFAULT_GITHUB_HOST_REPO;
  }
}

export function saveGitHubHostRepo(repoSlug: string): void {
  try {
    const clean = repoSlug.trim();
    if (clean) {
      localStorage.setItem(GITHUB_REPO_STORAGE_KEY, clean);
    } else {
      localStorage.removeItem(GITHUB_REPO_STORAGE_KEY);
    }
  } catch {
    // Ignore localStorage quota/private mode errors
  }
}

export function parseGitHubRepoInput(raw: string): {
  owner: string;
  repo: string;
  branch?: string;
} {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) {
    throw new Error('Fadlan geli magaca GitHub repo-ga (tusaale: magacaaga/maktabada-files).');
  }

  // Handle full GitHub URLs like https://github.com/owner/repo or https://github.com/owner/repo/tree/main
  if (/^https?:\/\//i.test(trimmed)) {
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      throw new Error('Link-ga GitHub ma saxna.');
    }
    if (!parsed.hostname.toLowerCase().includes('github.com')) {
      throw new Error('Fadlan geli link github.com sax ah ama qor owner/repo.');
    }
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length < 2) {
      throw new Error('Link-ga GitHub waa inuu lahaadaa owner/repo.');
    }
    const owner = parts[0];
    const repo = parts[1].replace(/\.git$/i, '');
    const branch = parts[2] === 'tree' && parts[3] ? parts[3] : undefined;
    return { owner, repo, branch };
  }

  // Handle owner/repo or owner/repo@branch
  const [slugPart, branchPart] = trimmed.split('@');
  const parts = slugPart.split('/').filter(Boolean);
  if (parts.length !== 2) {
    throw new Error('Qaabka saxda ah waa: owner/repo (tusaale: aadamali/maktabada-files).');
  }

  return {
    owner: parts[0],
    repo: parts[1].replace(/\.git$/i, ''),
    branch: branchPart?.trim() || undefined,
  };
}

export function buildJsDelivrUrl(
  owner: string,
  repo: string,
  branch: string,
  filePath: string
): string {
  const encodedPath = filePath
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `https://cdn.jsdelivr.net/gh/${encodeURIComponent(owner)}/${encodeURIComponent(
    repo
  )}@${encodeURIComponent(branch)}/${encodedPath}`;
}

export function buildRawGitHubUrl(
  owner: string,
  repo: string,
  branch: string,
  filePath: string
): string {
  const encodedPath = filePath
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(
    repo
  )}/${encodeURIComponent(branch)}/${encodedPath}`;
}

/**
 * Converts GitHub blob / raw.githubusercontent.com URLs into jsDelivr CDN URLs
 * so PDFs render inline inside <iframe> with proper Content-Type and CORS headers.
 */
export function normalizeGitHubAssetUrl(rawUrl: string): string {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) return '';

  // Match https://github.com/owner/repo/blob/branch/path/to/file.pdf
  const blobMatch = trimmed.match(
    /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/i
  );
  if (blobMatch) {
    const [, owner, repo, branch, rawPath] = blobMatch;
    const cleanPath = decodeURIComponent(rawPath.split('?')[0]);
    return buildJsDelivrUrl(owner, repo, decodeURIComponent(branch), cleanPath);
  }

  // Match https://raw.githubusercontent.com/owner/repo/(refs/heads/)?branch/path/to/file.pdf
  const rawMatch = trimmed.match(
    /^https?:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/(?:refs\/heads\/)?([^/]+)\/(.+)$/i
  );
  if (rawMatch) {
    const [, owner, repo, branch, rawPath] = rawMatch;
    const cleanPath = decodeURIComponent(rawPath.split('?')[0]);
    return buildJsDelivrUrl(owner, repo, decodeURIComponent(branch), cleanPath);
  }

  return trimmed;
}

export function formatTitleFromFileName(fileName: string): string {
  return fileName
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function formatBytesCompact(bytes: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface GitHubUploadStatus {
  configured: boolean;
  repo: string;
  reachable: boolean;
}

export interface GitHubUploadResult {
  cdnUrl: string;
  rawUrl: string;
  path: string;
  branch: string;
}

export type GitHubUploadErrorCode =
  | 'GITHUB_NOT_CONFIGURED'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'FILE_TOO_LARGE'
  | 'SERVER_UNAVAILABLE'
  | 'UPLOAD_FAILED';

export class GitHubHostUploadError extends Error {
  code: GitHubUploadErrorCode;
  status: number;

  constructor(code: GitHubUploadErrorCode, status: number, message: string) {
    super(message);
    this.name = 'GitHubHostUploadError';
    this.code = code;
    this.status = status;
  }
}

let cachedStatus: { value: GitHubUploadStatus; fetchedAt: number } | null = null;

export async function fetchGitHubHostStatus(forceRefresh = false): Promise<GitHubUploadStatus> {
  if (!forceRefresh && cachedStatus && Date.now() - cachedStatus.fetchedAt < 30000) {
    return cachedStatus.value;
  }

  const fallback: GitHubUploadStatus = {
    configured: false,
    repo: getSavedGitHubHostRepo(),
    reachable: false,
  };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch('/api/github-host/status', {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      const contentType = res.headers.get('content-type') || '';
      if (!res.ok || !contentType.includes('application/json')) {
        return fallback;
      }
      const data = (await res.json()) as { configured?: unknown; repo?: unknown };
      const value: GitHubUploadStatus = {
        configured: Boolean(data.configured),
        repo: typeof data.repo === 'string' && data.repo.trim() ? data.repo.trim() : fallback.repo,
        reachable: true,
      };
      cachedStatus = { value, fetchedAt: Date.now() };
      return value;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return fallback;
  }
}

export function fileToBase64(file: Blob | File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const commaIdx = result.indexOf(',');
      if (commaIdx === -1) {
        reject(new Error('Faylka lama akhrin karin (base64).'));
        return;
      }
      resolve(result.slice(commaIdx + 1));
    };
    reader.onerror = () => {
      reject(new Error('Faylka lama akhrin karin ka hor inta aan la dirin.'));
    };
    reader.readAsDataURL(file);
  });
}

export async function uploadFileToGitHubHost(params: {
  folder: 'covers' | 'books';
  file: File;
  idToken: string;
  repo?: string;
  onProgress?: (percent: number) => void;
}): Promise<GitHubUploadResult> {
  const { folder, file, idToken, repo, onProgress } = params;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new GitHubHostUploadError(
      'SERVER_UNAVAILABLE',
      0,
      'Internet ma jiro. Fadlan hubi khadkaaga.'
    );
  }

  onProgress?.(5);
  const contentBase64 = await fileToBase64(file);
  onProgress?.(15);

  const payload = JSON.stringify({
    folder,
    fileName: file.name,
    contentBase64,
    repo: (repo || getSavedGitHubHostRepo()).trim(),
  });

  return new Promise<GitHubUploadResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/github-host/upload');
    xhr.timeout = 90000;
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('Authorization', `Bearer ${idToken}`);

    xhr.upload.onprogress = (evt) => {
      if (evt.lengthComputable && evt.total > 0) {
        const pct = Math.min(92, Math.max(15, Math.round(15 + (evt.loaded / evt.total) * 77)));
        onProgress?.(pct);
      }
    };

    xhr.upload.onload = () => {
      onProgress?.(95);
    };

    xhr.onload = () => {
      const contentType = xhr.getResponseHeader('content-type') || '';
      let parsed: Record<string, unknown> | null = null;
      if (contentType.includes('application/json') || xhr.responseText.trim().startsWith('{')) {
        try {
          parsed = JSON.parse(xhr.responseText) as Record<string, unknown>;
        } catch {
          parsed = null;
        }
      }

      if (xhr.status >= 200 && xhr.status < 300 && parsed && typeof parsed.cdnUrl === 'string') {
        onProgress?.(100);
        resolve({
          cdnUrl: parsed.cdnUrl,
          rawUrl: typeof parsed.rawUrl === 'string' ? parsed.rawUrl : parsed.cdnUrl,
          path: typeof parsed.path === 'string' ? parsed.path : '',
          branch: typeof parsed.branch === 'string' ? parsed.branch : 'main',
        });
        return;
      }

      const apiError = typeof parsed?.error === 'string' ? parsed.error : '';
      const apiMsg = typeof parsed?.message === 'string' ? parsed.message : '';

      if (xhr.status === 404 || !parsed) {
        reject(
          new GitHubHostUploadError(
            'SERVER_UNAVAILABLE',
            xhr.status,
            'Adeegga tooska ah ee GitHub Upload lama helin (404). Hubi in server-ka / Netlify Functions uu shaqaynayo.'
          )
        );
        return;
      }

      if (xhr.status === 503 || apiError === 'GITHUB_NOT_CONFIGURED') {
        reject(
          new GitHubHostUploadError(
            'GITHUB_NOT_CONFIGURED',
            xhr.status,
            apiMsg ||
              'GITHUB_TOKEN weli laguma darin Secrets / Netlify Environment Variables.'
          )
        );
        return;
      }

      if (xhr.status === 401 || apiError === 'UNAUTHORIZED') {
        reject(
          new GitHubHostUploadError(
            'UNAUTHORIZED',
            xhr.status,
            apiMsg || 'Fadlan dib u soo gal xisaabtaada Admin-ka.'
          )
        );
        return;
      }

      if (xhr.status === 403 || apiError === 'FORBIDDEN') {
        reject(
          new GitHubHostUploadError(
            'FORBIDDEN',
            xhr.status,
            apiMsg || 'Xisaabtan ma laha awoodda Admin-ka ee soo gelinta.'
          )
        );
        return;
      }

      if (xhr.status === 413 || apiError === 'FILE_TOO_LARGE') {
        reject(
          new GitHubHostUploadError(
            'FILE_TOO_LARGE',
            xhr.status,
            apiMsg ||
              'Faylku wuu ka weyn yahay xadka server-ka (Netlify ~4.5 MB, GitHub ~25 MB). Fadlan si toos ah ugu tuur GitHub repo-ga kadibna ka dooro liiska GitHub Free Host.'
          )
        );
        return;
      }

      reject(
        new GitHubHostUploadError(
          'UPLOAD_FAILED',
          xhr.status,
          apiMsg || `Soo gelinta GitHub way fashilantay (HTTP ${xhr.status}).`
        )
      );
    };

    xhr.ontimeout = () => {
      reject(
        new GitHubHostUploadError(
          'UPLOAD_FAILED',
          0,
          'Soo gelinta GitHub way daahday. Hubi xajmiga faylka iyo khadkaaga.'
        )
      );
    };

    xhr.onerror = () => {
      reject(
        new GitHubHostUploadError(
          'SERVER_UNAVAILABLE',
          0,
          'Lama gaari karin adeegga GitHub Upload.'
        )
      );
    };

    xhr.send(payload);
  });
}

export async function fetchPublicGitHubLibraryFiles(
  repoInput: string
): Promise<GitHubRepoScanResult> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error('Internet ma jiro. Fadlan hubi khadkaaga.');
  }

  const { owner, repo, branch: requestedBranch } = parseGitHubRepoInput(repoInput);

  let branch = requestedBranch;
  if (!branch) {
    const repoRes = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
      { headers: { Accept: 'application/vnd.github+json' } }
    );

    if (repoRes.status === 404) {
      throw new Error(
        `Repo-ga "${owner}/${repo}" lama helin ama waa Private. Hubi inuu yahay Public repository.`
      );
    }
    if (repoRes.status === 403) {
      throw new Error(
        'Xadka codsiyada GitHub API wuu buuxsamay hadda. Sug dhowr daqiiqo ama geli link-ga tooska ah.'
      );
    }
    if (!repoRes.ok) {
      throw new Error(`GitHub repo lama furi karin (HTTP ${repoRes.status}).`);
    }

    const repoData = (await repoRes.json()) as { default_branch?: string; private?: boolean };
    if (repoData.private) {
      throw new Error('Repo-gan waa Private. Fadlan ka dhig Public si maktabadda looga akhriyo.');
    }
    branch = repoData.default_branch || 'main';
  }

  const treeRes = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
      repo
    )}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    { headers: { Accept: 'application/vnd.github+json' } }
  );

  if (treeRes.status === 404) {
    throw new Error(
      `Branch-ka "${branch}" lama helin ama repo-gu weli wuu madhan yahay (ku dar ugu yaraan 1 fayl).`
    );
  }
  if (!treeRes.ok) {
    throw new Error(`Faylasha GitHub lama soo akhrin karin (HTTP ${treeRes.status}).`);
  }

  const treeData = (await treeRes.json()) as {
    tree?: Array<{ path?: string; type?: string; size?: number }>;
  };

  const covers: GitHubHostedFile[] = [];
  const books: GitHubHostedFile[] = [];

  for (const item of treeData.tree || []) {
    if (item.type !== 'blob' || !item.path) continue;
    const name = item.path.split('/').pop() || item.path;
    if (name.toLowerCase() === 'readme.md' || item.path.startsWith('.github/')) continue;
    const ext = (name.split('.').pop() || '').toLowerCase();

    const hosted: GitHubHostedFile = {
      path: item.path,
      name,
      size: item.size || 0,
      cdnUrl: buildJsDelivrUrl(owner, repo, branch, item.path),
      rawUrl: buildRawGitHubUrl(owner, repo, branch, item.path),
      ext,
    };

    if (COVER_EXTENSIONS.has(ext)) {
      covers.push(hosted);
    } else if (BOOK_EXTENSIONS.has(ext)) {
      books.push(hosted);
    }
  }

  covers.sort((a, b) => a.path.localeCompare(b.path));
  books.sort((a, b) => a.path.localeCompare(b.path));

  saveGitHubHostRepo(`${owner}/${repo}`);

  return {
    owner,
    repo,
    branch,
    covers,
    books,
  };
}
