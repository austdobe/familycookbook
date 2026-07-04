# TODO

## Firebase Rules Deployment

Firestore rules were updated locally, but deployment is blocked by missing Google Cloud IAM permissions.

Project: `familycookbook-d7c0d`  
Account: `doberfamilyventures@gmail.com`

### Required IAM Change

In Google Cloud IAM for `familycookbook-d7c0d`, grant:

- Role: `Service Usage Consumer`
- Permission included: `serviceusage.services.use`

Direct IAM page:

```text
https://console.developers.google.com/iam-admin/iam?project=familycookbook-d7c0d
```

### After IAM Is Updated

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

### Current Intended Data Flow

- Recipes remain Markdown-first.
- Grocery and prep lists can migrate to Firestore because they are dynamic weekly working lists.
- App falls back to Markdown-generated grocery/prep data until Firebase migration succeeds.
- Grocery checked items and manual grocery additions should remain in Firestore week state.
