
const productsContainer = document.getElementById("products-container");

function displayProducts() {

    productsContainer.innerHTML = "";

    products.forEach((product) => {

        const productCard = `
            <div class="product-card">

                <img
                    src="${product.image}"
                    alt="${product.name}"
                >

                <div class="product-info">

                    <h3>${product.name}</h3>

                    <p>${product.description}</p>

                    <div class="product-bottom">

                        <span class="product-price">
                            ${product.price.toLocaleString("en-US")} EGP
                        </span>

                        <button
                            class="order-button"
                            onclick="selectProduct(${product.id})"
                        >
                            Order Now
                        </button>

                    </div>

                </div>

            </div>
        `;

        productsContainer.innerHTML += productCard;

    });

}

displayProducts();
