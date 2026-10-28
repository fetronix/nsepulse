/**
 * Status vocabulary for the provider screens.
 *
 * Kept out of the component file so a tone or a timestamp format can be reused (and tested)
 * without pulling in React.
 */

export function statusTone(value: string) {
  if (['READY', 'PASSED', 'AVAILABLE', 'GRANTED', 'SATISFIED', 'CONFIGURED'].includes(value)) return 'green-pill';
  if (
    [
      'UNCONFIGURED',
      'NOT_RUN',
      'MISSING',
      'NOT_CONFIGURED',
      'NOT_REQUESTED',
      'OUTSTANDING',
      'EMPTY',
      'DISABLED'
    ].includes(value)
  )
    return 'amber-pill';
  if (
    [
      'DEMO',
      'BLOCKED',
      'PERMISSION_BLOCKED',
      'STORE_UNAVAILABLE',
      'IN_PROGRESS',
      'UNCONFIRMED',
      'NOT_APPLICABLE'
    ].includes(value)
  )
    return 'muted-pill';
  if (['ERROR', 'FAILED'].includes(value)) return 'red-pill';
  return 'muted-pill';
}

export function formatSetupTime(value: string | null | undefined) {
  if (!value) return 'Never recorded';
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('en-KE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Nairobi' }).format(
        date
      ) + ' EAT'
    : 'Invalid timestamp';
}
