const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

// Configuración de la Base de Datos
const dbPath = path.join(app.getPath('userData'), 'sistema_mayorista.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) console.error('Error al abrir DB:', err.message);
    else console.log('Conectado a SQLite en:', dbPath);
});

const QUERIES_TABLAS = [
    `CREATE TABLE IF NOT EXISTS vehiculos (
        id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT NOT NULL, fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
        id_empresa TEXT,
        sync_status INTEGER DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS maestro_unidades (
        id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT NOT NULL UNIQUE,
        id_empresa TEXT,
        sync_status INTEGER DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS maestro_subtipos (
        id INTEGER PRIMARY KEY AUTOINCREMENT, unidad_id INTEGER, nombre TEXT NOT NULL,
        id_empresa TEXT,
        sync_status INTEGER DEFAULT 0,
        FOREIGN KEY(unidad_id) REFERENCES maestro_unidades(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS clientes (
        id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT NOT NULL, fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
        id_empresa TEXT,
        sync_status INTEGER DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS vehiculo_cargas (
        id_carga INTEGER PRIMARY KEY AUTOINCREMENT,
        vehiculo_id INTEGER,
        fecha_entrada DATETIME DEFAULT CURRENT_TIMESTAMP,
        datos_json TEXT NOT NULL, -- Aquí guardaremos TODO el array de la carga en formato JSON
        estado TEXT DEFAULT 'ACTIVA', -- Para saber si la carga está abierta o fue cerrada
        id_empresa TEXT,
        sync_status INTEGER DEFAULT 0,
        FOREIGN KEY(vehiculo_id) REFERENCES vehiculos(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS ventas_cargas (
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
        id_empresa TEXT,
        sync_status INTEGER DEFAULT 0,
        UNIQUE(id_carga, fila_id), 
        FOREIGN KEY(id_carga) REFERENCES vehiculo_cargas(id_carga) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS cargas_cerradas (
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
    ,
        id_empresa TEXT,
        sync_status INTEGER DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS mermas_cargas (
        merma_id INTEGER PRIMARY KEY AUTOINCREMENT,
        id_carga INTEGER NOT NULL,
        vehiculo_id INTEGER,
        fecha_registro DATETIME DEFAULT CURRENT_TIMESTAMP,
        tipo_medida TEXT,
        sub_medida TEXT,
        cantidad INTEGER,
        estado_logico INTEGER DEFAULT 1 -- 1 Activo, 0 Eliminado lógicamente
    ,
        id_empresa TEXT,
        sync_status INTEGER DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS rendiciones_cargas (
        rendicion_id INTEGER PRIMARY KEY AUTOINCREMENT,
        id_carga INTEGER NOT NULL,
        vehiculo_id INTEGER,
        fecha_registro DATETIME DEFAULT CURRENT_TIMESTAMP,
        producto_origen TEXT,
        cantidad_restada INTEGER,
        nombre_nuevo_producto TEXT,
        precio_venta_nuevo_producto REAL,
        cantidad_generada INTEGER,
        estado_logico INTEGER DEFAULT 1
    ,
        id_empresa TEXT,
        sync_status INTEGER DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS abonos_deudas (
        id_abono INTEGER PRIMARY KEY AUTOINCREMENT,
        id_carga INTEGER NOT NULL,
        vehiculo_id INTEGER,
        cliente TEXT NOT NULL,
        monto_divisa REAL DEFAULT 0,
        monto_movil REAL DEFAULT 0,
        banco TEXT,
        fecha_abono DATETIME DEFAULT CURRENT_TIMESTAMP,
        estado_logico INTEGER DEFAULT 1, -- 1 Activo, 0 Revertido/Eliminado
        id_empresa TEXT,
        sync_status INTEGER DEFAULT 0,
        FOREIGN KEY(id_carga) REFERENCES vehiculo_cargas(id_carga) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS reversos_deudas (
        id_reverso INTEGER PRIMARY KEY AUTOINCREMENT,
        id_carga INTEGER NOT NULL,
        vehiculo_id INTEGER,
        cliente TEXT NOT NULL,
        monto_divisa REAL DEFAULT 0,
        monto_movil REAL DEFAULT 0,
        banco TEXT,
        fecha_reverso DATETIME DEFAULT CURRENT_TIMESTAMP
    ,
        id_empresa TEXT,
        sync_status INTEGER DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS configuracion_sistema (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        clave TEXT UNIQUE NOT NULL,
        valor TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS metodos_pago (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT UNIQUE NOT NULL,
        estado INTEGER DEFAULT 1
    ,
        id_empresa TEXT,
        sync_status INTEGER DEFAULT 0)`
];

function inicializarYActualizarBaseDeDatos() {
    db.serialize(() => {
        QUERIES_TABLAS.forEach(query => {
            const tableMatch = query.match(/CREATE TABLE\s+IF NOT EXISTS\s+(\w+)/i);
            if (!tableMatch) return;
            const tableName = tableMatch[1];

            db.run(query, (err) => {
                if (err) {
                    console.error(`Error creando tabla ${tableName}:`, err.message);
                }
            });

            const bodyMatch = query.match(/\(([\s\S]*)\)/);
            if (!bodyMatch) return;
            let body = bodyMatch[1];
            
            body = body.replace(/--.*$/gm, '');
            
            const parts = body.split(/,(?![^\(]*\))/);
            
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

            db.all(`PRAGMA table_info(${tableName})`, (err, rows) => {
                if (err) {
                    console.error(`Error verificando PRAGMA de ${tableName}:`, err);
                    return;
                }
                const existingCols = rows.map(r => r.name);
                
                for (const [colName, colDef] of Object.entries(expectedColumns)) {
                    if (!existingCols.includes(colName)) {
                        console.log(`[Auto-Escáner DB] Añadiendo columna faltante: ${tableName}.${colName}`);
                        db.run(`ALTER TABLE ${tableName} ADD COLUMN ${colName} ${colDef}`, (err) => {
                            if (err) console.error(`Error agregando columna ${colName} a ${tableName}:`, err.message);
                            else console.log(`[Auto-Escáner DB] Columna ${colName} añadida con éxito.`);
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
}

inicializarYActualizarBaseDeDatos();

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
    db.get(`SELECT valor FROM configuracion_sistema WHERE clave = 'owner_id_empresa'`, [], (errConfig, rowConfig) => {
        let idEmpresa = rowConfig ? rowConfig.valor : null;
        
        db.run(`INSERT INTO abonos_deudas (id_empresa, sync_status, id_carga, vehiculo_id, cliente, monto_divisa, monto_movil, banco) VALUES (?, 0, ?, ?, ?, ?, ?, ?)`,
        [idEmpresa, data.id_carga, data.vehiculo_id, data.cliente, data.monto_divisa, data.monto_movil, data.banco], async function(err) {
            if (!err) {
                // Re-distribuimos los pagos tras añadir el abono
                await recalcularPagosCliente(data.id_carga, data.cliente);
            }
            event.reply('guardar-abono-resultado', { success: !err, msg: err ? err.message : '' });
        });
    });
});

ipcMain.on('eliminar-abono', (event, data) => {
    const id_abono = (data && typeof data === 'object') ? data.id_abono : data;
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

ipcMain.on('eliminar-cliente', (event, id) => {
    db.run(`DELETE FROM clientes WHERE id = ?`, [id], () => event.reply('resultado-operacion', { success: true }));
});

ipcMain.on('editar-cliente', (event, data) => {
    const { id, nombreViejo, nombreNuevo } = data;
    db.run(`UPDATE clientes SET nombre = ? WHERE id = ?`, [nombreNuevo, id], function(err) {
        if (err) {
            event.reply('resultado-operacion', { success: false, msg: err.message });
            return;
        }
        db.serialize(() => {
            db.run(`UPDATE ventas_cargas SET cliente = ? WHERE cliente = ?`, [nombreNuevo, nombreViejo]);
            db.run(`UPDATE abonos_deudas SET cliente = ? WHERE cliente = ?`, [nombreNuevo, nombreViejo]);
            db.run(`UPDATE reversos_deudas SET cliente = ? WHERE cliente = ?`, [nombreNuevo, nombreViejo]);
            db.run(`UPDATE cobros_excel SET cliente = ? WHERE cliente = ?`, [nombreNuevo, nombreViejo], () => {
                event.reply('resultado-operacion', { success: true });
            });
        });
    });
});


ipcMain.on('guardar-unidad-maestra', (event, nombre) => {
    db.get("SELECT valor FROM configuracion_sistema WHERE clave = 'owner_id_empresa'", [], (err, row) => {
        const idEmpresa = row ? row.valor : null;
        db.run(`INSERT INTO maestro_unidades (id_empresa, sync_status, nombre) VALUES (?, 0, ?)`, [idEmpresa, nombre], (err) => {
            event.reply('resultado-operacion', { success: !err, msg: err ? "Ya existe o error de DB" : "" });
        });
    });
});

ipcMain.handle('obtener-unidades-maestras', async () => {
    return new Promise((res) => {
        db.all(`SELECT * FROM maestro_unidades ORDER BY nombre ASC`, [], (err, rows) => res(rows || []));
    });
});

ipcMain.on('guardar-subtipo-maestro', (event, data) => {
    db.get("SELECT valor FROM configuracion_sistema WHERE clave = 'owner_id_empresa'", [], (err, row) => {
        const idEmpresa = row ? row.valor : null;
        db.run(`INSERT INTO maestro_subtipos (id_empresa, sync_status, unidad_id, nombre) VALUES (?, 0, ?, ?)`, [idEmpresa, data.unidad_id, data.nombre], (err) => {
            event.reply('resultado-operacion', { success: !err });
        });
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

// --- IPC para Métodos de Pago ---
ipcMain.handle('obtener-metodos-pago', async () => {
    return new Promise((res) => {
        db.all(`SELECT * FROM metodos_pago WHERE estado = 1 ORDER BY nombre ASC`, [], (err, rows) => res(rows || []));
    });
});

ipcMain.handle('obtener-metodos-pago-config', async () => {
    return new Promise((res) => {
        db.all(`SELECT * FROM metodos_pago ORDER BY nombre ASC`, [], (err, rows) => res(rows || []));
    });
});

ipcMain.on('guardar-metodo-pago', (event, nombre) => {
    db.get("SELECT valor FROM configuracion_sistema WHERE clave = 'owner_id_empresa'", [], (err, row) => {
        const idEmpresa = row ? row.valor : null;
        db.run(`INSERT INTO metodos_pago (id_empresa, sync_status, nombre) VALUES (?, 0, ?)`, [idEmpresa, nombre], function(err) {
            if (err) event.reply('resultado-operacion', { success: false, msg: err.message });
            else event.reply('resultado-operacion', { success: true });
        });
    });
});

ipcMain.on('cambiar-estado-metodo-pago', (event, { id, estado }) => {
    db.run(`UPDATE metodos_pago SET estado = ? WHERE id = ?`, [estado, id], () => {
        event.reply('resultado-operacion', { success: true });
    });
});

ipcMain.on('eliminar-metodo-pago', (event, id) => {
    db.run(`DELETE FROM metodos_pago WHERE id = ?`, [id], () => event.reply('resultado-operacion', { success: true }));
});

// --- IPC para Vehículos e Inventario ---
ipcMain.on('guardar-vehiculo', (event, nombre) => {
    db.get("SELECT valor FROM configuracion_sistema WHERE clave = 'owner_id_empresa'", [], (err, row) => {
        const idEmpresa = row ? row.valor : null;
        db.run(`INSERT INTO vehiculos (id_empresa, sync_status, nombre) VALUES (?, 0, ?)`, [idEmpresa, nombre], function(err) {
            if (err) event.reply('guardar-resultado', { success: false, msg: err.message });
            else event.reply('guardar-resultado', { success: true, id: this.lastID });
        });
    });
});

ipcMain.handle('obtener-vehiculos', async () => {
    return new Promise((resolve, reject) => {
        const query = `
            SELECT v.*, 
                   (SELECT COUNT(*) FROM vehiculo_cargas c WHERE c.vehiculo_id = v.id AND c.estado = 'ACTIVA') as tiene_activa
            FROM vehiculos v 
            ORDER BY tiene_activa DESC, v.fecha_creacion DESC
        `;
        db.all(query, [], (err, rows) => resolve(err ? [] : rows));
    });
});

ipcMain.on('guardar-carga-vehiculo', (event, data) => {
    const { vehiculo_id, datos_json } = data;
    db.get("SELECT valor FROM configuracion_sistema WHERE clave = 'owner_id_empresa'", [], (err, row) => {
        const idEmpresa = row ? row.valor : null;
        // Se inserta la carga como 'ACTIVA'
        db.run(`INSERT INTO vehiculo_cargas (id_empresa, sync_status, vehiculo_id, datos_json, estado) VALUES (?, 0, ?, ?, 'ACTIVA')`, 
        [idEmpresa, vehiculo_id, JSON.stringify(datos_json)], function(err) {
            if (err) event.reply('guardar-carga-resultado', { success: false, msg: err.message });
            else event.reply('guardar-carga-resultado', { success: true, id_carga: this.lastID });
        });
    });
});

// Obtener la carga ACTIVA actual de un vehículo
ipcMain.handle('obtener-carga-activa', async (event, vehiculo_id) => {
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
    
    db.get(`SELECT valor FROM configuracion_sistema WHERE clave = 'owner_id_empresa'`, [], (errConfig, rowConfig) => {
        let idEmpresa = rowConfig ? rowConfig.valor : null;
        db.run(`INSERT INTO cargas_cerradas 
            (id_empresa, sync_status, id_carga, vehiculo_id, fecha_entrada, mercancia_json, mermas_json, total_venta, total_credito, total_contado, valor_promedio_producto) 
            VALUES (?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [idEmpresa, id_carga, vehiculo_id, fecha_entrada, mercancia_json, mermas_json, total_venta, total_credito, total_contado, valor_promedio_producto], 
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
});

ipcMain.on('guardar-deuda-antigua-sistema', (event, data) => {
    // Si el front-end no envía tipo_medida, por retrocompatibilidad asume 'DEUDA ANTIGUA'
    const tipoMedida = data.tipo_medida || 'DEUDA ANTIGUA';
    
    db.get(`SELECT valor FROM configuracion_sistema WHERE clave = 'owner_id_empresa'`, [], (errConfig, rowConfig) => {
        let idEmpresa = rowConfig ? rowConfig.valor : null;
        
        const query = `
            INSERT INTO ventas_cargas (
                id_empresa, sync_status, fila_id, id_carga, vehiculo_id, fecha_entrada, 
                cliente, tipo_medida, sub_medida, precio, cantidad, metodo_pago, banco, pagado, estado_zinc
            ) VALUES (?, 0, ?, 0, 0, ?, ?, ?, ?, ?, 1, 'CRÉDITO', '', 0.0, 0)
        `;
        
        const fila_id = "ANT_" + Date.now(); 
        const precioStr = `${data.monto} $`;

        db.run(query, [idEmpresa, fila_id, data.fecha, data.cliente, tipoMedida, data.descripcion, precioStr], function(err) {
            if (err) {
                event.reply('guardar-deuda-antigua-resultado', { success: false, msg: err.message });
            } else {
                event.reply('guardar-deuda-antigua-resultado', { success: true });
            }
        });
    });
});

ipcMain.handle('obtener-cargas-deuda-cliente', async (event, clienteNombre) => {
    return new Promise((resolve) => {
        const query = `
            SELECT 
                v.id_carga,
                v.vehiculo_id,
                MIN(v.fila_id) AS primera_fila_id,
                MIN(v.sub_medida) AS descripcion_antigua,
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

ipcMain.handle('verificar-deuda-cliente', async (event, clienteNombre) => {
    return new Promise((resolve) => {
        const query = `
            SELECT 
                (CAST(REPLACE(precio, '$', '') AS REAL) * CAST(cantidad AS INTEGER)) AS cargo,
                0 AS abono
            FROM ventas_cargas
            WHERE cliente COLLATE NOCASE = ? AND metodo_pago = 'CRÉDITO' AND (CAST(REPLACE(precio, '$', '') AS REAL) * CAST(cantidad AS INTEGER)) > 0
            
            UNION ALL
            
            SELECT 
                0 AS cargo,
                (monto_divisa + monto_movil) AS abono
            FROM abonos_deudas
            WHERE cliente COLLATE NOCASE = ?
            
            UNION ALL
            
            SELECT 
                (monto_divisa + monto_movil) AS cargo,
                0 AS abono
            FROM reversos_deudas
            WHERE cliente COLLATE NOCASE = ?
        `;
        db.all(query, [clienteNombre.trim(), clienteNombre.trim(), clienteNombre.trim()], (err, rows) => {
            if (err) {
                resolve(false);
                return;
            }
            let saldo = 0;
            rows.forEach(r => {
                saldo += (parseFloat(r.cargo) || 0) - (parseFloat(r.abono) || 0);
            });
            resolve(saldo > 0.01);
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


app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

function createWindow() {
    const mainWindow = new BrowserWindow({
        title: 'Sistema de Ventas "Mayorista" - Nexus Company',
        width: 1280,
        height: 720,
        frame: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    // Deshabilita la visibilidad de la barra de menú nativa (File, Edit, etc.)
    mainWindow.setMenuBarVisibility(false);
    
    // Evita que el menú aparezca accidentalmente si el usuario presiona la tecla ALT
    mainWindow.setAutoHideMenuBar(true);

    mainWindow.loadFile('index.html');
}

// IPC Listeners para ventana sin marco

app.whenReady().then(() => {
    db.get(`SELECT valor FROM configuracion_sistema WHERE clave = 'sesion_usuario'`, [], (err, row) => {
        let loggedIn = false;
        let rol = 'admin';
        if (!err && row && row.valor) {
            try {
                const data = JSON.parse(row.valor);
                rol = data.rol || 'admin';
                loggedIn = true;
            } catch(e) {}
        }
        createWindow(loggedIn, rol);
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

function createWindow(loggedIn = false, rol = 'admin') {
    const mainWindow = new BrowserWindow({
        title: 'Sistema de Ventas "Mayorista" - Nexus Company',
        width: 1280,
        height: 720,
        frame: loggedIn ? true : false, // El marco vuelve si está logueado
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    // Deshabilita la visibilidad de la barra de menú nativa (File, Edit, etc.)
    mainWindow.setMenuBarVisibility(false);
    
    // Evita que el menú aparezca accidentalmente si el usuario presiona la tecla ALT
    mainWindow.setAutoHideMenuBar(true);

    if (loggedIn) {
        if (rol === 'cajera') {
            mainWindow.loadFile('inicio_cajera.html');
        } else {
            mainWindow.loadFile('inicio.html');
        }
        mainWindow.maximize();
    } else {
        mainWindow.loadFile('index.html');
    }
}

// IPC Listeners para ventana sin marco
ipcMain.on('minimize-login-window', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) win.minimize();
});

ipcMain.on('close-login-window', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) win.close();
});

ipcMain.on('abrir-ventana-principal', (event, ruta) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
        // En Electron no se puede habilitar el marco dinámicamente.
        // Lo correcto es crear la nueva ventana (con marco) y destruir la de Login.
        const rol = ruta.includes('cajera') ? 'cajera' : 'admin';
        createWindow(true, rol);
        win.close();
    }
});

// Manejo de Sesión en Base de Datos Local
ipcMain.handle('guardar-sesion', async (event, datosSesion) => {
    return new Promise((resolve, reject) => {
        const jsonSesion = JSON.stringify(datosSesion);
        db.run(`INSERT OR REPLACE INTO configuracion_sistema (clave, valor) VALUES ('sesion_usuario', ?)`, [jsonSesion], function(err) {
            if (err) return resolve({ success: false, msg: err.message });
            resolve({ success: true });
        });
    });
});

ipcMain.handle('obtener-sesion', async () => {
    return new Promise((resolve) => {
        db.get(`SELECT valor FROM configuracion_sistema WHERE clave = 'sesion_usuario'`, [], (err, row) => {
            if (err || !row) return resolve(null);
            try {
                resolve(JSON.parse(row.valor));
            } catch(e) {
                resolve(null);
            }
        });
    });
});

ipcMain.handle('cerrar-sesion', async () => {
    return new Promise((resolve) => {
        db.run(`DELETE FROM configuracion_sistema WHERE clave = 'sesion_usuario'`, [], (err) => {
            resolve({ success: !err });
        });
    });
});

ipcMain.on('cerrar-y-volver-login', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
        db.run(`DELETE FROM configuracion_sistema WHERE clave = 'sesion_usuario'`, [], () => {
            createWindow(false); // Crea ventana sin marco para el login
            win.close();
        });
    }
});

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
                    db.run(`UPDATE ${t} SET id_empresa = ? WHERE id_empresa IS NULL`, [idEmpresa], (err2) => {
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

// ==========================================
// IPC PARA SINCRONIZACIÓN SILENCIOSA
// ==========================================
ipcMain.handle('obtener-pendientes-sync', async (event, tablas_a_sincronizar) => {
    return new Promise((resolve) => {
        let resultados = {};
        let pending = tablas_a_sincronizar.length;
        if (pending === 0) return resolve(resultados);

        tablas_a_sincronizar.forEach(tabla => {
            // Seleccionamos todo lo que tenga sync_status = 0 (pendiente por subir)
            db.all(`SELECT * FROM ${tabla} WHERE sync_status = 0 LIMIT 100`, [], (err, rows) => {
                if (!err && rows && rows.length > 0) {
                    resultados[tabla] = rows;
                }
                pending--;
                if (pending === 0) resolve(resultados);
            });
        });
    });
});

ipcMain.handle('marcar-como-sincronizado-lote', async (event, { tabla, ids }) => {
    return new Promise((resolve) => {
        if (!ids || ids.length === 0) return resolve({ success: true });
        
        const primaryKeys = {
            'vehiculo_cargas': 'id_carga',
            'ventas_cargas': 'id_detalle',
            'cargas_cerradas': 'id_cierre',
            'mermas_cargas': 'merma_id',
            'rendiciones_cargas': 'rendicion_id',
            'abonos_deudas': 'id_abono',
            'reversos_deudas': 'id_reverso'
        };
        const pk = primaryKeys[tabla] || 'id';
        
        const placeholders = ids.map(() => '?').join(',');
        db.run(`UPDATE ${tabla} SET sync_status = 1 WHERE ${pk} IN (${placeholders})`, ids, (err) => {
            resolve({ success: !err, msg: err ? err.message : '' });
        });
    });
});


// ==================== RESTAURADOS Y ACTUALIZADOS ====================

ipcMain.handle('obtener-detalle-deudores-carga', async (event, id_carga) => {
    return new Promise((resolve) => {
        const query = `
            SELECT cliente, tipo_medida, sub_medida, cantidad, precio, pagado
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

ipcMain.handle('obtener-detalle-deudores-carga-lista', async (event, id_carga) => {
    return new Promise((resolve) => {
        const query = `
            SELECT *
            FROM ventas_cargas 
            WHERE id_carga = ? AND metodo_pago = 'CRÉDITO'
            ORDER BY cliente ASC
        `;
        db.all(query, [id_carga], (err, rows) => {
            resolve(rows || []);
        });
    });
});

ipcMain.handle('obtener-historial-cerradas', async () => {
    return new Promise((resolve) => {
        const query = `
            SELECT c.*, v.nombre AS vehiculo_nombre 
            FROM cargas_cerradas c
            LEFT JOIN vehiculos v ON c.vehiculo_id = v.id
            ORDER BY c.id_cierre DESC
        `;
        db.all(query, [], (err, rows) => {
            resolve(rows || []);
        });
    });
});

ipcMain.on('guardar-merma-carga', (event, data) => {
    db.get(`SELECT valor FROM configuracion_sistema WHERE clave = 'owner_id_empresa'`, [], (errConfig, rowConfig) => {
        let idEmpresa = rowConfig ? rowConfig.valor : null;
        db.run(`INSERT INTO mermas_cargas (id_empresa, sync_status, id_carga, vehiculo_id, tipo_medida, sub_medida, cantidad) VALUES (?, 0, ?, ?, ?, ?, ?)`,
        [idEmpresa, data.id_carga, data.vehiculo_id, data.tipo_medida, data.sub_medida, data.cantidad], function(err) {
            event.reply('guardar-merma-resultado', { success: !err, msg: err ? err.message : '' });
        });
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
    db.run(`UPDATE mermas_cargas SET estado_logico = 0 WHERE merma_id = ?`, [merma_id], (err) => {
        event.reply('eliminar-merma-resultado', { success: !err });
    });
});

ipcMain.on('guardar-rendicion-carga', (event, data) => {
    db.get(`SELECT valor FROM configuracion_sistema WHERE clave = 'owner_id_empresa'`, [], (errConfig, rowConfig) => {
        let idEmpresa = rowConfig ? rowConfig.valor : null;
        db.run(`INSERT INTO rendiciones_cargas (id_empresa, sync_status, id_carga, vehiculo_id, producto_origen, cantidad_restada, nombre_nuevo_producto, precio_venta_nuevo_producto, cantidad_generada) VALUES (?, 0, ?, ?, ?, ?, ?, ?, ?)`,
        [idEmpresa, data.id_carga, data.vehiculo_id, data.producto_origen, data.cantidad_restada, data.nombre_nuevo_producto, data.precio_venta_nuevo_producto, data.cantidad_generada], function(err) {
            event.reply('guardar-rendicion-resultado', { success: !err, msg: err ? err.message : '' });
        });
    });
});

ipcMain.handle('obtener-rendiciones-carga', async (event, id_carga) => {
    return new Promise((resolve) => {
        db.all(`SELECT * FROM rendiciones_cargas WHERE id_carga = ? AND estado_logico = 1 ORDER BY rendicion_id DESC`, [id_carga], (err, rows) => {
            resolve(rows || []);
        });
    });
});

ipcMain.on('eliminar-rendicion-carga', (event, rendicion_id) => {
    db.run(`UPDATE rendiciones_cargas SET estado_logico = 0 WHERE rendicion_id = ?`, [rendicion_id], (err) => {
        event.reply('eliminar-rendicion-resultado', { success: !err });
    });
});

ipcMain.on('guardar-cliente', (event, nombre) => {
    db.get(`SELECT valor FROM configuracion_sistema WHERE clave = 'owner_id_empresa'`, [], (errConfig, rowConfig) => {
        let idEmpresa = rowConfig ? rowConfig.valor : null;
        db.run(`INSERT INTO clientes (id_empresa, sync_status, nombre) VALUES (?, 0, ?)`, [idEmpresa, nombre], function(err) {
            if (err) {
                event.reply('guardar-cliente-resultado', { success: false, msg: err.message });
            } else {
                event.reply('guardar-cliente-resultado', { success: true, id: this.lastID });
            }
        });
    });
});


// ==================== RESTAURADOS Y ACTUALIZADOS PARTE 2 ====================

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
    
    db.get(`SELECT valor FROM configuracion_sistema WHERE clave = 'owner_id_empresa'`, [], (errConfig, rowConfig) => {
        let idEmpresa = rowConfig ? rowConfig.valor : null;
        
        // El INSERT OR REPLACE usa el UNIQUE(id_carga, fila_id) para actualizar si ya existe
        db.run(`INSERT OR REPLACE INTO ventas_cargas 
            (id_empresa, sync_status, id_detalle, fila_id, id_carga, vehiculo_id, fecha_entrada, cliente, tipo_medida, sub_medida, precio, cantidad, metodo_pago, banco)
            VALUES (
                ?, 0,
                (SELECT id_detalle FROM ventas_cargas WHERE id_carga = ? AND fila_id = ?),
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
            )`,
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
        db.all(`SELECT * FROM ventas_cargas WHERE id_carga = ? ORDER BY fila_id ASC`, [id_carga], (err, rows) => {
            resolve(rows || []);
        });
    });
});


// ==================== RESTAURADOS Y ACTUALIZADOS PARTE 3 ====================

ipcMain.on('eliminar-abono', (event, data) => {
    const id_abono = (data && typeof data === 'object') ? data.id_abono : data;
    
    // 1. En lugar de borrar físicamente, pasamos la información a reversos_deudas.
    db.get(`SELECT * FROM abonos_deudas WHERE id_abono = ?`, [id_abono], (errSel, rowAbono) => {
        if (!rowAbono) {
            event.reply('eliminar-abono-resultado', { success: false, msg: "Abono no encontrado" });
            return;
        }

        db.get(`SELECT valor FROM configuracion_sistema WHERE clave = 'owner_id_empresa'`, [], (errConfig, rowConfig) => {
            let idEmpresa = rowConfig ? rowConfig.valor : null;
            
            db.run(`INSERT INTO reversos_deudas (id_empresa, sync_status, id_carga, vehiculo_id, cliente, monto_divisa, monto_movil, banco) VALUES (?, 0, ?, ?, ?, ?, ?, ?)`,
                [idEmpresa, rowAbono.id_carga, rowAbono.vehiculo_id, rowAbono.cliente, rowAbono.monto_divisa, rowAbono.monto_movil, rowAbono.banco], function(errInsert) {
                    if (errInsert) {
                        event.reply('eliminar-abono-resultado', { success: false, msg: "Error al registrar reverso." });
                        return;
                    }
                    
                    // 2. Eliminamos (físicamente) el registro de abonos_deudas para la contabilidad actual
                    db.run(`DELETE FROM abonos_deudas WHERE id_abono = ?`, [id_abono], async function(errDel) {
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
});
