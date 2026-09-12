function createBusinessController(service) {
  function handleError(res, error) {
    const status = error.statusCode || ({
      '23502': 400,
      '22P02': 400,
      '22001': 400,
      '23505': 409,
      '23503': 409,
    }[error.code] || 500);
    const messages = {
      409: 'Dữ liệu bị trùng hoặc vi phạm ràng buộc liên kết',
      500: 'Lỗi cơ sở dữ liệu',
    };
    console.error('Business data error:', error.message);
    return res.status(status).json({
      success: false,
      message: status === 400 ? error.message : (messages[status] || error.message),
      ...(process.env.NODE_ENV !== 'production' ? { error: error.message } : {}),
    });
  }

  return {
    getAll: async (req, res) => {
      try { return res.json({ success: true, data: await service.getAll() }); }
      catch (error) { return handleError(res, error); }
    },
    getById: async (req, res) => {
      try {
        const data = await service.getById(req.params.id);
        if (!data) return res.status(404).json({ success: false, message: 'Không tìm thấy dữ liệu' });
        return res.json({ success: true, data });
      } catch (error) { return handleError(res, error); }
    },
    create: async (req, res) => {
      try { return res.status(201).json({ success: true, data: await service.create(req.body) }); }
      catch (error) { return handleError(res, error); }
    },
    update: async (req, res) => {
      try {
        const data = await service.update(req.params.id, req.body);
        if (!data) return res.status(404).json({ success: false, message: 'Không tìm thấy dữ liệu' });
        return res.json({ success: true, data });
      } catch (error) { return handleError(res, error); }
    },
  };
}

module.exports = { createBusinessController };
