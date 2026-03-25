import pkg from 'pg';
const { Pool } = pkg;

// Configuración del Pool de conexiones
const dbUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/fastapi_db';
const pool = new Pool({
  connectionString: dbUrl,
  max: 15, // Aumentado para mayor concurrencia (Pool Size)
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

/**
 * Formatea los resultados de pg a un estilo de tabla similar a 'psql' CLI
 * para que el agent.ts (Healer) no se rompa al buscar separadores '|'.
 */
const formatToPsqlTable = (rows: any[]): string => {
  if (!rows || rows.length === 0) return '(0 productos encontrados)';
  
  const headers = Object.keys(rows[0]);
  const separator = headers.map(() => '----+').join('').slice(0, -1);
  const headerStr = ' ' + headers.join(' | ') + '\n' + separator;
  
  const body = rows.map(row => {
    return ' ' + headers.map(h => {
      const val = row[h];
      return val === null ? 'null' : (typeof val === 'object' ? JSON.stringify(val) : String(val));
    }).join(' | ');
  }).join('\n');

  return `${headerStr}\n${body}\n(${rows.length} rows)`;
};

/**
 * Ejecuta una consulta SQL asíncrona usando pg Pool.
 * @param query La consulta SQL.
 * @returns El resultado formateado como tabla psql.
 */
export const executePsql = async (query: string): Promise<string> => {
  const client = await pool.connect();
  try {
    console.log(`[Tool: PG-Pool] Executing Async Query...`);
    
    // El SQL Healer ya limpió la consulta en el agent.ts, aquí la ejecutamos.
    const res = await client.query(query);
    
    if (res.command !== 'SELECT') {
      return `Comando ${res.command} ejecutado exitosamente. Fila(s) afectada(s): ${res.rowCount}`;
    }

    return formatToPsqlTable(res.rows);
  } catch (error: any) {
    console.error(`[Tool: PG-Pool] Error en consulta: ${error.message}`);
    return `Error de Base de Datos: ${error.message}`;
  } finally {
    client.release();
  }
};

/**
 * Configuración para el LLM
 */
export const psqlToolConfig = {
  type: 'function',
  function: {
    name: 'execute_psql',
    description: 'Ejecuta consultas SQL en la base de datos PostgreSQL local para consultar inventario. Úsalo para buscar productos, precios y stocks reales.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Consulta SQL. Ej: "SELECT * FROM inventario_productos LIMIT 5;"'
        }
      },
      required: ['query']
    }
  }
};

import { registerTool } from './registry.js';

export const initPsqlTool = () => {
  registerTool({
    definition: psqlToolConfig as any,
    execute: (args: any) => executePsql(args.query)
  });
};
