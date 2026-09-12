const { Pool } = require('pg');
require('dotenv').config();


const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: '-c search_path=public'
});

// Kiểm tra kết nối PostgreSQL
pool.query('SELECT NOW()', (err, result) => {
    if (err) {
        console.error('PostgreSQL connection failed:', err.message);
    } else {
        console.log('PostgreSQL connected:', result.rows[0]);
    }
});

module.exports = pool;
