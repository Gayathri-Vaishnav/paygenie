const messagesEl = document.getElementById("messages");
const formEl = document.getElementById("command-form");
const inputEl = document.getElementById("command-input");
const ledgerListEl = document.getElementById("ledger-list");
const ledgerCountEl = document.getElementById("ledger-count");
const activityFeedEl = document.getElementById("activity-feed");

function addMessage(text, type = "system", html = false) {
  const div = document.createElement("div");
  div.className = `msg msg-${type}`;
  if (html) {
    div.innerHTML = text;
  } else {
    div.textContent = text;
  }
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

formEl.addEventListener("submit", async (e) => {
  e.preventDefault();
  const command = inputEl.value.trim();
  if (!command) return;

  addMessage(command, "user");
  inputEl.value = "";

  try {
    const res = await fetch("/api/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command }),
    });
    const data = await res.json();

    if (!res.ok) {
      const el = document.createElement("div");
      el.className = "msg msg-system error";
      el.textContent = data.error || "Something went wrong.";
      messagesEl.appendChild(el);
      messagesEl.scrollTop = messagesEl.scrollHeight;
      return;
    }

    const { intent, paymentLink, idempotentCached } = data;
    const reminderInfo = intent.reminderEnabled
      ? ` · reminder scheduled (${intent.reminderTimeline || 'tomorrow'})`
      : "";
    const cachedBadge = idempotentCached ? ' <span class="idempotent-badge">⚡ Idempotent duplicate caught</span>' : "";

    addMessage(
      `Created a ₹${intent.amount} link for ${intent.customerName} — "${intent.purpose}"${reminderInfo}${cachedBadge}` +
        `<br><a class="msg-link" href="${paymentLink.short_url}" target="_blank" rel="noopener">${paymentLink.short_url}</a>`,
      "system",
      true
    );

    refreshLedger();
  } catch (err) {
    addMessage("Network error — is the server running?", "system");
  }
});

document.querySelectorAll(".example-chip").forEach((btn) => {
  btn.addEventListener("click", () => {
    inputEl.value = btn.dataset.text;
    inputEl.focus();
  });
});

window.copyLink = function (url, btn) {
  navigator.clipboard.writeText(url).then(() => {
    const orig = btn.textContent;
    btn.textContent = "Copied!";
    btn.classList.add("copied");
    setTimeout(() => {
      btn.textContent = orig;
      btn.classList.remove("copied");
    }, 1500);
  });
};

window.syncStatus = async function (id, btn) {
  if (btn) btn.textContent = "Syncing...";
  try {
    const res = await fetch(`/api/links/${encodeURIComponent(id)}/sync`);
    const data = await res.json();
    if (res.ok) {
      if (btn) btn.textContent = "Synced ✓";
      setTimeout(() => { if (btn) btn.textContent = "Sync ⟳"; }, 1200);
      refreshLedger();
    } else {
      if (btn) btn.textContent = "Failed ⚠️";
      setTimeout(() => { if (btn) btn.textContent = "Sync ⟳"; }, 1500);
    }
  } catch (err) {
    if (btn) btn.textContent = "Error";
    setTimeout(() => { if (btn) btn.textContent = "Sync ⟳"; }, 1500);
  }
};

function renderLedger(links) {
  ledgerCountEl.textContent = `${links.length} link${links.length === 1 ? "" : "s"}`;

  if (links.length === 0) {
    ledgerListEl.innerHTML = `<p class="empty-state">No payment links yet. Send a command on the left to create your first one.</p>`;
    return;
  }

  ledgerListEl.innerHTML = links
    .map((link) => {
      const statusLower = (link.status || "created").toLowerCase();
      const statusClass = statusLower === "paid" ? "paid" : statusLower === "failed" ? "failed" : "pending";
      const reminderBadge = link.reminderEnabled
        ? `<span class="reminder-pill" title="Automated reminder active">⏰ Remind ${escapeHtml(link.reminderTimeline || 'tomorrow')}</span>`
        : "";

      return `
        <div class="ledger-row">
          <div class="ledger-main">
            <div class="ledger-title-row">
              <span class="ledger-name">${escapeHtml(link.customerName)}</span>
              ${reminderBadge}
            </div>
            <div class="ledger-purpose">${escapeHtml(link.purpose)}</div>
            <div class="ledger-amount">₹${link.amount}</div>
            <div class="ledger-actions">
              <a href="${link.shortUrl}" target="_blank" rel="noopener" class="action-btn action-pay">Open Checkout ↗</a>
              <button class="action-btn" onclick="copyLink('${link.shortUrl}', this)">Copy Link</button>
              <button class="action-btn" onclick="syncStatus('${link.id}', this)" title="Query Razorpay API directly for real-time status">Sync ⟳</button>
            </div>
          </div>
          <span class="stamp ${statusClass}">${link.status}</span>
        </div>
      `;
    })
    .join("");
}

function renderActivity(activities) {
  if (!activityFeedEl) return;
  if (!activities || activities.length === 0) {
    activityFeedEl.innerHTML = `<div class="activity-item system-ready">Ready · Listening for Razorpay webhook events</div>`;
    return;
  }

  activityFeedEl.innerHTML = activities
    .slice(0, 15)
    .map((item) => {
      const typeClass = item.type || "info";
      return `
        <div class="activity-item ${escapeHtml(typeClass)}">
          <span class="activity-time">${escapeHtml(item.timestamp || '')}</span>
          <span class="activity-msg">${escapeHtml(item.message)}</span>
        </div>
      `;
    })
    .join("");
}

function escapeHtml(str) {
  if (typeof str !== "string") return "";
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

async function refreshLedger() {
  try {
    const res = await fetch("/api/links");
    const data = await res.json();
    renderLedger(data.links || []);
    if (data.activity) {
      renderActivity(data.activity);
    }
  } catch (err) {
    // silent — polling loop will retry
  }
}

refreshLedger();
setInterval(refreshLedger, 3000);
