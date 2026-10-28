/**
 * The status pill. Colour comes from a known list of states, so an unrecognised status is
 * neutral rather than accidentally green.
 */
import { statusTone } from './status.js';

export function Pill({ value }: { value: string }) {
  return <span className={`pill ${statusTone(value)}`}>{value.replaceAll('_', ' ')}</span>;
}
