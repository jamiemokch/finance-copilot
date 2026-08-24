import React, { useMemo } from 'react';
import { Button, Badge } from '@/components/ui';
import { AlertCircle, CheckCircle2, ChevronDown, Eye, SlidersHorizontal } from 'lucide-react';

export type ReviewRole = 'transactional' | 'non_transactional' | 'mixed' | 'unknown';
export type SheetResolution = 'include_income' | 'include_expense' | 'reference_only' | 'duplicate_sheet' | 'leave_out';
export type GuidedSpreadsheetServerIssue = {
  sheetId?: string;
  worksheet?: string;
  rowNumber?: number;
  field?: string;
  message: string;
};

export type GuidedReviewSheet = {
  sheetId: string;
  displayName: string;
  selected: boolean;
  role: ReviewRole;
  reviewRequired: boolean;
  dimensions: { rows: number; columns: number };
  mapping: { headerRow?: number; columns: Record<string, number | undefined> };
  previewRows: Array<{ rowNumber: number; values: string[] }>;
  rows: Array<{
    sourceRow: number;
    primaryDisposition: string;
    normalizedValueReference: { date: string | null; amount: number | null; description: string | null };
  }>;
};

type FieldName = 'date' | 'amount' | 'debit' | 'credit' | 'description' | 'category';

export function needsNamedColumns(sheet: GuidedReviewSheet) {
  const columns = sheet.mapping.columns;
  return columns.date === undefined
    || (columns.amount === undefined && columns.debit === undefined && columns.credit === undefined)
    || (columns.description === undefined && columns.category === undefined);
}

export function unresolvedReviewSheets(
  sheets: GuidedReviewSheet[],
  resolutions: Record<string, SheetResolution>,
) {
  return sheets.filter((sheet) => {
    const resolution = resolutions[sheet.sheetId];
    const includesSheet = resolution === 'include_income' || resolution === 'include_expense';
    const needsAnAnswer = sheet.reviewRequired || sheet.role === 'unknown' || (includesSheet && needsNamedColumns(sheet));
    return needsAnAnswer && (!resolution || (includesSheet && needsNamedColumns(sheet)));
  });
}

export function confirmationBlockersForReview({
  unresolvedSheetNames,
  selectedSheetCount,
  taxYearCount,
  incompleteRowCount,
  incompleteRowsAcknowledged,
}: {
  unresolvedSheetNames: string[];
  selectedSheetCount: number;
  taxYearCount: number;
  incompleteRowCount: number;
  incompleteRowsAcknowledged: boolean;
}) {
  return [
    ...unresolvedSheetNames.map((name) => `Answer the question about “${name}”.`),
    ...(selectedSheetCount === 0 ? ['Choose at least one sheet to include.'] : []),
    ...(taxYearCount === 0 ? ['Choose the tax year these records support.'] : []),
    ...(incompleteRowCount > 0 && !incompleteRowsAcknowledged ? [`Decide how to handle ${incompleteRowCount} incomplete row${incompleteRowCount === 1 ? '' : 's'}.`] : []),
  ];
}

function headerFor(sheet: GuidedReviewSheet, column: number | undefined) {
  if (column === undefined) return null;
  const header = sheet.previewRows.find((row) => row.rowNumber === (sheet.mapping.headerRow ?? 0) + 1);
  return header?.values[column]?.trim() || `column ${column + 1}`;
}

function moneyDescription(sheet: GuidedReviewSheet) {
  const { amount, debit, credit } = sheet.mapping.columns;
  if (amount !== undefined) return `one amount column (“${headerFor(sheet, amount)}”)`;
  if (debit !== undefined && credit !== undefined) return `money out (“${headerFor(sheet, debit)}”) and money in (“${headerFor(sheet, credit)}”) columns`;
  if (debit !== undefined) return `a money-out column (“${headerFor(sheet, debit)}”)`;
  if (credit !== undefined) return `a money-in column (“${headerFor(sheet, credit)}”)`;
  return null;
}

function issueText(sheet: GuidedReviewSheet) {
  const { date, amount, debit, credit, description, category } = sheet.mapping.columns;
  const missing: string[] = [];
  if (date === undefined) missing.push('which column contains the date of each entry');
  if (amount === undefined && debit === undefined && credit === undefined) missing.push('which column contains the money amount');
  if (description === undefined && category === undefined) missing.push('what each entry is for');
  const examples = sheet.previewRows.filter((row) => row.values.some((value) => value.trim())).slice(0, 4);
  const appears = date !== undefined || amount !== undefined || debit !== undefined || credit !== undefined
    ? 'It appears to be a list with some transaction-like information.'
    : 'We can see values on this sheet, but cannot tell whether it is a list of individual payments or a summary.';
  const missingText = missing.length
    ? `We still cannot tell ${missing.join(', ')}.`
    : 'We cannot safely tell whether this is a separate list of payments or repeats information from another sheet.';
  return { appears, missingText, examples };
}

function SheetPreview({ sheet }: { sheet: GuidedReviewSheet }) {
  const rows = issueText(sheet).examples;
  const width = Math.min(Math.max(...rows.map((row) => row.values.length), 0), 6);
  if (!rows.length || !width) return null;
  return <div className="overflow-x-auto rounded-lg border bg-white">
    <table className="w-full text-xs">
      <tbody>{rows.map((row) => <tr key={row.rowNumber} className="border-t first:border-t-0">
        {Array.from({ length: width }, (_, index) => <td key={index} className="max-w-40 truncate px-2 py-1.5">
          {row.values[index] || '—'}
        </td>)}
      </tr>)}</tbody>
    </table>
  </div>;
}

function FieldExplanation({ sheet, field, label, onCorrect }: { sheet: GuidedReviewSheet; field: FieldName; label: string; onCorrect: () => void }) {
  const column = sheet.mapping.columns[field];
  const fallback = field === 'date'
    ? 'We could not identify a date column.'
    : field === 'description' || field === 'category'
      ? 'We could not identify what each entry is for.'
      : 'We could not identify a money column.';
  return <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-white p-2.5">
    <p className="text-sm"><strong>{label}:</strong> {column === undefined ? fallback : `using “${headerFor(sheet, column)}”`}</p>
    <Button size="sm" variant="outline" onClick={onCorrect}>Choose another column</Button>
  </div>;
}

export function GuidedSpreadsheetReview({
  sheets,
  selectedSheetIds,
  resolutions,
  saving,
  checkingSheetId,
  onCheckingSheet,
  onResolve,
  onCorrect,
}: {
  sheets: GuidedReviewSheet[];
  selectedSheetIds: string[];
  resolutions: Record<string, SheetResolution>;
  saving: boolean;
  checkingSheetId: string;
  onCheckingSheet: (sheetId: string) => void;
  onResolve: (sheet: GuidedReviewSheet, resolution: SheetResolution) => void;
  onCorrect: (sheetId: string) => void;
}) {
  const selected = useMemo(() => new Set(selectedSheetIds), [selectedSheetIds]);
  const ready = sheets.filter((sheet) =>
    selected.has(sheet.sheetId)
    && !sheet.reviewRequired
    && sheet.role === 'transactional'
    && !needsNamedColumns(sheet),
  );
  const questions = unresolvedReviewSheets(sheets, resolutions);
  return <div className="space-y-5">
    <section className="rounded-xl border p-4 space-y-3">
      <div>
        <p className="font-medium">What we found</p>
        <p className="text-xs text-muted-foreground">These are the sheets that look like individual money records. You can check the details without changing anything.</p>
      </div>
      {ready.length ? <div className="space-y-2">{ready.map((sheet) => <div key={sheet.sheetId} className="rounded-lg border border-primary/20 bg-primary/[.03] p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><p className="text-sm font-medium">{sheet.displayName}</p><p className="text-xs text-muted-foreground">Looks like individual money records</p></div>
          <div className="flex items-center gap-2"><Badge variant="outline">Ready to include</Badge><Button size="sm" variant="outline" disabled={saving} onClick={() => onCheckingSheet(checkingSheetId === sheet.sheetId ? '' : sheet.sheetId)}><Eye className="mr-1.5 h-3.5 w-3.5" />Check what we found</Button></div>
        </div>
        {checkingSheetId === sheet.sheetId && <div className="mt-3 space-y-2 rounded-lg bg-white/80 p-3">
          <p className="text-sm">We found a date in <strong>“{headerFor(sheet, sheet.mapping.columns.date)}”</strong>, {moneyDescription(sheet)}, and a description in <strong>“{headerFor(sheet, sheet.mapping.columns.description ?? sheet.mapping.columns.category)}”</strong>.</p>
          <SheetPreview sheet={sheet} />
          <div className="grid gap-2 sm:grid-cols-3">
            <FieldExplanation sheet={sheet} field="date" label="Date" onCorrect={() => onCorrect(sheet.sheetId)} />
            <FieldExplanation sheet={sheet} field={sheet.mapping.columns.amount !== undefined ? 'amount' : sheet.mapping.columns.debit !== undefined ? 'debit' : 'credit'} label="Money" onCorrect={() => onCorrect(sheet.sheetId)} />
            <FieldExplanation sheet={sheet} field={sheet.mapping.columns.description !== undefined ? 'description' : 'category'} label="What it was for" onCorrect={() => onCorrect(sheet.sheetId)} />
          </div>
        </div>}
      </div>)}</div> : <p className="text-sm text-muted-foreground">No sheets can be included automatically yet.</p>}
    </section>

    {questions.length > 0 && <section aria-label="Questions to answer" className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3 text-amber-950">
      <div><p className="font-medium">A few questions before we can import safely</p><p className="text-sm">Each question below explains exactly what we need from you. Nothing will be added until these are answered.</p></div>
      {questions.map((sheet) => {
        const issue = issueText(sheet);
        const choice = resolutions[sheet.sheetId];
        return <article id={`sheet-issue-${sheet.sheetId}`} tabIndex={-1} key={sheet.sheetId} className="rounded-xl border border-amber-200 bg-white p-4 space-y-3">
          <div className="flex gap-2"><AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" /><div><h3 className="font-semibold">{sheet.displayName}</h3><p className="mt-1 text-sm">{issue.appears} {issue.missingText}</p></div></div>
          <SheetPreview sheet={sheet} />
          {choice ? <div className="space-y-2"><p className="rounded-lg bg-emerald-50 p-2 text-sm text-emerald-900"><CheckCircle2 className="mr-1 inline h-4 w-4" />Your choice is saved: {choice === 'include_income' ? 'include as income records for review' : choice === 'include_expense' ? 'include as expense records for review' : choice === 'reference_only' ? 'leave out as a summary or reference sheet' : choice === 'duplicate_sheet' ? 'leave out because it duplicates another sheet' : 'leave it out for now'}.</p>{(choice === 'include_income' || choice === 'include_expense') && needsNamedColumns(sheet) && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm"><strong>One more step:</strong> choose the named date, money, and description columns before this sheet can be included. <Button size="sm" className="ml-2" variant="outline" disabled={saving} onClick={() => onCorrect(sheet.sheetId)}>Choose columns</Button></div>}</div> : <div className="grid gap-2 sm:grid-cols-2">
            <Button variant="outline" disabled={saving} onClick={() => onResolve(sheet, 'include_income')}>Include as income records</Button>
            <Button variant="outline" disabled={saving} onClick={() => onResolve(sheet, 'include_expense')}>Include as expense records</Button>
            <Button variant="outline" disabled={saving} onClick={() => onResolve(sheet, 'reference_only')}>This is only a summary or reference sheet</Button>
            <Button variant="outline" disabled={saving} onClick={() => onResolve(sheet, 'duplicate_sheet')}>This duplicates another sheet</Button>
            <Button variant="outline" disabled={saving} onClick={() => onResolve(sheet, 'leave_out')}>I’m not sure — leave it out for now</Button>
            <Button variant="outline" disabled={saving} onClick={() => onCorrect(sheet.sheetId)}><SlidersHorizontal className="mr-1.5 h-3.5 w-3.5" />Use another named column</Button>
          </div>}
        </article>;
      })}
    </section>}
  </div>;
}

export function ImportChecklist({
  selectedSheets,
  leftOutCount,
  taxYears,
  unresolved,
}: {
  selectedSheets: GuidedReviewSheet[];
  leftOutCount: number;
  taxYears: string[];
  unresolved: string[];
}) {
  return <section className="rounded-xl border p-4 space-y-3" aria-label="Import checklist">
    <div><p className="font-medium">Before we add anything</p><p className="text-sm text-muted-foreground">Here is the plan you are confirming.</p></div>
    <ul className="space-y-1.5 text-sm">
      <li><CheckCircle2 className="mr-2 inline h-4 w-4 text-emerald-600" />Add records from: {selectedSheets.length ? selectedSheets.map((sheet) => sheet.displayName).join(', ') : 'none yet'}.</li>
      <li><ChevronDown className="mr-2 inline h-4 w-4 text-muted-foreground" />Leave out {leftOutCount} sheet{leftOutCount === 1 ? '' : 's'} for now.</li>
      <li><CheckCircle2 className="mr-2 inline h-4 w-4 text-emerald-600" />Tax year{taxYears.length === 1 ? '' : 's'} found: {taxYears.join(', ') || 'not available yet'}.</li>
    </ul>
    {unresolved.length > 0 && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"><strong>Still needed before import:</strong><ul className="mt-1 list-disc pl-5">{unresolved.map((item) => <li key={item}>{item}</li>)}</ul></div>}
  </section>;
}

export function SpreadsheetServerIssues({
  issues,
  onShowSheet,
}: {
  issues: GuidedSpreadsheetServerIssue[];
  onShowSheet: (sheetId: string) => void;
}) {
  if (!issues.length) return null;
  return <div className="space-y-2" aria-label="Questions from the final check">{issues.map((issue, index) => <div key={`${issue.sheetId ?? 'workbook'}-${index}`} className="rounded-lg border border-current/20 bg-white/70 p-3">
    <p className="font-medium">{issue.worksheet ?? 'This spreadsheet'}</p>
    <p>{issue.message}</p>
    {issue.sheetId && <Button size="sm" className="mt-2" variant="outline" onClick={() => onShowSheet(issue.sheetId!)}>Show this sheet</Button>}
  </div>)}</div>;
}