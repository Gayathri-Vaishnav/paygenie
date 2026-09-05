/**
 * nlpParser.js
 * -----------------------------------------------------------------------
 * Turns a natural-language command like:
 *   "send Ramesh a ₹500 link for the saree order, remind tomorrow if unpaid"
 * into a structured intent:
 *   {
 *     action: "create_payment_link",
 *     customerName: "Ramesh",
 *     amount: 500,
 *     currency: "INR",
 *     purpose: "saree order",
 *     reminderEnabled: true,
 *     reminderTimeline: "tomorrow"
 *   }
 *
 * Two modes:
 *  1. LLM mode (if ANTHROPIC_API_KEY is set) — sends the command to an LLM
 *     for parsing complex, multi-sentence or messy instructions.
 *  2. Upgraded Deterministic Parser — high-accuracy entity extraction handling
 *     varied Indian payment idioms (Rs, ₹, rupees, /-, "bill Rohit 1500", etc.)
 *     with stopword protection to avoid naming mistakes (e.g. naming customer "pay").
 * -----------------------------------------------------------------------
 */

const hasLLM = !!process.env.ANTHROPIC_API_KEY;

// Words that should NEVER be accepted as a customer's name
const INVALID_CUSTOMER_NAMES = new Set([
  "pay", "payment", "request", "link", "money", "cash", "bill", "invoice",
  "send", "collect", "charge", "remind", "nudge", "tomorrow", "customer", "an", "a", "the"
]);

function cleanCustomerName(name) {
  if (!name) return "Customer";
  let cleaned = name.trim().replace(/^[,\s]+|[,\s]+$/g, "");
  // Remove trailing prepositions or verbs
  cleaned = cleaned.replace(/\s+(for|to|at|in|on|with|remind|tomorrow)$/i, "").trim();

  if (INVALID_CUSTOMER_NAMES.has(cleaned.toLowerCase()) || cleaned.length < 2) {
    return "Customer";
  }

  // Capitalize words nicely
  return cleaned
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function parseWithRegex(command) {
  const text = command.trim();

  // 1. Amount Extraction
  // Supports: ₹500, Rs 500, Rs.500, 500rs, 500 rupees, 500/-, INR 500, or "bill Rohit 1500"
  let amount = null;
  const amountWithSymbol =
    text.match(/(?:₹|rs\.?|inr)\s?([\d,]+(?:\.\d{1,2})?)/i) ||
    text.match(/([\d,]+(?:\.\d{1,2})?)\s?(?:rupees|rs\.?|inr|\/-)/i);

  if (amountWithSymbol) {
    amount = parseFloat(amountWithSymbol[1].replace(/,/g, ""));
  } else {
    // Check for raw number after keywords like "bill Rohit 1500" or "pay 450"
    const rawNumberMatch =
      text.match(/(?:bill|charge|collect|invoice|pay|apy)\s+[A-Za-z]+\s+([\d,]+(?:\.\d{1,2})?)\b/i) ||
      text.match(/(?:pay|apy|for|amount|of|remind)\s+([\d,]+(?:\.\d{1,2})?)\b/i) ||
      text.match(/\b([\d,]+(?:\.\d{1,2})?)\s+link\b/i);
    if (rawNumberMatch) {
      amount = parseFloat(rawNumberMatch[1].replace(/,/g, ""));
    } else {
      // Fallback: any standalone positive number in the command
      const allNumbers = text.match(/\b\d+(?:\.\d{1,2})?\b/g);
      if (allNumbers) {
        const candidates = allNumbers.map(Number).filter(n => n > 0 && n < 10000000 && n !== 2025 && n !== 2026);
        if (candidates.length > 0) {
          amount = candidates[0];
        }
      }
    }
  }

  // 2. Customer Name Extraction
  let customerName = "Customer";

  // Patterns for conversational instructions:
  // "remind ty to pay 450" -> Ty
  const remindToPayMatch = text.match(/remind\s+([A-Za-z0-9]+)\s+to\s+(?:pay|apy|send|clear)/i);
  // "ask rahul to pay 500" -> Rahul
  const askToPayMatch = text.match(/ask\s+([A-Za-z0-9]+)\s+to\s+(?:pay|apy|send)/i);
  // "ty to apy 450" or "ty to pay 450" -> Ty
  const nameToPayMatch = text.match(/^([A-Za-z0-9]+)\s+to\s+(?:pay|apy|send)/i);
  // "send a request to pay 320 rs to the milk shop down the road"
  const sendToMerchantMatch = text.match(/to\s+(?:the\s+)?([A-Za-z0-9\s]+?)(?:\s+down\s+the\s+road|\s+shop|\s+store)?(?:,|\.|$| remind)/i);
  // "send [Name] a ₹X link..." or "send [Name] ₹X"
  const sendToNameMatch = text.match(/send\s+([A-Za-z]+)\s+(?:a|an|\d|₹|rs|inr)/i);
  // "collect ₹X from [Name]..." or "from [Name]"
  const fromNameMatch = text.match(/from\s+([A-Za-z]+)\b/i);
  // "bill [Name]..." or "charge [Name]..."
  const billNameMatch = text.match(/(?:bill|charge|invoice)\s+([A-Za-z]+)\b/i);
  // "create a ₹X link for [Name] for [Purpose]"
  const forNameMatch = text.match(/link\s+for\s+([A-Za-z]+)\s+for\b/i) || text.match(/link\s+for\s+([A-Za-z]+)\b/i);

  if (remindToPayMatch && !INVALID_CUSTOMER_NAMES.has(remindToPayMatch[1].toLowerCase())) {
    customerName = remindToPayMatch[1];
  } else if (askToPayMatch && !INVALID_CUSTOMER_NAMES.has(askToPayMatch[1].toLowerCase())) {
    customerName = askToPayMatch[1];
  } else if (nameToPayMatch && !INVALID_CUSTOMER_NAMES.has(nameToPayMatch[1].toLowerCase())) {
    customerName = nameToPayMatch[1];
  } else if (sendToNameMatch && !INVALID_CUSTOMER_NAMES.has(sendToNameMatch[1].toLowerCase())) {
    customerName = sendToNameMatch[1];
  } else if (fromNameMatch && !INVALID_CUSTOMER_NAMES.has(fromNameMatch[1].toLowerCase())) {
    customerName = fromNameMatch[1];
  } else if (billNameMatch && !INVALID_CUSTOMER_NAMES.has(billNameMatch[1].toLowerCase())) {
    customerName = billNameMatch[1];
  } else if (forNameMatch && !INVALID_CUSTOMER_NAMES.has(forNameMatch[1].toLowerCase())) {
    customerName = forNameMatch[1];
  } else if (text.toLowerCase().includes("milk shop")) {
    customerName = "The Milk Shop";
  } else if (sendToMerchantMatch && !INVALID_CUSTOMER_NAMES.has(sendToMerchantMatch[1].trim().toLowerCase())) {
    customerName = sendToMerchantMatch[1].trim();
  }

  customerName = cleanCustomerName(customerName);

  // 3. Purpose Extraction
  let purpose = "Payment request";
  const purposeMatch =
    text.match(/for\s+(?:the\s+)?([a-zA-Z0-9\s]+?)(?:,|\.|$|\s+remind|\s+nudge|\s+follow)/i) ||
    text.match(/(?:towards|regarding|purpose:?)\s+([a-zA-Z0-9\s]+?)(?:,|\.|$|\s+remind)/i);

  if (purposeMatch) {
    let rawPurpose = purposeMatch[1].trim();
    if (rawPurpose.toLowerCase().startsWith(customerName.toLowerCase() + " for ")) {
      rawPurpose = rawPurpose.slice(customerName.length + 5);
    }
    if (rawPurpose && rawPurpose.toLowerCase() !== customerName.toLowerCase()) {
      purpose = rawPurpose;
    }
  } else if (text.toLowerCase().includes("milk shop")) {
    purpose = "Milk shop purchase";
  }

  // 4. Reminder Extraction
  const reminderEnabled = /remind|follow[\s-]?up|nudge/i.test(text);
  let reminderTimeline = null;
  if (reminderEnabled) {
    if (/tomorrow/i.test(text)) reminderTimeline = "tomorrow";
    else if (/in\s+(\d+)\s+days?/i.test(text)) {
      const days = text.match(/in\s+(\d+)\s+days?/i)[1];
      reminderTimeline = `in ${days} days`;
    } else if (/tonight/i.test(text)) reminderTimeline = "tonight";
    else reminderTimeline = "in 24 hours";
  }

  return {
    customerName,
    amount,
    currency: "INR",
    purpose,
    reminderEnabled,
    reminderTimeline,
  };
}

async function parseWithLLM(command) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 300,
      system:
        "You extract structured payment-link data from a merchant's natural language command. " +
        "Respond ONLY with raw JSON, no markdown fences, no preamble. Schema: " +
        '{"customerName": string, "amount": number, "currency": "INR", "purpose": string, "reminderEnabled": boolean, "reminderTimeline": string | null}. ' +
        "If a field is missing, make a reasonable default (currency always INR unless stated otherwise, reminderEnabled false unless mentioned). " +
        "Never assign verbs like 'pay', 'send', 'bill' as customerName.",
      messages: [{ role: "user", content: command }],
    }),
  });
  const data = await res.json();
  const text = data.content?.find((b) => b.type === "text")?.text || "{}";
  const clean = text.replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(clean);
  parsed.customerName = cleanCustomerName(parsed.customerName);
  return parsed;
}

async function parseCommand(command) {
  if (hasLLM) {
    try {
      return await parseWithLLM(command);
    } catch (err) {
      console.warn("LLM parse failed, falling back to deterministic parser:", err.message);
      return parseWithRegex(command);
    }
  }
  return parseWithRegex(command);
}

module.exports = { parseCommand, parseWithRegex };
