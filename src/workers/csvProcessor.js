require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const { TextDecoder } = require('node:util');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { parse } = require('csv-parse');
const { Worker } = require('bullmq');
const copyFrom = require('pg-copy-streams').from;
const csvColumns = require('../csvColumns');
const redisConnection = require('../utils/redisConnection');
const pool = require('../utils/postgres');

const dataDirectory = path.resolve(__dirname, '..', 'data');
const databaseColumns = ['store_id', 'sku', 'product_name', 'price', 'price_date', 'country'];

async function validateCsvFile(filePath, expectedStoreId) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const utf8Validator = new Transform({
    transform(chunk, encoding, callback) {
      try {
        decoder.decode(chunk, { stream: true });
        callback(null, chunk);
      } catch {
        callback(new Error('CSV contains invalid UTF-8 bytes'));
      }
    },
    flush(callback) {
      try {
        decoder.decode();
        callback();
      } catch {
        callback(new Error('CSV contains invalid UTF-8 bytes'));
      }
    },
  });
  const parser = parse({ bom: true, skip_empty_lines: false });
  const parsing = pipeline(fs.createReadStream(filePath), utf8Validator, parser);
  parsing.catch(() => {});

  const productKeys = new Set();
  let rowNumber = 0;
  let dataRowCount = 0;

  try {
    for await (const row of parser) {
      rowNumber += 1;

      if (rowNumber === 1) {
        if (row.length !== csvColumns.length || !csvColumns.every((column, index) => row[index] === column)) {
          throw new Error(`CSV header must match: ${csvColumns.join(',')}`);
        }
        continue;
      }

      if (row.length !== csvColumns.length) {
        throw new Error(`CSV row ${rowNumber} must contain ${csvColumns.length} columns`);
      }
      if (row.some((value) => value.trim().length === 0)) {
        throw new Error(`CSV row ${rowNumber} contains a null or empty value`);
      }

      const storeId = row[0].trim();
      const productName = row[2].trim();
      if (expectedStoreId !== undefined && storeId !== String(expectedStoreId)) {
        throw new Error(`CSV row ${rowNumber} contains a store_id different from the import store`);
      }
      const productKey = JSON.stringify([storeId, productName]);
      if (productKeys.has(productKey)) {
        throw new Error(`Duplicate product_name for store_id at CSV row ${rowNumber}`);
      }
      productKeys.add(productKey);
      dataRowCount += 1;
    }

    await parsing;
  } catch (error) {
    await parsing.catch(() => {});
    throw error;
  }

  if (rowNumber === 0) {
    throw new Error('CSV file is empty and has no header');
  }

  return dataRowCount;
}

async function processCsvJob(job, databasePool = pool) {
  const { filename, userId, storeId, importJobId } = job.data || {};
  if (
    typeof filename !== 'string'
    || path.basename(filename) !== filename
    || path.extname(filename).toLowerCase() !== '.csv'
    || typeof userId !== 'string' && typeof userId !== 'number'
    || typeof storeId !== 'string' && typeof storeId !== 'number'
    || typeof importJobId !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(importJobId)
  ) {
    throw new Error('CSV job is missing valid filename, userId, storeId, or importJobId');
  }

  const filePath = path.join(dataDirectory, filename);
  let client;
  let transactionStarted = false;
  let rowCount;
  let releaseError;

  try {
    const statusResult = await databasePool.query(
      `UPDATE import_jobs
       SET status = 'PROCESSING'
       WHERE id = $1 AND status IN ('PENDING', 'PROCESSING')
       RETURNING id`,
      [importJobId],
    );
    if (statusResult.rowCount !== 1) {
      throw new Error(`Import job ${importJobId} was not found or is not processable`);
    }

    rowCount = await validateCsvFile(filePath, storeId);
    client = await databasePool.connect();
    await client.query('BEGIN');
    transactionStarted = true;

    const copyStream = client.query(
      copyFrom(
        `COPY price_feed (${databaseColumns.join(', ')}) FROM STDIN WITH (FORMAT csv, HEADER true)`,
      ),
    );
    await pipeline(fs.createReadStream(filePath), copyStream);
    await client.query(
      `UPDATE import_jobs
       SET status = 'COMPLETED'
       WHERE id = $1`,
      [importJobId],
    );
    await client.query('COMMIT');
    transactionStarted = false;

    return { filename, rowCount, importJobId };
  } catch (error) {
    releaseError = error;
    if (client && transactionStarted) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Unable to roll back CSV import:', rollbackError.message);
      }
    }

    try {
      await databasePool.query(
        `UPDATE import_jobs
         SET status = 'FAILED', error = $2
         WHERE id = $1 AND status != 'COMPLETED'`,
        [importJobId, error.message],
      );
    } catch (statusError) {
      console.error('Unable to mark CSV import job as failed:', statusError.message);
    }
    throw error;
  } finally {
    if (client) {
      client.release(releaseError);
    }
  }
}

function createCsvProcessorWorker() {
  return new Worker('csv-processor', async (job) => {
    console.info(`Processing CSV job ${job.id}`);
    return processCsvJob(job);
  }, {
    connection: redisConnection,
    concurrency: 2,
  });
}

module.exports = { createCsvProcessorWorker, processCsvJob, validateCsvFile };
