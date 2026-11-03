<?php

declare(strict_types=1);

class PaymentRepository
{
    private PDO $db;

    public function __construct(PDO $con)
    {
        $this->db = $con;
    }

    /**
     * Create a pending payment for an existing order.
     */
    public function create(array $data): array
    {
        $orderId = (int) ($data['order_id'] ?? 0);
        $paymentMethod = $data['payment_method'] ?? '';
        $transactionReference = $data['transaction_reference'] ?? null;
        $receiptPath = $data['receipt_path'] ?? null;

        if ($orderId <= 0) {
            throw new InvalidArgumentException('Invalid order ID');
        }

        if (!in_array($paymentMethod, ['INSTAPAY', 'ORANGE_CASH'], true)) {
            throw new InvalidArgumentException('Invalid payment method');
        }

        if (
            !is_string($receiptPath) ||
            $receiptPath === ''
        ) {
            throw new InvalidArgumentException('Receipt is required');
        }

        if ($transactionReference !== null) {
            if (!is_string($transactionReference)) {
                throw new InvalidArgumentException('Invalid transaction reference');
            }

            $transactionReference = trim($transactionReference);

            if ($transactionReference === '') {
                $transactionReference = null;
            }

            if (
                $transactionReference !== null &&
                strlen($transactionReference) > 150
            ) {
                throw new InvalidArgumentException(
                    'Transaction reference is too long'
                );
            }
        }

        try {
            $this->db->beginTransaction();

            // Lock the order to prevent concurrent payment submissions.
            $orderStmt = $this->db->prepare("
                SELECT
                    id,
                    total_amount,
                    order_status,
                    stock_reserved,
                    reservation_expires_at,
                    (
                        reservation_expires_at IS NOT NULL
                        AND reservation_expires_at > CURRENT_TIMESTAMP
                    ) AS reservation_valid
                FROM orders
                WHERE id = :order_id
                FOR UPDATE
            ");

            $orderStmt->execute([
                ':order_id' => $orderId
            ]);

            $order = $orderStmt->fetch();

            if (!$order) {
                throw new RuntimeException('Order not found');
            }

            if ($order['order_status'] !== 'PENDING_PAYMENT') {
                throw new RuntimeException('Order is not awaiting payment');
            }

            if ((int) $order['stock_reserved'] !== 1) {
                throw new RuntimeException('Order stock is not reserved');
            }

            if ((int) $order['reservation_valid'] !== 1) {
                throw new RuntimeException('Order reservation has expired');
            }

            // Do not allow another pending or paid payment for this order.
            $existingStmt = $this->db->prepare("
                SELECT id
                FROM payments
                WHERE order_id = :order_id
                  AND payment_status IN ('PENDING', 'PAID')
                LIMIT 1
                FOR UPDATE
            ");

            $existingStmt->execute([
                ':order_id' => $orderId
            ]);

            if ($existingStmt->fetch()) {
                throw new RuntimeException(
                    'A pending or completed payment already exists for this order'
                );
            }

            $amount = $order['total_amount'];

            $insertStmt = $this->db->prepare("
                INSERT INTO payments (
                    order_id,
                    payment_method,
                    amount,
                    transaction_reference,
                    receipt_path,
                    payment_status
                ) VALUES (
                    :order_id,
                    :payment_method,
                    :amount,
                    :transaction_reference,
                    :receipt_path,
                    'PENDING'
                )
            ");

            $insertStmt->execute([
                ':order_id' => $orderId,
                ':payment_method' => $paymentMethod,
                ':amount' => $amount,
                ':transaction_reference' => $transactionReference,
                ':receipt_path' => $receiptPath
            ]);

            $paymentId = (int) $this->db->lastInsertId();

            /*
             * The stock remains reserved while the admin reviews
             * the submitted payment. Clear the expiry timestamp so
             * the reservation cleanup service will not release it.
             */
            $updateOrderStmt = $this->db->prepare("
                UPDATE orders
                SET
                    reservation_expires_at = NULL,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = :order_id
                  AND order_status = 'PENDING_PAYMENT'
                  AND stock_reserved = 1
            ");

            $updateOrderStmt->execute([
                ':order_id' => $orderId
            ]);

            if ($updateOrderStmt->rowCount() !== 1) {
                throw new RuntimeException(
                    'Unable to update order reservation'
                );
            }

            $this->db->commit();

            return [
                'payment_id' => $paymentId,
                'order_id' => $orderId,
                'amount' => $amount,
                'payment_method' => $paymentMethod,
                'payment_status' => 'PENDING'
            ];

        } catch (Throwable $e) {
            if ($this->db->inTransaction()) {
                $this->db->rollBack();
            }

            throw $e;
        }
    }

    /**
     * Return pending payments for the admin dashboard.
     * Never expose the private receipt path.
     */
    public function getPendingPayments(): array
    {
        $sql = "
            SELECT
                p.id AS payment_id,
                p.order_id,
                p.payment_method,
                p.amount,
                p.transaction_reference,
                p.payment_status,
                p.created_at AS payment_created_at,

                CASE
                    WHEN p.receipt_path IS NOT NULL
                         AND p.receipt_path <> ''
                    THEN 1
                    ELSE 0
                END AS receipt_available,

                o.order_number,
                o.customer_name,
                o.phone,
                o.address,
                o.total_amount,
                o.order_status

            FROM payments p

            INNER JOIN orders o
                ON o.id = p.order_id

            WHERE p.payment_status = 'PENDING'

            ORDER BY p.created_at ASC, p.id ASC
        ";

        $stmt = $this->db->query($sql);

        return $stmt->fetchAll();
    }

    /**
     * Approve a pending payment and complete the stock reservation.
     */
    public function approve(int $paymentId): array
    {
        if ($paymentId <= 0) {
            throw new InvalidArgumentException('Invalid payment ID');
        }

        try {
            $this->db->beginTransaction();

            $stmt = $this->db->prepare("
                SELECT
                    p.id AS payment_id,
                    p.order_id,
                    p.amount AS payment_amount,
                    p.payment_status,
                    o.total_amount AS order_amount,
                    o.order_status,
                    o.stock_reserved
                FROM payments p
                INNER JOIN orders o
                    ON o.id = p.order_id
                WHERE p.id = :payment_id
                FOR UPDATE
            ");

            $stmt->execute([
                ':payment_id' => $paymentId
            ]);

            $payment = $stmt->fetch();

            if (!$payment) {
                throw new RuntimeException('Payment not found');
            }

            if ($payment['payment_status'] !== 'PENDING') {
                throw new RuntimeException('Payment is not pending');
            }

            if ($payment['order_status'] !== 'PENDING_PAYMENT') {
                throw new RuntimeException('Order is not awaiting payment');
            }

            if ((int) $payment['stock_reserved'] !== 1) {
                throw new RuntimeException('Order stock is not reserved');
            }

            // Compare DECIMAL values in MySQL, not floating-point PHP values.
            $amountStmt = $this->db->prepare("
                SELECT (
                    CAST(:payment_amount AS DECIMAL(10,2)) =
                    CAST(:order_amount AS DECIMAL(10,2))
                )
            ");

            $amountStmt->execute([
                ':payment_amount' => $payment['payment_amount'],
                ':order_amount' => $payment['order_amount']
            ]);

            if ((int) $amountStmt->fetchColumn() !== 1) {
                throw new RuntimeException(
                    'Payment amount does not match order amount'
                );
            }

            $updatePaymentStmt = $this->db->prepare("
                UPDATE payments
                SET
                    payment_status = 'PAID',
                    reviewed_at = CURRENT_TIMESTAMP,
                    admin_note = NULL,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = :payment_id
                  AND payment_status = 'PENDING'
            ");

            $updatePaymentStmt->execute([
                ':payment_id' => $paymentId
            ]);

            if ($updatePaymentStmt->rowCount() !== 1) {
                throw new RuntimeException('Unable to approve payment');
            }

            $updateOrderStmt = $this->db->prepare("
                UPDATE orders
                SET
                    order_status = 'PROCESSING',
                    stock_reserved = 0,
                    reservation_expires_at = NULL,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = :order_id
                  AND order_status = 'PENDING_PAYMENT'
                  AND stock_reserved = 1
            ");

            $updateOrderStmt->execute([
                ':order_id' => (int) $payment['order_id']
            ]);

            if ($updateOrderStmt->rowCount() !== 1) {
                throw new RuntimeException('Unable to update order status');
            }

            $this->db->commit();

            return [
                'payment_id' => $paymentId,
                'order_id' => (int) $payment['order_id'],
                'payment_status' => 'PAID',
                'order_status' => 'PROCESSING'
            ];

        } catch (Throwable $e) {
            if ($this->db->inTransaction()) {
                $this->db->rollBack();
            }

            throw $e;
        }
    }

    /**
     * Reject a pending payment and restore the reserved stock.
     */
    public function reject(
        int $paymentId,
        ?string $adminNote = null
    ): array {
        if ($paymentId <= 0) {
            throw new InvalidArgumentException('Invalid payment ID');
        }

        if ($adminNote !== null) {
            $adminNote = trim($adminNote);

            if (strlen($adminNote) > 2000) {
                throw new InvalidArgumentException('Admin note is too long');
            }

            if ($adminNote === '') {
                $adminNote = null;
            }
        }

        try {
            $this->db->beginTransaction();

            $stmt = $this->db->prepare("
                SELECT
                    p.id AS payment_id,
                    p.order_id,
                    p.payment_status,
                    o.order_status,
                    o.stock_reserved
                FROM payments p
                INNER JOIN orders o
                    ON o.id = p.order_id
                WHERE p.id = :payment_id
                FOR UPDATE
            ");

            $stmt->execute([
                ':payment_id' => $paymentId
            ]);

            $payment = $stmt->fetch();

            if (!$payment) {
                throw new RuntimeException('Payment not found');
            }

            if ($payment['payment_status'] !== 'PENDING') {
                throw new RuntimeException('Payment is not pending');
            }

            if ($payment['order_status'] !== 'PENDING_PAYMENT') {
                throw new RuntimeException('Order is not awaiting payment');
            }

            if ((int) $payment['stock_reserved'] !== 1) {
                throw new RuntimeException('Order stock is not reserved');
            }

            $orderId = (int) $payment['order_id'];

            // Load order items before restoring stock.
            $itemsStmt = $this->db->prepare("
                SELECT product_id, quantity
                FROM order_items
                WHERE order_id = :order_id
            ");

            $itemsStmt->execute([
                ':order_id' => $orderId
            ]);

            $items = $itemsStmt->fetchAll();

            if (!$items) {
                throw new RuntimeException(
                    'Cannot reject payment because order items are missing'
                );
            }

            $restoreStmt = $this->db->prepare("
                UPDATE products
                SET stock_quantity = stock_quantity + :quantity
                WHERE id = :product_id
            ");

            foreach ($items as $item) {
                $productId = (int) $item['product_id'];
                $quantity = (int) $item['quantity'];

                if ($productId <= 0 || $quantity <= 0) {
                    throw new RuntimeException('Invalid order item');
                }

                $restoreStmt->execute([
                    ':quantity' => $quantity,
                    ':product_id' => $productId
                ]);

                if ($restoreStmt->rowCount() !== 1) {
                    throw new RuntimeException(
                        'Unable to restore product stock'
                    );
                }
            }

            $updatePaymentStmt = $this->db->prepare("
                UPDATE payments
                SET
                    payment_status = 'REJECTED',
                    admin_note = :admin_note,
                    reviewed_at = CURRENT_TIMESTAMP,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = :payment_id
                  AND payment_status = 'PENDING'
            ");

            $updatePaymentStmt->execute([
                ':admin_note' => $adminNote,
                ':payment_id' => $paymentId
            ]);

            if ($updatePaymentStmt->rowCount() !== 1) {
                throw new RuntimeException('Unable to reject payment');
            }

            $updateOrderStmt = $this->db->prepare("
                UPDATE orders
                SET
                    order_status = 'CANCELLED',
                    stock_reserved = 0,
                    reservation_expires_at = NULL,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = :order_id
                  AND order_status = 'PENDING_PAYMENT'
                  AND stock_reserved = 1
            ");

            $updateOrderStmt->execute([
                ':order_id' => $orderId
            ]);

            if ($updateOrderStmt->rowCount() !== 1) {
                throw new RuntimeException('Unable to cancel order');
            }

            $this->db->commit();

            return [
                'payment_id' => $paymentId,
                'order_id' => $orderId,
                'payment_status' => 'REJECTED',
                'order_status' => 'CANCELLED'
            ];

        } catch (Throwable $e) {
            if ($this->db->inTransaction()) {
                $this->db->rollBack();
            }

            throw $e;
        }
    }

    /**
     * Find the private receipt path for an admin-only receipt endpoint.
     */
    public function findReceiptById(int $paymentId): array|false
    {
        if ($paymentId <= 0) {
            return false;
        }

        $stmt = $this->db->prepare("
            SELECT id, receipt_path
            FROM payments
            WHERE id = :payment_id
            LIMIT 1
        ");

        $stmt->execute([
            ':payment_id' => $paymentId
        ]);

        return $stmt->fetch();
    }
}