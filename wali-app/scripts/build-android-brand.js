const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { PNG } = require('pngjs');
const { resolveBuildBrand, assertFirebasePackage } = require('../config/buildBrand');

function args(argv) {
  const result = {};
  for (const item of argv) {
    const match = item.match(/^--([^=]+)=(.*)$/);
    if (match) result[match[1]] = match[2]; else if (item.startsWith('--')) result[item.slice(2)] = true;
  }
  return result;
}

const FONT = {
  A:['01110','10001','10001','11111','10001','10001','10001'],B:['11110','10001','10001','11110','10001','10001','11110'],D:['11110','10001','10001','10001','10001','10001','11110'],E:['11111','10000','10000','11110','10000','10000','11111'],I:['11111','00100','00100','00100','00100','00100','11111'],K:['10001','10010','10100','11000','10100','10010','10001'],L:['10000','10000','10000','10000','10000','10000','11111'],N:['10001','11001','10101','10011','10001','10001','10001'],O:['01110','10001','10001','10001','10001','10001','01110'],P:['11110','10001','10001','11110','10000','10000','10000'],R:['11110','10001','10001','11110','10100','10010','10001'],S:['01111','10000','10000','01110','00001','00001','11110'],T:['11111','00100','00100','00100','00100','00100','00100'],W:['10001','10001','10001','10101','10101','10101','01010'],Y:['10001','10001','01010','00100','00100','00100','00100'],' ':['000','000','000','000','000','000','000']
};

function setPixel(png, x, y, rgba) {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
  const index = (png.width * y + x) << 2;
  rgba.forEach((value, offset) => { png.data[index + offset] = value; });
}

function composeSplash(sourcePath, outputPath) {
  const source = PNG.sync.read(fs.readFileSync(sourcePath));
  const output = new PNG({ width: 800, height: 520, colorType: 6 });
  output.data.fill(0);
  const scale = Math.min(300 / source.width, 300 / source.height);
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const left = Math.round((output.width - width) / 2);
  const top = 45;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const sx = Math.min(source.width - 1, Math.floor(x / scale));
    const sy = Math.min(source.height - 1, Math.floor(y / scale));
    const sourceIndex = (source.width * sy + sx) << 2;
    setPixel(output, left + x, top + y, [...source.data.subarray(sourceIndex, sourceIndex + 4)]);
  }
  const text = 'POWERED BY KLIKPESANTREN';
  const pixelScale = 4;
  const widths = [...text].map((char) => (FONT[char]?.[0].length || 5) + 1);
  const totalWidth = widths.reduce((sum, value) => sum + value, -1) * pixelScale;
  let cursor = Math.round((output.width - totalWidth) / 2);
  for (const char of text) {
    const glyph = FONT[char] || FONT[' '];
    glyph.forEach((row, gy) => [...row].forEach((on, gx) => {
      if (on !== '1') return;
      for (let py = 0; py < pixelScale; py += 1) for (let px = 0; px < pixelScale; px += 1) setPixel(output, cursor + gx * pixelScale + px, 430 + gy * pixelScale + py, [71,85,105,255]);
    }));
    cursor += (glyph[0].length + 1) * pixelScale;
  }
  fs.writeFileSync(outputPath, PNG.sync.write(output));
}

const options = args(process.argv.slice(2));
const appRoot = path.resolve(__dirname, '..');
const env = { ...process.env, BUILD_BRAND: options.brand || 'universal' };
if (options['profile-file']) env.BUILD_BRAND_PROFILE = options['profile-file'];
const brand = resolveBuildBrand(env, appRoot);
const requestedFirebasePath = options.firebase || env.GOOGLE_SERVICES_JSON;
if (!options['config-only']) assertFirebasePackage(requestedFirebasePath, brand.package_id);
const generatedFiles = [];
function materialize(value, kind) {
  if (!/^https:\/\//i.test(value || '')) return value;
  const target = path.join(appRoot, 'assets', `build-${brand.brand_key}-${kind}.png`);
  const download = spawnSync('curl.exe', ['-fL', value, '-o', target], { stdio: 'inherit', shell: false });
  if (download.status !== 0) throw new Error(`Gagal mengunduh asset ${kind}`);
  generatedFiles.push(target);
  return `./assets/${path.basename(target)}`;
}
brand.logo = materialize(brand.logo, 'logo');
brand.icon = materialize(brand.icon, 'icon');
brand.splash_logo = materialize(brand.splash_logo, 'splash-source');
const splashPath = path.join(appRoot, 'assets', `build-splash-${brand.brand_key}.png`);
composeSplash(path.resolve(appRoot, brand.splash_logo), splashPath);
generatedFiles.push(splashPath);
env.BRAND_SPLASH_ASSET = `./assets/${path.basename(splashPath)}`;
env.EXPO_PUBLIC_API_BASE_URL ||= 'https://api.klikpesantren.com';

let command;
let commandArgs;
if (options['config-only']) {
  command = process.execPath; commandArgs = [path.join(appRoot, 'node_modules', 'expo', 'bin', 'cli'), 'config', '--type', 'public', '--json'];
} else {
  env.BRAND_BUILD_STRICT = '1';
  const firebaseBuildPath = path.join(appRoot, 'google-services.build.json');
  fs.copyFileSync(path.resolve(requestedFirebasePath), firebaseBuildPath);
  generatedFiles.push(firebaseBuildPath);
  brand.google_services_file = './google-services.build.json';
  const easProfile = options.profile || 'preview';
  if (!['preview', 'production'].includes(easProfile)) throw new Error('EAS profile harus preview atau production');
  command = process.platform === 'win32' ? 'npx.cmd' : 'npx'; commandArgs = ['eas', 'build', '--platform', 'android', '--profile', easProfile];
  if (options.local) commandArgs.push('--local');
}
brand.splash_logo = `./assets/${path.basename(splashPath)}`;
const markerPath = path.join(appRoot, 'build-brand.resolved.json');
fs.writeFileSync(markerPath, JSON.stringify(brand, null, 2));
generatedFiles.push(markerPath);
env.BUILD_BRAND_PROFILE = './build-brand.resolved.json';
const run = spawnSync(command, commandArgs, { cwd: appRoot, env, stdio: 'inherit', shell: process.platform === 'win32' && command === 'npx.cmd' });
for (const file of generatedFiles) { try { fs.unlinkSync(file); } catch {} }
if (run.error) throw run.error;
process.exitCode = run.status || 0;
