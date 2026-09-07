/**
 * Presentation only: retain documents for reconciliation, audit and FEFO
 * idempotency. Never hide a posting with an effective quantity.
 */
export function isAuditedAnnulment(data: Record<string, unknown>) {
  return data.anulado === true
    && data.cantidad === 0
    && typeof data.anulacion_id === 'string'
    && data.anulacion_id.trim().length > 0;
}

export type OperationalMovementVisibility = {
  hiddenFromOperationalHistory?: boolean;
};

export function isOperationalMovementVisible(movement: OperationalMovementVisibility) {
  return movement.hiddenFromOperationalHistory !== true;
}
