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
const solverClient = dr as unknown as {
  solve(ruleId: string, version: string, payload: unknown): Promise<any>;
};

type Part = {
  basePrice: number;
  method: string;
  material: string;
  quantity: number;
  customerTier: string;
  [key: string]: any;
};

async function calcPriceWithRules(part: Part) {
  const [markupRes, discountRes, manufactRes] = await Promise.all([
    solverClient.solve(markupRuleId, "latest", part),
    solverClient.solve(discountRuleId, "latest", part),
    solverClient.solve(manufactRuleId, "latest", part),
  ]);

  const markupAmt = (markupRes as any).markupAmount ?? 0;
  const discountAmt = (discountRes as any).discountValue ?? 0;
  const finalPrice = part.basePrice + markupAmt - discountAmt;

  return { ...part, finalPrice, manufacturable: (manufactRes as any).isFeasible };
}

async function calcPriceViaFlow(part: Part) {
  return solverClient.solve(pricingFlowId, "latest", part);
}

async function calcPriceViaFlowBatch(parts: Part[]) {
  return solverClient.solve(pricingFlowId, "latest", parts);
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
      console.error(err);
      return new Response(err?.message ?? "Error", { status: 500 });
    }
  },
});

console.log(`Listening on http://localhost:${server.port}`);
