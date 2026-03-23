# Usar una imagen ligera de Node
FROM node:20-slim

# Crear directorio de la app
WORKDIR /app

# Instalar dependencias primero (mejorar caché)
COPY package*.json ./
RUN npm install

# Copiar el resto del código
COPY . .

# Compilar TypeScript si fuera necesario (aquí usamos tsx directo)
# Pero para PROD es mejor compilar:
# RUN npx tsc

# Exponer el puerto por si usamos webhooks en el futuro
EXPOSE 8080

# Comando para iniciar el bot en modo producción 
# Usamos start que invoca a npx tsx
CMD ["npm", "run", "start"]
