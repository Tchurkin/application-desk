# Import from Google Drive: one-time setup

The Import page can read essays straight from a student's Google Drive: they pick the docs in
Google's own file picker, and every tab of a doc becomes its own piece. It asks only for access to
the files they pick (the `drive.file` scope, which Google does not require an app review for), and
everything happens in the student's browser: the docs never pass through this site's server.

It needs a free Google Cloud project with three values. Without them the Import page still
works with uploaded Word files, Drive folder downloads (.zip) and pasted text.

## Steps (about five minutes)

1. Open [console.cloud.google.com](https://console.cloud.google.com), sign in, and create a
   project (for example "Application Desk").
2. **APIs & Services → Library**: enable **Google Docs API** and **Google Picker API**.
3. **Google Auth Platform** (or **OAuth consent screen**):
   - Branding: an app name and a support email.
   - Audience: **External**. Publish the app (with only `drive.file` there is no review), or,
     while testing, add the Google accounts that may use it as test users.
   - Data access: add the scope `https://www.googleapis.com/auth/drive.file`.
4. **Clients → Create client** (or **Credentials → Create credentials → OAuth client ID**):
   - Type: **Web application**.
   - Authorized JavaScript origins: your site, e.g. `https://application-desk-seven.vercel.app`,
     and `http://localhost:3000` for local development. No redirect URI is needed.
   - Copy the **Client ID**.
5. **Credentials → Create credentials → API key**. Restrict it: application restriction
   **Websites** with your site's address (e.g. `https://application-desk-seven.vercel.app/*`), and
   API restriction **Google Picker API**. Copy the key.
6. The **project number** is on the project's dashboard (or **IAM & Admin → Settings**).
7. Add them to the site's environment (Vercel: Project → Settings → Environment Variables; locally:
   `.env.local`), then redeploy:

   ```
   NEXT_PUBLIC_GOOGLE_CLIENT_ID=<client id>
   NEXT_PUBLIC_GOOGLE_API_KEY=<api key>
   NEXT_PUBLIC_GOOGLE_APP_ID=<project number>
   ```

These values are public by design (they ship in the page); what protects students' files is
Google's sign-in, which only ever grants access to the docs they pick.

## What students do

Import → **Choose from Google Drive** → sign in → open their essays folder → Shift-click to pick
several docs (a folder itself can't be picked: Google only shares the files chosen) → **Select**.
Each doc, or each tab of a doc with tabs, shows up in the list, matched to a college and piece.
