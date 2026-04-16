const { Pool } = require('pg');
require('dotenv').config();

const pool = process.env.DATABASE_URL 
  ? new Pool({
      connectionString: process.env.DATABASE_URL.replace('5432', '6543'), // Use Supabase Transaction Pooler (Port 6543)
      ssl: {
        rejectUnauthorized: false
      },
      max: 20, // Increase max connections for production
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    })
  : new Pool({
      user: process.env.DB_USER || 'postgres',
      host: process.env.DB_HOST || 'localhost',
      database: process.env.DB_NAME || 'hostel_db',
      password: process.env.DB_PASSWORD || 'password',
      port: process.env.DB_PORT || 5432,
    });

module.exports = {
  query: (text, params) => pool.query(text, params),
};
