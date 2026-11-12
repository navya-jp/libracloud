// File storage for book covers and e-books.
//  - On AWS (S3_BUCKET set): files go to Amazon S3.
//      covers/  -> public through CloudFront (path /covers/...)
//      ebooks/  -> private; members get a short-lived pre-signed URL (5 minutes)
//  - Locally: files are saved to disk and served at /files/... (development only).
// AWS credentials come from the EC2 instance role (LabRole) - none are stored in code.

const fs = require('fs');
const path = require('path');
const { logger } = require('../../shared');

const BUCKET = process.env.S3_BUCKET || '';
const REGION = process.env.AWS_REGION || 'us-east-1';
const LOCAL_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');

let s3;
function client() {
  if (!s3) {
    const { S3Client } = require('@aws-sdk/client-s3');
    s3 = new S3Client({ region: REGION });
  }
  return s3;
}

const usingS3 = () => Boolean(BUCKET);

async function put(key, buffer, contentType) {
  if (usingS3()) {
    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    await client().send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      CacheControl: key.startsWith('covers/') ? 'public, max-age=604800' : 'private, no-store',
      ServerSideEncryption: 'AES256',
    }));
  } else {
    const file = path.join(LOCAL_DIR, key);
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(file, buffer);
  }
  logger.info('file_stored', { key, bytes: buffer.length, backend: usingS3() ? 's3' : 'local' });
}

async function remove(key) {
  if (!key) return;
  try {
    if (usingS3()) {
      const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
      await client().send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
    } else {
      await fs.promises.unlink(path.join(LOCAL_DIR, key));
    }
  } catch (err) {
    logger.warn('file_delete_failed', { key, error: err.message });
  }
}

// URL the browser uses for a public file (cover image).
function publicUrl(key) {
  return usingS3() ? `/${key}` : `/files/${key}`;
}

// Short-lived URL for a private file (e-book).
async function privateUrl(key, filename) {
  if (usingS3()) {
    const { GetObjectCommand } = require('@aws-sdk/client-s3');
    const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
    return getSignedUrl(client(), new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ResponseContentDisposition: `inline; filename="${filename.replace(/[^\w.-]/g, '_')}"`,
    }), { expiresIn: 300 });
  }
  return `/files/${key}`;
}

module.exports = { put, remove, publicUrl, privateUrl, usingS3, LOCAL_DIR };
