# AGENTS.md

This file defines shared instructions for AI coding tools working in this repository.

## Project overview

- **Service:** `pesticides-poc-backend`
- **Runtime:** Node.js `>=24`
- **Module system:** ESM (`"type": "module"`)
- **Framework:** Hapi
- **Data store:** MongoDB
- **Testing:** Vitest
- **Linting/formatting:** neostandard (via ESLint) + Prettier

## Core architecture

- Entry point: `src/index.js`
- Server composition: `src/server.js`
- Configuration: `src/config.js` (Convict, strict validation)
- Routes: `src/routes/*.js`, wired in `src/plugins/router.js`
- Plugins: `src/plugins/*.js` (logging, tracing, pulse, mongodb, router)
- Shared helpers: `src/common/helpers/**`
- Services: `src/services/**`

## Coding conventions

- Use **plain JavaScript** (no TypeScript unless explicitly requested).
- Follow existing ESM import style and keep `.js` extensions in imports.
- Prefer internal alias imports using `#/...` for app modules.
- Match existing style:
  - no semicolons
  - single quotes
  - concise functions and explicit names
- Reuse existing helpers and patterns before introducing new abstractions.
- Keep changes focused; avoid unrelated refactors.

## API and plugin patterns

- New endpoints should be defined as route objects in `src/routes/*` and registered via `router` plugin.
- Use Hapi response toolkit (`h.response(...)`) and `@hapi/boom` for HTTP errors.
- Access Mongo via decorated `request.db` / `server.db` from the mongodb plugin.
- Keep request validation failures explicit (see `fail-action` helper behavior).

## Configuration and environment

- Add new config keys in `src/config.js` with:
  - `doc`, `format`, `default`, and `env` where relevant
  - strict compatibility with `config.validate({ allowed: 'strict' })`
- Do not bypass config validation or hardcode environment-specific values.

## Quality gates

Use existing scripts from `package.json`:

- `npm run lint`
- `npm run test`
- `npm run format:check`

For code changes, ensure lint and tests pass before finishing.

## Safety and change boundaries

- Do not commit secrets or credentials.
- Do not remove logging, tracing, or security-related middleware unless requested.
- Preserve existing behavior unless the task explicitly asks for behavioral changes.
- If you change observable behavior (API, config, startup, DB access), update relevant docs/tests in the same change.
