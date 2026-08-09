const fs = require('fs');
const path = require('path');

const mainJsPath = path.join('C:\\NEXUS-MAYORISTA', 'main.js');
let content = fs.readFileSync(mainJsPath, 'utf8');

// Buscamos el inicio del query roto
const targetRegex = /            FROM ventas_cargas v\s*ipcMain\.on\('editar-cliente', \(event, data\) => \{/;

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

if (targetRegex.test(content)) {
    content = content.replace(targetRegex, replacementStr);
    fs.writeFileSync(mainJsPath, content);
    console.log("Restauración 4 completada con éxito.");
} else {
    console.log("No se encontró el patrón.");
}
