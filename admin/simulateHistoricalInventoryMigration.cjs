const fs = require('node:fs');
const path = require('node:path');
const minimist = require('minimist');

function parseCsv(content) {
  const records = [];
  let record = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (quoted) {
      if (character === '"' && content[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      record.push(field);
      field = '';
    } else if (character === '\n') {
      record.push(field.replace(/\r$/, ''));
      records.push(record);
      record = [];
      field = '';
    } else {
      field += character;
    }
  }
  if (field || record.length) {
    record.push(field.replace(/\r$/, ''));
    records.push(record);
  }
  const [headers = [], ...rows] = records;
  return rows
    .filter((values) => values.some((value) => value !== ''))
    .map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
}

function validCount(value) {
  if (String(value).trim() === '') return null;
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function addRequiredReviewBlockers(row, blockers) {
  if (!row.verifiedBy?.trim()) blockers.push({ historicalId: row.historicalId, reason: 'verified-by-required' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.physicalCountDate || '')) {
    blockers.push({ historicalId: row.historicalId, reason: 'physical-count-date-required-yyyy-mm-dd' });
  }
  if (!row.evidenceReference?.trim()) {
    blockers.push({ historicalId: row.historicalId, reason: 'evidence-reference-required' });
  }
}

function buildMigrationDryRun(rows) {
  const blockers = [];
  const proposedWrites = [];
  rows.forEach((row) => {
    const physicalCount = validCount(row.physicalCount);
    if (physicalCount === null) blockers.push({ historicalId: row.historicalId, reason: 'physical-count-required' });
    addRequiredReviewBlockers(row, blockers);

    if (row.status === 'historical-only') {
      if (row.approvedAction !== 'promote-as-active') {
        blockers.push({ historicalId: row.historicalId, reason: 'approved-action-must-be-promote-as-active' });
        return;
      }
      if (physicalCount === null) return;
      proposedWrites.push({
        collection: 'existencias',
        documentId: row.historicalId,
        operation: 'update',
        preconditionUpdateTime: row.historicalUpdateTime || null,
        fields: {
          modulo: row.activeModule || 'Consumibles',
          cantidad: physicalCount,
          ...(physicalCount === 0 ? { estado: 'Sin existencias' } : {}),
          conciliacion_historico: {
            accion: 'promovido_como_activo',
            verificado_por: row.verifiedBy,
            fecha_conteo: row.physicalCountDate,
            evidencia: row.evidenceReference,
          },
        },
      });
      return;
    }

    if (row.status === 'different-stock' || row.status === 'stock-missing') {
      if (row.approvedAction !== 'keep-active-link-history') {
        blockers.push({ historicalId: row.historicalId, reason: 'approved-action-must-be-keep-active-link-history' });
        return;
      }
      if (physicalCount === null || !row.activeId) return;
      proposedWrites.push({
        collection: 'existencias',
        documentId: row.activeId,
        operation: 'update',
        preconditionUpdateTime: row.activeUpdateTime || null,
        fields: {
          cantidad: physicalCount,
          ...(physicalCount === 0 ? { estado: 'Sin existencias' } : {}),
        },
      });
      proposedWrites.push({
        collection: 'existencias',
        documentId: row.historicalId,
        operation: 'update',
        preconditionUpdateTime: row.historicalUpdateTime || null,
        fields: {
          estado_conciliacion: 'Vinculado a producto activo',
          producto_activo_id: row.activeId,
          conciliacion_historico: {
            accion: 'vinculado_sin_sumar',
            verificado_por: row.verifiedBy,
            fecha_conteo: row.physicalCountDate,
            evidencia: row.evidenceReference,
          },
        },
      });
      return;
    }

    blockers.push({ historicalId: row.historicalId, reason: `unsupported-status:${row.status}` });
  });
  return {
    readOnly: true,
    ready: blockers.length === 0,
    reviewedRows: rows.length,
    proposedWriteCount: blockers.length === 0 ? proposedWrites.length : 0,
    blockers,
    proposedWrites: blockers.length === 0 ? proposedWrites : [],
  };
}

function main() {
  const argv = minimist(process.argv.slice(2));
  if (argv.apply || argv.write || argv.commit) {
    throw new Error('Este comando es estrictamente de simulación y no admite flags de escritura.');
  }
  const reviewPath = path.resolve(String(argv.review || ''));
  if (!argv.review || !fs.existsSync(reviewPath)) throw new Error('Debes indicar --review=<reconciliation.csv>.');
  const expectedRoot = path.resolve(process.cwd(), 'outputs');
  if (reviewPath !== expectedRoot && !reviewPath.startsWith(`${expectedRoot}${path.sep}`)) {
    throw new Error('La matriz revisada debe estar dentro de outputs/.');
  }
  const result = buildMigrationDryRun(parseCsv(fs.readFileSync(reviewPath, 'utf8')));
  const outputPath = path.join(path.dirname(reviewPath), 'migration-dry-run.json');
  fs.writeFileSync(outputPath, JSON.stringify({ generatedAt: new Date().toISOString(), ...result }, null, 2), 'utf8');
  console.log(JSON.stringify({ outputPath, ...result, blockers: result.blockers.slice(0, 20) }, null, 2));
}

module.exports = { buildMigrationDryRun, parseCsv, validCount };

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = 1;
  }
}
