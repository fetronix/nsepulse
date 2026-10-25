import type {
  AnnouncementsResponse,
  DataSourcePermission,
  DataSourcesResponse,
  DataSourceView
} from '../../shared/domain.js';
import { dataSnapshot, listIssuerAnnouncements } from '../db/repository.js';
import type { ProviderSelection } from '../providers/factory.js';
import type { ProviderSettings } from '../providers/settings.js';

function permissionForHistorical(settings: ProviderSettings): DataSourcePermission {
  return settings.historicalPermissionConfirmed
    ? { status: 'GRANTED', basis: 'Operator-confirmed written permission for stored historical display and derived analytics.' }
    : { status: 'UNCONFIRMED', basis: 'No written historical display/retention permission is recorded in the application.' };
}

function permissionForAnnouncements(settings: ProviderSettings): DataSourcePermission {
  return settings.announcementsPermissionConfirmed
    ? { status: 'GRANTED', basis: 'Operator-confirmed permission to store and republish official company announcements from an enabled source.' }
    : { status: 'UNCONFIRMED', basis: 'No announcement storage/republication permission is recorded in the application.' };
}

/**
 * Independent data-source status.
 *
 * Stored historical series and issuer announcements are usable without the live
 * quote adapter, but only when permission is explicitly recorded and the store
 * actually contains permitted records.
 */
export class DataSourceService {
  constructor(
    private readonly settings: ProviderSettings,
    private readonly selection: ProviderSelection
  ) {}

  async list(now = new Date()): Promise<DataSourcesResponse> {
    const provider = this.selection.provider;
    const demo = provider.demo;
    const status = await provider.status();
    const snapshot = await dataSnapshot();
    const historicalPermission = permissionForHistorical(this.settings);
    const announcementsPermission = permissionForAnnouncements(this.settings);
    const storedAnnouncements = this.settings.announcementsPermissionConfirmed
      ? await listIssuerAnnouncements(1)
      : null;

    let liveAvailability: DataSourceView['availability'];
    if (demo) liveAvailability = { state: 'DISABLED', message: 'Live quote adapter is disabled. The demo fixture adapter is active and provides no market data.' };
    else if (status.state === 'READY') liveAvailability = { state: 'AVAILABLE', message: 'The contracted adapter reports ready. Data validation and freshness still apply.' };
    else liveAvailability = { state: 'NOT_CONFIGURED', message: 'No authorized live quote adapter is configured or enabled.' };

    let historicalAvailability: DataSourceView['availability'];
    if (!snapshot.storeAvailable) historicalAvailability = { state: 'STORE_UNAVAILABLE', message: 'No database is configured, so no stored historical series are available.' };
    else if (historicalPermission.status !== 'GRANTED') historicalAvailability = { state: 'PERMISSION_BLOCKED', message: 'Stored series are not displayed until historical permission is confirmed.' };
    else if (!snapshot.historicalRows) historicalAvailability = { state: 'EMPTY', message: 'Permission is confirmed but no historical sessions have been imported.' };
    else historicalAvailability = { state: 'AVAILABLE', message: `${snapshot.historicalRows} stored sessions are available through the history and technicals endpoints.` };

    let announcementsAvailability: DataSourceView['availability'];
    if (!this.settings.announcementsPermissionConfirmed) announcementsAvailability = { state: 'PERMISSION_BLOCKED', message: 'Announcements are not served until storage and republication permission is confirmed.' };
    else if (storedAnnouncements === null) announcementsAvailability = { state: 'STORE_UNAVAILABLE', message: 'No database is configured, so stored announcements cannot be read.' };
    else if (!storedAnnouncements.length) announcementsAvailability = { state: 'EMPTY', message: 'No enabled official announcement source has stored items.' };
    else announcementsAvailability = { state: 'AVAILABLE', message: 'Stored official announcements from enabled sources are available.' };

    const items: DataSourceView[] = [
      {
        id: 'live-quotes',
        name: 'Live, delayed or end-of-day quote feed',
        category: 'LIVE_QUOTE',
        provider: provider.capabilities().displayName,
        permission: { status: 'NOT_REQUESTED', basis: 'No written NSE/vendor market-data entitlement is recorded. Credential presence alone grants no rights.' },
        freshness: { label: 'UNKNOWN', description: 'No access level is in force; the application makes no timeliness claim.' },
        availability: liveAvailability,
        independentOfLiveQuoteAdapter: false,
        lastRetrievedAt: null,
        notes: ['Requires a signed agreement, API specification, credentials and an implemented adapter before any quote is displayed.']
      },
      {
        id: 'historical-eod',
        name: 'Stored historical price series',
        category: 'HISTORICAL',
        provider: 'Application database (imported end-of-day records)',
        permission: historicalPermission,
        freshness: { label: 'END_OF_DAY', description: 'Daily sessions only; never intraday. Rows keep their recorded source and corporate-action adjustment flag.' },
        availability: historicalAvailability,
        independentOfLiveQuoteAdapter: true,
        lastRetrievedAt: snapshot.latestHistoricalSessionDate,
        notes: [
          'Served by /history and /technicals regardless of the live quote adapter.',
          'An automated ingestion pipeline is not implemented; records must be imported from a permitted source.',
          'Historical data is not adjusted for corporate actions unless the stored row says so.'
        ]
      },
      {
        id: 'issuer-announcements',
        name: 'Official company announcements',
        category: 'ANNOUNCEMENTS',
        provider: 'Enabled announcement sources in the application database',
        permission: announcementsPermission,
        freshness: { label: 'AS_PUBLISHED', description: 'Shown with the publisher and publication timestamp supplied by the source; no quote-time freshness is implied.' },
        availability: announcementsAvailability,
        independentOfLiveQuoteAdapter: true,
        lastRetrievedAt: null,
        notes: [
          'No public page is scraped; an operator must register an official, permitted source and mark it enabled.',
          'Announcements are not trading prices and must not be interpreted as market quotes.'
        ]
      },
      {
        id: 'security-master',
        name: 'Security master',
        category: 'REFERENCE',
        provider: 'Reviewed CSV import into the application database',
        permission: { status: 'UNCONFIRMED', basis: 'Import is operator-initiated; reuse permission for the source list is not recorded in the application.' },
        freshness: { label: 'REFERENCE', description: 'Static listing records with a recorded source and verification time; not a price.' },
        availability: !snapshot.storeAvailable
          ? { state: 'STORE_UNAVAILABLE', message: 'No database is configured, so no security master is available.' }
          : snapshot.securities
            ? { state: 'AVAILABLE', message: `${snapshot.securities} reviewed listing records are stored.` }
            : { state: 'EMPTY', message: 'The security master is empty; import a reviewed official list to populate it.' },
        independentOfLiveQuoteAdapter: true,
        lastRetrievedAt: null,
        notes: ['Records require review and carry their import source; symbols change and delist over time.']
      }
    ];

    return {
      generatedAt: now.toISOString(),
      items,
      notes: [
        'Each source carries its own permission state and freshness label; none inherits another source\'s rights or timeliness.',
        'A source being available is not a statement that it is licensed for every use. Review the permission basis before publishing.'
      ]
    };
  }

  async announcements(limit = 25): Promise<AnnouncementsResponse> {
    const permission = permissionForAnnouncements(this.settings);
    const freshness = { label: 'AS_PUBLISHED' as const, description: 'Reproduced as published by the issuing company with the source publication timestamp; not a price and not refreshed on a quote interval.' };
    if (!this.settings.announcementsPermissionConfirmed) {
      return {
        state: 'PERMISSION_UNCONFIRMED',
        reason: 'Announcement storage and republication permission has not been confirmed by an operator. No announcements are served.',
        permission,
        freshness,
        items: []
      };
    }
    const rows = await listIssuerAnnouncements(limit);
    if (rows === null) {
      return { state: 'STORE_UNAVAILABLE', reason: 'No database is configured, so stored announcements cannot be read.', permission, freshness, items: [] };
    }
    if (!rows.length) {
      return { state: 'EMPTY', reason: 'No enabled official announcement source has stored items.', permission, freshness, items: [] };
    }
    return {
      state: 'OK',
      reason: null,
      permission,
      freshness,
      items: rows.map((row) => ({
        id: row.id,
        symbol: null,
        title: row.title,
        publisher: row.publisher,
        sourceUrl: row.originalUrl,
        publishedAt: row.publishedAt?.toISOString() ?? null,
        sourceType: row.sourceType,
        verified: row.verified,
        freshness: 'AS_PUBLISHED' as const
      }))
    };
  }
}
