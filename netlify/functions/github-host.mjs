import fs from 'node:fs';
import path from 'node:path';
import { Buffer } from 'node:buffer';

function loadFirebaseConfig() {
  const candidates = [
    new URL('../../firebase-applet-config.json', import.meta.url),
    path.join(process.cwd(), 'firebase-applet-config.json'),
  ];
  for (const target of candidates) {
    try {
      const raw = fs.readFileSync(target, 'utf8');
      return JSON.parse(raw);
    } catch {
      // Try next location
    }
  }
  return {
    projectId: process.env.FIREBASE_PROJECT_ID || '',
    apiKey: process.env.FIREBASE_API_KEY || '',
    firestoreDatabaseId: process.env.FIREBASE_DATABASE_ID || '(default)',
  };
}

const firebaseConfig = loadFirebaseConfig();

const DEFAULT_GITHUB_REPO = 'aadamali989-star/Maktabadda';
const BOOTSTRAPPED_ADMIN_EMAIL = 'aadamali989@gmail.com';
const MAX_COVER_BYTES = 10 * 1024 * 1024;
const MAX_BOOK_BYTES = 25 * 1024 * 1024;

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

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

async function verifyFirebaseAdmin(idToken) {
  if (!idToken) {
    throw new Error('UNAUTHORIZED: Fadlan soo gal xisaabtaada Admin-ka.');
  }

  const lookupRes = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(
      firebaseConfig.apiKey
    )}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    }
  );

  if (!lookupRes.ok) {
    throw new Error('UNAUTHORIZED: Aqoonsiga Firebase ma saxna ama wuu dhacay.');
  }

  const lookupJson = await lookupRes.json();
  const user = lookupJson?.users?.[0];
  if (!user?.localId) {
    throw new Error('UNAUTHORIZED: Isticmaale lama helin.');
  }

  const email = (user.email || '').toLowerCase();
  if (email === BOOTSTRAPPED_ADMIN_EMAIL && user.emailVerified) {
    return { uid: user.localId, email };
  }

  const profileUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    firebaseConfig.projectId
  )}/databases/${encodeURIComponent(
    firebaseConfig.firestoreDatabaseId
  )}/documents/users/${encodeURIComponent(user.localId)}`;

  const profileRes = await fetch(profileUrl, {
    headers: { Authorization: `Bearer ${idToken}` },
  });

  if (!profileRes.ok) {
    throw new Error('FORBIDDEN: Xisaabtan ma laha awoodda Admin-ka.');
  }

  const profileDoc = await profileRes.json();
  if (profileDoc?.fields?.role?.stringValue !== 'admin') {
    throw new Error('FORBIDDEN: Kaliya Admin ayaa faylasha ku shubi kara.');
  }

  return { uid: user.localId, email };
}

export default async function handler(req) {
  const url = new URL(req.url);

  if (req.method === 'GET' && url.pathname.endsWith('/status')) {
    const token = normalizeSecretValue(process.env.GITHUB_TOKEN);
    const { owner, repo } = parseRepoSlug(process.env.GITHUB_HOST_REPO || DEFAULT_GITHUB_REPO);
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
      // Transient network error; allow upload attempt
    }

    return jsonResponse({
      configured: true,
      canWrite,
      tokenError,
      repo: repoSlug,
    });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405);
  }

  try {
    const token = normalizeSecretValue(process.env.GITHUB_TOKEN);
    if (!token) {
      return jsonResponse(
        {
          error: 'GITHUB_NOT_CONFIGURED',
          message:
            'GITHUB_TOKEN weli laguma darin Netlify Environment Variables. Ku dar GITHUB_TOKEN si faylasha toos loogu shubo GitHub.',
        },
        503
      );
    }

    const authHeader = req.headers.get('authorization') || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    await verifyFirebaseAdmin(idToken);

    const body = await req.json();
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

    const byteLength = Buffer.byteLength(contentBase64, 'base64');
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
        : process.env.GITHUB_HOST_REPO || DEFAULT_GITHUB_REPO;
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
