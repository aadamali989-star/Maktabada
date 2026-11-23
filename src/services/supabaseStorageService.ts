export interface SupabaseStorageStatus {
  configured: boolean;
  ready: boolean;
  bucket: string;
  error: string;
  reachable: boolean;
}

export interface SupabaseSignedUploadResult {
  publicUrl: string;
  path: string;
  bucket: string;
}

export type SupabaseStorageErrorCode =
  | 'SUPABASE_NOT_CONFIGURED'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'FILE_TOO_LARGE'
  | 'SERVER_UNAVAILABLE'
  | 'UPLOAD_FAILED';

export class SupabaseStorageUploadError extends Error {
  code: SupabaseStorageErrorCode;
  status: number;

  constructor(code: SupabaseStorageErrorCode, status: number, message: string) {
    super(message);
    this.name = 'SupabaseStorageUploadError';
    this.code = code;
    this.status = status;
  }
}

let cachedStatus: { value: SupabaseStorageStatus; fetchedAt: number } | null = null;

export async function fetchSupabaseStorageStatus(
  forceRefresh = false
): Promise<SupabaseStorageStatus> {
  if (!forceRefresh && cachedStatus && Date.now() - cachedStatus.fetchedAt < 30000) {
    return cachedStatus.value;
  }

  const fallback: SupabaseStorageStatus = {
    configured: false,
    ready: false,
    bucket: 'maktabada',
    error: '',
    reachable: false,
  };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch('/api/supabase-storage/status', {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      const contentType = res.headers.get('content-type') || '';
      if (!res.ok || !contentType.includes('application/json')) {
        return fallback;
      }
      const data = (await res.json()) as {
        configured?: unknown;
        ready?: unknown;
        bucket?: unknown;
        error?: unknown;
      };
      const value: SupabaseStorageStatus = {
        configured: Boolean(data.configured),
        ready: Boolean(data.ready),
        bucket:
          typeof data.bucket === 'string' && data.bucket.trim()
            ? data.bucket.trim()
            : 'maktabada',
        error: typeof data.error === 'string' ? data.error : '',
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

async function requestSignedUploadUrl(params: {
  folder: 'covers' | 'books';
  file: File;
  idToken: string;
}): Promise<{ signedUrl: string; publicUrl: string; path: string; bucket: string }> {
  const res = await fetch('/api/supabase-storage/signed-upload', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.idToken}`,
    },
    body: JSON.stringify({
      folder: params.folder,
      fileName: params.file.name,
      fileSize: params.file.size,
      contentType: params.file.type || 'application/octet-stream',
    }),
  });

  const contentType = res.headers.get('content-type') || '';
  let parsed: Record<string, unknown> | null = null;
  if (contentType.includes('application/json')) {
    try {
      parsed = (await res.json()) as Record<string, unknown>;
    } catch {
      parsed = null;
    }
  }

  if (
    res.ok &&
    parsed &&
    typeof parsed.signedUrl === 'string' &&
    typeof parsed.publicUrl === 'string'
  ) {
    return {
      signedUrl: parsed.signedUrl,
      publicUrl: parsed.publicUrl,
      path: typeof parsed.path === 'string' ? parsed.path : '',
      bucket: typeof parsed.bucket === 'string' ? parsed.bucket : 'maktabada',
    };
  }

  const apiError = typeof parsed?.error === 'string' ? parsed.error : '';
  const apiMsg = typeof parsed?.message === 'string' ? parsed.message : '';

  if (res.status === 404 || !parsed) {
    throw new SupabaseStorageUploadError(
      'SERVER_UNAVAILABLE',
      res.status,
      'Adeegga Supabase Storage lama helin (404). Hubi in server-ka / Netlify Functions uu shaqaynayo.'
    );
  }
  if (res.status === 503 || apiError === 'SUPABASE_NOT_CONFIGURED') {
    throw new SupabaseStorageUploadError(
      'SUPABASE_NOT_CONFIGURED',
      res.status,
      apiMsg || 'SUPABASE_URL iyo SUPABASE_SERVICE_ROLE_KEY weli lama gelin Secrets / Netlify Env Vars.'
    );
  }
  if (res.status === 401 || apiError === 'UNAUTHORIZED') {
    throw new SupabaseStorageUploadError(
      'UNAUTHORIZED',
      res.status,
      apiMsg || 'Fadlan dib u soo gal xisaabtaada Admin-ka.'
    );
  }
  if (res.status === 403 || apiError === 'FORBIDDEN') {
    throw new SupabaseStorageUploadError(
      'FORBIDDEN',
      res.status,
      apiMsg || 'Xisaabtan ma laha awoodda Admin-ka.'
    );
  }
  if (res.status === 413 || apiError === 'FILE_TOO_LARGE') {
    throw new SupabaseStorageUploadError(
      'FILE_TOO_LARGE',
      res.status,
      apiMsg || 'Faylku wuu ka weyn yahay xadka Supabase Storage (50 MB).'
    );
  }

  throw new SupabaseStorageUploadError(
    'UPLOAD_FAILED',
    res.status,
    apiMsg || `Supabase signed upload waa la diiday (HTTP ${res.status}).`
  );
}

export async function uploadFileToSupabaseStorage(params: {
  folder: 'covers' | 'books';
  file: File;
  idToken: string;
  onProgress?: (percent: number) => void;
}): Promise<SupabaseSignedUploadResult> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new SupabaseStorageUploadError(
      'SERVER_UNAVAILABLE',
      0,
      'Internet ma jiro. Fadlan hubi khadkaaga.'
    );
  }

  params.onProgress?.(2);
  const { signedUrl, publicUrl, path, bucket } = await requestSignedUploadUrl({
    folder: params.folder,
    file: params.file,
    idToken: params.idToken,
  });

  const inferredMime =
    params.file.type ||
    (params.file.name.toLowerCase().endsWith('.pdf')
      ? 'application/pdf'
      : params.file.name.toLowerCase().endsWith('.epub')
      ? 'application/epub+zip'
      : 'application/octet-stream');

  return new Promise<SupabaseSignedUploadResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', signedUrl);
    xhr.timeout = 180000;
    xhr.setRequestHeader('Content-Type', inferredMime);
    xhr.setRequestHeader('x-upsert', 'true');

    xhr.upload.onprogress = (evt) => {
      if (evt.lengthComputable && evt.total > 0) {
        const pct = Math.min(99, Math.max(3, Math.round((evt.loaded / evt.total) * 100)));
        params.onProgress?.(pct);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        params.onProgress?.(100);
        resolve({ publicUrl, path, bucket });
        return;
      }

      let detail = '';
      try {
        const parsed = JSON.parse(xhr.responseText) as { message?: string; error?: string };
        detail = parsed.message || parsed.error || '';
      } catch {
        detail = xhr.responseText?.slice(0, 140) || '';
      }

      reject(
        new SupabaseStorageUploadError(
          'UPLOAD_FAILED',
          xhr.status,
          `Supabase Storage upload wuu fashilmay (HTTP ${xhr.status})${detail ? `: ${detail}` : '.'}`
        )
      );
    };

    xhr.ontimeout = () => {
      reject(
        new SupabaseStorageUploadError(
          'UPLOAD_FAILED',
          0,
          'Soo gelinta Supabase Storage way daahday. Hubi khadkaaga.'
        )
      );
    };

    xhr.onerror = () => {
      reject(
        new SupabaseStorageUploadError(
          'UPLOAD_FAILED',
          0,
          'Xiriirka Supabase Storage wuu go’ay markii faylka la dirayay.'
        )
      );
    };

    xhr.send(params.file);
  });
}
