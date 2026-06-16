import type { AutonomyMode } from '@provable/contracts';
import type { ImpliedBand, ScoreView } from '@/lib/types';

// The READINESS LADDER — the signature component. A 3-zone Shadow/Co-Pilot/Solo bar with
// a position marker at the real readiness score, plus the governed effectiveMode.
// Thresholds are the locked band boundaries (≤40 Shadow, 41–70 Co-Pilot, 71–100 Solo).

const BAND_COLOR: Record<ImpliedBand, string> = {
  SHADOW: 'var(--band-shadow)',
  CO_PILOT: 'var(--band-copilot)',
  SOLO: 'var(--band-solo)',
};

function bandLabel(b: ImpliedBand): string {
  return b === 'CO_PILOT' ? 'Co-Pilot' : b === 'SOLO' ? 'Solo' : 'Shadow';
}

export function ReadinessLadder({
  score,
  effectiveMode,
}: {
  score: ScoreView | null;
  effectiveMode: AutonomyMode;
}) {
  const scored = score?.status === 'SCORED' && typeof score.readinessScore === 'number';
  const value = scored ? Math.max(0, Math.min(100, score.readinessScore as number)) : null;
  const implied = (score?.impliedBand ?? null) as ImpliedBand | null;

  return (
    <div className="ladder">
      <div className="ladder-zones" aria-hidden>
        <span className="zone zone-shadow" style={{ flex: 40 }} />
        <span className="zone zone-copilot" style={{ flex: 30 }} />
        <span className="zone zone-solo" style={{ flex: 30 }} />
        {value !== null ? (
          <span className="marker" style={{ left: `${value}%` }} title={`readiness ${value.toFixed(1)}`} />
        ) : null}
      </div>
      <div className="ladder-meta">
        {scored && implied ? (
          <>
            <span className="score" style={{ color: BAND_COLOR[implied] }}>
              {value!.toFixed(1)}
            </span>
            <span className="implied">implies {bandLabel(implied)}</span>
          </>
        ) : (
          <span className="empty">
            {score?.status === 'INSUFFICIENT' ? 'Insufficient signal — unscored' : 'No data yet'}
          </span>
        )}
        <span className="effective">
          operating: <strong>{effectiveMode}</strong>
        </span>
      </div>
    </div>
  );
}
