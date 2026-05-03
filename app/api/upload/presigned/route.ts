export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { buildPublicS3Url, generatePresignedUploadUrl } from '@/lib/s3';
import { requireUserId, unauthorizedResponse, getSessionUser } from '@/lib/get-session';
import { logAuditAsync } from '@/lib/audit';

export async function POST(request: Request) {
  console.log(`[AWS Config Check] AWS_ACCESS_KEY_ID: ${!!process.env.AWS_ACCESS_KEY_ID}`);
  console.log(`[AWS Config Check] AWS_SECRET_ACCESS_KEY: ${!!process.env.AWS_SECRET_ACCESS_KEY}`);
  console.log(`[AWS Config Check] AWS_REGION: ${!!process.env.AWS_REGION}`);
  console.log(`[AWS Config Check] AWS_BUCKET_NAME: ${!!process.env.AWS_BUCKET_NAME}`);
  console.log(`[AWS Config Check] AWS_S3_BUCKET: ${!!process.env.AWS_S3_BUCKET}`);

  try {
    try { await requireUserId(); } catch { return unauthorizedResponse(); }
    const { fileName, contentType, isPublic } = await request.json();
    if (!fileName || !contentType) {
      return NextResponse.json({ error: 'fileName and contentType required' }, { status: 400 });
    }
    const result = await generatePresignedUploadUrl(fileName, contentType, isPublic ?? false);
    // For public uploads, also return the final public URL so callers don't need to
    // know the bucket / region layout. Keeps the client simple and avoids exposing
    // AWS env via NEXT_PUBLIC_* variables.
    const publicUrl = isPublic ? buildPublicS3Url(result.cloud_storage_path) : null;
    const su = await getSessionUser();
    logAuditAsync({ userId: su?.id, userEmail: su?.email, userRole: su?.role, action: 'FILE_UPLOAD', area: 'UPLOAD', details: { fileName, contentType }, request });
    return NextResponse.json({ ...result, publicUrl });
  } catch (error: any) {
    const errorName = error?.name ?? 'UnknownError';
    const errorMessage = error?.message ?? 'No error message';
    console.error(`[Presigned URL error] name: ${errorName}, message: ${errorMessage}`);
    return NextResponse.json({ error: 'Failed to generate upload URL' }, { status: 500 });
  }
}
