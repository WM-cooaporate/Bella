
let selectedProduct = null;

// Get HTML Elements
const orderSection = document.getElementById("order");

const quantityInput = document.getElementById("quantity");

const invoiceProduct = document.getElementById("invoice-product");
const invoicePrice = document.getElementById("invoice-price");
const invoiceQuantity = document.getElementById("invoice-quantity");
const invoiceTotal = document.getElementById("invoice-total");


// Select Product
function selectProduct(productId) {
selectedProduct = products.find((product) => {
    return Number(product.id) === Number(productId);
});

    if (!selectedProduct) return;

    orderSection.classList.remove("hidden");

    quantityInput.value = 1;

    updateInvoice();

    orderSection.scrollIntoView({
        behavior: "smooth"
    });

}


// Update Invoice
function updateInvoice() {

    if (!selectedProduct) return;

    let quantity = Math.max(
        1,
        parseInt(quantityInput.value) || 1
    );

    let total = selectedProduct.price * quantity;

    invoiceProduct.textContent = selectedProduct.name;

    invoicePrice.textContent =
        selectedProduct.price.toLocaleString("en-US") + " EGP";

    invoiceQuantity.textContent = quantity;

    invoiceTotal.textContent =
        total.toLocaleString("en-US") + " EGP";

}


// Listen to Quantity Changes
quantityInput.addEventListener("input", updateInvoice);


function validateOrder() {

    const name = document.getElementById("customer-name").value.trim();
    const phone = document.getElementById("customer-phone").value.trim();
    const address = document.getElementById("customer-address").value.trim();

    const quantity = Number(quantityInput.value);

    if (!name || !phone || !address) {
        alert("Please fill in all customer information.");
        return false;
    }

    if (!/^01[0125][0-9]{8}$/.test(phone)) {
        alert("Please enter a valid Egyptian phone number.");
        return false;
    }

    if (!Number.isInteger(quantity) || quantity < 1) {
        alert("Quantity must be a positive whole number.");
        return false;
    }

    if (!selectedProduct) {
        alert("Please select a product first.");
        return false;
    }

    return true;
}
async function sendOrder() {

    if (!validateOrder()) {
        return;
    }

    const name = document.getElementById("customer-name").value.trim();
    const phone = document.getElementById("customer-phone").value.trim();
    const address = document.getElementById("customer-address").value.trim();

    const quantity = Number(quantityInput.value);

    const ownerPhone = "201208886589";

    // Prepare order data
    const orderData = {
        customer_name: name,
        phone: phone,
        address: address,
        product_id: Number(selectedProduct.id),
        quantity: quantity
    };

    try {

        // Send order to PHP Backend
        const response = await fetch(
            "http://localhost/bella/backend/public/index.php",
            {
                method: "POST",

                headers: {
                    "Content-Type": "application/json"
                },

                body: JSON.stringify(orderData)
            }
        );

        const result = await response.json();

        if (!response.ok || !result.success) {
            throw new Error(
                result.message || "Unable to create order"
            );
        }

        // Get server response
        const order = result.data;

        // Prepare WhatsApp message
        const message = `
New Order - Bella Store

Order Number: ${order.order_number}

Customer Information:
Name: ${name}
Phone: ${phone}
Address: ${address}

Order Details:
Product: ${selectedProduct.name}
Unit Price: ${Number(selectedProduct.price)} EGP
Quantity: ${quantity}

Total: ${Number(order.total_amount).toLocaleString("en-US")} EGP
`;

        const whatsappURL =
            `https://wa.me/${ownerPhone}?text=${encodeURIComponent(message)}`;

        // Open WhatsApp after successful order creation
        window.open(whatsappURL, "_blank");

        alert(
            `Order created successfully!\nOrder Number: ${order.order_number}`
        );

    } catch (error) {

        console.error("Order Error:", error);

        alert(
            error.message || "Something went wrong. Please try again."
        );

    }
}
