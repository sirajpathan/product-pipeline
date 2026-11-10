#!/usr/bin/env node
/**
 * Generate a 30M-row retail pricing feed and load it into PostgreSQL.
 *
 * Source columns: store_id, sku, product_name, price, date, country
 * Shape:          3,000 stores x 100 days x 100 SKUs/day = 30,000,000 rows
 * Unique key:     (store_id, sku, price_date)
 *
 * Usage:
 *   export DATABASE_URL=postgresql://retail_app:nmap@9324x1234@127.0.0.1:54321/retail_pricing
 *   node generate_pricing_feed.js                    # load into Postgres
 *   node generate_pricing_feed.js --truncate         # drop/recreate table, then load
 *   node generate_pricing_feed.js --csv out.csv      # also write a CSV copy
 *   node generate_pricing_feed.js --csv-only out.csv # CSV only, no database
 *
 * Loading uses COPY (fastest bulk path) into a table partitioned by month.
 * The primary key is added AFTER the load, which is much faster than
 * maintaining the index row by row.
 */
"use strict";

const fs = require("fs");
const { once } = require("events");
const { parseArgs } = require("util");

const N_STORES = 3000, N_DAYS = 100, SKUS_PER_DAY = 100, N_SKUS = 5000;
const END_DATE = Date.UTC(2026, 10, 7); // 2026-11-07
const DAY_MS = 86400000;

// [ISO code, stores, price multiplier vs USD base, decimals]
const COUNTRIES = [
  ["US", 700, 1.0, 2], ["CA", 250, 1.35, 2], ["MX", 200, 18.0, 2],
  ["GB", 350, 0.8, 2], ["DE", 300, 0.92, 2], ["FR", 250, 0.92, 2],
  ["ES", 200, 0.92, 2], ["IT", 200, 0.92, 2], ["AU", 200, 1.5, 2],
  ["JP", 150, 150.0, 0], ["IN", 120, 83.0, 2], ["BR", 80, 5.0, 2],
];
if (COUNTRIES.reduce((a, c) => a + c[1], 0) !== N_STORES) throw new Error("country store counts must sum to 3000");

const TABLE = "price_feed";
const COLUMNS = ["store_id", "sku", "product_name", "price", "price_date", "country"];

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS ${TABLE} (
    store_id      VARCHAR(10)   NOT NULL,
    sku           VARCHAR(20)   NOT NULL,
    product_name  VARCHAR(200)  NOT NULL,
    price         NUMERIC(12,2) NOT NULL CHECK (price >= 0),
    price_date    VARCHAR(10)          NOT NULL,
    country       CHAR(2)       NOT NULL
) PARTITION BY RANGE (price_date)`;

// ---- seeded RNG (mulberry32) + Box-Muller normal, so runs are reproducible ----
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(42);
function randn() {
  let u = 0;
  while (u === 0) u = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

const pad = (n, w) => String(n).padStart(w, "0");
const isoDate = (ms) => new Date(ms).toISOString().slice(0, 10);

function buildReferenceData() {
  const storeIds = [], storeCountry = [], storeMult = [], storeDec = [];
  for (const [code, n, mult, dec] of COUNTRIES) {
    for (let i = 0; i < n; i++) {
      storeIds.push(`ST${pad(storeIds.length + 1, 5)}`);
      storeCountry.push(code);
      storeMult.push(mult);
      storeDec.push(dec);
    }
  }

  const adjectives = ["Fresh", "Organic", "Premium", "Classic", "Value", "Family", "Natural", "Crispy",
    "Creamy", "Spicy", "Sweet", "Light", "Whole", "Extra", "Deluxe", "Pure"];
  const items = ["Milk", "Bread", "Cheese", "Butter", "Yogurt", "Apple Juice", "Orange Juice", "Coffee",
    "Tea", "Pasta", "Rice", "Cereal", "Olive Oil", "Tomato Sauce", "Chips", "Chocolate",
    "Cookies", "Shampoo", "Soap", "Toothpaste", "Detergent", "Paper Towels", "Batteries",
    "Notebook", "Water Bottle", "Frozen Pizza", "Ice Cream", "Chicken Breast",
    "Salmon Fillet", "Eggs", "Bananas", "Spinach", "Cola", "Sparkling Water", "Pet Food",
    "Light Bulb"];
  const sizes = ["250g", "500g", "1kg", "2kg", "330ml", "500ml", "1L", "2L", "6-pack", "12-pack", "Single"];

  const skuCodes = [], names = [], baseUsd = [];
  for (let i = 0; i < N_SKUS; i++) {
    skuCodes.push(`SKU${pad(i + 1, 7)}`);
    names.push(`${adjectives[i % 16]} ${items[Math.floor(i / 16) % 36]} ${sizes[Math.floor(i / 7) % 11]}`);
    const p = Math.min(250, Math.max(0.5, Math.exp(1.3 + 0.8 * randn())));
    baseUsd.push(Math.round(p * 100) / 100);
  }

  const dates = [];
  for (let d = 0; d < N_DAYS; d++) dates.push(isoDate(END_DATE - (N_DAYS - 1 - d) * DAY_MS));

  // Pre-built string fragments keep the hot loop to cheap concatenation.
  const skuNameFrag = skuCodes.map((c, i) => `,${c},${names[i]},`); // ",SKU...,Name,"
  const cc = {};
  for (const [code] of COUNTRIES) cc[code] = dates.map((d) => `,${d},${code}\n`);
  return { storeIds, storeCountry, storeMult, storeDec, baseUsd, skuNameFrag, dates, cc };
}

/** Returns a generator of { text, rows, firstStore, stores } chunks (one chunk per storesPerChunk stores). */
function* generateChunks(ref, storesPerChunk) {
  for (let s0 = 0; s0 < N_STORES; s0 += storesPerChunk) {
    const sEnd = Math.min(s0 + storesPerChunk, N_STORES);
    const parts = [];
    let rows = 0;
    for (let S = s0; S < sEnd; S++) {
      const idPrefix = ref.storeIds[S];
      const mult = ref.storeMult[S];
      const dec = ref.storeDec[S];
      const storeAdj = 1 + (((S * 2654435761) % 1000) - 500) / 10000;
      const frags = ref.cc[ref.storeCountry[S]];
      const minPrice = dec === 0 ? 1 : 0.01;
      let buf = "";
      for (let D = 0; D < N_DAYS; D++) {
        const tail = frags[D];
        for (let K = 0; K < SKUS_PER_DAY; K++) {
          const skuI = (S * 131 + D * SKUS_PER_DAY + K) % N_SKUS;
          let price = ref.baseUsd[skuI] * mult * storeAdj * (1 + 0.03 * randn());
          price = dec === 0 ? Math.round(price) : Math.round(price * 100) / 100;
          if (price < minPrice) price = minPrice;
          // store_id, sku, product_name, price, date, country
          // skuNameFrag is ",SKU,Name," so the row starts with the store id.
          buf += idPrefix + ref.skuNameFrag[skuI] + price.toFixed(dec === 0 ? 0 : 2) + tail;
          rows++;
        }
      }
      parts.push(buf);
    }
    yield { text: parts.join(""), rows, firstStore: s0 + 1, stores: sEnd - s0 };
  }
}

function monthPartitions(ref) {
  const first = new Date(ref.dates[0] + "T00:00:00Z");
  const last = new Date(ref.dates[ref.dates.length - 1] + "T00:00:00Z");
  let y = first.getUTCFullYear(), m = first.getUTCMonth();
  const out = [];
  while (Date.UTC(y, m, 1) <= last.getTime()) {
    const ny = m === 11 ? y + 1 : y, nm = (m + 1) % 12;
    out.push([`${TABLE}_${y}_${pad(m + 1, 2)}`, isoDate(Date.UTC(y, m, 1)), isoDate(Date.UTC(ny, nm, 1))]);
    y = ny; m = nm;
  }
  return out;
}

async function prepareDatabase(client, ref, truncate) {
  if (truncate) await client.query(`DROP TABLE IF EXISTS ${TABLE} CASCADE`);
  await client.query(SCHEMA_SQL);
  for (const [name, start, end] of monthPartitions(ref)) {
    await client.query(`CREATE TABLE IF NOT EXISTS ${name} PARTITION OF ${TABLE} FOR VALUES FROM ('${start}') TO ('${end}')`);
  }
  await client.query(`CREATE TABLE IF NOT EXISTS ${TABLE}_default PARTITION OF ${TABLE} DEFAULT`);
  const { rows } = await client.query(`SELECT count(*)::bigint AS n FROM ${TABLE}`);
  const existing = Number(rows[0].n);
  if (existing) {
    throw new Error(`${TABLE} already has ${existing.toLocaleString()} rows. Re-run with --truncate to reload.`);
  }
}

async function finalizeDatabase(client) {
  const t = Date.now();
  console.log("Adding primary key (store_id, sku, price_date) ...");
  await client.query(`ALTER TABLE ${TABLE} ADD PRIMARY KEY (store_id, sku, price_date)`);
  console.log("Adding country index ...");
  await client.query(`CREATE INDEX IF NOT EXISTS ${TABLE}_country_idx ON ${TABLE} (country, price_date)`);
  console.log("Running ANALYZE ...");
  await client.query(`ANALYZE ${TABLE}`);
  console.log(`Indexes + analyze: ${Math.round((Date.now() - t) / 1000)}s`);
}

/** COPY one chunk of CSV text into Postgres; resolves when the server confirms. */
function copyChunk(client, copyFrom, text) {
  return new Promise((resolve, reject) => {
    const stream = client.query(copyFrom(`COPY ${TABLE} (${COLUMNS.join(", ")}) FROM STDIN WITH (FORMAT csv)`));
    stream.on("error", reject);
    stream.on("finish", resolve);
    stream.end(text);
  });
}

async function main() {
  const { values: args } = parseArgs({
    options: {
      dsn: { type: "string", default: process.env.DATABASE_URL },
      truncate: { type: "boolean", default: false },
      csv: { type: "string" },
      "csv-only": { type: "string" },
      "stores-per-chunk": { type: "string", default: "100" },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (args.help) { console.log(fs.readFileSync(__filename, "utf8").split("*/")[0].replace(/^[#/* ]+/gm, "")); return; }

  const csvPath = args["csv-only"] || args.csv;
  const useDb = !args["csv-only"];
  if (useDb && !args.dsn) {
    console.error("no database given: set DATABASE_URL or pass --dsn (or use --csv-only)");
    process.exit(2);
  }
  const storesPerChunk = parseInt(args["stores-per-chunk"], 10);

  const ref = buildReferenceData();
  let client = null, copyFrom = null;
  if (useDb) {
    const { Client } = require("pg"); // loaded lazily so --csv-only works without deps installed
    copyFrom = require("pg-copy-streams").from;
    client = new Client({ connectionString: args.dsn });
    await client.connect();
    await prepareDatabase(client, ref, args.truncate);
  }

  let csvOut = null;
  if (csvPath) {
    csvOut = fs.createWriteStream(csvPath);
    csvOut.write("store_id,sku,product_name,price,date,country\n");
  }

  let total = 0;
  const t0 = Date.now();
  try {
    for (const chunk of generateChunks(ref, storesPerChunk)) {
      if (csvOut && !csvOut.write(chunk.text)) await once(csvOut, "drain");
      if (useDb) await copyChunk(client, copyFrom, chunk.text); // one COPY (own transaction) per chunk
      total += chunk.rows;
      const rate = total / ((Date.now() - t0) / 1000);
      console.log(`stores ${chunk.firstStore}-${chunk.firstStore + chunk.stores - 1}: ${total.toLocaleString("en-US")} rows (${Math.round(rate).toLocaleString("en-US")} rows/s)`);
    }
    if (csvOut) { csvOut.end(); await once(csvOut, "finish"); }
    if (useDb) await finalizeDatabase(client);
  } finally {
    if (client) await client.end();
  }
  console.log(`Done: ${total.toLocaleString("en-US")} rows in ${Math.round((Date.now() - t0) / 1000)}s`);
}

main().catch((err) => { console.error(err.message || err); process.exit(1); });