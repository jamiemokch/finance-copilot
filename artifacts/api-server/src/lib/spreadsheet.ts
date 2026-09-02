import { parse } from 'csv-parse/sync';
import * as XLSX from 'xlsx';
import { createHash } from 'node:crypto';

export type SpreadsheetMapping = {
  /** Zero-based source row; retained for legacy import compatibility. */
  headerRow?: number;
  columns: {
    date?: number;
    amount?: number;
    debit?: number;
    credit?: number;
    description?: number;
    category?: number;
    balance?: number;
  };
};

export const SPREADSHEET_PARSER_VERSION = 'spreadsheet-parser.v2';
export const MAX_LOCAL_WORKSHEETS = 100;
export const MAX_AI_WORKSHEETS = 20;
export const MAX_AI_SAMPLE_ROWS = 30;
export const MAX_AI_SAMPLE_CELLS = 600;
export const MAX_AI_CELL_CHARS = 160;

export type RowDisposition =
  | 'imported' | 'duplicate' | 'invalid' | 'header' | 'blank'
  | 'balance_total' | 'non_transactional' | 'excluded_by_user'
  | 'excluded_by_rule' | 'unmapped' | 'outside_scope'
  | 'pre_trading_start' | 'unselected_sheet';

export type SheetDisposition =
  | 'processed' | 'unselected_sheet' | 'empty_sheet' | 'non_transactional'
  | 'excluded_by_user' | 'excluded_by_rule' | 'blocked_invalid_mapping'
  | 'not_analysed';

export type SpreadsheetCell = {
  columnId: string;
  columnIndex: number;
  value: string;
  formula?: string;
  formulaValue?: string;
  hasStyle: boolean;
  merged: boolean;
  mergeTopLeft?: { rowNumber: number; columnId: string };
};

export type SpreadsheetSourceRow = {
  rowNumber: number;
  cells: SpreadsheetCell[];
  values: string[];
  hidden: boolean;
  hasFormula: boolean;
  hasStyle: boolean;
  merged: boolean;
  physicalLineStart?: number;
  physicalLineEnd?: number;
};

export type SpreadsheetSheet = {
  sheetId: string;
  displayName: string;
  index: number;
  rowCount: number;
  columnCount: number;
  parserRange: { startRow: number; endRow: number; startColumn: number; endColumn: number } | null;
  rows: SpreadsheetSourceRow[];
  headers: string[];
  inferredHeaderRow: number | null;
  isEmpty: boolean;
  structural: {
    populatedArea: { startRow: number; endRow: number; startColumn: number; endColumn: number } | null;
    nonEmptyCellCount: number;
    formulaCount: number;
    mergedCellCount: number;
    mergedRangeCount: number;
    styledCellCount: number;
    hiddenRowCount: number;
  };
};

export type SpreadsheetWorkbook = {
  contentHash?: string;
  sourceByteLength: number;
  fileType: 'csv' | 'xls' | 'xlsx';
  filename?: string;
  sheets: SpreadsheetSheet[];
  totalParserRows: number;
  totalParserCells: number;
};

export type SpreadsheetRowFinding = {
  sheetId: string;
  displaySheetName: string;
  sourceRow: number;
  primaryDisposition: RowDisposition;
  secondaryFindings: string[];
  reason: string;
  rawValueReference: { sheetId: string; rowNumber: number; cellCount: number };
  normalizedValueReference: { date: string | null; amount: number | null; description: string | null };
  taxYear: string | null;
  duplicateFingerprint?: string;
  validationErrors?: string[];
};

export type SpreadsheetSheetAnalysis = {
  sheetId: string;
  displayName: string;
  dimensions: { rows: number; columns: number };
  parserRange: SpreadsheetSheet['parserRange'];
  disposition: SheetDisposition;
  selected: boolean;
  role: 'transactional' | 'non_transactional' | 'mixed' | 'unknown';
  confidence: number;
  reviewRequired: boolean;
  auditVisibility: 'default' | 'advanced';
  decisionSource: 'structural' | 'deterministic' | 'ai' | 'user' | 'manual_recovery';
  finalDisposition: 'transactional' | 'summary' | 'reference' | 'duplicate' | 'excluded' | 'unresolved' | 'not_analysed';
  mapping: SpreadsheetMapping;
  columnIds: string[];
  previewRows: SpreadsheetSourceRow[];
  rows: SpreadsheetRowFinding[];
  coverage: { status: 'known' | 'partial' | 'unknown'; startDate: string | null; endDate: string | null; rowRefs: Array<{ sheetId: string; rowNumber: number }> };
  taxYears: Array<{ taxYear: string; rowRefs: Array<{ sheetId: string; rowNumber: number }> }>;
  warnings: string[];
};

export type SpreadsheetAnalysis = {
  parserVersion: string;
  workbook: SpreadsheetWorkbook;
  sheets: SpreadsheetSheetAnalysis[];
  coverage: { status: 'known' | 'partial' | 'unknown'; startDate: string | null; endDate: string | null; rowRefs: Array<{ sheetId: string; rowNumber: number }> };
  taxYears: string[];
  dispositionCounts: Record<RowDisposition, number>;
  warnings: string[];
};

/**
 * Normalise CSV and Excel uploads into rows of strings. The first row is kept
 * as-is so callers can let the user/AI identify the header row.
 */
export function parseSpreadsheet(buffer: Buffer, mimeType: string, filename = ''): string[][] {
  const isExcel =
    mimeType.includes('spreadsheet') ||
    mimeType.includes('excel') ||
    /\.(xlsx|xls|xlsm)$/i.test(filename);

  if (isExcel) {
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!firstSheet) return [];
    return XLSX.utils.sheet_to_json(firstSheet, {
      header: 1,
      raw: false,
      defval: '',
    }) as string[][];
  }

  return parse(buffer.toString('utf8'), {
    skip_empty_lines: false,
    relax_column_count: true,
    bom: true,
  }).map((row: unknown[]) => row.map((cell) => String(cell ?? '')));
}

function isExcelFile(mimeType: string, filename: string) {
  return mimeType.includes('spreadsheet') || mimeType.includes('excel') || /\.(xlsx|xls|xlsm)$/i.test(filename);
}

function columnName(index: number): string {
  let value = '';
  let current = index + 1;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    value = String.fromCharCode(65 + remainder) + value;
    current = Math.floor((current - 1) / 26);
  }
  return value;
}

function cellId(index: number) {
  return `col_${columnName(index)}`;
}

function safeCellText(cell: any): { value: string; formula?: string; formulaValue?: string; hasStyle: boolean } {
  const hasFormula = typeof cell?.f === 'string';
  const calculated = cell?.v === undefined || cell?.v === null ? '' : XLSX.utils.format_cell(cell);
  return {
    value: String(calculated ?? ''),
    ...(hasFormula ? { formula: cell.f, formulaValue: calculated || undefined } : {}),
    hasStyle: Boolean(cell?.s && (typeof cell.s === 'object' ? Object.keys(cell.s).length : cell.s)),
  };
}

function rangeForSheet(sheet: any): { startRow: number; endRow: number; startColumn: number; endColumn: number } | null {
  let range: any = null;
  if (sheet?.['!ref']) {
    try { range = XLSX.utils.decode_range(sheet['!ref']); } catch { range = null; }
  }
  let startRow = range?.s.r ?? Number.POSITIVE_INFINITY;
  let endRow = range?.e.r ?? -1;
  let startColumn = range?.s.c ?? Number.POSITIVE_INFINITY;
  let endColumn = range?.e.c ?? -1;
  for (const key of Object.keys(sheet ?? {})) {
    if (key.startsWith('!')) continue;
    let address: any;
    try { address = XLSX.utils.decode_cell(key); } catch { continue; }
    startRow = Math.min(startRow, address.r);
    endRow = Math.max(endRow, address.r);
    startColumn = Math.min(startColumn, address.c);
    endColumn = Math.max(endColumn, address.c);
  }
  const hiddenRows = Array.isArray(sheet?.['!rows']) ? sheet['!rows'] : [];
  hiddenRows.forEach((row: any, index: number) => {
    if (row) { startRow = Math.min(startRow, index); endRow = Math.max(endRow, index); }
  });
  if (range?.s && range?.e) {
    for (const merge of sheet['!merges'] ?? []) {
      startRow = Math.min(startRow, merge.s.r);
      endRow = Math.max(endRow, merge.e.r);
      startColumn = Math.min(startColumn, merge.s.c);
      endColumn = Math.max(endColumn, merge.e.c);
    }
  }
  if (endRow < 0 || endColumn < 0 || !Number.isFinite(startRow) || !Number.isFinite(startColumn)) return null;
  return { startRow: startRow + 1, endRow: endRow + 1, startColumn: startColumn + 1, endColumn: endColumn + 1 };
}

function mergeRangeForCell(sheet: any, row: number, column: number) {
  return (sheet?.['!merges'] ?? []).find((item: any) =>
    row >= item.s.r && row <= item.e.r && column >= item.s.c && column <= item.e.c);
}

function inspectExcel(buffer: Buffer, filename: string): SpreadsheetWorkbook {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false, cellNF: true, cellFormula: true, cellStyles: true });
  if (workbook.SheetNames.length > MAX_LOCAL_WORKSHEETS) {
    throw new Error(`This workbook contains more than ${MAX_LOCAL_WORKSHEETS} worksheets. Split it before importing.`);
  }
  const sheets = workbook.SheetNames.map((displayName, index) => {
    const source = workbook.Sheets[displayName] as any;
    const parserRange = rangeForSheet(source);
    const rows: SpreadsheetSourceRow[] = [];
    const startRow = parserRange?.startRow ?? 1;
    const endRow = parserRange?.endRow ?? 0;
    const startColumn = parserRange?.startColumn ?? 1;
    const endColumn = parserRange?.endColumn ?? 0;
    const merges = source?.['!merges'] ?? [];
    // Excel's !ref is a rectangular extent, not a list of physical records.
    // Expanding a sparse sheet with a final cell on row 1,048,576 would invent
    // more than a million blank source rows and make an audit unsafe to retain.
    // Preserve every actual cell/style/hidden/merged row instead; CSV blank
    // records remain physical source rows and are handled separately.
    const sourceRowNumbers = new Set<number>();
    for (const key of Object.keys(source ?? {})) {
      if (key.startsWith('!')) continue;
      try { sourceRowNumbers.add(XLSX.utils.decode_cell(key).r + 1); } catch { /* ignore non-cell worksheet metadata */ }
    }
    (source?.['!rows'] ?? []).forEach((metadata: unknown, index: number) => {
      if (metadata) sourceRowNumbers.add(index + 1);
    });
    for (const merge of merges) {
      for (let rowIndex = merge.s.r + 1; rowIndex <= merge.e.r + 1; rowIndex += 1) sourceRowNumbers.add(rowIndex);
    }
    for (const rowIndex of [...sourceRowNumbers].sort((left, right) => left - right)) {
      const cells: SpreadsheetCell[] = [];
      for (let columnIndex = startColumn; columnIndex <= endColumn; columnIndex += 1) {
        const address = XLSX.utils.encode_cell({ r: rowIndex - 1, c: columnIndex - 1 });
        const raw = source?.[address];
        const text = safeCellText(raw);
        const merge = mergeRangeForCell(source, rowIndex - 1, columnIndex - 1);
        const mergeTopLeft = merge ? { rowNumber: merge.s.r + 1, columnId: cellId(merge.s.c) } : undefined;
        const merged = Boolean(merge);
        const isAnchor = !merge || (merge.s.r === rowIndex - 1 && merge.s.c === columnIndex - 1);
        // Excel stores a merged range's value only on its anchor (top-left) cell; every
        // other member cell is blank in the file. Backfilling that known anchor value into
        // an otherwise-blank member cell is mechanical, not an inference: it never overrides
        // a cell that already carries its own value.
        const value = isAnchor || text.value ? text.value
          : safeCellText(source?.[XLSX.utils.encode_cell({ r: merge.s.r, c: merge.s.c })]).value;
        cells.push({
          columnId: cellId(columnIndex - 1), columnIndex: columnIndex - 1,
          value, ...(text.formula ? { formula: text.formula } : {}),
          ...(text.formulaValue ? { formulaValue: text.formulaValue } : {}),
          hasStyle: text.hasStyle, merged, ...(mergeTopLeft ? { mergeTopLeft } : {}),
        });
      }
      const metadata = source?.['!rows']?.[rowIndex - 1];
      rows.push({
        rowNumber: rowIndex, cells, values: cells.map((cell) => cell.value),
        hidden: Boolean(metadata?.hidden), hasFormula: cells.some((cell) => Boolean(cell.formula)),
        hasStyle: cells.some((cell) => cell.hasStyle), merged: cells.some((cell) => cell.merged),
      });
    }
    const inferredHeader = inferHeaderRow(rows);
    const headers = inferredHeader?.values ?? [];
    const inferredHeaderRow = inferredHeader?.rowNumber ?? null;
    const populatedRows = rows.filter((row) => row.values.some((value) => normaliseCell(value)));
    return {
      sheetId: `sheet_${index + 1}`, displayName, index,
      rowCount: parserRange ? parserRange.endRow - parserRange.startRow + 1 : 0,
      columnCount: parserRange ? parserRange.endColumn - parserRange.startColumn + 1 : 0,
      parserRange, rows, headers, inferredHeaderRow, isEmpty: rows.length === 0 || rows.every((row) => row.values.every((value) => !normaliseCell(value)) && !row.hasStyle && !row.hasFormula && !row.merged),
      structural: {
        populatedArea: populatedRows.length ? {
          startRow: Math.min(...populatedRows.map((row) => row.rowNumber)),
          endRow: Math.max(...populatedRows.map((row) => row.rowNumber)),
          startColumn,
          endColumn,
        } : null,
        nonEmptyCellCount: rows.reduce((sum, row) => sum + row.cells.filter((cell) => Boolean(normaliseCell(cell.value))).length, 0),
        formulaCount: rows.reduce((sum, row) => sum + row.cells.filter((cell) => Boolean(cell.formula)).length, 0),
        mergedCellCount: rows.reduce((sum, row) => sum + row.cells.filter((cell) => cell.merged).length, 0),
        mergedRangeCount: merges.length,
        styledCellCount: rows.reduce((sum, row) => sum + row.cells.filter((cell) => cell.hasStyle).length, 0),
        hiddenRowCount: rows.filter((row) => row.hidden).length,
      },
    };
  });
  return {
    contentHash: createHash('sha256').update(buffer).digest('hex'),
    sourceByteLength: buffer.byteLength,
    fileType: /\.xls$/i.test(filename) ? 'xls' : 'xlsx',
    filename, sheets,
    totalParserRows: sheets.reduce((sum, sheet) => sum + sheet.rows.length, 0),
    totalParserCells: sheets.reduce((sum, sheet) => sum + sheet.rows.reduce((cells, row) => cells + row.cells.length, 0), 0),
  };
}

function inspectCsv(buffer: Buffer, filename: string): SpreadsheetWorkbook {
  const text = buffer.toString('utf8');
  const records = parse(text, {
    skip_empty_lines: false,
    relax_column_count: true,
    bom: true,
    info: true,
  }) as unknown as Array<{ record: unknown[]; info: { lines: number } }>;
  const values = records.map(({ record }) => record.map((cell) => String(cell ?? '')));
  const width = Math.max(0, ...values.map((row) => row.length));
  const sourceRows: SpreadsheetSourceRow[] = values.map((row, index) => ({
    rowNumber: index + 1,
    cells: Array.from({ length: width }, (_, columnIndex) => ({
      columnId: cellId(columnIndex), columnIndex, value: row[columnIndex] ?? '',
      hasStyle: false, merged: false,
    })),
    values: Array.from({ length: width }, (_, columnIndex) => row[columnIndex] ?? ''),
    hidden: false, hasFormula: false, hasStyle: false, merged: false,
    physicalLineStart: index === 0 ? 1 : (records[index - 1]?.info.lines ?? index) + 1,
    physicalLineEnd: records[index]?.info.lines ?? index + 1,
  }));
  const inferredHeader = inferHeaderRow(sourceRows);
  const sheet: SpreadsheetSheet = {
    sheetId: 'sheet_1', displayName: filename || 'CSV', index: 0,
    rowCount: sourceRows.length, columnCount: width,
    parserRange: sourceRows.length && width ? { startRow: 1, endRow: sourceRows.length, startColumn: 1, endColumn: width } : null,
    rows: sourceRows, headers: inferredHeader?.values ?? [],
    inferredHeaderRow: inferredHeader?.rowNumber ?? null,
    isEmpty: sourceRows.length === 0,
    structural: {
      populatedArea: sourceRows.length && width ? { startRow: 1, endRow: sourceRows.length, startColumn: 1, endColumn: width } : null,
      nonEmptyCellCount: sourceRows.reduce((sum, row) => sum + row.cells.filter((cell) => Boolean(normaliseCell(cell.value))).length, 0),
      formulaCount: 0,
      mergedCellCount: 0,
      mergedRangeCount: 0,
      styledCellCount: 0,
      hiddenRowCount: 0,
    },
  };
  return {
    contentHash: createHash('sha256').update(buffer).digest('hex'),
    sourceByteLength: buffer.byteLength,
    fileType: 'csv', filename, sheets: [sheet],
    totalParserRows: sourceRows.length, totalParserCells: sourceRows.length * width,
  };
}

export function inspectSpreadsheet(buffer: Buffer, mimeType: string, filename = ''): SpreadsheetWorkbook {
  return isExcelFile(mimeType, filename) ? inspectExcel(buffer, filename) : inspectCsv(buffer, filename);
}

function inferredMapping(sheet: SpreadsheetSheet): SpreadsheetMapping {
  const headerRow = sheet.inferredHeaderRow ? sheet.inferredHeaderRow - 1 : 0;
  const headers = sheet.rows.find((row) => row.rowNumber === (sheet.inferredHeaderRow ?? 1))?.values ?? [];
  const find = (patterns: RegExp[]) => {
    const index = headers.findIndex((header) => patterns.some((pattern) => pattern.test(normaliseCell(header).toLowerCase())));
    return index >= 0 ? index : undefined;
  };
  return {
    headerRow,
    columns: {
      date: find([/\bdate\b/, /posted/, /transaction/, /booking/, /value date/, /日期/, /交易日/, /記錄日期/]),
      amount: find([/^amount$/, /value/, /net/, /signed/, /金額/, /金额/, /收入/, /支出/, /數目/]),
      debit: find([/debit/, /withdrawal/, /outgoing/, /paid out/, /money out/, /支出/]),
      credit: find([/credit/, /deposit/, /incoming/, /paid in/, /money in/, /收入/]),
      description: find([/description/, /details/, /memo/, /narrative/, /merchant/, /描述/, /詳情/, /內容/, /項目/, /品名/, /客戶/, /供應商/]),
      category: find([/category/, /type/, /類別/, /分类/]),
      balance: find([/^balance/, /running/]),
    },
  };
}

const REFERENCE_SHEET_NAME = /^(master data|query|queries|fs|tb|trial balance|financial statements?|summary|summaries|notes?)$/i;

function classifySheet(sheet: SpreadsheetSheet, mapping: SpreadsheetMapping): {
  role: SpreadsheetSheetAnalysis['role'];
  confidence: number;
  reviewRequired: boolean;
  auditVisibility: SpreadsheetSheetAnalysis['auditVisibility'];
} {
  const normalizedName = sheet.displayName.trim().replace(/\s+/g, ' ');
  const hasDate = mapping.columns.date !== undefined;
  const hasMoney = mapping.columns.amount !== undefined
    || mapping.columns.debit !== undefined
    || mapping.columns.credit !== undefined;
  const hasDescription = mapping.columns.description !== undefined || mapping.columns.category !== undefined;
  const hasRequired = hasDate && hasMoney && hasDescription;

  if (REFERENCE_SHEET_NAME.test(normalizedName)) {
    return { role: 'non_transactional', confidence: 96, reviewRequired: false, auditVisibility: 'advanced' };
  }
  if (sheet.isEmpty) {
    return { role: 'unknown', confidence: 0, reviewRequired: true, auditVisibility: 'advanced' };
  }
  if (hasRequired) {
    return { role: 'transactional', confidence: 88, reviewRequired: false, auditVisibility: 'default' };
  }
  if (hasDate && hasMoney) {
    return { role: 'transactional', confidence: 58, reviewRequired: true, auditVisibility: 'default' };
  }
  if (looksLikeHeader(sheet.headers)) {
    return { role: 'non_transactional', confidence: 72, reviewRequired: false, auditVisibility: 'advanced' };
  }
  return { role: 'unknown', confidence: 35, reviewRequired: true, auditVisibility: 'default' };
}

export function ukTaxYear(date: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [year, month, day] = date.split('-').map(Number);
  const startYear = month > 4 || (month === 4 && day >= 6) ? year : year - 1;
  return `${startYear}-${startYear + 1}`;
}

function rowPrimary(
  row: SpreadsheetSourceRow,
  mapping: SpreadsheetMapping,
  selected: boolean,
  tradingStartDate?: string | null,
): SpreadsheetRowFinding {
  const values = row.values;
  const get = (key: keyof SpreadsheetMapping['columns']) => {
    const index = mapping.columns[key];
    return index === undefined ? '' : normaliseCell(values[index]);
  };
  const dateValue = get('date');
  const date = dateValue ? normaliseImportedDate(dateValue) : null;
  const amount = parseMoney(get('amount')) ??
    (parseMoney(get('credit')) !== null ? Math.abs(parseMoney(get('credit'))!) :
      parseMoney(get('debit')) !== null ? -Math.abs(parseMoney(get('debit'))!) : null);
  const description = get('description') || get('category') || null;
  const secondaryFindings: string[] = [];
  let primaryDisposition: RowDisposition = 'imported';
  let reason = 'Mapped row is ready for deterministic review.';
  if (!selected) { primaryDisposition = 'unselected_sheet'; reason = 'Sheet was not selected for this import.'; }
  else if (row.values.every((cell) => !normaliseCell(cell))) { primaryDisposition = 'blank'; reason = row.hasStyle ? 'Blank row retained because it has formatting.' : 'Blank source row.'; }
  else if (rowPrimaryHeader(row)) { primaryDisposition = 'header'; reason = 'Header or title row retained outside the transaction range.'; }
  else if (looksLikeBalanceRow(row.values)) { primaryDisposition = 'balance_total'; reason = 'Balance, subtotal, opening, closing, or total row is not a transaction.'; secondaryFindings.push('balance_total'); }
  else if (mapping.columns.date === undefined || (mapping.columns.amount === undefined && (mapping.columns.debit === undefined || mapping.columns.credit === undefined)) || (mapping.columns.description === undefined && mapping.columns.category === undefined)) {
    primaryDisposition = 'unmapped'; reason = 'A required transaction field is not mapped.';
  } else if (!date || amount === null || !description) {
    primaryDisposition = 'invalid'; reason = 'Required date, amount, or description could not be normalized.';
    const errors = [!date ? 'unresolved_date' : '', amount === null ? 'invalid_amount' : '', !description ? 'missing_description' : ''].filter(Boolean);
    return {
      sheetId: '', displaySheetName: '', sourceRow: row.rowNumber, primaryDisposition, secondaryFindings,
      reason, rawValueReference: { sheetId: '', rowNumber: row.rowNumber, cellCount: row.cells.length },
      normalizedValueReference: { date, amount, description }, taxYear: null, validationErrors: errors,
    };
  } else if (tradingStartDate && date < tradingStartDate) {
    primaryDisposition = 'pre_trading_start'; reason = 'Date is before the saved business/trading start date.';
    secondaryFindings.push('outside_scope');
  }
  return {
    sheetId: '', displaySheetName: '', sourceRow: row.rowNumber, primaryDisposition, secondaryFindings,
    reason, rawValueReference: { sheetId: '', rowNumber: row.rowNumber, cellCount: row.cells.length },
    normalizedValueReference: { date, amount, description }, taxYear: ukTaxYear(date ?? ''),
  };
}

function rowPrimaryHeader(row: SpreadsheetSourceRow) {
  return row.values.some((value) => /^date$/i.test(normaliseCell(value))) && looksLikeHeader(row.values);
}

const DISPOSITION_ORDER: RowDisposition[] = [
  'unselected_sheet', 'excluded_by_user', 'blank', 'header', 'balance_total',
  'non_transactional', 'excluded_by_rule', 'pre_trading_start', 'outside_scope',
  'invalid', 'unmapped', 'duplicate', 'imported',
];

function emptyDispositionCounts(): Record<RowDisposition, number> {
  return Object.fromEntries(DISPOSITION_ORDER.map((key) => [key, 0])) as Record<RowDisposition, number>;
}

export function analyseSpreadsheet(
  workbook: SpreadsheetWorkbook,
  options: {
    selectedSheetIds?: string[];
    tradingStartDate?: string | null;
    roleOverrides?: Record<string, SpreadsheetSheetAnalysis['role']>;
    sheetMappings?: Record<string, SpreadsheetMapping>;
    decisionSource?: SpreadsheetSheetAnalysis['decisionSource'];
    finalDispositions?: Record<string, SpreadsheetSheetAnalysis['finalDisposition']>;
    semanticMode?: 'deterministic' | 'structural';
  } = {},
): SpreadsheetAnalysis {
  const explicitlySelected = options.selectedSheetIds ? new Set(options.selectedSheetIds) : null;
  const roleOverrides = options.roleOverrides ?? {};
  const seenFingerprints = new Set<string>();
  const sheetAnalyses: SpreadsheetSheetAnalysis[] = workbook.sheets.map((sheet) => {
    // Structural mode is used before completed semantic interpretation and
    // must never surface locally inferred columns as import-ready defaults.
    const mapping = options.sheetMappings?.[sheet.sheetId]
      ?? (options.semanticMode === 'structural' ? { columns: {} } : inferredMapping(sheet));
    const classification = options.semanticMode === 'structural'
      ? { role: 'unknown' as const, confidence: 0, reviewRequired: false, auditVisibility: 'advanced' as const }
      : classifySheet(sheet, mapping);
    const isSelected = explicitlySelected ? explicitlySelected.has(sheet.sheetId) : classification.role === 'transactional' && !classification.reviewRequired;
    const hasRequired = mapping.columns.date !== undefined &&
      (mapping.columns.amount !== undefined || (mapping.columns.debit !== undefined && mapping.columns.credit !== undefined)) &&
      (mapping.columns.description !== undefined || mapping.columns.category !== undefined);
    const role = roleOverrides[sheet.sheetId] ?? classification.role;
    const disposition: SheetDisposition = options.semanticMode === 'structural' ? 'not_analysed' :
      sheet.isEmpty ? 'empty_sheet' :
      !isSelected ? 'unselected_sheet' : role === 'non_transactional' ? 'non_transactional' :
        hasRequired ? 'processed' : 'blocked_invalid_mapping';
    const rows = sheet.rows.map((sourceRow) => {
      const finding = rowPrimary(sourceRow, mapping, isSelected, options.tradingStartDate);
      finding.sheetId = sheet.sheetId; finding.displaySheetName = sheet.displayName; finding.rawValueReference.sheetId = sheet.sheetId;
      if (finding.primaryDisposition === 'imported' && finding.normalizedValueReference.date && finding.normalizedValueReference.amount !== null) {
        const fingerprint = `${finding.normalizedValueReference.date}|${Math.round(finding.normalizedValueReference.amount * 100)}|${normaliseCell(finding.normalizedValueReference.description ?? '').toLowerCase()}`;
        if (seenFingerprints.has(fingerprint)) { finding.primaryDisposition = 'duplicate'; finding.reason = 'Duplicate normalized source movement detected.'; finding.duplicateFingerprint = fingerprint; }
        else seenFingerprints.add(fingerprint);
      }
      if (role === 'non_transactional') {
        finding.primaryDisposition = 'non_transactional'; finding.reason = 'Sheet is classified as non-transactional.';
      }
      return finding;
    });
    const dated = rows.filter((row) => row.normalizedValueReference.date).sort((a, b) => a.normalizedValueReference.date!.localeCompare(b.normalizedValueReference.date!));
    const taxYearMap = new Map<string, Array<{ sheetId: string; rowNumber: number }>>();
    for (const row of dated) {
      const taxYear = ukTaxYear(row.normalizedValueReference.date!);
      if (taxYear) taxYearMap.set(taxYear, [...(taxYearMap.get(taxYear) ?? []), { sheetId: sheet.sheetId, rowNumber: row.sourceRow }]);
    }
    const coverageRows = dated.map((row) => ({ sheetId: sheet.sheetId, rowNumber: row.sourceRow }));
    return {
      sheetId: sheet.sheetId, displayName: sheet.displayName,
      dimensions: { rows: sheet.rowCount, columns: sheet.columnCount }, parserRange: sheet.parserRange,
      disposition, selected: isSelected, role, confidence: classification.confidence,
      reviewRequired: classification.reviewRequired, auditVisibility: classification.auditVisibility,
      decisionSource: options.decisionSource ?? 'deterministic',
      finalDisposition: options.finalDispositions?.[sheet.sheetId]
        ?? (options.semanticMode === 'structural' ? 'not_analysed' : role === 'transactional' ? 'transactional' : 'reference'),
      mapping, columnIds: Array.from({ length: sheet.columnCount }, (_, index) => cellId(index)),
      previewRows: sheet.rows.filter((row) => row.values.some((value) => normaliseCell(value))).slice(0, 8),
      rows, coverage: {
        status: (dated.length === 0 ? (rows.some((row) => row.primaryDisposition === 'invalid') ? 'partial' : 'unknown') : 'known') as 'known' | 'partial' | 'unknown',
        startDate: dated[0]?.normalizedValueReference.date ?? null, endDate: dated.at(-1)?.normalizedValueReference.date ?? null, rowRefs: coverageRows,
      },
      taxYears: [...taxYearMap.entries()].map(([taxYear, rowRefs]) => ({ taxYear, rowRefs })),
      warnings: [
        ...(rows.some((row) => row.primaryDisposition === 'invalid') ? ['Some rows have unresolved or invalid values.'] : []),
        ...(rows.some((row) => row.primaryDisposition === 'duplicate') ? ['Possible duplicate movements need review.'] : []),
        ...(rows.some((row) => row.primaryDisposition === 'pre_trading_start') ? ['Some movements pre-date the saved business/trading start date.'] : []),
      ],
    };
  });
  const counts = emptyDispositionCounts();
  for (const sheet of sheetAnalyses) for (const row of sheet.rows) counts[row.primaryDisposition] += 1;
  const allDated = sheetAnalyses.flatMap((sheet) => sheet.rows.filter((row) => row.normalizedValueReference.date));
  allDated.sort((a, b) => a.normalizedValueReference.date!.localeCompare(b.normalizedValueReference.date!));
  const coverage = {
    status: allDated.length ? 'known' as const : sheetAnalyses.some((sheet) => sheet.rows.some((row) => row.primaryDisposition === 'invalid')) ? 'partial' as const : 'unknown' as const,
    startDate: allDated[0]?.normalizedValueReference.date ?? null,
    endDate: allDated.at(-1)?.normalizedValueReference.date ?? null,
    rowRefs: allDated.map((row) => ({ sheetId: row.sheetId, rowNumber: row.sourceRow })),
  };
  return {
    parserVersion: SPREADSHEET_PARSER_VERSION, workbook, sheets: sheetAnalyses, coverage,
    taxYears: [...new Set(allDated.map((row) => row.taxYear).filter((year): year is string => Boolean(year)))].sort(),
    dispositionCounts: counts,
    warnings: [...new Set(sheetAnalyses.flatMap((sheet) => sheet.warnings))],
  };
}

/**
 * The normal ingestion path begins with this semantic-free audit. It records
 * every parser-visible worksheet and its source rows, but makes no local claim
 * about what a worksheet means or whether it can be imported.
 */
export function analyseSpreadsheetStructure(workbook: SpreadsheetWorkbook): SpreadsheetAnalysis {
  return analyseSpreadsheet(workbook, {
    semanticMode: 'structural',
    decisionSource: 'structural',
    selectedSheetIds: [],
    roleOverrides: Object.fromEntries(workbook.sheets.map((sheet) => [sheet.sheetId, 'unknown'])),
  });
}

export function normaliseCell(value: unknown): string {
  return String(value ?? '').trim();
}

export function parseMoney(value: unknown): number | null {
  const raw = normaliseCell(value).replace(/[£$€,]/g, '').replace(/\s/g, '');
  if (!raw || /^[-–—]$/.test(raw)) return null;
  const negative = /^\(.*\)$/.test(raw);
  const marker = raw.match(/(cr|dr)$/i)?.[1]?.toLowerCase();
  const numberText = raw.replace(/[()]/g, '').replace(/(cr|dr)$/i, '');
  const parsed = Number(numberText);
  if (!Number.isFinite(parsed)) return null;
  // Bank exports use DR for a debit/outgoing payment and CR for a credit/income.
  return negative || marker === 'dr' ? -Math.abs(parsed) : Math.abs(parsed);
}

/**
 * Maps a row using the user's confirmed columns. Debit and credit exports are
 * deliberately kept as separate signed cash facts: a credit wins only when it
 * is actually present, so same-day debit/credit rows never collapse together.
 */
export function mapSpreadsheetRow(row: string[], mapping: SpreadsheetMapping) {
  const col = (name: keyof SpreadsheetMapping['columns']) => {
    const index = mapping.columns[name];
    return index === undefined ? '' : normaliseCell(row[index]);
  };
  const debit = parseMoney(col('debit'));
  const credit = parseMoney(col('credit'));
  const directAmount = parseMoney(col('amount'));
  const amount = directAmount ?? (credit !== null ? Math.abs(credit) : debit !== null ? -Math.abs(debit) : null);

  return {
    date: normaliseImportedDate(col('date')),
    amount,
    description: col('description') || col('category') || 'Imported transaction',
  };
}

export function normaliseImportedDate(value: string): string | null {
  const trimmed = value.trim();
  const validIsoDate = (candidate: string) => {
    const match = candidate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const [year, month, day] = match.slice(1).map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
      ? candidate
      : null;
  };
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return validIsoDate(trimmed);
  const uk = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (!uk) return null;
  const year = uk[3].length === 2 ? `20${uk[3]}` : uk[3];
  return validIsoDate(`${year}-${uk[2].padStart(2, '0')}-${uk[1].padStart(2, '0')}`);
}

export function looksLikeHeader(row: string[]): boolean {
  const text = row.join(' ').toLowerCase();
  return /(date|amount|description|reference|debit|credit|balance|category|memo)/.test(text);
}

function isDateOrNumberCell(value: string) {
  const trimmed = value.trim();
  return /^\d{1,4}[/-]\d{1,2}[/-]\d{1,4}$/.test(trimmed)
    || /^[£$€]?\s*\(?-?\d[\d,]*(?:\.\d{1,4})?\)?(?:\s*(?:cr|dr))?$/i.test(trimmed);
}

/**
 * Parser-level, language-agnostic header detection. It only recognises an
 * all-text row before repeated dated/amount-like records; it never considers
 * an ordinary record (which contains a date or number) to be a header.
 */
function inferHeaderRow(rows: SpreadsheetSourceRow[]): SpreadsheetSourceRow | undefined {
  const named = rows.slice(0, 3).find((row) => {
    const cells = row.values.filter((value) => normaliseCell(value));
    return cells.length >= 3 && !cells.some(isDateOrNumberCell) && looksLikeHeader(cells);
  });
  if (named) return named;
  for (let index = 0; index < Math.min(rows.length, 3); index += 1) {
    const candidate = rows[index];
    if (!candidate) continue;
    const cells = candidate.values.filter((value) => normaliseCell(value));
    if (cells.length < 3 || cells.some(isDateOrNumberCell)) continue;
    const followups = rows.slice(index + 1, index + 4).filter((row) => {
      const values = row.values.filter((value) => normaliseCell(value));
      return values.length === cells.length && values.some(isDateOrNumberCell);
    });
    if (followups.length >= 1) return candidate;
  }
  return undefined;
}

export function looksLikeBalanceRow(row: string[]): boolean {
  const text = row.join(' ').toLowerCase();
  return /(opening|closing|running|balance|brought forward|carried forward|total)/.test(text);
}