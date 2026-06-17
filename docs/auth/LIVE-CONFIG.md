# Live sign-in configuration — variables to populate

How to switch each sign-in flow from `mock` to **live** against the real IdP.

- The live flows are **already implemented** (OIDC auth-code + PKCE, discovery, token
  exchange, claim mapping, sign-out). Going live is a configuration step only — no code change.
- **Secrets** (`*_CLIENT_SECRET`) go in the **CDP Secrets page** only. Never commit them.
- **Non-sensitive** values go in **cdp-app-config**. Locally they can live in `.env`.
- Keep the **CDP PASSWORD basic-auth gate** on while testing live.
- Revert `*_AUTH_MODE=mock` for ongoing demos once the handshake is confirmed.

Defaults below come from `src/config/config.js`. Empty default = must be supplied for live.

---

## Applicant — Defra Customer Identity (Azure AD B2C)

Source: **Defra Customer Identity onboarding team**. Ticket: EQ-256.

| Variable | Required | Sensitive | Default | Description |
|---|---|---|---|---|
| `DEFRA_ID_AUTH_MODE` | yes | no | `mock` | Set to `live` to enable the real flow |
| `DEFRA_ID_WELL_KNOWN_URL` | yes | no | — | OIDC discovery (well-known) document URL |
| `DEFRA_ID_CLIENT_ID` | yes | no | — | Registered client id (also sent as an extra scope) |
| `DEFRA_ID_CLIENT_SECRET` | yes | **yes** | — | Confidential-client secret → CDP Secrets page |
| `DEFRA_ID_SERVICE_ID` | yes | no | — | Defra Identity service id (authorize param) |
| `DEFRA_ID_POLICY` | yes | no | — | B2C policy name (authorize param `p`) |
| `DEFRA_ID_PUBLIC_BASE_URL` | yes | no | — | Public base URL used to build redirect URIs |
| `DEFRA_ID_REDIRECT_PATH` | no | no | `/auth/defra-id/callback` | Callback path registered with the IdP |
| `DEFRA_ID_SIGN_OUT_REDIRECT_URL` | no | no | `/` | Post-logout redirect URL |

**Scopes** (fixed in code): `openid offline_access <DEFRA_ID_CLIENT_ID>`.

**URIs to register with the IdP** (built from `DEFRA_ID_PUBLIC_BASE_URL`):
- Redirect URI: `<DEFRA_ID_PUBLIC_BASE_URL>/auth/defra-id/callback`
- Post-logout redirect URI: `<DEFRA_ID_PUBLIC_BASE_URL>/` (or your `DEFRA_ID_SIGN_OUT_REDIRECT_URL`)

### Claim contract (optional overrides)
Defaults match the assumed contract; set these only if the live token uses different
claim names (no code change needed). All non-sensitive.

| Variable | Default | Maps to |
|---|---|---|
| `DEFRA_ID_CLAIM_SUB` | `sub` | stable person id (subject) |
| `DEFRA_ID_CLAIM_EMAIL` | `email` | email |
| `DEFRA_ID_CLAIM_FIRST_NAME` | `firstName` | first name |
| `DEFRA_ID_CLAIM_LAST_NAME` | `lastName` | last name |
| `DEFRA_ID_CLAIM_CONTACT_ID` | `contactId` | contact id |
| `DEFRA_ID_CLAIM_CURRENT_RELATIONSHIP_ID` | `currentRelationshipId` | selected organisation/relationship id |
| `DEFRA_ID_CLAIM_RELATIONSHIPS` | `relationships` | list of person↔organisation relationships |
| `DEFRA_ID_CLAIM_ROLES` | `roles` | IdP roles list |
| `DEFRA_ID_CLAIM_SID` | `sid` | IdP session id |

---

## Case officer — Microsoft Entra ID

Source: **Defra Entra ID / tenant admin team**. (Interim OIDC; SAML 2.0 is the agreed
production direction — pending confirmation with the architect.)

| Variable | Required | Sensitive | Default | Description |
|---|---|---|---|---|
| `ENTRA_AUTH_MODE` | yes | no | `mock` | Set to `live` to enable the real flow |
| `ENTRA_TENANT_ID` | yes | no | — | Tenant id (authority + well-known URL derived from it) |
| `ENTRA_CLIENT_ID` | yes | no | — | Registered application (client) id |
| `ENTRA_CLIENT_SECRET` | yes | **yes** | — | Confidential-client secret → CDP Secrets page |
| `ENTRA_PUBLIC_BASE_URL` | yes | no | — | Public base URL used to build redirect URIs |
| `ENTRA_REDIRECT_PATH` | no | no | `/auth/entra/callback` | Callback path registered with Entra |
| `ENTRA_SIGN_OUT_REDIRECT_URL` | no | no | `/` | Post-logout redirect URL |
| `ENTRA_CASE_OFFICER_ROLE_VALUE` | no | no | `case_officer` | App-role value that grants case-officer access |

**Scopes** (fixed in code): `openid profile offline_access`.

**Discovery** is derived: `https://login.microsoftonline.com/<ENTRA_TENANT_ID>/v2.0/.well-known/openid-configuration`.

**URIs to register on the app registration** (built from `ENTRA_PUBLIC_BASE_URL`):
- Redirect URI: `<ENTRA_PUBLIC_BASE_URL>/auth/entra/callback`
- Post-logout redirect URI: `<ENTRA_PUBLIC_BASE_URL>/` (or your `ENTRA_SIGN_OUT_REDIRECT_URL`)

**Claim mapping** (fixed in code, standard Entra v2.0 names): `oid`/`sub` → subject,
`email`/`preferred_username`/`upn` → email, `name` or `given_name`+`family_name`, app `roles`.

---

## Go-live checklist (per flow)

1. Register the client/app with the IdP; add the redirect + post-logout URIs above; for
   Entra, configure the case-officer app role and assign it to test staff.
2. Set `*_CLIENT_SECRET` in the **CDP Secrets page**; set the non-sensitive `*_` values
   via **cdp-app-config**.
3. Set `*_AUTH_MODE=live`. Keep the CDP PASSWORD gate on.
4. Confirm the claim mapping against a real token; for Defra ID, set `DEFRA_ID_CLAIM_*`
   if names differ.
5. Smoke-test: sign-in page shows "Live mode is enabled" → sign in → callback →
   role-aware landing (applicant → `/register/type`, case officer → `/admin/applications`)
   → sign-out.
6. Revert `*_AUTH_MODE=mock` for ongoing demos.

If config is incomplete in live mode the flow fails gracefully (HTTP 422) and the sign-in
page shows a "not fully configured" warning — it never crashes.

## Production hardening (follow-up, not required for the POC handshake)
JWKS ID-token signature verification, explicit nonce enforcement, persisting `sub`/`oid`,
and resolving real RBAC from a downstream service instead of mock `get-permissions.js`.
