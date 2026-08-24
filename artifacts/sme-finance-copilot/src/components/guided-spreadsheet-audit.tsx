import React from 'react';

export type GuidedSpreadsheetAuditSheet = {
  sheetId: string;
  displayName: string;
  dimensions: { rows: number; columns: number };
  disposition: string;
  role: 'transactional' | 'non_transactional' | 'mixed' | 'unknown';
  confidence: number;
};

export function GuidedSpreadsheetAudit({
  advancedOpen,
  sheets,
  aiDetail,
  selectedSheetIds,
  sheetRoleOverrides,
  saving,
  editingAllowed = true,
  onToggle,
  onToggleSheet,
  onSetRole,
  onCorrectSheet,
}: {
  advancedOpen: boolean;
  sheets: GuidedSpreadsheetAuditSheet[];
  aiDetail?: string | null;
  selectedSheetIds: string[];
  sheetRoleOverrides: Record<string, GuidedSpreadsheetAuditSheet['role']>;
  saving: boolean;
  editingAllowed?: boolean;
  onToggle: (open: boolean) => void;
  onToggleSheet: (sheetId: string, checked: boolean) => void;
  onSetRole: (sheetId: string, role: GuidedSpreadsheetAuditSheet['role']) => void;
  onCorrectSheet: (sheetId: string) => void;
}) {
  return <details data-testid="advanced-audit-details" className="rounded-xl border p-4" open={advancedOpen} onToggle={(event) => onToggle((event.target as HTMLDetailsElement).open)}>
    <summary className="cursor-pointer font-medium">Advanced audit details</summary>
    {advancedOpen && <div data-testid="worksheet-inventory" className="mt-4 space-y-3 text-sm">
      <p className="text-muted-foreground">Every worksheet is kept here for traceability. Including a sheet or changing its role is a saved decision; it is never imported until final confirmation.</p>
      {aiDetail && <p className="text-xs text-muted-foreground">Suggestion detail: {aiDetail}</p>}
      {sheets.map((sheet) => <div key={sheet.sheetId} className="rounded-lg border p-3 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span><strong>{sheet.displayName}</strong> · {sheet.dimensions.rows} rows × {sheet.dimensions.columns} columns</span>
          <span className="text-xs text-muted-foreground">{sheet.role.replace('_', ' ')} · {sheet.confidence}% confidence</span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={selectedSheetIds.includes(sheet.sheetId)} disabled={saving || !editingAllowed || sheet.disposition === 'empty_sheet'} onChange={(event) => onToggleSheet(sheet.sheetId, event.target.checked)} />
            Include in review
          </label>
          <label className="flex items-center gap-2">Role
            <select disabled={saving || !editingAllowed} className="w-44" value={sheetRoleOverrides[sheet.sheetId] ?? sheet.role} onChange={(event) => onSetRole(sheet.sheetId, event.target.value as GuidedSpreadsheetAuditSheet['role'])}>
              <option value="transactional">Transaction records</option>
              <option value="non_transactional">Reference only</option>
              <option value="mixed">Mixed content</option>
              <option value="unknown">Not sure yet</option>
            </select>
          </label>
           <button type="button" disabled={saving || !editingAllowed} onClick={() => onCorrectSheet(sheet.sheetId)}>Correct columns</button>
        </div>
      </div>)}
    </div>}
  </details>;
}