# MyClash — Pre-Deploy Checklist

> Concrete, ordered checklist of everything that must happen **before the first production deploy**.
>
> This is a flattened, ordered view of `docs/OWNER_TASKS.md` filtered to what blocks a green deploy. Do these in order. Each takes between 5 minutes and 2 hours.

**Domain:** `myclash.fr`
**VPS:** OVH (TBD spec — see step 4)

---

## Phase 1 — Identity & accounts (Day 1, ~2h total)

These can be done in parallel; finish all before moving to Phase 2.

### ☐ 1. Register `myclash.fr`
- **Where**: OVH (you already use them) or Gandi.
- **Cost**: ~€7–9/year for `.fr`.
- **Output**: domain in your account, DNS not yet pointed anywhere.

### ☐ 2. Create the GitHub repo `MyClash`
- **Settings**: public, AGPL-3.0 license, README on init.
- **Branch protection on `main`**: require PR review, require CI green, no force-push.
- **Enable**: Discussions, Dependabot (npm + GitHub Actions).
- **Generate a deploy key** (SSH keypair) for the VPS to clone the repo:
  ```powershell
  ssh-keygen -t ed25519 -C "myclash-deploy" -f $HOME\.ssh\myclash_deploy_ed25519
  ```
  Add the **public key** to GitHub repo → Settings → Deploy keys (read-only is fine).
  Keep the **private key** for the VPS bootstrap step.

### ☐ 3. Push the initial repo content
- Drop the entire generated tree (`AGENTS.md`, `myclash.md`, `docs/`, `memory/`, `infra/`, `scripts/`, `.env.example`, `.gitignore`, `.gitattributes`, `.env.deploy.example`) into `F:\Github Repo\MyClash`.
- `git init && git add -A && git commit -m "Initial spec and infra reference" && git push`.

---

## Phase 2 — VPS provisioning (Day 1–2, ~3h)

### ☐ 4. Order an OVH VPS
- **Recommended**: VPS Comfort or VPS Elite — 4 vCPU, 8 GB RAM, 80 GB NVMe SSD.
- **Image**: Ubuntu 24.04 LTS.
- **Region**: closest to you (Gravelines / Strasbourg / Roubaix).
- **Cost**: ~€15–20/month.
- **Why this size**: Postgres + Redis + 5 Node services + Traefik + Supabase services. 4 GB RAM works for v1 launch but leaves no headroom; 8 GB is the comfort margin you want when an event runs.

### ☐ 5. Initial VPS hardening
SSH in as root, then:
```bash
# Create deploy user
adduser deploy
usermod -aG sudo,docker deploy   # docker group will exist after step 6

# SSH key auth only
mkdir -p /home/deploy/.ssh
# paste your local public SSH key into /home/deploy/.ssh/authorized_keys
chmod 700 /home/deploy/.ssh && chmod 600 /home/deploy/.ssh/authorized_keys
chown -R deploy:deploy /home/deploy/.ssh

# Disable root SSH and password auth
sed -i 's/#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart ssh

# UFW firewall
apt update && apt install -y ufw fail2ban
ufw default deny incoming && ufw default allow outgoing
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp
ufw enable
systemctl enable --now fail2ban

# Unattended security upgrades
apt install -y unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades
```

### ☐ 6. Install Docker on the VPS
```bash
# Docker official repo
curl -fsSL https://get.docker.com | sh
usermod -aG docker deploy
```

### ☐ 7. Test SSH from your Windows machine as the `deploy` user
```powershell
ssh -i $HOME\.ssh\myclash_ed25519 deploy@<VPS-IP>
```
If this works, root SSH is disabled, and `docker ps` works (no `sudo` needed), this phase is done.

---

## Phase 3 — DNS (Day 2, ~30min + propagation wait)

### ☐ 8. Point DNS at the VPS
At your registrar's DNS panel, add **A records**:

| Host | Type | Value | TTL |
|---|---|---|---|
| `myclash.fr` | A | `<VPS-IP>` | 300 |
| `api.myclash.fr` | A | `<VPS-IP>` | 300 |
| `admin.myclash.fr` | A | `<VPS-IP>` | 300 |
| `scoring.myclash.fr` | A | `<VPS-IP>` | 300 |
| `www.myclash.fr` | CNAME | `myclash.fr` | 300 |

If you anticipate per-event subdomains later (`fal2026.myclash.fr`), also add a wildcard A record: `*` → `<VPS-IP>`.

### ☐ 9. Verify DNS propagation
From your Windows machine:
```powershell
nslookup myclash.fr
nslookup api.myclash.fr
nslookup admin.myclash.fr
nslookup scoring.myclash.fr
```
All four should return your VPS IP. Allow up to 1h for global propagation. **Do not proceed to Phase 5 (first deploy) until all four resolve correctly** — Let's Encrypt will fail otherwise.

---

## Phase 4 — Third-party accounts (Day 2–3, ~2h)

Can be done in parallel.

### ☐ 10. Email provider (SMTP for auth magic links)
- **Recommended**: Resend (3000 emails/month free, EU region).
- **Steps**:
  1. Sign up at resend.com.
  2. Add `myclash.fr` as a sending domain.
  3. Add the DNS records they generate (SPF, DKIM, DMARC) to your DNS panel.
  4. Verify the domain in Resend (takes 5–60 min depending on DNS).
  5. Generate an API key.
- **You'll need**: API key for `SMTP_PASS` in `.env`. `SMTP_HOST=smtp.resend.com`, `SMTP_PORT=587`, `SMTP_USER=resend`.

### ☐ 11. Google OAuth — **SKIP for v1**
- Deferred to v1.1. Magic-link auth (via Resend, step 10) covers the same use case.
- The Google OAuth verification process can take 2–4 weeks; not worth gating launch on.
- See O-008 in `docs/OWNER_TASKS.md` for v1.1 setup steps when you're ready.

### ☐ 12. Off-site backup target (Backblaze B2 recommended)
- **Cost**: ~€2/month at v1 scale.
- **Steps**:
  1. Sign up at backblaze.com.
  2. Create a private bucket named `myclash-backups`.
  3. Generate an Application Key with write access to the bucket only.
- **You'll need**: Bucket name + key for `.env` (`BACKUP_S3_BUCKET=myclash-backups`).
- **Tooling**: Install `rclone` on the VPS (the agent will do this in T-055 VPS bootstrap).

### ☐ 13. (Optional) Sentry account for error tracking
- **Cost**: Free tier covers v1.
- **Steps**: Sign up, create a project per app (api, web-public, web-scoring, web-admin), grab DSN per project.
- **You'll need**: 4 DSNs for `.env` (one per service).
- **Skippable**: Can be added in P14 (polish) instead of pre-launch.

---

## Phase 5 — Secrets generation (Day 3, ~30min)

Generate all the secrets that go into `.env`. Do this on your Windows machine, store the output in your password manager **before** putting them in `.env`.

### ☐ 14. Generate Supabase keys
PowerShell:
```powershell
# JWT secret (any random 32+ byte secret)
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# SECRET_KEY_BASE for Supabase Realtime (Phoenix requirement: 64+ bytes)
node -e "console.log(require('crypto').randomBytes(64).toString('base64'))"
```

For `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` — these are JWTs signed by `SUPABASE_JWT_SECRET`. The agent will generate these from a script in T-007 (Supabase services setup), so leave the placeholders in `.env` for now and the deploy script will fill them in.

### ☐ 15. Generate Postgres password
```powershell
node -e "console.log(require('crypto').randomBytes(24).toString('base64'))"
```
Goes into `POSTGRES_PASSWORD`.

### ☐ 16. Generate VAPID keys (for web push)
**Skip this** — `infra/scripts/deploy.sh` auto-generates these on first deploy. They'll appear in your `.env` after the first run.

---

## Phase 6 — First deploy (Day 3–4, ~1h)

### ☐ 17. Clone the repo on the VPS (one-time)
```bash
ssh deploy@myclash.fr
sudo mkdir -p /srv/myclash && sudo chown deploy:deploy /srv/myclash
cd /srv/myclash
git clone git@github.com:<your-username>/MyClash.git .
# (using the deploy key you generated in step 2)
```

### ☐ 18. Create `.env` on the VPS
```bash
cp .env.example .env
nano .env
# Fill in:
#   - DOMAIN=myclash.fr   (compose computes app./admin./api./scoring. itself)
#   - LETSENCRYPT_EMAIL=webmaster@myclash.fr  (or your address)
#   - POSTGRES_PASSWORD=<from step 15>
#   - SUPABASE_JWT_SECRET=<from step 14>
#   - SUPABASE_REALTIME_SECRET=<from step 14>
#   - MYCLASH_GUEST_JWT_SECRET=<from step 15>
#   - SMTP_HOST/USER/PASS=<from step 10>
```

### ☐ 19. **Deploy with staging certs first**
Avoids burning Let's Encrypt rate limits if something's broken. Run this **on the VPS**:
```bash
ssh deploy@myclash.fr
cd /srv/myclash
bash infra/scripts/deploy.sh --dev-certs
```
- TLS will use Let's Encrypt staging (cert won't be trusted by browsers — fine, just confirms the flow works).
- Watch the streamed output for errors.
- If something breaks, fix and re-run. The staging endpoint allows 30,000 requests/hour vs. production's 5/hour for failures.

### ☐ 20. Verify all services healthy
On the VPS (still SSH'd in):
```bash
bash infra/scripts/status.sh
```
All services should show `healthy` or `running`. If any are red, check logs.

### ☐ 21. **Switch to production certs**
Once staging works:
```bash
# Wipe staging acme.json and re-deploy with prod certs
rm -f data/traefik/acme.json && touch data/traefik/acme.json && chmod 600 data/traefik/acme.json
bash infra/scripts/deploy.sh
```
Wait ~30 seconds for Traefik to issue real certificates. Then from your laptop:
```
curl -I https://myclash.fr
curl -I https://app.myclash.fr
curl -I https://api.myclash.fr/health
curl -I https://admin.myclash.fr
curl -I https://scoring.myclash.fr
```
All should return `HTTP/2 200`.

### ☐ 22. **Test the restore drill** (yes, before real users)
This is the most important pre-launch step. Without testing restore, your backups are theoretical.
```bash
# On the VPS:
bash infra/scripts/backup.sh
ls -lh /srv/myclash/backups/nightly/

# Optional but recommended: stand up a throwaway VM, copy the backup, run restore.sh against it
```

---

## Phase 7 — Pre-launch validation (Week before beta event)

### ☐ 23. Run `bash infra/scripts/deploy.sh` end-to-end with no errors
Three times in a row, on three different days. Catches "works the first time then mysteriously breaks" issues.

### ☐ 24. Test rollback
```bash
# After making a small intentional change and deploying:
bash infra/scripts/rollback.sh
# Confirm services come back on the previous commit.
```

### ☐ 25. Push notification end-to-end test
- Visit `https://myclash.fr` on a phone, log in, accept push notification permission.
- From admin or via API, send a test notification.
- Confirm it arrives within 5 seconds.

### ☐ 26. Tablet wifi-loss test
- Pair a tablet to the scoring app on venue wifi (or simulate with your phone hotspot).
- Disable wifi mid-match, enter 5 exchanges.
- Re-enable wifi.
- Confirm exchanges sync and appear in the public app.

### ☐ 27. Print paper scoresheets
Always have an analog fallback. See O-209 in OWNER_TASKS.md.

### ☐ 28. Verify backup-then-restore drill on a throwaway VM
- Spin up a fresh VPS (Hetzner CX11, €4/month, terminate after).
- Copy a real backup over.
- Run `infra/scripts/restore.sh <backup>`.
- Confirm a known fighter / known event appears correctly.
- Document any friction in `docs/RUNBOOK.md`.

---

## Things you don't need to prepare yet

These can wait until specific phases:

- **HEMA Ratings outreach** — wait until P11 (T-1101).
- **Privacy policy / ToS** — wait until pre-beta (week before P15).
- **Beta event partner** — confirm by P10, but informal commitment now is fine.
- **Branding / logo design** — wait until P6 (theming work begins).
- **French translations** — wait until P14.
- **Discord community channel** — wait until public launch.

---

## Money summary (one-time + recurring)

**One-time:**
- `.fr` domain: €8
- Maybe a throwaway VPS for restore drill: €4
- **Total: ~€12**

**Monthly recurring:**
- OVH VPS: €18
- Backblaze B2 backups: €2
- Resend (free tier): €0
- **Total: €20/month**

**Annual:**
- Domain renewal: €8
- **Total annual recurring: ~€248**

That's the entire ops budget for v1. If MyClash takes off, the next budget item is upgrading the VPS to 16 GB RAM (~€35/month) or splitting onto two boxes.

---

*End of pre-deploy checklist.*
