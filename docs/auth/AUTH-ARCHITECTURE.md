# Authentication & Customer Identity — Architecture & Port Plan

Status: **draft / scaffold** (step 1). For review before the live build (step 2).
Service: `pesticides-poc-frontend` (Hapi, CDP Frontend Template).

## 1. Two user populations, two identity providers

| Population                 | Who                                                 | IdP                                                                    | Status                                                                              |
| -------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **External applicants**    | Companies/agents submitting pesticides applications | **Defra Customer Identity (Azure AD B2C)** over OIDC                   | Confirmed by the Customer Identity onboarding docs                                  |
| **Internal case officers** | HSE/CRD staff processing applications               | **Microsoft Entra ID** (SAML 2.0 SSO in production; interim OIDC here) | **Not** covered by the onboarding docs — architect direction only, still to confirm |

The two are independent integrations and must not be conflated. Everything the
meeting handed us (Customer Sync Data Model, Onboarding Questionnaire, FAQ) is
about the **external** side only.

## 2. How the external (Defra Identity) login works

- **Authentication:** Azure AD B2C, authorization-code + PKCE (S256), OIDC
  discovery from a well-known URL, with Defra-specific authorize params:
  `serviceId`, B2C policy `p`, and the client id sent as an additional scope.
- **Organisation context in the token:** unlike GOV.UK One Login, Defra Identity
  carries `currentRelationshipId` / `relationships`, i.e. the person↔organisation
  link. This is the main reason it was chosen for business users.
- **Authorisation is NOT in the token.** Roles/permissions come from the **LOB
  Service User Link** enrolment record (Service Role + Enrolment Status), resolved
  downstream (`get-permissions.js`), not from a raw IdP `roles` claim.

### Claim contract (to confirm at onboarding)

`sub` (stable person id), `email`, `firstName`, `lastName`, `contactId`,
`currentRelationshipId`, `relationships`, `roles`, `sid`.

## 3. Enrolment model — the key service decision

From the Customer Identity FAQ (Q11, Q13, Q15):

- **Auto-enrolment** — first admin user is auto-granted the service's default role
  and can act immediately. No gate.
- **Traditional enrolment** — user gets an _enrolment request_ with no role; the
  service runs its own approval/verification and redeems it for a role.
- **CIDM does NO relationship verification** (Q13): anyone can self-attest they act
  for any Companies House org. Verification is the **service's** responsibility.

**Recommendation for pesticides (regulatory service):** use **traditional
enrolment** (or auto-enrolment + a service-layer verification gate), so applicants
are held _pending_ our checks before they can submit. Cost (per FAQ): redeeming
enrolment requests needs Customer DB knowledge or the **IDM HAPI plugin**.

> Open decision for the team — confirm auto vs traditional, and what our approval
> step actually verifies.

## 4. Integration / data (mostly a `poc-backend` concern)

- **Customer Sync** (FAQ Q16): asynchronous messages over **Azure Service Bus**
  notifying the service of user/org onboarding and changes. Preferred over direct
  Dynamics access.
- **No Dynamics required** (Q17): `poc-backend` keeps its own store and consumes
  Sync messages.
- The **frontend** does not talk to Sync directly — it authenticates the user and
  reads identity/enrolment via the backend.

## 5. Source provenance (what we port from where)

| Artefact             | Source                                                           | Notes                                                                                                                                            |
| -------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `entra-id-client.js` | `prototype-legacy` working tree                                  | Present; ports near-verbatim                                                                                                                     |
| `defra-id-client.js` | **Recovered from chat thread `0ea28f89`**                        | **Not in prototype-legacy git** (was uncommitted, then deleted) — reconstruct from the transcript + the Entra client pattern + the briefing note |
| `get-permissions.js` | `prototype-legacy` working tree                                  | Ports as plain logic                                                                                                                             |
| `auth-routes.js`     | `prototype-legacy` (Express)                                     | **Rewrite** for Hapi (`h.redirect`/`h.view`, `@hapi/yar`)                                                                                        |
| Briefing note        | `prototype-legacy/Defra-Identity-POC-Technical-Briefing-Note.md` | Authoritative spec for the Defra ID flow                                                                                                         |

Framework-agnostic clients depend only on `node:crypto` + `fetch` (no Express/Hapi),
so the security-sensitive logic transfers cleanly; only routing/session glue changes.

## 6. Mock vs live

- Both providers default to `mode: mock` (`auth.defraId.mode`, `auth.entra.mode`).
- **Mock** needs no credentials — local demo identities. Essential for UCD / Phil's
  **user research**, including modelling enrolment states (Pending / Approved /
  Blocked / Offboarded).
- **Live** is a runtime-config step (the `DEFRA_ID_*` / `ENTRA_*` env vars in
  `src/config/config.js`); no code change expected for the baseline flow.

## 7. Build plan

- **Step 1 — scaffold (this change):** config keys (`auth.*`), an auth plugin
  skeleton (`src/server/auth/**`) wired into the router with `501` placeholder
  routes, and this doc. App still boots; no behaviour change for existing routes.
- **Step 2 — both providers, live-ready + Defra ID mock:** ✅ **DONE.**
  1. ✅ Reconstructed `defra-id/client.js` and ported `entra/client.js`.
  2. ✅ `get-permissions.js` resolves role + scope downstream (mock privilege sets).
  3. ✅ Hapi routes (`sign-in` page → `start` → `callback`, shared `sign-out`),
     orchestrated over `@hapi/yar` in `session.js` + per-provider `service.js`.
  4. ✅ `@hapi/yar` session persists the profile incl. `subject` + `organisationId`
     (selected relationship); transient `state`/`nonce`/PKCE held only across the hop.
  5. ✅ Role-aware, open-redirect-safe post-login redirect (`resolvePostLoginRedirect`)
     - `requireAuth`/`requireRole` guards for downstream protected routes.
  6. ✅ Mock identities + GOV.UK sign-in pages; live-mode "not fully configured"
     warning on the page and a 422 from the client.
  7. ✅ Vitest (session unit tests + end-to-end route walk) + `.env.example` vars.

  **Post-login landing — note:** the documented role destinations `/register/type`
  and `/admin/applications` are downstream journeys not yet built in this repo, so a
  successful sign-in lands on **`/auth/account`** (a "who am I" session page — also a
  useful diagnostic for UCD/Phil). `resolvePostLoginRedirect` still honours a safe
  `returnTo` deep-link and keeps applicants off `/admin`, so once those journeys land
  the guards will route to them automatically with no change here.

- **Hardening (post-POC):** JWKS signature verification, explicit nonce checks,
  API bearer-token middleware.

## 8. Config keys added (step 1)

`auth.defraId`: `mode`, `wellKnownUrl`, `clientId`, `clientSecret`, `serviceId`,
`policy`, `publicBaseUrl`, `redirectPath`, `signOutRedirectUrl`.

`auth.entra`: `mode`, `tenantId`, `clientId`, `clientSecret`, `publicBaseUrl`,
`redirectPath`, `signOutRedirectUrl`, `caseOfficerRoleValue`.

All have safe defaults so `config.validate({ allowed: 'strict' })` passes with no
environment set (mock mode).
