<?php

declare(strict_types=1);

class AdminRepository
{
    private PDO $db;

    public function __construct(PDO $con)
    {
        $this->db = $con;
    }

    /**
     * Find an admin by username.
     */
    public function findByUsername(string $username): array|false
    {
        $sql = "
            SELECT
                id,
                username,
                email,
                password_hash
            FROM admins
            WHERE username = :username
            LIMIT 1
        ";

        $stmt = $this->db->prepare($sql);

        $stmt->execute([
            'username' => $username
        ]);

        return $stmt->fetch();
    }

    /**
     * Find an admin by ID.
     */
    public function findById(int $adminId): array|false
    {
        $sql = "
            SELECT
                id,
                username,
                email
            FROM admins
            WHERE id = :id
            LIMIT 1
        ";

        $stmt = $this->db->prepare($sql);

        $stmt->execute([
            'id' => $adminId
        ]);

        return $stmt->fetch();
    }
}