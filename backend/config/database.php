<?php

$dsn = "mysql:host=localhost;dbname=bella;charset=utf8mb4";

$user = "root";
$pass = "";

$options = [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC
];

try {
    $con = new PDO($dsn, $user, $pass, $options);

    echo "Database Connected Successfully";

} catch (PDOException $e) {
    echo "Database Connection Failed: " . $e->getMessage();
}