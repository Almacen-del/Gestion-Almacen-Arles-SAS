/** Arles: avisos de vencimiento. Firestore SOLO LECTURA. Instalar una única copia. */
const EXPIRY_CONFIG = Object.freeze({
  projectId: 'arles-gestion',
  sender: 'almacen@arlessas.com',
  recipients: Object.freeze([
    'ljgomez@arlessas.com',
    'aimbachi@arlessas.com',
    'vivero@arlessas.com',
    'dir.vivero@arlessas.com',
    'dir.siembrasnuevas@arlessas.com',
  ]),
  timeZone: 'America/Bogota',
  webUrl: 'https://gestion-almacen-arles-sas.vercel.app/',
  maxLots: 1000,
});
const EXPIRY_PREFIX = 'expiry.v1.';

function expiryAccount_() {
  if (Session.getEffectiveUser().getEmail().toLowerCase() !== EXPIRY_CONFIG.sender) {
    throw new Error('Ejecuta y autoriza este proyecto con ' + EXPIRY_CONFIG.sender + '.');
  }
}

function expiryToday_() {
  return Utilities.formatDate(new Date(), EXPIRY_CONFIG.timeZone, 'yyyy-MM-dd');
}

function expiryUtc_(value) {
  const match = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(value);
  if (!match) return NaN;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = match[3] ? Number(match[3]) : new Date(Date.UTC(year, month, 0)).getUTCDate();
  const time = Date.UTC(year, month - 1, day);
  const date = new Date(time);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day ? time : NaN;
}

// Rangos, no igualdad exacta: si un lote se registra a 12 días, avisa en el nivel 15.
// Solo el nivel vigente; no envía de golpe todos los avisos anteriores.
function expiryStage_(days) {
  if (!Number.isFinite(days) || days > 60) return 0;
  if (days < 0) return 5;
  if (days <= 7) return 4;
  if (days <= 15) return 3;
  if (days <= 30) return 2;
  return 1;
}

function expiryTextField_(fields, name) {
  const value = fields[name];
  return value && typeof value.stringValue === 'string' ? value.stringValue.trim() : '';
}

function expiryReadLots_() {
  const response = UrlFetchApp.fetch(
    'https://firestore.googleapis.com/v1/projects/' + EXPIRY_CONFIG.projectId
      + '/databases/(default)/documents:runQuery',
    {
      method: 'post', // runQuery es una lectura; no escribe documentos.
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      payload: JSON.stringify({ structuredQuery: {
        from: [{ collectionId: 'lotes_agroquimicos', allDescendants: true }],
        select: { fields: [
          'producto_id', 'codigo_producto', 'producto', 'numero_lote',
          'fecha_vencimiento', 'cantidad_disponible', 'unidad',
        ].map((fieldPath) => ({ fieldPath })) },
        limit: EXPIRY_CONFIG.maxLots + 1,
      } }),
      muteHttpExceptions: true,
    },
  );
  if (response.getResponseCode() !== 200) {
    // No registrar tokens ni el cuerpo de una respuesta de autenticación.
    throw new Error('Lectura de Firestore fallida (HTTP ' + response.getResponseCode()
      + '). Revisa autorización OAuth y permisos de lectura IAM. No se enviaron avisos.');
  }
  const result = JSON.parse(response.getContentText());
  if (!Array.isArray(result) || result.some((row) => row.error)) {
    throw new Error('Firestore no devolvió una consulta completa. No se enviaron avisos.');
  }
  const documents = result.filter((row) => row.document).map((row) => row.document);
  if (documents.length > EXPIRY_CONFIG.maxLots) {
    throw new Error('Se alcanzó el límite de lectura de lotes. No enviar un informe truncado.');
  }
  const prefix = 'projects/' + EXPIRY_CONFIG.projectId + '/databases/(default)/documents/';
  const lots = [];
  const issues = [];
  documents.forEach((document) => {
    const path = String(document.name || '').slice(prefix.length);
    const parts = path.split('/');
    if (!String(document.name || '').startsWith(prefix) || parts.length !== 4
      || parts[0] !== 'existencias' || parts[2] !== 'lotes_agroquimicos') {
      issues.push('Ruta de lote fuera del contrato: ' + path);
      return;
    }
    const fields = document.fields || {};
    const rawQuantity = fields.cantidad_disponible || {};
    const quantity = Number(rawQuantity.doubleValue === undefined
      ? rawQuantity.integerValue : rawQuantity.doubleValue);
    if (quantity === 0) return;
    const productId = expiryTextField_(fields, 'producto_id');
    const lot = {
      path,
      productId: parts[1],
      code: expiryTextField_(fields, 'codigo_producto'),
      name: expiryTextField_(fields, 'producto'),
      lotNumber: expiryTextField_(fields, 'numero_lote'),
      expiration: expiryTextField_(fields, 'fecha_vencimiento'),
      quantity,
      unit: expiryTextField_(fields, 'unidad'),
    };
    if (!Number.isFinite(quantity) || quantity < 0 || productId !== lot.productId
      || !lot.code || !lot.name || !lot.lotNumber || !lot.unit
      || !Number.isFinite(expiryUtc_(lot.expiration))) {
      issues.push('Datos de lote incompletos o inválidos: ' + path);
      return;
    }
    lots.push(lot);
  });
  // No inferir cantidades ni omitir silenciosamente lotes activos mal registrados.
  if (issues.length) throw new Error(issues.join('\n') + '\nNo se enviaron avisos.');
  return { lots, readCount: documents.length };
}

function expiryHash_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8)
    .map((byte) => ('0' + ((byte + 256) % 256).toString(16)).slice(-2)).join('');
}

function expiryKey_(lot, recipient) {
  // No incluye cantidad ni fecha: corregir la fecha o reponer saldo NO repite el vencido.
  // La identidad física es producto + número de lote (no solo código comercial).
  const lotNumber = lot.lotNumber.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return EXPIRY_PREFIX + 'lot.' + expiryHash_(JSON.stringify([lot.productId, lotNumber, recipient]));
}

function expiryPlan_(lots, today, recipient, properties) {
  const cutoff = expiryUtc_(today);
  if (!Number.isFinite(cutoff)) throw new Error('Fecha de revisión inválida.');
  const grouped = {};
  lots.forEach((lot) => {
    if (!(lot.quantity > 0)) return;
    const days = Math.floor((expiryUtc_(lot.expiration) - cutoff) / 86400000);
    const stage = expiryStage_(days);
    if (!stage) return;
    const key = expiryKey_(lot, recipient);
    const previous = properties[key] ? JSON.parse(properties[key]) : null;
    if (previous && (!Number.isInteger(previous.stage) || previous.stage < 1
      || previous.stage > 5 || !['reserved', 'sent'].includes(previous.status))) {
      throw new Error('Historial de avisos inválido; revisar antes de enviar.');
    }
    // Reservado significa resultado incierto: bloquear, nunca reintentar a ciegas.
    if (previous && (previous.status === 'reserved' || previous.stage >= stage)) return;
    if (grouped[key]) {
      const other = grouped[key];
      if (other.expiration !== lot.expiration || other.unit !== lot.unit) {
        throw new Error('Un mismo lote tiene fechas o unidades contradictorias: ' + lot.code + ' / ' + lot.lotNumber);
      }
      other.quantity += lot.quantity;
    } else grouped[key] = Object.assign({}, lot, { key, days, stage });
  });
  return Object.values(grouped).sort((a, b) => a.days - b.days || a.code.localeCompare(b.code));
}

function expiryEscape_(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function expiryStatus_(row) {
  return row.days < 0 ? 'VENCIDO · hace ' + Math.abs(row.days) + ' días'
    : row.days === 0 ? 'Vence hoy' : 'Vence en ' + row.days + ' días';
}

function expirySignatureBlob_() {
  return Utilities.newBlob(Utilities.base64Decode(EXPIRY_SIGNATURE_BASE64),
    'image/png', 'firma-avisos-arles.png');
}

function expiryMessage_(rows, today, preview) {
  const number = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 8 });
  const headers = ['Código', 'Producto', 'Lote', 'Vencimiento', 'Disponible', 'Estado'];
  const cells = rows.map((row) => [row.code, row.name, row.lotNumber,
    row.expiration + (row.expiration.length === 7 ? ' (mes según etiqueta)' : ''),
    number.format(row.quantity) + ' ' + row.unit, expiryStatus_(row)]);
  const note = 'Cantidad disponible al consultar Firestore; puede cambiar después por salidas.'
    + ' Las fechas sin día se consideran vigentes hasta el último día del mes.'
    + ' Los vencidos se notifican una sola vez por lote y destinatario.';
  const subject = (preview ? '[PRUEBA - SOLO ALMACÉN] ' : '')
    + 'Arles | Vencimientos de agroquímicos | ' + today + ' | ' + rows.length + ' lotes';
  const intro = preview ? 'Prueba: no se ha enviado a ingenieros ni administrativos.' : 'Novedades de vencimiento';
  const body = [intro, today + ' · Hora de Colombia',
    cells.map((row) => row.join(' | ')).join('\n') || 'No hay lotes en los próximos 60 días ni vencidos con saldo.',
    note, EXPIRY_CONFIG.webUrl,
    'GENERADOR AUTOMATICO DE AVISOS Y ALERTAS\nGESTION DE ALMACEN'].join('\n\n');
  const htmlBody = '<div style="font-family:Arial,sans-serif;color:#174b36;max-width:950px">'
    + '<h2>' + expiryEscape_(intro) + '</h2><p>' + expiryEscape_(today) + ' · Hora de Colombia</p>'
    + '<table style="border-collapse:collapse;width:100%"><thead><tr>'
    + headers.map((value) => '<th style="background:#08783e;color:white;padding:10px;text-align:left">'
      + value + '</th>').join('') + '</tr></thead><tbody>'
    + cells.map((row) => '<tr>' + row.map((value) => '<td style="padding:9px;border-bottom:1px solid #dce9e1">'
      + expiryEscape_(value) + '</td>').join('') + '</tr>').join('') + '</tbody></table>'
    + (!rows.length ? '<p>No hay lotes para notificar.</p>' : '')
    + '<p style="font-size:12px;color:#52645a">' + expiryEscape_(note) + '</p>'
    + '<p><a href="' + EXPIRY_CONFIG.webUrl + '">Consultar inventario en la web</a></p>'
    + '<div style="margin-top:24px;padding-top:16px;border-top:1px solid #dce9e1">'
    + '<img src="cid:arlesSignature" width="500" height="167" '
    + 'alt="GENERADOR AUTOMATICO DE AVISOS Y ALERTAS · GESTION DE ALMACEN" '
    + 'style="display:block;width:500px;max-width:100%;height:auto;border:0"></div></div>';
  return { subject, body, htmlBody, name: 'Almacén Arles · Vencimientos', replyTo: EXPIRY_CONFIG.sender,
    inlineImages: { arlesSignature: expirySignatureBlob_() } };
}

function expiryLock_(callback) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) throw new Error('Ya hay una revisión en ejecución.');
  try { return callback(); } finally { lock.releaseLock(); }
}

function expiryCheckCapacity_(properties, updates) {
  const combined = Object.assign({}, properties, updates);
  const size = Utilities.newBlob(JSON.stringify(combined)).getBytes().length;
  if (size > 430000) throw new Error('Historial de avisos cerca de su capacidad. No borrar: migrar antes de seguir.');
}

/** Solo lectura. No envía correos ni cambia el historial de notificaciones. */
function previsualizarAvisos() {
  expiryAccount_();
  const data = expiryReadLots_();
  const properties = PropertiesService.getScriptProperties().getProperties();
  const result = {
    fecha: expiryToday_(), lotesLeidos: data.readCount,
    avisos: EXPIRY_CONFIG.recipients.map((recipient) => ({
      destinatario: recipient,
      lotes: expiryPlan_(data.lots, expiryToday_(), recipient, properties)
        .map((row) => ({ codigo: row.code, producto: row.name, lote: row.lotNumber,
          vencimiento: row.expiration, disponible: row.quantity, unidad: row.unit, estado: expiryStatus_(row) })),
    })),
  };
  console.log(JSON.stringify(result));
  return result;
}

/** Prueba independiente: jamás consume el aviso único de los cinco destinatarios. */
function enviarPruebaAlmacen() {
  expiryAccount_();
  return expiryLock_(() => {
    const data = expiryReadLots_();
    const today = expiryToday_();
    const rows = expiryPlan_(data.lots, today, EXPIRY_CONFIG.sender, {});
    if (MailApp.getRemainingDailyQuota() < 1) throw new Error('Sin cuota de correo para la prueba.');
    MailApp.sendEmail(Object.assign({ to: EXPIRY_CONFIG.sender }, expiryMessage_(rows, today, true)));
    PropertiesService.getScriptProperties().setProperty(EXPIRY_PREFIX + 'test', new Date().toISOString());
    console.log('Prueba enviada solamente a ' + EXPIRY_CONFIG.sender + '.');
  });
}

/** Activar SOLO después de comprobar la recepción de la prueba. No envía inmediatamente. */
function activarAvisosDiarios() {
  expiryAccount_();
  return expiryLock_(() => {
    const store = PropertiesService.getScriptProperties();
    if (!store.getProperty(EXPIRY_PREFIX + 'test')) throw new Error('Primero envía y verifica la prueba a Almacén.');
    expiryReadLots_(); // Comprobar acceso antes de programar.
    const triggers = ScriptApp.getProjectTriggers().filter((trigger) => trigger.getHandlerFunction() === 'revisarVencimientosDiarios');
    if (!triggers.length) ScriptApp.newTrigger('revisarVencimientosDiarios').timeBased()
      .atHour(7).everyDays(1).inTimezone(EXPIRY_CONFIG.timeZone).create();
    triggers.slice(1).forEach((trigger) => ScriptApp.deleteTrigger(trigger));
    store.setProperty(EXPIRY_PREFIX + 'enabled', 'true');
    console.log('Activado: revisión diaria entre las 7 y 8 a. m. de Colombia.');
  });
}

function desactivarAvisosDiarios() {
  expiryAccount_();
  return expiryLock_(() => {
    PropertiesService.getScriptProperties().setProperty(EXPIRY_PREFIX + 'enabled', 'false');
    ScriptApp.getProjectTriggers().filter((trigger) => trigger.getHandlerFunction() === 'revisarVencimientosDiarios')
      .forEach((trigger) => ScriptApp.deleteTrigger(trigger));
    console.log('Desactivado. Historial conservado para no duplicar avisos al reactivar.');
  });
}

function revisarVencimientosDiarios() {
  expiryAccount_();
  return expiryLock_(() => {
    const store = PropertiesService.getScriptProperties();
    const properties = store.getProperties();
    if (properties[EXPIRY_PREFIX + 'enabled'] !== 'true') return { estado: 'desactivado' };
    const pending = Object.keys(properties).filter((key) => key.startsWith(EXPIRY_PREFIX + 'lot.')
      && JSON.parse(properties[key]).status === 'reserved');
    if (pending.length) throw new Error('Hay ' + pending.length
      + ' avisos con resultado incierto. Revisa verEstadoAvisos(); no se reenvían automáticamente.');
    const data = expiryReadLots_();
    const today = expiryToday_();
    const plans = EXPIRY_CONFIG.recipients.map((recipient) => ({ recipient,
      rows: expiryPlan_(data.lots, today, recipient, properties) })).filter((plan) => plan.rows.length);
    if (MailApp.getRemainingDailyQuota() < plans.length) throw new Error('Cuota insuficiente. No se inició el envío.');
    const run = new Date().toISOString();
    const reservations = {};
    plans.forEach((plan) => plan.rows.forEach((row) => {
      reservations[row.key] = JSON.stringify({ stage: row.stage, status: 'reserved', run,
        recipient: plan.recipient, code: row.code, lot: row.lotNumber });
    }));
    expiryCheckCapacity_(properties, reservations);
    let sent = 0;
    plans.forEach((plan) => {
      const message = expiryMessage_(plan.rows, today, false);
      if (Utilities.newBlob(message.htmlBody).getBytes().length > 180000) {
        throw new Error('Correo demasiado grande; no se envía un resumen truncado.');
      }
      const reserved = {};
      plan.rows.forEach((row) => { reserved[row.key] = reservations[row.key]; });
      // Primero reservar y comprobar persistencia. MailApp y Properties no son transaccionales.
      // Si el proceso cae después del envío, la reserva evita volver a enviarlo.
      store.setProperties(reserved);
      const persisted = store.getProperties();
      if (Object.keys(reserved).some((key) => persisted[key] !== reserved[key])) {
        throw new Error('No se pudo verificar la reserva. No se envía el correo.');
      }
      MailApp.sendEmail(Object.assign({ to: plan.recipient }, message));
      const confirmed = {};
      Object.keys(reserved).forEach((key) => {
        confirmed[key] = JSON.stringify(Object.assign(JSON.parse(reserved[key]), { status: 'sent' }));
      });
      store.setProperties(confirmed);
      sent += 1;
    });
    const result = { fecha: today, lotesLeidos: data.readCount, correosEnviados: sent };
    store.setProperty(EXPIRY_PREFIX + 'lastRun', JSON.stringify(result));
    console.log(JSON.stringify(result));
    return result;
  });
}

function verEstadoAvisos() {
  expiryAccount_();
  const properties = PropertiesService.getScriptProperties().getProperties();
  const result = {
    activo: properties[EXPIRY_PREFIX + 'enabled'] === 'true',
    ultimaRevision: properties[EXPIRY_PREFIX + 'lastRun'] || 'Sin revisión',
    ultimaPrueba: properties[EXPIRY_PREFIX + 'test'] || 'Sin prueba',
    pendientesDeRevision: Object.keys(properties).filter((key) => key.startsWith(EXPIRY_PREFIX + 'lot.'))
      .map((key) => Object.assign({ key }, JSON.parse(properties[key])))
      .filter((value) => value.status === 'reserved'),
  };
  console.log(JSON.stringify(result));
  return result;
}
