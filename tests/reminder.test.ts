import type { Request, Response } from "express";
import type {
  AppointmentReminderStatus,
  AppointmentReminderType,
  AppointmentStatus,
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appointmentFindMany: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  appointmentFindUnique: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  appointmentUpdate: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  reminderFindFirst: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  reminderFindMany: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  reminderUpsert: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  reminderUpdate: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  reminderUpdateMany: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  transaction: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  getUpcomingCalendarAppointments: vi.fn<
    (
      reminderType: AppointmentReminderType,
      now?: Date,
    ) => Promise<CalendarAppointmentFixture[]>
  >(),
  createWhatsAppProvider: vi.fn<() => WhatsAppProviderFixture>(),
  sendTemplateMessage: vi.fn<
    (message: ReminderMessageFixture) => Promise<{ messageId: string }>
  >(),
}));

vi.mock("../src/config/database.js", () => ({
  prisma: {
    appointment: {
      findMany: mocks.appointmentFindMany,
      findUnique: mocks.appointmentFindUnique,
      update: mocks.appointmentUpdate,
    },
    appointmentReminder: {
      findFirst: mocks.reminderFindFirst,
      findMany: mocks.reminderFindMany,
      upsert: mocks.reminderUpsert,
      update: mocks.reminderUpdate,
      updateMany: mocks.reminderUpdateMany,
    },
    $transaction: mocks.transaction,
  },
}));

vi.mock("../src/services/calendar.service.js", () => ({
  getUpcomingCalendarAppointments: mocks.getUpcomingCalendarAppointments,
}));

vi.mock("../src/services/whatsapp.service.js", () => ({
  createWhatsAppProvider: mocks.createWhatsAppProvider,
}));

import { handleWhatsAppWebhook } from "../src/controllers/webhook.controller.js";
import { processAppointmentReminders } from "../src/jobs/reminder.cron.js";

interface CalendarAppointmentFixture {
  id: string;
  summary: string;
  startAt: Date;
}

interface ReminderMessageFixture {
  phone: string;
  patientName: string;
  appointmentAt: Date;
  reminderType: AppointmentReminderType;
}

interface WhatsAppProviderFixture {
  sendTemplateMessage(
    message: ReminderMessageFixture,
  ): Promise<{ messageId: string }>;
}

interface PatientFixture {
  id: string;
  fullName: string;
  phone: string;
  createdAt: Date;
}

interface AppointmentFixture {
  id: string;
  patientId: string;
  googleEventId: string;
  scheduledAt: Date;
  status: AppointmentStatus;
  patient: PatientFixture;
}

interface ReminderFixture {
  id: string;
  appointmentId: string;
  type: AppointmentReminderType;
  status: AppointmentReminderStatus;
  response: string | null;
}

function isTransactionCallback(
  value: unknown,
): value is (transaction: unknown) => Promise<unknown> {
  return typeof value === "function";
}

const baseTime = new Date("2026-10-30T12:00:00.000Z");
const patient: PatientFixture = {
  id: "patient-1",
  fullName: "Paciente de Prueba",
  phone: "+5491112345678",
  createdAt: baseTime,
};

function makeAppointment(
  id: string,
  googleEventId: string,
  scheduledAt: Date,
): AppointmentFixture {
  return {
    id,
    patientId: patient.id,
    googleEventId,
    scheduledAt,
    status: "SCHEDULED",
    patient,
  };
}

function makeReminder(
  id: string,
  appointmentId: string,
  type: AppointmentReminderType,
  status: AppointmentReminderStatus,
): ReminderFixture {
  return { id, appointmentId, type, status, response: null };
}

function makeHttpResponse(): Response {
  const response = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };

  return response as unknown as Response;
}

function makeHttpRequest(body: unknown): Request {
  return { body } as Request;
}

function prepareWebhookTransaction(): void {
  mocks.reminderUpdateMany.mockResolvedValue({ count: 1 });
  mocks.appointmentUpdate.mockResolvedValue({});
  mocks.transaction.mockImplementation(async (...args: unknown[]) => {
    const callback = args[0];
    if (!isTransactionCallback(callback)) {
      throw new Error("Se esperaba una transacción interactiva de Prisma.");
    }

    const transaction = {
      appointmentReminder: {
        updateMany: mocks.reminderUpdateMany,
      },
      appointment: {
        update: mocks.appointmentUpdate,
      },
    };

    return callback(transaction);
  });
}

describe("motor de recordatorios y webhook", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.sendTemplateMessage.mockResolvedValue({ messageId: "message-1" });
    mocks.createWhatsAppProvider.mockReturnValue({
      sendTemplateMessage: mocks.sendTemplateMessage,
    });
    mocks.reminderFindFirst.mockResolvedValue(null);
    mocks.appointmentUpdate.mockResolvedValue({});
    mocks.reminderUpdate.mockResolvedValue({});
  });

  it("envía recordatorios para las ventanas de 24 h y 2 h una sola vez", async () => {
    const appointment24h = makeAppointment(
      "appointment-24h",
      "event-24h",
      new Date(baseTime.getTime() + 24 * 60 * 60 * 1000),
    );
    const appointment2h = makeAppointment(
      "appointment-2h",
      "event-2h",
      new Date(baseTime.getTime() + 2 * 60 * 60 * 1000),
    );
    const calendarEvent24h: CalendarAppointmentFixture = {
      id: appointment24h.googleEventId,
      summary: "Control",
      startAt: appointment24h.scheduledAt,
    };
    const calendarEvent2h: CalendarAppointmentFixture = {
      id: appointment2h.googleEventId,
      summary: "Control",
      startAt: appointment2h.scheduledAt,
    };

    mocks.getUpcomingCalendarAppointments.mockImplementation(
      async (reminderType) =>
        reminderType === "HOURS_24" ? [calendarEvent24h] : [calendarEvent2h],
    );
    mocks.appointmentFindUnique
      .mockResolvedValueOnce(appointment24h)
      .mockResolvedValueOnce(appointment2h)
      .mockResolvedValueOnce(appointment24h)
      .mockResolvedValueOnce(appointment2h);
    mocks.reminderUpsert
      .mockResolvedValueOnce(
        makeReminder("reminder-24h", appointment24h.id, "HOURS_24", "PENDING"),
      )
      .mockResolvedValueOnce(
        makeReminder("reminder-2h", appointment2h.id, "HOURS_2", "PENDING"),
      )
      .mockResolvedValueOnce(
        makeReminder("reminder-24h", appointment24h.id, "HOURS_24", "SENT"),
      )
      .mockResolvedValueOnce(
        makeReminder("reminder-2h", appointment2h.id, "HOURS_2", "SENT"),
      );

    await processAppointmentReminders(baseTime);
    await processAppointmentReminders(baseTime);

    expect(mocks.getUpcomingCalendarAppointments).toHaveBeenCalledWith(
      "HOURS_24",
      baseTime,
    );
    expect(mocks.getUpcomingCalendarAppointments).toHaveBeenCalledWith(
      "HOURS_2",
      baseTime,
    );
    expect(mocks.getUpcomingCalendarAppointments).toHaveBeenCalledTimes(4);
    expect(mocks.sendTemplateMessage).toHaveBeenCalledTimes(2);
    expect(mocks.sendTemplateMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ reminderType: "HOURS_24" }),
    );
    expect(mocks.sendTemplateMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ reminderType: "HOURS_2" }),
    );
    expect(mocks.reminderUpdate).toHaveBeenCalledTimes(2);
    expect(mocks.reminderUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: "SENT", response: null },
      }),
    );
  });

  it("confirma la cita y el recordatorio cuando el paciente responde 1", async () => {
    const appointment = makeAppointment(
      "appointment-confirm",
      "event-confirm",
      new Date(baseTime.getTime() + 60 * 60 * 1000),
    );
    const reminder = makeReminder(
      "reminder-confirm",
      appointment.id,
      "HOURS_2",
      "SENT",
    );
    mocks.appointmentFindMany.mockResolvedValue([appointment]);
    mocks.reminderFindMany.mockResolvedValue([reminder]);
    prepareWebhookTransaction();

    const response = makeHttpResponse();
    await handleWhatsAppWebhook(
      makeHttpRequest({
        data: {
          key: { remoteJid: "5491112345678@s.whatsapp.net" },
          message: { conversation: "1" },
        },
      }),
      response,
    );

    expect(mocks.reminderUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: reminder.id, status: "SENT" },
        data: { status: "CONFIRMED", response: "1" },
      }),
    );
    expect(mocks.appointmentUpdate).toHaveBeenCalledWith({
      where: { id: appointment.id },
      data: { status: "CONFIRMED" },
    });
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith({
      status: "CONFIRMED",
      appointmentId: appointment.id,
    });
  });

  it("marca ACTION_REQUIRED y alerta cuando el paciente responde 2", async () => {
    const appointment = makeAppointment(
      "appointment-action",
      "event-action",
      new Date(baseTime.getTime() + 60 * 60 * 1000),
    );
    const reminder = makeReminder(
      "reminder-action",
      appointment.id,
      "HOURS_2",
      "SENT",
    );
    mocks.appointmentFindMany.mockResolvedValue([appointment]);
    mocks.reminderFindMany.mockResolvedValue([reminder]);
    prepareWebhookTransaction();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = makeHttpResponse();
    await handleWhatsAppWebhook(
      makeHttpRequest({
        data: {
          key: { remoteJid: "5491112345678@s.whatsapp.net" },
          message: { buttonsResponseMessage: { selectedButtonId: "2" } },
        },
      }),
      response,
    );

    expect(mocks.reminderUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: reminder.id, status: "SENT" },
        data: { status: "ACTION_REQUIRED", response: "2" },
      }),
    );
    expect(mocks.appointmentUpdate).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("APPOINTMENT_ACTION_REQUIRED"),
    );
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith({
      status: "ACTION_REQUIRED",
      appointmentId: appointment.id,
    });
  });
});
