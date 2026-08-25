import assert from "node:assert/strict";
import test from "node:test";
import { inspectSpreadsheet } from "./spreadsheet.js";
import {
  analyseSpreadsheetWithSemanticV3,
  buildSpreadsheetSemanticV3Input,
} from "./spreadsheet-semantic-v3.js";

function workbookWithRows(count: number) {
  const rows = ["Date,Description,Amount"];
  for (let index = 1; index <= count; index += 1) {
    rows.push(`2025-04-${String((index % 28) + 1).padStart(2, "0")},Movement ${index},${index}.25`);
  }
  return inspectSpreadsheet(Buffer.from(rows.join("\n")), "text/csv", "movements.csv");
}

function completePlan() {
  return {
    schemaVersion: "spreadsheet-semantic.v3",
    status: "complete",
    sheets: [{
      sheetId: "sheet_1",
      disposition: "transactional",
      headerRowIndex: 0,
      columnMappings: [
        { field: "date", columnId: "col_A", confidence: 0.98 },
        { field: "description", columnId: "col_B", confidence: 0.98 },
        { field: "amount", columnId: "col_C", confidence: 0.98 },
      ],
      classificationRules: [{ kind: "signed_amount", rationale: "A single signed movement column is mapped." }],
      warnings: [],
      confidence: 0.98,
    }],
    warnings: [],
    confidence: 0.98,
  };
}

function mockClient(reply: () => Promise<unknown> | unknown, received: unknown[]) {
  return {
    responses: {
      create: async (request: unknown) => {
        received.push(request);
        return reply();
      },
    },
  } as never;
}

test("semantic v3 sends a bounded summary and applies its mapping to every locally parsed row", async () => {
  const workbook = workbookWithRows(2_802);
  const input = buildSpreadsheetSemanticV3Input(workbook);
  const sent = JSON.stringify(input);
  assert.ok(input.workbook.sheets[0]!.sampleRows.length <= 4);
  assert.ok(!sent.includes("Movement 1111"), "a non-sampled workbook row must never enter the AI payload");
  assert.ok(sent.length < 48 * 1024, "the request is bounded independently of workbook length");

  const requests: unknown[] = [];
  const result = await analyseSpreadsheetWithSemanticV3(workbook, {
    client: mockClient(() => ({ output_text: JSON.stringify(completePlan()) }), requests),
  });
  assert.equal(result.status, "success");
  assert.equal(requests.length, 1, "v3 makes exactly one provider request");
  const request = requests[0] as {
    model?: string;
    input?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
    text?: { format?: { type?: string; strict?: boolean; schema?: unknown } };
  };
  assert.equal(request.model, "gpt-5.4-mini");
  assert.equal(request.input?.[0]?.content?.[0]?.type, "input_text");
  assert.equal(request.text?.format?.type, "json_schema");
  assert.equal(request.text?.format?.strict, true);
  assert.equal(typeof request.text?.format?.schema, "object");
  assert.equal(result.analysis.sheets[0]?.rows.length, workbook.sheets[0]?.rows.length, "all rows are analyzed locally");
  assert.equal(result.providerAttempts.length, 1);
  assert.equal(JSON.stringify(result.providerAttempts).includes("Movement"), false, "telemetry has no workbook values");
});

test("semantic v3 fails closed for malformed, invalid, and transport provider replies without leaking raw content", async () => {
  const workbook = workbookWithRows(8);
  const cases: Array<{ name: string; reply: () => Promise<unknown> | unknown; secret?: string }> = [
    { name: "empty", reply: () => ({ output_text: "   " }) },
    { name: "non-json", reply: () => ({ output_text: "provider-secret-non-json" }), secret: "provider-secret-non-json" },
    {
      name: "schema-invalid",
      reply: () => ({ output_text: JSON.stringify({ ...completePlan(), schemaVersion: "wrong-version" }) }),
    },
    {
      name: "semantic-mapping-invalid",
      reply: () => ({ output_text: JSON.stringify({
        ...completePlan(),
        sheets: [{ ...completePlan().sheets[0], columnMappings: [{ field: "date", columnId: "col_ZZZ", confidence: 1 }] }],
      }) }),
    },
    { name: "transport", reply: async () => { throw new Error("provider-secret-transport"); }, secret: "provider-secret-transport" },
  ];
  for (const scenario of cases) {
    const result = await analyseSpreadsheetWithSemanticV3(workbook, {
      client: mockClient(scenario.reply, []),
      timeoutMs: 25,
    });
    assert.equal(result.status, "failed", scenario.name);
    assert.equal(result.semanticPlan.status, "incomplete", scenario.name);
    assert.equal(result.providerAttempts.length, 1, scenario.name);
    if (scenario.secret) assert.equal(JSON.stringify(result.providerAttempts).includes(scenario.secret), false, scenario.name);
  }
});

test("semantic v3 refuses a valid incomplete response and does not create any financial outcome", async () => {
  const workbook = workbookWithRows(3);
  const incomplete = { ...completePlan(), status: "incomplete" as const };
  const result = await analyseSpreadsheetWithSemanticV3(workbook, {
    client: mockClient(() => ({ output_text: JSON.stringify(incomplete) }), []),
  });
  assert.equal(result.status, "failed");
  assert.equal(result.semanticPlan.status, "incomplete");
  assert.equal(result.analysis.sheets.some((sheet) => sheet.selected), false);
  // This module has no database imports or write calls: only confirmation is
  // allowed to persist Financial Memory, inbox, or source-row outcomes.
  assert.equal(result.providerCalls, 1);
});