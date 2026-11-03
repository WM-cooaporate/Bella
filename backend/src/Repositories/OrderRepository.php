<?php

declare(strict_types=1);

class OrderRepository
{
    private PDO $db;

    private const RESERVATION_MINUTES = 30;

    public function __construct(PDO $con)
    {
        $this->db = $con;
    }

    /**
     * Create an order and reserve product stock.
     */
    public function create(array $data): array
    {
        $this->db->beginTransaction();

        try {
            $productId = (int) $data['product_id'];
            $quantity = (int) $data['quantity'];

            if ($productId < 1 || $quantity < 1) {
                throw new InvalidArgumentException('Invalid product or quantity');
            }

            // Lock the product row to prevent overselling.
            $sql = "
                SELECT id, name, price, stock_quantity
                FROM products
                WHERE id = :id AND is_active = 1
                FOR UPDATE
            ";

            $stmt = $this->db->prepare($sql);
            $stmt->execute(['id' => $productId]);

            $product = $stmt->fetch();

            if (!$product) {
                throw new RuntimeException('Product not found');
            }

            if ((int) $product['stock_quantity'] < $quantity) {
                throw new RuntimeException('Insufficient stock');
            }

            // Calculate money using integer cents, not floating-point values.
            $unitPriceCents = $this->toCents($product['price']);
            $subtotalCents = $unitPriceCents * $quantity;

            $unitPrice = $this->fromCents($unitPriceCents);
            $totalAmount = $this->fromCents($subtotalCents);

            $orderNumber = 'BELLA-' . strtoupper(bin2hex(random_bytes(4)));

            // Reserve stock.
            $updateStock = $this->db->prepare("
                UPDATE products
                SET stock_quantity = stock_quantity - :quantity
                WHERE id = :product_id
                  AND stock_quantity >= :minimum_quantity
            ");

            $updateStock->execute([
                'quantity' => $quantity,
                'product_id' => $productId,
                'minimum_quantity' => $quantity
            ]);

            if ($updateStock->rowCount() !== 1) {
                throw new RuntimeException('Insufficient stock');
            }

            // Create order with a 30-minute payment submission deadline.
            $insertOrder = $this->db->prepare("
                INSERT INTO orders (
                    order_number,
                    customer_name,
                    phone,
                    address,
                    total_amount,
                    order_status,
                    reservation_expires_at,
                    stock_reserved
                ) VALUES (
                    :order_number,
                    :customer_name,
                    :phone,
                    :address,
                    :total_amount,
                    'PENDING_PAYMENT',
                    DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 30 MINUTE),
                    1
                )
            ");

            $insertOrder->execute([
                'order_number' => $orderNumber,
                'customer_name' => $data['customer_name'],
                'phone' => $data['phone'],
                'address' => $data['address'],
                'total_amount' => $totalAmount
            ]);

            $orderId = (int) $this->db->lastInsertId();

            // Save a snapshot of the purchased product.
            $insertItem = $this->db->prepare("
                INSERT INTO order_items (
                    order_id,
                    product_id,
                    product_name,
                    unit_price,
                    quantity,
                    subtotal
                ) VALUES (
                    :order_id,
                    :product_id,
                    :product_name,
                    :unit_price,
                    :quantity,
                    :subtotal
                )
            ");

            $insertItem->execute([
                'order_id' => $orderId,
                'product_id' => $productId,
                'product_name' => $product['name'],
                'unit_price' => $unitPrice,
                'quantity' => $quantity,
                'subtotal' => $totalAmount
            ]);

            $this->db->commit();

            return [
                'order_id' => $orderId,
                'order_number' => $orderNumber,
                'total_amount' => $totalAmount
            ];

        } catch (Throwable $e) {

            if ($this->db->inTransaction()) {
                $this->db->rollBack();
            }

            throw $e;
        }
    }

    /**
     * Cancel an order and restore its reserved stock.
     */
    public function cancel(int $orderId): void
    {
        $this->db->beginTransaction();

        try {
            // Lock the order before changing its status or stock.
            $stmt = $this->db->prepare("
                SELECT id, order_status, stock_reserved
                FROM orders
                WHERE id = :id
                FOR UPDATE
            ");

            $stmt->execute(['id' => $orderId]);

            $order = $stmt->fetch();

            if (!$order) {
                throw new RuntimeException('Order not found');
            }

            if ($order['order_status'] !== 'PENDING_PAYMENT') {
                throw new RuntimeException('Order cannot be cancelled');
            }

            if (!(bool) $order['stock_reserved']) {
                throw new RuntimeException('Order stock is not reserved');
            }

            // Once payment proof has been submitted, cancellation must
            // be handled through the payment review workflow.
            $paymentStmt = $this->db->prepare("
                SELECT id
                FROM payments
                WHERE order_id = :order_id
                LIMIT 1
                FOR UPDATE
            ");

            $paymentStmt->execute(['order_id' => $orderId]);

            if ($paymentStmt->fetch()) {
                throw new RuntimeException(
                    'Order has a payment record and requires payment review'
                );
            }

            $itemsStmt = $this->db->prepare("
                SELECT product_id, quantity
                FROM order_items
                WHERE order_id = :order_id
            ");

            $itemsStmt->execute(['order_id' => $orderId]);

            $items = $itemsStmt->fetchAll();

            if (!$items) {
                throw new RuntimeException('Order items not found');
            }

            // Restore the reserved quantities.
            $restoreStock = $this->db->prepare("
                UPDATE products
                SET stock_quantity = stock_quantity + :quantity
                WHERE id = :product_id
            ");

            foreach ($items as $item) {
                $restoreStock->execute([
                    'quantity' => (int) $item['quantity'],
                    'product_id' => (int) $item['product_id']
                ]);

                if ($restoreStock->rowCount() !== 1) {
                    throw new RuntimeException('Unable to restore product stock');
                }
            }

            $updateOrder = $this->db->prepare("
                UPDATE orders
                SET
                    order_status = 'CANCELLED',
                    stock_reserved = 0,
                    reservation_expires_at = NULL
                WHERE id = :id
            ");

            $updateOrder->execute(['id' => $orderId]);

            $this->db->commit();

        } catch (Throwable $e) {

            if ($this->db->inTransaction()) {
                $this->db->rollBack();
            }

            throw $e;
        }
    }

    /**
     * Convert a DECIMAL money value to integer cents.
     */
    private function toCents(string|int|float $amount): int
    {
        $value = (string) $amount;

        if (!preg_match('/^\d+(?:\.\d{1,2})?$/', $value)) {
            throw new RuntimeException('Invalid product price');
        }

        [$whole, $fraction] = array_pad(
            explode('.', $value, 2),
            2,
            '0'
        );

        $fraction = str_pad($fraction, 2, '0');

        return ((int) $whole * 100) + (int) $fraction;
    }

    /**
     * Convert integer cents to a DECIMAL-compatible string.
     */
    private function fromCents(int $cents): string
    {
        return intdiv($cents, 100)
            . '.'
            . str_pad((string) ($cents % 100), 2, '0', STR_PAD_LEFT);
    }
    public function getAllForAdmin(
    int $limit = 50,
    int $offset = 0
): array {
    $limit = max(1, min($limit, 100));
    $offset = max(0, $offset);

    $sql = "
        SELECT
            o.id,
            o.order_number,
            o.customer_name,
            o.phone,
            o.address,
            o.total_amount,
            o.order_status,
            o.stock_reserved,
            o.created_at,
            o.updated_at,
            o.reservation_expires_at,

            COALESCE(
                SUM(oi.quantity),
                0
            ) AS total_items,

            GROUP_CONCAT(
                CONCAT(
                    oi.product_name,
                    ' x',
                    oi.quantity
                )
                ORDER BY oi.id
                SEPARATOR ', '
            ) AS items_summary

        FROM orders o

        LEFT JOIN order_items oi
            ON oi.order_id = o.id

        GROUP BY o.id

        ORDER BY o.created_at DESC, o.id DESC

        LIMIT {$limit} OFFSET {$offset}
    ";

    $stmt = $this->db->query($sql);

    return $stmt->fetchAll();
}

public function countAll(): int
{
    $stmt = $this->db->query("
        SELECT COUNT(*)
        FROM orders
    ");

    return (int) $stmt->fetchColumn();
}
}