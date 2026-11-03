<?php

declare(strict_types=1);

require_once __DIR__ . '/../Repositories/ProductRepository.php';

class ProductController
{
    private ProductRepository $productRepository;
    private const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

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

    public function store(array $data, array $files): void
    {
        $name = $data['name'] ?? null;
        $description = $data['description'] ?? '';
        $price = $data['price'] ?? null;
        $stock = filter_var($data['stock_quantity'] ?? 0, FILTER_VALIDATE_INT);
        if (!is_string($name) || !is_string($description) || !is_numeric($price) || !is_int($stock)) {
            $this->respond(422, ['success' => false, 'message' => 'Product name, valid price, description, and stock are required']);
            return;
        }
        $name = trim($name);
        if ($name === '' || strlen($name) > 150 || strlen($description) > 5000 || (float) $price <= 0 || (float) $price > 99999999.99 || $stock < 0 || $stock > 1000000) {
            $this->respond(422, ['success' => false, 'message' => 'Check the name, price, description, or stock values']);
            return;
        }
        $image = $files['image'] ?? null;
        if (!is_array($image) || ($image['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK || !is_string($image['tmp_name'] ?? null) || !is_uploaded_file($image['tmp_name']) || !is_numeric($image['size'] ?? null) || (int) $image['size'] > self::MAX_IMAGE_SIZE) {
            $this->respond(422, ['success' => false, 'message' => 'A product image up to 5 MB is required']);
            return;
        }
        $finfo = new finfo(FILEINFO_MIME_TYPE);
        $mime = $finfo->file($image['tmp_name']);
        $extensions = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];
        if (!is_string($mime) || !isset($extensions[$mime])) {
            $this->respond(422, ['success' => false, 'message' => 'Use a JPG, PNG, or WebP image']);
            return;
        }
        $storageRoot = getenv('BELLA_STORAGE_PATH');
        $storageRoot = is_string($storageRoot) && $storageRoot !== '' ? rtrim($storageRoot, DIRECTORY_SEPARATOR) : dirname(__DIR__, 2);
        $imageDirectory = $storageRoot . DIRECTORY_SEPARATOR . 'product-images';
        if (!is_dir($imageDirectory) && !mkdir($imageDirectory, 0750, true) && !is_dir($imageDirectory)) {
            $this->respond(500, ['success' => false, 'message' => 'Unable to create product image storage']);
            return;
        }
        $fileName = bin2hex(random_bytes(20)) . '.' . $extensions[$mime];
        $destination = $imageDirectory . DIRECTORY_SEPARATOR . $fileName;
        if (!move_uploaded_file($image['tmp_name'], $destination)) {
            $this->respond(500, ['success' => false, 'message' => 'Unable to save product image']);
            return;
        }
        $publicImage = '../backend/public/index.php?action=product_image&file=' . rawurlencode($fileName);
        try {
            $productId = $this->productRepository->create([
                'name' => $name,
                'description' => trim($description),
                'price' => number_format((float) $price, 2, '.', ''),
                'image' => $publicImage,
                'stock_quantity' => $stock
            ]);
            $this->respond(201, ['success' => true, 'message' => 'Product added successfully', 'data' => ['id' => $productId]]);
        } catch (Throwable $e) {
            if (is_file($destination)) unlink($destination);
            error_log('ProductController::store: ' . $e->getMessage());
            $this->respond(500, ['success' => false, 'message' => 'Unable to add product']);
        }
    }

    public function image(string $fileName): void
    {
        if (!preg_match('/^[a-f0-9]{40}\.(jpg|png|webp)$/', $fileName)) {
            http_response_code(404);
            return;
        }
        $storageRoot = getenv('BELLA_STORAGE_PATH');
        $storageRoot = is_string($storageRoot) && $storageRoot !== '' ? rtrim($storageRoot, DIRECTORY_SEPARATOR) : dirname(__DIR__, 2);
        $path = $storageRoot . DIRECTORY_SEPARATOR . 'product-images' . DIRECTORY_SEPARATOR . $fileName;
        if (!is_file($path)) {
            http_response_code(404);
            return;
        }
        $mime = (new finfo(FILEINFO_MIME_TYPE))->file($path);
        if (!in_array($mime, ['image/jpeg', 'image/png', 'image/webp'], true)) {
            http_response_code(415);
            return;
        }
        header('Content-Type: ' . $mime);
        header('X-Content-Type-Options: nosniff');
        header('Cache-Control: public, max-age=31536000, immutable');
        readfile($path);
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
