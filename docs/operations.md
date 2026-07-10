# Operations

## Local Development

Install dependencies:

```text
npm.cmd install
```

Run the Vite app:

```text
npm.cmd run dev
```

Build production assets:

```text
npm.cmd run build
```

Preview a production build:

```text
npm.cmd run preview
```

## Generated App Data

Rebuild `public/data/cookbook.json` from Markdown:

```text
npm.cmd run build:app
```

The build script updates `generatedAt`. Do not commit timestamp-only changes unless the generated data content changed intentionally.

## Firebase Configuration

The app reads Firebase configuration from Vite environment variables:

```text
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_FIREBASE_HOUSEHOLD_ID=family
```

If Firebase is unavailable or not configured, stores fall back to localStorage.

Deploy Firestore rules:

```text
firebase.cmd deploy --only firestore:rules
```

Current rules in `firestore.rules` are prototype rules scoped to the `family` household string. They do not enforce authenticated household membership.

## Deployment

Build for GitHub Pages:

```text
npm.cmd run build:pages
```

Deploy through the project deployment script:

```text
npm.cmd run deploy:pages
```

The GitHub Pages workflow also injects Firebase config from repository secrets.

## Data Migration And Import

Import recipes to Firebase:

```text
npm.cmd run import:recipes
```

Migrate week lists to Firebase:

```text
npm.cmd run migrate:firebase
```

Use dry-run modes when supported by the script before writing shared data.

## Print Export

Export a weekly folder to HTML/PDF:

```text
npm.cmd run export:pdf -- weekly-plans/2026/week-28
```

Export one Markdown file:

```text
npm.cmd run export:pdf -- weekly-plans/2026/week-28/week-28-family-cookbook-packet.md
```

## Feedback Scripts

Apply explicit feedback arguments to a Markdown recipe:

```text
npm.cmd run apply:feedback -- --file recipe-archive/chicken/example.md --version 2.0 --rating 5/5 --notes "Family liked it" --change "Added family notes"
```

Sync Firebase feedback into Markdown:

```text
npm.cmd run sync:feedback
```

The app can store feedback directly. These scripts are for explicit Markdown/export maintenance.

## Recommended Verification

Before pushing app changes:

```text
npm.cmd run build
```

Before committing generated data, inspect:

```text
git diff -- public/data/cookbook.json
```
