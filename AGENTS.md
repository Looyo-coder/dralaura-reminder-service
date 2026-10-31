# AGENTS.md

## Stack tecnológico
- Usar TypeScript en modo estricto; no introducir ningún uso de `any`.
- Ejecutar la aplicación sobre Node.js.
- Usar Prisma como ORM y PostgreSQL como base de datos.

## Arquitectura y metodología
- Seguir obligatoriamente Spec-Driven Development (SDD).
- Toda feature nueva debe nacer de una especificación documentada en `specs/` antes de implementar código.
- Mantener la implementación y las pruebas alineadas con los criterios de aceptación de la spec.

## Seguridad y datos de pacientes
- Cumplir la Ley N° 19.628 sobre protección de datos personales en el tratamiento de datos de pacientes.
- Tratar los datos de salud y contacto como información confidencial: limitar su acceso, uso, registro y divulgación a lo estrictamente necesario.
- No incluir datos personales, credenciales ni secretos en logs, código fuente o repositorios.

## Protocolos de cierre
- Antes de cerrar cambios, ejecutar `pnpm tsc --noEmit`.
- Antes de cerrar cambios, ejecutar `pnpm test`.
- Resolver cualquier error de tipado o prueba antes de dar el trabajo por terminado.
