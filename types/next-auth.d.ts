import 'next-auth';
import 'next-auth/jwt';

/**
 * Phase 3 — augment NextAuth types so `session.user.role`,
 * `session.user.trialEndDate`, and `session.user.trialNote` are first-class
 * citizens in the type system.
 *
 * The values are populated by the JWT and session callbacks in `lib/auth.ts`.
 * Trial fields are SOFT-only — they exist purely for the user-facing banner
 * and admin tooling. They never block login or usage.
 */
declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      email: string | null;
      name?: string | null;
      image?: string | null;
      role: string;
      trialEndDate: string | null;
      trialNote: string | null;
    };
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string;
    role: string;
    trialEndDate: string | null;
    trialNote: string | null;
  }
}
