const fs = require('fs');

const csvPath = 'Electrosinge.csv';
const sqlPath = 'temp_import.sql';

if (!fs.existsSync(csvPath)) {
  console.error('File not found:', csvPath);
  process.exit(1);
}

const lines = fs.readFileSync(csvPath, 'utf8').split('\n');
const headers = lines[0].split(';');

let sql = 'INSERT INTO inventario_productos (categoria, marca, modelo, capacidad_detalle, color_adicional, precio, moneda, link_imagen, precio_unificado, dolar_hoy) VALUES \n';
const inserts = [];

for (let i = 1; i < lines.length; i++) {
  const line = lines[i].trim();
  if (!line) continue;

  const cols = line.split(';').map(c => c.trim().replace(/'/g, "''"));
  if (cols.length < 5) continue;

  // Sanitize numeric fields
  let precio = parseFloat(cols[5]) || 0;
  let dolar = parseFloat(cols[9]) || 0;
  
  // Format values
  const values = [
    `'${cols[0] || ''}'`,
    `'${cols[1] || ''}'`,
    `'${cols[2] || ''}'`,
    `'${cols[3] || ''}'`,
    `'${cols[4] || ''}'`,
    precio,
    `'${cols[6] || ''}'`,
    `'${cols[7] || ''}'`,
    `'${cols[8] || ''}'`,
    dolar
  ];

  inserts.push(`(${values.join(', ')})`);
}

sql += inserts.join(',\n') + ';';
fs.writeFileSync(sqlPath, sql);
console.log(`Generated ${inserts.length} inserts in ${sqlPath}`);
