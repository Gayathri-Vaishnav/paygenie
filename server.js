require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");

const razorpay = require("./src/razorpayClient");
const { parseCommand } = require("./src/nlpParser");
const { handleWebhook } = require("./src/webhookHandler");
const store = require("./src/store");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// Capture the raw body (needed for webhook signature verification) while
// still parsing JSON for normal routes.
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf.toString();
    },
  })
);

app.use(express.static(path.join(__dirname, "public")));

/**
 * POST /api/command
 * Body: { command: "send Ramesh a ₹500 link for the saree order" }
 *
 * 1. Parses the natural-language command into structured intent
 * 2. Calls the Razorpay Payment Links API to create a real (test-mode) link
 * 3. Stores it so the dashboard can show live status
 */
app.post("/api/command", async (req, res) => {
  const { command } = req.body;
  if (!command || !command.trim()) {
    return res.status(400).json({ error: "Command text is required" });
  }

  // Idempotency check: prevent duplicate charges on quick double-clicks
  const idempotencyKey = command.trim().toLowerCase();
  const cachedResponse = store.getCommandCache(idempotencyKey);
  if (cachedResponse) {
    store.logActivity(`🛡️ Idempotent command caught: returning existing link for "${command}"`, "idempotent_command");
    return res.json({
      ...cachedResponse,
      idempotentCached: true,
    });
  }

  try {
    const intent = await parseCommand(command);

    if (!intent.amount || intent.amount <= 0) {
      return res.status(422).json({
        error: "Couldn't figure out an amount from that command. Try: 'send Ramesh a ₹500 link for the saree order'",
      });
    }

    const paymentLink = await razorpay.paymentLink.create({
      amount: Math.round(intent.amount * 100), // Razorpay expects paise
      currency: intent.currency || "INR",
      description: intent.purpose || "Payment request",
      customer: {
        name: intent.customerName || "Customer",
      },
      notify: { sms: false, email: false }, // demo mode: no real SMS/email sent
      reminder_enable: !!intent.reminderEnabled,
    });

    store.addLink({
      id: paymentLink.id,
      customerName: intent.customerName,
      amount: intent.amount,
      purpose: intent.purpose,
      reminderEnabled: intent.reminderEnabled,
      reminderTimeline: intent.reminderTimeline,
      status: paymentLink.status,
      shortUrl: paymentLink.short_url,
      createdAt: Date.now(),
    });

    const result = {
      success: true,
      intent,
      paymentLink: {
        id: paymentLink.id,
        short_url: paymentLink.short_url,
        status: paymentLink.status,
      },
    };

    // Cache for 60 seconds
    store.setCommandCache(idempotencyKey, result);

    res.json(result);
  } catch (err) {
    console.error("Error creating payment link:", err);
    res.status(500).json({
      error: "Failed to create payment link",
      details: err?.error?.description || err.message,
    });
  }
});

// GET /api/links — for the dashboard to poll current state
app.get("/api/links", (req, res) => {
  res.json({ links: store.getAllLinks(), activity: store.getActivityLog() });
});

// GET /api/links/:id/sync — on-demand fetch from Razorpay API
app.get("/api/links/:id/sync", async (req, res) => {
  const linkId = req.params.id;
  try {
    const liveLink = await razorpay.paymentLink.fetch(linkId);
    if (!liveLink) {
      return res.status(404).json({ error: "Link not found on Razorpay" });
    }

    const updated = store.updateLinkStatus(linkId, liveLink.status, {
      amountPaid: liveLink.amount_paid ? liveLink.amount_paid / 100 : 0,
      updatedAt: Date.now(),
    });

    res.json({ success: true, status: liveLink.status, link: updated || liveLink });
  } catch (err) {
    console.error("Error syncing link from Razorpay:", err);
    res.status(500).json({
      error: "Failed to sync status from Razorpay",
      details: err?.error?.description || err.message,
    });
  }
});

// Razorpay webhook endpoint — configure this URL in the Razorpay Dashboard
// under Settings > Webhooks. During local dev, expose it with ngrok:
//   ngrok http 3000
// then set the webhook URL to https://<ngrok-id>.ngrok.io/api/webhook
app.post("/api/webhook", handleWebhook);

app.get("/health", (req, res) => res.json({ status: "ok" }));

app.listen(PORT, () => {
  console.log(`🚀 PayGenie running at http://localhost:${PORT}`);
});
