const sharp = require('sharp');
const { resolve } = require('node:path');
const root = resolve(__dirname, '..');
(async () => {
  for (const [source, target, size] of [['jay-icon.svg', 'jay-icon.png', 1024], ['jay-foreground.svg', 'jay-foreground.png', 1024], ['jay-icon.svg', 'jay-favicon.png', 64]]) {
    await sharp(resolve(root, 'assets', source)).resize(size, size).png().toFile(resolve(root, 'assets', target));
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
