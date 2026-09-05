# PayGenie 🧞
### A conversational AI agent for creating and tracking Razorpay payment links

**Track:** AI Growth & Agentic Commerce
**Built for:** Razorpay Internship Project Submission

---

## The problem

Small merchants — a boutique owner, a tutor, a home baker — collect payments over WhatsApp all day: *"send me the payment link for the order"*. Today that means opening a dashboard, filling a form, copying a link, and separately remembering to follow up if it goes unpaid. It's manual, repetitive, and easy to lose track of.

**PayGenie turns that whole flow into one sentence.**

> "send Ramesh a ₹500 link for the saree order, remind him tomorrow if unpaid"

...becomes a real Razorpay Payment Link, tracked live on a dashboard, with a webhook-driven status update the moment it's paid.

## What it does

1. **Understands natural language** — a parser (LLM-backed if an API key is provided, regex fallback otherwise) extracts customer name, amount, purpose, and reminder intent from a plain-English command.
2. **Creates a real Razorpay Payment Link** via the [Payment Links API](https://razorpay.com/docs/payment-links/), in test mode.
3. **Tracks status live** — a webhook listener verifies and processes `payment_link.paid` / `payment.captured` / `payment.failed` events and updates a ledger UI in real time.
4. **Shows a live merchant ledger** — every link created, its status ("created" → "paid"), and an activity feed.

## Architecture

```
┌──────────────┐      command text       ┌───────────────────┐
│   Frontend    │ ───────────────────────▶│   Express server   │
│ (chat + ledger│                          │                    │
│    UI)        │◀─────────────────────── │  1. nlpParser.js   │
└──────────────┘   parsed intent + link   │  2. razorpayClient │
       ▲                                   │  3. store.js       │
       │ polls /api/links every 4s         └─────────┬──────────┘
       │                                              │ creates link
       │                                              ▼
       │                                    ┌───────────────────┐
       │                                    │   Razorpay API     │
       │                                    │  (test mode)       │
       │                                    └─────────┬──────────┘
       │                                              │ webhook on payment
       │                                              ▼
       │                                    ┌───────────────────┐
       └───────────────────────────────────│  webhookHandler.js │
                  ledger updates            │  (HMAC verified,   │
                                            │   idempotent)      │
                                            └───────────────────┘
```

## Tech stack

- **Backend:** Node.js, Express
- **Payments:** Razorpay Node SDK (Payment Links API, Webhooks)
- **NLP:** Regex-based parser by default; optional Claude API call for robust parsing of messy input
- **Frontend:** Vanilla HTML/CSS/JS (no build step — runs directly)
- **Storage:** In-memory store (swap for Postgres/Mongo in production)

## Setup

### 1. Clone and install
```bash
git clone <your-repo-url>
cd paygenie
npm install
```

### 2. Get Razorpay test credentials
1. Sign up at [dashboard.razorpay.com](https://dashboard.razorpay.com) (free, instant)
2. Go to **Settings → API Keys** and generate a **test mode** key pair
3. Copy `.env.example` to `.env` and paste in your keys:
```bash
cp .env.example .env
```

### 3. Set up the webhook (for live status updates)
1. Install [ngrok](https://ngrok.com) for local tunneling: `ngrok http 3000`
2. In the Razorpay Dashboard: **Settings → Webhooks → Add New Webhook**
   - URL: `https://<your-ngrok-id>.ngrok.io/api/webhook`
   - Active events: `payment_link.paid`, `payment.captured`, `payment.failed`
   - Set a webhook secret and paste it into `.env` as `RAZORPAY_WEBHOOK_SECRET`

### 4. Run it
```bash
npm start
```
Visit `http://localhost:3000`.

### 5. Try a command
```
send Ramesh a ₹500 link for the saree order, remind tomorrow
```
- Click **Open Checkout ↗** to open the real Razorpay test checkout and pay with test credentials.
- Click **Sync ⟳** on the ledger card to query the official Razorpay API directly and refresh the status without needing external tunnels!
- Check the **Security & Webhook Log** at the bottom to watch the HMAC-SHA256 signature verification and idempotency deduplication stream in real time.

## Key Fintech Engineering Features

### 1. Cryptographic Webhook Signature Verification (HMAC-SHA256)
Every webhook delivery from Razorpay is cryptographically signed using the merchant's `RAZORPAY_WEBHOOK_SECRET`. PayGenie captures the raw request byte stream in Express's `verify` hook and computes the expected HMAC-SHA256 signature using Razorpay's official `validateWebhookSignature` helper. Any forged, altered, or unsigned requests are immediately rejected with HTTP 400.

### 2. Dual-Layer Idempotency Guard
- **Webhook Deduplication**: Razorpay automatically retries webhook deliveries if network latency exceeds delivery thresholds. PayGenie tracks incoming `event_id` keys in an idempotency cache, gracefully returning `200 already_processed` to avoid double-crediting or duplicate accounting.
- **Command Deduplication**: If a merchant double-clicks "Send" or re-submits an identical billing instruction within 60 seconds, PayGenie returns the existing payment link rather than generating a duplicate charge.

### 3. Authoritative Live Sync (`GET /api/links/:id/sync`)
For seamless local evaluation without requiring `ngrok`, PayGenie provides an on-demand synchronization layer that directly fetches the source of truth from Razorpay's `paymentLink.fetch(linkId)` API.

### 4. Robust Conversational NLP Parser
A deterministic entity-extraction engine tailored for Indian commerce idioms (Rs., ₹, rupees, /-, "bill Rohit 1500", "milk shop down the road") with stopword guardrails, plus optional Claude/LLM support for multi-clause commands.

## License

MIT
