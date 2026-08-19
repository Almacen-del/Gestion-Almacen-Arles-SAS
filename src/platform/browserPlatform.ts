import type { ExportarReporteResult, ReporteMovimientosPayload } from '../reporteMovimientosExcel';
import { generarReporteMovimientosExcelWeb } from './browserExcelExport';

export const browserPlatform = {
  runtime: 'web' as const,
  canExportMovementReport: true,
};

function descargarArchivo(bytes: Uint8Array, fileName: string) {
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const blob = new Blob([arrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function exportMovementReportWeb(
  payload: ReporteMovimientosPayload,
): Promise<ExportarReporteResult> {
  try {
    const bytes = await generarReporteMovimientosExcelWeb(payload);
    const fileName = payload.suggestedFileName || 'Reporte_Movimientos_ARLES.xlsx';
    descargarArchivo(bytes, fileName);
    return {
      canceled: false,
      filePath: fileName,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      canceled: false,
      error: `No se pudo generar el archivo Excel: ${message}`,
    };
  }
}
