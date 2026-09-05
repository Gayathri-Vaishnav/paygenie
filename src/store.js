/**
 * store.js
 * -----------------------------------------------------------------------
 * In-memory ledger and event store.
 * Keeps track of every payment link PayGenie has created and its latest
 * status, idempotency caches, and an activity audit feed.
 *
 * In a production build this would be PostgreSQL / Redis — kept in-memory
 * here for zero-setup local evaluation by recruiters and judges.
 * -----------------------------------------------------------------------
 */

const links = new Map(); // razorpay_payment_link_id -> record
const activityLog = [];
const processedWebhookEvents = new Set(); // for webhook idempotency
const commandIdempotencyCache = new Map(); // key -> { result, timestamp }

function addLink(record) {
  links.set(record.id, record);
  logActivity(`🔗 Created link for ${record.customerName} — ₹${record.amount} (${record.purpose})`, "link_created", {
    linkId: record.id,
    amount: record.amount,
  });
  if (record.reminderEnabled) {
    logActivity(`⏰ Scheduled follow-up reminder for ${record.customerName} (${record.reminderTimeline || 'tomorrow'})`, "reminder_scheduled", {
      linkId: record.id,
    });
  }
}

function getLink(id) {
  return links.get(id) || null;
}

function updateLinkStatus(id, status, extra = {}) {
  const record = links.get(id);
  if (!record) return null;
  const oldStatus = record.status;
  record.status = status;
  Object.assign(record, extra);
  links.set(id, record);

  if (oldStatus !== status) {
    logActivity(`💳 Status transition: ${oldStatus.toUpperCase()} → ${status.toUpperCase()} for ${record.customerName} (₹${record.amount})`, "status_change", {
      linkId: id,
      status,
    });
  }
  return record;
}

function getAllLinks() {
  return Array.from(links.values()).sort((a, b) => b.createdAt - a.createdAt);
}

function logActivity(message, type = "info", meta = {}) {
  const entry = {
    id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    message,
    type,
    meta,
    timestamp: new Date().toLocaleTimeString("en-IN", { hour12: false }),
    isoTime: new Date().toISOString(),
  };
  activityLog.unshift(entry);
  if (activityLog.length > 100) activityLog.pop();
  return entry;
}

function getActivityLog() {
  return activityLog;
}

// Webhook idempotency
function hasProcessedEvent(eventId) {
  return processedWebhookEvents.has(eventId);
}

function markEventProcessed(eventId) {
  processedWebhookEvents.add(eventId);
  logActivity(`🛡️ Webhook idempotency check: Event ${eventId.slice(0, 18)}... recorded`, "idempotency_recorded");
}

// Command idempotency (prevents rapid double-clicks / repeated commands within 60 seconds)
function getCommandCache(key) {
  const entry = commandIdempotencyCache.get(key);
  if (!entry) return null;
  // Expire after 60 seconds
  if (Date.now() - entry.timestamp > 60000) {
    commandIdempotencyCache.delete(key);
    return null;
  }
  return entry.result;
}

function setCommandCache(key, result) {
  commandIdempotencyCache.set(key, { result, timestamp: Date.now() });
}

module.exports = {
  addLink,
  getLink,
  updateLinkStatus,
  getAllLinks,
  logActivity,
  getActivityLog,
  hasProcessedEvent,
  markEventProcessed,
  getCommandCache,
  setCommandCache,
};
