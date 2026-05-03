import { S3Client } from "@aws-sdk/client-s3";

type S3ResolvedConfig = {
  bucketName: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  folderPrefix: string;
};

export function getS3ResolvedConfig(): S3ResolvedConfig {
  return {
    bucketName: process.env.AWS_BUCKET_NAME || process.env.AWS_S3_BUCKET || "",
    region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1",
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || process.env.AWS_S3_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || process.env.AWS_S3_SECRET_ACCESS_KEY || "",
    folderPrefix: process.env.AWS_FOLDER_PREFIX ?? "",
  };
}

export function getBucketConfig() {
  const { bucketName, folderPrefix } = getS3ResolvedConfig();

  return {
    bucketName,
    folderPrefix,
  };
}

export function createS3Client() {
  const { region, accessKeyId, secretAccessKey } = getS3ResolvedConfig();

  return new S3Client({
    region,
    credentials:
      accessKeyId && secretAccessKey
        ? {
            accessKeyId,
            secretAccessKey,
          }
        : undefined,
  });
}
