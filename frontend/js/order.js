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
    document.getElementById("summary-image").src = selectedProduct.image ? new URL(selectedProduct.image, new URL("../", window.location.href)).href : "assets/images/p1.jpg";
}

quantityInput.addEventListener("input", updateInvoice);
document.getElementById("change-product").addEventListener("click", () => document.getElementById("products").scrollIntoView({ behavior: "smooth" }));

document.getElementById("order-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const error = document.getElementById("order-error");
    error.textContent = "";
    if (!selectedProduct) { error.textContent = "Choose a product first."; return; }
    const submit = event.currentTarget.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
        const response = await apiRequest("create_order", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customer_name: document.getElementById("customer-name").value.trim(), phone: document.getElementById("customer-phone").value.trim(), address: document.getElementById("customer-address").value.trim(), product_id: Number(selectedProduct.id), quantity: Number(quantityInput.value) }) });
        currentOrder = response.data;
        document.getElementById("payment-order-number").textContent = currentOrder.order_number;
        document.getElementById("payment-total").textContent = formatMoney(currentOrder.total_amount);
        orderSection.classList.add("hidden");
        paymentSection.classList.remove("hidden");
        paymentSection.scrollIntoView({ behavior: "smooth" });
    } catch (requestError) { error.textContent = requestError.message; }
    finally { submit.disabled = false; }
});

document.querySelectorAll('[name="payment_method"]').forEach((input) => input.addEventListener("change", () => {
    const details = document.getElementById("transfer-details");
    details.classList.remove("hidden");
    const instapay = input.value === "INSTAPAY";
    const config = window.BELLA_PAYMENT_CONFIG || {};
    const destination = instapay ? config.instapayAlias : config.orangeCashNumber;
    const instruction = document.getElementById("transfer-instructions");
    const link = document.getElementById("instapay-link");
    const orangeAppLink = document.getElementById("orange-app-link");
    const orangeRow = document.getElementById("orange-number-row");
    const copyButton = document.getElementById("copy-destination");
    document.getElementById("payment-error").textContent = "";
    link.classList.toggle("hidden", !instapay || !destination);
    orangeAppLink.classList.toggle("hidden", instapay || !destination);
    orangeRow.classList.toggle("hidden", instapay || !destination);
    copyButton.classList.toggle("hidden", !destination);
    if (instapay) {
        instruction.textContent = destination ? `Open InstaPay and transfer ${formatMoney(currentOrder.total_amount)} to Bella’s alias: ${destination}. Then upload the successful transfer receipt.` : "Bella’s InstaPay alias is not configured. Ask the store for its payment details before transferring.";
        link.href = destination ? `https://instapay.eg/` : "https://instapay.eg/";
        copyButton.dataset.destination = destination || "";
    } else {
        instruction.textContent = destination ? `Transfer exactly ${formatMoney(currentOrder.total_amount)} to this Orange Cash wallet, then upload the successful transfer receipt.` : "Bella’s Orange Cash number is not configured. Ask the store for its wallet number before transferring.";
        document.getElementById("orange-number").value = destination || "Not configured";
        orangeAppLink.href = `orangecash://send?phone=${encodeURIComponent(destination || "")}&amount=${encodeURIComponent(currentOrder.total_amount)}`;
        copyButton.dataset.destination = destination || "";
    }
    document.getElementById("receipt-file").required = true;
}));

document.getElementById("copy-destination").addEventListener("click", async () => {
    const value = document.getElementById("copy-destination").dataset.destination;
    if (!value) return;
    try {
        await navigator.clipboard.writeText(value);
        document.getElementById("copy-destination").textContent = "Copied";
    } catch {
        document.getElementById("payment-error").textContent = "Could not copy automatically. Select and copy the destination instead.";
    }
});

document.getElementById("receipt-file").addEventListener("change", (event) => {
    const file = event.target.files[0];
    document.getElementById("file-hint").textContent = file ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB` : "No file selected";
});

document.getElementById("back-to-order").addEventListener("click", () => { paymentSection.classList.add("hidden"); orderSection.classList.remove("hidden"); orderSection.scrollIntoView({ behavior: "smooth" }); });

document.getElementById("payment-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const error = document.getElementById("payment-error");
    error.textContent = "";
    const file = document.getElementById("receipt-file").files[0];
    if (!currentOrder) { error.textContent = "Your order session is missing. Please place your order again."; return; }
    if (!file || file.size > 3 * 1024 * 1024 || !["image/jpeg", "image/png", "application/pdf"].includes(file.type)) { error.textContent = "Choose a JPG, PNG or PDF receipt up to 3 MB."; return; }
    const submit = document.getElementById("payment-submit");
    submit.disabled = true;
    const body = new FormData();
    body.append("order_id", currentOrder.order_id);
    body.append("payment_method", document.querySelector('[name="payment_method"]:checked').value);
    body.append("transaction_reference", document.getElementById("transaction-reference").value.trim());
    body.append("receipt", file);
    try {
        await apiRequest("submit_payment", { method: "POST", body });
        paymentSection.classList.add("hidden");
        document.getElementById("confirmation-number").textContent = currentOrder.order_number;
        document.getElementById("confirmation").classList.remove("hidden");
        document.getElementById("track-number").value = currentOrder.order_number;
        document.getElementById("confirmation").scrollIntoView({ behavior: "smooth" });
    } catch (requestError) { error.textContent = requestError.message; }
    finally { submit.disabled = false; }
});
