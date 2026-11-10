const express = require('express');
const jwt = require('jsonwebtoken');
const secret = process.env.JWT_SECRET;

const router = express.Router();
const loginUser = {
  userId: 'admin@gmail.com',
  role: 'admin',
  storeId: 'ST00001',
  password: '123456',
};
const tokenExpiresIn = '1h';

router.post('/auth/login', (req, res) => {
  console.log('Login request body:', req.body);
  const { email, password } = req.body || {};
  if (
    String(email) !== loginUser.userId
    || typeof password !== 'string'
    || password !== loginUser.password
  ) {
    return res.status(401).json({ status: 'error', message: 'Invalid user ID or password' });
  }

  const token = jwt.sign(
    { userId: loginUser.userId, role: loginUser.role, storeId: loginUser.storeId },
    secret,
    { algorithm: 'HS256', expiresIn: tokenExpiresIn },
  );

  res.json({ status: 'ok', token, tokenType: 'Bearer', expiresIn: tokenExpiresIn });
});

module.exports = router;