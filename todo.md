# TODO

## Firebase Status

Firestore rules have been deployed for:

- `groceryWeeks`
- `prepWeeks`
- `weeklyPlans`
- `workingWeeks`
- `weeks`
- `recipeFeedback`

Project: `familycookbook-d7c0d`

Markdown weeks have been migrated into Firebase:

- `2026-week-29`
- `2026-week-28`

### Maintenance Commands

Deploy Firestore rules:

```bash
firebase.cmd deploy --only firestore:rules
```

Then migrate generated weekly grocery/prep lists into Firestore:

```bash
npm.cmd run migrate:firebase
```

Optional dry run:

```bash
npm.cmd run migrate:firebase -- --dry-run
```

### Current Data Flow

- Recipes remain Markdown-first.
- New generated recipes should start in `recipe-archive/drafts/`.
- App-created planning weeks save operational snapshots to Firebase.
- Unified week snapshots live in Firebase `weeks/{weekId}`.
- Grocery and prep state also remain available in week-specific Firebase documents for the current UI.
- Grocery/prep snapshots should not live-recalculate from Markdown after week creation.
- App falls back to local device storage when Firebase is unavailable.
