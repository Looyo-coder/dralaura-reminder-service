# Servicio de recordatorios — Consultorio de la Dra. Laura

Servicio backend para reducir las inasistencias y apoyar la continuidad de los
tratamientos del consultorio dental. El problema de partida es una tasa de
ausentismo aproximada del **30%**. El sistema consulta Google Calendar, envía
recordatorios por WhatsApp 24 y 2 horas antes de cada cita, y procesa las
respuestas para confirmar la asistencia o solicitar seguimiento del equipo.

> La cifra de ausentismo es el contexto del proyecto, no una medición de
> resultados del sistema. El servicio no garantiza una reducción determinada.

## Stack tecnológico

- **Node.js 24 LTS** y **TypeScript estricto** (`strict`, sin `any`).
- **Prisma 7** como ORM y **PostgreSQL 17** como base de datos.
- **Node-Cron** para procesar las ventanas de recordatorio.
- **Express** para el endpoint de webhook de WhatsApp.
- **Vitest** para las pruebas unitarias.
- **Docker** y **Docker Compose** para empaquetado y despliegue.

## Flujo principal

1. Se consultan eventos próximos en Google Calendar y se asocian a citas y
   pacientes por `googleEventId`.
2. El cron evalúa las ventanas de 24 y 2 horas, envía el mensaje configurado y
   guarda el estado del recordatorio en PostgreSQL.
3. El paciente responde `1` para confirmar o `2` para solicitar cancelación o
   reprogramación.
4. El webhook actualiza la cita y el recordatorio; la respuesta `2` genera una
   alerta para seguimiento humano.

El endpoint es `POST /api/webhooks/whatsapp`. Configura esa URL en el proveedor
de WhatsApp para recibir respuestas.

## Estructura del proyecto

```text
prisma/                 Schema de datos
specs/                  Especificaciones y criterios de aceptación (SDD)
src/
  config/               Configuración de Prisma/PostgreSQL
  controllers/          Controladores HTTP y webhook
  jobs/                 Cron de recordatorios
  routes/               Rutas Express
  services/             Integraciones de Google Calendar y WhatsApp
tests/                  Pruebas unitarias
Dockerfile              Build multi-stage de la aplicación
docker-compose.yml      Aplicación y PostgreSQL
```

## Requisitos previos

- Node.js **24.x** con Corepack y pnpm.
- Docker Engine con el plugin Docker Compose v2 (para usar la base local o
  desplegar).
- Credenciales válidas de Google Calendar y un proveedor WhatsApp para enviar
  mensajes reales. Las pruebas unitarias no requieren estos servicios externos.

## Instalación y ejecución local

1. Clona el repositorio y entra al directorio:

   ```sh
   git clone https://github.com/Looyo-coder/dralaura-reminder-service.git
   cd dralaura-reminder-service
   ```

2. Crea tu configuración local y **cambia los valores de ejemplo**, en
   particular la contraseña de PostgreSQL:

   ```sh
   cp .env.example .env
   ```

   En `.env`, establece `POSTGRES_DB`, `POSTGRES_USER` y una contraseña fuerte
   en `POSTGRES_PASSWORD`. Actualiza `DATABASE_URL` con las mismas credenciales,
   usando `localhost` y el puerto indicado por `POSTGRES_PORT`. Si la contraseña
   contiene caracteres reservados en una URL, codifícala para `DATABASE_URL`.
   No subas `.env` al repositorio.

3. Instala dependencias y levanta PostgreSQL:

   ```sh
   corepack enable
   corepack prepare pnpm@latest --activate
   pnpm install --frozen-lockfile
   pnpm exec prisma generate
   docker compose up -d postgres
   ```

   PostgreSQL se publica únicamente en `127.0.0.1`, para permitir el bootstrap
   desde el host sin exponer la base a la red externa.

4. Carga el schema inicial de Prisma. En una shell Linux/macOS, exporta las
   variables de `.env` antes de invocar Prisma:

   ```sh
   set -a
   . ./.env
   set +a
   pnpm exec prisma db push
   ```

   El repositorio actualmente define el schema, pero no contiene migraciones
   versionadas. `db push` sirve para inicializar este schema; antes de gestionar
   cambios de schema en producción, crea y versiona migraciones de Prisma.

5. Configura las integraciones:

   - Google Calendar: define `GOOGLE_CALENDAR_ACCESS_TOKEN` y
     `GOOGLE_CALENDAR_ID`. El token bearer debe ser válido; la renovación
     automática del token no está implementada.
   - WhatsApp simulado: `WHATSAPP_PROVIDER=simulated` (valor predeterminado; no
     entrega mensajes reales).
   - Evolution API: establece `WHATSAPP_PROVIDER=evolution`,
     `WHATSAPP_API_URL`, `WHATSAPP_API_KEY` y `WHATSAPP_INSTANCE`.

6. Ejecuta las pruebas y verifica tipos:

   ```sh
   pnpm test
   pnpm tsc --noEmit
   ```

7. Compila e inicia el servicio:

   ```sh
   pnpm build
   pnpm start
   ```

   El servidor escucha en el puerto `PORT` (3000 por defecto) e inicia el cron
   después de conectar con PostgreSQL.

## Despliegue en Linux por SSH con Docker Compose

### 1. Preparar el servidor

Conéctate al servidor:

```sh
ssh usuario@servidor
```

Instala Git, Docker Engine y el plugin Compose v2 siguiendo las instrucciones
oficiales para la distribución Linux elegida. Node.js 24 con Corepack y pnpm
también son necesarios en el host para inicializar el schema con Prisma.

### 2. Obtener el código y configurar secretos

```sh
git clone https://github.com/Looyo-coder/dralaura-reminder-service.git
cd dralaura-reminder-service
cp .env.example .env
```

Edita `.env` en el servidor. Usa credenciales fuertes y únicas para
`POSTGRES_USER` y `POSTGRES_PASSWORD`, mantén `POSTGRES_PORT` accesible solo en
loopback, configura Google Calendar y selecciona el proveedor WhatsApp. Asegura
que `DATABASE_URL` use las credenciales PostgreSQL correspondientes y
`localhost` para el bootstrap. Protege el archivo:

```sh
chmod 600 .env
```

### 3. Inicializar la base de datos

```sh
corepack enable
corepack prepare pnpm@latest --activate
pnpm install --frozen-lockfile
pnpm exec prisma generate
docker compose up -d postgres
```

Espera a que PostgreSQL pase el healthcheck y aplica el schema inicial:

```sh
set -a
. ./.env
set +a
pnpm exec prisma db push
```

### 4. Construir y arrancar la aplicación

```sh
docker compose up -d --build
docker compose ps
docker compose logs -f app
```

La aplicación queda disponible en `http://servidor:3000` salvo que `PORT` se
haya cambiado. Para uso público, configura un proxy inverso con TLS y registra
la URL HTTPS del webhook en el proveedor WhatsApp. No expongas PostgreSQL a
interfaces públicas.

### 5. Actualizar una instalación

Desde el directorio del repositorio en el servidor:

```sh
git pull --ff-only
docker compose up -d --build
docker compose ps
```

No uses `docker compose down -v` para actualizaciones: eliminaría el volumen
persistente de PostgreSQL. Antes de cambiar el schema en producción, introduce
migraciones Prisma versionadas y aplica el flujo de migración correspondiente;
no uses `db push` como sustituto de un proceso de migración de producción.

## Privacidad y seguridad

Los datos de pacientes son confidenciales. Limita el acceso a secretos y datos,
usa TLS en endpoints públicos y cumple la Ley N° 19.628. El webhook implementado
no incluye verificación de firma/autenticidad del proveedor; antes de exponerlo
a Internet, añade y configura esa validación en el servicio o en un proxy
confiable.

## Documentación de producto

- [Especificación del motor de recordatorios](./specs/whatsapp-reminders.spec.md)
- [Guía de marca](./BRANDING.md)
- [Instrucciones para agentes](./AGENTS.md)
