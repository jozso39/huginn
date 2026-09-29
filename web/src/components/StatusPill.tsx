import type { ItemStatus } from '../api.types';

/** A source's own state for the item, coloured the way the source colours it. */
export const StatusPill = ({ status }: { status: ItemStatus | null }) =>
  status ? <span className={`status-pill status-pill--${status.tone}`}>{status.label}</span> : null;
