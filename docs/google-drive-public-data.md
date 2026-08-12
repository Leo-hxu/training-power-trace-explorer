# Google Drive data setup

The public site is hosted by GitHub Pages. All trace records are loaded at run
time from Google Drive; no JSON or CSV trace data is deployed with the site.

## One-time Google setup

1. Create a Google Cloud project and enable **Google Drive API**.
2. Create a browser API key restricted to:
   - API restriction: Google Drive API
   - Website restriction: `https://leo-hxu.github.io/*`
3. Create an empty Google Drive folder for the public dataset. The migration
   script will add `runs`, `metadata`, and `raw` subfolders.
4. Obtain a short-lived OAuth access token with Google Drive write permission.
   Keep it only in your terminal environment; do not commit or paste it into
   GitHub.

## Migrate the current public traces

Run the following from the repository while the original `github-pages/public-data`
folder is still present locally:

```bash
node scripts/migrate_public_data_to_drive.mjs --dry-run

GOOGLE_DRIVE_ACCESS_TOKEN="..." \
GOOGLE_DRIVE_PARENT_FOLDER_ID="..." \
node scripts/migrate_public_data_to_drive.mjs
```

The script uploads every catalog record, detail JSON, metadata JSON, and raw
CSV. It makes every uploaded file public read-only and prints the catalog file
ID when complete.

## Configure GitHub Pages

In **GitHub repository → Settings → Secrets and variables → Actions → Variables**,
add these repository variables:

| Variable | Value |
| --- | --- |
| `GOOGLE_DRIVE_API_KEY` | Browser-restricted API key from Google Cloud |
| `GOOGLE_DRIVE_CATALOG_FILE_ID` | Value printed by the migration script |

The API key is intentionally included in the browser bundle because visitors
need it to read the public Drive files. It must have no write privileges and be
restricted to the GitHub Pages referrer above. OAuth credentials and migration
access tokens are never included in the website or GitHub.

After the variables are set, deploy the commit that removes
`github-pages/public-data` from Git tracking. The existing visual interface,
charts, filtering, raw-data table, and downloads then read from Google Drive.

## Ongoing updates

When adding a new trace, run the same migration with the updated local dataset,
then replace the two GitHub variables with the catalog file ID printed by the
new migration. A later upload-and-review workflow can automate this process
without changing the public viewer.
