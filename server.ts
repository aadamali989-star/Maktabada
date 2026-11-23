import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import dotenv from 'dotenv';
import express, { type Request, type Response } from 'express';

dotenv.config();

interface FirebaseAppletConfig {
  projectId: string;
  apiKey: string;
  firestoreDatabaseId: string;
}

const DEFAULT_GITHUB_REPO = 'aadamali989-star/Maktabadda';
const DEFAULT_SUPABASE_BUCKET = 'maktabada';
const BOOTSTRAPPED_ADMIN_EMAIL = 'aadamali989@gmail.com';
const MAX_COVER_BYTES = 10 * 1024 * 1024;
const MAX_BOOK_BYTES = 25 * 1024 * 1024;
const MAX_SUPABASE_BOOK_BYTES = 50 * 1024 * 1024;

function loadFirebaseConfig(): FirebaseAppletConfig {
  const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
  const raw = fs.readFileSync(configPath, 'utf8');
  return JSON.parse(raw) as FirebaseAppletConfig;
}

const firebaseConfig = loadFirebaseConfig();

function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^_+/, '');
  return (cleaned || 'file').slice(0, 120);
}

function normalizeSecretValue(raw: string | undefined): string {
  let val = String(raw || '').trim();
  if (!val) return '';
  if (
    (val.startsWith('"') && val.endsWith('"')) ||
    (val.startsWith("'") && val.endsWith("'"))
  ) {
    val = val.slice(1, -1).trim();
  }
  val = val
    .replace(/^(?:GITHUB_TOKEN|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_URL|SUPABASE_BUCKET)\s*=\s*/i, '')
    .trim();
  if (/^Bearer\s+/i.test(val)) {
    val = val.replace(/^Bearer\s+/i, '').trim();
  }
  return val;
}

function normalizeSupabaseUrl(raw: string | undefined): string {
  const val = normalizeSecretValue(raw).replace(/\/+$/, '');
  if (!val) return '';
  try {
    const parsed = new URL(val);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return '';
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return '';
  }
}

function normalizeBucketName(raw: string | undefined): string {
  const cleaned = normalizeSecretValue(raw)
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || DEFAULT_SUPABASE_BUCKET;
}

function encodeStoragePath(objectPath: string): string {
  return objectPath
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function resolveSupabaseSignedUrl(baseUrl: string, rawSignedUrl: string): string {
  if (!rawSignedUrl) return '';
  if (/^https?:\/\//i.test(rawSignedUrl)) return rawSignedUrl;
  if (rawSignedUrl.startsWith('/storage/v1/')) return `${baseUrl}${rawSignedUrl}`;
  if (rawSignedUrl.startsWith('/')) return `${baseUrl}/storage/v1${rawSignedUrl}`;
  return `${baseUrl}/storage/v1/${rawSignedUrl}`;
}

async function ensurePublicSupabaseBucket(
  baseUrl: string,
  serviceKey: string,
  bucket: string
): Promise<{ ready: boolean; error: string }> {
  const getRes = await fetch(
    `${baseUrl}/storage/v1/bucket/${encodeURIComponent(bucket)}`,
    {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
    }
  );

  if (getRes.ok) {
    const bucketInfo = (await getRes.json().catch(() => ({}))) as { public?: boolean };
    if (bucketInfo && bucketInfo.public === false) {
      await fetch(`${baseUrl}/storage/v1/bucket/${encodeURIComponent(bucket)}`, {
        method: 'PUT',
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: bucket,
          name: bucket,
          public: true,
          file_size_limit: MAX_SUPABASE_BOOK_BYTES,
        }),
      });
    }
    return { ready: true, error: '' };
  }

  if (getRes.status === 401 || getRes.status === 403) {
    return {
      ready: false,
      error: `SUPABASE_SERVICE_ROLE_KEY waa khaldan yahay ama ma shaqaynayo (HTTP ${getRes.status}).`,
    };
  }

  if (getRes.status === 404 || getRes.status === 400) {
    const createRes = await fetch(`${baseUrl}/storage/v1/bucket`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        id: bucket,
        name: bucket,
        public: true,
        file_size_limit: MAX_SUPABASE_BOOK_BYTES,
      }),
    });

    if (createRes.ok || createRes.status === 409) {
      return { ready: true, error: '' };
    }

    const errText = await createRes.text();
    return {
      ready: false,
      error: `Lama samayn karin Supabase bucket "${bucket}" (HTTP ${createRes.status}): ${errText.slice(0, 160)}`,
    };
  }

  const errText = await getRes.text();
  return {
    ready: false,
    error: `Supabase Storage lama gaari karin (HTTP ${getRes.status}): ${errText.slice(0, 160)}`,
  };
}

function parseRepoSlug(raw: string): { owner: string; repo: string } {
  const cleaned = raw.trim().replace(/\/+$/, '').replace(/^https?:\/\/github\.com\//i, '');
  const parts = cleaned.split('/').filter(Boolean);
  if (parts.length < 2) {
    return { owner: 'aadamali989-star', repo: 'Maktabadda' };
  }
  return { owner: parts[0], repo: parts[1].replace(/\.git$/i, '') };
}

async function verifyFirebaseAdmin(idToken: string): Promise<{ uid: string; email: string }> {
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

  const lookupJson = (await lookupRes.json()) as {
    users?: Array<{ localId?: string; email?: string; emailVerified?: boolean }>;
  };
  const user = lookupJson.users?.[0];
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

  const profileDoc = (await profileRes.json()) as {
    fields?: { role?: { stringValue?: string } };
  };
  if (profileDoc.fields?.role?.stringValue !== 'admin') {
    throw new Error('FORBIDDEN: Kaliya Admin ayaa faylasha ku shubi kara.');
  }

  return { uid: user.localId, email };
}

async function commitFileToGitHub(params: {
  token: string;
  owner: string;
  repo: string;
  folder: 'covers' | 'books';
  fileName: string;
  contentBase64: string;
}): Promise<{ cdnUrl: string; rawUrl: string; path: string; branch: string }> {
  const { token, owner, repo, folder, fileName, contentBase64 } = params;

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
    throw new Error(
      `GITHUB_ERROR: Lama furi karin repo-ga ${owner}/${repo} (HTTP ${repoRes.status}): ${errBody.slice(0, 200)}`
    );
  }

  const repoJson = (await repoRes.json()) as { default_branch?: string; private?: boolean };
  const branch = repoJson.default_branch || 'main';
  const safeName = sanitizeFileName(fileName);
  const targetPath = `${folder}/${Date.now()}_${safeName}`;

  const encodedSegments = targetPath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
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
    throw new Error(
      `GITHUB_ERROR: GitHub upload waa la diiday (HTTP ${putRes.status}). Hubi in GITHUB_TOKEN uu leeyahay Contents: Read and write. ${errBody.slice(0, 200)}`
    );
  }

  const cdnUrl = `https://cdn.jsdelivr.net/gh/${encodeURIComponent(owner)}/${encodeURIComponent(
    repo
  )}@${encodeURIComponent(branch)}/${encodedSegments}`;
  const rawUrl = `https://raw.githubusercontent.com/${encodeURIComponent(
    owner
  )}/${encodeURIComponent(repo)}/${encodeURIComponent(branch)}/${encodedSegments}`;

  return { cdnUrl, rawUrl, path: targetPath, branch };
}

async function startServer() {
  const app = express();
  const httpServer = http.createServer(app);
  app.use(express.json({ limit: '40mb' }));

  let cachedTokenCheck: {
    key: string;
    canWrite: boolean;
    tokenError: string;
    checkedAt: number;
  } | null = null;

  let cachedSupabaseCheck: {
    key: string;
    ready: boolean;
    error: string;
    checkedAt: number;
  } | null = null;

  app.get('/api/supabase-storage/status', async (_req: Request, res: Response) => {
    const supabaseUrl = normalizeSupabaseUrl(process.env.SUPABASE_URL);
    const serviceKey = normalizeSecretValue(process.env.SUPABASE_SERVICE_ROLE_KEY);
    const bucket = normalizeBucketName(process.env.SUPABASE_BUCKET);

    if (!supabaseUrl || !serviceKey) {
      res.json({
        configured: false,
        ready: false,
        bucket,
        error: '',
      });
      return;
    }

    const cacheKey = `${supabaseUrl}:${bucket}:${serviceKey.length}`;
    if (
      cachedSupabaseCheck &&
      cachedSupabaseCheck.key === cacheKey &&
      Date.now() - cachedSupabaseCheck.checkedAt < 60000
    ) {
      res.json({
        configured: true,
        ready: cachedSupabaseCheck.ready,
        bucket,
        error: cachedSupabaseCheck.error,
      });
      return;
    }

    try {
      const check = await ensurePublicSupabaseBucket(supabaseUrl, serviceKey, bucket);
      cachedSupabaseCheck = {
        key: cacheKey,
        ready: check.ready,
        error: check.error,
        checkedAt: Date.now(),
      };
      res.json({
        configured: true,
        ready: check.ready,
        bucket,
        error: check.error,
      });
    } catch {
      res.json({
        configured: true,
        ready: false,
        bucket,
        error: 'Lama xiriiri karin Supabase Storage. Hubi SUPABASE_URL.',
      });
    }
  });

  app.post('/api/supabase-storage/signed-upload', async (req: Request, res: Response) => {
    try {
      const supabaseUrl = normalizeSupabaseUrl(process.env.SUPABASE_URL);
      const serviceKey = normalizeSecretValue(process.env.SUPABASE_SERVICE_ROLE_KEY);
      const bucket = normalizeBucketName(process.env.SUPABASE_BUCKET);

      if (!supabaseUrl || !serviceKey) {
        res.status(503).json({
          error: 'SUPABASE_NOT_CONFIGURED',
          message:
            'SUPABASE_URL iyo SUPABASE_SERVICE_ROLE_KEY weli laguma darin server-ka (Secrets / Env Vars).',
        });
        return;
      }

      const authHeader = req.headers.authorization || '';
      const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
      await verifyFirebaseAdmin(idToken);

      const body = (req.body || {}) as {
        folder?: unknown;
        fileName?: unknown;
        fileSize?: unknown;
      };

      const folder = body.folder === 'covers' ? 'covers' : body.folder === 'books' ? 'books' : null;
      if (!folder) {
        res.status(400).json({
          error: 'INVALID_FOLDER',
          message: 'Folder-ku waa inuu noqdaa covers ama books.',
        });
        return;
      }

      const fileName = typeof body.fileName === 'string' ? body.fileName.trim() : '';
      const fileSize = typeof body.fileSize === 'number' ? body.fileSize : 0;
      if (!fileName) {
        res.status(400).json({
          error: 'MISSING_FILE',
          message: 'Magaca faylka waa lagama maarmaan.',
        });
        return;
      }

      const maxAllowed = folder === 'covers' ? MAX_COVER_BYTES : MAX_SUPABASE_BOOK_BYTES;
      if (fileSize > maxAllowed) {
        res.status(413).json({
          error: 'FILE_TOO_LARGE',
          message: `Faylku wuu ka weyn yahay xadka (${Math.round(maxAllowed / (1024 * 1024))} MB).`,
        });
        return;
      }

      const bucketCheck = await ensurePublicSupabaseBucket(supabaseUrl, serviceKey, bucket);
      if (!bucketCheck.ready) {
        res.status(500).json({
          error: 'SUPABASE_BUCKET_ERROR',
          message: bucketCheck.error || 'Supabase bucket diyaar ma aha.',
        });
        return;
      }

      const safeName = sanitizeFileName(fileName);
      const objectPath = `${folder}/${Date.now()}_${safeName}`;
      const encodedPath = encodeStoragePath(objectPath);

      const signRes = await fetch(
        `${supabaseUrl}/storage/v1/object/upload/sign/${encodeURIComponent(bucket)}/${encodedPath}`,
        {
          method: 'POST',
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            'Content-Type': 'application/json',
            'x-upsert': 'true',
          },
          body: JSON.stringify({}),
        }
      );

      if (!signRes.ok) {
        const errBody = await signRes.text();
        res.status(500).json({
          error: 'SUPABASE_SIGN_ERROR',
          message: `Supabase signed upload waa la diiday (HTTP ${signRes.status}): ${errBody.slice(0, 200)}`,
        });
        return;
      }

      const signJson = (await signRes.json()) as { url?: string };
      const signedUrl = resolveSupabaseSignedUrl(supabaseUrl, signJson.url || '');
      if (!signedUrl) {
        res.status(500).json({
          error: 'SUPABASE_SIGN_ERROR',
          message: 'Supabase ma soo celin link-ga signed upload-ka.',
        });
        return;
      }

      const publicUrl = `${supabaseUrl}/storage/v1/object/public/${encodeURIComponent(
        bucket
      )}/${encodedPath}`;

      res.json({
        signedUrl,
        publicUrl,
        path: objectPath,
        bucket,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.startsWith('UNAUTHORIZED:')) {
        res.status(401).json({ error: 'UNAUTHORIZED', message: msg.replace('UNAUTHORIZED: ', '') });
        return;
      }
      if (msg.startsWith('FORBIDDEN:')) {
        res.status(403).json({ error: 'FORBIDDEN', message: msg.replace('FORBIDDEN: ', '') });
        return;
      }
      res.status(500).json({ error: 'UPLOAD_FAILED', message: msg });
    }
  });

  app.get('/api/github-host/status', async (_req: Request, res: Response) => {
    const token = normalizeSecretValue(process.env.GITHUB_TOKEN);
    const { owner, repo } = parseRepoSlug(process.env.GITHUB_HOST_REPO || DEFAULT_GITHUB_REPO);
    const repoSlug = `${owner}/${repo}`;

    if (!token) {
      res.json({
        configured: false,
        canWrite: false,
        tokenError: '',
        repo: repoSlug,
      });
      return;
    }

    const cacheKey = `${repoSlug}:${token.length}`;
    if (cachedTokenCheck && cachedTokenCheck.key === cacheKey && Date.now() - cachedTokenCheck.checkedAt < 60000) {
      res.json({
        configured: true,
        canWrite: cachedTokenCheck.canWrite,
        tokenError: cachedTokenCheck.tokenError,
        repo: repoSlug,
      });
      return;
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
        const repoData = (await repoRes.json()) as { permissions?: { push?: boolean } };
        if (repoData.permissions && repoData.permissions.push === false) {
          canWrite = false;
          tokenError = 'GITHUB_TOKEN ma laha awoodda Contents: Read and write.';
        }
      }
    } catch {
      // Transient network error; allow upload attempt
    }

    cachedTokenCheck = { key: cacheKey, canWrite, tokenError, checkedAt: Date.now() };
    res.json({
      configured: true,
      canWrite,
      tokenError,
      repo: repoSlug,
    });
  });

  app.post('/api/github-host/upload', async (req: Request, res: Response) => {
    try {
      const token = normalizeSecretValue(process.env.GITHUB_TOKEN);
      if (!token) {
        res.status(503).json({
          error: 'GITHUB_NOT_CONFIGURED',
          message:
            'GITHUB_TOKEN weli laguma darin server-ka (Secrets / Env Vars). Ku dar GITHUB_TOKEN si faylasha toos loogu shubo GitHub.',
        });
        return;
      }

      const authHeader = req.headers.authorization || '';
      const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
      await verifyFirebaseAdmin(idToken);

      const body = (req.body || {}) as {
        folder?: unknown;
        fileName?: unknown;
        contentBase64?: unknown;
        repo?: unknown;
      };

      const folder = body.folder === 'covers' ? 'covers' : body.folder === 'books' ? 'books' : null;
      if (!folder) {
        res.status(400).json({ error: 'INVALID_FOLDER', message: 'Folder-ku waa inuu noqdaa covers ama books.' });
        return;
      }

      const fileName = typeof body.fileName === 'string' ? body.fileName.trim() : '';
      const contentBase64 =
        typeof body.contentBase64 === 'string'
          ? body.contentBase64.replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '')
          : '';

      if (!fileName || !contentBase64) {
        res.status(400).json({ error: 'MISSING_FILE', message: 'Magaca faylka iyo xogtiisa waa lagama maarmaan.' });
        return;
      }

      const byteLength = Buffer.byteLength(contentBase64, 'base64');
      const maxAllowed = folder === 'covers' ? MAX_COVER_BYTES : MAX_BOOK_BYTES;
      if (byteLength > maxAllowed) {
        res.status(413).json({
          error: 'FILE_TOO_LARGE',
          message: `Faylku wuu ka weyn yahay xadka (${Math.round(maxAllowed / (1024 * 1024))} MB).`,
        });
        return;
      }

      const requestedRepo =
        typeof body.repo === 'string' && body.repo.trim()
          ? body.repo.trim()
          : process.env.GITHUB_HOST_REPO || DEFAULT_GITHUB_REPO;
      const { owner, repo } = parseRepoSlug(requestedRepo);

      const result = await commitFileToGitHub({
        token,
        owner,
        repo,
        folder,
        fileName,
        contentBase64,
      });

      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.startsWith('UNAUTHORIZED:')) {
        res.status(401).json({ error: 'UNAUTHORIZED', message: msg.replace('UNAUTHORIZED: ', '') });
        return;
      }
      if (msg.startsWith('FORBIDDEN:')) {
        res.status(403).json({ error: 'FORBIDDEN', message: msg.replace('FORBIDDEN: ', '') });
        return;
      }
      res.status(500).json({ error: 'UPLOAD_FAILED', message: msg.replace('GITHUB_ERROR: ', '') });
    }
  });

  const port = Number(process.env.PORT || 3000);

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const hmrDisabled = process.env.DISABLE_HMR === 'true';
    const vite = await createViteServer({
      server: {
        port,
        middlewareMode: true,
        ws: { server: httpServer },
        hmr: hmrDisabled ? false : { server: httpServer },
        watch: hmrDisabled ? null : undefined,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`maktabada.so server listening on http://0.0.0.0:${port}`);
  });
}

void startServer();
