# Avisos por correo de vencimientos · Arles

Estado al 27/08/2026: código y manifiesto cargados en el proyecto
[Arles · Avisos de vencimientos](https://script.google.com/home/projects/1Qa_FViKzukdTGgyMQKVNKR9bpUZpwwdwVZmiqnSULMQt1Rv0hayhdxqN/edit),
bajo `almacen@arlessas.com`. El usuario completó la autorización y confirmó la consulta
y la recepción del primer correo de prueba. El 27/08/2026 a las 07:13:41 (Colombia)
se confirmó en Apps Script un nuevo envío de prueba solo a Almacén, con un ajuste visual
para modo oscuro. El usuario indicó que no funcionó y solicitó restaurar el diseño original;
ese ajuste se revirtió, sin cambiar las alertas ni enviar otra prueba.
La última firma aprobada (`assets/firma-avisos-arles.png`) se incorporó al final del correo.
El 27/08/2026 a las 07:51:33 se confirmó en Apps Script el envío de una prueba con firma
reducida a 500 px solo a `almacen@arlessas.com`; el usuario confirmó recepción y diseño.
Con autorización expresa del usuario, el programador diario se activó el 27/08/2026
a las 07:56:16 (Colombia). Se verificó `activo: true`, sin reservas pendientes y un único
activador `revisarVencimientosDiarios`, diario entre 7 y 8 a. m. (GMT-05:00).
La activación no envió correos al grupo; la primera revisión programada sigue pendiente.
Las notificaciones de fallo del activador quedaron habilitadas una vez por día.
La restricción IAM a solo lectura sigue sin verificar; la consulta exitosa no demuestra esa restricción.
Las 27 pruebas locales pasaron con servicios simulados, incluida igualdad SHA-256 entre
la imagen incrustada y la aprobada. Subir la web a Vercel no activa este script.

## Configuración acordada

- Remitente/propietario: `almacen@arlessas.com` (Google Workspace).
- Destinatarios: `ljgomez@arlessas.com`, `aimbachi@arlessas.com`, `vivero@arlessas.com`,
  `dir.vivero@arlessas.com`, `dir.siembrasnuevas@arlessas.com`.
- Una revisión diaria, entre 7 y 8 a. m., `America/Bogota`. La hora exacta depende de Google.
- Niveles: hasta 60, 30, 15, 7 días y vencido. Un correo por destinatario agrupa las novedades.
- **Vencido: un solo aviso por producto/lote y destinatario, nunca recordatorios diarios.**
- Si se activa con un lote a 12 días, envía solo el aviso del nivel 15; no los de 60 y 30.
- Fecha de hoy: "vence hoy", aún vigente como en la web. Pasa a vencido al día siguiente.
- Una fecha `AAAA-MM` conserva su precisión y vence al terminar el mes, como en `agrochemicalLots.ts`.
- Solo cantidades disponibles positivas leídas de cada lote. No suma existencias de otros lotes.
- Agotados fuera. Datos activos incompletos, respuestas fallidas o >1.000 lotes bloquean el envío
  y dejan un error visible en Ejecuciones; no hay cantidades o fechas inferidas.
- Presentación original: cabecera verde simple, sin ajustes para forzar el modo oscuro.
  Los lectores de correo pueden transformar sus colores. No modifica correos ya recibidos.
- Firma final: PNG aprobado, incrustado mediante `inlineImages` y `cid:arlesSignature`,
  mostrado a 500 × 167 px y adaptable al ancho disponible. No descarga recursos externos,
  no publica la imagen y no añade permisos OAuth. También se incluye su texto en la versión
  de texto plano. No añade ningún destinatario ni cambia la política de aviso único.

## Seguridad y almacenamiento

Solo se consulta `existencias/{id}/lotes_agroquimicos/{id}` mediante Firestore REST `runQuery`.
No se escriben inventarios, precios, movimientos, reglas ni cierres mensuales.
El script no usa claves privadas, contraseñas Firebase ni archivos de credenciales.
El token OAuth se obtiene de Google durante la ejecución y no se registra.

La cuenta Google debe tener acceso IAM de lectura a la base `arles-gestion`.
Ser administrador **dentro de la web** no otorga este permiso IAM automáticamente.
Si falta, un administrador del proyecto debe conceder el acceso mínimo de lectura
correspondiente (por ejemplo, `roles/datastore.viewer`, que permite leer la base,
no únicamente los lotes). No conceder Editor/Owner ni abrir las reglas de Firestore.
La autorización OAuth usa IAM, no las reglas de seguridad de usuarios Firebase.
Revisar este alcance con el administrador antes de conceder permisos.

El historial de avisos se conserva en Propiedades del script, no en Firestore.
No borrar esas propiedades, copiar el proyecto para activarlo de nuevo ni instalar varias copias:
se perdería la protección contra avisos duplicados entre instalaciones.
Solo el propietario debe editar el proyecto. Pausar/reactivar conserva el historial.

## Instalación y prueba (con el usuario presente)

1. Abrir el proyecto enlazado arriba con `almacen@arlessas.com` (ya creado).
   Para una instalación inicial en otro entorno, crear un proyecto llamado
   **Arles · Avisos de vencimientos**; nunca mantener dos copias activas. No es una app web pública.
2. Copiar `Code.gs` al archivo de código del proyecto y agregar **`SignatureAsset.gs`**
   como otro archivo de secuencia de comandos. Ambos ya están cargados en el proyecto enlazado.
   El segundo contiene la imagen aprobada en base64, no credenciales.
3. En Configuración del proyecto, mostrar el manifiesto `appsscript.json` en el editor
   y reemplazar su contenido por el manifiesto de esta carpeta.
4. Ejecutar `previsualizarAvisos`. Google pedirá autorización. El propietario revisa y autoriza.
   Esta función lee los lotes y muestra el informe, pero NO envía correo.
   Si Google devuelve un 403, comprobar IAM y que Firestore API esté habilitada en el
   proyecto Google Cloud utilizado por el script; no cambiar reglas ni agregar claves.
5. Ejecutar `enviarPruebaAlmacen`. Se envía **solo a almacen@arlessas.com**, con asunto PRUEBA.
   No consume los avisos únicos del grupo. Revisar recepción, cantidades, lotes y formato.
6. **Solo después de verificar la prueba**, ejecutar `activarAvisosDiarios`.
   Instala un único activador diario; no envía al grupo inmediatamente.
7. Revisar `verEstadoAvisos` y la sección Ejecuciones. Conservar los correos automáticos
   de fallo de activadores de Google. No ocultar fallos de permisos/cuota.

Para pausar: `desactivarAvisosDiarios`. Para consultar sin enviar: `previsualizarAvisos`.
Los destinatarios se editan en `EXPIRY_CONFIG.recipients`; modificar el remitente exige
instalar/autorizar con la cuenta correspondiente y conservar el historial.

## Caídas y duplicados

El envío de correo y la escritura del historial no pueden formar una transacción conjunta.
Antes de enviar se reserva cada aviso bajo un bloqueo de ejecución. Si el envío o su
confirmación falla, queda `reserved`: se detienen los envíos siguientes y **no se reintenta
automáticamente**, porque el destinatario podría haber recibido ya el correo.
`verEstadoAvisos` muestra destinatario, código, lote y hora afectados. El administrador
debe confirmar recepción/resultado con el destinatario antes de resolver esa reserva.
No borrar historial ni forzar reenvíos a ciegas. Se prioriza no duplicar, no se promete entrega
exactamente una vez ni entrega garantizada al buzón (puede existir spam o rechazo externo).

El aviso vencido no se reinicia al corregir la fecha o reponer cantidad del mismo número
de lote/producto. Un lote distinto del mismo producto tiene sus avisos independientes.

## Verificación local sin servicios reales

```powershell
node integrations/expiry-alerts/build-signature.cjs
node --test integrations/expiry-alerts/verify.cjs
```

`build-signature.cjs` genera mecánicamente `SignatureAsset.gs` desde el PNG aprobado,
sin red ni modificación de la imagen. Si cambia la firma, regenerar y actualizar ese
archivo en Apps Script. No guardar la imagen en Propiedades del script (límite de tamaño).

Las pruebas simulan Firestore, MailApp, PropertiesService, bloqueos y activadores:
no tienen credenciales ni hacen solicitudes externas.

Referencias oficiales consultadas:

- [Autenticación REST de Firestore](https://firebase.google.com/docs/firestore/use-rest-api)
- [Activadores de Apps Script](https://developers.google.com/apps-script/guides/triggers/installable)
- [Cuotas](https://developers.google.com/apps-script/guides/services/quotas)
- [MailApp](https://developers.google.com/apps-script/reference/mail/mail-app)
