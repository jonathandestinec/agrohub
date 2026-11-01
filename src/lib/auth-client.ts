"use client";

import { createAuthClient } from "better-auth/react";
import { inferAdditionalFields, twoFactorClient } from "better-auth/client/plugins";
import type { auth } from "@/lib/auth";

// Browser client for the Better Auth routes under /api/auth (same origin).
// The type-only import of `auth` keeps the server config out of the client bundle.
// The sign-in page handles the 2FA challenge itself (`twoFactorRedirect` in the result).
export const authClient = createAuthClient({
  plugins: [inferAdditionalFields<typeof auth>(), twoFactorClient()],
});
