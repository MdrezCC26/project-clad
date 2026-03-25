-- Part registry for Windows Inventor Worker
-- Tracks created parts and next part number

CREATE TABLE IF NOT EXISTS PartRegistry (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  partNumber INTEGER NOT NULL UNIQUE,
  projectId TEXT,
  jobId TEXT,
  itemId TEXT,
  shapeType TEXT NOT NULL,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'created',
  folderPath TEXT,
  shopifyProductId TEXT,
  shopifyVariantId TEXT
);

CREATE INDEX IF NOT EXISTS idx_part_registry_part_number ON PartRegistry(partNumber);
CREATE INDEX IF NOT EXISTS idx_part_registry_status ON PartRegistry(status);
CREATE INDEX IF NOT EXISTS idx_part_registry_project ON PartRegistry(projectId);

-- Optional: table for jobs pending Inventor processing
CREATE TABLE IF NOT EXISTS PendingJob (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  projectId TEXT NOT NULL,
  jobId TEXT NOT NULL,
  itemId TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);
