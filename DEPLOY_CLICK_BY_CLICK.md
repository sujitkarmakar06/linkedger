# LinkLedger - Click-by-Click Deploy Guide (for a non-developer)

You need two free accounts: GitHub (to hold the code) and Render (to run it).
Total time ~15-20 min. You never touch a terminal.

================================================================
PART A - Put the code on GitHub
================================================================
1.  Go to github.com and sign in (or "Sign up" if you don't have an account).
2.  Top-right, click the "+" icon -> "New repository".
3.  Repository name: linkledger
4.  Choose "Private". Leave everything else unchecked. Click "Create repository".
5.  On the next page, click the link "uploading an existing file"
    (it's in the line: "...or push an existing repository...").
6.  Open your folder: C:\Users\SG\OneDrive\Desktop\Link Legend\LinkLedger
7.  Select ALL items inside LinkLedger (index.js, package.json, render.yaml,
    README.md, .env.example, the db folder, the public folder, etc.).
    IMPORTANT: there is no node_modules folder here - good, don't add one.
8.  Drag them onto the GitHub upload page (or "choose your files").
    - If GitHub won't let you drag folders, drag the files at the top level,
      then repeat the upload for the contents of `db` and `public` (use the
      "Add file -> Upload files" button and type the folder name as a prefix,
      e.g. type "db/" then drag the .sql files).
9.  Scroll down, click "Commit changes". Your code is now on GitHub.

================================================================
PART B - Create the app on Render (the Blueprint does the heavy lifting)
================================================================
10. Go to render.com -> "Get Started" / sign in. Choose "Sign in with GitHub"
    so Render can see your repo. Approve access to the linkledger repo.
11. In the Render dashboard, click "New +" (top right) -> "Blueprint".
12. Pick your "linkledger" repository from the list -> click "Connect".
13. Render reads render.yaml and shows it will create:
       - linkledger-db (PostgreSQL)
       - linkledger (Web Service)
    Give the blueprint a name if asked (e.g. "linkledger"). Click "Apply"
    (or "Create Resources").
14. Render starts building. Wait for the web service to show "Live"
    (first build ~3-5 min). It auto-connects the database and generates
    JWT_SECRET and GEO_CRON_TOKEN for you.
15. Click the web service name -> copy its URL at the top
    (looks like https://linkledger.onrender.com). This is your app URL.

================================================================
PART C - Add your keys (Environment tab)
================================================================
16. In the web service, click the "Environment" tab on the left.
17. Click "Add Environment Variable" and add each of these (Key = Value):
       GOOGLE_CLIENT_ID      = (your Google client id)
       GOOGLE_CLIENT_SECRET  = (your Google client secret)
       GSC_SITE_URL          = sc-domain:solguruz.com
       GSC_REFRESH_TOKEN     = (your GSC refresh token)
       PAGESPEED_API_KEY     = (your PageSpeed key)
       PAGESPEED_URL         = https://solguruz.com/
       LINKEDIN_CLIENT_ID    = (your LinkedIn client id)
       GOOGLE_REDIRECT_URI   = https://YOUR-APP.onrender.com/api/gmail/callback
       GSC_REDIRECT_URI      = https://YOUR-APP.onrender.com/api/google/callback
    (Replace YOUR-APP with your real URL from step 15.)
18. Click "Save Changes". Render will redeploy automatically.

================================================================
PART D - Tell Google about the redirect URLs (one-time)
================================================================
19. Go to console.cloud.google.com -> APIs & Services -> Credentials.
20. Click your OAuth 2.0 Client (the one whose ID you used above).
21. Under "Authorized redirect URIs", click "Add URI" twice and add EXACTLY:
       https://YOUR-APP.onrender.com/api/gmail/callback
       https://YOUR-APP.onrender.com/api/google/callback
    (No trailing slash. They must match step 17 character-for-character.)
22. Click "Save".

================================================================
PART E - First run
================================================================
23. Back in Render, the web service should be "Live". Open the URL.
24. On the boot Logs (Logs tab) you should see lines like:
       [migrate] applied 001_core.sql ... 012_prospects.sql
       [boot] LinkLedger listening on :10000
    This first boot also seeds your 202 verified link rows automatically.
25. In the app, click "Create the team account", enter your work email +
    a password, and sign in. Your dashboard, prospects, link health, and
    backlink analysis are all populated with your real data.
26. Go to Tools (or My Account) -> click "Connect Gmail" once and approve,
    so the tool can send mail. GSC + PageSpeed already work.

================================================================
If something goes wrong
================================================================
- Build failed: open the "Logs" tab, copy the red error, send it to me.
- "redirect_uri_mismatch" when connecting Google: the env var in step 17 and
  the URI in step 21 don't match exactly - fix to be identical.
- App loads but no data: check Logs for a migration error; confirm
  DATABASE_URL exists (the Blueprint sets it automatically).
- Free database note: Render's free Postgres is fine for the demo; for
  long-term use, upgrade the database plan so it isn't paused.
