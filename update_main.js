const fs = require('fs');
let code = fs.readFileSync('c:\\NEXUS-MAYORISTA\\main.js', 'utf8');

// 1. Añadir configuracion_sistema a QUERIES_TABLAS
const confSys = `    \`CREATE TABLE IF NOT EXISTS configuracion_sistema (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        clave TEXT UNIQUE NOT NULL,
        valor TEXT
    )\``;

if (!code.includes('configuracion_sistema')) {
    code = code.replace('    `CREATE TABLE IF NOT EXISTS metodos_pago (', confSys + ',\n    `CREATE TABLE IF NOT EXISTS metodos_pago (');
}

// 2. Añadir las dos columnas a todas las tablas (excepto configuracion_sistema)
const tables = ['vehiculos', 'maestro_unidades', 'maestro_subtipos', 'clientes', 'vehiculo_cargas', 'ventas_cargas', 'cargas_cerradas', 'mermas_cargas', 'rendiciones_cargas', 'abonos_deudas', 'reversos_deudas', 'metodos_pago'];

for (const t of tables) {
    const tableRegex = new RegExp('CREATE TABLE IF NOT EXISTS ' + t + ' \\(([\\s\\S]*?)\\)');
    const match = code.match(tableRegex);
    if (match && !match[1].includes('id_empresa')) {
        let inside = match[1];
        
        let newInside = inside;
        if (newInside.includes('FOREIGN KEY')) {
            newInside = newInside.replace('FOREIGN KEY', 'id_empresa TEXT,\n        sync_status INTEGER DEFAULT 0,\n        FOREIGN KEY');
        } else {
            newInside = newInside + ',\n        id_empresa TEXT,\n        sync_status INTEGER DEFAULT 0';
        }
        code = code.replace(inside, newInside);
    }
}

// 3. Añadir handler IPC migrar-adopcion-datos
const ipcHandler = `
ipcMain.handle('migrar-adopcion-datos', async (event, { idEmpresa }) => {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            // 1. Verificar el dueño de la DB local
            db.get("SELECT valor FROM configuracion_sistema WHERE clave = 'owner_id_empresa'", [], (err, row) => {
                if (err) return reject(err);
                
                if (row && row.valor !== idEmpresa) {
                    return resolve({ success: false, message: 'CRUCE_DATOS', owner: row.valor });
                }

                if (!row) {
                    // Si no existe, lo insertamos
                    db.run("INSERT INTO configuracion_sistema (clave, valor) VALUES ('owner_id_empresa', ?)", [idEmpresa]);
                }

                // 2. Actualizar registros huérfanos en todas las tablas
                const tablasDatos = ['vehiculos', 'maestro_unidades', 'maestro_subtipos', 'clientes', 'vehiculo_cargas', 'ventas_cargas', 'cargas_cerradas', 'mermas_cargas', 'rendiciones_cargas', 'abonos_deudas', 'reversos_deudas', 'metodos_pago'];
                
                let pending = tablasDatos.length;
                let hasError = false;

                if (pending === 0) return resolve({ success: true });

                tablasDatos.forEach(t => {
                    db.run(\`UPDATE \${t} SET id_empresa = ? WHERE id_empresa IS NULL\`, [idEmpresa], (err2) => {
                        if (err2) hasError = true;
                        pending--;
                        if (pending === 0) {
                            if (hasError) return resolve({ success: false, message: 'ERROR_UPDATE' });
                            resolve({ success: true });
                        }
                    });
                });
            });
        });
    });
});
`;

if (!code.includes('migrar-adopcion-datos')) {
    code += '\n' + ipcHandler;
}

fs.writeFileSync('c:\\NEXUS-MAYORISTA\\main.js', code);
console.log('main.js update complete');
