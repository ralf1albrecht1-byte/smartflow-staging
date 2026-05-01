import { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { PrismaAdapter } from '@next-auth/prisma-adapter';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { logAuditAsync } from '@/lib/audit';
import { normalizeEmail } from '@/lib/email-utils';
import { evaluateAccountStatus, auditLoginBlockedByStatus } from '@/lib/account-status';

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'E-Mail', type: 'email' },
        password: { label: 'Passwort', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        // Case-insensitive lookup with verified-preference. See login route
        // header comment for the production-incident root cause.
        const normalized = normalizeEmail(credentials.email);
        if (!normalized) return null;
        const user = await prisma.user.findFirst({
          where: { email: { equals: normalized, mode: 'insensitive' } },
          orderBy: [
            { emailVerified: { sort: 'desc', nulls: 'last' } },
            { createdAt: 'desc' },
          ],
        });
        if (!user || !user.password) {
          console.warn('[auth.authorize] no user or no password for email:', normalized);
          return null;
        }
        const isValid = await bcrypt.compare(credentials.password, user.password);
        if (!isValid) {
          console.warn('[auth.authorize] password mismatch for userId:', user.id);
          return null;
        }
        // Block login if email not verified
        if (!user.emailVerified) {
          console.warn('[auth.authorize] email not verified for userId:', user.id);
          return null;
        }
        // Block U — technischer Account-Status (separat vom ComplianceRequest-Status).
        // Bei nicht-aktivem Status verweigern wir den Login. NextAuth `authorize()`
        // kann keine spezifische deutsche Fehlermeldung an den Client liefern (siehe
        // `app/api/auth/login/route.ts` Pre-Check), aber wir loggen den Grund.
        const eff = evaluateAccountStatus(user as any);
        if (!eff.canAccess) {
          auditLoginBlockedByStatus({
            userId: user.id,
            email: user.email,
            status: eff.status,
            reason: eff.reason,
          });
          return null;
        }
        // Phase 3 — return trial fields too. NOTE: trial is soft-only, we DO
        // NOT block login here under any circumstances. Banner is rendered
        // client-side based on these values.
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role || 'user',
          trialEndDate: (user as any).trialEndDate ? (user as any).trialEndDate.toISOString() : null,
          trialNote: (user as any).trialNote || null,
        } as any;
      },
    }),
  ],
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  callbacks: {
    async jwt({ token, user, trigger }: any) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.trialEndDate = user.trialEndDate ?? null;
        token.trialNote = user.trialNote ?? null;
      }
      // On manual session refresh ("update" trigger via useSession().update()),
      // re-read trial fields from DB so admin changes propagate without re-login.
      if (trigger === 'update' && token?.id) {
        try {
          const fresh = await prisma.user.findUnique({
            where: { id: token.id as string },
            select: { trialEndDate: true, trialNote: true, role: true },
          });
          if (fresh) {
            token.role = fresh.role || token.role || 'user';
            token.trialEndDate = fresh.trialEndDate ? fresh.trialEndDate.toISOString() : null;
            token.trialNote = fresh.trialNote || null;
          }
        } catch (e) {
          // Stay safe: keep existing token values on lookup errors.
          console.error('[auth.jwt update] trial refresh failed:', e);
        }
      }
      return token;
    },
    async session({ session, token }: any) {
      if (session?.user) {
        (session.user as any).id = token.id;
        (session.user as any).role = token.role;
        (session.user as any).trialEndDate = token.trialEndDate ?? null;
        (session.user as any).trialNote = token.trialNote ?? null;
      }
      return session;
    },
  },
  events: {
    async signIn({ user }: any) {
      logAuditAsync({
        userId: user?.id,
        userEmail: user?.email,
        action: 'LOGIN',
        area: 'AUTH',
        success: true,
      });
    },
    async signOut({ token }: any) {
      logAuditAsync({
        userId: token?.id as string,
        userEmail: token?.email as string,
        action: 'LOGOUT',
        area: 'AUTH',
        success: true,
      });
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};
