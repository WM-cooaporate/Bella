<?php

declare(strict_types=1);

require_once __DIR__ . '/../Repositories/AdminRepository.php';
require_once __DIR__ . '/../Middleware/AuthMiddleware.php';

class AuthController
{
    private AdminRepository $adminRepository;

    public function __construct(PDO $con)
    {
        $this->adminRepository = new AdminRepository($con);
    }

    public function login(array $data): void
    {
        $username = $data['username'] ?? null;
        $password = $data['password'] ?? null;

        if (
            !is_string($username) ||
            !is_string($password) ||
            trim($username) === '' ||
            $password === '' ||
            strlen($username) > 100 ||
            strlen($password) > 4096
        ) {
            $this->respond(422, [
                'success' => false,
                'message' => 'Username and password are required'
            ]);
            return;
        }

        try {
            $admin = $this->adminRepository->findByUsername(
                trim($username)
            );

            if (
                $admin === false ||
                !password_verify($password, $admin['password_hash'])
            ) {
                $this->respond(401, [
                    'success' => false,
                    'message' => 'Invalid username or password'
                ]);
                return;
            }

            if (session_status() !== PHP_SESSION_ACTIVE) {
                session_start();
            }

            session_regenerate_id(true);

            $csrfToken = bin2hex(random_bytes(32));

            $_SESSION['admin_id'] = (int) $admin['id'];
            $_SESSION['username'] = $admin['username'];
            $_SESSION['csrf_token'] = $csrfToken;
            $_SESSION['last_activity'] = time();

            $this->respond(200, [
                'success' => true,
                'message' => 'Login successful',
                'data' => [
                    'admin_id' => (int) $admin['id'],
                    'username' => $admin['username'],
                    'csrf_token' => $csrfToken
                ]
            ]);
        } catch (Throwable $e) {
            error_log('AuthController::login: ' . $e->getMessage());

            $this->respond(500, [
                'success' => false,
                'message' => 'Unable to complete login'
            ]);
        }
    }

    public function me(): void
    {
        if (session_status() !== PHP_SESSION_ACTIVE) {
            session_start();
        }

        $adminId = $_SESSION['admin_id'] ?? null;
        $username = $_SESSION['username'] ?? null;
        $csrfToken = $_SESSION['csrf_token'] ?? null;

        if (
            !is_numeric($adminId) ||
            !is_string($username) ||
            !is_string($csrfToken) ||
            $csrfToken === ''
        ) {
            $this->respond(401, [
                'success' => false,
                'message' => 'Authentication required'
            ]);
            return;
        }

        $this->respond(200, [
            'success' => true,
            'message' => 'Admin session is active',
            'data' => [
                'admin_id' => (int) $adminId,
                'username' => $username,
                'csrf_token' => $csrfToken
            ]
        ]);
    }

    public function logout(): void
    {
        AuthMiddleware::destroySession();

        $this->respond(200, [
            'success' => true,
            'message' => 'Logged out successfully'
        ]);
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