const fs = require('fs');
let content = fs.readFileSync('c:\\NEXUS-MAYORISTA\\index.html', 'utf8');
content = content.split('\\n').join('\n'); // Split by literal \n and join by actual newline
fs.writeFileSync('c:\\NEXUS-MAYORISTA\\index.html', content);
console.log('Fixed \\n literals');
