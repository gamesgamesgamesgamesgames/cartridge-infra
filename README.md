# cartridge-infra

Consolidated Ansible infrastructure for all atproto services:

- **appview** — HappyView app server (gamesgamesgamesgames.games)
- **pds** — Bluesky Personal Data Server + observability stack
- **moderation** — Osprey moderation system
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
