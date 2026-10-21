# TicketAgent / Braves Ticket Ops

[![Workspace checks](https://github.com/theonetruedaniel/ticketagent/actions/workflows/ci.yml/badge.svg)](https://github.com/theonetruedaniel/ticketagent/actions/workflows/ci.yml)

A ticket-inventory and alerting prototype by **Daniel Abrams**, developed with AI assistance. It combines a Next.js dashboard, Chrome extension, shared marketplace parsers and a Crawlee collection worker.

**Status: public source snapshot, prototype.** This edition defaults to a local dashboard. Publishing the source does not resume the private monitoring service. Live coverage, delivery reliability and a fresh end-to-end deployment have not been verified for this edition.

## Explore the work

| Area | Source | Purpose |
|---|---|---|
| Dashboard | [apps/web](apps/web) | Inventory filters, freshness and deal inspection |
| Chrome extension | [apps/extension](apps/extension) | Rendered-page collection and scan state |
| Worker | [apps/worker](apps/worker) | Bounded collection and blocked/partial states |
| Shared logic | [packages/contracts](packages/contracts) | Normalization, provenance, price and freshness |
| Database | [supabase](supabase) | Schema, ingestion, access policies and seed fixtures |

A listing disappearing from a partial capture does not establish that it sold. Blocking states remain visible. The code includes ingestion and delivery logic; provider behavior requires separate configuration and validation.

## Local development

Requires Node.js 22+ and pnpm 10.12.1.

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
pnpm dev
```

Open `http://localhost:3000`. Without Supabase variables, the dashboard uses labeled demo inventory. Review `.env.example` for optional services; values are placeholders. Keep real credentials out of Git. The package uses `private: true` to prevent accidental npm publication; this GitHub repository is public.

Build the extension with `pnpm --filter @ticket-agent/extension build`, then load `apps/extension/dist` as an unpacked Chrome extension. This edition points to localhost. Configure a separate deployment and its host permissions explicitly. Collectors and delivery services are unnecessary for inspecting the source.

## Automated validation

GitHub Actions installs the frozen lockfile using the pinned pnpm version in `package.json`, then runs all workspace tests, type checks and builds on Node.js 22. This covers contracts, extension logic, dashboard utilities and worker logic. The dashboard builds without service credentials using its demo defaults.

CI does not start the collection worker, install browser runtimes, apply database migrations or send notifications. Passing tests and builds does not establish live provider coverage or end-to-end delivery. TypeScript incremental build caches are ignored by Git.

## Publication scope

This snapshot excludes credentials, personal browser profiles, generated builds, operational startup/deployment scripts, a personal authorization migration and a third-party venue-chart image. The dashboard links to the official venue view instead. The original workspace remains separate.

Review and configure migrations and scheduling definitions before applying them to any database. Publication did not apply migrations, send notifications or collect live listings.

## My role

I defined the workflow and operational requirements, guided development with AI assistance, and reviewed parsing, freshness and delivery behavior. This repository presents implementation and testing work alongside the prototype's unresolved operational limits.

[Portfolio](https://theonetruedaniel.github.io/) · [GitHub](https://github.com/theonetruedaniel)

## License

Original software and accompanying documentation in this repository are licensed under the [MIT License](LICENSE), copyright (c) 2026 Daniel Abrams. Third-party dependencies and any third-party content retain their respective licenses and rights.
