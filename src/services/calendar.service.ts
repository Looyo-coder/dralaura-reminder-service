export type AppointmentReminderType = "HOURS_24" | "HOURS_2";

export interface CalendarAppointment {
  id: string;
  summary: string;
  startAt: Date;
  endAt?: Date;
  description?: string;
  htmlLink?: string;
}

interface GoogleCalendarEvent {
  id: string;
  summary: string;
  startAt: Date;
  endAt?: Date;
  description?: string;
  htmlLink?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseEventDate(value: unknown, fieldName: string): Date | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const dateValue =
    typeof value.dateTime === "string"
      ? value.dateTime
      : typeof value.date === "string"
        ? value.date
        : undefined;

  if (dateValue === undefined) {
    return undefined;
  }

  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Google Calendar devolvió una fecha inválida en ${fieldName}.`);
  }

  return date;
}

function parseCalendarEvent(value: unknown): GoogleCalendarEvent {
  if (!isRecord(value) || typeof value.id !== "string") {
    throw new Error("Google Calendar devolvió un evento con formato inválido.");
  }

  const startAt = parseEventDate(value.start, "start");
  if (startAt === undefined) {
    throw new Error(`El evento ${value.id} no contiene una fecha de inicio válida.`);
  }

  const endAt = parseEventDate(value.end, "end");

  return {
    id: value.id,
    summary: typeof value.summary === "string" ? value.summary : "(Sin título)",
    startAt,
    ...(endAt === undefined ? {} : { endAt }),
    ...(typeof value.description === "string"
      ? { description: value.description }
      : {}),
    ...(typeof value.htmlLink === "string" ? { htmlLink: value.htmlLink } : {}),
  };
}

export async function getUpcomingCalendarAppointments(
  reminderType: AppointmentReminderType,
  now: Date = new Date(),
): Promise<CalendarAppointment[]> {
  const accessToken = process.env.GOOGLE_CALENDAR_ACCESS_TOKEN;
  const calendarId = process.env.GOOGLE_CALENDAR_ID;

  if (!accessToken) {
    throw new Error("Falta configurar GOOGLE_CALENDAR_ACCESS_TOKEN.");
  }
  if (!calendarId) {
    throw new Error("Falta configurar GOOGLE_CALENDAR_ID.");
  }
  if (Number.isNaN(now.getTime())) {
    throw new Error("La fecha de referencia para Google Calendar no es válida.");
  }

  const durationHours = reminderType === "HOURS_24" ? 24 : 2;
  const timeMax = new Date(now.getTime() + durationHours * 60 * 60 * 1000);
  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
  );
  url.searchParams.set("timeMin", now.toISOString());
  url.searchParams.set("timeMax", timeMax.toISOString());
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("maxResults", "2500");

  const appointments: CalendarAppointment[] = [];
  let pageToken: string | undefined;

  do {
    if (pageToken !== undefined) {
      url.searchParams.set("pageToken", pageToken);
    }

    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      const details = await response.text();
      throw new Error(
        `Google Calendar respondió ${response.status}: ${details || response.statusText}`,
      );
    }

    const payload: unknown = await response.json();
    if (!isRecord(payload) || !Array.isArray(payload.items)) {
      throw new Error("Google Calendar devolvió una respuesta con formato inválido.");
    }

    for (const item of payload.items) {
      if (isRecord(item) && item.status === "cancelled") {
        continue;
      }

      appointments.push(parseCalendarEvent(item));
    }

    if (payload.nextPageToken !== undefined) {
      if (
        typeof payload.nextPageToken !== "string" ||
        payload.nextPageToken.length === 0
      ) {
        throw new Error("Google Calendar devolvió un token de página inválido.");
      }
      pageToken = payload.nextPageToken;
    } else {
      pageToken = undefined;
    }
  } while (pageToken !== undefined);

  return appointments;
}
