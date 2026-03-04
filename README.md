# couranr-os

Operating software for Couranr services, built with Next.js 14.

## Requirements

- Node.js 20+
- npm

## Getting started

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create a local env file:
   ```bash
   cp .env.example .env.local
   ```
   If `.env.example` is not present, create `.env.local` manually with the variables below.
3. Start the development server:
   ```bash
   npm run dev
   ```
4. Open `http://localhost:3000`.

## Scripts

- `npm run dev` – run local development server.
- `npm run typecheck` – run TypeScript checks.
- `npm run build` – create production build.
- `npm run check` – run typecheck and build.

## Environment variables

The app references these environment variables across API routes and pages:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `STRIPE_SECRET_KEY`
- `NEXT_PUBLIC_SITE_URL`
- `NEXT_PUBLIC_APP_URL`
- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `NEXT_PUBLIC_TEST_MODE`
- `NEXT_PUBLIC_AUTO_TEST_MODE`
- `NEXT_PUBLIC_DOCS_TEST_MODE`
- `DOCS_TEST_MODE`
