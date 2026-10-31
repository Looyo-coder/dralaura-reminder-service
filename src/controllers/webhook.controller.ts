import type { Request, Response } from "express";
import { prisma } from "../config/database.js";

interface PatientReply {
  phone: string;
  response: "1" | "2";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizePhone(value: string): string {
  return value.replace(/\D/g, "");
}

function extractPatientReply(body: unknown): PatientReply | undefined {
  if (!isRecord(body)) {
    return undefined;
  }

  const data = isRecord(body.data) ? body.data : body;
  const key = isRecord(data.key) ? data.key : undefined;
  if (key?.fromMe === true) {
    return undefined;
  }

  const remoteJid = key && typeof key.remoteJid === "string" ? key.remoteJid : undefined;
  const directPhone =
    typeof data.from === "string"
      ? data.from
      : typeof body.from === "string"
        ? body.from
        : undefined;
  const phone = remoteJid?.split("@")[0] ?? directPhone;
  if (!phone) {
    return undefined;
  }

  const message = isRecord(data.message) ? data.message : data;
  const buttonsResponse = isRecord(message.buttonsResponseMessage)
    ? message.buttonsResponseMessage
    : undefined;
  const buttonReply = isRecord(message.buttonReply)
    ? message.buttonReply
    : undefined;
  const extendedText = isRecord(message.extendedTextMessage)
    ? message.extendedTextMessage
    : undefined;
  const text =
    (buttonsResponse &&
      typeof buttonsResponse.selectedButtonId === "string"
      ? buttonsResponse.selectedButtonId
      : undefined) ??
    (buttonReply && typeof buttonReply.id === "string"
      ? buttonReply.id
      : undefined) ??
    (extendedText && typeof extendedText.text === "string"
      ? extendedText.text
      : undefined) ??
    (typeof message.conversation === "string" ? message.conversation : undefined) ??
    (typeof message.text === "string" ? message.text : undefined);
  const responseText = text?.trim();

  if (responseText !== "1" && responseText !== "2") {
    return undefined;
  }

  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) {
    return undefined;
  }

  return { phone: normalizedPhone, response: responseText };
}

export async function handleWhatsAppWebhook(
  request: Request,
  response: Response,
): Promise<void> {
  const reply = extractPatientReply(request.body);
  if (!reply) {
    response.status(400).json({
      error: "El webhook debe incluir un teléfono y una respuesta válida ('1' o '2').",
    });
    return;
  }

  const now = new Date();
  const appointments = await prisma.appointment.findMany({
    where: {
      status: "SCHEDULED",
      scheduledAt: {
        gte: now,
        lte: new Date(now.getTime() + 24 * 60 * 60 * 1000 + 5 * 60 * 1000),
      },
    },
    include: { patient: true },
    orderBy: { scheduledAt: "asc" },
  });

  const matchingAppointments = appointments.filter(
    (candidate) => normalizePhone(candidate.patient.phone) === reply.phone,
  );

  if (matchingAppointments.length === 0) {
    response.status(404).json({
      error: "No se encontró un recordatorio enviado pendiente para este teléfono.",
    });
    return;
  }

  const sentReminders = await prisma.appointmentReminder.findMany({
    where: {
      appointmentId: { in: matchingAppointments.map(({ id }) => id) },
      status: "SENT",
    },
  });
  const matchingAppointment = matchingAppointments
    .map((candidate) => ({
      appointment: candidate,
      reminder:
        sentReminders.find(
          (sentReminder) =>
            sentReminder.appointmentId === candidate.id &&
            sentReminder.type === "HOURS_2",
        ) ??
        sentReminders.find(
          (sentReminder) =>
            sentReminder.appointmentId === candidate.id &&
            sentReminder.type === "HOURS_24",
        ),
    }))
    .find((candidate) => candidate.reminder !== undefined);

  if (!matchingAppointment?.reminder) {
    response.status(404).json({
      error: "No se encontró un recordatorio enviado pendiente para este teléfono.",
    });
    return;
  }

  const { reminder } = matchingAppointment;
  const nextStatus = reply.response === "1" ? "CONFIRMED" : "ACTION_REQUIRED";
  const updated = await prisma.$transaction(async (transaction) => {
    const updateResult = await transaction.appointmentReminder.updateMany({
      where: { id: reminder.id, status: "SENT" },
      data: { status: nextStatus, response: reply.response },
    });

    if (updateResult.count !== 1) {
      return false;
    }

    if (reply.response === "1") {
      await transaction.appointment.update({
        where: { id: reminder.appointmentId },
        data: { status: "CONFIRMED" },
      });
    }

    return true;
  });

  if (!updated) {
    response.status(409).json({
      error: "El recordatorio ya fue procesado.",
    });
    return;
  }

  if (reply.response === "2") {
    console.error(
      JSON.stringify({
        appointmentId: reminder.appointmentId,
        status: nextStatus,
      }),
    );
  }

  response.status(200).json({
    status: nextStatus,
    appointmentId: reminder.appointmentId,
  });
}
