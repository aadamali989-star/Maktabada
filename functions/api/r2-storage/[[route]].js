import {
  buildR2ObjectKey,
  buildR2PublicAssetUrl,
  createR2PresignedPutUrl,
  getObjectFromR2S3,
  getR2Binding,
  isValidR2ObjectKey,
  jsonResponse,
  normalizeR2PublicUrl,
  putObjectToR2S3,
  readR2CredentialsFromEnv,
  sanitizeR2ContentType,
  verifyFirebaseAdmin,
} from '../../_shared/cloudflareHelpers.js';

const MAX_COVER_BYTES = 10 * 1024 * 1024;
const MAX_R2_PRESIGN_BOOK_BYTES = 100 * 1024 * 1024;
const MAX_R2_PROXY_BOOK_BYTES = 85 * 1024 * 1024;

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const subPath = url.pathname.replace(/^\/api\/r2-storage\/?/, '');

  const binding = getR2Binding(env);
  const creds = readR2CredentialsFromEnv(env);
  const publicUrl = normalizeR2PublicUrl(env?.R2_PUBLIC_URL || creds?.publicUrl);

  if (request.method === 'GET' && subPath === 'status') {
    const mode =
      binding && creds ? 'binding+s3' : binding ? 'binding' : creds ? 's3' : 'none';
    return jsonResponse({
      configured: Boolean(binding || creds),
      mode,
      bucket: creds?.bucketName || (binding ? 'MAKTABADA_BUCKET' : ''),
      hasPublicUrl: Boolean(publicUrl),
      canPresign: Boolean(creds),
      maxDirectMb: 100,
    });
  }

  if (request.method === 'GET' && subPath.startsWith('file/')) {
    const rawKey = decodeURIComponent(subPath.slice('file/'.length));
    if (!isValidR2ObjectKey(rawKey)) {
      return new Response('Invalid file key', { status: 400 });
    }

    if (publicUrl) {
      return Response.redirect(buildR2PublicAssetUrl(publicUrl, rawKey), 302);
    }

    if (binding) {
      const object = await binding.get(rawKey);
      if (!object) {
        return new Response('File not found', { status: 404 });
      }
      const headers = new Headers();
      if (typeof object.writeHttpMetadata === 'function') {
        object.writeHttpMetadata(headers);
      }
      if (!headers.has('Content-Type')) {
        headers.set('Content-Type', sanitizeR2ContentType('', rawKey));
      }
      headers.set('Cache-Control', 'public, max-age=31536000, immutable');
      headers.set('X-Content-Type-Options', 'nosniff');
      headers.set('etag', object.httpEtag);
      return new Response(object.body, { headers });
    }

    if (creds) {
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

    return new Response('R2 storage not configured', { status: 404 });
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405);
  }

  try {
    const authHeader = request.headers.get('authorization') || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    await verifyFirebaseAdmin(idToken, env);

    if (subPath === 'presign') {
      if (!creds) {
        return jsonResponse(
          {
            error: binding ? 'USE_DIRECT_UPLOAD' : 'R2_NOT_CONFIGURED',
            message: binding
              ? 'R2 Binding waxay adeegsanaysaa upload toos ah oo /api/r2-storage/upload ah.'
              : 'Cloudflare R2 weli laguma darin Cloudflare Pages Environment Variables.',
          },
          binding ? 409 : 503
        );
      }

      const body = await request.json();
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
      if (!binding && !creds) {
        return jsonResponse(
          {
            error: 'R2_NOT_CONFIGURED',
            message:
              'Cloudflare R2 weli laguma darin Cloudflare Pages (ku dar MAKTABADA_BUCKET binding ama R2_* secrets).',
          },
          503
        );
      }

      const rawFolder = request.headers.get('x-folder');
      const folder = rawFolder === 'covers' ? 'covers' : rawFolder === 'books' ? 'books' : null;
      if (!folder) {
        return jsonResponse(
          { error: 'INVALID_FOLDER', message: 'Folder-ku waa inuu noqdaa covers ama books.' },
          400
        );
      }

      const rawFileNameHeader = request.headers.get('x-file-name');
      let fileName = 'file';
      if (rawFileNameHeader && rawFileNameHeader.trim()) {
        try {
          fileName = decodeURIComponent(rawFileNameHeader.trim());
        } catch {
          fileName = rawFileNameHeader.trim();
        }
      }

      const arrayBuf = await request.arrayBuffer();
      if (!arrayBuf || arrayBuf.byteLength === 0) {
        return jsonResponse({ error: 'MISSING_FILE', message: 'Fayl madhan lama soo gelin karo.' }, 400);
      }

      const maxAllowed = folder === 'covers' ? MAX_COVER_BYTES : MAX_R2_PROXY_BOOK_BYTES;
      if (arrayBuf.byteLength > maxAllowed) {
        return jsonResponse(
          {
            error: 'FILE_TOO_LARGE',
            message: `Faylku wuu ka weyn yahay xadka (${Math.round(maxAllowed / (1024 * 1024))} MB).`,
          },
          413
        );
      }

      const contentType = sanitizeR2ContentType(request.headers.get('content-type'), fileName);
      const objectKey = buildR2ObjectKey(folder, fileName);

      if (binding) {
        await binding.put(objectKey, arrayBuf, {
          httpMetadata: {
            contentType,
            cacheControl: 'public, max-age=31536000, immutable',
          },
        });
        return jsonResponse({
          publicUrl: buildR2PublicAssetUrl(publicUrl, objectKey),
          objectKey,
          bucket: creds?.bucketName || 'MAKTABADA_BUCKET',
        });
      }

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
