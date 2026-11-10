const express = require('express');

const defaultPageSize = 20;
const maxPageSize = 100;

function parsePositiveInteger(value, defaultValue, maximum = Number.MAX_SAFE_INTEGER) {
  if (value === undefined) {
    return defaultValue;
  }
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    return null;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= maximum ? parsed : null;
}

function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

module.exports = (pool) => {
  const router = express.Router();

  router.patch('/products/:id', async (req, res) => {
    const sku = req.params.id;
    const body = req.body;
    if (!sku || sku.length > 20) {
      return res.status(400).json({ status: 'error', message: 'A valid SKU is required in the URL' });
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return res.status(400).json({ status: 'error', message: 'A JSON object is required' });
    }

    const allowedFields = ['product_name', 'price', 'price_date'];
    const updates = Object.keys(body).filter((field) => field !== 'old_price_date');
    if (updates.length === 0 || updates.some((field) => !allowedFields.includes(field))) {
      return res.status(400).json({
        status: 'error',
        message: 'Provide one or more of product_name, price, or price_date to update',
      });
    }
    if (!isValidDate(body.old_price_date)) {
      return res.status(400).json({
        status: 'error',
        message: 'old_price_date must be a valid YYYY-MM-DD date',
      });
    }
    if (Object.hasOwn(body, 'price_date') && !isValidDate(body.price_date)) {
      return res.status(400).json({ status: 'error', message: 'price_date must be a valid YYYY-MM-DD date' });
    }

    if (
      Object.hasOwn(body, 'product_name')
      && (typeof body.product_name !== 'string'
        || body.product_name.trim().length === 0
        || body.product_name.length > 200)
    ) {
      return res.status(400).json({ status: 'error', message: 'product_name must be a non-empty string up to 200 characters' });
    }
    if (
      Object.hasOwn(body, 'price')
      && (typeof body.price !== 'number'
        || !Number.isFinite(body.price)
        || body.price < 0
        || !/^\d{1,10}(\.\d{1,2})?$/.test(String(body.price)))
    ) {
      return res.status(400).json({ status: 'error', message: 'price must be a non-negative number with up to 2 decimal places' });
    }

    const values = [req.storeId, sku, body.old_price_date];
    const assignments = [];
    for (const field of allowedFields) {
      if (Object.hasOwn(body, field)) {
        values.push(field === 'product_name' ? body[field].trim() : body[field]);
        assignments.push(`${field} = $${values.length}`);
      }
    }

    try {
      const result = await pool.query(
        `UPDATE price_feed
         SET ${assignments.join(', ')}
         WHERE store_id = $1 AND sku = $2 AND price_date = $3
         RETURNING store_id, sku, product_name, price, price_date, country`,
        values,
      );
      if (result.rowCount === 0) {
        return res.status(404).json({ status: 'error', message: 'Product price record not found' });
      }
      res.json({ status: 'ok', product: result.rows[0] });
    } catch (error) {
      console.error('Unable to update product:', error.message);
      if (error.code === '23505') {
        return res.status(409).json({
          status: 'error',
          message: 'A product price record already exists for the requested date',
        });
      }
      res.status(503).json({ status: 'error', message: 'Unable to update product' });
    }
  });

  const searchProducts = async (req, res) => {
    console.log('Search request body:', req.body);
    console.log('Search request query:', req.query);
    const page = parsePositiveInteger(req.query.page, 1);
    const pageSize = parsePositiveInteger(req.query.pageSize, defaultPageSize, maxPageSize);
    if (page === null || pageSize === null) {
      return res.status(400).json({
        status: 'error',
        message: `page must be a positive integer and pageSize must be between 1 and ${maxPageSize}`,
      });
    }

    if (req.query.storeId !== undefined && typeof req.query.storeId !== 'string') {
      return res.status(400).json({ status: 'error', message: 'storeId must be a single value' });
    }
    if (req.query.productName !== undefined && typeof req.query.productName !== 'string') {
      return res.status(400).json({ status: 'error', message: 'productName must be a single value' });
    }
    if (req.query.sku !== undefined && typeof req.query.sku !== 'string') {
      return res.status(400).json({ status: 'error', message: 'sku must be a single value' });
    }

    const filters = ['store_id = $1'];
    const values = [req.storeId];
    if (req.query.storeId) {
      values.push(req.query.storeId);
      filters.push(`store_id = $${values.length}`);
    }
    if (req.query.productName) {
      values.push(`%${req.query.productName}%`);
      filters.push(`product_name ILIKE $${values.length}`);
    }
    if (req.query.sku) {
      values.push(`%${req.query.sku}%`);
      filters.push(`sku ILIKE $${values.length}`);
    }

    const whereClause = filters.join(' AND ');
    const offset = (page - 1) * pageSize;
    if (!Number.isSafeInteger(offset)) {
      return res.status(400).json({ status: 'error', message: 'Requested page is too large' });
    }

    try {
      const countResult = await pool.query(
        `SELECT COUNT(*) AS total FROM price_feed WHERE ${whereClause}`,
        values,
      );
      const productsResult = await pool.query(
        `SELECT store_id, sku, product_name, price, price_date, country
         FROM price_feed
         WHERE ${whereClause}
         ORDER BY product_name, sku, price_date DESC
         LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, pageSize, offset],
      );

      res.json({
        status: 'ok',
        products: productsResult.rows,
        pagination: {
          page,
          pageSize,
          total: Number(countResult.rows[0].total),
          totalPages: Math.ceil(Number(countResult.rows[0].total) / pageSize),
        },
      });
    } catch (error) {
      console.error('Unable to list products:', error.message);
      res.status(503).json({ status: 'error', message: 'Unable to retrieve products' });
    }
  };

  router.get('/products/search', searchProducts);
  router.post('/products/search', searchProducts);

  return router;
};