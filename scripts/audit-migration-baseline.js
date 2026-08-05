const pool = require("../db");
const { auditMigrations } = require("../utils/migrationBaselineAudit");

auditMigrations(pool)
  .then((results) => console.log(JSON.stringify(results, null, 2)))
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
