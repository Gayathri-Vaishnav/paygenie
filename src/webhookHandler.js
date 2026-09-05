/**
 * webhookHandler.js
 * -----------------------------------------------------------------------
 * Handles incoming Razorpay webhooks (payment_link.paid, payment.captured,
 * payment.failed, payment_link.cancelled, etc).
 *
 * Key Fintech Engineering Highlights:
 * 1. SIGNATURE VERIFICATION
 *    Every webhook body is cryptographically signed with HMAC-SHA256 using
 *    your webhook secret. We verify using Razorpay's official
 *    `validateWebhookSignature` helper over the RAW byte stream.
 *
 * 2. IDEMPOTENCY / RETRIES
 *    Razorpay retries a webhook delivery if your server doesn't respond
 *    with 2xx quickly enough — which means the *same* event can arrive
 *    more than once. We dedupe on `event_id` so we never double-process
 *    (e.g. never trigger double accounting or repeat notifications).
 * -----------------------------------------------------------------------
 */

const { validateWebhookSignature } = require("razorpay/dist/utils/razorpay-utils");
const store = require("./store");

function handleWebhook(req, res) {
  const signature = req.headers["x-razorpay-signature"];
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const rawBody = req.rawBody; // captured via express.json verify hook

  if (!secret || secret === "your_webhook_secret_here") {
    store.logActivity("⚠️ Webhook received, but RAZORPAY_WEBHOOK_SECRET is not configured in .env", "warning");
    return res.status(500).json({ error: "Webhook secret is unconfigured on server" });
  }

  if (!signature) {
    store.logActivity("❌ Webhook rejected: missing x-razorpay-signature header", "security_alert");
    return res.status(400).json({ error: "Missing signature header" });
  }

  try {
    const isValid = validateWebhookSignature(rawBody, signature, secret);
    if (!isValid) {
      store.logActivity("❌ Cryptographic signature mismatch — rejecting forged webhook payload", "security_alert");
      return res.status(400).json({ error: "Invalid signature" });
    }
  } catch (err) {
    console.error("Signature verification error:", err.message);
    store.logActivity(`❌ Signature verification exception: ${err.message}`, "error");
    return res.status(400).json({ error: "Signature verification failed" });
  }

  const event = req.body;
  const eventId = event.event_id || `${event.event}-${event.created_at || Date.now()}`;

  store.logActivity(`🔒 HMAC-SHA256 signature verified successfully for event: ${event.event}`, "webhook_verified", {
    eventId,
    eventType: event.event,
  });

  // Idempotency check — Razorpay retries the same event on timeout / delivery error
  if (store.hasProcessedEvent(eventId)) {
    store.logActivity(`↩️ Duplicate webhook event ignored (idempotent skip): ${eventId.slice(0, 20)}...`, "idempotent_skip");
    return res.status(200).json({ status: "already_processed" });
  }
  store.markEventProcessed(eventId);

  switch (event.event) {
    case "payment_link.paid": {
      const link = event.payload?.payment_link?.entity;
      if (link && link.id) {
        store.updateLinkStatus(link.id, "paid", {
          paidAt: Date.now(),
          paymentId: event.payload?.payment?.entity?.id || null,
        });
      }
      break;
    }
    case "payment.captured": {
      const payment = event.payload?.payment?.entity;
      if (payment && payment.invoice_id) {
        store.updateLinkStatus(payment.invoice_id, "paid", {
          paidAt: Date.now(),
          paymentId: payment.id,
        });
      }
      break;
    }
    case "payment_link.cancelled": {
      const link = event.payload?.payment_link?.entity;
      if (link && link.id) {
        store.updateLinkStatus(link.id, "cancelled");
      }
      break;
    }
    case "payment_link.expired": {
      const link = event.payload?.payment_link?.entity;
      if (link && link.id) {
        store.updateLinkStatus(link.id, "expired");
      }
      break;
    }
    case "payment.failed": {
      const payment = event.payload?.payment?.entity;
      store.logActivity(`⚠️ Payment failed: ${payment?.error_description || "Declined by issuing bank"}`, "payment_failed");
      break;
    }
    default:
      store.logActivity(`ℹ️ Received unhandled event: ${event.event}`, "info");
  }

  // Always respond with 200 fast to acknowledge receipt
  res.status(200).json({ status: "ok" });
}

module.exports = { handleWebhook };
