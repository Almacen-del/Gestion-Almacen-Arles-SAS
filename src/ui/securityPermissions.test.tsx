import {describe,expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import AgrochemicalExpirationModal from './AgrochemicalExpirationModal';
import type {AgrochemicalStockEntry} from '../agrochemicalLots';

const entry:AgrochemicalStockEntry={id:'e1',productDocumentId:'p1',moduleName:'Agroquimicos',code:'P1',productName:'Producto de prueba',quantity:10,unit:'GRAMO',dateLabel:'05/09/2026',dateKey:'2026-09-05',createdAtMs:1788602400000,validationIssue:''};
describe('permisos visibles de asignación de lotes',()=>{
 it.each([false,true])('conserva lectura y habilita la asignación solo con permiso: %s',canRegister=>{
  const register=vi.fn();
  const html=renderToStaticMarkup(<AgrochemicalExpirationModal canRegister={canRegister} products={[{id:'p1',code:'P1',name:'Producto de prueba',stock:10,unit:'GRAMO',location:'COP'}]} lots={[]} entries={[entry]} loading={false} sourceError="" onRegister={register} onClose={vi.fn()} />);
  expect(html).toContain('Producto de prueba');
  const button=html.match(/<button[^>]*>Asignar lote<\/button>/)?.[0];
  expect(button).toBeDefined();
  expect(button!.includes('disabled=""')).toBe(!canRegister);
  expect(html.includes('Modo consulta')).toBe(!canRegister);
  expect(register).not.toHaveBeenCalled();
 });
});
