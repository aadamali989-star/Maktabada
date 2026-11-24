import {
  buildR2ObjectKey,
  buildR2PublicAssetUrl,
  createR2PresignedPutUrl,
  getObjectFromR2S3,
  isValidR2ObjectKey,
  jsonResponse,
  putObjectToR2S3,
  readR2CredentialsFromEnv,
  sanitizeR2ContentType,
  verifyFirebaseAdmin,
} from '../../functions/_shared/cloudflareHelpers.js';

const MAX_COVER_BYTES = 10 * 1024 * 1024;
const MAX_R2_PRESIGN_BOOK_BYTES = 100 * 1024 * 1024;
const MAX_R2_PROXY_BOOK_BYTES = 5 * 1024 * 1024;

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
          message: 'Cloudflare R2 weli laguma darin Environment Variables.',
        },
        503
      );
    }

    const authHeader = req.headers.get('authorization') || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    await verifyFirebaseAdmin(idToken, process.env);

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
