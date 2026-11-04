require('dotenv').config();

const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const { DATABASE_URL, BELLA_ADMIN_USERNAME, BELLA_ADMIN_PASSWORD, BELLA_ADMIN_EMAIL } = process.env;
  if (!DATABASE_URL || !BELLA_ADMIN_USERNAME || !BELLA_ADMIN_PASSWORD) throw new Error('Set DATABASE_URL, BELLA_ADMIN_USERNAME, and BELLA_ADMIN_PASSWORD first.');
  if (BELLA_ADMIN_USERNAME.length > 100 || BELLA_ADMIN_PASSWORD.length < 12 || BELLA_ADMIN_EMAIL?.length > 150) throw new Error('Username/email are too long or the password is shorter than 12 characters.');
  const certificatePath = process.env.SUPABASE_DB_CA_CERT || path.resolve(__dirname, '../supabase-root.crt');
  const ssl = process.env.PGSSLMODE === 'disable'
    ? false
    : fs.existsSync(certificatePath)
      ? { ca: fs.readFileSync(certificatePath, 'utf8'), rejectUnauthorized: true }
      : { rejectUnauthorized: true };
  const pool = new Pool({ connectionString: DATABASE_URL, ssl });
  try {
    const hash = await bcrypt.hash(BELLA_ADMIN_PASSWORD, 12);
    const email = BELLA_ADMIN_EMAIL || `${BELLA_ADMIN_USERNAME}@bella.invalid`;
    await pool.query('INSERT INTO admins(username,email,password_hash) VALUES($1,$2,$3) ON CONFLICT(username) DO NOTHING', [BELLA_ADMIN_USERNAME, email, hash]);
    console.log('Admin account is ready. Existing usernames are left unchanged.');
  } finally { await pool.end(); }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
