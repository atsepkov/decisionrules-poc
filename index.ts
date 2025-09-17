import { config as dotenvConfig } from "dotenv";
dotenvConfig();

import DecisionRules from "@decisionrules/decisionrules";

const solverKey = process.env.SOLVER_KEY || "";
const markupRuleId = process.env.MARKUP_RULE_ID || "";
const discountRuleId = process.env.DISCOUNT_RULE_ID || "";
const manufactRuleId = process.env.MANUFACTUR_RULE_ID || "";
const pricingFlowId = process.env.PRICING_FLOW_ID || "";

const dr = new DecisionRules({ solverKey });

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
    dr.solve(markupRuleId, "latest", part),
    dr.solve(discountRuleId, "latest", part),
    dr.solve(manufactRuleId, "latest", part),
  ]);

  const markupAmt = (markupRes as any).markupAmount ?? 0;
  const discountAmt = (discountRes as any).discountValue ?? 0;
  const finalPrice = part.basePrice + markupAmt - discountAmt;

  return { ...part, finalPrice, manufacturable: (manufactRes as any).isFeasible };
}

async function calcPriceViaFlow(part: Part) {
  return dr.solve(pricingFlowId, { input: part });
}

async function calcPriceViaFlowBatch(parts: Part[]) {
  return dr.solve(pricingFlowId, parts.map((part) => ({ input: part })));
}

const server = Bun.serve({
  port: 3000,
  async fetch(req) {
    if (req.method !== "POST") {
      return new Response("Only POST supported", { status: 405 });
    }

    const url = new URL(req.url);
    let parts: Part[];
    try {
      parts = await req.json();
    } catch (err) {
      return new Response("Invalid JSON", { status: 400 });
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
        } else {
          const results = await Promise.all(parts.map(calcPriceViaFlow));
          return Response.json(results);
        }
      }
      return new Response("Not Found", { status: 404 });
    } catch (err: any) {
      console.error(err);
      return new Response(err.message ?? "Error", { status: 500 });
    }
  },
});

console.log(`Listening on http://localhost:${server.port}`);
