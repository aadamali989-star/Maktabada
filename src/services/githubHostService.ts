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

export const DEFAULT_GITHUB_HOST_REPO = 'aadamali989-star/maktabadda';

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
