const fs = require('fs');
let html = fs.readFileSync('c:\\NEXUS-MAYORISTA\\index.html', 'utf8');

// The block to move starts with "// Inicialización de SuperTokens" and ends before "</script>\n    <style>"
const markerStart = "// Inicialización de SuperTokens";
const startIndex = html.indexOf(markerStart);
if (startIndex !== -1) {
    const endIndex = html.indexOf('</script>', startIndex);
    
    // Extract the block
    let block = html.substring(startIndex, endIndex);
    
    // Remove the block from the original location
    html = html.substring(0, startIndex) + html.substring(endIndex);
    
    // Append the block before </body> inside a new <script> tag
    html = html.replace('</body>', '<script>\\n' + block + '</script>\\n</body>');
    
    fs.writeFileSync('c:\\NEXUS-MAYORISTA\\index.html', html);
    console.log('Fixed script location');
} else {
    console.log('Could not find the injected block.');
}
