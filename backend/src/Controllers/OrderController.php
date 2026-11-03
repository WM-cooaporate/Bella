<?php

declare(strict_types=1);

require_once __DIR__ . '/../Repositories/OrderRepository.php';

class OrderController
{
    private OrderRepository $orderRepository;

    public function __construct(PDO $con)
    {
        $this->orderRepository = new OrderRepository($con);
    }

    /**
     * Create a new customer order.
     */
    public function store(array $data): void
    {
        $customerName = $data['customer_name'] ?? null;
        $phone = $data['phone'] ?? null;
        $address = $data['address'] ?? null;

        if (
            !is_string($customerName) ||
            !is_string($phone) ||
            !is_string($address)
        ) {
            $this->respond(422, [
                'success' => false,
                'message' => 'Customer information is required'
            ]);
            return;
        }

        $customerName = trim($customerName);
        $phone = trim($phone);
        $address = trim($address);

        if (
            $customerName === '' ||
            strlen($customerName) > 150
        ) {
            $this->respond(422, [
                'success' => false,
                'message' => 'Customer name is required and must not exceed 150 characters'
            ]);
            return;
        }

        if (!preg_match('/^01[0125][0-9]{8}$/', $phone)) {
            $this->respond(422, [
                'success' => false,
                'message' => 'Please enter a valid Egyptian mobile number'
            ]);
            return;
        }

        if (
            $address === '' ||
            strlen($address) > 2000
        ) {
            $this->respond(422, [
                'success' => false,
                'message' => 'Address is required and must not exceed 2000 characters'
            ]);
            return;
        }

        $productId = filter_var(
            $data['product_id'] ?? null,
            FILTER_VALIDATE_INT
        );

        $quantity = filter_var(
            $data['quantity'] ?? null,
            FILTER_VALIDATE_INT
        );

        if (
            $productId === false ||
            $productId === null ||
            $productId <= 0
        ) {
            $this->respond(422, [
                'success' => false,
                'message' => 'Invalid product ID'
            ]);
            return;
        }

        if (
            $quantity === false ||
            $quantity === null ||
            $quantity < 1 ||
            $quantity > 100
        ) {
            $this->respond(422, [
                'success' => false,
                'message' => 'Quantity must be between 1 and 100'
            ]);
            return;
        }

        try {
            $result = $this->orderRepository->create([
                'customer_name' => $customerName,
                'phone' => $phone,
                'address' => $address,
                'product_id' => $productId,
                'quantity' => $quantity
            ]);

            $this->respond(201, [
                'success' => true,
                'message' => 'Order created successfully',
                'data' => $result
            ]);

        } catch (InvalidArgumentException $e) {
            $this->respond(422, [
                'success' => false,
                'message' => $e->getMessage()
            ]);

        } catch (RuntimeException $e) {
            $message = $e->getMessage();

            $statusCode = match ($message) {
                'Product not found' => 404,
                'Insufficient stock' => 409,
                default => 500
            };

            if ($statusCode === 500) {
                error_log('OrderController::store: ' . $message);
                $message = 'Unable to create order';
            }

            $this->respond($statusCode, [
                'success' => false,
                'message' => $message
            ]);

        } catch (Throwable $e) {
            error_log('OrderController::store: ' . $e->getMessage());

            $this->respond(500, [
                'success' => false,
                'message' => 'Unable to create order'
            ]);
        }
    }

    /**
     * Cancel an order.
     * This endpoint must remain admin-protected until customer
     * ownership verification is implemented.
     */
    public function cancel(int $orderId): void
    {
        if ($orderId <= 0) {
            $this->respond(422, [
                'success' => false,
                'message' => 'Invalid order ID'
            ]);
            return;
        }

        try {
            $this->orderRepository->cancel($orderId);

            $this->respond(200, [
                'success' => true,
                'message' => 'Order cancelled successfully',
                'data' => [
                    'order_id' => $orderId,
                    'order_status' => 'CANCELLED'
                ]
            ]);

        } catch (InvalidArgumentException $e) {
            $this->respond(422, [
                'success' => false,
                'message' => $e->getMessage()
            ]);

        } catch (RuntimeException $e) {
            $message = $e->getMessage();

            $statusCode = match ($message) {
                'Order not found' => 404,
                'Order cannot be cancelled',
                'Order stock is not reserved',
                'Order has a payment record and requires payment review'
                    => 409,
                default => 500
            };

            if ($statusCode === 500) {
                error_log('OrderController::cancel: ' . $message);
                $message = 'Unable to cancel order';
            }

            $this->respond($statusCode, [
                'success' => false,
                'message' => $message
            ]);

        } catch (Throwable $e) {
            error_log('OrderController::cancel: ' . $e->getMessage());

            $this->respond(500, [
                'success' => false,
                'message' => 'Unable to cancel order'
            ]);
        }
    }

    /** Look up an order using its public order number and customer phone. */
    public function status(array $data): void
    {
        $orderNumber = $data['order_number'] ?? null;
        $phone = $data['phone'] ?? null;
        if (!is_string($orderNumber) || !is_string($phone)) {
            $this->respond(422, ['success' => false, 'message' => 'Order number and phone are required']);
            return;
        }
        $orderNumber = trim($orderNumber);
        $phone = trim($phone);
        if (!preg_match('/^BELLA-[A-F0-9]{8}$/i', $orderNumber) || !preg_match('/^01[0125][0-9]{8}$/', $phone)) {
            $this->respond(422, ['success' => false, 'message' => 'Enter a valid order number and Egyptian mobile number']);
            return;
        }
        try {
            $order = $this->orderRepository->findPublicStatus(strtoupper($orderNumber), $phone);
            if ($order === false) {
                $this->respond(404, ['success' => false, 'message' => 'We could not find an order matching those details']);
                return;
            }
            $this->respond(200, ['success' => true, 'message' => 'Order status retrieved successfully', 'data' => $order]);
        } catch (Throwable $e) {
            error_log('OrderController::status: ' . $e->getMessage());
            $this->respond(500, ['success' => false, 'message' => 'Unable to retrieve order status']);
        }
    }

    /**
     * Get all orders for the admin dashboard.
     */
    public function index(array $query): void
    {
        $limit = filter_var(
            $query['limit'] ?? 50,
            FILTER_VALIDATE_INT
        );

        $offset = filter_var(
            $query['offset'] ?? 0,
            FILTER_VALIDATE_INT
        );

        if (
            $limit === false ||
            $limit === null ||
            $limit < 1
        ) {
            $limit = 50;
        }

        if (
            $offset === false ||
            $offset === null ||
            $offset < 0
        ) {
            $offset = 0;
        }

        $limit = min($limit, 100);

        try {
            $orders = $this->orderRepository->getAllForAdmin(
                $limit,
                $offset
            );

            $total = $this->orderRepository->countAll();

            $this->respond(200, [
                'success' => true,
                'message' => 'Orders retrieved successfully',
                'data' => [
                    'orders' => $orders,
                    'pagination' => [
                        'limit' => $limit,
                        'offset' => $offset,
                        'total' => $total,
                        'has_more' => ($offset + count($orders)) < $total
                    ]
                ]
            ]);

        } catch (Throwable $e) {
            error_log('OrderController::index: ' . $e->getMessage());

            $this->respond(500, [
                'success' => false,
                'message' => 'Unable to retrieve orders'
            ]);
        }
    }

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
