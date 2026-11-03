<?php

declare(strict_types=1);

class OrderReservationService
{
    private PDO $db;

    public function __construct(PDO $con)
    {
        $this->db = $con;
    }

    /**
     * Cancel expired unpaid orders and restore their reserved stock.
     *
     * Orders with any payment record are skipped for manual review.
     *
     * @return array{
     *     success: bool,
     *     processed: int,
     *     skipped: int,
     *     errors: int
     * }
     */
    public function releaseExpiredReservations(int $limit = 100): array
    {
        $limit = max(1, min($limit, 500));

        $result = [
            'success' => true,
            'processed' => 0,
            'skipped' => 0,
            'errors' => 0
        ];

        /*
         * Lock eligible orders first.
         * Payment submission also locks the order, preventing a race
         * between payment creation and reservation cleanup.
         */
        $sql = "
            SELECT id
            FROM orders
            WHERE order_status = 'PENDING_PAYMENT'
              AND stock_reserved = 1
              AND reservation_expires_at IS NOT NULL
              AND reservation_expires_at <= CURRENT_TIMESTAMP
            ORDER BY reservation_expires_at ASC, id ASC
            LIMIT {$limit}
            FOR UPDATE
        ";

        try {
            $this->db->beginTransaction();

            $stmt = $this->db->query($sql);
            $orders = $stmt->fetchAll(PDO::FETCH_COLUMN);

            foreach ($orders as $orderId) {
                $orderId = (int) $orderId;

                try {
                    $this->releaseSingleReservation($orderId, $result);
                } catch (Throwable $e) {
                    error_log(
                        'OrderReservationService: order ' .
                        $orderId . ': ' . $e->getMessage()
                    );

                    $result['errors']++;
                    throw $e;
                }
            }

            $this->db->commit();

            return $result;

        } catch (Throwable $e) {
            if ($this->db->inTransaction()) {
                $this->db->rollBack();
            }

            error_log(
                'OrderReservationService::releaseExpiredReservations: ' .
                $e->getMessage()
            );

            return [
                'success' => false,
                'processed' => 0,
                'skipped' => 0,
                'errors' => 1
            ];
        }
    }

    /**
     * Process one order while the caller's transaction is active.
     */
    private function releaseSingleReservation(
        int $orderId,
        array &$result
    ): void {
        // Recheck the order under lock.
        $orderStmt = $this->db->prepare("
            SELECT
                id,
                order_status,
                stock_reserved,
                reservation_expires_at
            FROM orders
            WHERE id = :id
            FOR UPDATE
        ");

        $orderStmt->execute([':id' => $orderId]);
        $order = $orderStmt->fetch();

        if (
            !$order ||
            $order['order_status'] !== 'PENDING_PAYMENT' ||
            (int) $order['stock_reserved'] !== 1 ||
            empty($order['reservation_expires_at'])
        ) {
            $result['skipped']++;
            return;
        }

        // Use database time to avoid PHP/database timezone differences.
        $expiryStmt = $this->db->prepare("
            SELECT
                reservation_expires_at <= CURRENT_TIMESTAMP AS is_expired
            FROM orders
            WHERE id = :id
        ");

        $expiryStmt->execute([':id' => $orderId]);

        if ((int) $expiryStmt->fetchColumn() !== 1) {
            $result['skipped']++;
            return;
        }

        /*
         * Never automatically release stock if a payment record exists.
         * This includes pending records awaiting manual review.
         */
        $paymentStmt = $this->db->prepare("
            SELECT id
            FROM payments
            WHERE order_id = :order_id
            LIMIT 1
            FOR UPDATE
        ");

        $paymentStmt->execute([':order_id' => $orderId]);

        if ($paymentStmt->fetch()) {
            $result['skipped']++;
            return;
        }

        // Load order items.
        $itemsStmt = $this->db->prepare("
            SELECT product_id, quantity
            FROM order_items
            WHERE order_id = :order_id
        ");

        $itemsStmt->execute([':order_id' => $orderId]);
        $items = $itemsStmt->fetchAll();

        if (!$items) {
            throw new RuntimeException(
                'Cannot release reservation without order items'
            );
        }

        // Restore stock.
        $restoreStmt = $this->db->prepare("
            UPDATE products
            SET stock_quantity = stock_quantity + :quantity
            WHERE id = :product_id
        ");

        foreach ($items as $item) {
            $quantity = (int) $item['quantity'];
            $productId = (int) $item['product_id'];

            if ($quantity <= 0 || $productId <= 0) {
                throw new RuntimeException(
                    'Invalid order item while restoring stock'
                );
            }

            $restoreStmt->execute([
                ':quantity' => $quantity,
                ':product_id' => $productId
            ]);

            if ($restoreStmt->rowCount() !== 1) {
                throw new RuntimeException(
                    'Product not found while restoring stock'
                );
            }
        }

        // Mark the order as cancelled.
        $updateStmt = $this->db->prepare("
            UPDATE orders
            SET
                order_status = 'CANCELLED',
                stock_reserved = 0,
                reservation_expires_at = NULL,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = :id
              AND order_status = 'PENDING_PAYMENT'
              AND stock_reserved = 1
        ");

        $updateStmt->execute([':id' => $orderId]);

        if ($updateStmt->rowCount() !== 1) {
            throw new RuntimeException(
                'Unable to update expired order'
            );
        }

        $result['processed']++;
    }
}