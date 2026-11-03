<?php

declare(strict_types=1);

// --------------------------------------------------
// 1. Response and session configuration
// --------------------------------------------------

header('Content-Type: application/json; charset=utf-8');

$isHttps = (
    !empty($_SERVER['HTTPS']) &&
    $_SERVER['HTTPS'] !== 'off'
);

ini_set('session.use_strict_mode', '1');
ini_set('session.use_only_cookies', '1');
ini_set('session.cookie_httponly', '1');

session_set_cookie_params([
    'lifetime' => 0,
    'path' => '/',
    'domain' => '',
    'secure' => $isHttps,
    'httponly' => true,
    'samesite' => 'Lax'
]);

// --------------------------------------------------
// 2. Load configuration and classes
// --------------------------------------------------

require_once __DIR__ . '/../config/database.php';

require_once __DIR__ . '/../src/Middleware/AuthMiddleware.php';

require_once __DIR__ . '/../src/Controllers/AuthController.php';
require_once __DIR__ . '/../src/Controllers/ProductController.php';
require_once __DIR__ . '/../src/Controllers/OrderController.php';
require_once __DIR__ . '/../src/Controllers/PaymentController.php';

// --------------------------------------------------
// 3. Initialize controllers
// --------------------------------------------------

$productController = new ProductController($con);
$orderController = new OrderController($con);
$paymentController = new PaymentController($con);
$authController = new AuthController($con);

// --------------------------------------------------
// 4. Read request information
// --------------------------------------------------

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

$action = $_GET['action']
    ?? $_POST['action']
    ?? '';

$action = is_string($action) ? $action : '';

$jsonData = [];

$contentType = $_SERVER['CONTENT_TYPE'] ?? '';

if (
    stripos($contentType, 'application/json') !== false &&
    in_array($method, ['POST', 'PUT', 'PATCH'], true)
) {
    $rawInput = file_get_contents('php://input');

    if ($rawInput !== false && $rawInput !== '') {
        $decoded = json_decode($rawInput, true);

        if (!is_array($decoded)) {
            http_response_code(400);

            echo json_encode([
                'success' => false,
                'message' => 'Invalid JSON request body'
            ], JSON_UNESCAPED_UNICODE);

            exit;
        }

        $jsonData = $decoded;
    }
}

$requestData = array_merge($_POST, $jsonData);

// --------------------------------------------------
// 5. Routing
// --------------------------------------------------

try {

    // ==============================================
    // PUBLIC ROUTES
    // ==============================================

    // GET /?action=products
    if ($method === 'GET' && $action === 'products') {
        $productController->index();
        exit;
    }

    // POST /?action=admin_login
    if ($method === 'POST' && $action === 'admin_login') {
        $authController->login($requestData);
        exit;
    }

    // POST /?action=create_order
    if ($method === 'POST' && $action === 'create_order') {
        $orderController->store($requestData);
        exit;
    }

    // POST /?action=order_status
    if ($method === 'POST' && $action === 'order_status') {
        $orderController->status($requestData);
        exit;
    }

    // POST multipart/form-data /?action=submit_payment
    if ($method === 'POST' && $action === 'submit_payment') {
        $paymentController->store($_POST, $_FILES);
        exit;
    }

    // ==============================================
    // PROTECTED ADMIN ROUTES
    // ==============================================

    // GET /?action=check_admin_session
    if (
        $method === 'GET' &&
        $action === 'check_admin_session'
    ) {
        AuthMiddleware::requireAdmin();

        $authController->me();
        exit;
    }

    // GET /?action=get_pending_payments
    if (
        $method === 'GET' &&
        $action === 'get_pending_payments'
    ) {
        AuthMiddleware::requireAdmin();

        $paymentController->pending();
        exit;
    }

    // GET /?action=payment_receipt&payment_id=123
    if (
        $method === 'GET' &&
        $action === 'payment_receipt'
    ) {
        AuthMiddleware::requireAdmin();

        $paymentId = filter_var(
            $_GET['payment_id'] ?? null,
            FILTER_VALIDATE_INT
        );

        $paymentController->receipt(
            $paymentId === false || $paymentId === null
                ? 0
                : $paymentId
        );

        exit;
    }
// GET /?action=get_orders&limit=50&offset=0
if (
    $method === 'GET' &&
    $action === 'get_orders'
) {
    AuthMiddleware::requireAdmin();

    $orderController->index($_GET);
    exit;
}
    // POST /?action=admin_logout
    if (
        $method === 'POST' &&
        $action === 'admin_logout'
    ) {
        AuthMiddleware::requireAdmin();
        AuthMiddleware::requireCsrf();

        $authController->logout();
        exit;
    }

    // POST /?action=approve_payment
    if (
        $method === 'POST' &&
        $action === 'approve_payment'
    ) {
        AuthMiddleware::requireAdmin();
        AuthMiddleware::requireCsrf();

        $paymentId = filter_var(
            $requestData['payment_id'] ?? null,
            FILTER_VALIDATE_INT
        );

        $paymentController->approve(
            $paymentId === false || $paymentId === null
                ? 0
                : $paymentId
        );

        exit;
    }

    // POST /?action=reject_payment
    if (
        $method === 'POST' &&
        $action === 'reject_payment'
    ) {
        AuthMiddleware::requireAdmin();
        AuthMiddleware::requireCsrf();

        $paymentId = filter_var(
            $requestData['payment_id'] ?? null,
            FILTER_VALIDATE_INT
        );

        $paymentController->reject(
            $paymentId === false || $paymentId === null
                ? 0
                : $paymentId,
            $requestData
        );

        exit;
    }

    // POST /?action=cancel_order
    // Admin-only until customer ownership is implemented.
    if (
        $method === 'POST' &&
        $action === 'cancel_order'
    ) {
        AuthMiddleware::requireAdmin();
        AuthMiddleware::requireCsrf();

        $orderId = filter_var(
            $requestData['order_id'] ?? null,
            FILTER_VALIDATE_INT
        );

        $orderController->cancel(
            $orderId === false || $orderId === null
                ? 0
                : $orderId
        );

        exit;
    }

    // ==============================================
    // METHOD NOT ALLOWED / UNKNOWN ROUTE
    // ==============================================

    $knownActions = [
        'products',
        'admin_login',
        'create_order',
        'order_status',
        'submit_payment',
        'check_admin_session',
        'get_pending_payments',
        'payment_receipt',
    'get_orders',
        'admin_logout',
        'approve_payment',
        'reject_payment',
        'cancel_order'
    ];

    if (in_array($action, $knownActions, true)) {
        http_response_code(405);

        echo json_encode([
            'success' => false,
            'message' => 'Method not allowed'
        ], JSON_UNESCAPED_UNICODE);

        exit;
    }

    http_response_code(404);

    echo json_encode([
        'success' => false,
        'message' => 'API endpoint not found'
    ], JSON_UNESCAPED_UNICODE);

} catch (Throwable $e) {

    error_log(
        'Bella API Error: ' . $e->getMessage()
    );

    http_response_code(500);

    echo json_encode([
        'success' => false,
        'message' => 'Internal server error'
    ], JSON_UNESCAPED_UNICODE);
}
