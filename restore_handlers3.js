const fs = require('fs');
const path = require('path');

const mainJsPath = path.join('C:\\NEXUS-MAYORISTA', 'main.js');
let content = fs.readFileSync(mainJsPath, 'utf8');

const targetStr = "            FROM ventas_cargas v\nipcMain.on('editar-cliente', (event, data) => {";

const replacementStr = `            FROM ventas_cargas v
            LEFT JOIN vehiculo_cargas vc ON v.id_carga = vc.id_carga
            LEFT JOIN vehiculos vh ON v.vehiculo_id = vh.id
            LEFT JOIN cargas_cerradas cc ON v.id_carga = cc.id_carga
            WHERE v.metodo_pago = 'CRÉDITO'
            GROUP BY v.id_carga, v.vehiculo_id, vehiculo_nombre, COALESCE(vc.fecha_entrada, v.fecha_entrada), cc.fecha_cierre
            HAVING total_deuda > 0.01
            ORDER BY v.id_carga DESC
        \`;
        
        db.all(query, [], (err, rows) => {
            if (err) {
                console.error("Error obteniendo resumen de deudas:", err.message);
                resolve([]);
            } else {
                resolve(rows || []);
            }
        });
    });
});

ipcMain.on('eliminar-cliente', (event, id) => {
    db.run(\`DELETE FROM clientes WHERE id = ?\`, [id], () => event.reply('resultado-operacion', { success: true }));
});

ipcMain.on('editar-cliente', (event, data) => {`;

content = content.replace(targetStr, replacementStr);

const handlersToAppend = `
// ==================== RESTAURADOS Y ACTUALIZADOS PARTE 3 ====================

ipcMain.on('eliminar-abono', (event, data) => {
    const id_abono = (data && typeof data === 'object') ? data.id_abono : data;
    
    // 1. En lugar de borrar físicamente, pasamos la información a reversos_deudas.
    db.get(\`SELECT * FROM abonos_deudas WHERE id_abono = ?\`, [id_abono], (errSel, rowAbono) => {
        if (!rowAbono) {
            event.reply('eliminar-abono-resultado', { success: false, msg: "Abono no encontrado" });
            return;
        }

        db.get(\`SELECT valor FROM configuracion_sistema WHERE clave = 'owner_id_empresa'\`, [], (errConfig, rowConfig) => {
            let idEmpresa = rowConfig ? rowConfig.valor : null;
            
            db.run(\`INSERT INTO reversos_deudas (id_empresa, sync_status, id_carga, vehiculo_id, cliente, monto_divisa, monto_movil, banco) VALUES (?, 0, ?, ?, ?, ?, ?, ?)\`,
                [idEmpresa, rowAbono.id_carga, rowAbono.vehiculo_id, rowAbono.cliente, rowAbono.monto_divisa, rowAbono.monto_movil, rowAbono.banco], function(errInsert) {
                    if (errInsert) {
                        event.reply('eliminar-abono-resultado', { success: false, msg: "Error al registrar reverso." });
                        return;
                    }
                    
                    // 2. Eliminamos (físicamente) el registro de abonos_deudas para la contabilidad actual
                    db.run(\`DELETE FROM abonos_deudas WHERE id_abono = ?\`, [id_abono], async function(errDel) {
                        if (!errDel) {
                            await recalcularPagosCliente(rowAbono.id_carga, rowAbono.cliente);
                        }
                        event.reply('eliminar-abono-resultado', { success: !errDel, msg: errDel ? errDel.message : '' });
                    });
            });
        });
    });
});

ipcMain.handle('obtener-auditoria-unificada', async (event, id_carga) => {
    return new Promise((resolve) => {
        const query = \`
            SELECT id_abono AS id_registro, id_carga, vehiculo_id, cliente, monto_divisa, monto_movil, banco, fecha_abono AS fecha_registro, 'ABONO' AS tipo 
            FROM abonos_deudas 
            WHERE id_carga = ?
            UNION ALL
            SELECT id_reverso AS id_registro, id_carga, vehiculo_id, cliente, monto_divisa, monto_movil, banco, fecha_reverso AS fecha_registro, 'REVERSO' AS tipo 
            FROM reversos_deudas 
            WHERE id_carga = ?
            ORDER BY fecha_registro DESC
        \`;
        db.all(query, [id_carga, id_carga], (err, rows) => {
            if (err) console.error("Error al cruzar auditoría unificada:", err.message);
            resolve(rows || []);
        });
    });
});
`;

content = content + '\n' + handlersToAppend;
fs.writeFileSync(mainJsPath, content);
console.log("Restauración 3 completada con éxito.");
