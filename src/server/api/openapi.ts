export const openApi = {
  openapi: '3.1.0', info: { title: 'NSE Pulse API', version: '1.0.0', description: 'Kenyan market intelligence API. Data routes report explicit empty/unconfigured states until licensed data is connected.' }, servers: [{ url: '/api/v1' }],
  paths: {
    '/health': { get: { summary: 'Application, database and provider health', responses: { '200': { description: 'Health status' } } } },
    '/market/overview': { get: { summary: 'NSE overview, session, indices and freshness', responses: { '200': { description: 'Empty arrays indicate no configured observations, not zero market activity.' } } } },
    '/securities': { get: { summary: 'Search configured security master', parameters: [{ name: 'q', in: 'query', schema: { type: 'string' } }, { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 100 } }, { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0 } }], responses: { '200': { description: 'Securities from database only; no static universe is implied.' } } } },
    '/quotes/{symbol}': { get: { summary: 'Latest stored quote and provenance', parameters: [{ name: 'symbol', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Quote or explicit unavailable reason.' }, '400': { description: 'Invalid symbol.' } } } },
    '/history/{symbol}': { get: { summary: 'Historical stored observations', responses: { '200': { description: 'History or explicit empty reason.' } } } },
    '/technicals/{symbol}': { get: { summary: 'Calculate technical indicators from stored historical observations', parameters: [{ name: 'symbol', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Indicator values or explicit insufficient-data reasons.' } } } },
    '/providers': { get: { summary: 'Provider configuration state', responses: { '200': { description: 'Provider statuses.' } } } }
  }
} as const;
