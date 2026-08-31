// Claude Haiku parser for store WhatsApp messages.
// Falls back to the pure-regex parser (src/parse-msg.js) when Claude times out
// or errors — bot keeps working, no message lost.

import Anthropic from '@anthropic-ai/sdk';
import { parseMessage as parseRegex } from './parse-msg.js';

const client = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

const PARSER_SYSTEM = `You extract structured data from Indian retail store WhatsApp messages.

Formats you'll see include:

Structured DSR:
    Date:- 21/08/2026
    Store: *VK Ambience mall*
    Today's Target: 110k
    Achieved Till Now: 29993
    Walk-ins: 6
    Bills: 5

Big-bill celebration (may include emoji digits like 2️⃣5️⃣1️⃣9️⃣7️⃣ = 25197):
    🤩Wow Big Bill🤩
    Store: Oberoi
    Value – 25197
    Quantity – 3
    Assisted by – Saikshi

Casual updates:
    "STORE : MOM PUNE Ach : 8997 Walkin: 4 Bill: 2"
    "sales till now 87k walkins 22 bills 11"
    "Opening balance 5000"
    "Store opened"
    "Grooming done" / "2 not in uniform"

Output STRICT compact JSON only — no code fences, no prose, no explanation:
{
  "intent": "opening_balance"|"store_open"|"hourly_sales"|"big_bill"|"grooming"|"dsr"|"other",
  "date": "YYYY-MM-DD" | null,
  "amount": integer | null,
  "bills": integer | null,
  "walkins": integer | null,
  "compliant": true | false | null,
  "notes": string | null,
  "bigBillAmount": integer | null,
  "confidence": 0..1
}

Rules:
- Indian numbers: 1.2L = 120000, 12k = 12000, 1,20,000 = 120000, "9k" = 9000.
- Decode emoji-digit keycaps: 2️⃣5️⃣1️⃣9️⃣7️⃣ = 25197.
- "Achieved Till Now" / "Ach" / running total for the day → intent=dsr, amount = that number.
- "Opening balance" / "cash on hand" → intent=opening_balance.
- "Big bill" / "Wow bill" / celebration post with "Value" → intent=big_bill with amount.
- If a message contains BOTH a big-bill announcement AND a DSR total (like a celebration post that also updates the day total), set intent=dsr with amount = the DSR total AND set bigBillAmount = the big-bill value.
- Grooming: "all groomed" / "grooming done" → compliant=true. "not in uniform" / "missing" → compliant=false, notes = short snippet.
- "Store opened" / "shutter up" / "shop open" → intent=store_open.
- Ignore "Today's Target" — never use as amount.
- Ignore store name / "Assisted by" / greetings.
- DD/MM/YYYY input: "21/08/2026" → "2026-08-21". Reject typos like year 3026 → return null.
- Bills is a small count (typically 1-50). If the "bill" number is large (e.g. 25000), it's a rupee amount, not a bill count → set bills=null.
- If the message is greetings / chatter / unclear → intent=other.
- Output JSON ONLY.`;

export async function parseMessage(text) {
  // No API key or empty text — fall back immediately.
  if (!client) return parseRegex(text);
  if (!text || !String(text).trim()) return parseRegex(text);

  try {
    const resp = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system: PARSER_SYSTEM,
      messages: [{ role: 'user', content: String(text) }],
    });
    const out = resp.content?.[0]?.text?.trim() ?? '';
    const cleaned = out.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
    const parsed = JSON.parse(cleaned);
    // Coerce numeric fields — Claude sometimes returns them as strings.
    for (const k of ['amount', 'bills', 'walkins', 'bigBillAmount']) {
      if (parsed[k] != null && typeof parsed[k] !== 'number') {
        const n = Number(String(parsed[k]).replace(/[^\d.-]/g, ''));
        parsed[k] = Number.isFinite(n) ? Math.round(n) : null;
      }
    }
    return parsed;
  } catch (e) {
    console.warn('[claude] parse failed, using regex fallback:', e.message);
    return parseRegex(text);
  }
}
