import { jsonResponse, verifyFirebaseAdmin } from '../../_shared/cloudflareHelpers.js';

const DEFAULT_GITHUB_REPO = 'aadamali989-star/Maktabadda';
const MAX_COVER_BYTES = 10 * 1024 * 1024;
const MAX_BOOK_BYTES = 25 * 1024 * 1024;

function sanitizeFileName(name) {
  const cleaned = String(name || '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/^_+/, '');
  return (cleaned || 'file').slice(0, 120);
}

function normalizeSecretValue(raw) {
  let val = String(raw || '').trim();
  if (!val) return '';
  if (
    (val.startsWith('"') && val.endsWith('"')) ||
    (val.startsWith("'") && val.endsWith("'"))
  ) {
    val = val.slice(1, -1).trim();
  }
  val = val.replace(/^GITHUB_TOKEN\s*=\s*/i, '').trim();
  if (/^Bearer\s+/i.test(val)) {
    val = val.replace(/^Bearer\s+/i, '').trim();
  }
  return val;
}

function parseRepoSlug(raw) {
  const cleaned = String(raw || '')
    .trim()
    .replace(/\/+$/, '')
    .replace(/^https?:\/\/github\.com\//i, '');
  const parts = cleaned.split('/').filter(Boolean);
  if (parts.length < 2) {
    return { owner: 'aadamali989-star', repo: 'Maktabadda' };
  }
  return { owner: parts[0], repo: parts[1].replace(/\.git$/i, '') };
}

function estimateBase64ByteLength(b64) {
  const clean = b64.replace(/=+$/, '');
  return Math.floor((clean.length * 3) / 4);
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const subPath = url.pathname.replace(/^\/api\/github-host\/?/, '');

  if (request.method === 'GET' && subPath === 'status') {
    const token = normalizeSecretValue(env?.GITHUB_TOKEN);
    const { owner, repo } = parseRepoSlug(env?.GITHUB_HOST_REPO || DEFAULT_GITHUB_REPO);
    const repoSlug = `${owner}/${repo}`;

    if (!token) {
      return jsonResponse({
        configured: false,
        canWrite: false,
        tokenError: '',
        repo: repoSlug,
      });
    }

    let canWrite = true;
    let tokenError = '';
    try {
      const repoRes = await fetch(
        `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
        {
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${token}`,
            'User-Agent': 'maktabada-so-uploader',
          },
        }
      );
      if (!repoRes.ok) {
        canWrite = false;
        tokenError =
          repoRes.status === 401
            ? 'GITHUB_TOKEN waa khaldan yahay ama wuu dhacay (HTTP 401).'
            : `GitHub repo (${repoSlug}) lama gaari karin (HTTP ${repoRes.status}).`;
      } else {
        const repoData = await repoRes.json();
        if (repoData?.permissions && repoData.permissions.push === false) {
          canWrite = false;
          tokenError = 'GITHUB_TOKEN ma laha awoodda Contents: Read and write.';
        }
      }
    } catch {
      // Transient network error
    }

    return jsonResponse({
      configured: true,
      canWrite,
      tokenError,
      repo: repoSlug,
    });
  }

  if (request.method !== 'POST' || subPath !== 'upload') {
    return jsonResponse({ error: request.method === 'POST' ? 'NOT_FOUND' : 'METHOD_NOT_ALLOWED' }, request.method === 'POST' ? 404 : 405);
  }

  try {
    const token = normalizeSecretValue(env?.GITHUB_TOKEN);
    if (!token) {
      return jsonResponse(
        {
          error: 'GITHUB_NOT_CONFIGURED',
          message:
            'GITHUB_TOKEN weli laguma darin Cloudflare Pages Environment Variables.',
        },
        503
      );
    }

    const authHeader = request.headers.get('authorization') || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    await verifyFirebaseAdmin(idToken, env);

    const body = await request.json();
    const folder = body?.folder === 'covers' ? 'covers' : body?.folder === 'books' ? 'books' : null;
    if (!folder) {
      return jsonResponse(
        { error: 'INVALID_FOLDER', message: 'Folder-ku waa inuu noqdaa covers ama books.' },
        400
      );
    }

    const fileName = typeof body?.fileName === 'string' ? body.fileName.trim() : '';
    const contentBase64 =
      typeof body?.contentBase64 === 'string'
        ? body.contentBase64.replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '')
        : '';

    if (!fileName || !contentBase64) {
      return jsonResponse(
        { error: 'MISSING_FILE', message: 'Magaca faylka iyo xogtiisa waa lagama maarmaan.' },
        400
      );
    }

    const byteLength = estimateBase64ByteLength(contentBase64);
    const maxAllowed = folder === 'covers' ? MAX_COVER_BYTES : MAX_BOOK_BYTES;
    if (byteLength > maxAllowed) {
      return jsonResponse(
        {
          error: 'FILE_TOO_LARGE',
          message: `Faylku wuu ka weyn yahay xadka (${Math.round(maxAllowed / (1024 * 1024))} MB).`,
        },
        413
      );
    }

    const requestedRepo =
      typeof body?.repo === 'string' && body.repo.trim()
        ? body.repo.trim()
        : env?.GITHUB_HOST_REPO || DEFAULT_GITHUB_REPO;
    const { owner, repo } = parseRepoSlug(requestedRepo);

    const repoRes = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'User-Agent': 'maktabada-so-uploader',
        },
      }
    );

    if (!repoRes.ok) {
      const errBody = await repoRes.text();
      return jsonResponse(
        {
          error: 'GITHUB_REPO_ERROR',
          message: `Lama furi karin repo-ga ${owner}/${repo} (HTTP ${repoRes.status}): ${errBody.slice(0, 200)}`,
        },
        500
      );
    }

    const repoJson = await repoRes.json();
    const branch = repoJson.default_branch || 'main';
    const safeName = sanitizeFileName(fileName);
    const targetPath = `${folder}/${Date.now()}_${safeName}`;
    const encodedSegments = targetPath
      .split('/')
      .map((s) => encodeURIComponent(s))
      .join('/');

    const putRes = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
        repo
      )}/contents/${encodedSegments}`,
      {
        method: 'PUT',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'User-Agent': 'maktabada-so-uploader',
        },
        body: JSON.stringify({
          message: `Add ${folder === 'covers' ? 'cover' : 'book'}: ${safeName}`,
          content: contentBase64,
          branch,
        }),
      }
    );

    if (!putRes.ok) {
      const errBody = await putRes.text();
      return jsonResponse(
        {
          error: 'GITHUB_UPLOAD_ERROR',
          message: `GitHub upload waa la diiday (HTTP ${putRes.status}). Hubi GITHUB_TOKEN. ${errBody.slice(0, 200)}`,
        },
        500
      );
    }

    return jsonResponse({
      cdnUrl: `https://cdn.jsdelivr.net/gh/${encodeURIComponent(owner)}/${encodeURIComponent(
        repo
      )}@${encodeURIComponent(branch)}/${encodedSegments}`,
      rawUrl: `https://raw.githubusercontent.com/${encodeURIComponent(
        owner
      )}/${encodeURIComponent(repo)}/${encodeURIComponent(branch)}/${encodedSegments}`,
      path: targetPath,
      branch,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith('UNAUTHORIZED:')) {
      return jsonResponse({ error: 'UNAUTHORIZED', message: msg.replace('UNAUTHORIZED: ', '') }, 401);
    }
    if (msg.startsWith('FORBIDDEN:')) {
      return jsonResponse({ error: 'FORBIDDEN', message: msg.replace('FORBIDDEN: ', '') }, 403);
    }
    return jsonResponse({ error: 'UPLOAD_FAILED', message: msg }, 500);
  }
}
