import 'server-only';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';

/**
 * Where uploaded and generated media files live.
 *  - local (default): a folder on this server (SB_UPLOAD_DIR, default ./data/uploads)
 *  - s3: any S3-compatible bucket (AWS S3, Cloudflare R2, DigitalOcean Spaces, MinIO),
 *    needed when several web servers share the same files.
 * Keys look like "<client>/<random>.<ext>"; the random part makes them unguessable,
 * because platforms (Instagram, Facebook, Pinterest) must fetch them without signing in.
 */
export interface Storage {
  put(key: string, bytes: Buffer, mime: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  stream(key: string): Promise<{ body: ReadableStream; size?: number } | null>;
  remove(key: string): Promise<void>;
}

export const KEY_RE = /^[a-z0-9_]{1,40}\/[A-Za-z0-9_-]{16,64}(?:-[a-z]{1,12})?\.(jpg|png|webp|gif|mp4|mov)$/;

function localStorage(): Storage {
  const root = path.resolve(process.env.SB_UPLOAD_DIR || path.join(process.cwd(), 'data', 'uploads'));
  const file = (key: string) => {
    if (!KEY_RE.test(key)) throw new Error('Invalid media key');
    return path.join(root, key);
  };
  return {
    async put(key, bytes) {
      const f = file(key);
      await fs.mkdir(path.dirname(f), { recursive: true });
      await fs.writeFile(f, bytes);
    },
    async get(key) { return fs.readFile(file(key)); },
    async stream(key) {
      try {
        const f = file(key);
        const st = await fs.stat(f);
        const { createReadStream } = await import('node:fs');
        return { body: Readable.toWeb(createReadStream(f)) as ReadableStream, size: st.size };
      } catch { return null; }
    },
    async remove(key) { await fs.rm(file(key), { force: true }); },
  };
}

function s3Storage(): Storage {
  const bucket = process.env.S3_BUCKET!;
  // Lazy import keeps the AWS SDK out of servers that use local storage.
  const client = (async () => {
    const { S3Client } = await import('@aws-sdk/client-s3');
    return new S3Client({
      region: process.env.S3_REGION || 'auto',
      endpoint: process.env.S3_ENDPOINT || undefined,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
      credentials: process.env.S3_ACCESS_KEY_ID ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '' } : undefined,
    });
  })();
  const sdk = () => import('@aws-sdk/client-s3');
  return {
    async put(key, bytes, mime) {
      const { PutObjectCommand } = await sdk();
      await (await client).send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: mime }));
    },
    async get(key) {
      const { GetObjectCommand } = await sdk();
      const r = await (await client).send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      return Buffer.from(await r.Body!.transformToByteArray());
    },
    async stream(key) {
      const { GetObjectCommand } = await sdk();
      try {
        const r = await (await client).send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        return { body: r.Body!.transformToWebStream() as ReadableStream, size: r.ContentLength };
      } catch { return null; }
    },
    async remove(key) {
      const { DeleteObjectCommand } = await sdk();
      await (await client).send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}

let current: Storage | null = null;
export function storage(): Storage {
  current ??= process.env.SB_STORAGE === 's3' && process.env.S3_BUCKET ? s3Storage() : localStorage();
  return current;
}

/** Tests swap in an in-memory store. */
export function setStorage(s: Storage | null) { current = s; }

export function storageKind(): 'local' | 's3' {
  return process.env.SB_STORAGE === 's3' && process.env.S3_BUCKET ? 's3' : 'local';
}
