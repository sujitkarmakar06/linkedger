# LinkLedger - Backlink Exchange and SEO Ops Manager

Single-tenant web app for a small SEO team: manage backlink exchanges, outreach,
link-health verification, and GEO/AI-search visibility. Replaces a messy
spreadsheet. One team, shared login, real data only - no fabricated numbers.

## Stack
- Backend: Node.js + Express (single `index.js`), PostgreSQL via `pg`.
- Frontend: one static `public/index.html`, vanilla JS, no build step.
- Migrations: numbered `db/0NN_*.sql`, run idempotently on boot.
- Auth: email + password (bcrypt), JWT in localStorage.

## Run locally
```bash
npm install
cp .env.example .env            # fill DATABASE_URL and JWT_SECRET at minimum
# export the vars (or use a dotenv loader), then:
DATABASE_URL=postgres://... JWT_SECRET=dev npm start
# open http://localhost:3000  -> create the team account on first load
```
Without any integration keys the app still runs; integration panels show an
honest "not configured" state instead of fake data.

## Deploy on Render (click-by-click)
1. Push this folder to a GitHub repo.
2. Render dashboard > New > PostgreSQL. Copy its Internal Database URL.
3. Render > New > Web Service > connect the repo.
   - Build command: `npm install`
   - Start command: `npm start`
4. Render > the web service > Environment: add the vars from `.env.example`
   that you have keys for. `DATABASE_URL` = the Postgres URL from step 2;
   `JWT_SECRET` = any long random string. `PORT` is set by Render automatically.
5. Deploy. Boot log should show `[migrate] applied 001_core.sql ...` for each
   migration, then `[boot] LinkLedger listening on :PORT`.
6. Open the URL, create the team account, then import your sheet from
   SEO Tools > Data import.

### OAuth redirect URIs (the #1 source of errors)
The redirect URI in your env var must byte-match the one registered in the
provider console (scheme, host, path, no trailing slash). Register BOTH Google
URIs: `/api/gmail/callback` (Gmail send) and `/api/google/callback` (GSC read).

### Integrations and where keys go
| Integration | Env vars |
|---|---|
| Ahrefs DR/traffic | `AHREFS_API_KEY` |
| Moz DA/PA | `MOZ_ACCESS_ID`, `MOZ_SECRET_KEY` |
| Google (Gmail + GSC) | `GOOGLE_CLIENT_ID/SECRET`, `GOOGLE_REDIRECT_URI`, `GSC_REDIRECT_URI`, `GSC_SITE_URL` |
| PageSpeed | `PAGESPEED_API_KEY` (optional - keyless works at low quota), `PAGESPEED_URL` |
| LinkedIn (read-only) | `LINKEDIN_CLIENT_ID/SECRET`, `LINKEDIN_REDIRECT_URI` |
| GEO cron | `GEO_CRON_TOKEN` (+ GitHub Actions secrets `APP_URL`, `GEO_CRON_TOKEN`) |

## GEO autopilot
`.github/workflows/geo-cron.yml` POSTs to `/api/geo/cron-snapshot` daily with the
`x-cron-token` header. The endpoint upserts the daily snapshot using COALESCE, so
a ping never overwrites real numbers. Set repo secrets `APP_URL` and
`GEO_CRON_TOKEN` (matching the server env var).

## Importing your sheet
SEO Tools > Data import accepts CSV or XLSX. It auto-detects columns, lets you map
them to fields, previews the row count, then imports into Exchanges. Ahrefs CSVs
(UTF-16 TSV or UTF-8 CSV) are handled for the competitor-gap diff in Backlinks Hub.

## Hard rules honored
No fabricated stats. No automated LinkedIn actions (search/open-profile only).
Secrets live in env vars only. Plain hyphen `-` is the only no-data glyph.
