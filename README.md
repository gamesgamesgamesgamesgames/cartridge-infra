# cartridge-infra

Consolidated Ansible infrastructure for all atproto services:

- **appview** — HappyView app server (gamesgamesgamesgames.games)
- **pds** — Bluesky Personal Data Server + observability stack
- ~~**moderation** — Osprey moderation system~~ (retired 2026-09-01; the host
  was repurposed for the HappyProto platform. The playbook and templates are
  kept for reference but are no longer targeted by any inventory.)
- **meilisearch** — Search index

Replaces the separate `appview-infra`, `pds-infra`, `moderation-infra`, and
`meilisearch-infra` repositories.

## Layout

```
ansible.cfg
inventory.yml              # All four hosts (gitignored)
inventory.yml.example
group_vars/                # (optional) shared across all hosts
host_vars/                 # Per-host config (gitignored)
  appview/
    main.yml
    secrets.yml            # vault-encrypted
  pds/
  moderation/
  meilisearch/
host_vars_example/         # Tracked examples for each host
roles/
  base/                    # Swap, UFW, Docker, unattended-upgrades
playbooks/
  site.yml                 # Run every service
  appview.yml              # Full provision of the appview host
  appview-deploy.yml       # Fast redeploy (templates + docker compose up)
  appview-migrate-sqlite.yml
  pds.yml
  moderation.yml
  meilisearch.yml
templates/
  appview/ pds/ moderation/ meilisearch/
files/
  pds/ moderation/
```

## Getting started

1. Copy the inventory and fill in real IPs:

   ```
   cp inventory.yml.example inventory.yml
   ```

2. For each host, copy its example vars into place and fill in values:

   ```
   mkdir -p host_vars/appview
   cp host_vars_example/appview.main.yml host_vars/appview/main.yml
   cp host_vars_example/appview.secrets.yml host_vars/appview/secrets.yml
   ```

   Repeat for `pds`, `moderation`, `meilisearch`.

3. Create a `.vault-pass` file containing the vault password, then encrypt
   your secrets files:

   ```
   ansible-vault encrypt host_vars/appview/secrets.yml
   ```

## Running playbooks

Deploy a single service:

```
ansible-playbook playbooks/appview.yml
ansible-playbook playbooks/pds.yml
ansible-playbook playbooks/moderation.yml
ansible-playbook playbooks/meilisearch.yml
```

Fast redeploy (appview only, no system setup):

```
ansible-playbook playbooks/appview-deploy.yml
```

Provision everything in one shot:

```
ansible-playbook playbooks/site.yml
```

## Disk and log retention

These settings keep logs and backups from filling the appview's disk:

- **Container logs.** The appview and ClickHouse compose templates share an
  `x-logging` anchor: the `json-file` driver, rotated at `docker_log_max_size`
  (50m) and kept for `docker_log_max_file` (5) files. A changed compose file
  recreates its containers on the next `docker compose up -d`, so the limits
  apply on the next deploy without restarting the Docker daemon. The other
  hosts' compose files don't have it yet.
- **journald, disk alert and backup checks** for the appview live in
  `playbooks/appview-host-tasks.yml`, which `appview.yml` and
  `appview-deploy.yml` include. They aren't in `roles/base` because a change
  there triggers every host's deploy workflow.
  - journald is capped at `journald_system_max_use` (500M) and
    `journald_max_retention` (1 month).
  - Setting `disk_alert_webhook_url` (CI: the `APPVIEW_DISK_ALERT_WEBHOOK_URL`
    secret) turns on a systemd timer. It posts to Discord when a filesystem
    passes `disk_alert_threshold_percent` (85), or when the newest
    `happyview_*.sql.gz` is older than `pg_backup_max_age_hours` (26).
  - The play fails unless `pg_backup_dir` is a mount point. `pg-backup.sh`
    publishes a dump only after it is complete, passes `gzip -t` and is at
    least `pg_backup_min_bytes` (1 MiB).
- **HappyView.** `RUST_LOG` defaults to `info`, since HappyView's own default
  is `debug`. `EVENT_LOG_RETENTION_DAYS` sets how long rows stay in
  `happyview_event_logs`. A value set in the dashboard
  (`happyview_instance_settings`) overrides the env var.
  `JOB_WORKER_CONCURRENCY` (var `happyview_job_worker_concurrency`) defaults
  to 2 here rather than HappyView's 1, so a long auto-accept sweep doesn't
  hold up the per-contribution jobs. HappyView clamps it to 1–32.

## Scheduled maintenance

HappyView can't schedule jobs yet (HAP-187), so `.github/workflows/maintenance.yml` queues the weekly ones:

| When (UTC) | Task | Queues |
|---|---|---|
| Sun 03:00 | `weekly-signals` | `syncWikidata`, then `refreshPublisherCounts` |
| Mon 03:00 | `weekly-search` | `reindexSearchGames` over every game |

Run either one by hand with **Run workflow**, which defaults to a dry run.

**How it connects.** Each run opens one SSH connection to appview, with its own key, and never retries: Hetzner bans addresses that open too many connections. `playbooks/sync.yml` installs that key in root's `authorized_keys`, pinned with `command="/usr/local/bin/cartridge-maintenance-trigger",restrict`. The trigger accepts only the two task names (each optionally with `--dry-run`) and runs `src/maintenance.ts` in `/opt/igdb-scrape`. That script uses the sync account's stored HappyView session, so no HappyView credential lives in GitHub. Output is appended to `/var/log/igdb-scrape/maintenance.log`.

**Setup.** The public half of the key is `files/sync/maintenance_key.pub`, and the private half is the secret `APPVIEW_MAINTENANCE_SSH_KEY`. To rotate the key, replace both. The remaining one-time steps:
1. Add the secret `APPVIEW_KNOWN_HOSTS`: appview's host key lines, in known_hosts format, keyed by the address in `APPVIEW_SERVER_IP`. Take them from your own `~/.ssh/known_hosts` (`ssh-keygen -F <appview ip>`), so the workflow never has to run `ssh-keyscan`.
2. Run **Deploy sync**, which installs the trigger and the key.
3. In HappyView, set the script variable `MAINTENANCE_DIDS` to the sync account's DID.
4. Run **Scheduled maintenance** by hand with a dry run, once for each task.
