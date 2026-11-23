import firebaseConfig from '../../firebase-applet-config.json' with { type: 'json' };

const BOOTSTRAPPED_ADMIN_EMAIL = 'aadamali989@gmail.com';
const DEFAULT_SUPABASE_BUCKET = 'maktabada';
const MAX_COVER_BYTES = 10 * 1024 * 1024;
const MAX_BOOK_BYTES = 50 * 1024 * 1024;

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
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
  val = val.replace(/^(?:SUPABASE_SERVICE_ROLE_KEY|SUPABASE_URL|SUPABASE_BUCKET)\s*=\s*/i, '').trim();
  if (/^Bearer\s+/i.test(val)) {
    val = val.replace(/^Bearer\s+/i, '').trim();
  }
  return val;
}

function normalizeSupabaseUrl(raw) {
  let val = normalizeSecretValue(raw).replace(/\/+$/, '');
  if (!val) return '';
  try {
    const parsed = new URL(val);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return '';
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return '';
  }
}

function normalizeBucketName(raw) {
  const cleaned = normalizeSecretValue(raw)
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || DEFAULT_SUPABASE_BUCKET;
}

function sanitizeFileName(name) {
  const cleaned = String(name || '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/^_+/, '');
  return (cleaned || 'file').slice(0, 120);
}

function encodeStoragePath(objectPath) {
  return objectPath
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function resolveSupabaseSignedUrl(baseUrl, rawSignedUrl) {
  if (!rawSignedUrl) return '';
  if (/^https?:\/\//i.test(rawSignedUrl)) return rawSignedUrl;
  if (rawSignedUrl.startsWith('/storage/v1/')) return `${baseUrl}${rawSignedUrl}`;
  if (rawSignedUrl.startsWith('/')) return `${baseUrl}/storage/v1${rawSignedUrl}`;
  return `${baseUrl}/storage/v1/${rawSignedUrl}`;
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

async function ensurePublicSupabaseBucket(baseUrl, serviceKey, bucket) {
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
    const bucketInfo = await getRes.json().catch(() => ({}));
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
          file_size_limit: MAX_BOOK_BYTES,
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
        file_size_limit: MAX_BOOK_BYTES,
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

export default async function handler(req) {
  const url = new URL(req.url);
  const supabaseUrl = normalizeSupabaseUrl(process.env.SUPABASE_URL);
  const serviceKey = normalizeSecretValue(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const bucket = normalizeBucketName(process.env.SUPABASE_BUCKET);

  if (req.method === 'GET' && url.pathname.endsWith('/status')) {
    if (!supabaseUrl || !serviceKey) {
      return jsonResponse({
        configured: false,
        ready: false,
        bucket,
        error: '',
      });
    }

    try {
      const check = await ensurePublicSupabaseBucket(supabaseUrl, serviceKey, bucket);
      return jsonResponse({
        configured: true,
        ready: check.ready,
        bucket,
        error: check.error,
      });
    } catch {
      return jsonResponse({
        configured: true,
        ready: false,
        bucket,
        error: 'Lama xiriiri karin Supabase Storage. Hubi SUPABASE_URL.',
      });
    }
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405);
  }

  try {
    if (!supabaseUrl || !serviceKey) {
      return jsonResponse(
        {
          error: 'SUPABASE_NOT_CONFIGURED',
          message:
            'SUPABASE_URL iyo SUPABASE_SERVICE_ROLE_KEY weli laguma darin Netlify Environment Variables.',
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
    const fileSize = typeof body?.fileSize === 'number' ? body.fileSize : 0;

    if (!fileName) {
      return jsonResponse(
        { error: 'MISSING_FILE', message: 'Magaca faylka waa lagama maarmaan.' },
        400
      );
    }

    const maxAllowed = folder === 'covers' ? MAX_COVER_BYTES : MAX_BOOK_BYTES;
    if (fileSize > maxAllowed) {
      return jsonResponse(
        {
          error: 'FILE_TOO_LARGE',
          message: `Faylku wuu ka weyn yahay xadka (${Math.round(maxAllowed / (1024 * 1024))} MB).`,
        },
        413
      );
    }

    const bucketCheck = await ensurePublicSupabaseBucket(supabaseUrl, serviceKey, bucket);
    if (!bucketCheck.ready) {
      return jsonResponse(
        {
          error: 'SUPABASE_BUCKET_ERROR',
          message: bucketCheck.error || 'Supabase bucket diyaar ma aha.',
        },
        500
      );
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
      return jsonResponse(
        {
          error: 'SUPABASE_SIGN_ERROR',
          message: `Supabase signed upload waa la diiday (HTTP ${signRes.status}): ${errBody.slice(0, 200)}`,
        },
        500
      );
    }

    const signJson = await signRes.json();
    const signedUrl = resolveSupabaseSignedUrl(supabaseUrl, signJson?.url || '');
    if (!signedUrl) {
      return jsonResponse(
        {
          error: 'SUPABASE_SIGN_ERROR',
          message: 'Supabase ma soo celin link-ga signed upload-ka.',
        },
        500
      );
    }

    const publicUrl = `${supabaseUrl}/storage/v1/object/public/${encodeURIComponent(
      bucket
    )}/${encodedPath}`;

    return jsonResponse({
      signedUrl,
      publicUrl,
      path: objectPath,
      bucket,
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
