/**
 * OpenAI integration for SME Finance Copilot.
 * Uses Replit-managed AI Integrations proxy with direct key as fallback.
 *
 * - Evidence extraction: context-aware, structured accounting fields, VAT metadata.
 * - Business ideas: real AI generation grounded in live financial data.
 * - Copilot: answers grounded in live financial context.
 *
 * All arithmetic lives in finance.ts; this module interprets and advises only.
 */

import OpenAI from 'openai';
import type { FinancialPosition } from './finance.js';

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!_client) {
    const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
    const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('No OpenAI API key configured');
    _client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
  }
  return _client;
}

export function isConfigured(): boolean {
  return Boolean(process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY);
}

// ─── Evidence Extraction ──────────────────────────────────────────────────────

export interface ExtractionContext {
  businessType: string;  // sole_trader | limited_company
  industry: string;      // technology | creative | professional_services | retail | other
  uploadCategory: string; // user-selected category at upload time
  priorTreatments: Array<{ description: string; treatment: string; category: string }>;
}

export interface ExtractedData {
  supplier: string | null;
  date: string | null;
  amount: number | null;
  description: string | null;
  incomeOrExpense: 'income' | 'expense' | 'unclear';
  taxTreatment: 'deductible' | 'non_deductible' | 'income' | 'unclear';
  accountingCategory: string; // office_costs | professional_fees | equipment | travel | meals | subscriptions | utilities | training | insurance | income | capital | other
  capitalOrRevenue: 'revenue' | 'capital' | 'unclear';
  allowablePercentage: number; // 0–100
  capitalAllowanceType: 'AIA' | 'main_pool' | 'nil' | null;
  vatMetadata: { rate: 0 | 5 | 20; vatAmount: number | null; isVatInclusive: boolean } | null;
  hmrcBasisNote: string | null;
  confidence: number; // 0–1
  needsReview: boolean;
  aiReasoning: string;
}

export interface MappingSchema {
  headerRow: number;
  columns: {
    date?: number;
    amount?: number;
    debit?: number;
    credit?: number;
    description?: number;
    category?: number;
    balance?: number;
  };
  dateFormat: string | null;
  currency: string;
  confidence: number;
  notes: string[];
}

function fallbackMapping(rows: string[][]): MappingSchema {
  const header = rows.findIndex((row) => /(date|amount|description|debit|credit|balance)/i.test(row.join(' ')));
  const headerRow = header >= 0 ? header : 0;
  const labels = (rows[headerRow] ?? []).map((cell) => cell.toLowerCase());
  const find = (patterns: RegExp[]) => {
    const index = labels.findIndex((label) => patterns.some((pattern) => pattern.test(label)));
    return index >= 0 ? index : undefined;
  };
  return {
    headerRow,
    columns: {
      date: find([/date|posted|transact/]),
      amount: find([/^amount$|value|net/]),
      debit: find([/debit|withdrawal|outgoing|expense/]),
      credit: find([/credit|deposit|incoming|income/]),
      description: find([/description|details|memo|reference|narrative/]),
      category: find([/category|type/]),
      balance: find([/^balance|running/]),
    },
    dateFormat: null,
    currency: 'GBP',
    confidence: 0.35,
    notes: ['Mapping was inferred locally because AI mapping was unavailable.'],
  };
}

export async function detectColumnSchema(
  rows: string[][],
  filename: string,
  mimeType: string,
): Promise<MappingSchema> {
  if (!isConfigured()) return fallbackMapping(rows);
  const client = getClient();
  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 900,
    messages: [
      {
        role: 'system',
        content: `You identify columns in UK financial CSV/XLSX files. Return ONLY valid JSON:
{
  "headerRow": number,
  "columns": {"date": number|null, "amount": number|null, "debit": number|null, "credit": number|null, "description": number|null, "category": number|null, "balance": number|null},
  "dateFormat": string|null,
  "currency": string,
  "confidence": number,
  "notes": string[]
}
Column indexes are zero-based. Use null for absent columns. Prefer amount, or debit/credit when a split bank export is used. Do not treat a running balance as a transaction amount.`,
      },
      {
        role: 'user',
        content: `Filename: ${filename}\nMIME type: ${mimeType}\nRows:\n${JSON.stringify(rows.slice(0, 10))}`,
      },
    ],
    response_format: { type: 'json_object' },
  });
  try {
    const parsed = JSON.parse(response.choices[0]?.message?.content ?? '{}') as Record<string, unknown>;
    const rawColumns = (parsed.columns ?? {}) as Record<string, unknown>;
    const index = (key: string) => typeof rawColumns[key] === 'number' ? rawColumns[key] as number : undefined;
    return {
      headerRow: typeof parsed.headerRow === 'number' ? parsed.headerRow : 0,
      columns: {
        date: index('date'), amount: index('amount'), debit: index('debit'),
        credit: index('credit'), description: index('description'),
        category: index('category'), balance: index('balance'),
      },
      dateFormat: typeof parsed.dateFormat === 'string' ? parsed.dateFormat : null,
      currency: typeof parsed.currency === 'string' ? parsed.currency : 'GBP',
      confidence: typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
      notes: Array.isArray(parsed.notes) ? parsed.notes.filter((note): note is string => typeof note === 'string') : [],
    };
  } catch {
    return fallbackMapping(rows);
  }
}

function buildExtractionPrompt(context: ExtractionContext): string {
  const priorStr =
    context.priorTreatments.length > 0
      ? context.priorTreatments
          .slice(-5)
          .map((t) => `  • "${t.description}" → ${t.treatment} (${t.category})`)
          .join('\n')
      : '  (none yet)';

  return `You are a UK sole-trader bookkeeping assistant. Extract and classify a financial document.

BUSINESS CONTEXT:
- Entity: ${context.businessType} in the ${context.industry} industry
- User-selected category: "${context.uploadCategory}"
- Recently confirmed treatments:
${priorStr}

Return ONLY valid JSON with these exact fields:
- supplier: string | null
- date: string | null (ISO 8601, e.g. "2024-11-15")
- amount: number | null (total GBP, always positive — even for expenses)
- description: string | null (concise, ≤10 words)
- incomeOrExpense: "income" | "expense" | "unclear"
- taxTreatment: "deductible" | "non_deductible" | "income" | "unclear"
- accountingCategory: one of office_costs | professional_fees | equipment | travel | meals | subscriptions | utilities | training | insurance | income | capital | other
- capitalOrRevenue: "revenue" | "capital" | "unclear"
  (capital = asset useful life > 1 year, e.g. laptop, camera, tools; revenue = recurring cost)
- allowablePercentage: integer 0–100 (business use %; 100 if fully business, 50 if half personal)
- capitalAllowanceType: "AIA" | "main_pool" | "nil" | null
  (AIA for qualifying plant & machinery; null if not capital)
- vatMetadata: { "rate": 0|5|20, "vatAmount": number|null, "isVatInclusive": boolean } | null
- hmrcBasisNote: string | null (e.g. "ITTOIA 2005 s34" or "CAA 2001 s38A")
- confidence: number 0–1
- needsReview: boolean (true if confidence < 0.75 OR mixed-use OR unclear)
- aiReasoning: string (2–3 sentences: what you saw, how you classified it, HMRC basis)

UK TAX RULES (apply these):
- Software/cloud subscriptions for business: deductible, subscriptions, revenue, 100%
- Equipment (laptop/camera/tools) ≥ £1,000 and useful life > 1yr: deductible, capital, AIA (sole trader < £1M/yr limit), capitalAllowanceType "AIA"
- Equipment < £1,000: deductible, equipment, revenue, 100% (still fully deductible as revenue expense)
- Mobile phone — wholly business: deductible, 100%; mixed-use: deductible, allowablePercentage e.g. 50%
- Client entertainment (meals/events where clients present): NOT deductible — non_deductible, meals, allowablePercentage 0 (ITTOIA 2005 s45)
- Business meals (working lunch, no clients): deductible, meals, 100%
- Travel (business journey, not commuting): deductible, travel
- Home office (simplified HMRC rate): deductible, office_costs
- Professional services (accountant, solicitor, consultant): deductible, professional_fees
- Training directly relevant to current trade: deductible, training
- Insurance for business: deductible, insurance
- Income / payment received (invoice paid): income, accountingCategory "income", allowablePercentage 100
- Personal goods, groceries, clothing (non-uniform): non_deductible, allowablePercentage 0
- If user's prior treatments suggest a pattern, apply it consistently`;
}

function normalizeExtracted(parsed: Record<string, unknown>): ExtractedData {
  const allowablePct =
    typeof parsed.allowablePercentage === 'number'
      ? Math.min(100, Math.max(0, parsed.allowablePercentage))
      : 100;

  let vatMetadata: ExtractedData['vatMetadata'] = null;
  if (parsed.vatMetadata && typeof parsed.vatMetadata === 'object') {
    const v = parsed.vatMetadata as Record<string, unknown>;
    vatMetadata = {
      rate: ([0, 5, 20].includes(Number(v.rate)) ? Number(v.rate) : 0) as 0 | 5 | 20,
      vatAmount: typeof v.vatAmount === 'number' ? v.vatAmount : null,
      isVatInclusive: Boolean(v.isVatInclusive),
    };
  }

  return {
    supplier: typeof parsed.supplier === 'string' ? parsed.supplier : null,
    date: typeof parsed.date === 'string' ? parsed.date : null,
    amount:
      typeof parsed.amount === 'number' ? Math.abs(parsed.amount) : null,
    description: typeof parsed.description === 'string' ? parsed.description : null,
    incomeOrExpense:
      parsed.incomeOrExpense === 'income' || parsed.incomeOrExpense === 'expense'
        ? parsed.incomeOrExpense
        : 'unclear',
    taxTreatment:
      (['deductible', 'non_deductible', 'income', 'unclear'] as readonly string[]).includes(
        parsed.taxTreatment as string,
      )
        ? (parsed.taxTreatment as ExtractedData['taxTreatment'])
        : 'unclear',
    accountingCategory:
      typeof parsed.accountingCategory === 'string' ? parsed.accountingCategory : 'other',
    capitalOrRevenue:
      parsed.capitalOrRevenue === 'capital' || parsed.capitalOrRevenue === 'revenue'
        ? parsed.capitalOrRevenue
        : 'unclear',
    allowablePercentage: allowablePct,
    capitalAllowanceType:
      (['AIA', 'main_pool', 'nil'] as readonly string[]).includes(
        parsed.capitalAllowanceType as string,
      )
        ? (parsed.capitalAllowanceType as 'AIA' | 'main_pool' | 'nil')
        : null,
    vatMetadata,
    hmrcBasisNote:
      typeof parsed.hmrcBasisNote === 'string' ? parsed.hmrcBasisNote : null,
    confidence:
      typeof parsed.confidence === 'number'
        ? Math.min(1, Math.max(0, parsed.confidence))
        : 0.5,
    needsReview:
      typeof parsed.needsReview === 'boolean' ? parsed.needsReview : true,
    aiReasoning:
      typeof parsed.aiReasoning === 'string' ? parsed.aiReasoning : 'Extraction completed.',
  };
}

export async function extractFromImageFile(
  base64Image: string,
  mimeType: string,
  filename: string,
  context: ExtractionContext,
): Promise<ExtractedData> {
  const client = getClient();
  const systemPrompt = buildExtractionPrompt(context);

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 600,
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: `data:${mimeType};base64,${base64Image}`, detail: 'high' },
          },
          { type: 'text', text: `Filename: ${filename}. Extract the financial details.` },
        ],
      },
    ],
    response_format: { type: 'json_object' },
  });

  try {
    const parsed = JSON.parse(response.choices[0]?.message?.content ?? '{}');
    return normalizeExtracted(parsed);
  } catch {
    return {
      supplier: null, date: null, amount: null, description: null,
      incomeOrExpense: 'unclear', taxTreatment: 'unclear',
      accountingCategory: 'other', capitalOrRevenue: 'unclear',
      allowablePercentage: 100, capitalAllowanceType: null, vatMetadata: null,
      hmrcBasisNote: null, confidence: 0, needsReview: true,
      aiReasoning: 'Could not parse image content.',
    };
  }
}

export async function extractFromText(
  text: string,
  filename: string,
  context: ExtractionContext,
): Promise<ExtractedData> {
  const client = getClient();
  const systemPrompt = buildExtractionPrompt(context);

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 600,
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `Filename: ${filename}\n\n${text.slice(0, 4000)}`,
      },
    ],
    response_format: { type: 'json_object' },
  });

  try {
    const parsed = JSON.parse(response.choices[0]?.message?.content ?? '{}');
    return normalizeExtracted(parsed);
  } catch {
    return {
      supplier: null, date: null, amount: null, description: null,
      incomeOrExpense: 'unclear', taxTreatment: 'unclear',
      accountingCategory: 'other', capitalOrRevenue: 'unclear',
      allowablePercentage: 100, capitalAllowanceType: null, vatMetadata: null,
      hmrcBasisNote: null, confidence: 0, needsReview: true,
      aiReasoning: 'Could not parse document content.',
    };
  }
}

// ─── Business Ideas (AI-generated) ───────────────────────────────────────────

export interface AIBusinessIdea {
  id: string;
  category: 'tax' | 'cash' | 'growth' | 'operations' | 'pricing';
  title: string;                // ≤8 words
  summary: string;              // 1–2 sentences, cite actual numbers
  currentPosition: string;      // 1 sentence describing current state
  proposedAction: string;       // 1–2 actionable sentences
  priorityTier: 'do_now' | 'consider' | 'watch';
  plImpactRange: { min: number; max: number } | null;
  cashImpactRange: { min: number; max: number } | null;
  taxImpactRange: { min: number; max: number } | null;
  paybackRange: { minMonths: number | null; maxMonths: number | null } | null;
  urgencyNote: string | null;
  editableAssumptions: Array<{
    key: string; label: string; value: number; unit: string;
    min: number; max: number; step: number;
  }>;
  whatMustBeTrue: string[];
  source: string;               // HMRC rule or business principle
  confidence: 'high' | 'medium' | 'low';
  aiInsight: string;            // one-sentence insight for chart/card
  status: 'new';
  committedDecisionId: null;
}

const IDEAS_SYSTEM_PROMPT = `You are a UK sole-trader financial advisor generating specific, actionable business ideas.

RULES:
- Ground every idea in the exact numbers from the financial context. Do NOT invent numbers.
- Calculate impacts mathematically from the provided figures (e.g. marginal tax rate × deduction amount).
- Reference specific HMRC rules or credible business principles.
- No generic advice. Every idea must be specific to the numbers shown.
- Provide quantified impact ranges — not vague statements.
- Do NOT reference specific client names from the AR data — use generic "outstanding invoices" language.
- If pending inbox exists, include a tax/deduction idea prioritised do_now.
- If AR is overdue, include a cash collection idea.
- Include 1 growth or pricing idea grounded in current revenue level.
- Generate exactly 4–6 ideas total.

Return a JSON array named "ideas" with objects matching this schema exactly:
{
  "id": "snake_case_unique_id",
  "category": "tax"|"cash"|"growth"|"operations"|"pricing",
  "title": "≤8 words",
  "summary": "1-2 sentences citing specific numbers",
  "currentPosition": "1 sentence with exact numbers",
  "proposedAction": "1-2 actionable sentences",
  "priorityTier": "do_now"|"consider"|"watch",
  "plImpactRange": {"min": number, "max": number} | null,
  "cashImpactRange": {"min": number, "max": number} | null,
  "taxImpactRange": {"min": number, "max": number} | null,
  "paybackRange": {"minMonths": number|null, "maxMonths": number|null} | null,
  "urgencyNote": "string"|null,
  "editableAssumptions": [{"key":"string","label":"string","value":number,"unit":"string","min":number,"max":number,"step":number}],
  "whatMustBeTrue": ["string"],
  "source": "HMRC section or business principle",
  "confidence": "high"|"medium"|"low",
  "aiInsight": "one sentence insight"
}`;

export async function generateBusinessIdeasAI(
  position: FinancialPosition,
  profile: { name: string; industry: string; businessType: string; taxYear: string },
  committedIdeaIds: string[],
): Promise<AIBusinessIdea[]> {
  const client = getClient();

  const pl = position.plBreakdown;
  const tax = position.taxCalculation;
  const cash = position.cashPosition;
  const totalAR = position.arEntries.reduce((s, e) => s + e.amount, 0);
  const overdueAR = position.arEntries.filter((e) => e.daysPastDue > 0);
  const totalGross = cash.accounts.reduce((s, a) => s + a.balance, 0);
  const marginalRate = pl.profit > 50270 ? 42 : pl.profit > 12570 ? 29 : 0;

  const context = `
FINANCIAL POSITION — ${profile.name} (${profile.businessType}, ${profile.industry}, ${profile.taxYear})

P&L:
- Revenue YTD: £${pl.revenues.toLocaleString()}
- Confirmed deductible expenses: £${pl.confirmedExpenses.toLocaleString()}
- Non-deductible recorded: £${pl.nonDeductibleExpenses.toLocaleString()}
- Taxable profit: £${pl.profit.toLocaleString()}
- Pending (Inbox, unclassified): £${pl.pendingExpenses.toLocaleString()} across ${position.pendingInboxCount} items

Tax (UK ${profile.taxYear}):
${tax.lines.map((l) => `- ${l.label}: £${l.amount.toLocaleString()}`).join('\n')}
- Total tax due: £${tax.balanceDue.toLocaleString()}
- Reserve held: £${cash.taxReserve.toLocaleString()}
- Shortfall: £${Math.max(0, tax.reserveGap).toLocaleString()}
- Effective marginal rate (income tax + NI): ~${marginalRate}%

Cash:
- Total gross cash: £${totalGross.toLocaleString()}
- Less tax reserve: £${cash.taxReserve.toLocaleString()}
- Less AP due ≤30 days: £${cash.apDueWithin30Days.toLocaleString()}
- Net available: £${cash.netAvailable.toLocaleString()}

Receivables (AR): £${totalAR.toLocaleString()} outstanding (${overdueAR.length} overdue)
Payables (AP) due within 30 days: £${cash.apDueWithin30Days.toLocaleString()}

SA Readiness: ${position.saReadiness.completedCount}/${position.saReadiness.totalCount} items complete
Already committed ideas (exclude from new generation): ${committedIdeaIds.join(', ') || 'none'}`;

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 2000,
    messages: [
      { role: 'system', content: IDEAS_SYSTEM_PROMPT },
      { role: 'user', content: context },
    ],
    response_format: { type: 'json_object' },
  });

  try {
    const parsed = JSON.parse(response.choices[0]?.message?.content ?? '{}');
    const raw: unknown[] = Array.isArray(parsed.ideas) ? parsed.ideas : [];
    return raw
      .filter((i): i is Record<string, unknown> => typeof i === 'object' && i !== null)
      .map((idea, idx) => ({
        id: typeof idea.id === 'string' ? idea.id : `idea-${idx}`,
        category: (['tax', 'cash', 'growth', 'operations', 'pricing'] as readonly string[]).includes(
          idea.category as string,
        )
          ? (idea.category as AIBusinessIdea['category'])
          : 'operations',
        title: typeof idea.title === 'string' ? idea.title : 'Opportunity',
        summary: typeof idea.summary === 'string' ? idea.summary : '',
        currentPosition: typeof idea.currentPosition === 'string' ? idea.currentPosition : '',
        proposedAction: typeof idea.proposedAction === 'string' ? idea.proposedAction : '',
        priorityTier: (['do_now', 'consider', 'watch'] as readonly string[]).includes(
          idea.priorityTier as string,
        )
          ? (idea.priorityTier as AIBusinessIdea['priorityTier'])
          : 'consider',
        plImpactRange:
          idea.plImpactRange && typeof idea.plImpactRange === 'object'
            ? (idea.plImpactRange as { min: number; max: number })
            : null,
        cashImpactRange:
          idea.cashImpactRange && typeof idea.cashImpactRange === 'object'
            ? (idea.cashImpactRange as { min: number; max: number })
            : null,
        taxImpactRange:
          idea.taxImpactRange && typeof idea.taxImpactRange === 'object'
            ? (idea.taxImpactRange as { min: number; max: number })
            : null,
        paybackRange:
          idea.paybackRange && typeof idea.paybackRange === 'object'
            ? (idea.paybackRange as { minMonths: number | null; maxMonths: number | null })
            : null,
        urgencyNote:
          typeof idea.urgencyNote === 'string' ? idea.urgencyNote : null,
        editableAssumptions: Array.isArray(idea.editableAssumptions)
          ? (idea.editableAssumptions as AIBusinessIdea['editableAssumptions'])
          : [],
        whatMustBeTrue: Array.isArray(idea.whatMustBeTrue)
          ? (idea.whatMustBeTrue as string[])
          : [],
        source: typeof idea.source === 'string' ? idea.source : 'Business best practice',
        confidence: (['high', 'medium', 'low'] as readonly string[]).includes(idea.confidence as string)
          ? (idea.confidence as AIBusinessIdea['confidence'])
          : 'medium',
        aiInsight: typeof idea.aiInsight === 'string' ? idea.aiInsight : '',
        status: 'new' as const,
        committedDecisionId: null,
      }));
  } catch {
    return [];
  }
}

// ─── Copilot ──────────────────────────────────────────────────────────────────

const COPILOT_SYSTEM_PROMPT = `You are a calm, plain-English financial co-pilot for a UK sole trader.
You have access to their current financial data shown below.
The numbers were calculated by deterministic UK tax logic — do NOT recalculate them.
Instead, explain, interpret, and advise based on them.

Rules:
- Always reference specific numbers from the financial context
- Be concise: 2–4 paragraphs maximum
- Flag uncertainty clearly ("this depends on…", "confirm with an accountant")
- Never invent numbers not in the context
- UK-specific: use HMRC terminology, correct allowances and deadlines
- If the question is outside the context, say so honestly`;

export async function getCopilotReply(
  message: string,
  position: FinancialPosition,
  profileName: string,
): Promise<{ reply: string; contextSummary: string }> {
  const client = getClient();
  const contextSummary = buildContextSummary(position, profileName);

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 600,
    messages: [
      {
        role: 'system',
        content: `${COPILOT_SYSTEM_PROMPT}\n\n--- FINANCIAL CONTEXT ---\n${contextSummary}`,
      },
      { role: 'user', content: message },
    ],
  });

  const reply = response.choices[0]?.message?.content ?? 'Unable to generate a response.';
  return { reply, contextSummary };
}

function buildContextSummary(pos: FinancialPosition, profileName: string): string {
  const pl = pos.plBreakdown;
  const tax = pos.taxCalculation;
  const cash = pos.cashPosition;
  const arTotal = pos.arEntries.reduce((s, e) => s + e.amount, 0);
  const overdueAR = pos.arEntries.filter((e) => e.daysPastDue > 0);

  return `
Business: ${profileName} (UK Sole Trader, 2024/25)

P&L:
- Revenue: £${pl.revenues.toLocaleString()}
- Allowable expenses: £${pl.confirmedExpenses.toLocaleString()}
- Non-deductible recorded: £${pl.nonDeductibleExpenses.toLocaleString()}
- YTD Profit: £${pl.profit.toLocaleString()}
- Pending (unclassified): £${pl.pendingExpenses.toLocaleString()}

Tax:
${tax.lines.map((l) => `- ${l.label}: £${l.amount.toLocaleString()}`).join('\n')}
- Total due: £${tax.balanceDue.toLocaleString()}
- Reserve: £${cash.taxReserve.toLocaleString()} | Gap: £${Math.max(0, tax.reserveGap).toLocaleString()}

Cash:
- ${cash.accounts.map((a) => `${a.name}: £${a.balance.toLocaleString()}`).join(', ')}
- Less tax reserve: −£${cash.taxReserve.toLocaleString()}
- Less AP due 30d: −£${cash.apDueWithin30Days.toLocaleString()}
- Net available: £${cash.netAvailable.toLocaleString()}

AR: £${arTotal.toLocaleString()} (${overdueAR.length} overdue)
Inbox pending: ${pos.pendingInboxCount}
SA: ${pos.saReadiness.completedCount}/${pos.saReadiness.totalCount} complete
`.trim();
}
