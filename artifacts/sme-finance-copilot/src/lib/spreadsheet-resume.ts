export const SPREADSHEET_RESUME_QUERY = 'resume';

export interface SpreadsheetResumeEvidence {
  id: string;
  profileId: string;
  evidenceType?: string;
  documentLifecycle?: string;
  importStatus?: string;
}

export function readSpreadsheetResumeEvidenceId(location: string): string | null {
  const queryStart = location.indexOf('?');
  if (queryStart < 0) return null;
  const hashStart = location.indexOf('#', queryStart);
  const query = location.slice(queryStart + 1, hashStart < 0 ? undefined : hashStart);
  const evidenceId = new URLSearchParams(query).get(SPREADSHEET_RESUME_QUERY)?.trim();
  return evidenceId || null;
}

export function setSpreadsheetResumeEvidenceId(location: string, evidenceId: string | null): string {
  const hashStart = location.indexOf('#');
  const hash = hashStart < 0 ? '' : location.slice(hashStart);
  const withoutHash = hashStart < 0 ? location : location.slice(0, hashStart);
  const queryStart = withoutHash.indexOf('?');
  const pathname = queryStart < 0 ? withoutHash : withoutHash.slice(0, queryStart);
  const query = queryStart < 0 ? '' : withoutHash.slice(queryStart + 1);
  const params = new URLSearchParams(query);

  if (evidenceId) params.set(SPREADSHEET_RESUME_QUERY, evidenceId);
  else params.delete(SPREADSHEET_RESUME_QUERY);

  const nextQuery = params.toString();
  return `${pathname}${nextQuery ? `?${nextQuery}` : ''}${hash}`;
}

export function isResumableSpreadsheetEvidence(
  item: SpreadsheetResumeEvidence,
  activeProfileId: string,
): boolean {
  return item.profileId === activeProfileId
    && item.evidenceType === 'ledger'
    && item.documentLifecycle === 'active'
    && item.importStatus !== 'done';
}

export function findSpreadsheetResumeEvidence<T extends SpreadsheetResumeEvidence>(
  location: string,
  activeProfileId: string,
  evidenceItems: T[],
): T | null {
  const requestedId = readSpreadsheetResumeEvidenceId(location);
  if (!requestedId) return null;
  const item = evidenceItems.find(candidate => candidate.id === requestedId);
  return item && isResumableSpreadsheetEvidence(item, activeProfileId) ? item : null;
}