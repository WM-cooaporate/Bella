<?php

declare(strict_types=1);

require_once __DIR__ . '/../Repositories/PaymentRepository.php';

class PaymentController
{
    private PaymentRepository $paymentRepository;

    private const MAX_RECEIPT_SIZE = 3 * 1024 * 1024;

    private const ALLOWED_MIME_TYPES = [
        'image/jpeg',
        'image/png',
        'application/pdf'
    ];

    public function __construct(PDO $con)
    {
        $this->paymentRepository = new PaymentRepository($con);
    }

    /**
     * Submit a payment receipt.
     *
     * Expected fields:
     * - order_id
     * - payment_method
     * - transaction_reference (optional)
     * - receipt (uploaded file)
     */
    public function store(array $data, array $files): void
    {
        $orderId = filter_var(
            $data['order_id'] ?? null,
            FILTER_VALIDATE_INT
        );

        if ($orderId === false || $orderId === null || $orderId <= 0) {
            $this->respond(422, [
                'success' => false,
                'message' => 'Invalid order ID'
            ]);
            return;
        }

        $paymentMethod = $data['payment_method'] ?? null;

        if (
            !is_string($paymentMethod) ||
            !in_array(
                $paymentMethod,
                ['INSTAPAY', 'ORANGE_CASH'],
                true
            )
        ) {
            $this->respond(422, [
                'success' => false,
                'message' => 'Invalid payment method'
            ]);
            return;
        }

        $transactionReference = $data['transaction_reference'] ?? null;

        if ($transactionReference !== null) {
            if (!is_string($transactionReference)) {
                $this->respond(422, [
                    'success' => false,
                    'message' => 'Invalid transaction reference'
                ]);
                return;
            }

            $transactionReference = trim($transactionReference);

            if (strlen($transactionReference) > 150) {
                $this->respond(422, [
                    'success' => false,
                    'message' => 'Transaction reference is too long'
                ]);
                return;
            }

            if ($transactionReference === '') {
                $transactionReference = null;
            }
        }

        $receipt = $files['receipt'] ?? null;

        if (!is_array($receipt)) {
            $this->respond(422, [
                'success' => false,
                'message' => 'Payment receipt is required'
            ]);
            return;
        }

        $uploadError = $receipt['error'] ?? UPLOAD_ERR_NO_FILE;

        if ($uploadError !== UPLOAD_ERR_OK) {
            $this->respond(422, [
                'success' => false,
                'message' => $this->getUploadErrorMessage($uploadError)
            ]);
            return;
        }

        $temporaryPath = $receipt['tmp_name'] ?? null;
        $fileSize = $receipt['size'] ?? null;

        if (
            !is_string($temporaryPath) ||
            !is_uploaded_file($temporaryPath)
        ) {
            $this->respond(422, [
                'success' => false,
                'message' => 'Invalid uploaded file'
            ]);
            return;
        }

        if (
            !is_numeric($fileSize) ||
            (int) $fileSize <= 0 ||
            (int) $fileSize > self::MAX_RECEIPT_SIZE
        ) {
            $this->respond(422, [
                'success' => false,
                'message' => 'Receipt must not exceed 3 MB'
            ]);
            return;
        }

        try {
            $finfo = new finfo(FILEINFO_MIME_TYPE);
            $mimeType = $finfo->file($temporaryPath);

            if (
                !is_string($mimeType) ||
                !in_array($mimeType, self::ALLOWED_MIME_TYPES, true)
            ) {
                $this->respond(422, [
                    'success' => false,
                    'message' => 'Only JPG, PNG and PDF receipts are allowed'
                ]);
                return;
            }

            $extensionMap = [
                'image/jpeg' => 'jpg',
                'image/png' => 'png',
                'application/pdf' => 'pdf'
            ];

            $extension = $extensionMap[$mimeType];

            $storageRoot = getenv('BELLA_STORAGE_PATH');
            $storageRoot = is_string($storageRoot) && $storageRoot !== ''
                ? rtrim($storageRoot, DIRECTORY_SEPARATOR)
                : dirname(__DIR__, 2);

            $receiptDirectory =
                $storageRoot .
                DIRECTORY_SEPARATOR .
                'receipts';

            if (
                !is_dir($receiptDirectory) &&
                !mkdir($receiptDirectory, 0750, true) &&
                !is_dir($receiptDirectory)
            ) {
                throw new RuntimeException(
                    'Unable to create receipt directory'
                );
            }

            $fileName = bin2hex(random_bytes(24)) . '.' . $extension;

            $destination =
                $receiptDirectory .
                DIRECTORY_SEPARATOR .
                $fileName;

            $relativePath = 'receipts/' . $fileName;

            if (!move_uploaded_file($temporaryPath, $destination)) {
                throw new RuntimeException(
                    'Unable to save receipt file'
                );
            }

            try {
                $payment = $this->paymentRepository->create([
                    'order_id' => $orderId,
                    'payment_method' => $paymentMethod,
                    'transaction_reference' => $transactionReference,
                    'receipt_path' => $relativePath
                ]);
            } catch (Throwable $e) {
                if (is_file($destination)) {
                    unlink($destination);
                }

                throw $e;
            }

            $this->respond(201, [
                'success' => true,
                'message' => 'Payment receipt submitted successfully',
                'data' => $payment
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
                'Order is not awaiting payment',
                'Order stock is not reserved',
                'Order reservation has expired',
                'A pending or completed payment already exists for this order'
                    => 409,
                default => 500
            };

            if ($statusCode === 500) {
                error_log('PaymentController::store: ' . $message);

                $message = 'Unable to submit payment receipt';
            }

            $this->respond($statusCode, [
                'success' => false,
                'message' => $message
            ]);

        } catch (Throwable $e) {
            error_log('PaymentController::store: ' . $e->getMessage());

            $this->respond(500, [
                'success' => false,
                'message' => 'Unable to submit payment receipt'
            ]);
        }
    }

    /**
     * Get all pending payments for the admin dashboard.
     */
    public function pending(): void
    {
        try {
            $payments = $this->paymentRepository->getPendingPayments();

            $this->respond(200, [
                'success' => true,
                'message' => 'Pending payments retrieved successfully',
                'data' => $payments
            ]);

        } catch (Throwable $e) {
            error_log('PaymentController::pending: ' . $e->getMessage());

            $this->respond(500, [
                'success' => false,
                'message' => 'Unable to retrieve pending payments'
            ]);
        }
    }

    /**
     * Approve a payment.
     */
    public function approve(int $paymentId): void
    {
        if ($paymentId <= 0) {
            $this->respond(422, [
                'success' => false,
                'message' => 'Invalid payment ID'
            ]);
            return;
        }

        try {
            $result = $this->paymentRepository->approve($paymentId);

            $this->respond(200, [
                'success' => true,
                'message' => 'Payment approved successfully',
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
                'Payment not found' => 404,
                'Payment is not pending',
                'Order is not awaiting payment',
                'Order stock is not reserved',
                'Payment amount does not match order amount'
                    => 409,
                default => 500
            };

            if ($statusCode === 500) {
                error_log('PaymentController::approve: ' . $message);
                $message = 'Unable to approve payment';
            }

            $this->respond($statusCode, [
                'success' => false,
                'message' => $message
            ]);

        } catch (Throwable $e) {
            error_log('PaymentController::approve: ' . $e->getMessage());

            $this->respond(500, [
                'success' => false,
                'message' => 'Unable to approve payment'
            ]);
        }
    }

    /**
     * Reject a payment.
     */
    public function reject(int $paymentId, array $data): void
    {
        if ($paymentId <= 0) {
            $this->respond(422, [
                'success' => false,
                'message' => 'Invalid payment ID'
            ]);
            return;
        }

        $adminNote = $data['admin_note'] ?? null;

        if ($adminNote !== null && !is_string($adminNote)) {
            $this->respond(422, [
                'success' => false,
                'message' => 'Invalid admin note'
            ]);
            return;
        }

        try {
            $result = $this->paymentRepository->reject(
                $paymentId,
                $adminNote
            );

            $this->respond(200, [
                'success' => true,
                'message' => 'Payment rejected successfully',
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
                'Payment not found' => 404,
                'Payment is not pending',
                'Order is not awaiting payment',
                'Order stock is not reserved'
                    => 409,
                default => 500
            };

            if ($statusCode === 500) {
                error_log('PaymentController::reject: ' . $message);
                $message = 'Unable to reject payment';
            }

            $this->respond($statusCode, [
                'success' => false,
                'message' => $message
            ]);

        } catch (Throwable $e) {
            error_log('PaymentController::reject: ' . $e->getMessage());

            $this->respond(500, [
                'success' => false,
                'message' => 'Unable to reject payment'
            ]);
        }
    }

    /**
     * Stream a receipt to an authenticated admin.
     * The route must be protected by AuthMiddleware in index.php.
     */
    public function receipt(int $paymentId): void
    {
        if ($paymentId <= 0) {
            $this->respond(422, [
                'success' => false,
                'message' => 'Invalid payment ID'
            ]);
            return;
        }

        try {
            $payment = $this->paymentRepository->findReceiptById(
                $paymentId
            );

            if (
                $payment === false ||
                !is_string($payment['receipt_path'] ?? null) ||
                $payment['receipt_path'] === ''
            ) {
                $this->respond(404, [
                    'success' => false,
                    'message' => 'Receipt not found'
                ]);
                return;
            }

            $storageRoot = getenv('BELLA_STORAGE_PATH');
            $storageRoot = is_string($storageRoot) && $storageRoot !== ''
                ? rtrim($storageRoot, DIRECTORY_SEPARATOR)
                : dirname(__DIR__, 2);

            $receiptsRoot = realpath(
                $storageRoot .
                DIRECTORY_SEPARATOR .
                'receipts'
            );

            if ($receiptsRoot === false) {
                $this->respond(404, [
                    'success' => false,
                    'message' => 'Receipt storage not found'
                ]);
                return;
            }

            $relativePath = str_replace(
                ['/', '\\'],
                DIRECTORY_SEPARATOR,
                $payment['receipt_path']
            );

            $expectedPrefix = 'receipts' . DIRECTORY_SEPARATOR;

            if (!str_starts_with($relativePath, $expectedPrefix)) {
                $this->respond(404, [
                    'success' => false,
                    'message' => 'Receipt not found'
                ]);
                return;
            }

            $filePath = realpath(
                $storageRoot .
                DIRECTORY_SEPARATOR .
                $relativePath
            );

            if (
                $filePath === false ||
                !is_file($filePath) ||
                !str_starts_with(
                    $filePath,
                    $receiptsRoot . DIRECTORY_SEPARATOR
                )
            ) {
                $this->respond(404, [
                    'success' => false,
                    'message' => 'Receipt file not found'
                ]);
                return;
            }

            $fileSize = filesize($filePath);

            if (
                $fileSize === false ||
                $fileSize <= 0 ||
                $fileSize > self::MAX_RECEIPT_SIZE
            ) {
                $this->respond(404, [
                    'success' => false,
                    'message' => 'Invalid receipt file'
                ]);
                return;
            }

            $finfo = new finfo(FILEINFO_MIME_TYPE);
            $mimeType = $finfo->file($filePath);

            if (
                !is_string($mimeType) ||
                !in_array($mimeType, self::ALLOWED_MIME_TYPES, true)
            ) {
                $this->respond(415, [
                    'success' => false,
                    'message' => 'Unsupported receipt format'
                ]);
                return;
            }

            while (ob_get_level() > 0) {
                ob_end_clean();
            }

            http_response_code(200);

            header('Content-Type: ' . $mimeType);
            header('Content-Length: ' . (string) $fileSize);
            header(
                'Content-Disposition: inline; filename="payment-receipt-' .
                $paymentId . '"'
            );
            header('X-Content-Type-Options: nosniff');
            header('Cache-Control: private, no-store, no-cache, must-revalidate');
            header('Pragma: no-cache');

            readfile($filePath);
            exit;

        } catch (Throwable $e) {
            error_log('PaymentController::receipt: ' . $e->getMessage());

            $this->respond(500, [
                'success' => false,
                'message' => 'Unable to display receipt'
            ]);
        }
    }

    /**
     * Convert PHP upload errors to readable messages.
     */
    private function getUploadErrorMessage(int $error): string
    {
        return match ($error) {
            UPLOAD_ERR_INI_SIZE,
            UPLOAD_ERR_FORM_SIZE => 'Receipt exceeds the allowed upload size',

            UPLOAD_ERR_PARTIAL => 'Receipt upload was incomplete',

            UPLOAD_ERR_NO_FILE => 'Payment receipt is required',

            UPLOAD_ERR_NO_TMP_DIR => 'Upload temporary directory is missing',

            UPLOAD_ERR_CANT_WRITE => 'Unable to write uploaded receipt',

            UPLOAD_ERR_EXTENSION => 'Receipt upload was blocked by the server',

            default => 'Receipt upload failed'
        };
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
