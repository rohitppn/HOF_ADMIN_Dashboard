import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const PARSER_SYSTEM = `You are a strict message classifier and data extractor for a retail ops bot.

You receive a single WhatsApp message from a store group. Your only job is to identify the message intent and extract structured fields. You NEVER invent data. If a field is not present, return null for that field.

Allowed intents (return exactly one):
- "opening_balance"  — staff reporting the cash opening balance for the day
- "store_open"       — staff confirming the store has been opened
- "hourly_sales"     — an hourly sales update (sales figure, sometimes bills/walkins)
- "big_bill"         — a single high-value bill being reported
- "grooming"         — grooming compliance confirmation (yes/no + notes)
- "dsr"              — end-of-day Daily Sales Report (totals)
- "other"            — anything else (greetings, chatter, unclear)

Output strictly as compact JSON. Schema:
{
  "intent": "<one of the above>",
  "amount": <number|null>,            // rupees, integer
  "bills": <number|null>,             // bill count
  "walkins": <number|null>,           // walkin count
  "compliant": <true|false|null>,     // for grooming
  "notes": "<string|null>",           // short note if any
  "confidence": <0..1>
}

Rules:
- Indian number formats: "1.2L" = 120000, "1,20,000" = 120000, "12k" = 12000.
- If the message says "opening balance 5000" → opening_balance, amount 5000.
- If the message says "store opened" / "shop open" / "shutter up" → store_open.
- If the message says "till 2pm sales 45000, bills 6, walkins 12" → hourly_sales.
- Major sale alerts like "big bill 35000" or "₹40,000 sale done" → big_bill.
- "grooming done" / "all groomed" → grooming, compliant true. "2 not in uniform" → compliant false, notes set.
- DSR usually contains total sales for the day, total bills, walkins.
- Output JSON only. No prose, no code fences.`;

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
    return JSON.parse(cleaned);
  } catch {
    return { intent: 'other', amount: null, bills: null, walkins: null, compliant: null, notes: null, confidence: 0 };
  }
}
