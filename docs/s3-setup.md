# Setting up S3 for case files

Case files (the sections of a fact pattern: PDFs, text, images, audio, video) are stored in an
Amazon S3 bucket, not in Postgres. The browser uploads each file straight to S3 through a
short-lived signed link the API hands out, and downloads come from S3 through another signed
link, so large files never pass through the Heroku dyno (which would time out after 30 seconds).

Without S3 settings, the app keeps files in a local `.storage/` folder instead. That's the
default for local development and tests. **Production refuses to start without S3**, because
Heroku's disk is wiped on every restart.

You need an AWS account. The steps below take about 15 minutes in the AWS console.

## 1. Pick a region

Any US region works; this project's bucket is in **US East (Ohio), `us-east-2`**. Whatever you
pick, **`AWS_REGION` must match the bucket's region**. If it doesn't, S3 answers every request with
`301 PermanentRedirect` and `npm run storage:check` fails. (Heroku's US apps run in `us-east-1`,
but students download files straight from S3, so the region barely matters.)

## 2. Create the bucket

S3 → **Create bucket**:

| Setting | Value |
| --- | --- |
| Bucket type | General purpose |
| Bucket name | Globally unique and lowercase, e.g. `trial-advocacy-case-files-<your initials>` |
| Object Ownership | ACLs disabled (the default) |
| Block Public Access | **Keep all four boxes checked.** The bucket stays private; signed links still work. |
| Bucket Versioning | Disable (enable it if you want deleted files to be recoverable; it costs more storage) |
| Default encryption | SSE-S3 (the default) |

**Optional, recommended:** create a second bucket the same way with a `-dev` suffix for local
development, so testing on your laptop never touches the files students use.

## 3. Allow the app's pages to upload (CORS)

Uploads come from the browser, so the bucket has to accept requests from the app's address.
Bucket → **Permissions** → **Cross-origin resource sharing (CORS)** → Edit, and paste the JSON
below. Replace the Heroku address with yours. For a `-dev` bucket, keep only the localhost
entries.

```json
[
  {
    "AllowedOrigins": ["https://YOUR-APP.herokuapp.com", "http://localhost:5173"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["content-type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

Downloads are ordinary link clicks, so they don't need a CORS rule.

## 4. Clean up abandoned uploads

An upload first lands under `uploads/` and is moved to `cases/` once the app confirms it. If
someone closes the tab mid-upload, the file stays under `uploads/`. A lifecycle rule deletes
those after a day.

Bucket → **Management** → **Create lifecycle rule**:

- Name: `expire-unfinished-uploads`
- Scope: limit to a prefix, **`uploads/`**
- Action: **Expire current versions of objects** after **1** day

## 5. Create a policy that only allows this bucket

IAM → **Policies** → **Create policy** → JSON. Paste this, replacing `BUCKET-NAME` in both places:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "CaseFiles",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::BUCKET-NAME/*"
    },
    {
      "Sid": "TellMissingFromForbidden",
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::BUCKET-NAME"
    }
  ]
}
```

Name it `trial-advocacy-case-files`. `ListBucket` is needed so S3 answers "not found" rather than
"forbidden" when the app checks an upload that never finished. If you made a `-dev` bucket, add
its two ARNs to the same lists.

## 6. Create the app's user and access key

IAM → **Users** → **Create user**:

1. Name: `trial-advocacy-app`. Leave console access **off**: this user is only for the app.
2. Permissions: **Attach policies directly** → select `trial-advocacy-case-files` → Create user.
3. Open the user → **Security credentials** → **Create access key** → use case **Application
   running outside AWS** → Create.
4. Copy the **Access key ID** and **Secret access key** into a password manager now. The secret is
   shown only once.

Never commit these keys or paste them into chat, issues, or screenshots. If one leaks, deactivate it
under Security credentials and create a new one.

## 7. Give the app the settings

**Heroku** (production bucket):

```bash
heroku config:set S3_BUCKET=BUCKET-NAME AWS_REGION=us-east-2 AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=...
```

**Local development** (optional; without these, files go to `.storage/`). Add to `.env.local`,
which is git-ignored, ideally pointing at the `-dev` bucket:

```bash
S3_BUCKET=BUCKET-NAME-dev
AWS_REGION=us-east-2
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
```

Files already uploaded locally stay in `.storage/` and won't be found once you switch a machine
to S3, so re-upload them or re-run `npm run db:seed` on a fresh database.

## 8. Check it

```bash
npm run storage:check
```

This uploads a throwaway file through a signed link, checks its size, moves it, downloads it
through a signed link, and deletes it. On Heroku, run `heroku run npm run storage:check`. Then
upload a file from a case's **Case file** tab to confirm the CORS rule. A "Could not reach file
storage" error there means the page's address is missing from `AllowedOrigins`.

## 9. Moving files that are still in Postgres

`npm run storage:migrate` copies any case files still stored in the database into storage and
clears them from the database. Heroku runs it on every release, after the schema migration, and it
skips files already moved.

## What it costs

S3 Standard storage is about $0.023 per GB per month, and the requests this app makes cost
fractions of a cent. A course's worth of case files is a few GB at most. New AWS accounts get 5 GB
free for 12 months. Setting a small monthly budget alert under **Billing → Budgets** is still a good
idea.
