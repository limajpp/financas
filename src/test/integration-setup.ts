import "dotenv/config";

import { testDatabaseUrl } from "./database-url";

// Runs in each worker before the test file imports @/lib/db.
process.env.DATABASE_URL = testDatabaseUrl();
