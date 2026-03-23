import { execSync } from 'child_process';

/**
 * Executes a PostgreSQL command using the psql CLI tool.
 * @param query The SQL query or psql command to execute.
 * @returns The output of the command or an error message.
 */
export const executePsql = (query: string): string => {
  const dbUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/fastapi_db';
  
  try {
    // Escaping double quotes and removing newlines in the query for the shell command
    const sanitizedQuery = query.replace(/"/g, '\\"').replace(/\r?\n|\r/g, ' ');
    const command = `psql "${dbUrl}" -c "${sanitizedQuery}"`;
    
    console.log(`[Tool: PSQL] Executing: ${command}`);
    
    const result = execSync(command, { encoding: 'utf8' });
    return result || 'Comando ejecutado exitosamente (sin salida).';
  } catch (error: any) {
    console.error(`[Tool: PSQL] Error: ${error.message}`);
    return `Error de Base de Datos: ${error.stdout || error.stderr || error.message}`;
  }
};

/**
 * Tool configuration for the LLM
 */
export const psqlToolConfig = {
  type: 'function',
  function: {
    name: 'execute_psql',
    description: 'Ejecuta consultas SQL o comandos de inspección (\d, \dt, etc.) en la base de datos PostgreSQL local. Úsalo para leer, insertar, actualizar o borrar datos según la solicitud del usuario.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'La consulta SQL exacta o comando psql a ejecutar. Ej: "SELECT * FROM books LIMIT 5;" o "\dt".'
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
