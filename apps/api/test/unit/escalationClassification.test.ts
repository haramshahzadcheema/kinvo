import { describe, expect, it } from 'vitest';
import { classifyEscalation } from '../../src/core/yellow-zone/escalationClassification';

describe('classifyEscalation', () => {
  it('classifies a CALL-E-reported failure as HIGH', () => {
    expect(classifyEscalation('CALL-E reported the call as failed.')).toBe('HIGH');
  });

  it('classifies an unrecognized call status as HIGH', () => {
    expect(classifyEscalation('Unrecognized CALL-E call status: weird_status')).toBe('HIGH');
  });

  it('classifies a completed call with no recipients as HIGH', () => {
    expect(classifyEscalation('Completed call has no recipients.')).toBe('HIGH');
  });

  it('classifies a completed call with an unexpected recipient status as HIGH', () => {
    expect(
      classifyEscalation('Completed call has recipient in unexpected status: pending'),
    ).toBe('HIGH');
  });

  it('classifies an uninterpretable provider response as HIGH', () => {
    expect(
      classifyEscalation("Could not interpret CALL-E's response for this call: boom"),
    ).toBe('HIGH');
  });

  it('classifies an incomplete task as MEDIUM', () => {
    expect(classifyEscalation('CALL-E did not judge the task as completed.')).toBe('MEDIUM');
  });

  it('classifies a missing/mismatched structured result as MEDIUM', () => {
    expect(
      classifyEscalation('Structured result missing or did not match the expected confirmation schema.'),
    ).toBe('MEDIUM');
  });

  it('classifies an unclear driver response as MEDIUM', () => {
    expect(classifyEscalation('Driver response was classified as unclear.')).toBe('MEDIUM');
  });

  it('classifies a canceled call as LOW', () => {
    expect(classifyEscalation('Call was canceled before completion.')).toBe('LOW');
  });

  it('classifies a reconciliation timeout as LOW', () => {
    expect(
      classifyEscalation('Call did not reach a terminal state within 30 minutes.'),
    ).toBe('LOW');
  });

  it('defaults to MEDIUM for a null reason', () => {
    expect(classifyEscalation(null)).toBe('MEDIUM');
  });

  it('defaults to MEDIUM for an unrecognized reason string, never throwing', () => {
    expect(() => classifyEscalation('some future reason nobody has seen yet')).not.toThrow();
    expect(classifyEscalation('some future reason nobody has seen yet')).toBe('MEDIUM');
  });
});
