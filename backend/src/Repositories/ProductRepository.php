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
}