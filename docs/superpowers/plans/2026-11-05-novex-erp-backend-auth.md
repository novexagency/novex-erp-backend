# Novex ERP Backend Auth — Implementation Plan

> **Status:** Executed inline (user requested immediate secure build)

**Goal:** Scaffold Express+TS+Prisma backend with secure cookie-based Auth.

**Architecture:** Layered routes → controllers → services → Prisma; access JWT + hashed refresh tokens in httpOnly cookies.

**Tech Stack:** Express, TypeScript, PostgreSQL, Prisma 5, Zod, Helmet, bcrypt, JWT, express-rate-limit

## Done

- [x] Project scaffold + env validation
- [x] Prisma schema (User, RefreshToken) + migration SQL
- [x] Auth module: login / refresh / logout / me
- [x] Seed admin
- [x] README + design doc

## Remaining for local run

- [ ] Start PostgreSQL and set `DATABASE_URL` in `.env`
- [ ] `npx prisma migrate deploy`
- [ ] `npm run prisma:seed`
- [ ] `npm run dev`
