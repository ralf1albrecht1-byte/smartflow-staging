import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import ComplianceOnboardingForm from './compliance-onboarding-form';
import {
  computeConsentStatus,
  needsReAcceptance,
  hasAnyOutdated,
  REQUIRED_DOC_TYPES,
  CURRENT_TERMS_VERSION,
  CURRENT_PRIVACY_VERSION,
  CURRENT_AVV_VERSION,
  type ConsentStatusMap,
} from '@/lib/legal-versions';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Compliance-Akzeptanz – Business Manager',
  description: 'AGB, Datenschutzerklärung und AVV / Auftragsverarbeitung akzeptieren',
};

export default async function OnboardingCompliancePage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const userId = (session as any)?.user?.id;
  let status: ConsentStatusMap = { terms: 'missing', privacy: 'missing', avv: 'missing' };

  if (userId) {
    try {
      const records = await prisma.consentRecord.findMany({
        where: { userId },
        select: { documentType: true, documentVersion: true, acceptedAt: true },
        orderBy: { acceptedAt: 'desc' },
      });
      status = computeConsentStatus(records as any);
    } catch (e) {
      console.error('[onboarding-compliance] consent lookup failed:', e);
    }
  }

  // If everything is already accepted at the CURRENT version, send the user
  // straight to the dashboard. (Defence in depth in case the user navigates
  // here manually after re-acceptance is already complete.)
  if (!needsReAcceptance(status)) {
    redirect('/dashboard');
  }

  return (
    <ComplianceOnboardingForm
      status={status}
      isReAcceptance={hasAnyOutdated(status)}
      currentVersions={{
        terms: CURRENT_TERMS_VERSION,
        privacy: CURRENT_PRIVACY_VERSION,
        avv: CURRENT_AVV_VERSION,
      }}
    />
  );
}
