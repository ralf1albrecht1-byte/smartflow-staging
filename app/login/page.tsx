'use client';
import { useState, useEffect } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Briefcase, LogIn, UserPlus, Mail, Lock, User, Eye, EyeOff, Phone, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { toast } from 'sonner';
import { Suspense } from 'react';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [showResendVerification, setShowResendVerification] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [form, setForm] = useState({
    email: '',
    password: '',
    confirmPassword: '',
    name: '',
    // Block P — three separate compliance acceptances during signup.
    // Each maps to its own ConsentRecord + audit event server-side.
    acceptedAgb: false,
    acceptedDatenschutz: false,
    acceptedAvv: false,
    // Optional business contact data captured directly during registration.
    // Maps 1:1 onto CompanySettings columns (telefon/strasse/hausnummer/plz/ort)
    // — single source of truth; users can still edit later in /einstellungen.
    telefon: '',
    strasse: '',
    hausnummer: '',
    plz: '',
    ort: '',
  });

  // ─── Show one-shot toast for URL-based messages, then clean the URL.
  // Without cleanup, a page refresh or React re-render re-fires the toast,
  // making the user think the error persists (e.g. after unblock they still
  // see "Konto gesperrt" because the old query string lingers).
  useEffect(() => {
    const error = searchParams?.get('error');
    const verified = searchParams?.get('verified');
    if (!error && !verified) return;

    if (verified === 'true') {
      toast.success('E-Mail erfolgreich bestätigt! Sie können sich jetzt anmelden.');
    }
    if (verified === 'already') {
      toast.success('E-Mail bereits bestätigt. Sie können sich jetzt anmelden.');
    }
    if (error === 'invalid_token') {
      toast.error('Ungültiger Bestätigungslink. Bitte registrieren Sie sich erneut oder wenden Sie sich an den Support.');
    }
    if (error === 'expired_token') {
      toast.error('Der Bestätigungslink ist abgelaufen. Bitte registrieren Sie sich erneut.');
    }
    if (error === 'verification_failed') {
      toast.error('Bestätigung fehlgeschlagen. Bitte versuchen Sie es erneut oder fordern Sie einen neuen Link an.');
    }
    if (error === 'account_inactive') {
      const code = searchParams?.get('code') || '';
      const map: Record<string, string> = {
        ACCOUNT_BLOCKED: 'Ihr Konto wurde gesperrt. Bitte kontaktieren Sie den Support.',
        ACCOUNT_ANONYMIZED: 'Dieses Konto wurde anonymisiert und ist nicht mehr verfügbar.',
        ACCOUNT_EXPIRED: 'Ihr Zugang ist abgelaufen. Bitte kontaktieren Sie den Support.',
      };
      toast.error(map[code] || 'Ihr Konto ist nicht mehr aktiv. Bitte kontaktieren Sie den Support.');
    }

    // ─── Clean URL: remove error/verified/code params so the toast fires
    // only once. The user can now retry login on a clean URL without the
    // stale error re-appearing on every interaction.
    const cleaned = new URLSearchParams(searchParams?.toString() || '');
    cleaned.delete('error');
    cleaned.delete('verified');
    cleaned.delete('code');
    const qs = cleaned.toString();
    router.replace(qs ? `/login?${qs}` : '/login', { scroll: false });
  }, [searchParams, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (isLogin) {
        const preCheck = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: form.email, password: form.password }),
        });
        if (!preCheck.ok) {
          const data = await preCheck.json().catch(() => ({}));
          if (data?.code === 'EMAIL_NOT_VERIFIED') {
            toast.error('E-Mail noch nicht bestätigt.');
            setShowResendVerification(true);
          } else if (data?.code && data.code.startsWith('ACCOUNT_')) {
            // Block U — show the specific German status reason from the pre-check.
            toast.error(data?.error || 'Ihr Konto ist nicht aktiv. Bitte kontaktieren Sie den Support.');
            setShowResendVerification(false);
          } else {
            toast.error(data?.error || 'Anmeldung fehlgeschlagen. Bitte Zugangsdaten prüfen.');
            setShowResendVerification(false);
          }
          setLoading(false);
          return;
        }
        setShowResendVerification(false);
        const res = await signIn('credentials', { email: form.email, password: form.password, redirect: false });
        if (res?.error) {
          // Pre-check passed but NextAuth signIn failed. Re-check the pre-check
          // endpoint to surface a specific reason (e.g., account was blocked
          // between the two calls, or a transient error occurred).
          try {
            const recheck = await fetch('/api/auth/login', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email: form.email, password: form.password }),
            });
            if (!recheck.ok) {
              const recheckData = await recheck.json().catch(() => ({}));
              toast.error(recheckData?.error || 'Anmeldung fehlgeschlagen. Bitte versuchen Sie es erneut.');
            } else {
              // Pre-check still passes — likely a transient NextAuth error. Ask user to retry.
              toast.error('Anmeldung fehlgeschlagen. Bitte versuchen Sie es erneut.');
            }
          } catch {
            toast.error('Anmeldung fehlgeschlagen. Bitte versuchen Sie es erneut.');
          }
        } else {
          router.replace('/dashboard');
        }
      } else {
        if (form.password !== form.confirmPassword) {
          toast.error('Passwörter stimmen nicht überein');
          setLoading(false);
          return;
        }
        if (form.password.length < 8) {
          toast.error('Passwort muss mindestens 8 Zeichen lang sein');
          setLoading(false);
          return;
        }
        if (!form.acceptedAgb) {
          toast.error('Bitte akzeptieren Sie die AGB / Nutzungsbedingungen');
          setLoading(false);
          return;
        }
        if (!form.acceptedDatenschutz) {
          toast.error('Bitte akzeptieren Sie die Datenschutzerklärung');
          setLoading(false);
          return;
        }
        if (!form.acceptedAvv) {
          toast.error('Bitte akzeptieren Sie die AVV / Auftragsverarbeitung');
          setLoading(false);
          return;
        }
        const res = await fetch('/api/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(data?.error || 'Registrierung fehlgeschlagen');
        } else {
          toast.success(data?.message || 'Registrierung erfolgreich. Bitte prüfen Sie Ihre E-Mail.');
          setIsLogin(true);
          setForm({ ...form, password: '', confirmPassword: '', acceptedAgb: false, acceptedDatenschutz: false, acceptedAvv: false });
        }
      }
    } catch (err: any) {
      console.error(err);
      toast.error('Ein Fehler ist aufgetreten');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-gradient-to-br from-green-50 via-emerald-50 to-teal-50 p-4 pb-12">
      <Card className="w-full max-w-md" style={{ boxShadow: 'var(--shadow-lg)' }}>
        <CardHeader className="text-center space-y-2">
          <div className="mx-auto w-14 h-14 bg-primary rounded-xl flex items-center justify-center mb-2">
            <Briefcase className="w-8 h-8 text-primary-foreground" />
          </div>
          <CardTitle className="font-display text-2xl tracking-tight">Business Manager</CardTitle>
          <CardDescription>{isLogin ? 'Willkommen zurück! Bitte anmelden.' : 'Neues Konto erstellen'}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {!isLogin && (
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input id="name" placeholder="Ihr Name" className="pl-10" value={form.name} onChange={(e: any) => setForm({ ...form, name: e.target.value })} />
                </div>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">E-Mail</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input id="email" type="email" placeholder="email@beispiel.ch" className="pl-10" required value={form.email} onChange={(e: any) => setForm({ ...form, email: e.target.value })} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Passwort</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Passwort eingeben"
                  className="pl-10 pr-10"
                  required
                  value={form.password}
                  onChange={(e: any) => setForm({ ...form, password: e.target.value })}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            {!isLogin && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">Passwort bestätigen</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="confirmPassword"
                      type={showConfirmPassword ? 'text' : 'password'}
                      placeholder="Passwort wiederholen"
                      className="pl-10 pr-10"
                      required
                      value={form.confirmPassword}
                      onChange={(e: any) => setForm({ ...form, confirmPassword: e.target.value })}
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                      tabIndex={-1}
                    >
                      {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {form.confirmPassword && form.password !== form.confirmPassword && (
                    <p className="text-xs text-destructive">Passwörter stimmen nicht überein</p>
                  )}
                </div>

                {/* ─── Geschäftskontakt (optional) ───
                    Visible and expanded directly on registration. Fields are saved to
                    CompanySettings (single source of truth) via /api/signup; users can
                    still edit later under Einstellungen → Meine Daten. */}
                <div className="pt-2 border-t border-border/40 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-foreground">Geschäftskontakt</p>
                    <span className="text-xs text-muted-foreground">optional</span>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="telefon">Telefon</Label>
                    <div className="relative">
                      <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        id="telefon"
                        type="tel"
                        inputMode="tel"
                        placeholder="Telefonnummer"
                        className="pl-10"
                        value={form.telefon}
                        onChange={(e: any) => setForm({ ...form, telefon: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-[1fr,90px] gap-2">
                    <div className="space-y-2">
                      <Label htmlFor="strasse">Strasse</Label>
                      <div className="relative">
                        <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input
                          id="strasse"
                          placeholder="Strasse"
                          className="pl-10"
                          value={form.strasse}
                          onChange={(e: any) => setForm({ ...form, strasse: e.target.value })}
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="hausnummer">Nr.</Label>
                      <Input
                        id="hausnummer"
                        placeholder="Nr."
                        value={form.hausnummer}
                        onChange={(e: any) => setForm({ ...form, hausnummer: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-[100px,1fr] gap-2">
                    <div className="space-y-2">
                      <Label htmlFor="plz">PLZ</Label>
                      <Input
                        id="plz"
                        inputMode="numeric"
                        placeholder="PLZ"
                        value={form.plz}
                        onChange={(e: any) => setForm({ ...form, plz: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="ort">Ort</Label>
                      <Input
                        id="ort"
                        placeholder="Ort"
                        value={form.ort}
                        onChange={(e: any) => setForm({ ...form, ort: e.target.value })}
                      />
                    </div>
                  </div>
                </div>

                {/* Block P — Three separate acceptances. Each maps to its own
                    ConsentRecord row + audit event in /api/signup. */}
                <div className="pt-2 border-t border-border/40 space-y-3">
                  <p className="text-sm font-medium text-foreground">
                    AGB, Datenschutzerklärung und AVV / Auftragsverarbeitung akzeptieren
                  </p>
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      id="acceptedAgb"
                      checked={form.acceptedAgb}
                      onChange={(e) => setForm({ ...form, acceptedAgb: e.target.checked })}
                      className="mt-1 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                    />
                    <label htmlFor="acceptedAgb" className="text-sm text-muted-foreground">
                      Ich akzeptiere die{' '}
                      <Link href="/agb" target="_blank" className="text-primary hover:underline">AGB / Nutzungsbedingungen</Link>
                    </label>
                  </div>
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      id="acceptedDatenschutz"
                      checked={form.acceptedDatenschutz}
                      onChange={(e) => setForm({ ...form, acceptedDatenschutz: e.target.checked })}
                      className="mt-1 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                    />
                    <label htmlFor="acceptedDatenschutz" className="text-sm text-muted-foreground">
                      Ich akzeptiere die{' '}
                      <Link href="/datenschutz" target="_blank" className="text-primary hover:underline">Datenschutzerklärung</Link>
                    </label>
                  </div>
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      id="acceptedAvv"
                      checked={form.acceptedAvv}
                      onChange={(e) => setForm({ ...form, acceptedAvv: e.target.checked })}
                      className="mt-1 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                    />
                    <label htmlFor="acceptedAvv" className="text-sm text-muted-foreground">
                      Ich akzeptiere die{' '}
                      <Link href="/avv" target="_blank" className="text-primary hover:underline">AVV / Auftragsverarbeitung</Link>
                    </label>
                  </div>
                </div>
              </>
            )}
            {isLogin && (
              <div className="text-right">
                <Link href="/passwort-vergessen" className="text-sm text-muted-foreground hover:text-primary transition-colors">
                  Passwort vergessen?
                </Link>
              </div>
            )}
            {isLogin && showResendVerification && (
              <div className="rounded-md bg-amber-50 border border-amber-200 p-3 space-y-2">
                <p className="text-sm text-amber-800">
                  Ihre E-Mail-Adresse wurde noch nicht bestätigt. Prüfen Sie Ihr Postfach oder fordern Sie einen neuen Bestätigungslink an.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full border-amber-300 text-amber-800 hover:bg-amber-100"
                  disabled={resendLoading}
                  onClick={async () => {
                    setResendLoading(true);
                    try {
                      const res = await fetch('/api/auth/resend-verification', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ email: form.email }),
                      });
                      if (res.ok) {
                        toast.success('Bestätigungsmail wurde erneut gesendet. Bitte prüfen Sie Ihr Postfach.');
                        setShowResendVerification(false);
                      } else {
                        toast.error('Fehler beim Senden. Bitte versuchen Sie es später erneut.');
                      }
                    } catch {
                      toast.error('Fehler beim Senden. Bitte versuchen Sie es später erneut.');
                    } finally {
                      setResendLoading(false);
                    }
                  }}
                >
                  <Mail className="w-4 h-4 mr-2" />
                  {resendLoading ? 'Wird gesendet...' : 'Bestätigungsmail erneut senden'}
                </Button>
              </div>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Bitte warten...' : isLogin ? (<><LogIn className="w-4 h-4 mr-2" />Anmelden</>) : (<><UserPlus className="w-4 h-4 mr-2" />Registrieren</>)}
            </Button>
          </form>
          <div className="mt-4 text-center">
            <button type="button" className="text-sm text-muted-foreground hover:text-primary transition-colors" onClick={() => { setIsLogin(!isLogin); setForm({ email: form.email, password: '', confirmPassword: '', name: '', acceptedAgb: false, acceptedDatenschutz: false, acceptedAvv: false, telefon: '', strasse: '', hausnummer: '', plz: '', ort: '' }); }}>
              {isLogin ? 'Noch kein Konto? Registrieren' : 'Bereits registriert? Anmelden'}
            </button>
          </div>
        </CardContent>
      </Card>
      <div className="absolute bottom-4 left-0 right-0 flex items-center justify-center gap-4 text-xs text-muted-foreground">
        <Link href="/agb" className="hover:text-foreground transition-colors">AGB</Link>
        <span className="text-border">|</span>
        <Link href="/datenschutz" className="hover:text-foreground transition-colors">Datenschutz</Link>
        <span className="text-border">|</span>
        <Link href="/avv" className="hover:text-foreground transition-colors">AVV</Link>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-green-50 via-emerald-50 to-teal-50">
        <p className="text-muted-foreground">Laden...</p>
      </div>
    }>
      <LoginForm />
    </Suspense>
  );
}
