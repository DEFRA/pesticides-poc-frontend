import convict from 'convict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import convictFormatWithValidator from 'convict-format-with-validator'

const dirname = path.dirname(fileURLToPath(import.meta.url))

const fourHoursMs = 14400000
const oneWeekMs = 604800000

const isProduction = process.env.NODE_ENV === 'production'
const isTest = process.env.NODE_ENV === 'test'
const isDevelopment = process.env.NODE_ENV === 'development'

convict.addFormats(convictFormatWithValidator)

export const config = convict({
  serviceVersion: {
    doc: 'The service version, this variable is injected into your docker container in CDP environments',
    format: String,
    nullable: true,
    default: null,
    env: 'SERVICE_VERSION'
  },
  host: {
    doc: 'The IP address to bind',
    format: 'ipaddress',
    default: '0.0.0.0',
    env: 'HOST'
  },
  port: {
    doc: 'The port to bind.',
    format: 'port',
    default: 3000,
    env: 'PORT'
  },
  staticCacheTimeout: {
    doc: 'Static cache timeout in milliseconds',
    format: Number,
    default: oneWeekMs,
    env: 'STATIC_CACHE_TIMEOUT'
  },
  serviceName: {
    doc: 'Applications Service Name',
    format: String,
    default: 'pesticides-poc-frontend'
  },
  root: {
    doc: 'Project root',
    format: String,
    default: path.resolve(dirname, '../..')
  },
  assetPath: {
    doc: 'Asset path',
    format: String,
    default: '/public',
    env: 'ASSET_PATH'
  },
  isProduction: {
    doc: 'If this application running in the production environment',
    format: Boolean,
    default: isProduction
  },
  isDevelopment: {
    doc: 'If this application running in the development environment',
    format: Boolean,
    default: isDevelopment
  },
  isTest: {
    doc: 'If this application running in the test environment',
    format: Boolean,
    default: isTest
  },
  log: {
    enabled: {
      doc: 'Is logging enabled',
      format: Boolean,
      default: process.env.NODE_ENV !== 'test',
      env: 'LOG_ENABLED'
    },
    level: {
      doc: 'Logging level',
      format: ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'],
      default: 'info',
      env: 'LOG_LEVEL'
    },
    format: {
      doc: 'Format to output logs in.',
      format: ['ecs', 'pino-pretty'],
      default: isProduction ? 'ecs' : 'pino-pretty',
      env: 'LOG_FORMAT'
    },
    redact: {
      doc: 'Log paths to redact',
      format: Array,
      default: isProduction
        ? ['req.headers.authorization', 'req.headers.cookie', 'res.headers']
        : [],
      env: 'LOG_REDACT'
    }
  },
  httpProxy: {
    doc: 'HTTP Proxy',
    format: String,
    nullable: true,
    default: null,
    env: 'HTTP_PROXY'
  },
  isSecureContextEnabled: {
    doc: 'Enable Secure Context',
    format: Boolean,
    default: isProduction,
    env: 'ENABLE_SECURE_CONTEXT'
  },
  session: {
    cache: {
      engine: {
        doc: 'backend cache is written to',
        format: ['redis', 'memory'],
        default: isProduction ? 'redis' : 'memory',
        env: 'SESSION_CACHE_ENGINE'
      },
      name: {
        doc: 'server side session cache name',
        format: String,
        default: 'session',
        env: 'SESSION_CACHE_NAME'
      },
      ttl: {
        doc: 'server side session cache ttl',
        format: Number,
        default: fourHoursMs,
        env: 'SESSION_CACHE_TTL'
      }
    },
    cookie: {
      ttl: {
        doc: 'Session cookie ttl',
        format: Number,
        default: fourHoursMs,
        env: 'SESSION_COOKIE_TTL'
      },
      password: {
        doc: 'session cookie password',
        format: String,
        default: 'the-password-must-be-at-least-32-characters-long',
        env: 'SESSION_COOKIE_PASSWORD',
        sensitive: true
      },
      secure: {
        doc: 'set secure flag on cookie',
        format: Boolean,
        default: isProduction,
        env: 'SESSION_COOKIE_SECURE'
      }
    }
  },
  redis: {
    host: {
      doc: 'Redis cache host',
      format: String,
      default: '127.0.0.1',
      env: 'REDIS_HOST'
    },
    username: {
      doc: 'Redis cache username',
      format: String,
      default: '',
      env: 'REDIS_USERNAME'
    },
    password: {
      doc: 'Redis cache password',
      format: '*',
      default: '',
      sensitive: true,
      env: 'REDIS_PASSWORD'
    },
    keyPrefix: {
      doc: 'Redis cache key prefix name used to isolate the cached results across multiple clients',
      format: String,
      default: 'pesticides-poc-frontend:',
      env: 'REDIS_KEY_PREFIX'
    },
    useSingleInstanceCache: {
      doc: 'Connect to a single instance of redis instead of a cluster.',
      format: Boolean,
      default: !isProduction,
      env: 'USE_SINGLE_INSTANCE_CACHE'
    },
    useTLS: {
      doc: 'Connect to redis using TLS',
      format: Boolean,
      default: isProduction,
      env: 'REDIS_TLS'
    }
  },
  nunjucks: {
    watch: {
      doc: 'Reload templates when they are changed.',
      format: Boolean,
      default: isDevelopment
    },
    noCache: {
      doc: 'Use a cache and recompile templates each time',
      format: Boolean,
      default: isDevelopment
    }
  },
  tracing: {
    header: {
      doc: 'Which header to track',
      format: String,
      default: 'x-cdp-request-id',
      env: 'TRACING_HEADER'
    }
  },
  auth: {
    // External applicants -> Defra Customer Identity (Azure AD B2C) over OIDC.
    // See docs/auth/AUTH-ARCHITECTURE.md. `mock` needs no credentials and is the
    // default so the service runs for demos / user research out of the box.
    defraId: {
      mode: {
        doc: 'Defra Identity auth mode: mock (local identities) or live (real B2C)',
        format: ['mock', 'live'],
        default: 'mock',
        env: 'DEFRA_ID_AUTH_MODE'
      },
      wellKnownUrl: {
        doc: 'OIDC discovery (well-known) document URL',
        format: String,
        default: '',
        env: 'DEFRA_ID_WELL_KNOWN_URL'
      },
      clientId: {
        doc: 'Registered client id (also sent as an additional scope)',
        format: String,
        default: '',
        env: 'DEFRA_ID_CLIENT_ID'
      },
      clientSecret: {
        doc: 'Confidential-client secret (secure runtime only, never committed)',
        format: String,
        default: '',
        sensitive: true,
        env: 'DEFRA_ID_CLIENT_SECRET'
      },
      serviceId: {
        doc: 'Defra Identity service id (authorize parameter)',
        format: String,
        default: '',
        env: 'DEFRA_ID_SERVICE_ID'
      },
      policy: {
        doc: 'B2C policy name (authorize parameter `p`)',
        format: String,
        default: '',
        env: 'DEFRA_ID_POLICY'
      },
      publicBaseUrl: {
        doc: 'Public base URL used to build redirect URIs',
        format: String,
        default: '',
        env: 'DEFRA_ID_PUBLIC_BASE_URL'
      },
      redirectPath: {
        doc: 'Callback path registered with the IdP',
        format: String,
        default: '/auth/defra-id/callback',
        env: 'DEFRA_ID_REDIRECT_PATH'
      },
      signOutRedirectUrl: {
        doc: 'Post-logout redirect URL',
        format: String,
        default: '/',
        env: 'DEFRA_ID_SIGN_OUT_REDIRECT_URL'
      },
      // Claim contract: the exact token claim names to read. Defaults match the
      // prototype's assumed contract; override per env if the live Defra Identity
      // token uses different names (no code change needed).
      claims: {
        sub: {
          doc: 'Claim holding the stable person id (subject)',
          format: String,
          default: 'sub',
          env: 'DEFRA_ID_CLAIM_SUB'
        },
        email: {
          doc: 'Claim holding the email address',
          format: String,
          default: 'email',
          env: 'DEFRA_ID_CLAIM_EMAIL'
        },
        firstName: {
          doc: 'Claim holding the first name',
          format: String,
          default: 'firstName',
          env: 'DEFRA_ID_CLAIM_FIRST_NAME'
        },
        lastName: {
          doc: 'Claim holding the last name',
          format: String,
          default: 'lastName',
          env: 'DEFRA_ID_CLAIM_LAST_NAME'
        },
        contactId: {
          doc: 'Claim holding the contact id',
          format: String,
          default: 'contactId',
          env: 'DEFRA_ID_CLAIM_CONTACT_ID'
        },
        currentRelationshipId: {
          doc: 'Claim holding the currently-selected organisation/relationship id',
          format: String,
          default: 'currentRelationshipId',
          env: 'DEFRA_ID_CLAIM_CURRENT_RELATIONSHIP_ID'
        },
        relationships: {
          doc: 'Claim holding the list of person↔organisation relationships',
          format: String,
          default: 'relationships',
          env: 'DEFRA_ID_CLAIM_RELATIONSHIPS'
        },
        roles: {
          doc: 'Claim holding the IdP roles list',
          format: String,
          default: 'roles',
          env: 'DEFRA_ID_CLAIM_ROLES'
        },
        sessionId: {
          doc: 'Claim holding the IdP session id',
          format: String,
          default: 'sid',
          env: 'DEFRA_ID_CLAIM_SID'
        }
      }
    },
    // Internal case officers / staff -> Microsoft Entra ID. The agreed production
    // direction is SAML 2.0 SSO; this OIDC config is interim / reference and is
    // NOT yet confirmed by the Customer Identity onboarding docs.
    entra: {
      mode: {
        doc: 'Entra ID auth mode: mock or live',
        format: ['mock', 'live'],
        default: 'mock',
        env: 'ENTRA_AUTH_MODE'
      },
      tenantId: {
        doc: 'Entra tenant id (OIDC endpoints derived from the tenant authority)',
        format: String,
        default: '',
        env: 'ENTRA_TENANT_ID'
      },
      clientId: {
        doc: 'Entra application (client) id',
        format: String,
        default: '',
        env: 'ENTRA_CLIENT_ID'
      },
      clientSecret: {
        doc: 'Entra client secret (secure runtime only)',
        format: String,
        default: '',
        sensitive: true,
        env: 'ENTRA_CLIENT_SECRET'
      },
      publicBaseUrl: {
        doc: 'Public base URL used to build redirect URIs',
        format: String,
        default: '',
        env: 'ENTRA_PUBLIC_BASE_URL'
      },
      redirectPath: {
        doc: 'Callback path registered with Entra',
        format: String,
        default: '/auth/entra/callback',
        env: 'ENTRA_REDIRECT_PATH'
      },
      signOutRedirectUrl: {
        doc: 'Post-logout redirect URL',
        format: String,
        default: '/',
        env: 'ENTRA_SIGN_OUT_REDIRECT_URL'
      },
      caseOfficerRoleValue: {
        doc: 'Entra app role value that maps to the case-officer role',
        format: String,
        default: 'case_officer',
        env: 'ENTRA_CASE_OFFICER_ROLE_VALUE'
      }
    }
  }
})

config.validate({ allowed: 'strict' })
