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

These settings keep logs from filling a host's disk:

- **Container logs.** Every compose template shares an `x-logging` anchor:
  the `json-file` driver, rotated at `docker_log_max_size` (50m) and kept for
  `docker_log_max_file` (5) files. A changed compose file recreates its
  containers on the next `docker compose up -d`, so the limits apply on the
  next deploy without restarting the Docker daemon.
- **journald.** The base role caps the journal at `journald_system_max_use`
  (500M) and `journald_max_retention` (1 month).
- **HappyView.** `RUST_LOG` defaults to `info`, since HappyView's own default
  is `debug`. `EVENT_LOG_RETENTION_DAYS` sets how long rows stay in
  `happyview_event_logs`.
- **Disk alert.** Set `disk_alert_webhook_url` on a host to turn on a systemd
  timer that posts to Discord when a filesystem passes
  `disk_alert_threshold_percent` (85). It can also watch file freshness
  (`disk_alert_freshness_checks`), for example the newest Postgres backup.
