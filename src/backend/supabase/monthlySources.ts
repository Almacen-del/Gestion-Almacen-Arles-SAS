import type {PanelSnapshot} from './panel';
import type {MonthlyActivitySource} from '../../valuation/monthlyActivity';
import type {CurrentValuationRow} from '../../valuation/models';
import {isInventoryValuationModuleIncluded} from '../../valuation/inventoryValuationScope';
export function panelMonthlyRows(snapshot:PanelSnapshot):CurrentValuationRow[]{
 return [...snapshot.inventory,...snapshot.aseo].filter(p=>isInventoryValuationModuleIncluded(p.modulo)).map(p=>({valuationId:p.valuationId,productDocumentId:p.id,moduleName:p.modulo,code:p.codigo,product:p.descripcion,reference:p.referencia,quantity:p.saldo,unit:p.unidad,unitValue:snapshot.valuations[p.valuationId]??0,totalValue:p.saldo*(snapshot.valuations[p.valuationId]??0),includesOccupied:false}));
}
export function panelMonthlySources(snapshot:PanelSnapshot):MonthlyActivitySource[]{
 return snapshot.movements.map(m=>({id:m.id,module:m.modulo,type:m.tipo,code:m.codigo,name:m.descripcion,reference:m.referencia,quantity:m.cantidad,unit:m.unidad,occurredAt:m.monthlyOccurredAt||m.fecha,productDocumentId:m.productDocumentId,destinationLot:m.destinationLot,observations:m.observaciones,zone:m.zona,labor:m.labor,front:m.frente,position:[m.cargo,snapshot.users[m.solicitante]?.cargo].filter(Boolean).join(' '),machinery:m.maquinaria,recipientId:snapshot.users[m.solicitante]?`uid:${m.solicitante}`:m.solicitante,recipientName:snapshot.users[m.solicitante]?.nombre||snapshot.users[m.solicitante]?.email||m.solicitante}));
}
