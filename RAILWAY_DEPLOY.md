# Railway deployment runbook

Railway project `gongzhu`, environment `production`, two services off this repo.

| Service | Root directory | Public URL |
|---|---|---|
| `gongzhu-backend` | `/backend` | https://gongzhu-backend-production.up.railway.app |
| `gongzhu-frontend` | `/frontend` | https://gongzhu.up.railway.app |

**Both services auto-deploy on every merge to `main`.** Game state lives in backend
memory with no persistence layer, so a merge ends every game in progress.

## Operational checklist

These need dashboard or CLI write access and cannot be done from a pull request.

- **`CORS_ORIGIN` must carry the `https://` scheme.** The backend compares it verbatim
  against the browser's `Origin` header. A bare hostname never matches, which silently
  rejects the Socket.IO HTTP long-polling transport; WebSocket upgrades are not
  CORS-gated, so the game still plays for anyone whose network allows WebSockets and
  fails completely for anyone whose network does not.
  `railway variables --set "CORS_ORIGIN=https://gongzhu.up.railway.app"` (restarts the
  backend).
- **Migrate to Railpack and Infrastructure as Code before 2026-12-01**, when
  `railway.json` config-as-code stops working. See [Builder migration](#builder-migration).
- **Decide the fate of the Redis service and its `accomplished-volume`.** Both are
  provisioned and running; no code in this repo opens a Redis connection. Either delete
  the service (which is what detaches and removes the volume) or claim it for room state
  that survives a redeploy. It bills either way.

## Environment variables

Backend (`gongzhu-backend`):

| Variable | Notes |
|---|---|
| `NODE_ENV` | `production` |
| `CORS_ORIGIN` | Comma-separated allowed origins. A bare hostname gets `https://` prepended. **Unset is fatal in production** (the server refuses to start rather than silently allowing every origin) |
| `LLM_PROVIDER` | `anthropic`, `openrouter` or `google`. Unset: the first of those with a key present. Set it when more than one key exists |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Anthropic API directly. Default model `claude-haiku-4-5` |
| `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` | OpenRouter. Default model `anthropic/claude-haiku-4.5`; any OpenRouter model id works |
| `GOOGLE_API_KEY`, `GOOGLE_MODEL` | Google Gemini. Default model `gemini-3.5-flash-lite` |
| `LLM_TIMEOUT_MS` | Per-move deadline before a bot plays a heuristic card instead. Default 8000; a timed-out move logs `LLM call exceeded` |
| `LLM_REASONING_EFFORT` | OpenRouter only: `none`, `low` (default), `medium`, `high`. Lower is faster |

With no provider key at all the server starts and fills seats with rule-based bots.
`PORT` is injected by Railway; the server reads it and binds 4000 only in local dev.

Frontend (`gongzhu-frontend`):

| Variable | Notes |
|---|---|
| `REACT_APP_BACKEND_URL` | Backend origin. Read at **build time** by react-scripts, so a change needs a redeploy, not a restart. **Falls back to `http://localhost:4000` when unset**, which ships a bundle pointing at the visitor's own machine |

The frontend service also carries `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL`. Nothing
under `frontend/` reads them and only `REACT_APP_*` names reach the bundle; remove them
when the key is rotated.

## Build configuration

Each service is configured by a `railway.json` in its own root directory. There is
deliberately no root `railway.json` — one would collapse the project into a single
service.

Node version: both `package.json` files declare `"engines": {"node": "20.x"}`, backed by
a `.nvmrc` in each directory for local `nvm use`. Nixpacks resolves the runtime from
`NIXPACKS_NODE_VERSION`, then `engines.node`, then `.nvmrc`, and **defaults to Node 18**
when none is present. Only a major version is accepted. `react-router-dom` requires
Node ≥ 20, so the pin is load-bearing for the frontend build.

## Builder migration

Nixpacks is in maintenance mode and is no longer a documented `build.builder` value;
Railpack succeeds it. Separately, config-as-code is replaced by Infrastructure as Code
in `.railway/railway.ts`. Both land in one migration.

Do this on a branch and merge it deliberately — a merge to `main` deploys immediately.

1. **Delete the `build.builder` key from `frontend/railway.json` and flip the frontend
   service to Railpack** (Settings → Build → Builder). Config-as-code overrides the
   dashboard, so the toggle does not survive a deploy while that key is present. Start
   with the frontend: its failure mode is a static page, not a dead game.
2. Deploy and verify: `railway logs --build` shows Node 20, and
   `curl -sSI https://gongzhu.up.railway.app/` returns 200.
3. Repeat for the backend, verifying with `railway logs -f` and the liveness probe
   below, then play one full game in a browser.
4. Move the remaining per-service settings out of `railway.json`. Railpack reads a
   `railpack.json` in the service root for build steps; start command and restart policy
   become service settings. The frontend's equivalent:
   ```json
   {
     "steps": { "build": { "commands": ["npm run build"] } },
     "deploy": { "startCommand": "npx serve -s build -p $PORT" }
   }
   ```
   The backend has no build step — only the `npm start` start command. Neither file needs
   a `packages.node` entry: Railpack resolves Node from `RAILPACK_NODE_VERSION`, then
   `devEngines`, then `engines.node`, then `.nvmrc`, so the existing pin already applies.
5. Generate and review the IaC file before applying:
   ```bash
   railway config pull --force   # import current project settings
   railway config migrate        # preview .railway/railway.ts
   railway config plan           # confirm the diff touches only these two services
   railway config migrate --apply
   ```
   The plan covers the whole project, Redis included. Read it for unexpected deletions.
6. Delete both `railway.json` files, clear any custom config file path in service
   settings, and **rotate `ANTHROPIC_API_KEY`** — Nixpacks passed build variables as
   Docker build args (`SecretsUsedInArgOrEnv: ANTHROPIC_API_KEY` in the build log), so
   the current key is written into image layers. Rotating before this step just bakes
   the new key into new layers.

## CLI

```bash
npm i -g @railway/cli
railway login
railway link                         # select project gongzhu, environment production, a service

railway status                       # services, URLs, active deployment
railway variables                    # linked service; --service <name> for the other
railway logs -f                      # runtime logs, follow
railway logs --build                 # build log for the active deployment
railway redeploy                     # redeploy the active deployment
```

Deploy by merging to `main`. `railway up` uploads the local working tree instead and
desynchronises the service from GitHub — avoid it.

**Rollback.** `main` is deploying something broken: redeploy the last good deployment
from the service's Deployments tab (fastest, no build). A `git revert` on `main` also
works but costs a full rebuild.

## Networking

Both services need public networking — browsers talk to each of them directly, and
`*.railway.internal` is not reachable from a browser. WebSockets need no extra
configuration.

## Troubleshooting

**Is the backend actually up?** `curl -sS https://gongzhu-backend-production.up.railway.app/`
returns `Gongzhu backend is running!`. Neither service sets `healthcheckPath`, so Railway
marks a deploy healthy as soon as the port binds — an "active" deployment in
`railway status` is not evidence the app works.

**Page loads but nothing connects.** Either `REACT_APP_BACKEND_URL` was unset or wrong at
build time (check the bundle's target, not the dashboard value — it is baked in), or
`CORS_ORIGIN` is rejecting the polling transport on a network that blocks WebSockets.
Both fail silently with no server-side error.

**"No start command found".** The service's root directory is not set to `/backend` or
`/frontend`, so Railway is reading the repo root.

**Service offline for a long stretch.** Railway removes deployments that crash-loop, and
a broken GitHub app link stops auto-deploys with no notification. Compare the active
deployment SHA in `railway status` against the tip of `main`, and check the GitHub
connection in service settings.
