const pool = require('../config/database');

function createBusinessService(model) {
  const quote = (identifier) => `"${identifier.replace(/"/g, '""')}"`;
  const tableName = quote(model.table);
  const idColumn = quote(model.idColumn);
  const columnList = model.columns.map(quote).join(', ');

  function valuesFromBody(body, includeId = true) {
    const entries = Object.entries(body || {})
      .filter(([key, value]) => model.columns.includes(key) && value !== undefined);
    if (!includeId) {
      return entries.filter(([key]) => key !== model.idColumn);
    }
    return entries;
  }

  async function getAll() {
    const result = await pool.query(
      `SELECT ${columnList} FROM public.${tableName} ORDER BY ${idColumn} ASC`,
    );
    return result.rows;
  }

  async function getById(id) {
    const result = await pool.query(
      `SELECT ${columnList} FROM public.${tableName} WHERE ${idColumn} = $1`,
      [id],
    );
    return result.rows[0] || null;
  }

  async function create(body) {
    const entries = valuesFromBody(body);
    if (!entries.length) throw Object.assign(new Error('Không có dữ liệu để tạo'), { statusCode: 400 });

    const fields = entries.map(([key]) => quote(key));
    const values = entries.map(([, value]) => value);
    const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');
    const result = await pool.query(
      `INSERT INTO public.${tableName} (${fields.join(', ')})
       VALUES (${placeholders}) RETURNING ${columnList}`,
      values,
    );
    return result.rows[0];
  }

  async function update(id, body) {
    const entries = valuesFromBody(body, false);
    if (!entries.length) throw Object.assign(new Error('Không có dữ liệu để cập nhật'), { statusCode: 400 });

    const values = entries.map(([, value]) => value);
    const assignments = entries.map(([key], index) => `${quote(key)} = $${index + 1}`);
    values.push(id);
    const result = await pool.query(
      `UPDATE public.${tableName} SET ${assignments.join(', ')}
       WHERE ${idColumn} = $${values.length}
       RETURNING ${columnList}`,
      values,
    );
    return result.rows[0] || null;
  }

  return { getAll, getById, create, update };
}

module.exports = { createBusinessService };
