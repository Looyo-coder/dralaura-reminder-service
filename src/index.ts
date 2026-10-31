import { app } from "./app.js";
import { connectDatabase, prisma } from "./config/database.js";
import { startReminderCron } from "./jobs/reminder.cron.js";

const port = Number(process.env.PORT ?? 3000);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT debe ser un puerto válido entre 1 y 65535.");
}

await connectDatabase();
const reminderTask = startReminderCron();

const server = app.listen(port, () => {
  console.info(`Servidor HTTP escuchando en el puerto ${port}.`);
});

async function shutdown(): Promise<void> {
  await reminderTask.stop();
  server.close(async (error) => {
    if (error) {
      console.error("Error al cerrar el servidor HTTP.", error);
      process.exitCode = 1;
    }

    await prisma.$disconnect();
  });
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
