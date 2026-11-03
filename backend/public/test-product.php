
<?php

require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/../src/Repositories/ProductRepository.php';

$productRepository = new ProductRepository($con);

$products = $productRepository->getAll();

header('Content-Type: application/json; charset=utf-8');

echo json_encode(
    $products,
    JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE
);
