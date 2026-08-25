import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dashboardPage = readFileSync(resolve(root, "src/pages/DashboardPage.jsx"), "utf8");
const dashboardMetrics = readFileSync(resolve(root, "src/components/dashboard/DashboardMetrics.jsx"), "utf8");
const dashboardHero = readFileSync(resolve(root, "src/components/dashboard/DashboardHero.jsx"), "utf8");
const activeUnitContext = readFileSync(resolve(root, "src/context/ActiveUnitContext.jsx"), "utf8");
const unitWorkspaceSelector = readFileSync(resolve(root, "src/components/UnitWorkspaceSelector.jsx"), "utf8");

assert.match(dashboardPage, /useActiveUnit\(\)/, "DashboardPage must read ActiveUnit context");
assert.match(dashboardPage, /api\.get\("\/dashboard\/summary", \{ params, signal: controller\.signal \}\)/, "Specific-unit Dashboard summary request must keep scoped params");
assert.match(dashboardPage, /api\.get\("\/dashboard\/all-units-v1", \{ params, signal: controller\.signal \}\)/, "All-unit Dashboard must use dedicated V1 aggregate endpoint");
assert.match(dashboardPage, /activeUnitId,\s*allUnitsAllowed/, "Dashboard effect must depend on workspace changes");
assert.match(dashboardPage, /!\s*isUnitWorkspace\s*\?/, "Legacy tenant-wide panels must be hidden for unit workspace");
assert.match(dashboardPage, /error:\s*unitError/, "Dashboard must read ActiveUnit bootstrap errors");
assert.match(dashboardPage, /dashboardScopeReady\s*=.*!unitLoading.*!unitError.*allUnitsAllowed.*isUnitWorkspace/s, "Dashboard must require a resolved unit scope before fetching");
assert.match(dashboardPage, /if \(!activeUnitId && !allUnitsAllowed\)/, "Dashboard must not request tenant-wide data for scoped users without an active unit");
assert.doesNotMatch(dashboardPage, /allUnitsAllowed \? \{ scope: "all" \} : \{\}/, "Dashboard must not send an unscoped summary request fallback");
assert.match(dashboardPage, /setSummary\(createEmptySummary\(\)\)/, "Dashboard must clear stale KPI data when scope changes or fails");
assert.match(dashboardPage, /dashboardScopeReady && !summaryError/, "Dashboard metrics must be gated behind a valid workspace scope");
assert.match(dashboardMetrics, /Santri Unit Aktif/, "Unit workspace must label santri KPI as unit-scoped");
assert.match(dashboardMetrics, /Kelas Unit/, "Unit workspace must show unit-scoped class KPI");
assert.match(dashboardMetrics, /Total Kelas/, "All-unit workspace must show aggregate class KPI");
assert.match(dashboardHero, /Dashboard Unit/, "Hero must show active unit context");
assert.match(dashboardHero, /Dashboard belum siap/, "Hero must not present blocked scoped users as all-unit dashboard");
assert.match(activeUnitContext, /if \(allowAll\)/, "ActiveUnitContext must keep all-unit mode exclusive to all-unit users");
assert.match(activeUnitContext, /const scopedUnit = storedUnit \|\| nextActiveUnits\[0\]/, "Single-unit or scoped operators must auto-lock to an assigned unit");
assert.match(activeUnitContext, /localStorage\.setItem\(tenantKey, String\(scopedUnit\.id\)\)/, "Scoped operator active unit must replace persisted all/invalid values");
assert.match(activeUnitContext, /if \(normalized == null && !allUnitsAllowed\)/, "Scoped users must not be allowed to select all units");
assert.match(activeUnitContext, /catch \(requestError\)[\s\S]*setActiveUnitIdState\(null\);[\s\S]*setError/, "Bootstrap errors must clear active unit instead of leaving stale all-unit state");
assert.match(unitWorkspaceSelector, /value=\{activeUnitId \?\? \(allUnitsAllowed \? "all" : ""\)\}/, "Selector must not visually fallback to all for scoped operators");
assert.match(unitWorkspaceSelector, /disabled=\{!allUnitsAllowed && activeUnits\.length <= 1\}/, "Single-unit operators must be locked to their assigned unit");

console.log("PASS dashboard frontend unit wiring: scoped request, switching, locked operators, and fail-closed UX assertions");
