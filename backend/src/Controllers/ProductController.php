<?php

declare(strict_types=1);

require_once __DIR__ . '/../Repositories/ProductRepository.php';

class ProductController
{
    private ProductRepository $productRepository;

    public function __construct(PDO $con)
    {
        $this->productRepository = new ProductRepository($con);
    }

    /**
     * Return all active products.
     */
    public function index(): void
    {
        try {
            $products = $this->productRepository->getAll();

            $this->respond(200, [
                'success' => true,
                'message' => 'Products retrieved successfully',
                'data' => $products
            ]);

        } catch (Throwable $e) {

            error_log(
                'ProductController::index Error: ' . $e->getMessage()
            );

            $this->respond(500, [
                'success' => false,
                'message' => 'Unable to retrieve products'
            ]);
        }
    }

    /**
     * Send JSON response.
     */
    private function respond(int $statusCode, array $response): void
    {
        http_response_code($statusCode);

        header('Content-Type: application/json; charset=utf-8');

        echo json_encode(
            $response,
            JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE
        );
    }
}