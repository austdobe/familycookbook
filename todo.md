# TODO

## Firebase Status

Firestore rules have been deployed for:

- `groceryWeeks`
- `prepWeeks`
- `weeklyPlans`
- `workingWeeks`
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
- App-created planning weeks live in Firebase `workingWeeks`.
- Grocery and prep state live in Firebase week documents.
- App falls back to local device storage when Firebase is unavailable.
