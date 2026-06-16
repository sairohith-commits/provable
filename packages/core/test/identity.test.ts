import { describe, expect, it } from 'vitest';
import { transitionIdentity } from '../src/index.js';

describe('agent identity state machine', () => {
  it('DISCOVERED → ACTIVE on first activity', () => {
    expect(transitionIdentity('DISCOVERED', 'ACTIVITY')).toBe('ACTIVE');
  });

  it('ACTIVE → DORMANT on inactivity, DORMANT → ACTIVE on activity', () => {
    expect(transitionIdentity('ACTIVE', 'INACTIVITY')).toBe('DORMANT');
    expect(transitionIdentity('DORMANT', 'ACTIVITY')).toBe('ACTIVE');
  });

  it('RETIRE is terminal from any state', () => {
    expect(transitionIdentity('DISCOVERED', 'RETIRE')).toBe('RETIRED');
    expect(transitionIdentity('ACTIVE', 'RETIRE')).toBe('RETIRED');
    expect(transitionIdentity('DORMANT', 'RETIRE')).toBe('RETIRED');
    expect(transitionIdentity('RETIRED', 'ACTIVITY')).toBe('RETIRED');
  });

  it('no-op events leave state unchanged', () => {
    expect(transitionIdentity('DISCOVERED', 'INACTIVITY')).toBe('DISCOVERED');
    expect(transitionIdentity('ACTIVE', 'ACTIVITY')).toBe('ACTIVE');
  });
});
