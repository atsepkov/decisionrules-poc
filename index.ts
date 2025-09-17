import { config as dotenvConfig } from "dotenv";
dotenvConfig();

import DecisionRules from "@decisionrules/decisionrules";

const solverKey = process.env.SOLVER_KEY || "";
const markupRuleId = process.env.MARKUP_RULE_ID || "";
const discountRuleId = process.env.DISCOUNT_RULE_ID || "";
const manufactRuleId = process.env.MANUFACTUR_RULE_ID || "";
const pricingFlowId = process.env.PRICING_FLOW_ID || "";
const decisionRulesHost =
  process.env.DECISION_RULES_HOST || "https://api.decisionrules.io";

const dr = new DecisionRules({ solverKey, host: decisionRulesHost });

const shouldLogDecisionRulesResponses =
  String(process.env.LOG_RESPONSE || "").toLowerCase() ===
  "true";

type Part = {
  basePrice: number;
  method: string;
  material: string;
  quantity: number;
  customerTier: string;
  [key: string]: any;
};

function summarizeParts(parts: Part[]) {
  return {
    count: parts.length,
    sample: parts.slice(0, 3),
  };
}

function safeStringify(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch (error) {
    return String(value);
  }
}

function logDecisionRulesError(
  err: unknown,
  context: { path: string; parts: Part[] }
) {
  const baseLog = {
    timestamp: new Date().toISOString(),
    path: context.path,
    parts: summarizeParts(context.parts),
  };

  if (err instanceof Error) {
    const { cause, message, stack } = err as Error & { cause?: unknown };
    console.error("[DecisionRules] Request failed", {
      ...baseLog,
      message,
    });
    if (cause !== undefined) {
      console.error("[DecisionRules] Cause", safeStringify(cause));
    }
    if (stack) {
      console.error(stack);
    }
  } else {
    console.error("[DecisionRules] Non-error thrown", {
      ...baseLog,
      value: err,
    });
  }
}

function logDecisionRulesResponse(
  context: { path: string; parts: Part[] },
  payload: unknown
) {
  if (!shouldLogDecisionRulesResponses) {
    return;
  }

  const baseLog = {
    timestamp: new Date().toISOString(),
    path: context.path,
    parts: summarizeParts(context.parts),
  };

  console.log(
    "[DecisionRules] Response",
    safeStringify({
      ...baseLog,
      payload,
    })
  );
}

async function calcPriceWithRules(part: Part) {
  const [markupRes, discountRes, manufactRes] = await Promise.all([
    dr.solve(markupRuleId, part),
    dr.solve(discountRuleId, part),
    dr.solve(manufactRuleId, part),
  ]);

  const markupAmountRaw =
    (markupRes as any)?.markupAmount ?? (markupRes as any)?.markup ?? 0;
  const discountAmountRaw =
    (discountRes as any)?.discountValue ?? (discountRes as any)?.discount ?? 0;

  const markupAmount =
    typeof markupAmountRaw === "number"
      ? markupAmountRaw
      : Number(markupAmountRaw) || 0;
  const discountAmount =
    typeof discountAmountRaw === "number"
      ? discountAmountRaw
      : Number(discountAmountRaw) || 0;

  const finalPrice = part.basePrice + markupAmount - discountAmount;
  const manufacturable = Boolean((manufactRes as any)?.isFeasible);

  return {
    input: part,
    outputs: {
      markup: markupRes,
      discount: discountRes,
      manufacturability: manufactRes,
    },
    summary: {
      markupAmount,
      discountAmount,
      finalPrice,
      manufacturable,
    },
  };
}

async function calcPriceViaFlow(part: Part) {
  return dr.solve(pricingFlowId, { input: part });
}

async function calcPriceViaFlowBatch(parts: Part[]) {
  return dr.solve(
    pricingFlowId,
    parts.map((part) => ({ input: part }))
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeInputWithFlowPayload(
  input: Part | undefined,
  payload: unknown
) {
  const effectiveInput = input ?? null;

  if (Array.isArray(payload)) {
    if (payload.length === 1 && isPlainObject(payload[0])) {
      return { ...payload[0], input: effectiveInput };
    }

    return payload.map((item) =>
      isPlainObject(item)
        ? { ...item, input: effectiveInput }
        : { input: effectiveInput, value: item }
    );
  }

  if (isPlainObject(payload)) {
    return { ...payload, input: effectiveInput };
  }

  return { input: effectiveInput, value: payload };
}

function pairInputsWithResponses(parts: Part[], responses: unknown) {
  if (Array.isArray(responses)) {
    return responses.map((payload, index) =>
      mergeInputWithFlowPayload(parts[index], payload)
    );
  }

  return parts.map((part) => mergeInputWithFlowPayload(part, responses));
}

const htmlFilePath = "public/index.html";

async function serveHtml() {
  const file = Bun.file(htmlFilePath);
  if (!(await file.exists())) {
    console.error(`Missing ${htmlFilePath}`);
    return new Response("HTML file not found", { status: 500 });
  }
  return new Response(file, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

const server = Bun.serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === "GET") {
      if (url.pathname === "/") {
        return serveHtml();
      }

      if (url.pathname === "/favicon.ico") {
        return new Response(null, { status: 404 });
      }

      return new Response("Not Found", { status: 404 });
    }

    if (req.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    let parts: Part[];

    try {
      const body = await req.json();
      if (!Array.isArray(body)) {
        throw new Error("Body must be an array");
      }
      parts = body as Part[];
    } catch (err) {
      return new Response("Body must be a JSON array of parts", { status: 400 });
    }

    try {
      if (url.pathname === "/rules") {
        const results = await Promise.all(parts.map(calcPriceWithRules));
        logDecisionRulesResponse({ path: url.pathname, parts }, results);
        return Response.json(results);
      }

      if (url.pathname === "/flow") {
        if (url.searchParams.get("batch") === "true") {
          const rawResults = await calcPriceViaFlowBatch(parts);
          const resultsWithInputs = pairInputsWithResponses(parts, rawResults);
          logDecisionRulesResponse(
            { path: url.pathname, parts },
            resultsWithInputs
          );
          return Response.json(resultsWithInputs);
        }
        const rawResults = await Promise.all(parts.map(calcPriceViaFlow));
        const resultsWithInputs = pairInputsWithResponses(parts, rawResults);
        logDecisionRulesResponse(
          { path: url.pathname, parts },
          resultsWithInputs
        );
        return Response.json(resultsWithInputs);
      }

      return new Response("Not Found", { status: 404 });
    } catch (err: any) {
      logDecisionRulesError(err, { path: url.pathname, parts });
      return new Response(err?.message ?? "Error", { status: 500 });
    }
  },
});

console.log(`Listening on http://localhost:${server.port}`);
