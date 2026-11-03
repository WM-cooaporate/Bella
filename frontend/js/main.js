document.getElementById("year").textContent = new Date().getFullYear();

const statusCopy = {
    PENDING_PAYMENT: ["Awaiting payment", "Your order is reserved. Complete the transfer and submit your receipt."],
    PROCESSING: ["Payment approved", "Your payment is confirmed and your order is being prepared."],
    SHIPPED: ["On its way", "Your order has been shipped."],
    DELIVERED: ["Delivered", "Your Bella order has been delivered. Enjoy!"],
    CANCELLED: ["Order closed", "This order is no longer active. Contact Bella if you need help."]
};

document.getElementById("track-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const errorBox = document.getElementById("track-error");
    const resultBox = document.getElementById("track-result");
    errorBox.textContent = "";
    resultBox.classList.add("hidden");
    try {
        const result = await apiRequest("order_status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ order_number: document.getElementById("track-number").value.trim(), phone: document.getElementById("track-phone").value.trim() }) });
        const order = result.data;
        const [title, description] = statusCopy[order.order_status] || [order.order_status, "Your order status has been updated."];
        resultBox.innerHTML = `<strong>${escapeHTML(title)}</strong><p>${escapeHTML(description)}</p><span>${escapeHTML(order.order_number)} · ${formatMoney(order.total_amount)}</span>`;
        resultBox.classList.remove("hidden");
    } catch (error) { errorBox.textContent = error.message; }
});
