let csrfToken = "";
let ordersOffset = 0;
const ordersLimit = 50;
const loginPanel = document.getElementById("login-panel");
const adminApp = document.getElementById("admin-app");

function toast(message) {
    const box = document.getElementById("toast");
    box.textContent = message;
    box.classList.add("visible");
    setTimeout(() => box.classList.remove("visible"), 3500);
}

async function adminRequest(action, options = {}) {
    const headers = new Headers(options.headers || {});
    if (csrfToken && options.method && options.method !== "GET") headers.set("X-CSRF-Token", csrfToken);
    return apiRequest(action, { credentials: "same-origin", ...options, headers });
}

function showAdmin(data) {
    csrfToken = data.csrf_token;
    loginPanel.classList.add("hidden");
    adminApp.classList.remove("hidden");
    document.getElementById("admin-name").textContent = data.username;
    document.getElementById("welcome-name").textContent = `${data.username}.`;
    refreshDashboard();
}

async function checkSession() {
    try { showAdmin((await adminRequest("check_admin_session")).data); }
    catch { loginPanel.classList.remove("hidden"); }
}

document.getElementById("login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const error = document.getElementById("login-error");
    error.textContent = "";
    try {
        const result = await adminRequest("admin_login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: document.getElementById("username").value.trim(), password: document.getElementById("password").value }) });
        showAdmin(result.data);
    } catch (requestError) { error.textContent = requestError.message; }
});

document.getElementById("logout-button").addEventListener("click", async () => {
    try { await adminRequest("admin_logout", { method: "POST" }); } catch {}
    csrfToken = "";
    adminApp.classList.add("hidden");
    loginPanel.classList.remove("hidden");
});

async function refreshDashboard() { await Promise.all([loadPayments(), loadOrders(true)]); }
document.getElementById("refresh-button").addEventListener("click", refreshDashboard);

async function loadPayments() {
    const target = document.getElementById("payments-list");
    try {
        const payments = (await adminRequest("get_pending_payments")).data || [];
        document.getElementById("pending-count").textContent = payments.length;
        if (!payments.length) { target.innerHTML = '<div class="empty-state panel">All caught up. No pending payment receipts.</div>'; return; }
        target.innerHTML = payments.map((payment) => `<article class="payment-card panel"><div class="payment-card-main"><div class="payment-card-title"><div><span class="eyebrow">${escapeHTML(payment.order_number)} · ${escapeHTML(payment.payment_method.replace("_", " "))}</span><h3>${escapeHTML(payment.customer_name)}</h3></div><span class="status-pill status-pending">Awaiting review</span></div><div class="payment-meta"><span>${escapeHTML(payment.phone)}</span><span>${escapeHTML(payment.transaction_reference || "No transaction reference")}</span><strong>${formatMoney(payment.amount)}</strong></div><p class="payment-address">${escapeHTML(payment.address)}</p></div><div class="payment-actions"><button class="button button-light" data-receipt="${Number(payment.payment_id)}" type="button">View receipt ↗</button><button class="button button-danger" data-reject="${Number(payment.payment_id)}" type="button">Reject</button><button class="button button-dark" data-approve="${Number(payment.payment_id)}" type="button">Approve ✓</button></div></article>`).join("");
        target.querySelectorAll("[data-receipt]").forEach((button) => button.addEventListener("click", () => viewReceipt(button.dataset.receipt)));
        target.querySelectorAll("[data-approve]").forEach((button) => button.addEventListener("click", () => reviewPayment(button.dataset.approve, "approve_payment")));
        target.querySelectorAll("[data-reject]").forEach((button) => button.addEventListener("click", () => { const note = window.prompt("Optional note for the customer:"); if (note !== null) reviewPayment(button.dataset.reject, "reject_payment", note); }));
    } catch (error) { target.innerHTML = `<div class="empty-state panel">${escapeHTML(error.message)}</div>`; }
}

async function reviewPayment(paymentId, action, note = "") {
    const body = { payment_id: Number(paymentId) };
    if (action === "reject_payment") body.admin_note = note;
    try { await adminRequest(action, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); toast(action === "approve_payment" ? "Payment approved." : "Payment rejected."); await refreshDashboard(); }
    catch (error) { toast(error.message); }
}

async function viewReceipt(paymentId) {
    try {
        const url = new URL(API_URL, window.location.href);
        url.searchParams.set("action", "payment_receipt");
        url.searchParams.set("payment_id", paymentId);
        const response = await fetch(url, { credentials: "same-origin" });
        if (!response.ok) { const result = await response.json(); throw new Error(result.message || "Receipt could not be opened"); }
        const objectUrl = URL.createObjectURL(await response.blob());
        const viewer = document.createElement("dialog");
        viewer.className = "receipt-viewer";
        viewer.innerHTML = `<button type="button" class="receipt-close" aria-label="Close receipt">×</button><iframe title="Payment receipt"></iframe>`;
        viewer.querySelector("iframe").src = objectUrl;
        viewer.querySelector("button").addEventListener("click", () => viewer.close());
        viewer.addEventListener("close", () => { URL.revokeObjectURL(objectUrl); viewer.remove(); });
        document.body.append(viewer);
        viewer.showModal();
    } catch (error) { toast(error.message); }
}

async function loadOrders(reset = false) {
    const target = document.getElementById("orders-list");
    if (reset) { ordersOffset = 0; target.innerHTML = ""; }
    try {
        const result = await adminRequest("get_orders", { query: { limit: ordersLimit, offset: ordersOffset } });
        const { orders, pagination } = result.data;
        if (!orders.length && reset) target.innerHTML = '<tr><td colspan="6">No orders yet.</td></tr>';
        target.insertAdjacentHTML("beforeend", orders.map((order) => `<tr><td><strong>${escapeHTML(order.order_number)}</strong></td><td>${escapeHTML(order.customer_name)}<small>${escapeHTML(order.phone)}</small></td><td>${escapeHTML(order.items_summary || "—")}</td><td>${formatMoney(order.total_amount)}</td><td><span class="status-pill status-${escapeHTML(order.order_status.toLowerCase())}">${escapeHTML(order.order_status.replaceAll("_", " "))}</span></td><td>${escapeHTML(new Date(order.created_at).toLocaleString())}</td></tr>`).join(""));
        ordersOffset += orders.length;
        document.getElementById("load-more").classList.toggle("hidden", !pagination.has_more);
        document.getElementById("admin-stats").innerHTML = `<article class="stat-card"><span>Total orders</span><strong>${pagination.total}</strong></article><article class="stat-card"><span>Pending review</span><strong>${document.getElementById("pending-count").textContent}</strong></article><article class="stat-card"><span>Showing</span><strong>${ordersOffset}</strong></article>`;
    } catch (error) { if (reset) target.innerHTML = `<tr><td colspan="6">${escapeHTML(error.message)}</td></tr>`; }
}

document.getElementById("load-more").addEventListener("click", () => loadOrders());
document.querySelectorAll(".admin-tab").forEach((tab) => tab.addEventListener("click", () => {
    document.querySelectorAll(".admin-tab").forEach((item) => item.classList.toggle("active", item === tab));
    document.querySelectorAll(".admin-panel").forEach((panel) => panel.classList.toggle("hidden", panel.id !== tab.dataset.panel));
}));

checkSession();
