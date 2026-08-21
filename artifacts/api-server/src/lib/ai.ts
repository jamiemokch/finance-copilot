/**
 * OpenAI integration for SME Finance Copilot.
 * Uses the Replit-managed AI Integrations proxy (AI_INTEGRATIONS_OPENAI_BASE_URL +
 * AI_INTEGRATIONS_OPENAI_API_KEY) with direct OPENAI_API_KEY as fallback.
 *
 * - Evidence extraction: reads uploaded files and extracts financial fields.
 * - Copilot: answers questions grounded in the user's live financial context.
 * All arithmetic is done in finance.ts; this module only interprets/explains.
 */

import OpenAI from 'openai';
import type { FinancialPosition } from './finance.js';

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!_client) {
    const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
    const apiKey  = process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('No OpenAI API key configured (AI_INTEGRATIONS_OPENAI_API_KEY or OPENAI_API_KEY)');
    }
    _client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
  }
  return _client;
}

export function isConfigured(): boolean {
  return Boolean(
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY,
  );
}

// ─── Evidence Extraction ──────────────────────────────────────────────────────

export interface ExtractedData {
  supplier: string | null;
  date: string | null;
  amount: number | null;
  description: string | null;
  taxTreatment: 'deductible' | 'non_deductible' | 'income' | 'unclear';
  confidence: number; // 0–1
  needsReview: boolean;
  rawText?: string;
}

const EXTRACT_SYSTEM_PROMPT = `You are a UK sole-trader bookkeeping assistant. Extract financial details from the document provided.

Return ONLY valid JSON with these fields:
- supplier: string or null (business/person who issued the document)
- date: string or null (ISO 8601 date, e.g. "2024-11-15")
- amount: number or null (total amount in GBP, positive for expenses, negative is wrong)
- description: string or null (brief description of what was purchased/charged)
- taxTreatment: one of "deductible" | "non_deductible" | "income" | "unclear"
  - deductible: clear business expense (software, equipment, professional services, travel, etc.)
  - non_deductible: personal expense or entertainment
  - income: money received (invoice, payment receipt)
  - unclear: mixed use or ambiguous purpose
- confidence: number 0-1 (how confident are you in this extraction)
- needsReview: boolean (true if confidence < 0.75 or taxTreatment is "unclear")
- aiReasoning: string (1-2 sentences explaining your classification decision)

UK tax rules to apply:
- Software/subscriptions with business purpose: deductible
- Equipment: deductible (capital allowance may apply for large amounts)
- Personal phone bill: partially deductible (typically 50% business use)
- Client entertainment: NOT deductible (HMRC disallows most entertainment)
- Home office: deductible only if exclusively business use
- Professional development directly relevant to trade: deductible`;

export async function extractFromImageFile(
  base64Image: string,
  mimeType: string,
  filename: string,
): Promise<ExtractedData & { aiReasoning: string }> {
  const client = getClient();

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 500,
    messages: [
      {
        role: 'system',
        content: EXTRACT_SYSTEM_PROMPT,
      },
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: {
              url: `data:${mimeType};base64,${base64Image}`,
              detail: 'high',
            },
          },
          {
            type: 'text',
            text: `Filename: ${filename}. Extract the financial details from this document.`,
          },
        ],
      },
    ],
    response_format: { type: 'json_object' },
  });

  const raw = response.choices[0]?.message?.content ?? '{}';
  try {
    const parsed = JSON.parse(raw);
    return {
      supplier: parsed.supplier ?? null,
      date: parsed.date ?? null,
      amount: typeof parsed.amount === 'number' ? Math.abs(parsed.amount) : null,
      description: parsed.description ?? null,
      taxTreatment: parsed.taxTreatment ?? 'unclear',
      confidence: typeof parsed.confidence === 'number' ? Math.min(1, Math.max(0, parsed.confidence)) : 0.5,
      needsReview: parsed.needsReview ?? true,
      aiReasoning: parsed.aiReasoning ?? 'Extraction completed.',
    };
  } catch {
    return {
      supplier: null,
      date: null,
      amount: null,
      description: null,
      taxTreatment: 'unclear',
      confidence: 0,
      needsReview: true,
      aiReasoning: 'Could not parse document content.',
    };
  }
}

export async function extractFromText(
  text: string,
  filename: string,
): Promise<ExtractedData & { aiReasoning: string }> {
  const client = getClient();

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 500,
    messages: [
      {
        role: 'system',
        content: EXTRACT_SYSTEM_PROMPT,
      },
      {
        role: 'user',
        content: `Filename: ${filename}\n\nDocument text:\n${text.slice(0, 4000)}`,
      },
    ],
    response_format: { type: 'json_object' },
  });

  const raw = response.choices[0]?.message?.content ?? '{}';
  try {
    const parsed = JSON.parse(raw);
    return {
      supplier: parsed.supplier ?? null,
      date: parsed.date ?? null,
      amount: typeof parsed.amount === 'number' ? Math.abs(parsed.amount) : null,
      description: parsed.description ?? null,
      taxTreatment: parsed.taxTreatment ?? 'unclear',
      confidence: typeof parsed.confidence === 'number' ? Math.min(1, Math.max(0, parsed.confidence)) : 0.5,
      needsReview: parsed.needsReview ?? true,
      rawText: text.slice(0, 500),
      aiReasoning: parsed.aiReasoning ?? 'Extraction completed.',
    };
  } catch {
    return {
      supplier: null,
      date: null,
      amount: null,
      description: null,
      taxTreatment: 'unclear',
      confidence: 0,
      needsReview: true,
      rawText: text.slice(0, 200),
      aiReasoning: 'Could not parse document content.',
    };
  }
}

// ─── Copilot ──────────────────────────────────────────────────────────────────

const COPILOT_SYSTEM_PROMPT = `You are a calm, plain-English financial co-pilot for a UK sole trader. 
You have access to their current financial data shown below. 
The numbers were calculated by deterministic UK tax logic — do NOT recalculate them. 
Instead, explain, interpret, and advise based on them.

Rules:
- Always reference specific numbers from the financial context
- Be concise: 2-4 paragraphs maximum
- Flag uncertainty clearly ("this depends on...", "you should confirm with an accountant")  
- Never invent numbers not in the context
- UK-specific: use HMRC terminology, reference correct allowances and deadlines
- If the question is about something not in the context, say so honestly
- Do NOT give generic financial advice — always ground it in their specific data`;

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
      {
        role: 'user',
        content: message,
      },
    ],
  });

  const reply = response.choices[0]?.message?.content ?? 'I was unable to generate a response.';
  return { reply, contextSummary };
}

function buildContextSummary(pos: FinancialPosition, profileName: string): string {
  const pl = pos.plBreakdown;
  const tax = pos.taxCalculation;
  const cash = pos.cashPosition;

  const arTotal = pos.arEntries.reduce((s, e) => s + e.amount, 0);
  const overdueAR = pos.arEntries.filter((e) => e.daysPastDue > 0);

  return `
Business: ${profileName} (UK Sole Trader, 2024/25 tax year)

P&L Summary:
- Revenue (confirmed): £${pl.revenues.toLocaleString()}
- Expenses (confirmed, deductible): £${pl.confirmedExpenses.toLocaleString()}
- YTD Profit: £${pl.profit.toLocaleString()}
- Pending/unclassified expenses (Inbox): £${pl.pendingExpenses.toLocaleString()}

Tax Position:
${tax.lines.map((l) => `- ${l.label}: £${l.amount.toLocaleString()}`).join('\n')}
- Total tax balance due: £${tax.balanceDue.toLocaleString()}
- Tax reserve set aside: £${cash.taxReserve.toLocaleString()}
- Tax gap (shortfall): £${Math.max(0, tax.reserveGap).toLocaleString()}

Cash Position:
- ${cash.accounts.map((a) => `${a.name}: £${a.balance.toLocaleString()}`).join(', ')}
- Less tax reserve: −£${cash.taxReserve.toLocaleString()}
- Less AP due within 30 days: −£${cash.apDueWithin30Days.toLocaleString()}
- Net available: £${cash.netAvailable.toLocaleString()}

Receivables: £${arTotal.toLocaleString()} owed${overdueAR.length > 0 ? ` (${overdueAR.length} overdue)` : ''}
Inbox items pending review: ${pos.pendingInboxCount}
SA Readiness: ${pos.saReadiness.completedCount}/${pos.saReadiness.totalCount} items complete
`.trim();
}
