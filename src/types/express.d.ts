import type { TenantContext } from "./tenant.js";

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  isSuperAdmin: boolean;
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      /** Verified tenant context — never accept as raw untrusted input */
      tenant?: TenantContext;
    }
  }
}

export {};
