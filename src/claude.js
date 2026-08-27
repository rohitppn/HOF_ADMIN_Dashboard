// Wrapper kept for backwards compatibility with existing imports.
// The actual parsing now happens in parse-msg.js with pure regex — no
// Anthropic API call, zero tokens spent per message.
//
// If you ever want to switch back to Claude parsing (better with weird
// free-form messages), re-import from '@anthropic-ai/sdk' and swap parseMessage
// back in place.

import { parseMessage as parseSync } from './parse-msg.js';

// async signature is preserved so ingestStoreMessage() doesn't need to change.
export async function parseMessage(text) {
  return parseSync(text);
}
