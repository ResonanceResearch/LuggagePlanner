# Packwise — Luggage Planner

A responsive luggage-planning dashboard hosted on GitHub Pages, with a Cloudflare Worker API and Cloudflare D1 database.

## Cloudflare resource names

- **Worker:** `luggage-planner-api`
- **D1 database:** `luggage-planner-db`
- **D1 binding:** `DB`
- **Private Worker secret:** `APP_ACCESS_TOKEN`

The one-time setup script creates or reuses these resources, applies the included migrations, sets the access token, deploys the Worker, and writes the deployed Worker URL into `docs/config.js`.

## Included features

- Reusable master library of categories and packing items.
- Seeded lists for travel essentials, business trips, electronics, shoes, clothes, beach, adventure, camera, toiletries, medication and health, comfort, and miscellaneous items.
- Drag items from the library into carry-ons, checked luggage, personal items, medication kits, or custom bags.
- Add multiple carry-ons or checked bags.
- Mark items packed, adjust quantities, move items between bags, or remove them from a trip.
- Add categories and items, move items between categories, and archive/restore items.
- Archived items remain in D1 so the database keeps the full historical library.
- Save complete trip layouts and duplicate a previous trip as a new packing plan.
- Family mode creates separate carry-ons and personal items for each traveller plus shared luggage and a shared medication kit.
- Add, rename, and remove travellers; add, rename, reassign, share, or delete bags.
- Browser-stored connection settings. The private access token is never committed to the repository.
- Automatic GitHub Actions deployment for both GitHub Pages and the Cloudflare Worker.

## Project structure

```text
.
├── .github/workflows/
│   ├── check.yml
│   ├── deploy-pages.yml
│   └── deploy-worker.yml
├── docs/
│   ├── .nojekyll
│   ├── app.js
│   ├── config.js
│   ├── index.html
│   └── styles.css
├── scripts/
│   └── setup-cloudflare.mjs
├── worker/
│   ├── migrations/
│   │   ├── 0001_initial_schema.sql
│   │   └── 0002_seed_library.sql
│   ├── src/index.js
│   └── wrangler.jsonc
├── package.json
└── README.md
```

## One-time Cloudflare setup

Requirements: Node.js 20 or newer, npm, and a Cloudflare account with Workers and D1 enabled.

From the project folder:

```bash
npm install
npx wrangler login
npm run cf:setup
```

The setup script will:

1. Create `luggage-planner-db` if it does not already exist.
2. Add the D1 binding and database UUID to `worker/wrangler.jsonc`.
3. Apply every SQL migration in `worker/migrations/`.
4. Generate a strong `APP_ACCESS_TOKEN`, unless you supplied one as an environment variable.
5. Store the token as a Cloudflare Worker secret.
6. Deploy `luggage-planner-api`.
7. Put the deployed workers.dev URL in `docs/config.js`.
8. Print the access token once so you can store it securely.

To provide your own access token:

```bash
APP_ACCESS_TOKEN='use-a-long-random-secret' npm run cf:setup
```

Do **not** put the access token in `docs/config.js`, source control, or a GitHub Pages file. Enter it in the dashboard's Connection settings when you first open the site.

## Create and push the GitHub repository

Create a new empty repository named `luggage-planner-dashboard` under the `ResonanceResearch` account. Do not initialize it with a README because this project already contains one.

Then run:

```bash
git add .
git commit -m "Initial Packwise luggage planner"
git remote add origin https://github.com/ResonanceResearch/luggage-planner-dashboard.git
git push -u origin main
```

## Enable GitHub Pages

In the repository:

1. Open **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.
3. Run the `Deploy GitHub Pages` workflow if it did not start automatically.

The expected site URL is:

```text
https://resonanceresearch.github.io/luggage-planner-dashboard/
```

GitHub Pages URLs are case-sensitive in practice for path matching. Keep the repository name in `docs/config.js` and links exactly as created.

## Enable automatic Worker updates

In **GitHub repository → Settings → Secrets and variables → Actions**, add:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

Use a scoped Cloudflare API token with permission to edit Workers scripts and D1 databases for the intended account. Do not use the global API key.

After those secrets are present, every push to `main` that changes `worker/**`, `package.json`, or the Worker workflow will:

1. Apply unapplied D1 migrations.
2. Deploy the latest Worker code.

The existing `APP_ACCESS_TOKEN` Worker secret is preserved during ordinary deployments.

## First use

Open the GitHub Pages site. The connection window asks for:

- **Worker API URL:** normally the URL already placed in `docs/config.js` by the setup script.
- **Access token:** the value printed by `npm run cf:setup`.

The dashboard can remember the token in the browser's local storage, or retain it only for the current browser session.

## CORS and custom domains

The default Worker setting allows the GitHub Pages origin:

```json
"ALLOWED_ORIGIN": "https://resonanceresearch.github.io"
```

The origin contains the scheme and host only, not the repository path. For a custom domain, replace this value in `worker/wrangler.jsonc` and push the change. Multiple origins can be supplied as a comma-separated string.

## D1 migrations

The initial migrations are:

- `0001_initial_schema.sql`: categories, items, trips, travellers, bags, and trip placements.
- `0002_seed_library.sql`: all built-in categories and the requested initial packing items.

To apply new migrations manually:

```bash
npm run cf:migrate:remote
```

For local Worker development:

```bash
npm run cf:migrate:local
npm run cf:dev
```

## Data-retention model

Items and custom categories are archived rather than physically deleted. Old trips keep references to their original items. Trips are also archived rather than deleted through the user interface, so previous luggage arrangements remain available for duplication.

Deleting a bag is intentionally different: it removes that trip-specific bag and its trip placements. It does not delete master library items.

## Security notes

The public GitHub Pages site contains no private trip data. All data is requested from the Worker and D1 after the browser supplies the private bearer token. The token is a practical access control for a personal or family tool, but it is not a multi-user identity system. Anyone who obtains the token can access and modify the stored packing data.

For a broader group, separate user accounts, or highly sensitive travel details, add a proper identity provider or Cloudflare Access rather than sharing one token.

## Dependency registry note

This repository includes a root `.npmrc` that explicitly uses the public npm registry. The committed `package-lock.json` must not contain private or machine-specific registry URLs. You can verify this before pushing with:

```bash
grep -n "internal.api.openai.org\|applied-caas" package-lock.json || echo "Lockfile registry URLs are portable."
```

## Setup compatibility note

Version 1.0.2 makes `npm run cf:setup` tolerant of warnings that Wrangler may print alongside `--json` output. It also stores `migrations_dir` only inside the generated D1 binding, as required by current Cloudflare configuration.
