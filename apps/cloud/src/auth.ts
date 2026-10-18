import { betterAuth } from "better-auth";
import { bearer, deviceAuthorization, emailOTP } from "better-auth/plugins";
import { Kysely } from "kysely";
import { D1Dialect } from "kysely-d1";
import { DESKTOP_CLIENT_ID, type Env } from "./env";
import { sendSignInCode } from "./email";

const DAY = 60 * 60 * 24;

/**
 * Accounts and sessions. The desktop app signs in with the OAuth device flow
 * (it shows a code, the browser approves it) and then uses the session token
 * as a Bearer token. The browser uses cookies.
 */
export function createAuth(env: Env, baseURL: string) {
  const google =
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } }
      : undefined;

  return betterAuth({
    baseURL,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [baseURL],
    database: { db: new Kysely({ dialect: new D1Dialect({ database: env.DB }) }), type: "sqlite" },
    socialProviders: google,
    // Desktop sessions are long-lived and slide forward while in use.
    session: { expiresIn: 60 * DAY, updateAge: DAY },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 60,
      // Per IP. The plugin default (5 per 15 min) blocks an office signing in
      // together; 30 guesses against ~2.5e10 codes that expire in 15 min is safe.
      customRules: { "/device": { window: 15 * 60, max: 30 } },
    },
    // Rate limits are per client IP. Cloudflare puts the real client IP in
    // cf-connecting-ip; without this every user would share one bucket.
    advanced: { ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] } },
    databaseHooks: {
      user: {
        create: {
          // Email sign-ups have no name yet; start with the part before the @.
          before: async (user) => ({ data: { ...user, name: user.name?.trim() || user.email.split("@")[0] } }),
        },
      },
    },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 10 * 60,
        allowedAttempts: 5,
        // Per IP. The default (3/min) blocks colleagues behind one office network.
        rateLimit: { window: 60, max: 10 },
        sendVerificationOTP: ({ email, otp }) => sendSignInCode(env, email, otp),
      }),
      deviceAuthorization({
        expiresIn: "15m",
        interval: "3s",
        verificationUri: `${baseURL}/device`,
        validateClient: (clientId) => clientId === DESKTOP_CLIENT_ID,
      }),
      bearer(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
