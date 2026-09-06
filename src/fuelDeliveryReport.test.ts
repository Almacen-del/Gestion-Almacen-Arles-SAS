import { describe, expect, it } from 'vitest';
import { createFuelDeliveryRows, fuelDateSerial, fuelRecipientCompany } from './fuelDeliveryReport';
import { crearReporteMovimientos, type MovimientoParaReporte } from './reporteMovimientosExcel';

export const fuelMovement = (overrides: Partial<MovimientoParaReporte> = {}): MovimientoParaReporte => ({
  id: 'fuel-1', modulo: 'Combustible', tipo: 'Salida', codigo: 'ACPM2', descripcion: 'Líquidos',
  referencia: 'ACPM', cantidad: 10.9, unidad: 'Galones', fecha: '2026-07-16 13:03',
  solicitante: 'Yeiler Avilorio', cargo: '', usuario: 'warehouse-test', observaciones: 'Cal lote 24',
  fotoUrl: '', maquinaria: 'Tractor 3', horometro: '1234,5', labor: 'Rotospeed', destinationLot: '24', ...overrides,
});
export const fuelUsers = {
  'warehouse-test': { nombre: 'Felipe Estrada', cargo: 'Asistente de almacén', email: 'almacen@example.test' },
  'workshop-test': { nombre: 'Duvan Castellanos', cargo: 'Auxiliar de taller', email: 'taller@example.test' },
};

describe('GA-F-006: datos del movimiento de combustible', () => {
  it('usa el autor de cada salida, nunca el solicitante ni quien exporta', () => {
    const rows = createFuelDeliveryRows([fuelMovement(), fuelMovement({ id: 'fuel-2', usuario: 'workshop-test' })], fuelUsers);
    expect(rows.map(row => row.deliverer)).toEqual(['Felipe Estrada', 'Duvan Castellanos']);
    expect(rows[0]).toMatchObject({ receiver: 'Yeiler Avilorio', company: 'ARLES SAS', destination: '24', observations: 'Cal lote 24', gallons: 10.9 });
  });
  it('da prioridad al UID explícito y resuelve correos y alias antiguos solo sin ambigüedad', () => {
    expect(createFuelDeliveryRows([fuelMovement({ usuario: 'Nombre antiguo', usuarioUid: 'workshop-test' })], fuelUsers)[0].deliverer).toBe('Duvan Castellanos');
    expect(createFuelDeliveryRows([fuelMovement({ usuario: 'ALMACEN@example.test' })], fuelUsers)[0].deliverer).toBe('Felipe Estrada');
    expect(createFuelDeliveryRows([fuelMovement({ usuario: 'Felipe (Asistente de almacén)' })], fuelUsers)[0].deliverer).toBe('Felipe Estrada');
    expect(() => createFuelDeliveryRows([fuelMovement({ usuario: 'abcdefghijklmnopqrstuv123456' })], fuelUsers)).toThrow('perfil del usuario');
  });
  it('separa la empresa únicamente de la indicación explícita del solicitante', () => {
    expect(fuelRecipientCompany('Ana Pérez (empresa CONTRATISTA SAS)')).toEqual({ recipient: 'Ana Pérez', company: 'CONTRATISTA SAS' });
    expect(fuelRecipientCompany('Ana (EMPRESA Árbol & Campo) (operadora)')).toEqual({ recipient: 'Ana (operadora)', company: 'Árbol & Campo' });
    expect(fuelRecipientCompany('Ana empresa Campo')).toEqual({ recipient: 'Ana empresa Campo', company: 'ARLES SAS' });
    expect(fuelRecipientCompany('Ana (empresa )').company).toBe('ARLES SAS');
    expect(() => fuelRecipientCompany('Ana (empresa Uno) (empresa Dos)')).toThrow('más de una empresa');
    const row = createFuelDeliveryRows([fuelMovement({ solicitante: 'Ana (empresa Campo SAS)', observaciones: '(empresa NO CAMBIAR)' })], fuelUsers)[0];
    expect(row).toMatchObject({ receiver: 'Ana', company: 'Campo SAS', observations: '(empresa NO CAMBIAR)' });
  });
  it('solo ACPM y gasolina del módulo combustible, sin clasificar por observaciones ni código ambiguo', () => {
    const rows = createFuelDeliveryRows([
      fuelMovement(), fuelMovement({ id: 'gas', referencia: 'Gasolina' }),
      fuelMovement({ id: 'urea', referencia: 'Urea', observaciones: 'Para tanque ACPM' }),
      fuelMovement({ id: 'oil', referencia: 'Aceite', descripcion: 'Bomba ACPM' }),
      fuelMovement({ id: 'tool', modulo: 'TALLER', referencia: 'ACPM' }),
    ], fuelUsers);
    expect(rows).toHaveLength(2);
    expect(rows.map(row => row.fuel)).toEqual(['ACPM', 'Gasolina']);
  });
  it('las entradas llevan Entrada en observaciones, quien registra recibe y no se inventa un proveedor', () => {
    const row = createFuelDeliveryRows([fuelMovement({ tipo: 'Entrada', observaciones: 'Ingreso proveedor', entregaEntrada: '', solicitante: '' })], fuelUsers)[0];
    expect(row).toMatchObject({ kind: 'Entrada', observations: 'Entrada', receiver: 'Felipe Estrada', deliverer: '', destination: '' });
    expect(createFuelDeliveryRows([fuelMovement({ tipo: 'Entrada', proveedor: 'Proveedor guardado' })], fuelUsers)[0].deliverer).toBe('Proveedor guardado');
  });
  it('conserva los campos operativos; no usa lote de fabricación ni ubicación física como destino', () => {
    const row = createFuelDeliveryRows([fuelMovement({ placaSerial: 'ABC012', destinationLot: '', observaciones: '', lote: 'FAB-1', ubicacion: 'Caseta', labor: '' })], fuelUsers)[0];
    expect(row).toMatchObject({ plate: 'ABC012', machinery: 'Tractor 3', hourMeter: '1234,5', destination: '' });
    expect(createFuelDeliveryRows([fuelMovement({ destinationLot: '', observaciones: 'Sanidad Lote 24,25,10,10B' })], fuelUsers)[0].destination).toBe('10, 10B, 24 y 25');
    expect(createFuelDeliveryRows([fuelMovement({ destinationLot: 'California' })], fuelUsers)[0].destination).toBe('California');
  });
  it.each(['Litros', 'Unidad', ''])('no etiqueta como galones una cantidad en %s', unidad => {
    expect(() => createFuelDeliveryRows([fuelMovement({ unidad })], fuelUsers)).toThrow('no en galones');
  });
  it.each([NaN, Infinity, -1, 0])('rechaza cantidades inválidas %s', cantidad => {
    expect(() => createFuelDeliveryRows([fuelMovement({ cantidad })], fuelUsers)).toThrow('Cantidad inválida');
  });
  it('conserva la fecha del movimiento, maneja Colombia y rechaza fechas imposibles', () => {
    expect(fuelDateSerial('2026-08-20T01:00:00Z')).toBe(fuelDateSerial('19/08/2026'));
    expect(fuelDateSerial('2026-06-12 07:00')).toBe(fuelDateSerial('12/06/2026'));
    for (const raw of ['', '2026-02-30', '2026-12', '31/04/2026']) expect(() => fuelDateSerial(raw)).toThrow('Fecha');
  });
  it('adjunta al exportador el contenido completo y no las observaciones resumidas genéricas', () => {
    const payload = crearReporteMovimientos({ moduleName: 'Combustible', movimientos: [fuelMovement()], usuarios: fuelUsers,
      periodLabel: '', exportDate: '', generatedBy: 'Otra persona', coverageLabel: '' });
    expect(payload.suggestedFileName).toBe('GA-F-006_Control_Combustible.xlsx');
    expect(payload.fuelDeliveryRows?.[0].observations).toBe('Cal lote 24');
    expect(payload.fuelDeliveryRows?.[0].deliverer).toBe('Felipe Estrada');
  });
});
