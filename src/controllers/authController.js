const authService = require('../services/authService');

function userId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function databaseError(res, error, message) {
  if (error.statusCode === 400) {
    return res.status(400).json({ success: false, message: error.message });
  }
  if (error.code === '23505') {
    return res.status(409).json({ success: false, message: 'Username đã tồn tại' });
  }
  console.error(message, error);
  return res.status(500).json({ success: false, message, error: error.message });
}

async function login(req, res) {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Vui lòng nhập username và password' });
  }
  try {
    const data = await authService.login(username, password);
    if (!data) return res.status(401).json({ success: false, message: 'Username hoặc password không đúng' });
    return res.json({ success: true, message: 'Đăng nhập thành công', data });
  } catch (error) {
    return databaseError(res, error, 'Lỗi đăng nhập');
  }
}

async function register(req, res) {
  const { name, username, password, role = 'user', session = 'view' } = req.body || {};
  if (!name || !username || !password) {
    return res.status(400).json({ success: false, message: 'Vui lòng nhập name, username và password' });
  }
  try {
    const data = await authService.register({ name, username, password, role, session });
    return res.status(201).json({ success: true, message: 'Đăng ký tài khoản thành công', data });
  } catch (error) {
    return databaseError(res, error, 'Không thể đăng ký tài khoản');
  }
}

async function getUsers(req, res) {
  try {
    return res.json({ success: true, data: await authService.getUsers() });
  } catch (error) {
    return databaseError(res, error, 'Không thể lấy danh sách user');
  }
}

async function getUserById(req, res) {
  const id = userId(req.params.id);
  if (!id) return res.status(400).json({ success: false, message: 'id user không hợp lệ' });
  try {
    const data = await authService.getUserById(id);
    if (!data) return res.status(404).json({ success: false, message: 'Không tìm thấy user' });
    return res.json({ success: true, data });
  } catch (error) {
    return databaseError(res, error, 'Không thể lấy thông tin user');
  }
}

async function updateUser(req, res) {
  const id = userId(req.params.id);
  const data = req.body || {};
  const allowed = ['name', 'username', 'password', 'role', 'session'];
  if (!id) return res.status(400).json({ success: false, message: 'id user không hợp lệ' });
  if (!Object.keys(data).some((key) => allowed.includes(key))) {
    return res.status(400).json({ success: false, message: 'Không có dữ liệu cần cập nhật' });
  }
  try {
    const result = await authService.updateUser(id, data);
    if (!result) return res.status(404).json({ success: false, message: 'Không tìm thấy user' });
    return res.json({ success: true, message: 'Cập nhật user thành công', data: result });
  } catch (error) {
    return databaseError(res, error, 'Không thể cập nhật user');
  }
}

async function deleteUser(req, res) {
  const id = userId(req.params.id);
  if (!id) return res.status(400).json({ success: false, message: 'id user không hợp lệ' });
  try {
    const data = await authService.deleteUser(id);
    if (!data) return res.status(404).json({ success: false, message: 'Không tìm thấy user' });
    return res.json({ success: true, message: 'Xóa user thành công', data });
  } catch (error) {
    return databaseError(res, error, 'Không thể xóa user');
  }
}

async function updatePassword(req, res) {
  const { username, newPassword, password } = req.body || {};
  const nextPassword = newPassword || password;
  if (!username || !nextPassword) {
    return res.status(400).json({ success: false, message: 'Vui lòng nhập username và mật khẩu mới' });
  }
  try {
    const data = await authService.updatePassword(username, nextPassword);
    if (!data) return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản' });
    return res.json({ success: true, message: 'Cập nhật mật khẩu thành công', data });
  } catch (error) {
    return databaseError(res, error, 'Không thể cập nhật mật khẩu');
  }
}

module.exports = {
  login, register, getUsers, getUserById, updateUser, deleteUser, updatePassword,
};
