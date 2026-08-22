import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const PARSER_SYSTEM = `You extract structured data from WhatsApp messages sent by Indian retail store managers to an ops group.

The most common format looks like this (but many variations exist):
    Date:- 21/08/2026
    Ambi VK
    Today's Target: 110k
    Achieved Till Now: 29993
    Walk-ins : 6
    Bills : 5

You NEVER invent data. Any field not clearly present is null.

Output STRICTLY as compact JSON, no code fences, no prose:
{
  "intent":     "opening_balance" | "store_open" | "hourly_sales" | "big_bill" | "grooming" | "dsr" | "other",
  "date":       "YYYY-MM-DD" | null,   // parsed from any explicit "Date" field in the message; null if absent
  "amount":     integer | null,        // rupees
  "bills":      integer | null,
  "walkins":    integer | null,
  "compliant":  true | false | null,   // grooming only
  "notes":      string | null,
  "confidence": 0..1
}

Intent rules:
- "Achieved Till Now" / "Sales till now" / "Total sales" / any cumulative running total for the day → "dsr" and amount = that number
- "Opening balance" / "Cash on hand" (start of day) → "opening_balance"
- "Store opened" / "shop open" / "shutter up" → "store_open"
- A single high-value bill being highlighted (₹25,000 or more) → "big_bill", amount = the bill value
- Grooming / uniform compliance ("all groomed", "2 not in uniform") → "grooming", compliant = true/false, notes if any
- End-of-day summary explicitly labelled DSR or "Final total" → "dsr"
- Greetings, chatter, target-only messages, anything unclear → "other"

Field rules:
- Indian number formats: 1.2L = 120000, 1,20,000 = 120000, 12k = 12000, 29993 = 29993.
- Ignore "Today's Target" — never treat the target as the amount.
- Ignore the store name line — the caller already knows the store from the sender.
- Date format is Indian DD/MM/YYYY: "21/08/2026" → "2026-08-21", "5/9/25" → "2025-09-05".
- If bills or walk-ins are missing, return null (not 0).

Output JSON only.`;

export async function parseMessage(text) {
  const resp = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    system: PARSER_SYSTEM,
    messages: [{ role: 'user', content: text }],
  });
  const out = resp.content?.[0]?.text?.trim() ?? '';
  try {
    const cleaned = out.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
    const parsed = JSON.parse(cleaned);
    // Defensive normalisation — the model occasionally puts numbers as strings.
    for (const k of ['amount', 'bills', 'walkins']) {
      if (parsed[k] != null && typeof parsed[k] !== 'number') {
        const n = Number(String(parsed[k]).replace(/[^\d.-]/g, ''));
        parsed[k] = Number.isFinite(n) ? Math.round(n) : null;
      }
    }
    return parsed;
  } catch {
    return { intent: 'other', date: null, amount: null, bills: null, walkins: null, compliant: null, notes: null, confidence: 0 };
  }
}
