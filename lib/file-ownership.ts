/**
 * File Ownership Verification — Tenant Isolation
 *
 * Verifies that a given S3 cloud_storage_path belongs to the authenticated user
 * by checking all DB tables that store file references.
 *
 * Used by /api/upload/media-url and any route that generates signed URLs
 * for file access.
 *
 * SECURITY RULE: No DB match = NO access.
 */
import { prisma } from '@/lib/prisma';

/**
 * Returns true if the given cloud_storage_path is linked to a record
 * owned by the specified userId. Checks:
 *   - Order.mediaUrl
 *   - Order.imageUrls (array contains)
 *   - Order.thumbnailUrls (array contains)
 *   - Invoice.archivedPdfPath
 *   - CompanySettings.letterheadUrl
 *
 * Soft-deleted records are included — ownership doesn't change on deletion.
 */
export async function verifyFileOwnership(
  userId: string,
  cloudStoragePath: string
): Promise<boolean> {
  if (!userId || !cloudStoragePath) return false;

  // Run all ownership checks in parallel for performance.
  // Each query is lightweight (indexed userId + field match, select only id).
  const [orderByMedia, orderByImage, orderByThumb, invoice, settings] =
    await Promise.all([
      prisma.order.findFirst({
        where: { userId, mediaUrl: cloudStoragePath },
        select: { id: true },
      }),
      prisma.order.findFirst({
        where: { userId, imageUrls: { has: cloudStoragePath } },
        select: { id: true },
      }),
      prisma.order.findFirst({
        where: { userId, thumbnailUrls: { has: cloudStoragePath } },
        select: { id: true },
      }),
      prisma.invoice.findFirst({
        where: { userId, archivedPdfPath: cloudStoragePath },
        select: { id: true },
      }),
      prisma.companySettings.findFirst({
        where: { userId, letterheadUrl: cloudStoragePath },
        select: { id: true },
      }),
    ]);

  return !!(
    orderByMedia ||
    orderByImage ||
    orderByThumb ||
    invoice ||
    settings
  );
}
