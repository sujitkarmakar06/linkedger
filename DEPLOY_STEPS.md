# LinkLedger - Deploy to Render (step by step)

Everything is ready. This takes ~15-20 minutes. Secrets go into Render's
Environment tab only - never into the repo.

## 1. Put the code on GitHub
- Create a new GitHub repo (private is fine), e.g. `linkledger`.
- Upload the entire contents of the `LinkLedger` folder to the repo root
  (so `index.js`, `package.json`, `render.yaml`, `db/`, `public/` are at the top level).
- Do NOT upload `node_modules` (there's a .gitignore that excludes it).

## 2. Create the services on Render (Blueprint = near one-click)
- Render dashboard -> New + -> Blueprint -> connect your GitHub repo.
- Render reads `render.yaml` and provisions:
  - a free PostgreSQL database (`linkledger-db`)
  - the web service (`linkledger`), with `DATABASE_URL` auto-wired and
    `JWT_SECRET` + `GEO_CRON_TOKEN` auto-generated.
- Click Apply. First deploy will build and boot.

## 3. Add your integration keys (Environment tab of the web service)
Set these (the values you provided go here - paste them in Render, not in code):
- GOOGLE_CLIENT_ID         = <your Google client id>
- GOOGLE_CLIENT_SECRET     = <your Google client secret>
- GSC_SITE_URL             = sc-domain:solguruz.com
- GSC_REFRESH_TOKEN        = <your GSC refresh token>
- PAGESPEED_API_KEY        = <your PageSpeed key>
- PAGESPEED_URL            = https://solguruz.com/
- LINKEDIN_CLIENT_ID       = <your LinkedIn client id>
After you know your app URL (https://<app>.onrender.com), also set:
- GOOGLE_REDIRECT_URI      = https://<app>.onrender.com/api/gmail/callback
- GSC_REDIRECT_URI         = https://<app>.onrender.com/api/google/callback
Optional (add when you have them): LINKEDIN_CLIENT_SECRET, LINKEDIN_REDIRECT_URI,
AHREFS_API_KEY, MOZ_ACCESS_ID, MOZ_SECRET_KEY, SEMRUSH_API_KEY, FACEBOOK_*,
INSTAGRAM_ACCESS_TOKEN, TWITTER_BEARER_TOKEN.

## 4. Register the redirect URIs in Google Cloud
- Google Cloud Console -> APIs & Services -> Credentials -> your OAuth client.
- Add BOTH Authorized redirect URIs (must byte-match what's in the env vars):
  - https://<app>.onrender.com/api/gmail/callback
  - https://<app>.onrender.com/api/google/callback
- `redirect_uri_mismatch` is the #1 error - copy/paste exactly, no trailing slash.

## 5. Deploy and verify
- Render -> Manual Deploy -> "Clear build cache & deploy" (so new env vars apply).
- Boot log should show: `[migrate] applied 001_core.sql` ... through `012_prospects.sql`,
  then `[boot] LinkLedger listening on :PORT`. First boot seeds your 202 rows.
- Open the URL -> create the team account (signup) -> you'll see your real data.

## 6. What's live immediately vs. one click
- GSC + PageSpeed: live right away (refresh-token + API key).
- Gmail send: click "Connect Gmail" in the tool once (approves the gmail.send scope).
- LinkedIn: add client secret + redirect URI, then connect.
- Ahrefs / Moz / social: live when you add their API keys.

## 7. (Optional) GEO daily cron
- In GitHub repo settings -> Secrets -> add `APP_URL` (your Render URL) and
  `GEO_CRON_TOKEN` (matching the value Render generated). The included GitHub
  Action posts a daily GEO snapshot.

## Health check
Render pings `/login` (returns 200). If a deploy fails, check the Logs tab -
the most common issues are a missing DATABASE_URL (Blueprint wires it) or a
redirect URI mismatch (step 4).
