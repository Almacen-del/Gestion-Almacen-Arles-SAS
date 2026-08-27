const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');

const source = fs.readFileSync(path.join(__dirname, 'Code.gs'), 'utf8');
const signatureSource = fs.readFileSync(path.join(__dirname, 'SignatureAsset.gs'), 'utf8');
const prefix = 'expiry.v1.';
const sender = 'almacen@arlessas.com';
const recipients = ['ljgomez@arlessas.com', 'aimbachi@arlessas.com', 'vivero@arlessas.com',
  'dir.vivero@arlessas.com', 'dir.siembrasnuevas@arlessas.com'];

function document(overrides = {}, productId = 'product-1', lotId = 'LOT-1') {
  const values = { producto_id: productId, codigo_producto: 'FER001', producto: 'Producto de prueba',
    numero_lote: lotId, fecha_vencimiento: '2026-08-26', cantidad_disponible: 1250.25, unidad: 'GRAMO', ...overrides };
  return {
    name: 'projects/arles-gestion/databases/(default)/documents/existencias/' + productId
      + '/lotes_agroquimicos/' + lotId,
    fields: Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, typeof value === 'number' ? { doubleValue: value } : { stringValue: value }])),
  };
}

function harness(options = {}) {
  const state = { documents: [document()], properties: {}, outbox: [], fetches: [], logs: [],
    triggers: [], locked: false, now: '2026-08-27T12:30:00.000Z', ...options };
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [state.now])); }
    static now() { return new Date(state.now).getTime(); }
  }
  const store = {
    getProperties: () => ({ ...state.properties }),
    getProperty: (key) => state.properties[key] || null,
    setProperty: (key, value) => { state.properties[key] = value; },
    setProperties: (updates) => {
      if (state.failConfirmation && Object.values(updates).some((value) => JSON.parse(value).status === 'sent')) {
        throw new Error('Falló confirmación');
      }
      Object.assign(state.properties, updates);
    },
  };
  const context = vm.createContext({
    Date: Clock, Intl,
    console: { log: (message) => state.logs.push(message) },
    Session: { getEffectiveUser: () => ({ getEmail: () => state.account || sender }) },
    PropertiesService: { getScriptProperties: () => store },
    LockService: { getScriptLock: () => ({
      tryLock: () => { if (state.locked) return false; state.locked = true; return true; },
      releaseLock: () => { state.locked = false; },
    }) },
    Utilities: {
      formatDate: (date, zone) => new Intl.DateTimeFormat('en-CA', { timeZone: zone,
        year: 'numeric', month: '2-digit', day: '2-digit' }).format(date),
      DigestAlgorithm: { SHA_256: 'SHA_256' }, Charset: { UTF_8: 'UTF_8' },
      computeDigest: (_algorithm, value) => Array.from(createHash('sha256').update(value).digest()),
      base64Decode: (value) => Array.from(Buffer.from(value, 'base64')),
      newBlob: (value, contentType, name) => ({ getBytes: () => Array.from(Buffer.from(value)),
        getContentType: () => contentType, getName: () => name }),
    },
    ScriptApp: {
      getOAuthToken: () => 'FAKE_TEST_TOKEN',
      getProjectTriggers: () => state.triggers,
      deleteTrigger: (trigger) => { state.triggers = state.triggers.filter((entry) => entry !== trigger); },
      newTrigger: (handler) => {
        const settings = {};
        const builder = { timeBased: () => builder, atHour: (hour) => { settings.hour = hour; return builder; },
          everyDays: (days) => { settings.days = days; return builder; },
          inTimezone: (zone) => { settings.zone = zone; return builder; },
          create: () => state.triggers.push({ getHandlerFunction: () => handler, settings }) };
        return builder;
      },
    },
    UrlFetchApp: { fetch: (url, request) => {
      state.fetches.push({ url, request });
      return { getResponseCode: () => state.httpStatus || 200,
        getContentText: () => state.rawResponse || JSON.stringify(state.documents.map((doc) => ({ document: doc }))) };
    } },
    MailApp: {
      getRemainingDailyQuota: () => state.quota === undefined ? 100 : state.quota,
      sendEmail: (message) => {
        if (state.failSend) throw new Error('Envío incierto');
        state.outbox.push(message);
      },
    },
  });
  vm.runInContext(signatureSource, context);
  vm.runInContext(source, context);
  return { state, context, call: (name, ...args) => context[name](...args),
    enable: () => { state.properties[prefix + 'enabled'] = 'true'; } };
}

test('destinatarios exactos y remitente sin caracteres escapados', () => {
  const h = harness();
  h.enable();
  h.call('revisarVencimientosDiarios');
  assert.deepEqual(h.state.outbox.map((mail) => mail.to), recipients);
  assert.ok(h.state.outbox.every((mail) => mail.replyTo === sender));
});

test('niveles 60/30/15/7, fecha de hoy y vencido', () => {
  const h = harness();
  for (const [days, stage] of [[61, 0], [60, 1], [31, 1], [30, 2], [16, 2],
    [15, 3], [8, 3], [7, 4], [0, 4], [-1, 5], [-300, 5]]) {
    assert.equal(h.call('expiryStage_', days), stage);
  }
  assert.equal(h.call('expiryStage_', NaN), 0);
});

test('mes sin día, bisiesto y fechas imposibles', () => {
  const h = harness();
  assert.equal(h.call('expiryUtc_', '2028-02'), Date.UTC(2028, 1, 29));
  assert.equal(h.call('expiryUtc_', '2026-02'), Date.UTC(2026, 1, 28));
  for (const value of ['2026-02-29', '2026-13', '2026-00', '2026-04-31', '', '27/08/2026']) {
    assert.ok(Number.isNaN(h.call('expiryUtc_', value)));
  }
});

test('fecha de revisión usa Colombia y no el día UTC siguiente', () => {
  const h = harness({ now: '2026-08-28T02:00:00.000Z' });
  assert.equal(h.call('expiryToday_'), '2026-08-27');
});

test('vencido una vez aunque se repita la tarea varios días', () => {
  const h = harness();
  h.enable();
  h.call('revisarVencimientosDiarios');
  h.call('revisarVencimientosDiarios');
  h.state.now = '2026-09-02T12:30:00Z';
  h.call('revisarVencimientosDiarios');
  assert.equal(h.state.outbox.length, 5);
});

test('corregir fecha, reponer saldo o cambiar ID del documento no repite un vencido', () => {
  const h = harness();
  h.enable();
  h.call('revisarVencimientosDiarios');
  h.state.documents = [document({ fecha_vencimiento: '2026-08-25', cantidad_disponible: 9000 })];
  h.state.documents[0].name += '__fecha-corregida';
  h.call('revisarVencimientosDiarios');
  assert.equal(h.state.outbox.length, 5);
});

test('producto/lote distintos tienen avisos independientes', () => {
  const h = harness();
  h.enable();
  h.call('revisarVencimientosDiarios');
  h.state.documents.push(document({}, 'product-2', 'LOT-1'), document({}, 'product-1', 'LOT-2'));
  h.call('revisarVencimientosDiarios');
  assert.equal(h.state.outbox.length, 10);
  assert.ok(h.state.outbox[5].subject.includes('2 lotes'));
});

test('un lote nuevo dentro del rango manda solo el nivel actual y después el vencido', () => {
  const h = harness({ documents: [document({ fecha_vencimiento: '2026-09-08' })] });
  h.enable();
  h.call('revisarVencimientosDiarios'); // 12 días => nivel 15
  h.call('revisarVencimientosDiarios');
  assert.equal(h.state.outbox.length, 5);
  h.state.now = '2026-09-02T12:30:00Z'; // 6 días => nivel 7
  h.call('revisarVencimientosDiarios');
  assert.equal(h.state.outbox.length, 10);
  h.state.now = '2026-09-08T12:30:00Z'; // Vence hoy: no repetir nivel 7
  h.call('revisarVencimientosDiarios');
  assert.equal(h.state.outbox.length, 10);
  h.state.now = '2026-09-09T12:30:00Z';
  h.call('revisarVencimientosDiarios');
  assert.equal(h.state.outbox.length, 15);
});

test('agotados y más de 60 días no envían', () => {
  const h = harness({ documents: [document({ cantidad_disponible: 0 }),
    document({ fecha_vencimiento: '2027-01-01' }, 'product-2')] });
  h.enable();
  h.call('revisarVencimientosDiarios');
  assert.equal(h.state.outbox.length, 0);
});

test('precio no se consulta: cantidad real y unidad desde cada lote', () => {
  const h = harness({ documents: [document({ cantidad_disponible: 0.35, unidad: 'ML' })] });
  h.enable();
  h.call('revisarVencimientosDiarios');
  assert.ok(h.state.outbox[0].body.includes('0,35 ML'));
  assert.equal(h.state.fetches.length, 1);
  assert.ok(h.state.fetches[0].url.endsWith('/documents:runQuery'));
  assert.equal(h.state.fetches[0].request.method, 'post');
  assert.ok(!h.state.fetches[0].request.payload.includes('precio'));
});

test('faltantes, negativos y fechas inválidas detienen los envíos', () => {
  for (const fields of [{ cantidad_disponible: undefined }, { cantidad_disponible: -1 },
    { fecha_vencimiento: '2026-02-30' }, { producto_id: 'other' }, { unidad: '' }]) {
    const h = harness({ documents: [document(fields)] });
    h.enable();
    assert.throws(() => h.call('revisarVencimientosDiarios'), /incompletos o inválidos/);
    assert.equal(h.state.outbox.length, 0);
    assert.equal(h.state.locked, false);
  }
});

test('no aceptar lotes de otra ruta de Firestore', () => {
  const doc = document();
  doc.name = doc.name.replace('/existencias/', '/taller/');
  const h = harness({ documents: [doc] });
  h.enable();
  assert.throws(() => h.call('revisarVencimientosDiarios'), /fuera del contrato/);
});

test('sin autorización o consulta incompleta no hay envío', () => {
  for (const options of [{ httpStatus: 403 }, { rawResponse: '{"error":{}}' },
    { rawResponse: '[{"error":{"status":"UNAVAILABLE"}}]' }]) {
    const h = harness(options);
    h.enable();
    assert.throws(() => h.call('revisarVencimientosDiarios'));
    assert.equal(h.state.outbox.length, 0);
    assert.ok(!h.state.logs.join('').includes('FAKE_TEST_TOKEN'));
  }
});

test('límite de seguridad evita informes truncados', () => {
  const h = harness({ documents: Array.from({ length: 1001 }, (_, index) => document({}, 'p-' + index)) });
  h.enable();
  assert.throws(() => h.call('revisarVencimientosDiarios'), /límite de lectura/);
  assert.equal(h.state.outbox.length, 0);
});

test('escapa HTML no confiable en el correo', () => {
  const h = harness({ documents: [document({ producto: '<img src=x onerror="alert(1)">' })] });
  h.call('enviarPruebaAlmacen');
  assert.equal((h.state.outbox[0].htmlBody.match(/<img /g) || []).length, 1);
  assert.ok(!h.state.outbox[0].htmlBody.includes('<img src=x'));
  assert.ok(h.state.outbox[0].htmlBody.includes('&lt;img'));
});

test('firma final incrustada idéntica al PNG aprobado, sin descargar imágenes externas', () => {
  const h = harness();
  h.call('enviarPruebaAlmacen');
  const message = h.state.outbox[0];
  const signature = message.inlineImages.arlesSignature;
  const original = fs.readFileSync(path.join(__dirname, 'assets', 'firma-avisos-arles.png'));
  const actual = Buffer.from(signature.getBytes());
  assert.equal(createHash('sha256').update(actual).digest('hex'),
    createHash('sha256').update(original).digest('hex'));
  assert.equal(signature.getContentType(), 'image/png');
  assert.equal(signature.getName(), 'firma-avisos-arles.png');
  assert.ok(message.htmlBody.indexOf('cid:arlesSignature') > message.htmlBody.indexOf('Consultar inventario'));
  assert.ok(message.htmlBody.includes('max-width:100%;height:auto'));
  assert.ok(message.htmlBody.includes('width="500" height="167"'));
  assert.ok(message.htmlBody.includes('width:500px;max-width:100%'));
  assert.ok(message.body.endsWith('GENERADOR AUTOMATICO DE AVISOS Y ALERTAS\nGESTION DE ALMACEN'));
  assert.equal(h.state.fetches.length, 1);
  assert.ok(h.state.fetches[0].url.includes('firestore.googleapis.com'));
});

test('prueba solo a almacén y no consume el aviso del grupo', () => {
  const h = harness();
  h.call('enviarPruebaAlmacen');
  assert.equal(h.state.outbox.length, 1);
  assert.equal(h.state.outbox[0].to, sender);
  assert.ok(h.state.outbox[0].subject.includes('PRUEBA'));
  assert.equal(Object.keys(h.state.properties).filter((key) => key.includes('.lot.')).length, 0);
  h.enable();
  h.call('revisarVencimientosDiarios');
  assert.equal(h.state.outbox.length, 6);
});

test('previsualizar es solo lectura y por defecto está desactivado', () => {
  const h = harness();
  h.call('previsualizarAvisos');
  h.call('revisarVencimientosDiarios');
  assert.equal(h.state.outbox.length, 0);
  assert.deepEqual(h.state.properties, {});
});

test('cuenta distinta no lee Firestore ni envía correos', () => {
  const h = harness({ account: 'other@example.com' });
  assert.throws(() => h.call('enviarPruebaAlmacen'), /Ejecuta y autoriza/);
  assert.equal(h.state.fetches.length, 0);
});

test('cuota insuficiente no reserva avisos ni envía parcialmente', () => {
  const h = harness({ quota: 4 });
  h.enable();
  assert.throws(() => h.call('revisarVencimientosDiarios'), /Cuota insuficiente/);
  assert.equal(Object.keys(h.state.properties).length, 1);
  assert.equal(h.state.outbox.length, 0);
});

test('bloqueo impide dos ejecuciones simultáneas', () => {
  const h = harness({ locked: true });
  h.enable();
  assert.throws(() => h.call('revisarVencimientosDiarios'), /en ejecución/);
  assert.equal(h.state.fetches.length, 0);
});

test('fallo de envío conserva reserva y no reintenta automáticamente', () => {
  const h = harness({ failSend: true });
  h.enable();
  assert.throws(() => h.call('revisarVencimientosDiarios'), /Envío incierto/);
  h.state.failSend = false;
  assert.throws(() => h.call('revisarVencimientosDiarios'), /resultado incierto/);
  assert.equal(h.state.outbox.length, 0);
  assert.equal(h.call('verEstadoAvisos').pendientesDeRevision.length, 1);
});

test('caída después del envío no duplica el correo', () => {
  const h = harness({ failConfirmation: true });
  h.enable();
  assert.throws(() => h.call('revisarVencimientosDiarios'), /Falló confirmación/);
  assert.equal(h.state.outbox.length, 1);
  h.state.failConfirmation = false;
  assert.throws(() => h.call('revisarVencimientosDiarios'), /resultado incierto/);
  assert.equal(h.state.outbox.length, 1);
});

test('activar requiere prueba, es idempotente y programa la zona acordada', () => {
  const h = harness();
  assert.throws(() => h.call('activarAvisosDiarios'), /Primero envía/);
  h.call('enviarPruebaAlmacen');
  h.call('activarAvisosDiarios');
  h.call('activarAvisosDiarios');
  assert.equal(h.state.triggers.length, 1);
  assert.deepEqual(h.state.triggers[0].settings, { hour: 7, days: 1, zone: 'America/Bogota' });
  assert.equal(h.state.outbox.length, 1);
});

test('pausar y reactivar conserva el aviso único', () => {
  const h = harness();
  h.call('enviarPruebaAlmacen');
  h.call('activarAvisosDiarios');
  h.call('revisarVencimientosDiarios');
  h.call('desactivarAvisosDiarios');
  assert.equal(h.state.triggers.length, 0);
  h.call('activarAvisosDiarios');
  h.call('revisarVencimientosDiarios');
  assert.equal(h.state.outbox.length, 6);
});

test('no descartar el historial si se llena el almacenamiento', () => {
  const h = harness();
  h.state.properties.legacy = 'x'.repeat(431000);
  h.enable();
  assert.throws(() => h.call('revisarVencimientosDiarios'), /capacidad/);
  assert.equal(h.state.outbox.length, 0);
  assert.equal(h.state.properties.legacy.length, 431000);
});

test('manifiesto no pide leer Gmail ni Drive ni credenciales privadas', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'appsscript.json'), 'utf8'));
  assert.equal(manifest.timeZone, 'America/Bogota');
  assert.ok(!manifest.oauthScopes.some((scope) => /gmail|drive|cloud-platform/.test(scope)));
  assert.ok(manifest.oauthScopes.includes('https://www.googleapis.com/auth/script.send_mail'));
  assert.ok(!source.includes('private_key'));
});
