import { randomUUID } from "node:crypto";

export type AppointmentReminderType = "HOURS_24" | "HOURS_2";

export interface AppointmentReminderMessage {
  phone: string;
  patientName: string;
  appointmentAt: Date;
  reminderType: AppointmentReminderType;
}

export interface WhatsAppSendResult {
  messageId: string;
}

export interface WhatsAppProvider {
  sendTemplateMessage(
    message: AppointmentReminderMessage,
  ): Promise<WhatsAppSendResult>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getEvolutionMessageId(value: unknown): string | undefined {
  if (!isRecord(value) || !isRecord(value.key)) {
    return undefined;
  }

  return typeof value.key.id === "string" ? value.key.id : undefined;
}

export class SimulatedWhatsAppProvider implements WhatsAppProvider {
  async sendTemplateMessage(
    _message: AppointmentReminderMessage,
  ): Promise<WhatsAppSendResult> {
    return { messageId: `simulated-${randomUUID()}` };
  }
}

export class EvolutionApiWhatsAppProvider implements WhatsAppProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly instanceName: string,
  ) {}

  async sendTemplateMessage(
    message: AppointmentReminderMessage,
  ): Promise<WhatsAppSendResult> {
    if (Number.isNaN(message.appointmentAt.getTime())) {
      throw new Error("La fecha de la cita para WhatsApp no es válida.");
    }

    const number = message.phone.replace(/\D/g, "");
    if (!number) {
      throw new Error("El teléfono del paciente no es válido.");
    }

    const reminderLabel =
      message.reminderType === "HOURS_24" ? "24 horas" : "2 horas";
    const appointmentDate = new Intl.DateTimeFormat("es", {
      dateStyle: "long",
      timeStyle: "short",
    }).format(message.appointmentAt);
    const endpoint = new URL(
      `/message/sendButtons/${encodeURIComponent(this.instanceName)}`,
      this.baseUrl,
    );

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        apikey: this.apiKey,
      },
      body: JSON.stringify({
        number,
        title: "Recordatorio de cita",
        description:
          `Hola ${message.patientName}, te recordamos tu cita de ${appointmentDate}. ` +
          `Este es tu recordatorio de ${reminderLabel}.`,
        footer: "Selecciona una opción para responder",
        buttons: [
          { type: "reply", displayText: "Confirmar", id: "1" },
          { type: "reply", displayText: "Reprogramar", id: "2" },
        ],
      }),
    });

    if (!response.ok) {
      const details = await response.text();
      throw new Error(
        `Evolution API respondió ${response.status}: ${details || response.statusText}`,
      );
    }

    const result: unknown = await response.json();
    const messageId = getEvolutionMessageId(result);
    if (messageId === undefined) {
      throw new Error("Evolution API no devolvió el identificador del mensaje.");
    }

    return { messageId };
  }
}

export function createWhatsAppProvider(): WhatsAppProvider {
  const providerName = process.env.WHATSAPP_PROVIDER;

  if (providerName === "simulated") {
    return new SimulatedWhatsAppProvider();
  }

  if (providerName === "evolution") {
    const baseUrl = process.env.WHATSAPP_API_URL;
    const apiKey = process.env.WHATSAPP_API_KEY;
    const instanceName = process.env.WHATSAPP_INSTANCE;

    if (!baseUrl || !apiKey || !instanceName) {
      throw new Error(
        "Evolution API requiere WHATSAPP_API_URL, WHATSAPP_API_KEY y WHATSAPP_INSTANCE.",
      );
    }

    return new EvolutionApiWhatsAppProvider(baseUrl, apiKey, instanceName);
  }

  throw new Error(
    "WHATSAPP_PROVIDER debe configurarse como 'simulated' o 'evolution'.",
  );
}

export async function sendAppointmentReminder(
  message: AppointmentReminderMessage,
  provider: WhatsAppProvider = createWhatsAppProvider(),
): Promise<WhatsAppSendResult> {
  if (!message.patientName.trim()) {
    throw new Error("El nombre del paciente no puede estar vacío.");
  }

  return provider.sendTemplateMessage(message);
}
