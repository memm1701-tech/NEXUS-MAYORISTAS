const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

// Configuración de la Base de Datos
const dbPath = path.join(app.getPath('userData'), 'sistema_mayorista.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) console.error('Error al abrir DB:', err.message);
    else console.log('Conectado a SQLite en:', dbPath);
});

db.serialize(() => {
    // 1. Vehículos y Maestros (Mantenemos igual)
    db.run(`CREATE TABLE IF NOT EXISTS vehiculos (
        id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT NOT NULL, fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS maestro_unidades (
        id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT NOT NULL UNIQUE
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS maestro_subtipos (
        id INTEGER PRIMARY KEY AUTOINCREMENT, unidad_id INTEGER, nombre TEXT NOT NULL,
        FOREIGN KEY(unidad_id) REFERENCES maestro_unidades(id) ON DELETE CASCADE
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS clientes (
        id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT NOT NULL, fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // --- NUEVA ESTRUCTURA: CABECERA Y DETALLE ---

    // 2. CABECERA: vehiculo_cargas (El Manifiesto de la carga)
    db.run(`CREATE TABLE IF NOT EXISTS vehiculo_cargas (
        id_carga INTEGER PRIMARY KEY AUTOINCREMENT,
        vehiculo_id INTEGER,
        fecha_entrada DATETIME DEFAULT CURRENT_TIMESTAMP,
        datos_json TEXT NOT NULL, -- Aquí guardaremos TODO el array de la carga en formato JSON
        estado TEXT DEFAULT 'ACTIVA', -- Para saber si la carga está abierta o fue cerrada
        FOREIGN KEY(vehiculo_id) REFERENCES vehiculos(id) ON DELETE CASCADE
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS ventas_cargas (
        id_detalle INTEGER PRIMARY KEY AUTOINCREMENT,
        fila_id TEXT NOT NULL,
        id_carga INTEGER NOT NULL,
        vehiculo_id INTEGER,
        fecha_entrada DATETIME, 
        cliente TEXT,
        tipo_medida TEXT, 
        sub_medida TEXT, 
        precio TEXT,
        cantidad TEXT,
        metodo_pago TEXT,
        banco TEXT,
        pago_divisa REAL DEFAULT 0,
        pago_movil REAL DEFAULT 0,
        banco_receptor TEXT,
        estado_zinc INTEGER DEFAULT 0,
        pagado REAL DEFAULT 0,
        UNIQUE(id_carga, fila_id), 
        FOREIGN KEY(id_carga) REFERENCES vehiculo_cargas(id_carga) ON DELETE CASCADE
    )`);

    // 4. HISTORIAL CERRADO: cargas_cerradas
    db.run(`CREATE TABLE IF NOT EXISTS cargas_cerradas (
        id_cierre INTEGER PRIMARY KEY AUTOINCREMENT,
        id_carga INTEGER,
        vehiculo_id INTEGER,
        fecha_entrada DATETIME,
        fecha_cierre DATETIME DEFAULT CURRENT_TIMESTAMP,
        mercancia_json TEXT, -- Resumen final de mercancía
        mermas_json TEXT, -- NUEVO: Resumen final de mermas
        total_venta REAL,
        total_credito REAL,
        total_contado REAL,
        valor_promedio_producto REAL
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS mermas_cargas (
        merma_id INTEGER PRIMARY KEY AUTOINCREMENT,
        id_carga INTEGER NOT NULL,
        vehiculo_id INTEGER,
        fecha_registro DATETIME DEFAULT CURRENT_TIMESTAMP,
        tipo_medida TEXT,
        sub_medida TEXT,
        cantidad INTEGER,
        estado_logico INTEGER DEFAULT 1 -- 1 Activo, 0 Eliminado lógicamente
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS abonos_deudas (
        id_abono INTEGER PRIMARY KEY AUTOINCREMENT,
        id_carga INTEGER NOT NULL,
        vehiculo_id INTEGER,
        cliente TEXT NOT NULL,
        monto_divisa REAL DEFAULT 0,
        monto_movil REAL DEFAULT 0,
        banco TEXT,
        fecha_abono DATETIME DEFAULT CURRENT_TIMESTAMP,
        estado_logico INTEGER DEFAULT 1, -- 1 Activo, 0 Revertido/Eliminado
        FOREIGN KEY(id_carga) REFERENCES vehiculo_cargas(id_carga) ON DELETE CASCADE
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS reversos_deudas (
        id_reverso INTEGER PRIMARY KEY AUTOINCREMENT,
        id_carga INTEGER NOT NULL,
        vehiculo_id INTEGER,
        cliente TEXT NOT NULL,
        monto_divisa REAL DEFAULT 0,
        monto_movil REAL DEFAULT 0,
        banco TEXT,
        fecha_reverso DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);


});

async function recalcularPagosCliente(id_carga, cliente) {
    return new Promise((resolve) => {
        // 1. Obtener la suma histórica total de todos los abonos de este cliente
        db.get(`SELECT COALESCE(SUM(monto_divisa + monto_movil), 0) as total_abonos 
                FROM abonos_deudas 
                WHERE id_carga = ? AND cliente = ?`, 
        [id_carga, cliente], (err, rowAbono) => {
            
            let totalAbonos = rowAbono ? rowAbono.total_abonos : 0;

            // 2. Obtener la suma histórica total de todos los reversos de este cliente
            db.get(`SELECT COALESCE(SUM(monto_divisa + monto_movil), 0) as total_reversos 
                    FROM reversos_deudas 
                    WHERE id_carga = ? AND cliente = ?`,
            [id_carga, cliente], (errRev, rowReverso) => {
                
                let totalReversos = rowReverso ? rowReverso.total_reversos : 0;
                
                // El saldo neto real disponible es la resta pura de ambas tablas inmutables
                let abonoDisponible = totalAbonos - totalReversos;

                // 3. Traer todas las líneas de crédito del cliente ordenadas por ID
                db.all(`SELECT id_detalle, precio, cantidad 
                        FROM ventas_cargas 
                        WHERE id_carga = ? AND cliente = ? AND metodo_pago = 'CRÉDITO' 
                        ORDER BY id_detalle ASC`, 
                [id_carga, cliente], (errLineas, lineas) => {
                    if (errLineas || !lineas) return resolve();

                    let queries = [];

                    // 4. Iteramos las líneas de venta y distribuimos el saldo neto disponible
                    for (let linea of lineas) {
                        let total_linea = parseFloat(linea.precio.replace('$', '').trim()) * parseInt(linea.cantidad);
                        let pagado_en_linea = 0;
                        let estado_zinc = 0;

                        if (abonoDisponible >= total_linea) {
                            pagado_en_linea = total_linea;
                            estado_zinc = 1;
                            abonoDisponible -= total_linea;
                        } else if (abonoDisponible > 0) {
                            pagado_en_linea = abonoDisponible;
                            estado_zinc = 0;
                            abonoDisponible = 0;
                        } else {
                            pagado_en_linea = 0;
                            estado_zinc = 0;
                        }

                        queries.push(new Promise((resUpdate) => {
                            db.run(`UPDATE ventas_cargas 
                                    SET pagado = ?, estado_zinc = ? 
                                    WHERE id_detalle = ?`, 
                            [pagado_en_linea, estado_zinc, linea.id_detalle], resUpdate);
                        }));
                    }

                    // Esperamos que terminen de actualizarse todas las filas de ventas_cargas
                    Promise.all(queries).then(() => resolve());
                });
            });
        });
    });
}

ipcMain.on('guardar-abono-deuda', async (event, data) => {
    db.run(`INSERT INTO abonos_deudas (id_carga, vehiculo_id, cliente, monto_divisa, monto_movil, banco) VALUES (?, ?, ?, ?, ?, ?)`,
    [data.id_carga, data.vehiculo_id, data.cliente, data.monto_divisa, data.monto_movil, data.banco], async function(err) {
        if (!err) {
            // Re-distribuimos los pagos tras añadir el abono
            await recalcularPagosCliente(data.id_carga, data.cliente);
        }
        event.reply('guardar-abono-resultado', { success: !err, msg: err ? err.message : '' });
    });
});

ipcMain.on('eliminar-abono', (event, data) => {
    const id_abono = (data && typeof data === 'object') ? data.id_abono : data;
    const montoParcial = (data && typeof data === 'object') ? data.monto : null;

    db.get(`SELECT id_carga, cliente, vehiculo_id, monto_divisa, monto_movil, banco FROM abonos_deudas WHERE id_abono = ?`, [id_abono], (err, row) => {
        if (row) {
            let revDivisa = 0;
            let revMovil = 0;

            if (montoParcial && montoParcial > 0) {
                // REVERSIÓN PARCIAL
                let saldoARevertir = parseFloat(montoParcial);
                if (row.monto_divisa >= saldoARevertir) {
                    revDivisa = saldoARevertir;
                } else {
                    revDivisa = row.monto_divisa;
                    revMovil = saldoARevertir - revDivisa;
                }
            } else {
                // REVERSIÓN COMPLETA
                revDivisa = row.monto_divisa;
                revMovil = row.monto_movil;
            }

            // ESCUDO DE INMUTABILIDAD: Insertamos el reverso en su propia tabla log. 
            // NO SE EJECUTA NINGÚN UPDATE NI BORRADO SOBRE LA TABLA 'abonos_deudas'.
            db.run(`INSERT INTO reversos_deudas (id_carga, vehiculo_id, cliente, monto_divisa, monto_movil, banco) VALUES (?, ?, ?, ?, ?, ?)`,
            [row.id_carga, row.vehiculo_id, row.cliente, revDivisa, revMovil, row.banco], async (errLog) => {
                if (!errLog) {
                    // El algoritmo distribuye el nuevo saldo recalculando la cascada desde cero
                    await recalcularPagosCliente(row.id_carga, row.cliente);
                }
                event.reply('eliminar-abono-resultado', { success: !errLog });
            });
        } else {
            event.reply('eliminar-abono-resultado', { success: false });
        }
    });
});

ipcMain.handle('obtener-abonos-carga', async (event, id_carga) => {
    return new Promise((resolve) => {
        // Se seleccionan todos los abonos históricos sin exclusión (ya no se usa estado_logico = 1)
        const query = `
            SELECT id_abono AS id_registro, id_carga, vehiculo_id, cliente, monto_divisa, monto_movil, banco, fecha_abono AS fecha_registro, 'ABONO' AS tipo 
            FROM abonos_deudas 
            WHERE id_carga = ?
            UNION ALL
            SELECT id_reverso AS id_registro, id_carga, vehiculo_id, cliente, monto_divisa, monto_movil, banco, fecha_reverso AS fecha_registro, 'REVERSO' AS tipo 
            FROM reversos_deudas 
            WHERE id_carga = ?
            ORDER BY fecha_registro DESC
        `;
        db.all(query, [id_carga, id_carga], (err, rows) => {
            if (err) console.error("Error al cruzar auditoría unificada:", err.message);
            resolve(rows || []);
        });
    });
});

ipcMain.handle('obtener-resumen-deudas', async () => {
    return new Promise((resolve) => {
        const query = `
            SELECT 
                v.id_carga,
                v.vehiculo_id,
                COALESCE(vh.nombre, 'SISTEMA - SALDOS ANTERIORES') AS vehiculo_nombre,
                COALESCE(vc.fecha_entrada, v.fecha_entrada) AS fecha_entrada,
                cc.fecha_cierre,
                SUM((CAST(REPLACE(v.precio, '$', '') AS REAL) * CAST(v.cantidad AS INTEGER)) - v.pagado) AS total_deuda,
                GROUP_CONCAT(DISTINCT CASE WHEN v.estado_zinc = 0 THEN v.cliente END) AS clientes_deudores
            FROM ventas_cargas v
            LEFT JOIN vehiculo_cargas vc ON v.id_carga = vc.id_carga
            LEFT JOIN vehiculos vh ON v.vehiculo_id = vh.id
            LEFT JOIN cargas_cerradas cc ON v.id_carga = cc.id_carga
            WHERE v.metodo_pago = 'CRÉDITO'
            GROUP BY v.id_carga, v.vehiculo_id, vehiculo_nombre, COALESCE(vc.fecha_entrada, v.fecha_entrada), cc.fecha_cierre
            HAVING total_deuda > 0.01
            ORDER BY v.id_carga DESC
        `;
        
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

ipcMain.handle('obtener-detalle-deudores-carga', async (event, id_carga) => {
    return new Promise((resolve) => {
        const query = `
            SELECT cliente, tipo_medida, sub_medida, cantidad, precio
            FROM ventas_cargas
            WHERE id_carga = ? AND metodo_pago = 'CRÉDITO'
            ORDER BY cliente ASC
        `;
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

ipcMain.on('guardar-merma-carga', (event, data) => {
    db.run(`INSERT INTO mermas_cargas (id_carga, vehiculo_id, tipo_medida, sub_medida, cantidad) VALUES (?, ?, ?, ?, ?)`,
    [data.id_carga, data.vehiculo_id, data.tipo_medida, data.sub_medida, data.cantidad], function(err) {
        event.reply('guardar-merma-resultado', { success: !err, msg: err ? err.message : '' });
    });
});

ipcMain.handle('obtener-mermas-carga', async (event, id_carga) => {
    return new Promise((resolve) => {
        db.all(`SELECT * FROM mermas_cargas WHERE id_carga = ? AND estado_logico = 1 ORDER BY merma_id DESC`, [id_carga], (err, rows) => {
            resolve(rows || []);
        });
    });
});

ipcMain.on('eliminar-merma-carga', (event, merma_id) => {
    // Borrado Lógico: pasamos el estado a 0
    db.run(`UPDATE mermas_cargas SET estado_logico = 0 WHERE merma_id = ?`, [merma_id], (err) => {
        event.reply('eliminar-merma-resultado', { success: !err });
    });
});

ipcMain.handle('obtener-historial-cerradas', async () => {
    return new Promise((resolve) => {
        // Hacemos un LEFT JOIN para traer el nombre del vehículo según su ID
        const query = `
            SELECT c.*, v.nombre AS vehiculo_nombre 
            FROM cargas_cerradas c
            LEFT JOIN vehiculos v ON c.vehiculo_id = v.id
            ORDER BY c.id_cierre DESC
        `;
        db.all(query, [], (err, rows) => {
            if (err) {
                console.error("Error obteniendo historial:", err.message);
                resolve([]);
            } else {
                resolve(rows || []);
            }
        });
    });
});

ipcMain.on('guardar-cliente', (event, nombre) => {
    db.run(`INSERT INTO clientes (nombre) VALUES (?)`, [nombre], function(err) {
        if (err) {
            event.reply('guardar-cliente-resultado', { success: false, msg: err.message });
        } else {
            event.reply('guardar-cliente-resultado', { success: true, id: this.lastID });
        }
    });
});

ipcMain.handle('obtener-clientes', async () => {
    return new Promise((resolve) => {
        db.all(`SELECT * FROM clientes ORDER BY nombre ASC`, [], (err, rows) => {
            resolve(err ? [] : rows);
        });
    });
});


ipcMain.on('guardar-unidad-maestra', (event, nombre) => {
    db.run(`INSERT INTO maestro_unidades (nombre) VALUES (?)`, [nombre], (err) => {
        event.reply('resultado-operacion', { success: !err, msg: err ? "Ya existe o error de DB" : "" });
    });
});

ipcMain.handle('obtener-unidades-maestras', async () => {
    return new Promise((res) => {
        db.all(`SELECT * FROM maestro_unidades ORDER BY nombre ASC`, [], (err, rows) => res(rows || []));
    });
});

ipcMain.on('guardar-subtipo-maestro', (event, data) => {
    db.run(`INSERT INTO maestro_subtipos (unidad_id, nombre) VALUES (?, ?)`, [data.unidad_id, data.nombre], (err) => {
        event.reply('resultado-operacion', { success: !err });
    });
});

ipcMain.handle('obtener-subtipos-maestros', async (event, unidad_id) => {
    return new Promise((res) => {
        db.all(`SELECT * FROM maestro_subtipos WHERE unidad_id = ? ORDER BY nombre ASC`, [unidad_id], (err, rows) => res(rows || []));
    });
});

ipcMain.on('eliminar-unidad-maestra', (event, id) => {
    db.run(`DELETE FROM maestro_unidades WHERE id = ?`, [id], () => event.reply('resultado-operacion', { success: true }));
});

// --- IPC para Vehículos e Inventario ---
ipcMain.on('guardar-vehiculo', (event, nombre) => {
    db.run(`INSERT INTO vehiculos (nombre) VALUES (?)`, [nombre], function(err) {
        if (err) event.reply('guardar-resultado', { success: false, msg: err.message });
        else event.reply('guardar-resultado', { success: true, id: this.lastID });
    });
});

ipcMain.handle('obtener-vehiculos', async () => {
    return new Promise((resolve, reject) => {
        db.all(`SELECT * FROM vehiculos ORDER BY fecha_creacion DESC`, [], (err, rows) => resolve(err ? [] : rows));
    });
});

ipcMain.on('guardar-carga-vehiculo', (event, data) => {
    const { vehiculo_id, datos_json } = data;
    // Se inserta la carga como 'ACTIVA'
    db.run(`INSERT INTO vehiculo_cargas (vehiculo_id, datos_json, estado) VALUES (?, ?, 'ACTIVA')`, 
    [vehiculo_id, JSON.stringify(datos_json)], function(err) {
        if (err) event.reply('guardar-carga-resultado', { success: false, msg: err.message });
        else event.reply('guardar-carga-resultado', { success: true, id_carga: this.lastID });
    });
});

// Obtener la carga ACTIVA actual de un vehículo
ipcMain.handle('obtener-carga-activa', async (event, vehiculo_id) => {
    return new Promise((resolve) => {
        db.get(`SELECT * FROM vehiculo_cargas WHERE vehiculo_id = ? AND estado = 'ACTIVA' ORDER BY id_carga DESC LIMIT 1`, 
        [vehiculo_id], (err, row) => {
            if (row && row.datos_json) row.datos_parseados = JSON.parse(row.datos_json);
            resolve(row || null);
        });
    });
});

ipcMain.on('auto-guardar-venta-carga', (event, data) => {
    const { fila_id, id_carga, vehiculo_id, fecha_entrada, cliente, tipo_medida, sub_medida, precio, cantidad, metodo_pago, banco } = data;
    
    // El INSERT OR REPLACE usa el UNIQUE(id_carga, fila_id) para actualizar si ya existe
    db.run(`INSERT OR REPLACE INTO ventas_cargas 
        (id_detalle, fila_id, id_carga, vehiculo_id, fecha_entrada, cliente, tipo_medida, sub_medida, precio, cantidad, metodo_pago, banco)
        VALUES (
            (SELECT id_detalle FROM ventas_cargas WHERE id_carga = ? AND fila_id = ?),
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )`,
    [id_carga, fila_id, fila_id, id_carga, vehiculo_id, fecha_entrada, cliente, tipo_medida, sub_medida, precio, cantidad, metodo_pago, banco], 
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

ipcMain.handle('obtener-ventas-carga', async (event, id_carga) => {
    return new Promise((resolve) => {
        db.all(`SELECT * FROM ventas_cargas WHERE id_carga = ? ORDER BY fila_id ASC`, [id_carga], (err, rows) => {
            resolve(rows || []);
        });
    });
});

ipcMain.on('eliminar-fila-venta', (event, data) => {
    const { id_carga, fila_id } = data;
    db.run(`DELETE FROM ventas_cargas WHERE id_carga = ? AND fila_id = ?`, [id_carga, fila_id], (err) => {
        event.reply('eliminar-fila-venta-resultado', { success: !err });
    });
});

ipcMain.on('eliminar-carga-vehiculo', (event, carga_id) => {
    db.run(`DELETE FROM vehiculo_cargas WHERE id = ?`, [carga_id], function(err) {
        event.reply('eliminar-carga-resultado', { success: !err });
    });
});

ipcMain.on('eliminar-fila-excel', (event, data) => {
    const { vehiculo_id, fila_id } = data;
    db.run(`DELETE FROM cobros_excel WHERE vehiculo_id = ? AND fila_id = ?`, [vehiculo_id, fila_id], (err) => {
        if (err) {
            console.error("Error al eliminar fila de cobros:", err.message);
            event.reply('eliminar-fila-excel-resultado', { success: false });
        } else {
            event.reply('eliminar-fila-excel-resultado', { success: true });
        }
    });
});

ipcMain.handle('obtener-cobros-excel', async (event, vehiculo_id) => {
    return new Promise((resolve, reject) => {
        db.all(`SELECT * FROM cobros_excel WHERE vehiculo_id = ? ORDER BY fila_id ASC`, [vehiculo_id], (err, rows) => {
            resolve(err ? [] : rows);
        });
    });
});

ipcMain.on('cerrar-carga-vehiculo', (event, data) => {
    const { id_carga, vehiculo_id, fecha_entrada, mercancia_json, mermas_json, total_venta, total_credito, total_contado, valor_promedio_producto } = data;
    
    db.run(`INSERT INTO cargas_cerradas 
        (id_carga, vehiculo_id, fecha_entrada, mercancia_json, mermas_json, total_venta, total_credito, total_contado, valor_promedio_producto) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id_carga, vehiculo_id, fecha_entrada, mercancia_json, mermas_json, total_venta, total_credito, total_contado, valor_promedio_producto], 
        function(err) {
            if (err) {
                event.reply('cerrar-carga-resultado', { success: false, msg: err.message });
                return;
            }
            db.run(`UPDATE vehiculo_cargas SET estado = 'CERRADA' WHERE id_carga = ?`, [id_carga], function(err2) {
                event.reply('cerrar-carga-resultado', { success: !err2, msg: err2 ? err2.message : '' });
            });
        }
    );
});

ipcMain.on('guardar-deuda-antigua-sistema', (event, data) => {
    // Si el front-end no envía tipo_medida, por retrocompatibilidad asume 'DEUDA ANTIGUA'
    const tipoMedida = data.tipo_medida || 'DEUDA ANTIGUA';
    
    const query = `
        INSERT INTO ventas_cargas (
            fila_id, id_carga, vehiculo_id, fecha_entrada, 
            cliente, tipo_medida, sub_medida, precio, cantidad, metodo_pago, banco, pagado, estado_zinc
        ) VALUES (?, 0, 0, ?, ?, ?, ?, ?, 1, 'CRÉDITO', '', 0.0, 0)
    `;
    
    const fila_id = "ANT_" + Date.now(); 
    const precioStr = `${data.monto} $`;

    db.run(query, [fila_id, data.fecha, data.cliente, tipoMedida, data.descripcion, precioStr], function(err) {
        if (err) {
            event.reply('guardar-deuda-antigua-resultado', { success: false, msg: err.message });
        } else {
            event.reply('guardar-deuda-antigua-resultado', { success: true });
        }
    });
});

ipcMain.handle('obtener-cargas-deuda-cliente', async (event, clienteNombre) => {
    return new Promise((resolve) => {
        const query = `
            SELECT 
                v.id_carga,
                v.vehiculo_id,
                COALESCE(vh.nombre, 'SISTEMA - SALDOS ANTERIORES') AS vehiculo_nombre,
                COALESCE(vc.fecha_entrada, v.fecha_entrada) AS fecha_entrada,
                cc.fecha_cierre,
                SUM((CAST(REPLACE(v.precio, '$', '') AS REAL) * CAST(v.cantidad AS INTEGER)) - v.pagado) AS total_deuda_carga
            FROM ventas_cargas v
            LEFT JOIN vehiculo_cargas vc ON v.id_carga = vc.id_carga
            LEFT JOIN vehiculos vh ON v.vehiculo_id = vh.id
            LEFT JOIN cargas_cerradas cc ON v.id_carga = cc.id_carga
            WHERE v.cliente COLLATE NOCASE = ? AND v.metodo_pago = 'CRÉDITO'
            GROUP BY v.id_carga, v.vehiculo_id, vehiculo_nombre, COALESCE(vc.fecha_entrada, v.fecha_entrada), cc.fecha_cierre
            HAVING total_deuda_carga > 0.01
            ORDER BY v.id_carga DESC
        `;
        db.all(query, [clienteNombre.trim()], (err, rows) => {
            if (err) {
                console.error("Error obteniendo cargas del cliente:", err.message);
                resolve([]);
            } else {
                resolve(rows || []);
            }
        });
    });
});

ipcMain.handle('obtener-estado-cuenta-cliente', async (event, clienteNombre) => {
    return new Promise((resolve) => {
        const query = `
            SELECT 
                id_carga,
                fecha_entrada AS fecha,
                'VENTA' AS tipo,
                CASE 
                    WHEN id_carga = 0 THEN 'CARGA #0 - ' || tipo_medida || ' (' || sub_medida || ')'
                    ELSE 'CARGA #' || id_carga || ' - DEUDA ' || tipo_medida || CASE WHEN sub_medida != '' AND sub_medida IS NOT NULL THEN ' ' || sub_medida ELSE '' END || ' x ' || cantidad || ' a precio de ' || precio 
                END AS concepto,
                (CAST(REPLACE(precio, '$', '') AS REAL) * CAST(cantidad AS INTEGER)) AS cargo,
                0 AS abono
            FROM ventas_cargas
            WHERE cliente COLLATE NOCASE = ? AND metodo_pago = 'CRÉDITO' AND (CAST(REPLACE(precio, '$', '') AS REAL) * CAST(cantidad AS INTEGER)) > 0
            
            UNION ALL
            
            SELECT 
                id_carga,
                fecha_abono AS fecha,
                'PAGO' AS tipo,
                'ABONO A LA CARGA #' || id_carga || CASE WHEN banco != '' THEN ' ('||banco||')' ELSE ' (EFECTIVO)' END AS concepto,
                0 AS cargo,
                (monto_divisa + monto_movil) AS abono
            FROM abonos_deudas
            WHERE cliente COLLATE NOCASE = ?
            
            UNION ALL
            
            SELECT 
                id_carga,
                fecha_reverso AS fecha,
                'REVERSO' AS tipo,
                'REVERSO DE PAGO DE LA CARGA #' || id_carga AS concepto,
                (monto_divisa + monto_movil) AS cargo,
                0 AS abono
            FROM reversos_deudas
            WHERE cliente COLLATE NOCASE = ?
            
            ORDER BY fecha ASC
        `;
        db.all(query, [clienteNombre.trim(), clienteNombre.trim(), clienteNombre.trim()], (err, rows) => {
            if (err) {
                console.error("Error al generar Estado de Cuenta:", err.message);
                resolve([]);
            } else {
                resolve(rows || []);
            }
        });
    });
});

ipcMain.handle('obtener-deudores-globales', async () => {
    return new Promise((resolve) => {
        const query = `
            SELECT 
                cliente,
                SUM((CAST(REPLACE(precio, '$', '') AS REAL) * CAST(cantidad AS INTEGER)) - pagado) AS total_deuda
            FROM ventas_cargas
            WHERE metodo_pago = 'CRÉDITO' AND cliente IS NOT NULL AND cliente != ''
            GROUP BY cliente COLLATE NOCASE
            HAVING total_deuda > 0.01
            ORDER BY cliente ASC
        `;
        db.all(query, [], (err, rows) => {
            if (err) console.error("Error obteniendo deudores globales:", err.message);
            resolve(rows || []);
        });
    });
});


ipcMain.handle('obtener-detalle-deuda-cliente-carga', async (event, clienteNombre, id_carga) => {
    return new Promise((resolve) => {
        const query = `
            SELECT 
                tipo_medida,
                sub_medida,
                MAX(fecha_entrada) AS fecha_venta, -- Aquí extraemos la fecha del registro
                SUM(CAST(cantidad AS INTEGER)) AS cantidad_total,
                SUM((CAST(REPLACE(precio, '$', '') AS REAL) * CAST(cantidad AS INTEGER)) - pagado) AS deuda_restante
            FROM ventas_cargas
            WHERE cliente COLLATE NOCASE = ? AND id_carga = ? AND metodo_pago = 'CRÉDITO'
            GROUP BY tipo_medida, sub_medida
            HAVING deuda_restante > 0.01
            ORDER BY tipo_medida ASC
        `;
        db.all(query, [clienteNombre.trim(), id_carga], (err, rows) => {
            if (err) {
                console.error("Error obteniendo detalle de productos del cliente:", err.message);
                resolve([]);
            } else {
                resolve(rows || []);
            }
        });
    });
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

function createWindow() {
    const mainWindow = new BrowserWindow({
        title: 'Sistema de Ventas "Mayorista" - Nexus Company',
        width: 1280,
        height: 720,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    // Deshabilita la visibilidad de la barra de menú nativa (File, Edit, etc.)
    mainWindow.setMenuBarVisibility(false);
    
    // Evita que el menú aparezca accidentalmente si el usuario presiona la tecla ALT
    mainWindow.setAutoHideMenuBar(true);

    mainWindow.loadFile('inicio.html');
}