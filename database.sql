CREATE TABLE IF NOT EXISTS import_jobs (
    id UUID PRIMARY KEY,
    file_name VARCHAR(255) NOT NULL,
    user_id TEXT NOT NULL,
    store_id TEXT NOT NULL,
    error TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status VARCHAR(30) NOT NULL DEFAULT 'PENDING',

    CONSTRAINT chk_import_job_status
        CHECK (status IN (
            'PENDING',
            'PROCESSING',
            'COMPLETED',
            'PARTIAL_SUCCESS',
            'FAILED'
        ))
);

CREATE INDEX IF NOT EXISTS idx_import_jobs_user_id
ON import_jobs(user_id);

CREATE INDEX IF NOT EXISTS idx_import_jobs_store_id
ON import_jobs(store_id);

CREATE INDEX IF NOT EXISTS idx_import_jobs_status
ON import_jobs(status);

CREATE INDEX IF NOT EXISTS idx_import_jobs_created_at
ON import_jobs(created_at DESC);



CREATE TABLE IF NOT EXISTS price_feed (
    store_id      VARCHAR(10)   NOT NULL,
    sku           VARCHAR(20)   NOT NULL,
    product_name  VARCHAR(200)  NOT NULL,
    price         NUMERIC(12,2) NOT NULL CHECK (price >= 0),
    price_date    VARCHAR(10)          NOT NULL,
    country       CHAR(2)       NOT NULL
) PARTITION BY RANGE (price_date);

CREATE TABLE IF NOT EXISTS price_feed_default
PARTITION OF price_feed DEFAULT;