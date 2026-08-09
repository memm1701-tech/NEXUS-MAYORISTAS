const fs = require('fs');
let code = fs.readFileSync('main.js', 'utf8');

const replacement = `function inicializarYActualizarBaseDeDatos() {
    db.serialize(() => {
        QUERIES_TABLAS.forEach(query => {
            const tableMatch = query.match(/CREATE TABLE\\s+IF NOT EXISTS\\s+(\\w+)/i);
            if (!tableMatch) return;
            const tableName = tableMatch[1];

            db.run(query, (err) => {
                if (err) {
                    console.error(\`Error creando tabla \${tableName}:\`, err.message);
                }
            });

            const bodyMatch = query.match(/\\(([\\s\\S]*)\\)/);
            if (!bodyMatch) return;
            let body = bodyMatch[1];
            
            body = body.replace(/--.*$/gm, '');
            
            const parts = body.split(/,(?![^\\(]*\\))/);
            
            const expectedColumns = {};
            parts.forEach(part => {
                let def = part.trim();
                let defUpper = def.toUpperCase();
                
                if (defUpper.startsWith('FOREIGN KEY') || 
                    defUpper.startsWith('UNIQUE') || 
                    defUpper.startsWith('PRIMARY KEY') || 
                    defUpper.startsWith('CHECK')) {
                    return; 
                }
                
                const firstSpace = def.indexOf(' ');
                if (firstSpace > -1) {
                    const colName = def.substring(0, firstSpace).trim();
                    const colType = def.substring(firstSpace + 1).trim();
                    expectedColumns[colName] = colType;
                }
            });

            db.all(\`PRAGMA table_info(\${tableName})\`, (err, rows) => {
                if (err) {
                    console.error(\`Error verificando PRAGMA de \${tableName}:\`, err);
                    return;
                }
                const existingCols = rows.map(r => r.name);
                
                for (const [colName, colDef] of Object.entries(expectedColumns)) {
                    if (!existingCols.includes(colName)) {
                        console.log(\`[Auto-Escáner DB] Añadiendo columna faltante: \${tableName}.\${colName}\`);
                        db.run(\`ALTER TABLE \${tableName} ADD COLUMN \${colName} \${colDef}\`, (err) => {
                            if (err) console.error(\`Error agregando columna \${colName} a \${tableName}:\`, err.message);
                            else console.log(\`[Auto-Escáner DB] Columna \${colName} añadida con éxito.\`);
                        });
                    }
                }
            });
        });

        // Tareas post-inicialización (ej. Semillas por defecto)
        db.get("SELECT COUNT(*) as count FROM metodos_pago", (err, row) => {
            if (!err && row.count === 0) {
                db.run("INSERT INTO metodos_pago (nombre) VALUES ('EFECTIVO'), ('PAGO MÓVIL'), ('TRANSFERENCIA'), ('DIVISA')");
            }
        });
    });
}`;

const start = code.indexOf('function inicializarYActualizarBaseDeDatos() {');
const end = code.indexOf('inicializarYActualizarBaseDeDatos();');

if(start !== -1 && end !== -1) {
    code = code.substring(0, start) + replacement + "\n\n" + code.substring(end);
    fs.writeFileSync('main.js', code);
    console.log("Fixed main.js successfully");
} else {
    console.log("Could not find bounds");
}
