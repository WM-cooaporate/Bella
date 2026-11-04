let selectedProduct = null;
let currentOrder = null;
const orderSection = document.getElementById("order");
const paymentSection = document.getElementById("payment");
const quantityInput = document.getElementById("quantity");
const invoiceProduct = document.getElementById("invoice-product");
const invoicePrice = document.getElementById("invoice-price");
const invoiceQuantity = document.getElementById("invoice-quantity");
const invoiceTotal = document.getElementById("invoice-total");

function selectProduct(productId) {
    selectedProduct = products.find((product) => Number(product.id) === Number(productId));
    if (!selectedProduct) return;
    orderSection.classList.remove("hidden");
    paymentSection.classList.add("hidden");
    quantityInput.value = 1;
    updateInvoice();
    orderSection.scrollIntoView({ behavior: "smooth" });
}

function updateInvoice() {
    if (!selectedProduct) return;
    const quantity = Math.max(1, Math.min(100, Number.parseInt(quantityInput.value, 10) || 1));
    quantityInput.value = quantity;
    invoiceProduct.textContent = selectedProduct.name;
    invoicePrice.textContent = formatMoney(selectedProduct.price);
    invoiceQuantity.textContent = String(quantity);
    invoiceTotal.textContent = formatMoney(Number(selectedProduct.price) * quantity);
    document.getElementById("summary-image").src = productImageUrl(selectedProduct.image);
}

quantityInput.addEventListener("input", updateInvoice);
document.getElementById("change-product").addEventListener("click", () => document.getElementById("products").scrollIntoView({ behavior: "smooth" }));

document.getElementById("order-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const error = document.getElementById("order-error");
    error.textContent = "";
    if (!selectedProduct) { error.textContent = "Choose a product first."; return; }
    currentOrder = { order_number: `DEMO-${Math.random().toString(36).slice(2, 8).toUpperCase()}`, total_amount: Number(selectedProduct.price) * Number(quantityInput.value) };
    document.getElementById("payment-order-number").textContent = currentOrder.order_number;
    document.getElementById("payment-total").textContent = formatMoney(currentOrder.total_amount);
    orderSection.classList.add("hidden");
    paymentSection.classList.remove("hidden");
    paymentSection.scrollIntoView({ behavior: "smooth" });
});

document.querySelectorAll('[name="payment_method"]').forEach((input) => input.addEventListener("change", () => {
    const details = document.getElementById("transfer-details");
    details.classList.remove("hidden");
    const instapay = input.value === "INSTAPAY";
    document.getElementById("instapay-link").classList.toggle("hidden", !instapay);
    document.getElementById("orange-app-link").classList.toggle("hidden", instapay);
    document.getElementById("orange-number-row").classList.add("hidden");
    document.getElementById("copy-destination").classList.add("hidden");
    document.getElementById("payment-error").textContent = "";
    document.getElementById("transfer-instructions").textContent = instapay
        ? `In the live store, you can pay ${formatMoney(currentOrder.total_amount)} using InstaPay. Payment details and receipt submission are disabled in this preview.`
        : `In the live store, you can pay ${formatMoney(currentOrder.total_amount)} using Orange Cash. Payment details and receipt submission are disabled in this preview.`;
}));

document.getElementById("back-to-order").addEventListener("click", () => { paymentSection.classList.add("hidden"); orderSection.classList.remove("hidden"); orderSection.scrollIntoView({ behavior: "smooth" }); });

document.getElementById("payment-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!currentOrder || !document.querySelector('[name="payment_method"]:checked')) {
        document.getElementById("payment-error").textContent = "Choose a payment method to continue the preview.";
        return;
    }
    paymentSection.classList.add("hidden");
    document.getElementById("confirmation-number").textContent = currentOrder.order_number;
    document.getElementById("confirmation-message").textContent = "This was a storefront preview. No payment was taken, no receipt was uploaded, and no order was saved.";
    document.getElementById("confirmation").classList.remove("hidden");
    document.getElementById("confirmation").scrollIntoView({ behavior: "smooth" });
});

document.getElementById("track-form").addEventListener("submit", (event) => {
    event.preventDefault();
    document.getElementById("track-error").textContent = "Order tracking is available in the live store. This preview does not save orders.";
    document.getElementById("track-result").classList.add("hidden");
});
