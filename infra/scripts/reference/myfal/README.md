# MyFAL reference scripts

This directory holds the original MyFAL scripts that MyClash's deploy pipeline is modeled on. They are **reference material**, not executed.

When the AI agent works on T-054 / T-055 (VPS bootstrap and production compose details), it reads these to make sure MyClash's adaptation stays faithful to the proven patterns. Drop the relevant files from `https://github.com/GrosTony6970/MyFAL` here:

- `deploy.sh` (original)
- `start.sh`, `stop.sh`, `refresh.sh`, `status.sh`, `destroy.sh`
- `docker-compose.yml` (production, original)
- `docker-compose.staging-certs.yml`
- `.env.example`
- `.gitignore`
- Any cron entries or VPS bootstrap notes

These files **should be gitignored** if they contain anything specific to the owner's MyFAL deployment (real domains, real secrets). The repo's `.gitignore` already excludes this entire directory by default for safety.

Once T-055 is merged and MyClash's bootstrap is verified working, this directory can be deleted.
