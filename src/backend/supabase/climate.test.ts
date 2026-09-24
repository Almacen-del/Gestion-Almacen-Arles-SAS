import { describe, expect, it } from 'vitest';
import { climateRange, colombiaDateTime, evaluateClimate, evaluateClimateParameter, criteriaForReading, type ClimateRule, type ClimateReading, type ClimateDashboard } from './climate';
const rule: ClimateRule = { code: 'BIO006', name: 'NEMACYL', page: 1, group: '', temperature_text: '', humidity_text: '', details: '', t_min: null, t_max: 32, h_max: 78, unconfirmed: false };
const reference = { t_min: 5, t_max: 30, h_max: 60, note: '', sources: [] };
describe('environmental criteria', () => {
  it('separates temperature compliance from humidity failure and vice versa', () => {
    expect(evaluateClimateParameter(rule, 26, reference, 'temperature').status).toBe('within');
    expect(evaluateClimateParameter(rule, 95, reference, 'humidity').status).toBe('outside');
    expect(evaluateClimateParameter(rule, 33, reference, 'temperature').status).toBe('outside');
    expect(evaluateClimateParameter(rule, 50, reference, 'humidity').status).toBe('within');
    expect(evaluateClimateParameter({ ...rule, h_max: null }, 32, null, 'temperature').status).toBe('within');
    expect(evaluateClimateParameter({ ...rule, h_max: null }, 50, null, 'humidity').status).toBe('unknown');
    expect(evaluateClimateParameter({ ...rule, h_max: null }, 60, reference, 'humidity').status).toBe('outside');
    expect(evaluateClimateParameter(rule, 78, reference, 'humidity').status).toBe('within');
  });
  it('honors exact inclusive manufacturer limits instead of the stricter general reference', () => {
    expect(evaluateClimate(rule, 32, 78, reference).status).toBe('within');
    expect(evaluateClimate(rule, 32.1, 78, reference).status).toBe('outside');
    expect(evaluateClimate(rule, 32, 78.1, reference).status).toBe('outside');
  });
  it('uses general ranges only for missing parameters and never calls them manufacturer compliance', () => {
    const unknown = { ...rule, t_max: null, h_max: null };
    expect(evaluateClimate(unknown, 25, 59.9, reference).status).toBe('reference');
    expect(evaluateClimate(unknown, 25, 60, reference).status).toBe('outside');
    expect(evaluateClimate(unknown, 4.9, 50, reference).status).toBe('outside');
    expect(evaluateClimate(unknown, 25, 50, null).status).toBe('unknown');
    expect(evaluateClimate({ ...rule, h_max: null }, 31, 50, reference).status).toBe('reference');
  });
  it('evaluates Yodosafer and Kumulus individually and rejects invalid readings', () => {
    expect(evaluateClimate({ ...rule, t_min: 4, t_max: 30, h_max: null }, 3.9, 50, null).status).toBe('outside');
    expect(evaluateClimate({ ...rule, t_max: 40, h_max: null }, 40, 50, reference).status).toBe('reference');
    expect(evaluateClimate(rule, NaN, 50, reference).status).toBe('unknown');
  });
  it('keeps Monday/Sunday weeks, leap months and Colombian midnight boundaries', () => {
    expect(climateRange('2026-01-01', 'day')).toEqual({ from: '2026-01-01', to: '2026-01-01' });
    expect(climateRange('2026-01-01', 'week')).toEqual({ from: '2025-12-29', to: '2026-01-04' });
    expect(climateRange('2024-02-15', 'month')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
    expect(colombiaDateTime(new Date('2026-09-24T04:59:00Z'))).toBe('2026-09-23T23:59');
  });
  it('does not reinterpret a versioned reading using the latest criteria', () => {
    const dashboard = { current_version: 'v2', criteria: [{ version: 'v1' }, { version: 'v2' }] } as ClimateDashboard;
    expect(criteriaForReading({ criteria_version: 'v1' } as ClimateReading, dashboard)?.version).toBe('v1');
    expect(criteriaForReading({ criteria_version: null } as ClimateReading, dashboard)?.version).toBe('v2');
    expect(criteriaForReading({ criteria_version: 'missing' } as ClimateReading, dashboard)).toBeUndefined();
  });
});
