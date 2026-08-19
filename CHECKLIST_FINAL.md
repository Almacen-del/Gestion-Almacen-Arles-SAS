# Checklist final de aceptación

Marca cada punto únicamente después de comprobarlo en tu PC.

## Instalación y build
- [ ] `npm install` termina sin errores.
- [ ] `npm run test` termina correctamente.
- [ ] `npm run build` genera `dist/`.
- [ ] `npm run preview` abre la aplicación.

## Autenticación
- [ ] Inicio de sesión correcto.
- [ ] Usuario no autorizado/bloqueado es rechazado según la política definida.
- [ ] La sesión persiste al recargar.
- [ ] Cerrar sesión funciona.

## Inventario
- [ ] Se cargan existencias reales.
- [ ] Búsqueda por código/QR/descripción funciona.
- [ ] Filtros funcionan.
- [ ] Ordenamiento de códigos es correcto.
- [ ] Actualización en tiempo real funciona.

## Operación
- [ ] Entradas funcionan.
- [ ] Salidas funcionan.
- [ ] Movimientos/historial funcionan.
- [ ] Aseo funciona.
- [ ] Herramientas funciona.
- [ ] Categorías adicionales usadas en producción funcionan.

## Análisis y valoración
- [ ] Panel de análisis abre y calcula correctamente.
- [ ] Valoración actual funciona.
- [ ] Cierres/valoraciones mensuales usadas por el negocio funcionan.

## Excel
- [ ] Botón Exportar está habilitado donde corresponde.
- [ ] Se descarga un `.xlsx`.
- [ ] Excel abre el archivo sin advertencias de corrupción.
- [ ] Resumen correcto.
- [ ] Entradas correctas.
- [ ] Salidas correctas.
- [ ] Consolidado correcto.
- [ ] Totales correctos.
- [ ] Logo/formato visual correcto.

## Conectividad
- [ ] La aplicación se comporta correctamente al perder conexión.
- [ ] Al recuperar conexión, Firestore sincroniza.
- [ ] Varias pestañas no generan errores de persistencia.

## Seguridad
- [ ] `npm run test:rules` pasa.
- [ ] Reglas revisadas contra los roles reales de producción.
- [ ] Se confirmó compatibilidad con cualquier app Electron/Android que use el mismo Firestore.
- [ ] App Check evaluado antes de activar enforcement.
- [ ] No hay `.env.local` ni credenciales privadas en el paquete/publicación.

## Producción
- [ ] Dominio/Hosting correcto.
- [ ] Recargar una ruta funciona sin 404.
- [ ] Assets cargan correctamente.
- [ ] Se probó desde Chrome/Edge en PC.
- [ ] Se probó desde un móvil si será utilizado allí.

Cuando todos los puntos aplicables estén marcados, la versión puede considerarse aceptada para producción.
