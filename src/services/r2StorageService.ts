export interface R2StorageStatus {
  configured: boolean;
  mode: 'binding' | 's3' | 'binding+s3' | 'none';
  bucket: string;
  hasPublicUrl: boolean;
  canPresign: boolean;
  maxDirectMb: number;
  reachable: boolean;
}

export interface R2UploadResult {
  publicUrl: string;
  objectKey: string;
  bucket: string;
}

export type R2UploadErrorCode =
  | 'R2_NOT_CONFIGURED'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'FILE_TOO_LARGE'
  | 'SERVER_UNAVAILABLE'
  | 'UPLOAD_FAILED';

export class R2StorageUploadError extends Error {
  code: R2UploadErrorCode;
  status: number;

  constructor(code: R2UploadErrorCode, status: number, message: string) {
    super(message);
    this.name = 'R2StorageUploadError';
    this.code = code;
    this.status = status;
  }
}

let cachedR2Status: { value: R2StorageStatus; fetchedAt: number } | null = null;

export async function fetchR2StorageStatus(forceRefresh = false): Promise<R2StorageStatus> {
  if (!forceRefresh && cachedR2Status && Date.now() - cachedR2Status.fetchedAt < 30000) {
    return cachedR2Status.value;
  }

  const fallback: R2StorageStatus = {
    configured: false,
    mode: 'none',
    bucket: '',
    hasPublicUrl: false,
    canPresign: false,
    maxDirectMb: 100,
    reachable: false,
  };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch('/api/r2-storage/status', {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      const contentType = res.headers.get('content-type') || '';
      if (!res.ok || !contentType.includes('application/json')) {
        return fallback;
      }
      const data = (await res.json()) as Partial<R2StorageStatus>;
      const mode: R2StorageStatus['mode'] =
        data.mode === 'binding' || data.mode === 's3' || data.mode === 'binding+s3'
          ? data.mode
          : 'none';
      const value: R2StorageStatus = {
        configured: Boolean(data.configured),
        mode,
        bucket: typeof data.bucket === 'string' ? data.bucket : '',
        hasPublicUrl: Boolean(data.hasPublicUrl),
        canPresign: Boolean(data.canPresign),
        maxDirectMb: typeof data.maxDirectMb === 'number' ? data.maxDirectMb : 100,
        reachable: true,
      };
      cachedR2Status = { value, fetchedAt: Date.now() };
      return value;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return fallback;
  }
}

function uploadViaXhrPut(params: {
  uploadUrl: string;
  file: File;
  contentType: string;
  onProgress?: (percent: number) => void;
}): Promise<{ corsOrNetworkBlocked: boolean }> {
  const { uploadUrl, file, contentType, onProgress } = params;
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    xhr.timeout = 180000;
    if (contentType) {
      xhr.setRequestHeader('Content-Type', contentType);
    }

    xhr.upload.onprogress = (evt) => {
      if (evt.lengthComputable && evt.total > 0) {
        const pct = Math.min(96, Math.max(10, Math.round(10 + (evt.loaded / evt.total) * 86)));
        onProgress?.(pct);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        resolve({ corsOrNetworkBlocked: false });
        return;
      }
      if (xhr.status === 0) {
        resolve({ corsOrNetworkBlocked: true });
        return;
      }
      reject(
        new R2StorageUploadError(
          'UPLOAD_FAILED',
          xhr.status,
          `Cloudflare R2 direct PUT waa la diiday (HTTP ${xhr.status}).`
        )
      );
    };

    xhr.onerror = () => {
      // Browser blocks cross-origin PUT without bucket CORS with status 0
      resolve({ corsOrNetworkBlocked: true });
    };

    xhr.ontimeout = () => {
      reject(
        new R2StorageUploadError(
          'UPLOAD_FAILED',
          0,
          'Soo gelinta Cloudflare R2 way daahday. Hubi xajmiga faylka iyo khadkaaga.'
        )
      );
    };

    xhr.send(file);
  });
}

function uploadViaSameOriginProxy(params: {
  folder: 'covers' | 'books';
  file: File;
  idToken: string;
  onProgress?: (percent: number) => void;
}): Promise<R2UploadResult> {
  const { folder, file, idToken, onProgress } = params;
  return new Promise<R2UploadResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/r2-storage/upload');
    xhr.timeout = 180000;
    xhr.setRequestHeader('Authorization', `Bearer ${idToken}`);
    xhr.setRequestHeader('X-Folder', folder);
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
    if (file.type) {
      xhr.setRequestHeader('Content-Type', file.type);
    }

    xhr.upload.onprogress = (evt) => {
      if (evt.lengthComputable && evt.total > 0) {
        const pct = Math.min(95, Math.max(10, Math.round(10 + (evt.loaded / evt.total) * 85)));
        onProgress?.(pct);
      }
    };

    xhr.upload.onload = () => {
      onProgress?.(97);
    };

    xhr.onload = () => {
      let parsed: Record<string, unknown> | null = null;
      try {
        parsed = JSON.parse(xhr.responseText) as Record<string, unknown>;
      } catch {
        parsed = null;
      }

      if (xhr.status >= 200 && xhr.status < 300 && parsed && typeof parsed.publicUrl === 'string') {
        onProgress?.(100);
        resolve({
          publicUrl: parsed.publicUrl,
          objectKey: typeof parsed.objectKey === 'string' ? parsed.objectKey : '',
          bucket: typeof parsed.bucket === 'string' ? parsed.bucket : '',
        });
        return;
      }

      const apiError = typeof parsed?.error === 'string' ? parsed.error : '';
      const apiMsg = typeof parsed?.message === 'string' ? parsed.message : '';

      if (xhr.status === 401 || apiError === 'UNAUTHORIZED') {
        reject(new R2StorageUploadError('UNAUTHORIZED', xhr.status, apiMsg || 'Fadlan dib u soo gal xisaabta Admin-ka.'));
        return;
      }
      if (xhr.status === 403 || apiError === 'FORBIDDEN') {
        reject(new R2StorageUploadError('FORBIDDEN', xhr.status, apiMsg || 'Xisaabtan ma laha awoodda Admin-ka.'));
        return;
      }
      if (xhr.status === 413 || apiError === 'FILE_TOO_LARGE') {
        reject(new R2StorageUploadError('FILE_TOO_LARGE', xhr.status, apiMsg || 'Faylku wuu ka weyn yahay xadka la oggol yahay.'));
        return;
      }
      if (xhr.status === 503 || apiError === 'R2_NOT_CONFIGURED') {
        reject(new R2StorageUploadError('R2_NOT_CONFIGURED', xhr.status, apiMsg || 'Cloudflare R2 weli laguma darin server-ka.'));
        return;
      }

      reject(
        new R2StorageUploadError(
          'UPLOAD_FAILED',
          xhr.status,
          apiMsg || `Soo gelinta Cloudflare R2 way fashilantay (HTTP ${xhr.status}).`
        )
      );
    };

    xhr.onerror = () => {
      reject(
        new R2StorageUploadError(
          'SERVER_UNAVAILABLE',
          0,
          'Lama gaari karin adeegga Cloudflare R2 Upload.'
        )
      );
    };

    xhr.ontimeout = () => {
      reject(
        new R2StorageUploadError(
          'UPLOAD_FAILED',
          0,
          'Soo gelinta Cloudflare R2 way daahday.'
        )
      );
    };

    xhr.send(file);
  });
}

export async function uploadFileToR2Storage(params: {
  folder: 'covers' | 'books';
  file: File;
  idToken: string;
  canPresign?: boolean;
  onProgress?: (percent: number) => void;
}): Promise<R2UploadResult> {
  const { folder, file, idToken, canPresign = true, onProgress } = params;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new R2StorageUploadError(
      'SERVER_UNAVAILABLE',
      0,
      'Internet ma jiro. Fadlan hubi khadkaaga.'
    );
  }

  onProgress?.(4);

  if (canPresign) {
    const presignRes = await fetch('/api/r2-storage/presign', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        folder,
        fileName: file.name,
        contentType: file.type,
        fileSize: file.size,
      }),
    });

    if (presignRes.ok) {
      const presigned = (await presignRes.json()) as {
        uploadUrl: string;
        publicUrl: string;
        objectKey: string;
        contentType?: string;
        bucket?: string;
      };
      onProgress?.(10);
      const putResult = await uploadViaXhrPut({
        uploadUrl: presigned.uploadUrl,
        file,
        contentType: presigned.contentType || file.type || 'application/octet-stream',
        onProgress,
      });
      if (!putResult.corsOrNetworkBlocked) {
        return {
          publicUrl: presigned.publicUrl,
          objectKey: presigned.objectKey,
          bucket: presigned.bucket || '',
        };
      }
      // Fall through cleanly to same-origin proxy upload when bucket CORS is not configured
    } else {
      let errData: Record<string, unknown> | null = null;
      try {
        errData = (await presignRes.json()) as Record<string, unknown>;
      } catch {
        errData = null;
      }
      const errCode = typeof errData?.error === 'string' ? errData.error : '';
      const errMsg = typeof errData?.message === 'string' ? errData.message : '';

      if (presignRes.status === 401 || errCode === 'UNAUTHORIZED') {
        throw new R2StorageUploadError('UNAUTHORIZED', presignRes.status, errMsg || 'Fadlan dib u soo gal xisaabta Admin-ka.');
      }
      if (presignRes.status === 403 || errCode === 'FORBIDDEN') {
        throw new R2StorageUploadError('FORBIDDEN', presignRes.status, errMsg || 'Xisaabtan ma laha awoodda Admin-ka.');
      }
      if (presignRes.status === 413 || errCode === 'FILE_TOO_LARGE') {
        throw new R2StorageUploadError('FILE_TOO_LARGE', presignRes.status, errMsg || 'Faylku wuu ka weyn yahay xadka R2.');
      }
      if (errCode !== 'USE_DIRECT_UPLOAD') {
        // Fall through to proxy only for USE_DIRECT_UPLOAD; otherwise rethrow configured errors
        if (errCode === 'R2_NOT_CONFIGURED') {
          throw new R2StorageUploadError('R2_NOT_CONFIGURED', presignRes.status, errMsg || 'Cloudflare R2 weli laguma darin.');
        }
      }
    }
  }

  return uploadViaSameOriginProxy({
    folder,
    file,
    idToken,
    onProgress,
  });
}
