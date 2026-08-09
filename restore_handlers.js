const fs = require('fs');
const path = require('path');

const mainJsPath = path.join('C:\\NEXUS-MAYORISTA', 'main.js');
let content = fs.readFileSync(mainJsPath, 'utf8');

const handlersToAppend = `
// ==================== RESTAURADOS Y ACTUALIZADOS ====================

ipcMain.handle('obtener-detalle-deudores-carga', async (event, id_carga) => {
    return new Promise((resolve) => {
        const query = \`
            SELECT cliente, tipo_medida, sub_medida, cantidad, precio, pagado
            FROM ventas_cargas 
            WHERE id_carga = ? AND metodo_pago = 'CRÉDITO'
            ORDER BY cliente ASC
        \`;
        db.all(query, [id_carga], (err, rows) => {
            if (err) {
                console.error("Error obteniendo detalle de deudores:", err.message);
                resolve([]);
            } else {
                resolve(rows || []);
            }
        });
    });
});

ipcMain.handle('obtener-detalle-deudores-carga-lista', async (event, id_carga) => {
    return new Promise((resolve) => {
        const query = \`
            SELECT *
            FROM ventas_cargas 
            WHERE id_carga = ? AND metodo_pago = 'CRÉDITO'
            ORDER BY cliente ASC
        \`;
        db.all(query, [id_carga], (err, rows) => {
            resolve(rows || []);
        });
    });
});

ipcMain.handle('obtener-historial-cerradas', async () => {
    return new Promise((resolve) => {
        const query = \`
            SELECT c.*, v.nombre AS vehiculo_nombre 
            FROM cargas_cerradas c
            LEFT JOIN vehiculos v ON c.vehiculo_id = v.id
            ORDER BY c.id_cierre DESC
        \`;
        db.all(query, [], (err, rows) => {
            resolve(rows || []);
        });
    });
});

ipcMain.on('guardar-merma-carga', (event, data) => {
    db.get(\`SELECT valor FROM configuracion_sistema WHERE clave = 'owner_id_empresa'\`, [], (errConfig, rowConfig) => {
        let idEmpresa = rowConfig ? rowConfig.valor : null;
        db.run(\`INSERT INTO mermas_cargas (id_empresa, sync_status, id_carga, vehiculo_id, tipo_medida, sub_medida, cantidad) VALUES (?, 0, ?, ?, ?, ?, ?)\`,
        [idEmpresa, data.id_carga, data.vehiculo_id, data.tipo_medida, data.sub_medida, data.cantidad], function(err) {
            event.reply('guardar-merma-resultado', { success: !err, msg: err ? err.message : '' });
        });
    });
});

ipcMain.handle('obtener-mermas-carga', async (event, id_carga) => {
    return new Promise((resolve) => {
        db.all(\`SELECT * FROM mermas_cargas WHERE id_carga = ? AND estado_logico = 1 ORDER BY merma_id DESC\`, [id_carga], (err, rows) => {
            resolve(rows || []);
        });
    });
});

ipcMain.on('eliminar-merma-carga', (event, merma_id) => {
    db.run(\`UPDATE mermas_cargas SET estado_logico = 0 WHERE merma_id = ?\`, [merma_id], (err) => {
        event.reply('eliminar-merma-resultado', { success: !err });
    });
});

ipcMain.on('guardar-rendicion-carga', (event, data) => {
    db.get(\`SELECT valor FROM configuracion_sistema WHERE clave = 'owner_id_empresa'\`, [], (errConfig, rowConfig) => {
        let idEmpresa = rowConfig ? rowConfig.valor : null;
        db.run(\`INSERT INTO rendiciones_cargas (id_empresa, sync_status, id_carga, vehiculo_id, producto_origen, cantidad_restada, nombre_nuevo_producto, precio_venta_nuevo_producto, cantidad_generada) VALUES (?, 0, ?, ?, ?, ?, ?, ?, ?)\`,
        [idEmpresa, data.id_carga, data.vehiculo_id, data.producto_origen, data.cantidad_restada, data.nombre_nuevo_producto, data.precio_venta_nuevo_producto, data.cantidad_generada], function(err) {
            event.reply('guardar-rendicion-resultado', { success: !err, msg: err ? err.message : '' });
        });
    });
});

ipcMain.handle('obtener-rendiciones-carga', async (event, id_carga) => {
    return new Promise((resolve) => {
        db.all(\`SELECT * FROM rendiciones_cargas WHERE id_carga = ? AND estado_logico = 1 ORDER BY rendicion_id DESC\`, [id_carga], (err, rows) => {
            resolve(rows || []);
        });
    });
});

ipcMain.on('eliminar-rendicion-carga', (event, rendicion_id) => {
    db.run(\`UPDATE rendiciones_cargas SET estado_logico = 0 WHERE rendicion_id = ?\`, [rendicion_id], (err) => {
        event.reply('eliminar-rendicion-resultado', { success: !err });
    });
});

ipcMain.on('guardar-cliente', (event, nombre) => {
    db.get(\`SELECT valor FROM configuracion_sistema WHERE clave = 'owner_id_empresa'\`, [], (errConfig, rowConfig) => {
        let idEmpresa = rowConfig ? rowConfig.valor : null;
        db.run(\`INSERT INTO clientes (id_empresa, sync_status, nombre) VALUES (?, 0, ?)\`, [idEmpresa, nombre], function(err) {
            if (err) {
                event.reply('guardar-cliente-resultado', { success: false, msg: err.message });
            } else {
                event.reply('guardar-cliente-resultado', { success: true, id: this.lastID });
            }
        });
    });
});
`;

content = content + '\n' + handlersToAppend;
fs.writeFileSync(mainJsPath, content);
console.log("Restauración completada con éxito.");
