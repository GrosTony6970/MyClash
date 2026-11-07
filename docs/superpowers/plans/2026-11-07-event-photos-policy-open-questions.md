# Event photos — the policy's open questions (rulings 480-485) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (the operator builds native) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The privacy policy and the terms (FR and EN) give the answers to slice 8's open questions A-F: how long backups and server logs keep data, that a parent may have a photo of their child removed, that the organiser and MyClash are jointly in charge of an Event's photos, and that photos are never used to promote MyClash. Both documents get a new date, so every account accepts them once.

**Architecture:** text only, in four pages: `apps/web-marketing/src/pages/privacypolicy.astro` (FR), `.../en/privacypolicy.astro` (EN), `.../terms.astro` (FR), `.../en/terms.astro` (EN). The versions are `LEGAL_POLICIES.privacy.version` and `LEGAL_POLICIES.terms.version` in `packages/types/src/legal.ts`. `apps/web-marketing/test/privacy-date.test.mjs` ties the privacy date to its pages; nothing ties the terms date yet, so this plan adds that test.

**Spec:** `docs/superpowers/specs/2026-11-03-event-photos-design.md` ("Privacy policy", `:209-211`); slice 8's plan `docs/superpowers/plans/2026-11-06-event-photos-slice8-privacy-policy.md` ("Open questions" A-F, rulings 472-479).

## In plain words

Léa deletes her account. The policy keeps saying "deletion is immediate", and now adds the one exception: our encrypted night backups keep a copy for about 60 days, and we use them only to repair the platform after an incident (481). The photo section says the same for photo names, captions and reports.

Tom's mother finds a photo of him at the Lyon Open. The photo section now tells her, by name, that a parent may ask for it to be removed the same way as anyone else, and that we remove it without asking why (483).

The organiser and MyClash are now named jointly in charge of an Event's photos: the organiser turns photos on, approves, moderates and downloads; MyClash stores them, strips the GPS, gives each phone its random number, deletes them after 30 days and answers what is sent to us. Léa may ask either one (485, reopens 472 for photos; the roster stays the organiser's). The terms' organiser section says the same to the organiser.

The terms' licence stays "operating and promoting the platform" for other content, but an Event's photos are for operating it only: MyClash never puts them in a flyer or on its home page (482).

§2.7 says how long server logs last: no number, because they are kept in a fixed space and the busiest days push them out soonest (484). While drafting that, a sentence two lines later turned out untrue: "We do not record which pages you visit". The server logs do, with the IP address. Draft G rewrites it (to rule).

The data download does not change: it keeps the list of photos, the images stay in the Photos tab (480).

The next time anyone signed in opens MyClash, the banner asks them to accept the new privacy policy and the new terms.

## Rulings (2026-11-07, this session)

- **480** (A). The data download keeps the list of photos (`photos.csv`); no images. No change.
- **481** (B). One sentence in §6.1, and in §3bis for photos: deleted data stays in our encrypted off-site backups about 60 days (the `/admin/backups` default: daily, 60 kept off-site, `infra/ops-runner/backup-core.mjs:19-31`), used only to repair the platform. No cap in code. The handoff's `BACKUP_RETENTION_DAYS` is read by nothing (`docs/DATABASE_REVIEW.md:66`).
- **482** (C). Terms §6.2: an Event's photos are licensed for operating the platform only, never its promotion. New terms date.
- **483** (D). §3bis "What you can do" gains a parent's line. Text only.
- **484** (E). §2.7 gains one honest sentence on log duration; no number, no code.
- **485** (F). Joint control of an Event's photos (Art. 26 GDPR): §1.1's photo row, one sentence in §3bis, one bullet in terms §4bis. Reopens 472 for photos only.
- **486** (G, found while drafting). §2.7's "We do not record which pages you visit" is untrue (the server logs do); draft G replaces it, FR + EN, in commit 1.
- **Texts approved as drafted** (2026-11-07). The 2026-11-06 privacy version is **not deployed yet**: one banner covers both documents.

- **487** (after the cold review). Four more text fixes, FR + EN, in commit 3: §2.7 "apart from these logs **and the error reports of §7.1**" (Sentry's breadcrumbs and traces are page visits too); the §1.1 heading "Who is responsible, depending on the data"; §1.1's first point of contact "; for photos, either of us"; §4's photo row "The organiser's **and our** legitimate interest".
- **`BACKUP_GPG_RECIPIENT` is set in production** (operator, 2026-11-07): the off-site copies are encrypted, so "encrypted" stands.

The next free ruling number is **488**.

## Assumptions (mine; the operator reads them before the build)

1. **Both documents are dated the day of the push** (for example 2026-11-07), in `legal.ts` and in each page's "Last updated" line, in ONE push. If the 2026-11-06 privacy version is not deployed yet, a signed-in person sees the banner once for both; if it is, they see it a second time.
2. **The "about 60 days" holds while `/admin/backups` stays at daily × 60** (ruling 481 chose no cap). The 14 local copies on the server are inside that.
3. **"We remove it without asking for a reason"** (483) binds MyClash, through a hand deletion (assumption 13 of slice 8). It does not bind the organiser; the sentence says "we".
4. **Joint control changes no legal basis in §4**: the abuse row (`mc_photo_device`) is already ours; the showing row stays the organiser's interest.
5. **A new test ties the terms date to `LEGAL_POLICIES.terms.version`**, beside the privacy one (`privacy-date.test.mjs`), with a seeded break.
6. Two commits, one push: (1) the privacy policy, (2) the terms and their date test.

## Open questions (named, not built)

- A restore from a backup would bring back accounts and photos deleted since that backup; nothing deletes them again. The draft says backups are used "only to repair the platform after an incident" and claims nothing about a restore.
- The 30-day photo deletion runs on the bucket; a backup restore of the database would bring back photo rows whose image is gone (the orphan sweep of slice 3 may cover it: not traced).

## Draft texts (EN and FR) — for the operator to read and amend before the build

### §1.1 — the photo row, right cell (485)

EN, replaces "The organiser of that event. They open the event to photos, approve them and may download them. MyClash hosts them on their behalf and deletes them 30 days after the event (see §3bis)":

> **The organiser of that event and LYON AMHE, jointly.** The organiser opens the event to photos, chooses whether they need approval, moderates them and may download them. MyClash stores them, removes their hidden data, gives each phone its random number, deletes them 30 days after the event and answers the requests sent to us (see §3bis). You may write to either one.

FR :

> **L'organisateur de cet événement et LYON AMHE, conjointement.** L'organisateur ouvre l'événement aux photos, choisit si elles doivent être validées, les modère et peut les télécharger. MyClash les stocke, en retire les données cachées, attribue à chaque téléphone son numéro aléatoire, les supprime 30 jours après l'événement et répond aux demandes qui nous sont adressées (voir §3bis). Vous pouvez écrire à l'un comme à l'autre.

### §2.7 — two sentences (484, and G)

EN, after "…server logs, and error reports." insert (484):

> Server logs record each request: the address it came from, what was asked for, and when. Each service keeps them in a limited space where newer lines replace the oldest, so the busier the platform, the sooner a line goes: at an event, usually within a few days. They are not in our backups, and we use them only to keep the platform working and secure.

FR :

> Les journaux serveur enregistrent chaque requête : l'adresse d'où elle vient, ce qui est demandé, et quand. Chaque service les garde dans un espace limité où les lignes récentes remplacent les plus anciennes ; plus la plateforme est active, plus une ligne part vite : lors d'un événement, en général en quelques jours. Ils ne figurent pas dans nos sauvegardes, et nous ne nous en servons que pour faire fonctionner la plateforme et la protéger.

**G (to rule).** EN, replaces "We do not record which pages you visit or how long you spend on them.":

> Apart from these logs, we keep no record of the pages you visit, and nothing measures how long you stay on them.

FR, replaces « Nous n'enregistrons ni les pages que vous consultez, ni le temps que vous y passez. » :

> En dehors de ces journaux, nous ne gardons aucune trace des pages que vous consultez, et rien ne mesure le temps que vous y passez.

### §3bis — after the opening paragraph (485)

EN:

> The organiser and LYON AMHE are jointly responsible for these photos; §1.1 says who does what.

FR :

> L'organisateur et LYON AMHE en sont responsables conjointement ; le §1.1 dit qui fait quoi.

### §3bis "How long" — the last sentence (481)

EN, replaces "The images are never in our backups.":

> The images are never in our backups; the names, captions and reports stay in our encrypted database backups for about 60 more days (see §6.1).

FR, remplace « Les images ne figurent jamais dans nos sauvegardes. » :

> Les images ne figurent jamais dans nos sauvegardes ; les noms, légendes et signalements restent environ 60 jours de plus dans nos sauvegardes chiffrées de la base de données (voir §6.1).

### §3bis "What you can do" — a fourth bullet (483)

EN:

> **A photo shows your child**: as their parent or guardian, ask for it to be removed in the same way (Report, the organiser, or us). We remove it without asking you for a reason.

FR :

> **Une photo montre votre enfant** : en tant que parent ou représentant légal, demandez son retrait de la même façon (« Signaler », l'organisateur, ou nous). Nous la retirons sans vous demander de raison.

### §6.1 — after the bulleted list (481)

EN:

> **One copy outlasts that moment: our backups.** Every night an encrypted copy of the database goes to off-site storage, and we keep the most recent ones, about 60 days. Your deleted data stays in them until the copy that holds it is replaced. We use these copies only to repair the platform after an incident.

FR :

> **Une copie survit à ce moment : nos sauvegardes.** Chaque nuit, une copie chiffrée de la base de données part vers un stockage hors-site, et nous gardons les plus récentes, soit environ 60 jours. Vos données supprimées y restent jusqu'à ce que la copie qui les contient soit remplacée. Nous ne nous servons de ces copies que pour réparer la plateforme après un incident.

### Terms §4bis — a paragraph after the roster list (485)

EN:

> **If you open your event to photos, you and LYON AMHE are jointly responsible for them** (Art. 26 GDPR). You decide to open the event, whether photos need approval, which ones stay or go, and what becomes of the copies you download. LYON AMHE stores them, removes their hidden data, limits abuse and deletes them 30 days after the event. Our [Privacy Policy](/en/privacypolicy#photos) tells the people concerned. Each of us answers the requests it receives and passes on to the other those that concern it.

FR :

> **Si vous ouvrez votre événement aux photos, vous et LYON AMHE en êtes responsables conjointement** (art. 26 RGPD). Vous décidez d'ouvrir l'événement, si les photos doivent être validées, lesquelles restent ou partent, et du sort des copies que vous téléchargez. LYON AMHE les stocke, en retire les données cachées, limite les abus et les supprime 30 jours après l'événement. Notre [Politique de Confidentialité](/privacypolicy#photos) en informe les personnes concernées. Chacun de nous répond aux demandes qu'il reçoit et transmet à l'autre celles qui le concernent.

### Terms §6.2 — a second sentence pair (482)

EN, after "…operating and promoting the platform.":

> For an event's photos, this licence covers operating the platform only: showing them on the event's page, letting its moderators handle them, and giving them to its organiser. LYON AMHE never uses them to promote the platform.

FR, après « …du fonctionnement et de la promotion de la plateforme. » :

> Pour les photos d'un événement, cette licence ne couvre que le fonctionnement de la plateforme : les montrer sur la page de l'événement, permettre à ses modérateurs de les traiter et les remettre à son organisateur. LYON AMHE ne les utilise jamais pour promouvoir la plateforme.

## Tasks

### Task 1: The privacy policy (commit 1)

- [ ] The texts above (§1.1, §2.7, G if ruled, §3bis ×3, §6.1) in both pages.
- [ ] `LEGAL_POLICIES.privacy.version` = the push date; its comment names rulings 481, 483-485; both "Last updated" lines.
- [ ] `node --test` over the built site: `privacy-date` green; red with one date line changed (seeded break).

### Task 2: The terms and their date test (commit 2)

- [ ] §4bis paragraph and §6.2 sentences in both pages.
- [ ] `LEGAL_POLICIES.terms.version` = the push date; its comment names 482 and 485; both "Last updated" lines.
- [ ] The date test covers the terms (FR "Dernière mise à jour", EN "Last updated"), red with one terms date line changed.

### Task 3: Proof, review, push

- [ ] The full gate chain (`myclash-gates`), each gate alone.
- [ ] A cold review of the four pages against the code: every claim (60 copies daily, log caps, who strips and deletes) cited.
- [ ] One push; CI 17/17.

## Reviews (2026-11-07)

Cold review (opus) of commits 1-2: 0 BLOCKER, 2 MAJOR, 3 MINOR, 2 NIT; FR and EN match sentence for sentence; the test's RegExp verified.

- MAJOR: "encrypted" holds only when `BACKUP_GPG_RECIPIENT` is set (`infra/scripts/backup.sh:184`; commented out in `.env.example`). The operator confirmed it is set in production.
- MAJOR: §2.7's "apart from these logs" contradicted §7.1 (Sentry receives the pages that led to an error, and traces) → ruling 487.
- MINOR: §1.1's heading and first-point-of-contact line, §4's legal basis → ruling 487.
- MINOR: no screen lets LYON AMHE remove a QR photo (`photo-organiser.ts:29`, `assertOrgRole`); "we remove it" means a hand deletion in the database (migration 0250's trigger still queues the images). Accepted, as slice 8's assumption 13.
- NIT: "every night … about 60 days" is the `/admin/backups` default; the super admin can change it (ruling 481 chose no cap).
- NIT: the phone's random number and the sender's account link also stay in the backups; §3bis lists names, captions and reports only.

## As built (2026-11-07)

- `ede5f526` docs(legal): the privacy policy (481, 483-486), version 2026-11-07. `privacy-date` red with one date line changed.
- `36c3d794` docs(legal): the terms (482, 485), version 2026-11-07 (was 2026-08-04). `privacy-date.test.mjs` checks both documents through one helper: red with the FR terms date changed, and red on the terms test only with only the terms version changed (both documents share a date, so this proves it reads the terms block).
- Commit 3, fix(legal): ruling 487's four fixes. Same version: nothing was pushed in between.
- Gates 33/33 on commits 1-2; web-marketing tests 12/12 after commit 3.

## Named, not fixed

- **Every deploy writes a PLAIN database dump on the server** (`infra/scripts/deploy.sh:518-529`, `backups/pre-deploy/*.sql.gz`, kept 30 days). It is on the same machine as the live database, inside the 60 days the policy states; the policy does not name it.
- A restore from a backup brings back accounts and photos deleted since; nothing deletes them again.
- `./logs/db` is mounted into the database container (`docker-compose.prod.yml:175`); if Postgres writes files there, the 10 MB cap does not reach them. Check on the server: `ls -la logs/db`.
