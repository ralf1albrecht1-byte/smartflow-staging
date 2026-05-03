import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createS3Client, getBucketConfig } from "./aws-config";

const s3 = createS3Client();
const { bucketName, folderPrefix } = getBucketConfig();

// Server-side direct upload to S3 (for webhook-received files)
export async function uploadBufferToS3(
  buffer: Buffer,
  fileName: string,
  contentType: string,
  isPublic = false
): Promise<string> {
  // Use timestamp as a DIRECTORY prefix (not filename prefix) so the last URL
  // path segment is the clean filename. This matters because Twilio uses the
  // URL's last segment as the visible attachment name in WhatsApp.
  const prefix = isPublic ? `${folderPrefix}public/uploads` : `${folderPrefix}uploads`;
  const cloud_storage_path = `${prefix}/${Date.now()}/${fileName}`;

  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: cloud_storage_path,
    Body: buffer,
    ContentType: contentType,
    ContentDisposition: isPublic ? `attachment; filename="${fileName}"` : undefined,
  });

  await s3.send(command);
  return cloud_storage_path;
}

export async function generatePresignedUploadUrl(
  fileName: string,
  contentType: string,
  isPublic = false
) {
  const prefix = isPublic ? `${folderPrefix}public/uploads` : `${folderPrefix}uploads`;
  const cloud_storage_path = `${prefix}/${Date.now()}/${fileName}`;

  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: cloud_storage_path,
    ContentType: contentType,
  });

  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });
  return { uploadUrl, cloud_storage_path };
}

export async function getFileUrl(cloud_storage_path: string, isPublic: boolean) {
  if (isPublic) {
    const region = process.env.AWS_REGION || 'us-east-1';
    return `https://${bucketName}.s3.${region}.amazonaws.com/${cloud_storage_path}`;
  }
  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: cloud_storage_path,
    ResponseContentDisposition: "attachment",
  });
  // Short-lived signed URL (15 min). Ownership must be verified BEFORE calling this.
  return getSignedUrl(s3, command, { expiresIn: 900 });
}

// Download file content as Buffer directly from S3 (server-side only)
export async function downloadBufferFromS3(cloud_storage_path: string): Promise<Buffer> {
  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: cloud_storage_path,
  });
  const response = await s3.send(command);
  const stream = response.Body as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function deleteFile(cloud_storage_path: string) {
  const command = new DeleteObjectCommand({
    Bucket: bucketName,
    Key: cloud_storage_path,
  });
  await s3.send(command);
}
