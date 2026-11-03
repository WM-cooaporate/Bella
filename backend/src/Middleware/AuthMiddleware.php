<?php

declare(strict_types=1);

class AuthMiddleware
{
    private const SESSION_TIMEOUT = 1800;

    /**
     * Ensure an authenticated admin session exists.
     */
    public static function requireAdmin(): void
    {
        if (session_status() !== PHP_SESSION_ACTIVE) {
            session_start();
        }

        $adminId = $_SESSION['admin_id'] ?? null;
        $lastActivity = $_SESSION['last_activity'] ?? null;

        if (
            !is_numeric($adminId) ||
            (int) $adminId <= 0 ||
            !is_int($lastActivity)
        ) {
            self::unauthorized();
        }

        if ((time() - $lastActivity) > self::SESSION_TIMEOUT) {
            self::destroySession();
            self::unauthorized('Session expired. Please log in again.');
        }

        $_SESSION['last_activity'] = time();
    }

    /**
     * Validate CSRF token for state-changing admin requests.
     */
    public static function requireCsrf(): void
    {
        if (session_status() !== PHP_SESSION_ACTIVE) {
            session_start();
        }

        $sessionToken = $_SESSION['csrf_token'] ?? '';

        $requestToken = '';

        if (function_exists('getallheaders')) {
            $headers = getallheaders();

            foreach ($headers as $name => $value) {
                if (strtolower((string) $name) === 'x-csrf-token') {
                    $requestToken = is_string($value) ? $value : '';
                    break;
                }
            }
        }

        if ($requestToken === '') {
            $requestToken = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
        }

        if (
            !is_string($sessionToken) ||
            $sessionToken === '' ||
            !is_string($requestToken) ||
            $requestToken === '' ||
            !hash_equals($sessionToken, $requestToken)
        ) {
            http_response_code(403);

            header('Content-Type: application/json; charset=utf-8');

            echo json_encode([
                'success' => false,
                'message' => 'Invalid or missing CSRF token'
            ], JSON_UNESCAPED_UNICODE);

            exit;
        }
    }

    /**
     * Destroy the current session and its cookie.
     */
    public static function destroySession(): void
    {
        if (session_status() !== PHP_SESSION_ACTIVE) {
            return;
        }

        $_SESSION = [];

        if (ini_get('session.use_cookies')) {
            $params = session_get_cookie_params();

            setcookie(
                session_name(),
                '',
                [
                    'expires' => time() - 42000,
                    'path' => $params['path'] ?: '/',
                    'domain' => $params['domain'],
                    'secure' => $params['secure'],
                    'httponly' => $params['httponly'],
                    'samesite' => $params['samesite'] ?? 'Lax'
                ]
            );
        }

        session_destroy();
    }

    private static function unauthorized(
        string $message = 'Authentication required'
    ): void {
        http_response_code(401);

        header('Content-Type: application/json; charset=utf-8');

        echo json_encode([
            'success' => false,
            'message' => $message
        ], JSON_UNESCAPED_UNICODE);

        exit;
    }
}