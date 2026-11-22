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
const BOOTSTRAPPED_ADMIN_EMAIL = 'aadamali989@gmail.com';
const MAX_COVER_BYTES = 10 * 1024 * 1024;
const MAX_BOOK_BYTES = 25 * 1024 * 1024;

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

  app.get('/api/github-host/status', (_req: Request, res: Response) => {
    const token = (process.env.GITHUB_TOKEN || '').trim();
    const { owner, repo } = parseRepoSlug(process.env.GITHUB_HOST_REPO || DEFAULT_GITHUB_REPO);
    res.json({
      configured: Boolean(token),
      repo: `${owner}/${repo}`,
    });
  });

  app.post('/api/github-host/upload', async (req: Request, res: Response) => {
    try {
      const token = (process.env.GITHUB_TOKEN || '').trim();
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
