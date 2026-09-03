const fs = require('fs');
const path = require('path');
const dir = 'prisma/schema';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.prisma'));
const out = files.map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n\n');
fs.writeFileSync('src/prisma/contract.prisma', out);
