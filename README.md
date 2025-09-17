# decisionrules-poc

Proof-of-concept Bun web service that runs parts through [DecisionRules](https://decisionrules.io) logic.

## Setup

Install dependencies:

```bash
bun install
```

Copy `.env.example` to `.env` and fill in your DecisionRules IDs:

```bash
cp .env.example .env
# edit .env
```

| Variable | Description |
| --- | --- |
| `SOLVER_KEY` | Solver API key |
| `MARKUP_RULE_ID` | ID of markup decision table |
| `DISCOUNT_RULE_ID` | ID of discount decision table |
| `MANUFACTUR_RULE_ID` | ID of manufacturability rule |
| `PRICING_FLOW_ID` | ID of rule flow combining pricing logic |
| `LOG_RESPONSE` | Optional flag (`true` to log DecisionRules responses) |

## Running

Start the server on port 3000:

```bash
bun run index.ts
```

## API

Send a JSON array of part objects to one of the endpoints:

| Endpoint | Description |
| --- | --- |
| `POST /rules` | calls individual rules per part and combines results |
| `POST /flow` | calls a rule flow per part |
| `POST /flow?batch=true` | sends the entire array to the rule flow in one call |

Example request:

```bash
curl -X POST http://localhost:3000/rules \
  -H "Content-Type: application/json" \
  -d '[{"basePrice":100,"method":"CNC","material":"Aluminum","quantity":50,"customerTier":"Gold"}]'
```

This project was created using `bun init` in bun v1.2.19. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
