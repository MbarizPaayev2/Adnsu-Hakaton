import { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import GoogleProvider from 'next-auth/providers/google';

// No database adapter here on purpose: NextAuth doesn't support persisting sessions
// via an adapter when using CredentialsProvider (it forces the `jwt` strategy below),
// and user creation is handled entirely by the NestJS API (POST /auth/register), not
// by NextAuth. All session state lives in the API's own Session table instead —
// this JWT just carries the API's sessionToken (see the callbacks below).
// Google sign-in is offered only where the deployment has configured it (client id and secret live in server environment only, never in the browser bundle).
const googleConfigured = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

export const authOptions: NextAuthOptions = {
  providers: [
    ...(googleConfigured
      ? [GoogleProvider({ clientId: process.env.GOOGLE_CLIENT_ID as string, clientSecret: process.env.GOOGLE_CLIENT_SECRET as string, authorization: { params: { prompt: 'select_account' } } })]
      : []),
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error('E-poçt və şifrə tələb olunur');
        }

        try {
          const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: credentials.email,
              password: credentials.password,
            }),
          });

          if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            throw new Error(errorData.message || 'E-poçt və ya şifrə yanlışdır');
          }

          const data = await res.json();
          // data should contain { user: { id, email, name, ... }, sessionToken }
          if (data && data.user && data.sessionToken) {
            return {
              id: data.user.id,
              email: data.user.email,
              name: data.user.name,
              sessionToken: data.sessionToken, // Pass token to jwt callback
            };
          }
          return null;
        } catch (error: any) {
          throw new Error(error.message || 'Daxil olma zamanı xəta baş verdi');
        }
      },
    }),
  ],
  session: {
    strategy: 'jwt', // Required for Credentials provider
  },
  callbacks: {
    // Google: the API verifies the ID token itself (signature, audience, verified e-mail) and answers with the same { user, sessionToken } as a password login.
    // Everything that is not a clean success sends the visitor back to /login with a code, never into a half-created session.
    async signIn({ user, account }) {
      if (account?.provider !== 'google') return true;
      if (!account.id_token) return '/login?error=google_failed';
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/auth/google`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken: account.id_token, acceptTerms: true }), // the notice beside the Google button names the Terms and Privacy Policy
        });
        if (res.status === 409) return '/login?error=google_conflict';
        if (res.status === 403) return '/login?error=google_suspended';
        if (!res.ok) return '/login?error=google_failed';
        const data = await res.json();
        if (!data?.user?.id || !data?.sessionToken) return '/login?error=google_failed';
        user.id = data.user.id;
        user.email = data.user.email;
        user.name = data.user.name;
        (user as any).sessionToken = data.sessionToken;
        return true;
      } catch {
        return '/login?error=google_failed';
      }
    },
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.userId = user.id;
        token.sessionToken = (user as any).sessionToken;
        if (user.name) token.name = user.name;
        if (user.email) token.email = user.email;
      }
      // The JWT strategy never re-reads the user from the API after login —
      // token.name is whatever /auth/login returned that one time. Editing
      // the display name later (profile editor, onboarding) updates the DB
      // but not this cookie, so the sidebar badge would show the old name
      // until a fresh login. useSession().update({ name }) calls back in
      // here with trigger === 'update' right after a successful save so the
      // token (and every useSession() consumer) picks up the new value
      // immediately.
      if (trigger === 'update' && session?.name !== undefined) {
        token.name = session.name;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.userId;
        (session as any).sessionToken = token.sessionToken;
        if (token.name) session.user.name = token.name as string;
        if (token.email) session.user.email = token.email as string;
      }
      return session;
    },
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
  secret: process.env.NEXTAUTH_SECRET,
};
