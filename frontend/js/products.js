
let products = [];

async function loadProducts() {
    try {
        const response = await fetch(
            "http://localhost/bella/backend/public/index.php"
        );

        console.log("Response Status:", response.status);

        const responseText = await response.text();

        console.log("Raw Response:", responseText);

        const result = JSON.parse(responseText);

        console.log("Parsed Data:", result);

        if (!result.success) {
            throw new Error("API returned unsuccessful response");
        }

        products = result.data;

        displayProducts();

    } catch (error) {
        console.error("Products Error:", error);

        document.getElementById("products-container").innerHTML =
            "<p>Unable to load products.</p>";
    }
}

loadProducts();
