export const openApi = {
  openapi: '3.1.0',
  info: {
    title: 'NSE Pulse API',
    version: '1.0.0',
    description:
      'Kenyan market intelligence API. Data routes report explicit empty/unconfigured states until licensed data is connected.'
  },
  servers: [{ url: '/api/v1' }],
  paths: {
    '/docs': {
      get: {
        summary: 'This OpenAPI document',
        description: 'Machine-readable description of every route this service registers.',
        responses: { '200': { description: 'OpenAPI 3.1 document' } }
      }
    },
    '/health/live': {
      get: {
        summary: 'Liveness probe',
        description:
          'Process-level check with no dependency calls. Suitable for container and orchestrator liveness probes.',
        responses: { '200': { description: 'status=ok with version, uptime, timestamp and timezone' } }
      }
    },
    '/health/ready': {
      get: {
        summary: 'Readiness probe',
        description:
          'Aggregates process, database, provider and data-freshness checks. An unconfigured database is reported as ok; a configured but unreachable database is not ok.',
        responses: {
          '200': { description: 'status=ready with per-check detail' },
          '503': { description: 'status=not_ready; a blocking check failed' }
        }
      }
    },
    '/health': {
      get: {
        summary: 'Application, database and provider health',
        responses: { '200': { description: 'Health status' } }
      }
    },
    '/market/overview': {
      get: {
        summary: 'NSE overview, session, indices and freshness',
        responses: {
          '200': { description: 'Empty arrays indicate no configured observations, not zero market activity.' }
        }
      }
    },
    '/securities': {
      get: {
        summary: 'Search configured security master',
        parameters: [
          { name: 'q', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 100 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0 } }
        ],
        responses: { '200': { description: 'Securities from database only; no static universe is implied.' } }
      }
    },
    '/quotes/{symbol}': {
      get: {
        summary: 'Latest stored quote and provenance',
        parameters: [{ name: 'symbol', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Quote or explicit unavailable reason.' },
          '400': { description: 'Invalid symbol.' }
        }
      }
    },
    '/history/{symbol}': {
      get: {
        summary: 'Historical stored observations',
        description:
          'Served independently of the live quote adapter, but withheld unless HISTORICAL_DATA_PERMISSION_CONFIRMED=true. Responses carry a permission basis and END_OF_DAY freshness label.',
        responses: { '200': { description: 'History or an explicit withheld/empty reason.' } }
      }
    },
    '/technicals/{symbol}': {
      get: {
        summary: 'Calculate technical indicators from stored historical observations',
        description: 'Uses the same historical permission gate as /history; demo fixtures are labelled and exempt.',
        parameters: [{ name: 'symbol', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Indicator values, explicit withheld state or insufficient-data reasons.' } }
      }
    },
    '/providers': {
      get: {
        summary: 'Provider adapter status',
        responses: { '200': { description: 'Provider statuses. Credentials are never included.' } }
      }
    },
    '/providers/configuration': {
      get: {
        summary: 'Provider commissioning view',
        description:
          'Provider identity, credential presence (never values), declared coverage, access level, last successful retrieval, test results and licensing requirements.',
        responses: {
          '200': {
            description:
              'Explicit unconfigured/demo state when no contracted adapter exists. No endpoint, credential value or live-data claim is invented.'
          }
        }
      }
    },
    '/providers/test': {
      post: {
        summary: 'Run local adapter connection and data-validation checks',
        description:
          'Local checks only. No outbound request is made for the bundled adapters; the response reports whether one was made.',
        responses: {
          '200': { description: 'Test results, recorded in memory, plus the refreshed configuration view.' },
          '429': { description: 'Too many test runs.' }
        }
      }
    },
    '/data-sources': {
      get: {
        summary: 'Independent data-source permissions and freshness',
        description:
          'Stored historical data, issuer announcements, the security master and the live quote feed each carry their own permission basis and freshness label.',
        responses: { '200': { description: 'Source descriptors. Availability never implies a licence.' } }
      }
    },
    '/announcements': {
      get: {
        summary: 'Official company announcements from an enabled permitted source',
        parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 50, default: 25 } }],
        responses: {
          '200': { description: 'Items with AS_PUBLISHED freshness, or an explicit permission/store/empty reason.' }
        }
      }
    }
  }
} as const;
