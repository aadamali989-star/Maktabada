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

interface R2Credentials {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  publicUrl: string;
}

const DEFAULT_GITHUB_REPO = 'aadamali989-star/Maktabadda';
const BOOTSTRAPPED_ADMIN_EMAIL = 'aadamali989@gmail.com';
const MAX_COVER_BYTES = 10 * 1024 * 1024;
const MAX_BOOK_BYTES = 25 * 1024 * 1024;
const MAX_R2_PRESIGN_BOOK_BYTES = 100 * 1024 * 1024;
const MAX_R2_PROXY_BOOK_BYTES = 40 * 1024 * 1024;
const r2TextEncoder = new TextEncoder();

const ALLOWED_R2_CONTENT_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/avif',
  'image/gif',
  'application/pdf',
  'application/epub+zip',
  'text/plain',
  'text/markdown',
  'application/octet-stream',
]);

function loadFirebaseConfig(): FirebaseAppletConfig {
  const baseDir = import.meta.dirname ?? process.cwd();
  const candidates = [
    path.join(baseDir, 'firebase-applet-config.json'),
    path.join(process.cwd(), 'firebase-applet-config.json'),
  ];
  for (const configPath of candidates) {
    try {
      if (fs.existsSync(configPath)) {
        const raw = fs.readFileSync(configPath, 'utf8');
        return JSON.parse(raw) as FirebaseAppletConfig;
      }
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

function normalizeR2PublicUrl(raw: string | undefined): string {
  const trimmed = String(raw || '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return '';
    }
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

function readR2CredentialsFromEnv(env: Record<string, string | undefined>): R2Credentials | null {
  const accountId = String(env.R2_ACCOUNT_ID || '').trim();
  const accessKeyId = String(env.R2_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = String(env.R2_SECRET_ACCESS_KEY || '').trim();
  const bucketName = String(env.R2_BUCKET_NAME || '').trim();
  const publicUrl = normalizeR2PublicUrl(env.R2_PUBLIC_URL);

  if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
    return null;
  }
  if (!/^[a-z0-9_-]{8,64}$/i.test(accountId)) {
    return null;
  }
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/i.test(bucketName)) {
    return null;
  }
  return { accountId, accessKeyId, secretAccessKey, bucketName, publicUrl };
}

function sanitizeR2FileName(name: string): string {
  const cleaned = String(name || '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/^_+/, '');
  return (cleaned || 'file').slice(0, 120);
}

function sanitizeR2ContentType(rawType: string | undefined, fileName: string): string {
  const base = String(rawType || '').split(';')[0].trim().toLowerCase();
  if (base && ALLOWED_R2_CONTENT_TYPES.has(base)) {
    return base === 'image/jpg' ? 'image/jpeg' : base;
  }
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.epub')) return 'application/epub+zip';
  if (lower.endsWith('.txt') || lower.endsWith('.md')) return 'text/plain; charset=utf-8';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.avif')) return 'image/avif';
  if (lower.endsWith('.gif')) return 'image/gif';
  return 'application/octet-stream';
}

function buildR2ObjectKey(folder: 'covers' | 'books', fileName: string): string {
  const randBytes = new Uint8Array(4);
  globalThis.crypto.getRandomValues(randBytes);
  const randHex = Array.from(randBytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${folder}/${Date.now()}_${randHex}_${sanitizeR2FileName(fileName)}`;
}

function buildR2PublicAssetUrl(creds: R2Credentials, objectKey: string): string {
  const encodedKey = objectKey
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  if (creds.publicUrl) {
    return `${creds.publicUrl}/${encodedKey}`;
  }
  return `/api/r2-storage/file/${encodedKey}`;
}

function isValidR2ObjectKey(rawKey: string): boolean {
  if (!rawKey || rawKey.length > 300) return false;
  if (rawKey.startsWith('/') || rawKey.includes('\\') || rawKey.includes('..') || rawKey.includes('\0')) {
    return false;
  }
  return rawKey.startsWith('covers/') || rawKey.startsWith('books/');
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function toHex(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === 'string' ? r2TextEncoder.encode(data) : new Uint8Array(data);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return toHex(digest);
}

async function hmacSha256(key: Uint8Array | ArrayBuffer, data: string): Promise<ArrayBuffer> {
  const keyBytes = key instanceof Uint8Array ? new Uint8Array(key) : new Uint8Array(key);
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return globalThis.crypto.subtle.sign('HMAC', cryptoKey, r2TextEncoder.encode(data));
}

async function deriveSigningKey(
  secretAccessKey: string,
  dateStamp: string,
  region = 'auto',
  service = 's3'
): Promise<ArrayBuffer> {
  const kDate = await hmacSha256(r2TextEncoder.encode(`AWS4${secretAccessKey}`), dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  return hmacSha256(kService, 'aws4_request');
}

function formatAmzDate(date = new Date()): { amzDate: string; dateStamp: string } {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

async function createR2PresignedPutUrl(params: {
  creds: R2Credentials;
  objectKey: string;
  expiresSeconds?: number;
}): Promise<{ uploadUrl: string; publicUrl: string; objectKey: string }> {
  const { creds, objectKey, expiresSeconds = 300 } = params;
  const host = `${creds.accountId}.r2.cloudflarestorage.com`;
  const encodedKey = objectKey
    .split('/')
    .map((segment) => encodeRfc3986(segment))
    .join('/');
  const canonicalUri = `/${encodeRfc3986(creds.bucketName)}/${encodedKey}`;
  const { amzDate, dateStamp } = formatAmzDate();
  const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
  const credential = `${creds.accessKeyId}/${credentialScope}`;

  const queryEntries: Array<[string, string]> = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', credential],
    ['X-Amz-Date', amzDate],
    ['X-Amz-Expires', String(expiresSeconds)],
    ['X-Amz-SignedHeaders', 'host'],
  ];
  queryEntries.sort((a, b) => a[0].localeCompare(b[0]));

  const canonicalQueryString = queryEntries
    .map(([k, v]) => `${encodeRfc3986(k)}=${encodeRfc3986(v)}`)
    .join('&');

  const canonicalRequest = [
    'PUT',
    canonicalUri,
    canonicalQueryString,
    `host:${host}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join('\n');

  const signingKey = await deriveSigningKey(creds.secretAccessKey, dateStamp);
  const signature = toHex(await hmacSha256(signingKey, stringToSign));

  return {
    uploadUrl: `https://${host}${canonicalUri}?${canonicalQueryString}&X-Amz-Signature=${signature}`,
    publicUrl: buildR2PublicAssetUrl(creds, objectKey),
    objectKey,
  };
}

async function putObjectToR2S3(params: {
  creds: R2Credentials;
  objectKey: string;
  body: Uint8Array;
  contentType: string;
}): Promise<{ publicUrl: string; objectKey: string }> {
  const { creds, objectKey, body, contentType } = params;
  const host = `${creds.accountId}.r2.cloudflarestorage.com`;
  const encodedKey = objectKey
    .split('/')
    .map((segment) => encodeRfc3986(segment))
    .join('/');
  const canonicalUri = `/${encodeRfc3986(creds.bucketName)}/${encodedKey}`;

  const { amzDate, dateStamp } = formatAmzDate();
  const payloadHash = await sha256Hex(body);
  const credentialScope = `${dateStamp}/auto/s3/aws4_request`;

  const canonicalHeaders =
    `content-type:${contentType}\n` +
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';

  const canonicalRequest = [
    'PUT',
    canonicalUri,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join('\n');

  const signingKey = await deriveSigningKey(creds.secretAccessKey, dateStamp);
  const signature = toHex(await hmacSha256(signingKey, stringToSign));
  const authorization = `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const putRes = await fetch(`https://${host}${canonicalUri}`, {
    method: 'PUT',
    headers: {
      'Content-Type': contentType,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      Authorization: authorization,
    },
    body: new Uint8Array(body),
  });

  if (!putRes.ok) {
    const errText = await putRes.text();
    throw new Error(`R2_ERROR: Cloudflare R2 upload waa la diiday (HTTP ${putRes.status}): ${errText.slice(0, 200)}`);
  }

  return {
    publicUrl: buildR2PublicAssetUrl(creds, objectKey),
    objectKey,
  };
}

async function getObjectFromR2S3(params: {
  creds: R2Credentials;
  objectKey: string;
  range?: string;
}): Promise<globalThis.Response> {
  const { creds, objectKey, range } = params;
  const host = `${creds.accountId}.r2.cloudflarestorage.com`;
  const encodedKey = objectKey
    .split('/')
    .map((segment) => encodeRfc3986(segment))
    .join('/');
  const canonicalUri = `/${encodeRfc3986(creds.bucketName)}/${encodedKey}`;

  const { amzDate, dateStamp } = formatAmzDate();
  const payloadHash = await sha256Hex('');
  const credentialScope = `${dateStamp}/auto/s3/aws4_request`;

  const canonicalHeaders =
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';

  const canonicalRequest = [
    'GET',
    canonicalUri,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join('\n');

  const signingKey = await deriveSigningKey(creds.secretAccessKey, dateStamp);
  const signature = toHex(await hmacSha256(signingKey, stringToSign));
  const authorization = `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const headers: Record<string, string> = {
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    Authorization: authorization,
  };
  if (range) {
    headers.Range = range;
  }

  return fetch(`https://${host}${canonicalUri}`, {
    method: 'GET',
    headers,
  });
}

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
    .replace(/^GITHUB_TOKEN\s*=\s*/i, '')
    .trim();
  if (/^Bearer\s+/i.test(val)) {
    val = val.replace(/^Bearer\s+/i, '').trim();
  }
  return val;
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

  app.get('/api/r2-storage/status', (_req: Request, res: Response) => {
    const creds = readR2CredentialsFromEnv(process.env);
    if (!creds) {
      res.json({
        configured: false,
        mode: 'none',
        bucket: '',
        hasPublicUrl: false,
        publicUrl: '',
        canPresign: false,
        maxDirectMb: 100,
      });
      return;
    }

    res.json({
      configured: true,
      mode: 's3',
      bucket: creds.bucketName,
      hasPublicUrl: Boolean(creds.publicUrl),
      publicUrl: creds.publicUrl,
      canPresign: true,
      maxDirectMb: 100,
    });
  });

  app.post(
    '/api/r2-storage/upload',
    express.raw({ type: '*/*', limit: '42mb' }),
    async (req: Request, res: Response) => {
      try {
        const creds = readR2CredentialsFromEnv(process.env);
        if (!creds) {
          res.status(503).json({
            error: 'R2_NOT_CONFIGURED',
            message:
              'Cloudflare R2 weli laguma darin server-ka (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME).',
          });
          return;
        }

        const authHeader = req.headers.authorization || '';
        const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
        await verifyFirebaseAdmin(idToken);

        const rawFolder = req.headers['x-folder'];
        const folder = rawFolder === 'covers' ? 'covers' : rawFolder === 'books' ? 'books' : null;
        if (!folder) {
          res.status(400).json({ error: 'INVALID_FOLDER', message: 'Folder-ku waa inuu noqdaa covers ama books.' });
          return;
        }

        const rawFileNameHeader = req.headers['x-file-name'];
        let fileName = 'file';
        if (typeof rawFileNameHeader === 'string' && rawFileNameHeader.trim()) {
          try {
            fileName = decodeURIComponent(rawFileNameHeader.trim());
          } catch {
            fileName = rawFileNameHeader.trim();
          }
        }

        const bodyBuf = Buffer.isBuffer(req.body)
          ? req.body
          : Buffer.from(typeof req.body === 'string' ? req.body : '');
        if (!bodyBuf || bodyBuf.length === 0) {
          res.status(400).json({ error: 'MISSING_FILE', message: 'Fayl madhan lama soo gelin karo.' });
          return;
        }

        const maxAllowed = folder === 'covers' ? MAX_COVER_BYTES : MAX_R2_PROXY_BOOK_BYTES;
        if (bodyBuf.length > maxAllowed) {
          res.status(413).json({
            error: 'FILE_TOO_LARGE',
            message: `Faylku wuu ka weyn yahay xadka (${Math.round(maxAllowed / (1024 * 1024))} MB).`,
          });
          return;
        }

        const contentType = sanitizeR2ContentType(req.headers['content-type'], fileName);
        const objectKey = buildR2ObjectKey(folder, fileName);
        const result = await putObjectToR2S3({
          creds,
          objectKey,
          body: new Uint8Array(bodyBuf),
          contentType,
        });

        res.json({
          publicUrl: result.publicUrl,
          objectKey: result.objectKey,
          bucket: creds.bucketName,
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
        res.status(500).json({ error: 'R2_UPLOAD_FAILED', message: msg.replace('R2_ERROR: ', '') });
      }
    }
  );

  app.get('/api/r2-storage/file/*', async (req: Request, res: Response) => {
    try {
      const creds = readR2CredentialsFromEnv(process.env);
      if (!creds) {
        res.status(404).send('R2 storage not configured');
        return;
      }

      const rawKey = decodeURIComponent(req.path.replace(/^\/api\/r2-storage\/file\//, ''));
      if (!isValidR2ObjectKey(rawKey)) {
        res.status(400).send('Invalid file key');
        return;
      }

      const inlineProxy = req.query.inline === '1';
      if (creds.publicUrl && !inlineProxy) {
        res.redirect(302, buildR2PublicAssetUrl(creds, rawKey));
        return;
      }

      const rangeHeader = typeof req.headers.range === 'string' ? req.headers.range : undefined;
      const r2Res = await getObjectFromR2S3({ creds, objectKey: rawKey, range: rangeHeader });
      if (!r2Res.ok) {
        res.status(r2Res.status === 404 ? 404 : 502).send('File not found');
        return;
      }

      const contentType = r2Res.headers.get('content-type') || 'application/octet-stream';
      const contentRange = r2Res.headers.get('content-range');
      const acceptRanges = r2Res.headers.get('accept-ranges') || 'bytes';
      const arrayBuf = await r2Res.arrayBuffer();
      res.status(r2Res.status === 206 ? 206 : 200);
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', String(arrayBuf.byteLength));
      if (contentRange) {
        res.setHeader('Content-Range', contentRange);
      }
      res.setHeader('Accept-Ranges', acceptRanges);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('Content-Disposition', 'inline');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.send(Buffer.from(arrayBuf));
    } catch {
      res.status(500).send('Failed to fetch object from R2');
    }
  });

  app.use(express.json({ limit: '40mb' }));

  app.post('/api/r2-storage/presign', async (req: Request, res: Response) => {
    try {
      const creds = readR2CredentialsFromEnv(process.env);
      if (!creds) {
        res.status(503).json({
          error: 'R2_NOT_CONFIGURED',
          message: 'Cloudflare R2 weli laguma darin server-ka.',
        });
        return;
      }

      const authHeader = req.headers.authorization || '';
      const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
      await verifyFirebaseAdmin(idToken);

      const body = (req.body || {}) as {
        folder?: unknown;
        fileName?: unknown;
        contentType?: unknown;
        fileSize?: unknown;
      };

      const folder = body.folder === 'covers' ? 'covers' : body.folder === 'books' ? 'books' : null;
      if (!folder) {
        res.status(400).json({ error: 'INVALID_FOLDER', message: 'Folder-ku waa inuu noqdaa covers ama books.' });
        return;
      }

      const fileName = typeof body.fileName === 'string' ? body.fileName.trim() : '';
      if (!fileName) {
        res.status(400).json({ error: 'MISSING_FILE_NAME', message: 'Magaca faylka waa lagama maarmaan.' });
        return;
      }

      const fileSize = typeof body.fileSize === 'number' ? body.fileSize : 0;
      const maxAllowed = folder === 'covers' ? MAX_COVER_BYTES : MAX_R2_PRESIGN_BOOK_BYTES;
      if (fileSize > maxAllowed) {
        res.status(413).json({
          error: 'FILE_TOO_LARGE',
          message: `Faylku wuu ka weyn yahay xadka (${Math.round(maxAllowed / (1024 * 1024))} MB).`,
        });
        return;
      }

      const contentType = sanitizeR2ContentType(
        typeof body.contentType === 'string' ? body.contentType : undefined,
        fileName
      );
      const objectKey = buildR2ObjectKey(folder, fileName);
      const presigned = await createR2PresignedPutUrl({ creds, objectKey });

      res.json({
        uploadUrl: presigned.uploadUrl,
        publicUrl: presigned.publicUrl,
        objectKey: presigned.objectKey,
        contentType,
        bucket: creds.bucketName,
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
      res.status(500).json({ error: 'PRESIGN_FAILED', message: msg });
    }
  });

  let cachedTokenCheck: {
    key: string;
    canWrite: boolean;
    tokenError: string;
    checkedAt: number;
  } | null = null;

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
    const baseDir = import.meta.dirname ?? process.cwd();
    const candidateDist = path.join(baseDir, 'dist');
    const distDir = fs.existsSync(candidateDist) ? candidateDist : path.join(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`maktabada.so server listening on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start maktabada.so server:', err);
  process.exit(1);
});
