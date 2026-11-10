require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { Queue } = require('bullmq');
const { createCsvProcessorWorker } = require('./workers/csvProcessor');
const redisConnection = require('./utils/redisConnection');
const pool = require('./utils/postgres');
const fileRoutes = require('./file');
const authRoutes = require('./controllers/auth');
const productsRoutes = require('./controllers/products');
const authMiddleware = require('./middleware/auth');
const logger = require('./middleware/logger');

const app = express();
app.use(logger);
app.use(cors());
app.use(express.json({ limit: '16kb' }));
const port = Number(process.env.PORT || 3001);
const csvQueue = new Queue('csv-processor', {
  connection: redisConnection,
});
const csvProcessorWorker = createCsvProcessorWorker();
app.use(authRoutes);
app.use(authMiddleware);
app.use(productsRoutes(pool));
app.use(fileRoutes(pool, csvQueue));

csvQueue.on('error', (error) => {
  console.error('CSV processor queue error:', error.message);
  if (error.message.includes('NOAUTH')) {
    console.error('Set REDIS_PASSWORD (and REDIS_USERNAME if required) to match the Redis server, or connect to an unauthenticated Redis instance.');
  }
});

csvProcessorWorker.on('completed', (job, result) => {
  console.info(`CSV job ${job.id} validated ${result.rowCount} rows from ${result.filename}`);
});

csvProcessorWorker.on('failed', (job, error) => {
  console.error(`CSV job ${job ? job.id : 'unknown'} failed:`, error.message);
});

csvProcessorWorker.on('error', (error) => {
  console.error('CSV processor worker error:', error.message);
});

app.get('/', (req, res) => {
  res.send('Hello World!1'); 
});

app.get('/search', async (req, res) => {
  const query = req.query;
  if (!query) {
    return res.status(400).json({ error: 'Missing query parameter' });
  }
  console.log(query)
  try {
    const result = await pool.query("select * from \"price_feed\" where store_id=$1 and product_name like '%Classic%'", [query.store_id]);
    res.json({ status: 'ok', results: result.rows });
  } catch (error) {
    console.error('PostgreSQL health check failed:', error.message);
    res.status(503).json({ status: 'error', message: 'Database unavailable' });
  }
});

app.get('/health/db', async (req, res) => {
  try {
    const result = await pool.query('SELECT current_database() AS database');
    res.json({ status: 'ok', database: result.rows[0].database });
  } catch (error) {
    console.error('PostgreSQL health check failed:', error.message);
    res.status(503).json({ status: 'error', message: 'Database unavailable' });
  }
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});