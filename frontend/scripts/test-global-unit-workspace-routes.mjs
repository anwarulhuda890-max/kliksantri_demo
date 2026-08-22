import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "src");
const app = readFileSync(resolve(root, "App.jsx"), "utf8");
const shell = readFileSync(resolve(root, "layouts/AppShell.jsx"), "utf8");
const unitAwarePaths = new Set([...shell.matchAll(/"(\/[^"\n]+)"/g)].map((match) => match[1]));
const pageFiles = new Set(readdirSync(resolve(root, "pages")).filter((file) => file.endsWith(".jsx")));

const missingRoutes = [];
const routePattern = /<Route\s+path="([^"]+)"\s+element=\{([\s\S]*?)\}\s*\/>/g;

for (const match of app.matchAll(routePattern)) {
  const route = match[1];
  const body = match[2];
  if (!route.startsWith("/") || route.startsWith("/platform")) continue;

  const components = [...body.matchAll(/<([A-Z][A-Za-z0-9_]*Page)\b/g)].map((item) => item[1]);
  const pageComponent = components.at(-1);
  const fileName = pageComponent ? `${pageComponent}.jsx` : null;
  if (!fileName || !pageFiles.has(fileName)) continue;

  const source = readFileSync(resolve(root, "pages", fileName), "utf8");
  const pageUsesWorkspace = /useActiveUnit\(/.test(source) && /unit_id|scope:\s*"all"|scope=all/.test(source);
  if (pageUsesWorkspace && !unitAwarePaths.has(route)) {
    missingRoutes.push(route);
  }
}

assert.deepEqual(missingRoutes, [], "Every unit-aware page must render the global UnitWorkspaceSelector");
console.log("PASS global unit workspace routes: every unit-aware page renders selector");
