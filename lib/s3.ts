// FORCE REDEPLOY - ACL FIX 2026-05-04

import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createS3Client, getBucketConfig, getS3ResolvedConfig } from "./aws-config";

const s3 = createS3Client();
const { bucketName, folderPrefix } = getBucketConfig();

function cleanFileName(fileName: string): string {
  return fileName.replace(/[^\w.\-äöüÄÖÜß]/g, "_");
}

function makeStoragePath(fileName: string, isPublic: boolean): string {
  const safeFileName = cleanFileName(fileName);
  const prefix = isPublic ? `${folderPrefix}public/uploads` : `${folderPrefix}uploads`;
  return `${prefix}/${Date.now()}/${safeFileName}`;
}

export async function uploadBufferToS3(
  buffer: Buffer,
  fileName: string,
  contentType: string,
  isPublic = false
): Promise<string> {
  const cloud_storage_path = makeStoragePath(fileName, isPublic);

  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: cloud_storage_path,
    Body: buffer,
    ContentType: contentType,
   
    ContentDisposition: isPublic ? "inline" : undefined,
  });

  await s3.send(command);
  return cloud_storage_path;
}

export async function generatePresignedUploadUrl(
  fileName: string,
  contentType: string,
  isPublic = false
) {
  const cloud_storage_path = makeStoragePath(fileName, isPublic);

  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: cloud_storage_path,
    ContentType: contentType,
    
    ContentDisposition: isPublic ? "inline" : undefined,
  });

  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });
  return { uploadUrl, cloud_storage_path };
}

export function buildPublicS3Url(key: string): string | null {
  const normalizedKey = key.replace(/^\/+/, "");
  const { bucketName: resolvedBucketName, region } = getS3ResolvedConfig();

  if (!resolvedBucketName || !region) return null;
  return `https://${resolvedBucketName}.s3.${region}.amazonaws.com/${normalizedKey}`;
}

export async function getFileUrl(cloud_storage_path: string, isPublic: boolean) {
  if (isPublic) {
    return buildPublicS3Url(cloud_storage_path) ?? cloud_storage_path;
  }

  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: cloud_storage_path,
    ResponseContentDisposition: "attachment",
  });

  return getSignedUrl(s3, command, { expiresIn: 900 });
}

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