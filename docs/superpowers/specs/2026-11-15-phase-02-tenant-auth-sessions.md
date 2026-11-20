# Phase 02 — Tenant Authentication & User Sessions

**Status:** Implemented  
**Date:** 2026-11-15

## Scope

Client-facing tenant authentication on the existing Express auth module, while keeping NOVEX platform access (`isSuperAdmin` + `/api/v1/platform`) separate.

## Features

- Email/password login (bcrypt 12), logout, refresh rotation
- Session list / revoke one / revoke all
- Password change (revokes sessions)
- Password reset foundation: admin issues token → user confirms (no email/WhatsApp)
- Account activate/deactivate + membership status
- Login success/failure history (`auth_events`)
- Lockout after 5 failed attempts (15 minutes)
- Tenant subscription gate on login/refresh/tenant context
- Suggested role categories seeded (not hardcoded permission matrices)

## APIs

### Auth (`/api/v1/auth`)
| Method | Path | Auth |
|--------|------|------|
| POST | `/login` | public |
| POST | `/refresh` | refresh cookie |
| POST | `/logout` | optional |
| GET | `/me` | access |
| POST | `/change-password` | access |
| POST | `/password-reset/confirm` | public (token) |
| GET | `/sessions` | access |
| DELETE | `/sessions/:sessionId` | access |
| POST | `/sessions/revoke-all` | access |
| GET | `/login-history` | access |

### Tenant user admin (`/api/v1/tenant`)
| Method | Path | Auth |
|--------|------|------|
| POST | `/users/password-reset` | tenant admin |
| PATCH | `/users/:userId/active` | tenant admin |
| PATCH | `/users/:userId/membership-status` | tenant admin |

## Security tests

`npx tsx scripts/test-auth-security.ts`
