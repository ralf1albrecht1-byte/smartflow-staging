export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { generatePresignedUploadUrl } from '@/lib/s3';
import { requireUserId, unauthorizedResponse, getSessionUser } from '@/lib/get-session';
import { logAuditAsync } from '@/lib/audit';

export async function POST(request: Request) {
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
    let publicUrl: string | null = null;
    if (isPublic) {
      const region = process.env.AWS_REGION || 'us-east-1';
      const bucket = process.env.AWS_BUCKET_NAME || '';
      if (bucket) publicUrl = `https://${bucket}.s3.${region}.amazonaws.com/${result.cloud_storage_path}`;
    }
    const su = await getSessionUser();
    logAuditAsync({ userId: su?.id, userEmail: su?.email, userRole: su?.role, action: 'FILE_UPLOAD', area: 'UPLOAD', details: { fileName, contentType }, request });
    return NextResponse.json({ ...result, publicUrl });
  } catch (error: any) {
    console.error('Presigned URL error:', error);
    return NextResponse.json({ error: 'Failed to generate upload URL' }, { status: 500 });
  }
}
