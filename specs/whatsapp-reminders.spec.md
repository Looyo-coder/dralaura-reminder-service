# Especificación: recordatorios de citas por WhatsApp

## Contexto y problema

El consultorio de la Dra. Laura enfrenta una tasa de inasistencia cercana al
30%. Las ausencias interrumpen la continuidad de los tratamientos, dificultan
la planificación de la agenda clínica y reducen la disponibilidad de horas para
otros pacientes. Se necesita avisar oportunamente a cada paciente y facilitar
la confirmación o solicitud de reprogramación.

## Objetivo

Enviar recordatorios oportunos de citas, registrar su estado y procesar las
respuestas de los pacientes para confirmar la asistencia o solicitar atención
del equipo del consultorio.

## Diseño de la solución

1. **Sincronización con Google Calendar:** consultar los eventos de la agenda
   y asociarlos con citas y pacientes registrados en PostgreSQL mediante el
   identificador único del evento. Solo las citas vinculadas a un paciente
   pueden generar mensajes.
2. **Cron Job:** evaluar periódicamente la agenda y enviar recordatorios cuando
   la cita se encuentre en las ventanas de 24 horas o 2 horas previas. Registrar
   cada recordatorio y su estado en PostgreSQL para evitar envíos duplicados.
3. **Mensajería WhatsApp:** enviar un mensaje claro con opciones de respuesta:
   `1` para confirmar y `2` para solicitar cancelación o reprogramación.
4. **Webhook:** recibir y validar la respuesta, asociarla al paciente y al
   recordatorio enviado, actualizar el estado de la cita y del recordatorio, y
   alertar al equipo cuando se requiera intervención humana.
5. **Privacidad:** limitar los datos incluidos en mensajes y registros a lo
   necesario para gestionar la cita y proteger los datos personales de acuerdo
   con la Ley N° 19.628.

## Criterios de aceptación

- **CA-01 — Recordatorio de 24 horas:** dada una cita vinculada a un paciente y
  programada dentro de la ventana de 24 horas, el job envía el recordatorio
  correspondiente y persiste un registro de tipo `HOURS_24` con estado `SENT`.
- **CA-02 — Recordatorio de 2 horas:** dada una cita vinculada a un paciente y
  programada dentro de la ventana de 2 horas, el job envía el recordatorio
  correspondiente y persiste un registro de tipo `HOURS_2` con estado `SENT`.
- **CA-03 — Idempotencia:** al ejecutar nuevamente el job para la misma cita y
  tipo de recordatorio ya enviado, no se envía un segundo mensaje ni se crea un
  registro duplicado.
- **CA-04 — Confirmación:** al recibir por webhook una respuesta válida `1`
  asociada a un recordatorio enviado, el sistema cambia el estado del
  recordatorio y de la cita a `CONFIRMED`.
- **CA-05 — Solicitud de acción humana:** al recibir por webhook una respuesta
  válida `2` asociada a un recordatorio enviado, el sistema cambia el estado del
  recordatorio a `ACTION_REQUIRED`, conserva la respuesta y alerta al equipo
  del consultorio.

## Fuera de alcance

- Reprogramar automáticamente una cita en Google Calendar.
- Determinar el diagnóstico o tratamiento clínico del paciente.
- Garantizar una reducción específica de la tasa de inasistencia sin medición
  posterior.
