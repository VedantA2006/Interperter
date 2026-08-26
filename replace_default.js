const fs = require('fs');
const lss = fs.readFileSync('lss_user.txt', 'utf8');
let page = fs.readFileSync('src/app/page.tsx', 'utf8');
page = page.replace(/const DEFAULT_CODE = `[\s\S]*?`;/, 'const DEFAULT_CODE = `\n' + lss.replace(/`/g, '\\`') + '\n`;');
fs.writeFileSync('src/app/page.tsx', page);
