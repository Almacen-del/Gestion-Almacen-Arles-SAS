export const brand = {
  name: 'Arles S.A.S.',
  variant: '#144619',
  accent: '#1e6b52',
  vivid: '#05a64b',
  green900: '#123f23',
  green800: '#16532c',
  green700: '#087b3b',
  green100: '#e7f4e4',
  soft: '#eef5ee',
  ink: '#172118',
  muted: '#5a6e62',
  line: '#c8dcc9',
  danger: '#c0392b',
  warning: '#c98213',
} as const;

export const inventoryValuationModule = 'Valoración de Inventario' as const;
export const inventoryIndicatorsModule = 'Indicadores de Inventario' as const;

export const modules = [
  inventoryValuationModule,
  inventoryIndicatorsModule,
  'Consumibles',
  'Agroquimicos',
  'ASEO',
  'Lubricantes taller',
  'EPP',
  'Dotación',
  'Combustible',
  'TALLER',
] as const;

export type AppModule = (typeof modules)[number];

export const moduleAccents: Record<AppModule, string> = {
  [inventoryValuationModule]: '#145c3a',
  [inventoryIndicatorsModule]: '#176b50',
  Consumibles: '#087b3b',
  Agroquimicos: '#108c66',
  ASEO: '#009a96',
  'Lubricantes taller': '#26805f',
  EPP: '#2e9150',
  'Dotación': '#0c8448',
  Combustible: '#c67a1c',
  TALLER: '#1e6b52',
};

export const moduleDescriptions: Record<AppModule, string> = {
  [inventoryValuationModule]: 'Vista general del valor actual de todas las existencias.',
  [inventoryIndicatorsModule]: 'Rotación, días sin movimiento y alertas trazables por período.',
  Consumibles: 'Repuestos, insumos y materiales de uso diario.',
  Agroquimicos: 'Fertilizantes, fungicidas, herbicidas y coadyuvantes.',
  ASEO: 'Productos de limpieza y aseo por piso y categoría.',
  'Lubricantes taller': 'Aceites y lubricantes del taller mecánico.',
  EPP: 'Elementos de protección personal y entregas.',
  'Dotación': 'Ropa, calzado y dotación por talla.',
  Combustible: 'Gasolina, ACPM y urea para maquinaria.',
  TALLER: 'Herramientas, préstamos y movimientos de taller.',
};

export function moduleAccent(moduleName: string): string {
  return moduleAccents[moduleName as AppModule] ?? brand.green700;
}

export function moduleDescription(moduleName: string): string {
  return moduleDescriptions[moduleName as AppModule] ?? 'Inventario y movimientos en tiempo real.';
}
