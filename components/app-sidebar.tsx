'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { FileStack, LayoutDashboard, Users, ClipboardList, Wrench, FileText, FileCheck, LogOut, Menu, X, Trash2, Settings, ShieldCheck } from 'lucide-react';
import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/auftraege', label: 'Auftr\u00e4ge', icon: ClipboardList },
  { href: '/angebote', label: 'Angebote', icon: FileCheck },
  { href: '/rechnungen', label: 'Rechnungen', icon: FileText },
  { href: '/archiv', label: 'Archivierte Rechnungen', icon: FileText, sub: true },
  { href: '/kunden', label: 'Kunden', icon: Users },
  { href: '/leistungen', label: 'Leistungen', icon: Wrench },
  { href: '/einstellungen', label: 'Einstellungen', icon: Settings },
];

export default function AppSidebar() {
  const pathname = usePathname();
  const { data: session } = useSession() || {};
  const isAdmin = (session?.user as any)?.role === 'admin';
  const [open, setOpen] = useState(false);
  const [companyName, setCompanyName] = useState('');
  const [envLabel, setEnvLabel] = useState<string | null>(null);

  // Fetch company name once on mount (not on every route change to avoid DB pressure)
  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.firmenname) setCompanyName(data.firmenname);
        if (data?.envLabel) setEnvLabel(data.envLabel);
      })
      .catch(() => {});
  }, []);

  // Split company name into two lines: first word + rest
  const nameParts = companyName.trim().split(/\s+/);
  const line1 = nameParts[0] || '';
  const line2 = nameParts.slice(1).join(' ') || '';

  return (
    <>
      {/* Mobile toggle */}
      <button
        className="lg:hidden fixed top-4 left-4 z-50 p-2 bg-primary text-primary-foreground rounded-lg"
        style={{ boxShadow: 'var(--shadow-md)' }}
        onClick={() => setOpen(!open)}
      >
        {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
      </button>

      {/* Overlay */}
      {open && <div className="lg:hidden fixed inset-0 bg-black/40 z-40" onClick={() => setOpen(false)} />}

      {/* Sidebar */}
      <aside className={cn(
        'fixed lg:sticky top-0 left-0 z-40 h-screen w-64 bg-card border-r border-border flex flex-col transition-transform duration-300',
        open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
      )}>
        <div className="p-6 border-b border-border">
          <Link href="/dashboard" className="flex items-center gap-3" onClick={() => setOpen(false)}>
            <div className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center">
              <FileStack className="w-6 h-6 text-primary-foreground" />
            </div>
            <div>
              {companyName ? (
                line2 ? (
                  <>
                    <h1 className="font-display font-bold text-base tracking-tight">{line1}</h1>
                    <p className="text-xs text-muted-foreground">{line2}</p>
                  </>
                ) : (
                  <h1 className="font-display font-bold text-base tracking-tight">{line1}</h1>
                )
              ) : (
                <h1 className="font-display font-bold text-base tracking-tight text-muted-foreground">Firma</h1>
              )}
            </div>
          </Link>
          {envLabel && (
            <div className="mt-3 px-3 py-1.5 rounded-md bg-amber-100 dark:bg-amber-900/40 border border-amber-300 dark:border-amber-700 text-center">
              <span className="text-xs font-bold tracking-widest text-amber-800 dark:text-amber-300">{envLabel}</span>
            </div>
          )}
        </div>

        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {navItems.map((item: any) => {
            const isActive = pathname === item.href || pathname?.startsWith(item.href + '/');
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all',
                  (item as any).sub && 'pl-8 py-1.5',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                )}
              >
                <item.icon className={cn('w-5 h-5', (item as any).sub && 'w-4 h-4')} />
                <span className={(item as any).sub ? 'text-xs' : ''}>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-border space-y-1">
          {isAdmin && (
            <Link
              href="/admin"
              onClick={() => setOpen(false)}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all',
                pathname === '/admin'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )}
            >
              <ShieldCheck className="w-5 h-5" />
              Admin
            </Link>
          )}
          <Link
            href="/papierkorb"
            onClick={() => setOpen(false)}
            className={cn(
              'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all',
              pathname === '/papierkorb'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            )}
          >
            <Trash2 className="w-5 h-5" />
            Papierkorb
          </Link>
          <Button
            variant="ghost"
            className="w-full justify-start gap-3 text-muted-foreground hover:text-destructive"
            onClick={async () => {
              await signOut({ callbackUrl: '/login', redirect: true });
            }}
          >
            <LogOut className="w-5 h-5" />
            Abmelden
          </Button>
        </div>
      </aside>
    </>
  );
}
