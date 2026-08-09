const fs = require('fs');
const content = fs.readFileSync('C:\\NEXUS-MAYORISTA\\main.js', 'utf8');

let braceCount = 0;
let parenCount = 0;
let backtickCount = 0;

for (let i = 0; i < content.length; i++) {
    const char = content[i];
    if (char === '{') braceCount++;
    if (char === '}') braceCount--;
    if (char === '(') parenCount++;
    if (char === ')') parenCount--;
    if (char === '\`') backtickCount++;
}

console.log({ braceCount, parenCount, backtickCount, isBacktickEven: backtickCount % 2 === 0 });
