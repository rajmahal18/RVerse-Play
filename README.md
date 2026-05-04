# CourtFlow MVP

A simple but flexible pickleball open-play rotation manager.

## Stack
Next.js, TypeScript, React, Tailwind CSS, Prisma, PostgreSQL, PWA basics.

## Setup
```bash
npm install
Copy-Item .env.example .env
npx prisma migrate dev --name init
npm run dev
```

If you're using a cloud Postgres provider for development, set `SHADOW_DATABASE_URL` too. Prisma Migrate uses it to manage the shadow database.

Open `http://localhost:3000`.

## Features
- Create open-play sessions
- Set number of courts
- Add late-arriving players anytime
- Mark players resting, waiting, or left early
- Fair match generation using game count, waiting time, repeat partner/opponent penalties, and optional skill balance
- Manual player replacement in a generated match
- Finish matches and update history
- Session tabs: Queue, Courts, Players, History, Settings
- Mobile-safe layout, no horizontal scrolling except tab navigation
- Organizer billing flow with PayMongo checkout + webhook scaffolding
- Test admin/user switching for local billing and access checks

## Testing Access
- The home page now exposes an acting-user switcher for local testing.
- Seeded tester accounts are created automatically on first request:
  - `admin@courtflow.test` with full admin access
  - `organizer@courtflow.test` with active organizer access
  - `free@courtflow.test` with free access
- Free users are redirected to `/billing/upgrade` when they try to create a session.

## Billing Routes
- `/billing/upgrade`
- `/billing/success`
- `/billing/failed`
- `/account/billing`

## PayMongo Env
- `PAYMONGO_SECRET_KEY`
- `PAYMONGO_PUBLIC_KEY`
- `PAYMONGO_WEBHOOK_SECRET`
- `NEXT_PUBLIC_APP_URL`
- `ORGANIZER_MONTHLY_PRICE`
