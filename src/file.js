const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const express = require('express');
const Busboy = require('busboy');
const copyFrom = require('pg-copy-streams').from;
const csvColumns = require('./csvColumns');

const dataDirectory = path.resolve(__dirname, 'data');
console.log('Data directory:', dataDirectory);
const maxUploadSize = 10 * 1024 * 1024;
const tableColumns = csvColumns.join(', ');
let processing = false;

module.exports = (pool, csvQueue) => {
  const router = express.Router();

  router.post('/file/upload', async (req, res) => {
    if (!req.is('multipart/form-data')) {
      return res.status(415).json({ status: 'error', message: 'Expected a multipart/form-data request' });
    }

    let busboy;
    try {
      busboy = Busboy({
        headers: req.headers,
        limits: { fileSize: maxUploadSize, files: 2, fields: 6, parts: 12 },
      });
    } catch {
      return res.status(400).json({ status: 'error', message: 'Invalid multipart request' });
    }

    let fileCount = 0;
    let uploadError;
    let tempPath;
    let storedName;
    const writes = [];

    busboy.on('file', (fieldName, file, info) => {
      fileCount += 1;
      if (fieldName !== 'file' || fileCount > 1) {
        uploadError = { status: 400, message: 'Upload exactly one file in the "file" field' };
        file.resume();
        return;
      }

      if (path.extname(typeof info.filename === 'string' ? info.filename : '').toLowerCase() !== '.csv') {
        uploadError = { status: 415, message: 'Only CSV files are allowed' };
        file.resume();
        return;
      }

      storedName = `${crypto.randomUUID()}.csv`;
      tempPath = path.join(dataDirectory, `.${storedName}.tmp`);
      file.on('limit', () => {
        uploadError = { status: 413, message: 'CSV file must be smaller than 10 MB' };
      });

      writes.push(
        pipeline(file, fs.createWriteStream(tempPath, { flags: 'wx' })).catch((error) => {
          uploadError = uploadError || { status: 500, message: 'Unable to save CSV file', error };
        }),
      );
    });

    busboy.on('filesLimit', () => {
      uploadError = { status: 400, message: 'Upload exactly one file in the "file" field' };
    });
    busboy.on('fieldsLimit', () => {
      uploadError = { status: 400, message: 'Too many form fields' };
    });
    busboy.on('partsLimit', () => {
      uploadError = { status: 400, message: 'Too many multipart fields' };
    });

    busboy.on('error', async (error) => {
      console.error('CSV upload parsing failed:', error.message);
      await removeTempFile();
      if (!res.headersSent && !res.destroyed) {
        res.status(400).json({ status: 'error', message: 'Invalid multipart request' });
      }
    });

    busboy.on('close', async () => {
      await Promise.all(writes);

      if (!uploadError && fileCount === 0) {
        uploadError = { status: 400, message: 'No CSV file was provided' };
      }

      if (uploadError) {
        if (uploadError.error) {
          console.error('CSV upload failed:', uploadError.error.message);
        }
        await removeTempFile();
        if (!res.headersSent && !res.destroyed) {
          res.status(uploadError.status).json({ status: 'error', message: uploadError.message });
        }
        return;
      }

      try {
        await fs.promises.rename(tempPath, path.join(dataDirectory, storedName));
      } catch (error) {
        console.error('Unable to finalize CSV upload:', error.message);
        await removeTempFile();
        if (!res.headersSent && !res.destroyed) {
          res.status(500).json({ status: 'error', message: 'Unable to save CSV file' });
        }
        return;
      }

      const importJobId = crypto.randomUUID();
      try {
        await pool.query(
          `INSERT INTO import_jobs (id, file_name, user_id, store_id, status)
           VALUES ($1, $2, $3, $4, 'PENDING')`,
          [importJobId, storedName, req.userId, req.storeId],
        );
      } catch (error) {
        console.error('Unable to create import job:', error.message);
        await removeUploadedFile();
        if (!res.headersSent && !res.destroyed) {
          res.status(500).json({ status: 'error', message: 'Unable to create CSV import job' });
        }
        return;
      }

      try {
        const job = await csvQueue.add('process-csv', {
          filename: storedName,
          userId: req.userId,
          storeId: req.storeId,
          importJobId,
        });
        res.status(201).json({
          status: 'ok',
          file: storedName,
          importJobId,
          jobId: job.id,
          message: 'CSV uploaded and queued successfully',
        });
      } catch (error) {
        console.error('CSV upload queueing failed:', error.message);
        try {
          await pool.query(
            "UPDATE import_jobs SET status = 'FAILED' WHERE id = $1",
            [importJobId],
          );
        } catch (updateError) {
          console.error('Unable to mark import job as failed:', updateError.message);
        }
        if (!res.headersSent && !res.destroyed) {
          res.status(503).json({
            status: 'error',
            file: storedName,
            importJobId,
            message: 'CSV uploaded but could not be queued',
          });
        }
      }
    });

    async function removeTempFile() {
      if (!tempPath) {
        return;
      }
      try {
        await fs.promises.unlink(tempPath);
      } catch (error) {
        if (error.code !== 'ENOENT') {
          console.error('Unable to remove incomplete CSV upload:', error.message);
        }
      }
    }

    async function removeUploadedFile() {
      if (!storedName) {
        return;
      }
      try {
        await fs.promises.unlink(path.join(dataDirectory, storedName));
      } catch (error) {
        if (error.code !== 'ENOENT') {
          console.error('Unable to remove CSV upload without an import job:', error.message);
        }
      }
    }

    req.pipe(busboy);
  });

  router.get('/jobs', async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT id, file_name, status, error, created_at
         FROM import_jobs
         WHERE store_id = $1
         ORDER BY created_at DESC`,
        [req.storeId],
      );
      res.json({ status: 'ok', jobs: result.rows });
    } catch (error) {
      console.error('Unable to list import jobs:', error.message);
      res.status(503).json({ status: 'error', message: 'Unable to retrieve import jobs' });
    }
  });

  router.get('/file/sts', async (req, res) => {
    try {
      // const result = await pool.query('SELECT current_database() AS database');
      res.json({ status: 'ok', token: 'https://test.com' });
    } catch (error) {
      console.error('Database status check failed:', error.message);
      res.status(503).json({ status: 'error', message: 'Database unavailable' });
    }
  });

  router.post('/file/process', async (req, res) => {
    if (processing) {
      return res.status(409).json({ status: 'error', message: 'A CSV import is already in progress' });
    }

    let files;
    try {
      files = await fs.promises.readdir(dataDirectory, { withFileTypes: true });
    } catch (error) {
      console.error('Unable to read data directory:', error.message);
      return res.status(500).json({ status: 'error', message: 'Unable to read CSV data directory' });
    }

    const csvFiles = files
      .filter((file) => file.isFile() && path.extname(file.name).toLowerCase() === '.csv')
      .map((file) => file.name);

    if (csvFiles.length === 0) {
      return res.status(404).json({ status: 'error', message: 'No CSV file found in the data directory' });
    }
    if (csvFiles.length > 1) {
      return res.status(409).json({ status: 'error', message: 'Expected one CSV file in the data directory' });
    }

    processing = true;
    let client;
    let releaseError;
    try {
      client = await pool.connect();
      const csvPath = path.join(dataDirectory, csvFiles[0]);
      const copyStream = client.query(
        copyFrom(`COPY price_feed (${tableColumns}) FROM STDIN WITH (FORMAT csv, HEADER true)`),
      );
      await pipeline(fs.createReadStream(csvPath), copyStream);
      res.json({ status: 'ok', file: csvFiles[0], message: 'CSV imported successfully' });
    } catch (error) {
      releaseError = error;
      console.error('CSV import failed:', error.message);
      if (!res.headersSent) {
        res.status(500).json({ status: 'error', message: 'CSV import failed' });
      }
    } finally {
      if (client) {
        client.release(releaseError);
      }
      processing = false;
    }
  });

  return router;
};
