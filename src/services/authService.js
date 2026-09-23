const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');

const PASSWORD_SALT_ROUNDS = 12;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

function createAccessToken(user) {
  const secret = String(process.env.JWT_SECRET || '').trim();
  if (!secret) {
    const error = new Error('Thiếu JWT_SECRET trong file .env');
    error.statusCode = 500;
    throw error;
  }

  return jwt.sign(
    {
      sub: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      session: user.session,
    },
    secret,
    { expiresIn: JWT_EXPIRES_IN },
  );
}

function assertPasswordPolicy(password, label = 'Mật khẩu') {
  const value = String(password || '');
  if (value.length < 6 || !/\p{L}/u.test(value) || !/\d/.test(value)) {
    const error = new Error(`${label} phải có ít nhất 6 ký tự, gồm cả chữ và số`);
    error.statusCode = 400;
    throw error;
  }
}

function isBcryptHash(value) {
  return /^\$2[aby]?\$\d{2}\$/.test(String(value || ''));
}

async function verifyPassword(inputPassword, storedPassword) {
  const input = String(inputPassword || '');
  const stored = String(storedPassword || '');
  if (isBcryptHash(stored)) return bcrypt.compare(input, stored);
  return input === stored;
}

function publicUser(user) {
  if (!user) return null;
  const { password, ...result } = user;
  return result;
}

async function login(username, password) {
  const result = await pool.query(
    `SELECT id, name, username, password, role, session, created_at
     FROM public.users WHERE username = $1`,
    [String(username).trim()],
  );
  const user = result.rows[0];
  if (!user) return null;

  const isAdminAll = String(user.role).toLowerCase() === 'admin'
    && String(user.session).toLowerCase() === 'all';
  const storedPasswordIsHash = isBcryptHash(user.password);
  if (!storedPasswordIsHash && !isAdminAll) return null;
  if (!(await verifyPassword(password, user.password))) return null;

  if (!isBcryptHash(user.password)) {
    const hash = await bcrypt.hash(String(password), PASSWORD_SALT_ROUNDS);
    await pool.query('UPDATE public.users SET password = $1 WHERE id = $2', [hash, user.id]);
  }
  const safeUser = publicUser(user);
  return {
    user: safeUser,
    token: createAccessToken(safeUser),
  };
}

async function register({ name, username, password, role = 'user', session = 'view' }) {
  assertPasswordPolicy(password);
  const hash = await bcrypt.hash(String(password), PASSWORD_SALT_ROUNDS);
  const result = await pool.query(
    `INSERT INTO public.users (name, username, password, role, session)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, username, role, session, created_at`,
    [String(name).trim(), String(username).trim(), hash, String(role), String(session)],
  );
  return result.rows[0];
}

async function getUsers() {
  const result = await pool.query(
    `SELECT id, name, username, role, session, created_at
     FROM public.users ORDER BY id ASC`,
  );
  return result.rows;
}

async function getUserById(id) {
  const result = await pool.query(
    `SELECT id, name, username, role, session, created_at
     FROM public.users WHERE id = $1`,
    [id],
  );
  return result.rows[0] || null;
}

async function updateUser(id, data) {
  const fields = [];
  const values = [];
  const add = (column, value) => {
    if (value !== undefined) {
      values.push(value);
      fields.push(`${column} = $${values.length}`);
    }
  };

  add('name', data.name === undefined ? undefined : String(data.name).trim());
  add('username', data.username === undefined ? undefined : String(data.username).trim());
  add('role', data.role === undefined ? undefined : String(data.role).trim());
  add('session', data.session === undefined ? undefined : String(data.session).trim());
  if (data.password !== undefined) {
    assertPasswordPolicy(data.password, 'Mật khẩu mới');
    add('password', await bcrypt.hash(String(data.password), PASSWORD_SALT_ROUNDS));
  }
  if (!fields.length) return null;

  values.push(id);
  const result = await pool.query(
    `UPDATE public.users SET ${fields.join(', ')} WHERE id = $${values.length}
     RETURNING id, name, username, role, session, created_at`,
    values,
  );
  return result.rows[0] || null;
}

async function deleteUser(id) {
  const result = await pool.query(
    `DELETE FROM public.users WHERE id = $1
     RETURNING id, name, username, role, session`,
    [id],
  );
  return result.rows[0] || null;
}

async function updatePassword(username, password) {
  assertPasswordPolicy(password, 'Mật khẩu mới');
  const hash = await bcrypt.hash(String(password), PASSWORD_SALT_ROUNDS);
  const result = await pool.query(
    `UPDATE public.users SET password = $1 WHERE username = $2
     RETURNING id, name, username, role, session`,
    [hash, String(username).trim()],
  );
  return result.rows[0] || null;
}

module.exports = {
  login, register, getUsers, getUserById, updateUser, deleteUser, updatePassword,
  createAccessToken,
};
