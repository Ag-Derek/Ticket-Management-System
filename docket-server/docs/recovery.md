# Backups and recovery

Docket runs on the Supabase free plan, which has no automatic backups and pauses projects after low activity over 7 days. A scheduled job on one PC is the only backup, and because it reads real tables every night, it also keeps the project active.

Each backup is one encrypted `.backup` file with the database and the attachment files. It's saved on the PC, with a second copy in OneDrive. Passwords aren't included: the admin password is recreated from `ADMIN_PASSWORD`.

## What to do when something goes wrong

| Alert or problem | What to do |
|---|---|
| UptimeRobot says the API is down | Check the Render logs and the Supabase dashboard, then use the sections below. |
| Supabase project is paused | Restore it from the Supabase dashboard. Docket reconnects by itself within about 30 seconds. |
| Heartbeat says no backup for 2 days | Turn on the PC and check `C:\DocketBackups\backup.log`. Run a backup by hand. |
| Supabase project is lost | Follow "Rebuild from a backup". |

## Set up nightly backups

Do this once, on the PC that will run the backups.

**1. Create the folders**

```powershell
New-Item -ItemType Directory -Force C:\DocketBackups, "$env:USERPROFILE\OneDrive\DocketBackups"
```

Don't put either folder inside the repo.

**2. Create the keys**

From `docket-server`:

```powershell
npm run backup -- keygen --out C:\DocketBackups\keys
```

1. Save `docket-backup-private.pem` in your password manager.
2. Delete that private key file from the PC.
3. Keep `docket-backup-public.pem` where it is.

Without the private key, no backup can be read. If it's lost, make new keys and treat older backups as gone.

**3. Create the heartbeat**

On Healthchecks.io, or a similar service, create a check with a period of 1 day and a grace time of 1 day. Send its alerts to a monitored inbox and copy its ping URL.

**4. Add settings to `docket-server/.env`**

The file already needs `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_STORAGE_BUCKET`. Add:

```
BACKUP_PUBLIC_KEY_FILE=C:\DocketBackups\keys\docket-backup-public.pem
BACKUP_DIR=C:\DocketBackups
BACKUP_COPY_DIR=C:\Users\<you>\OneDrive\DocketBackups
BACKUP_RETENTION_DAYS=30
BACKUP_HEARTBEAT_URL=<ping URL from step 3>
```

**5. Run one by hand**

```powershell
npm run backup -- create
```

The heartbeat should turn green, and a `.backup` file should appear in both folders.

**6. Schedule it**

In PowerShell, from `docket-server`:

```powershell
$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument '/c node scripts\backup.js create >> C:\DocketBackups\backup.log 2>&1' -WorkingDirectory (Get-Location).Path
$trigger = New-ScheduledTaskTrigger -Daily -At 2am
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName 'Docket backup' -Action $action -Trigger $trigger -Settings $settings
```

`-StartWhenAvailable` runs the backup when the PC next turns on if it was off at 2am. The task runs while you're signed in to Windows.

## Check a backup

This needs only the file and the private key, not the database or Storage. It reports the row counts and confirms the file is complete and unaltered.

```powershell
npm run backup -- check C:\DocketBackups\<file>.backup --key <private key file>
```

## Rebuild from a backup

Restore replaces all data in the target database. Restore the private key to a temporary file outside the repo and delete it when you've finished.

1. Create a new Supabase project and a **private** Storage bucket with the same name as `SUPABASE_STORAGE_BUCKET`.
2. Point `docket-server/.env` at the new project: `DATABASE_URL`, `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
3. Check the newest backup, using the command above.
4. Restore it, using the database host from the new `DATABASE_URL`:
   ```powershell
   npm run backup -- restore <file>.backup --key <private key file> --confirm <database host>
   ```
   The command prints the host to use if you leave out `--confirm`. If Storage isn't ready, add `--skip-attachments` to restore only the database, then rerun without it later.
5. Update these on Render, then redeploy:
   - `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET`
   - `AUTH_TOKEN_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, `APP_URL`, `CORS_ORIGINS`
   - `ADMIN_EMAIL`, and `ADMIN_PASSWORD` (at least 12 characters), which recreates the admin sign-in
6. Confirm the recovery:
   - `/api/health` returns 200.
   - The admin can sign in.
   - A ticket opens with its comments.
   - An attachment downloads.
7. Update `DATABASE_URL` and the Supabase settings in `docket-server/.env` so nightly backups read from the new project.

## Test the restore

Run this every few months, and after any schema change. Use a spare Supabase project, never production, and follow "Rebuild from a backup" through step 4, then check the row counts and an attachment.
