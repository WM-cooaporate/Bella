<?php

declare(strict_types=1);

// Database configuration
$host = 'localhost';
$dbname = 'bella';
$username = 'root';
$password = '';

$dsn = "mysql:host={$host};dbname={$dbname};charset=utf8mb4";

$options = [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,

    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,

    PDO::ATTR_EMULATE_PREPARES => false,

    PDO::ATTR_STRINGIFY_FETCHES => false,
];

try {
    $con = new PDO(
        $dsn,
        $username,
        $password,
        $options
    );

} catch (PDOException $e) {

    // Log technical details on the server
    error_log(
        'Bella Database Connection Error: ' . $e->getMessage()
    );

    // Return a generic API error
    http_response_code(500);

    header('Content-Type: application/json; charset=utf-8');

    echo json_encode([
        'success' => false,
        'message' => 'Database connection failed'
    ], JSON_UNESCAPED_UNICODE);

    exit;
}