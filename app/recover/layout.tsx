import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Wiederherstellung – Business Manager',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default function RecoverLayout({ children }: { children: React.ReactNode }) {
  return children;
}
