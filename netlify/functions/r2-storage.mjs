import fs from 'node:fs';
import path from 'node:path';

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
const encoder = new TextEncoder();
const BOOTSTRAPPED_ADMIN_EMAIL = 'aadamali989@gmail.com';
const MAX_COVER_BYTES = 10 * 1024 * 1024;
const MAX_R2_PRESIGN_BOOK_BYTES = 100 * 1024 * 1024;
const MAX_R2_PROXY_BOOK_BYTES = 5 * 1024 * 1024;

const ALLOWED_CONTENT_TYPES = new Set([
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

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

function getFirebaseRuntimeConfig(env = process.env) {
  return {
    projectId: String(env.FIREBASE_PROJECT_ID || firebaseConfig.projectId || '').trim(),
    apiKey: String(env.FIREBASE_API_KEY || firebaseConfig.apiKey || '').trim(),
    firestoreDatabaseId: String(
      env.FIREBASE_DATABASE_ID || firebaseConfig.firestoreDatabaseId || '(default)'
    ).trim(),
  };
}

async function verifyFirebaseAdmin(idToken) {
  if (!idToken) {
    throw new Error('UNAUTHORIZED: Fadlan soo gal xisaabtaada Admin-ka.');
  }

  const fb = getFirebaseRuntimeConfig();
  if (!fb.apiKey || !fb.projectId) {
    throw new Error('UNAUTHORIZED: Aqoonsiga mashruuca Firebase lama helin.');
  }

  const lookupRes = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(fb.apiKey)}`,
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
    fb.projectId
  )}/databases/${encodeURIComponent(fb.firestoreDatabaseId)}/documents/users/${encodeURIComponent(
    user.localId
  )}`;

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

function normalizeR2PublicUrl(raw) {
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

function readR2CredentialsFromEnv(env = process.env) {
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

  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucketName,
    publicUrl,
  };
}

function sanitizeR2FileName(name) {
  const cleaned = String(name || '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/^_+/, '');
  return (cleaned || 'file').slice(0, 120);
}

function sanitizeR2ContentType(rawType, fileName) {
  const base = String(rawType || '').split(';')[0].trim().toLowerCase();
  if (base && ALLOWED_CONTENT_TYPES.has(base)) {
    return base === 'image/jpg' ? 'image/jpeg' : base;
  }
  const lower = String(fileName || '').toLowerCase();
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

function buildR2ObjectKey(folder, fileName) {
  const randBytes = new Uint8Array(4);
  globalThis.crypto.getRandomValues(randBytes);
  const randHex = Array.from(randBytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${folder}/${Date.now()}_${randHex}_${sanitizeR2FileName(fileName)}`;
}

function buildR2PublicAssetUrl(publicUrl, objectKey) {
  const encodedKey = objectKey
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  const cleanBase = normalizeR2PublicUrl(publicUrl);
  if (cleanBase) {
    return `${cleanBase}/${encodedKey}`;
  }
  return `/api/r2-storage/file/${encodedKey}`;
}

function isValidR2ObjectKey(rawKey) {
  if (!rawKey || rawKey.length > 300) return false;
  if (rawKey.startsWith('/') || rawKey.includes('\\') || rawKey.includes('..') || rawKey.includes('\0')) {
    return false;
  }
  return rawKey.startsWith('covers/') || rawKey.startsWith('books/');
}

function encodeRfc3986(value) {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function toHex(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(data) {
  const bytes = typeof data === 'string' ? encoder.encode(data) : new Uint8Array(data);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return toHex(digest);
}

async function hmacSha256(key, data) {
  const keyBytes = key instanceof Uint8Array ? new Uint8Array(key) : new Uint8Array(key);
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return globalThis.crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data));
}

async function deriveSigningKey(secretAccessKey, dateStamp, region = 'auto', service = 's3') {
  const kDate = await hmacSha256(encoder.encode(`AWS4${secretAccessKey}`), dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  return hmacSha256(kService, 'aws4_request');
}

function formatAmzDate(date = new Date()) {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return {
    amzDate: iso,
    dateStamp: iso.slice(0, 8),
  };
}

async function createR2PresignedPutUrl({ creds, objectKey, expiresSeconds = 300 }) {
  const host = `${creds.accountId}.r2.cloudflarestorage.com`;
  const encodedKey = objectKey
    .split('/')
    .map((segment) => encodeRfc3986(segment))
    .join('/');
  const canonicalUri = `/${encodeRfc3986(creds.bucketName)}/${encodedKey}`;

  const { amzDate, dateStamp } = formatAmzDate();
  const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
  const credential = `${creds.accessKeyId}/${credentialScope}`;

  const queryEntries = [
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
    publicUrl: buildR2PublicAssetUrl(creds.publicUrl, objectKey),
    objectKey,
  };
}

async function putObjectToR2S3({ creds, objectKey, body, contentType }) {
  const host = `${creds.accountId}.r2.cloudflarestorage.com`;
  const encodedKey = objectKey
    .split('/')
    .map((segment) => encodeRfc3986(segment))
    .join('/');
  const canonicalUri = `/${encodeRfc3986(creds.bucketName)}/${encodedKey}`;

  const bytes = body instanceof Uint8Array ? body : new Uint8Array(body);
  const { amzDate, dateStamp } = formatAmzDate();
  const payloadHash = await sha256Hex(bytes);
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
    body: bytes,
  });

  if (!putRes.ok) {
    const errText = await putRes.text();
    throw new Error(`R2_ERROR: Cloudflare R2 upload waa la diiday (HTTP ${putRes.status}): ${errText.slice(0, 200)}`);
  }

  return {
    publicUrl: buildR2PublicAssetUrl(creds.publicUrl, objectKey),
    objectKey,
  };
}

async function getObjectFromR2S3({ creds, objectKey }) {
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

  return fetch(`https://${host}${canonicalUri}`, {
    method: 'GET',
    headers: {
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      Authorization: authorization,
    },
  });
}

export default async function handler(req) {
  const url = new URL(req.url);
  const subPath = url.pathname.replace(/^\/api\/r2-storage\/?/, '');
  const creds = readR2CredentialsFromEnv(process.env);

  if (req.method === 'GET' && subPath === 'status') {
    if (!creds) {
      return jsonResponse({
        configured: false,
        mode: 'none',
        bucket: '',
        hasPublicUrl: false,
        canPresign: false,
        maxDirectMb: 100,
      });
    }

    return jsonResponse({
      configured: true,
      mode: 's3',
      bucket: creds.bucketName,
      hasPublicUrl: Boolean(creds.publicUrl),
      canPresign: true,
      maxDirectMb: 100,
    });
  }

  if (req.method === 'GET' && subPath.startsWith('file/')) {
    if (!creds) {
      return new Response('R2 storage not configured', { status: 404 });
    }
    const rawKey = decodeURIComponent(subPath.slice('file/'.length));
    if (!isValidR2ObjectKey(rawKey)) {
      return new Response('Invalid file key', { status: 400 });
    }
    if (creds.publicUrl) {
      return Response.redirect(buildR2PublicAssetUrl(creds.publicUrl, rawKey), 302);
    }
    const r2Res = await getObjectFromR2S3({ creds, objectKey: rawKey });
    if (!r2Res.ok) {
      return new Response('File not found', { status: r2Res.status === 404 ? 404 : 502 });
    }
    const headers = new Headers();
    headers.set('Content-Type', r2Res.headers.get('content-type') || 'application/octet-stream');
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    headers.set('Content-Disposition', 'inline');
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('X-Content-Type-Options', 'nosniff');
    return new Response(r2Res.body, { headers });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405);
  }

  try {
    if (!creds) {
      return jsonResponse(
        {
          error: 'R2_NOT_CONFIGURED',
          message:
            'Cloudflare R2 weli laguma darin Netlify Environment Variables (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME).',
        },
        503
      );
    }

    const authHeader = req.headers.get('authorization') || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    await verifyFirebaseAdmin(idToken);

    if (subPath === 'presign') {
      const body = await req.json();
      const folder = body?.folder === 'covers' ? 'covers' : body?.folder === 'books' ? 'books' : null;
      if (!folder) {
        return jsonResponse(
          { error: 'INVALID_FOLDER', message: 'Folder-ku waa inuu noqdaa covers ama books.' },
          400
        );
      }

      const fileName = typeof body?.fileName === 'string' ? body.fileName.trim() : '';
      if (!fileName) {
        return jsonResponse(
          { error: 'MISSING_FILE_NAME', message: 'Magaca faylka waa lagama maarmaan.' },
          400
        );
      }

      const fileSize = typeof body?.fileSize === 'number' ? body.fileSize : 0;
      const maxAllowed = folder === 'covers' ? MAX_COVER_BYTES : MAX_R2_PRESIGN_BOOK_BYTES;
      if (fileSize > maxAllowed) {
        return jsonResponse(
          {
            error: 'FILE_TOO_LARGE',
            message: `Faylku wuu ka weyn yahay xadka (${Math.round(maxAllowed / (1024 * 1024))} MB).`,
          },
          413
        );
      }

      const contentType = sanitizeR2ContentType(
        typeof body?.contentType === 'string' ? body.contentType : undefined,
        fileName
      );
      const objectKey = buildR2ObjectKey(folder, fileName);
      const presigned = await createR2PresignedPutUrl({ creds, objectKey });

      return jsonResponse({
        uploadUrl: presigned.uploadUrl,
        publicUrl: presigned.publicUrl,
        objectKey: presigned.objectKey,
        contentType,
        bucket: creds.bucketName,
      });
    }

    if (subPath === 'upload') {
      const rawFolder = req.headers.get('x-folder');
      const folder = rawFolder === 'covers' ? 'covers' : rawFolder === 'books' ? 'books' : null;
      if (!folder) {
        return jsonResponse(
          { error: 'INVALID_FOLDER', message: 'Folder-ku waa inuu noqdaa covers ama books.' },
          400
        );
      }

      const rawFileNameHeader = req.headers.get('x-file-name');
      let fileName = 'file';
      if (rawFileNameHeader && rawFileNameHeader.trim()) {
        try {
          fileName = decodeURIComponent(rawFileNameHeader.trim());
        } catch {
          fileName = rawFileNameHeader.trim();
        }
      }

      const arrayBuf = await req.arrayBuffer();
      if (!arrayBuf || arrayBuf.byteLength === 0) {
        return jsonResponse({ error: 'MISSING_FILE', message: 'Fayl madhan lama soo gelin karo.' }, 400);
      }

      const maxAllowed = folder === 'covers' ? MAX_COVER_BYTES : MAX_R2_PROXY_BOOK_BYTES;
      if (arrayBuf.byteLength > maxAllowed) {
        return jsonResponse(
          {
            error: 'FILE_TOO_LARGE',
            message: `Faylku wuu ka weyn yahay xadka proxy-ga (${Math.round(maxAllowed / (1024 * 1024))} MB). Ku dar CORS bucket-ka R2 si presigned upload toos u shaqeeyo.`,
          },
          413
        );
      }

      const contentType = sanitizeR2ContentType(req.headers.get('content-type'), fileName);
      const objectKey = buildR2ObjectKey(folder, fileName);
      const result = await putObjectToR2S3({
        creds,
        objectKey,
        body: new Uint8Array(arrayBuf),
        contentType,
      });

      return jsonResponse({
        publicUrl: result.publicUrl,
        objectKey: result.objectKey,
        bucket: creds.bucketName,
      });
    }

    return jsonResponse({ error: 'NOT_FOUND' }, 404);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith('UNAUTHORIZED:')) {
      return jsonResponse({ error: 'UNAUTHORIZED', message: msg.replace('UNAUTHORIZED: ', '') }, 401);
    }
    if (msg.startsWith('FORBIDDEN:')) {
      return jsonResponse({ error: 'FORBIDDEN', message: msg.replace('FORBIDDEN: ', '') }, 403);
    }
    return jsonResponse({ error: 'R2_UPLOAD_FAILED', message: msg.replace('R2_ERROR: ', '') }, 500);
  }
}
