const DEMO_PRODUCTS = [
    { id: 101, name: "Everyday Essential", description: "A thoughtfully chosen piece for the little moments in every day.", price: 450, image: "assets/images/p1.jpg", stock_quantity: 8 },
    { id: 102, name: "Soft Touch", description: "A lovely detail that brings warmth and ease to your routine.", price: 625, image: "assets/images/p2.jpg", stock_quantity: 5 },
    { id: 103, name: "The Bella Favourite", description: "A customer favourite, selected to make a perfect gift.", price: 790, image: "assets/images/p3.jpg", stock_quantity: 3 }
];
let products = [];

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function formatMoney(value) {
    return `${Number(value || 0).toLocaleString("en-EG", { maximumFractionDigits: 2 })} EGP`;
}

function productImageUrl(path) {
    if (!path) return "assets/images/p1.jpg";
    if (/^https?:\/\//i.test(path) || path.startsWith("/")) return path;
    return new URL(path, new URL("../", window.location.href)).href;
}

async function loadProducts() {
    const container = document.getElementById("products-container");
    if (!container) return;
    products = DEMO_PRODUCTS;
    container.innerHTML = products.map((product, index) => `<article class="product-card"><div class="product-photo"><img src="${escapeHTML(productImageUrl(product.image))}" alt="${escapeHTML(product.name)}" loading="lazy"><span class="product-index">BELLA / ${String(index + 1).padStart(2, "0")}</span></div><div class="product-info"><div><h3>${escapeHTML(product.name)}</h3><p>${escapeHTML(product.description)}</p></div><div class="product-bottom"><span class="product-price">${formatMoney(product.price)}</span><button class="order-button" type="button" data-product-id="${product.id}">Preview order ↗</button></div></div></article>`).join("");
    container.querySelectorAll("[data-product-id]").forEach((button) => button.addEventListener("click", () => selectProduct(Number(button.dataset.productId))));
}

loadProducts();
