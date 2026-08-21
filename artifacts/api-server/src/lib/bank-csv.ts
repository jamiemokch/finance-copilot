import { parse } from "csv-parse/sync";
import { taxYearPeriod } from "./tax-year-ledger.js";

export const MAX_BANK_CSV_BYTES = 5 * 1024 * 1024;
export const MAX_BANK_CSV_ROWS = 10_000;
export const MAX_BANK_CSV_COLUMNS = 50;

export type BankDateFormat = "dmy" | "ymd";
export type DecimalConvention = "dot" | "comma";

export type BankMapping = {
  headerRow: number;
  columns: {
    date: number;
    amount?: number;
    debit?: number;
    credit?: number;
    description: number;
    reference?: number;
    balance?: number;
  };
  dateFormat?: BankDateFormat;
  decimalConvention?: DecimalConvention;
};

export type ParsedBankCsv = {
  rows: string[][];
  encoding: "utf-8" | "windows-1252";
  delimiter: "," | ";" | "\t";
};

export type ParsedBankRow = {
  sourceRowNumber: number;
  rawRowData: string[];
  date: string | null;
  amount: number | null;
  direction: "money_in" | "money_out" | null;
  description: string | null;
  reference: string | null;
  balance: number | null;
  validationStatus: "valid" | "invalid" | "out_of_scope";
  validationErrors: string[];
  sourceFingerprint: string | null;
};

export class BankCsvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BankCsvError";
  }
}

export function parseBankCsv(buffer: Buffer): ParsedBankCsv {
  if (buffer.length === 0) throw new BankCsvError("The CSV file is empty.");
  if (buffer.length > MAX_BANK_CSV_BYTES) {
    throw new BankCsvError("This bank CSV is too large. Please export no more than 5 MB at a time.");
  }

  const utf8 = buffer.toString("utf8");
  const encoding: ParsedBankCsv["encoding"] = utf8.includes("\uFFFD") ? "windows-1252" : "utf-8";
  // Node's latin1 decoder preserves common Windows bank-export bytes without
  // claiming that a guessed encoding is universally correct.
  const text = encoding === "utf-8" ? utf8 : buffer.toString("latin1");
  if (text.includes("\u0000")) throw new BankCsvError("This file is not a readable CSV export.");

  const delimiter = detectDelimiter(text);
  let rows: string[][];
  try {
    rows = parse(text, {
      bom: true,
      delimiter,
      skip_empty_lines: true,
      relax_column_count: false,
      trim: false,
      max_record_size: 128 * 1024,
    }).map((row: unknown[]) => row.map((cell) => String(cell ?? "")));
  } catch {
    throw new BankCsvError("The CSV has malformed quotes or inconsistent columns.");
  }

  if (rows.length < 2) throw new BankCsvError("The CSV needs a header and at least one transaction row.");
  if (rows.length > MAX_BANK_CSV_ROWS + 1) {
    throw new BankCsvError(`This export has more than ${MAX_BANK_CSV_ROWS.toLocaleString()} rows.`);
  }
  const widest = Math.max(...rows.map((row) => row.length));
  if (!widest || widest > MAX_BANK_CSV_COLUMNS) {
    throw new BankCsvError(`This export has more than ${MAX_BANK_CSV_COLUMNS} columns.`);
  }
  return { rows, encoding, delimiter };
}

export function suggestBankMapping(rows: string[][]): {
  mapping: BankMapping;
  decimalConvention: DecimalConvention | "ambiguous";
  headers: string[];
  examples: string[][];
} {
  const headerRow = findHeaderRow(rows);
  const headers = rows[headerRow] ?? [];
  const indexFor = (patterns: RegExp[]) =>
    headers.findIndex((header) => patterns.some((pattern) => pattern.test(normalizeHeader(header))));
  const date = indexFor([/\bdate\b/, /transactiondate/, /bookingdate/, /valuedate/]);
  const amount = indexFor([/\bamount\b/, /transactionamount/, /\bvalue\b/]);
  const debit = indexFor([/\bdebit\b/, /withdrawal/, /paidout/, /moneyout/, /\bdr\b/]);
  const credit = indexFor([/\bcredit\b/, /deposit/, /paidin/, /moneyin/, /\bcr\b/]);
  const description = indexFor([/\bdescription\b/, /narrative/, /\bdetails\b/, /\bmemo\b/, /merchant/]);
  const reference = indexFor([/\breference\b/, /transactionreference/, /\bref\b/]);
  const balance = indexFor([/\bbalance\b/, /runningbalance/, /closingbalance/]);
  const sampleMoney = rows.slice(headerRow + 1, headerRow + 11)
    .map((row) => row[amount >= 0 ? amount : debit >= 0 ? debit : credit >= 0 ? credit : -1] ?? "");

  return {
    mapping: {
      headerRow,
      columns: {
        ...(date >= 0 ? { date } : {}),
        ...(amount >= 0 ? { amount } : {}),
        ...(debit >= 0 ? { debit } : {}),
        ...(credit >= 0 ? { credit } : {}),
        ...(description >= 0 ? { description } : {}),
        ...(reference >= 0 ? { reference } : {}),
        ...(balance >= 0 ? { balance } : {}),
      } as BankMapping["columns"],
      dateFormat: "dmy",
      decimalConvention: "dot",
    },
    decimalConvention: inferDecimalConvention(sampleMoney),
    headers,
    examples: rows.slice(headerRow + 1, headerRow + 6),
  };
}

export function validateBankMapping(mapping: BankMapping, rows: string[][]): string | null {
  if (!Number.isInteger(mapping.headerRow) || mapping.headerRow < 0 || mapping.headerRow >= rows.length) {
    return "Choose a valid header row.";
  }
  const columns = mapping.columns;
  if (!Number.isInteger(columns.date) || !Number.isInteger(columns.description)) {
    return "Choose both a date and a description column.";
  }
  const hasSignedAmount = Number.isInteger(columns.amount);
  const hasDebitCredit = Number.isInteger(columns.debit) && Number.isInteger(columns.credit);
  if (!hasSignedAmount && !hasDebitCredit) {
    return "Choose one signed amount column, or both separate debit and credit columns.";
  }
  if (hasSignedAmount && (Number.isInteger(columns.debit) || Number.isInteger(columns.credit))) {
    return "Use either a signed amount column or separate debit and credit columns, not both.";
  }
  const all = Object.values(columns).filter((value): value is number => value !== undefined);
  const widest = Math.max(...rows.map((row) => row.length));
  if (all.some((value) => !Number.isInteger(value) || value < 0 || value >= widest)) {
    return "One of the selected columns is outside the CSV.";
  }
  if (!mapping.dateFormat || !mapping.decimalConvention) {
    return "Confirm the date and decimal formats before previewing.";
  }
  return null;
}

export function parseMappedBankRows(
  rows: string[][],
  mapping: BankMapping,
  taxYear: string,
): ParsedBankRow[] {
  const mappingError = validateBankMapping(mapping, rows);
  if (mappingError) throw new BankCsvError(mappingError);
  const period = taxYearPeriod(taxYear);
  if (!period) throw new BankCsvError("The selected profile has an invalid tax year.");
  const output: ParsedBankRow[] = [];

  for (let rowIndex = mapping.headerRow + 1; rowIndex < rows.length; rowIndex += 1) {
    const rawRowData = rows[rowIndex] ?? [];
    if (rawRowData.every((cell) => !String(cell).trim())) continue;
    const value = (key: keyof BankMapping["columns"]) => {
      const column = mapping.columns[key];
      return column === undefined ? "" : String(rawRowData[column] ?? "").trim();
    };
    const errors: string[] = [];
    const date = parseBankDate(value("date"), mapping.dateFormat!, errors);
    const amount = parseMappedAmount(value("amount"), value("debit"), value("credit"), mapping, errors);
    const description = value("description") || null;
    const reference = value("reference") || null;
    const balance = parseOptionalMoney(value("balance"), mapping.decimalConvention!);
    if (!description) errors.push("A description is required.");

    const validationStatus = errors.length > 0
      ? "invalid"
      : date! < period.start || date! > period.end
        ? "out_of_scope"
        : "valid";
    if (validationStatus === "out_of_scope") {
      errors.push(`Outside the selected ${taxYear} tax year.`);
    }
    output.push({
      sourceRowNumber: rowIndex + 1,
      rawRowData,
      date,
      amount,
      direction: amount == null ? null : amount > 0 ? "money_in" : "money_out",
      description,
      reference,
      balance,
      validationStatus,
      validationErrors: errors,
      sourceFingerprint: date && amount != null && description
        ? bankRowFingerprint({ date, amount, description, reference, balance })
        : null,
    });
  }
  if (output.length === 0) throw new BankCsvError("The CSV contains no usable transaction rows.");
  return output;
}

export function bankRowFingerprint(input: {
  date: string;
  amount: number;
  description: string;
  reference?: string | null;
  balance?: number | null;
}): string {
  const amountMinor = Math.round(input.amount * 100);
  const reference = normalizeFingerprintPart(input.reference ?? "");
  const balance = input.balance == null ? "" : String(Math.round(input.balance * 100));
  return [
    input.date,
    String(amountMinor),
    normalizeFingerprintPart(input.description),
    reference,
    balance,
  ].join("|");
}

export function normalizeFingerprintPart(value: string): string {
  return value.toLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function findHeaderRow(rows: string[][]): number {
  const found = rows.slice(0, 10).findIndex((row) => {
    const text = row.map(normalizeHeader).join(" ");
    return /date/.test(text) && /(amount|debit|credit|paid|withdrawal|deposit)/.test(text);
  });
  return found >= 0 ? found : 0;
}

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function detectDelimiter(text: string): "," | ";" | "\t" {
  const sample = text.split(/\r?\n/).find((line) => line.trim()) ?? "";
  const counts: Array<["," | ";" | "\t", number]> = [
    [",", countOutsideQuotes(sample, ",")],
    [";", countOutsideQuotes(sample, ";")],
    ["\t", countOutsideQuotes(sample, "\t")],
  ];
  return counts.sort((a, b) => b[1] - a[1])[0][0];
}

function countOutsideQuotes(line: string, delimiter: string): number {
  let quotes = false;
  let count = 0;
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === '"') quotes = !quotes;
    else if (!quotes && line[index] === delimiter) count += 1;
  }
  return count;
}

function inferDecimalConvention(values: string[]): DecimalConvention | "ambiguous" {
  let dot = 0;
  let comma = 0;
  let ambiguous = 0;
  for (const raw of values) {
    const value = raw.replace(/[£\s]/g, "");
    if (!value) continue;
    if (/^[+-]?\d+[,.]\d{3}(?:cr|dr)?$/i.test(value)) {
      ambiguous += 1;
      continue;
    }
    if (/\d,\d{1,2}(?:\D|$)/.test(value)) comma += 1;
    if (/\d\.\d{1,2}(?:\D|$)/.test(value)) dot += 1;
  }
  if (ambiguous || (dot && comma)) return "ambiguous";
  return comma ? "comma" : "dot";
}

function parseBankDate(value: string, dateFormat: BankDateFormat, errors: string[]): string | null {
  const trimmed = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (iso) return validDate(Number(iso[1]), Number(iso[2]), Number(iso[3])) ? trimmed : invalidDate(errors);
  const match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/.exec(trimmed);
  if (!match) return invalidDate(errors);
  const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
  const first = Number(match[1]);
  const second = Number(match[2]);
  const month = dateFormat === "dmy" ? second : first;
  const day = dateFormat === "dmy" ? first : second;
  if (!validDate(year, month, day)) return invalidDate(errors);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function invalidDate(errors: string[]): null {
  errors.push("Enter a real date using the confirmed date format.");
  return null;
}

function validDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function parseMappedAmount(
  directAmount: string,
  debit: string,
  credit: string,
  mapping: BankMapping,
  errors: string[],
): number | null {
  const convention = mapping.decimalConvention!;
  if (mapping.columns.amount !== undefined) {
    const amount = parseOptionalMoney(directAmount, convention);
    if (amount == null || amount === 0) {
      errors.push("Enter a non-zero amount.");
      return null;
    }
    return amount;
  }
  const debitAmount = parseOptionalMoney(debit, convention);
  const creditAmount = parseOptionalMoney(credit, convention);
  if (debitAmount != null && creditAmount != null) {
    errors.push("Both debit and credit are populated.");
    return null;
  }
  if (debitAmount == null && creditAmount == null) {
    errors.push("Enter either a debit or a credit amount.");
    return null;
  }
  const amount = debitAmount != null ? -Math.abs(debitAmount) : Math.abs(creditAmount!);
  if (amount === 0) {
    errors.push("Enter a non-zero amount.");
    return null;
  }
  return amount;
}

function parseOptionalMoney(value: string, convention: DecimalConvention): number | null {
  let raw = value.trim();
  if (!raw || /^[-–—]$/.test(raw)) return null;
  const parentheses = /^\(.*\)$/.test(raw);
  const marker = /(cr|dr)\s*$/i.exec(raw)?.[1]?.toLowerCase();
  raw = raw.replace(/[£$€\s]/g, "").replace(/[()]/g, "").replace(/(cr|dr)\s*$/i, "");
  if (convention === "dot") {
    raw = raw.replace(/,/g, "");
  } else {
    raw = raw.replace(/\./g, "").replace(",", ".");
  }
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(raw)) return null;
  const number = Number(raw);
  if (!Number.isFinite(number)) return null;
  const negative = parentheses || marker === "dr" || number < 0;
  return negative ? -Math.abs(number) : Math.abs(number);
}