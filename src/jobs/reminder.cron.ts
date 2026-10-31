import cron from "node-cron";
import type { AppointmentReminderType } from "@prisma/client";
import type { ScheduledTask } from "node-cron";
import { prisma } from "../config/database.js";
import { getUpcomingCalendarAppointments } from "../services/calendar.service.js";
import {
  createWhatsAppProvider,
  type WhatsAppProvider,
} from "../services/whatsapp.service.js";

const reminderTypes: AppointmentReminderType[] = ["HOURS_24", "HOURS_2"];
const reminderGracePeriodMs = 5 * 60 * 1000;

export async function processAppointmentReminders(
  now: Date = new Date(),
  provider: WhatsAppProvider = createWhatsAppProvider(),
): Promise<void> {
  if (Number.isNaN(now.getTime())) {
    throw new Error("La fecha de ejecución de los recordatorios no es válida.");
  }

  for (const reminderType of reminderTypes) {
    const leadTimeMs =
      (reminderType === "HOURS_24" ? 24 : 2) * 60 * 60 * 1000;
    const dueAt = new Date(now.getTime() + leadTimeMs);
    const graceStart = new Date(dueAt.getTime() - reminderGracePeriodMs);
    const calendarAppointments = await getUpcomingCalendarAppointments(
      reminderType,
      now,
    );

    for (const calendarAppointment of calendarAppointments) {
      if (
        calendarAppointment.startAt < graceStart ||
        calendarAppointment.startAt > dueAt
      ) {
        continue;
      }

      const appointment = await prisma.appointment.findUnique({
        where: { googleEventId: calendarAppointment.id },
        include: { patient: true },
      });

      if (!appointment) {
        console.warn(
          `No se envió recordatorio: el evento ${calendarAppointment.id} no está asociado a un paciente en PostgreSQL.`,
        );
        continue;
      }

      if (appointment.status !== "SCHEDULED") {
        continue;
      }

      const actionRequiredReminder =
        await prisma.appointmentReminder.findFirst({
          where: {
            appointmentId: appointment.id,
            status: "ACTION_REQUIRED",
          },
        });
      if (actionRequiredReminder) {
        continue;
      }

      if (appointment.scheduledAt.getTime() !== calendarAppointment.startAt.getTime()) {
        await prisma.appointment.update({
          where: { id: appointment.id },
          data: { scheduledAt: calendarAppointment.startAt },
        });
      }

      const reminder = await prisma.appointmentReminder.upsert({
        where: {
          appointmentId_type: {
            appointmentId: appointment.id,
            type: reminderType,
          },
        },
        create: {
          appointmentId: appointment.id,
          type: reminderType,
          status: "PENDING",
        },
        update: {},
      });

      if (
        reminder.status === "SENT" ||
        reminder.status === "CONFIRMED" ||
        reminder.status === "ACTION_REQUIRED"
      ) {
        continue;
      }

      try {
        await provider.sendTemplateMessage({
          phone: appointment.patient.phone,
          patientName: appointment.patient.fullName,
          appointmentAt: calendarAppointment.startAt,
          reminderType,
        });
      } catch {
        await prisma.appointmentReminder.update({
          where: { id: reminder.id },
          data: { status: "FAILED" },
        });
        console.error(
          JSON.stringify({
            appointmentId: appointment.id,
            status: "FAILED",
          }),
        );
        continue;
      }

      await prisma.appointmentReminder.update({
        where: { id: reminder.id },
        data: { status: "SENT", response: null },
      });
    }
  }
}

export function startReminderCron(): ScheduledTask {
  return cron.schedule(
    "* * * * *",
    async () => {
      try {
        await processAppointmentReminders();
      } catch {
        console.error("Falló la ejecución del cron de recordatorios.");
      }
    },
    { noOverlap: true, name: "appointment-reminders" },
  );
}
