const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const routes = read("routes/unitRoutes.js");
const context = read("frontend/src/context/ActiveUnitContext.jsx");
const dashboard = read("frontend/src/pages/DashboardPage.jsx");
const santri = read("frontend/src/pages/SantriPage.jsx");

assert.match(routes, /router\.get\("\/", async \(req, res\) =>/,
  "GET /units bootstrap must not require the unit.view admin permission");
assert.match(routes, /router\.get\("\/:unitId\/features", async \(req, res\) =>/,
  "unit feature bootstrap must use canonical unit access instead of unit.view");
assert.match(routes, /getAllowedUnitIds\(req\.user, req\.tenantId\)/,
  "GET /units must use canonical user_unit_scope access");
assert.match(routes, /UNIT_SCOPE_UNASSIGNED/,
  "an authenticated operator without unit scope must fail closed");
assert.match(routes, /assertUnitAccess\(req\.user, req\.params\.unitId, req\.tenantId\)/,
  "unit feature bootstrap must remain scope checked");

assert.match(context, /nextUnits\.length === 1[\s\S]*setActiveUnitIdState\(Number\(nextUnits\[0\]\.id\)\)/,
  "single-unit operator must initialize its assigned unit");
assert.match(context, /localStorage\.getItem\(tenantKey\)/,
  "active unit must survive dashboard refresh");
assert.match(dashboard, /activeUnitId \? \{ unit_id: activeUnitId \} : \{ scope: "all" \}/,
  "dashboard request must explicitly carry unit scope or superadmin all scope");
assert.match(dashboard, /dashboardReady && role/,
  "dashboard KPI must render only after a successful scoped request");
assert.match(dashboard, /Dashboard tidak tersedia\./,
  "failed workspace bootstrap must render a controlled unavailable state");
assert.match(santri, /params: activeUnitId \? \{ unit_id: activeUnitId \}/,
  "santri list must inherit the active unit");

console.log("PASS unit workspace bootstrap recovery wiring");
