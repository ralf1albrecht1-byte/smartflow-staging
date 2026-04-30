import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

const LEGAL_LINKS = [
  { href: '/agb', label: 'AGB' },
  { href: '/datenschutz', label: 'Datenschutz' },
  { href: '/avv', label: 'AVV' },
  { href: '/unterauftragnehmer', label: 'Unterauftragnehmer' },
] as const;

interface LegalPageLayoutProps {
  children: React.ReactNode;
  activePath: string;
  version: string;
  effectiveDate: string;
  status: string;
}

export default function LegalPageLayout({
  children,
  activePath,
  version,
  effectiveDate,
  status,
}: LegalPageLayoutProps) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-50/50 to-background">
      {/* Header */}
      <header className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <Link
            href="/login"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Zurück
          </Link>
          <nav className="flex items-center gap-3 text-sm flex-wrap justify-end">
            {LEGAL_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={
                  link.href === activePath
                    ? 'font-medium text-foreground'
                    : 'text-muted-foreground hover:text-foreground transition-colors'
                }
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10 sm:py-16">
        {/* Version / Draft badge */}
        <div className="flex flex-wrap items-center gap-2 mb-6 text-xs">
          <span className="inline-flex items-center rounded-md bg-amber-50 border border-amber-200 px-2.5 py-1 font-medium text-amber-800">
            {status}
          </span>
          <span className="text-muted-foreground">Version: {version}</span>
          <span className="text-muted-foreground">· Gültig ab: {effectiveDate}</span>
        </div>

        {children}
      </main>

      {/* Footer */}
      <footer className="border-t mt-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-muted-foreground">
          <span>© 2026 Smartflow AI – Business Manager</span>
          <div className="flex items-center gap-4 flex-wrap">
            {LEGAL_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={
                  link.href === activePath
                    ? 'font-medium text-foreground'
                    : 'hover:text-foreground transition-colors'
                }
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}
