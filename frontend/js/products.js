const API_URL = new URL("../backend/public/index.php", window.location.href).href;
let products = [];

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[character]);
}

function formatMoney(value) {
    return `${Number(value || 0).toLocaleString("en-EG", { maximumFractionDigits: 2 })} EGP`;
}

function productImageUrl(path) {
    if (!path) return "assets/images/p1.jpg";
    if (/^https?:\/\//i.test(path) || path.startsWith("/")) return path;
    if (path.startsWith("../backend/public/index.php")) return new URL(path, window.location.href).href;
    return new URL(path, new URL("../", window.location.href)).href;
}

async function apiRequest(action, options = {}) {
    const url = new URL(API_URL);
    url.searchParams.set("action", action);
    if (options.query) {
        const query = new URLSearchParams(options.query);
        query.forEach((value, key) => url.searchParams.set(key, value));
    }
    const response = await fetch(url, { credentials: "same-origin", ...options });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.message || "Request could not be completed");
    return result;
}

async function loadProducts() {
    const container = document.getElementById("products-container");
    try {
        const result = await apiRequest("products");
        products = Array.isArray(result.data) ? result.data : [];
        if (!products.length) {
            container.innerHTML = '<p class="empty-state">Our next lovely finds are on their way.</p>';
            return;
        }
        container.innerHTML = products.map((product, index) => {
            const image = productImageUrl(product.image || `assets/images/p${index % 3 + 1}.jpg`);
            const stock = Number(product.stock_quantity) || 0;
            return `<article class="product-card"><div class="product-photo"><img src="${escapeHTML(image)}" alt="${escapeHTML(product.name)}" loading="lazy"><span class="product-index">BELLA / ${String(index + 1).padStart(2, "0")}</span></div><div class="product-info"><div><h3>${escapeHTML(product.name)}</h3><p>${escapeHTML(product.description || "A thoughtful find for your everyday.")}</p></div><div class="product-bottom"><span class="product-price">${formatMoney(product.price)}</span><button class="order-button" type="button" data-product-id="${Number(product.id)}" ${stock < 1 ? "disabled" : ""}>${stock < 1 ? "Out of stock" : "Make it yours ↗"}</button></div></div></article>`;
        }).join("");
        container.querySelectorAll("[data-product-id]").forEach((button) => button.addEventListener("click", () => selectProduct(Number(button.dataset.productId))));
    } catch (error) {
        container.innerHTML = `<p class="empty-state">${escapeHTML(error.message)}. Please refresh to try again.</p>`;
    }
}

loadProducts();
