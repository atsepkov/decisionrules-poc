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

async function calcPriceWithRules(part: Part) {
  const [markupRes, discountRes, manufactRes] = await Promise.all([
    dr.solve(markupRuleId, part, "latest"),
    dr.solve(discountRuleId, part, "latest"),
    dr.solve(manufactRuleId, part, "latest"),
  ]);

  const markupAmt = (markupRes as any).markupAmount ?? 0;
  const discountAmt = (discountRes as any).discountValue ?? 0;
  const finalPrice = part.basePrice + markupAmt - discountAmt;

  return { ...part, finalPrice, manufacturable: (manufactRes as any).isFeasible };
}

async function calcPriceViaFlow(part: Part) {
  return dr.solve(pricingFlowId, part, "latest");
}

async function calcPriceViaFlowBatch(parts: Part[]) {
  return dr.solve(pricingFlowId, parts, "latest");
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
        return Response.json(results);
      }

      if (url.pathname === "/flow") {
        if (url.searchParams.get("batch") === "true") {
          const results = await calcPriceViaFlowBatch(parts);
          return Response.json(results);
        }
        const results = await Promise.all(parts.map(calcPriceViaFlow));
        return Response.json(results);
      }

      return new Response("Not Found", { status: 404 });
    } catch (err: any) {
      logDecisionRulesError(err, { path: url.pathname, parts });
      return new Response(err?.message ?? "Error", { status: 500 });
    }
  },
});

console.log(`Listening on http://localhost:${server.port}`);
