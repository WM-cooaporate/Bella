<?php

declare(strict_types=1);

class ProductRepository
{
    private PDO $db;

    public function __construct(PDO $con)
    {
        $this->db = $con;
    }

    /**
     * Get all active products.
     */
    public function getAll(): array
    {
        $sql = "
            SELECT
                id,
                name,
                description,
                price,
                image,
                stock_quantity
            FROM products
            WHERE is_active = 1
            ORDER BY created_at DESC, id DESC
        ";

        $stmt = $this->db->prepare($sql);
        $stmt->execute();

        return $stmt->fetchAll();
    }

    public function create(array $product): int
    {
        $stmt = $this->db->prepare("
            INSERT INTO products (name, description, price, image, stock_quantity, is_active)
            VALUES (:name, :description, :price, :image, :stock_quantity, 1)
        ");
        $stmt->execute([
            ':name' => $product['name'],
            ':description' => $product['description'],
            ':price' => $product['price'],
            ':image' => $product['image'],
            ':stock_quantity' => $product['stock_quantity']
        ]);
        return (int) $this->db->lastInsertId();
    }
}
