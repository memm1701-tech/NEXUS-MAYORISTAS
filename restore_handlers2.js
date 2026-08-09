const fs = require('fs');
const path = require('path');

const mainJsPath = path.join('C:\\NEXUS-MAYORISTA', 'main.js');
let content = fs.readFileSync(mainJsPath, 'utf8');

const handlersToAppend = `
// ==================== RESTAURADOS Y ACTUALIZADOS PARTE 2 ====================

// Obtener la carga ACTIVA actual de un vehículo
ipcMain.handle('obtener-carga-activa', async (event, vehiculo_id) => {
    return new Promise((resolve) => {
        db.get(\`SELECT * FROM vehiculo_cargas WHERE vehiculo_id = ? AND estado = 'ACTIVA' ORDER BY id_carga DESC LIMIT 1\`, 
        [vehiculo_id], (err, row) => {
            if (row && row.datos_json) row.datos_parseados = JSON.parse(row.datos_json);
            resolve(row || null);
        });
    });
});

ipcMain.on('auto-guardar-venta-carga', (event, data) => {
    const { fila_id, id_carga, vehiculo_id, fecha_entrada, cliente, tipo_medida, sub_medida, precio, cantidad, metodo_pago, banco } = data;
    
    db.get(\`SELECT valor FROM configuracion_sistema WHERE clave = 'owner_id_empresa'\`, [], (errConfig, rowConfig) => {
        let idEmpresa = rowConfig ? rowConfig.valor : null;
        
        // El INSERT OR REPLACE usa el UNIQUE(id_carga, fila_id) para actualizar si ya existe
        db.run(\`INSERT OR REPLACE INTO ventas_cargas 
            (id_empresa, sync_status, id_detalle, fila_id, id_carga, vehiculo_id, fecha_entrada, cliente, tipo_medida, sub_medida, precio, cantidad, metodo_pago, banco)
            VALUES (
                ?, 0,
                (SELECT id_detalle FROM ventas_cargas WHERE id_carga = ? AND fila_id = ?),
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
            )\`,
        [idEmpresa, id_carga, fila_id, fila_id, id_carga, vehiculo_id, fecha_entrada, cliente, tipo_medida, sub_medida, precio, cantidad, metodo_pago, banco], 
        async (err) => {
            if (err) {
                console.error("Error en autoguardado de venta:", err.message);
            } else if (cliente) {
                // EL GATILLO: Si editas la celda de un cliente que ya tiene abonos,
                // el sistema re-calcula la cascada para que su dinero arrope la nueva modificación.
                await recalcularPagosCliente(id_carga, cliente);
            }
        });
    });
});

ipcMain.handle('obtener-ventas-carga', async (event, id_carga) => {
    return new Promise((resolve) => {
        db.all(\`SELECT * FROM ventas_cargas WHERE id_carga = ? ORDER BY fila_id ASC\`, [id_carga], (err, rows) => {
            resolve(rows || []);
        });
    });
});
`;

content = content + '\n' + handlersToAppend;
fs.writeFileSync(mainJsPath, content);
console.log("Restauración 2 completada con éxito.");
