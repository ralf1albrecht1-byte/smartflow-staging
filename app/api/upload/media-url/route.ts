export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { getFileUrl } from '@/lib/s3';
import { requireUserId, unauthorizedResponse, getSessionUser } from '@/lib/get-session';
import { verifyFileOwnership } from '@/lib/file-ownership';
import { logAuditAsync, EVENTS, AREAS } from '@/lib/audit';

/**
 * POST /api/upload/media-url
 *
 * Returns a (signed) URL for a private S3 object, or a direct public URL.
 *
 * SECURITY: Before generating any URL, ownership of the file is verified
 * against the authenticated user via DB lookup. If the file does not belong
 * to the calling user, 403 is returned and the attempt is audit-logged.
 */
export async function POST(request: Request) {
  try {
    let userId: string;
    try {
      userId = await requireUserId();
    } catch {
      return unauthorizedResponse();
    }

    const { cloud_storage_path, isPublic } = await request.json();
    if (!cloud_storage_path || typeof cloud_storage_path !== 'string') {
      return NextResponse.json({ error: 'cloud_storage_path required' }, { status: 400 });
    }

    // ── Tenant-isolation gate: verify file belongs to this user ──
    const isOwner = await verifyFileOwnership(userId, cloud_storage_path);
    if (!isOwner) {
      const su = await getSessionUser();
      logAuditAsync({
        userId,
        userEmail: su?.email,
        userRole: su?.role,
        action: EVENTS.FILE_ACCESS_DENIED,
        area: AREAS.SECURITY,
        success: false,
        errorMessage: 'file_ownership_check_failed',
        details: { reason: 'not_owner', route: '/api/upload/media-url' },
        request,
      });
      // Generic 403 — do not reveal whether the file exists
      return NextResponse.json({ error: 'Keine Berechtigung' }, { status: 403 });
    }

    const url = await getFileUrl(cloud_storage_path, isPublic ?? false);
    return NextResponse.json({ url });
  } catch (error: any) {
    console.error('Media URL error:', error);
    return NextResponse.json({ error: 'Failed to get media URL' }, { status: 500 });
  }
}
