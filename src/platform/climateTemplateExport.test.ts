import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { expect, it } from 'vitest';
import { fillClimateTemplate } from './climateTemplateExport';
import type { ClimateReading } from '../backend/supabase/climate';
const template = new Uint8Array(readFileSync('public/templates/MP-F-010-temperatura-humedad.xlsx'));
const reading: ClimateReading = { id:'test', period:'AM', reading_date:'2024-02-01', measured_at:'2024-02-01T13:30:00Z', temperature_c:0, humidity_percent:55.5, notes:'Revisión <ventana> & puerta', responsible_name:'Persona A', criteria_version:null };
it('maps morning/evening, preserves zeros and blanks, and keeps native template parts', async () => {
 const bytes = await fillClimateTemplate(template,'2024-02',[reading,{...reading,id:'pm',period:'PM',measured_at:'2024-02-01T20:45:00Z',temperature_c:28,responsible_name:'Persona B'},{...reading,id:'leap',reading_date:'2024-02-29',measured_at:'2024-02-29T13:30:00Z'},{...reading,id:'other',reading_date:'2024-03-01',measured_at:'2024-03-01T13:30:00Z'}]);
 const result = await JSZip.loadAsync(bytes), original = await JSZip.loadAsync(template);
 const sheet = await result.file('xl/worksheets/sheet1.xml')!.async('string');
 expect(sheet).toMatch(/r="C6"[^>]*><v>0<\/v>/);
 expect(sheet).toMatch(/r="F6"[^>]*><v>28<\/v>/);
 expect(sheet).toMatch(/r="D6"[^>]*><v>55.5<\/v>/);
 expect(sheet).toContain(`<v>${510/1440}</v>`);
 expect(sheet).toContain(`<v>${945/1440}</v>`);
 expect(sheet).toContain('AM: Persona A\nPM: Persona B');
 expect(sheet).toContain('&lt;ventana&gt; &amp; puerta');
 expect(sheet).toMatch(/r="C7"[^>]*\/>/);
 expect(sheet).toMatch(/r="A34"[^>]*><v>29<\/v>/);
 expect(sheet).toMatch(/r="A35"[^>]*\/>/);
 expect(sheet).not.toContain('<f>');
 for (const path of Object.keys(original.files).filter(p => !original.files[p].dir && !['xl/worksheets/sheet1.xml','xl/styles.xml'].includes(p))) expect(await result.file(path)!.async('uint8array')).toEqual(await original.file(path)!.async('uint8array'));
});
it('rejects empty months and duplicate turns instead of overwriting history', async () => {
 await expect(fillClimateTemplate(template,'2024-03',[reading])).rejects.toThrow('No hay mediciones');
 await expect(fillClimateTemplate(template,'2024-02',[reading,reading])).rejects.toThrow('duplicadas');
 await expect(fillClimateTemplate(template,'2024-13',[reading])).rejects.toThrow('mes válido');
});
