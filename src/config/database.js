const { Pool } = require('pg');
require('dotenv').config();

// Các dịch vụ managed (Render, Supabase, RDS...) bắt buộc kết nối qua SSL.
// Render cấp chứng chỉ self-signed nên không xác thực chuỗi CA được.
const ssl = String(process.env.DB_SSL || '').toLowerCase() === 'true'
  ? { rejectUnauthorized: false }
  : false;

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: '-c search_path=public',
  ssl,
});

pool.on('error', (error) => {
  console.error('PostgreSQL pool error:', error.message);
});

module.exports = pool;
