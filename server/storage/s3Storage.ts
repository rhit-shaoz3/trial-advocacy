import {
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import {
  dispositionHeader,
  DOWNLOAD_URL_TTL_SECONDS,
  UPLOAD_URL_TTL_SECONDS,
  type FileStorage,
} from './shared.ts'

/**
 * Case files in a private S3 bucket. Credentials come from the standard AWS
 * environment variables (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY).
 */
export function s3Storage(bucket: string, region: string): FileStorage {
  const client = new S3Client({ region })

  return {
    async uploadTarget(key, contentType, size) {
      const url = await getSignedUrl(
        client,
        new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType, ContentLength: size }),
        {
          expiresIn: UPLOAD_URL_TTL_SECONDS,
          // Sign the type and length so the URL only accepts the file the server approved.
          signableHeaders: new Set(['content-type', 'content-length']),
        },
      )
      return { url, headers: { 'Content-Type': contentType } }
    },

    async size(key) {
      try {
        const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
        return head.ContentLength ?? 0
      } catch (err) {
        if (err instanceof NotFound || (err as { name?: string }).name === 'NotFound') return null
        throw err
      }
    },

    async move(from, to) {
      await client.send(new CopyObjectCommand({ Bucket: bucket, CopySource: `${bucket}/${from}`, Key: to }))
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: from }))
    },
    async copy(from, to) {
      await client.send(new CopyObjectCommand({ Bucket: bucket, CopySource: `${bucket}/${from}`, Key: to }))
    },

    downloadUrl(key, filename, contentType, inline) {
      return getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
          ResponseContentDisposition: dispositionHeader(filename, contentType, inline),
          ResponseContentType: contentType,
        }),
        { expiresIn: DOWNLOAD_URL_TTL_SECONDS },
      )
    },

    async read(key) {
      const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
      return Buffer.from(await object.Body!.transformToByteArray())
    },

    async put(key, data, contentType) {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: data, ContentType: contentType }))
    },

    async delete(keys) {
      // DeleteObjects takes up to 1000 keys at a time.
      for (let i = 0; i < keys.length; i += 1000) {
        await client.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })), Quiet: true },
          }),
        )
      }
    },
  }
}
