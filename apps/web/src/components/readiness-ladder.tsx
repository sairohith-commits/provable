import type { AutonomyMode } from '@provable/contracts';
import type { ImpliedBand, ScoreView } from '@/lib/types';
import { ladderMarkers } from '@/lib/view-helpers';

// The READINESS LADDER — the signature component. A 3-zone Shadow/Co-Pilot/Solo bar whose
// zone widths are the REAL band thresholds (40/30/30, NOT equal thirds — Readiness fix #4),
// so a marker's position reads true against its band.
//
// TWO MARKERS make the governance asymmetry visible (Readiness fix #1):
//   • SOLID  marker = the effective OPERATING mode (band center)
//   • GHOST  marker = the score-IMPLIED band (band center) — the target
// The gap between them is the ungoverned headroom (classify: Solo-implied, Co-Pilot
// operating). Where score-band == mode the two markers coincide (no gap). A thin tick marks
// the precise readiness score.

const BAND_COLOR: Record<ImpliedBand, string> = {
  SHADOW: 'var(--band-shadow)',
  CO_PILOT: 'var(--band-copilot)',
  SOLO: 'var(--band-solo)',
};

function bandLabel(b: string): string {
  return b === 'CO_PILOT' ? 'Co-Pilot' : b === 'SOLO' ? 'Solo' : b === 'SHADOW' ? 'Shadow' : b;
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
  const m = ladderMarkers(score, effectiveMode);

  return (
    <div className="ladder">
      <div className="ladder-zones" aria-hidden>
        {/* zone widths = real bands 0–40 / 41–70 / 71–100 (fix #4) */}
        <span className="zone zone-shadow" style={{ flex: 40 }} />
        <span className="zone zone-copilot" style={{ flex: 30 }} />
        <span className="zone zone-solo" style={{ flex: 30 }} />

        {/* headroom connector between effective (solid) and implied (ghost) */}
        {m.gap && m.effectivePct !== null && m.impliedPct !== null ? (
          <span
            className="headroom"
            style={{
              left: `${Math.min(m.effectivePct, m.impliedPct)}%`,
              width: `${Math.abs(m.impliedPct - m.effectivePct)}%`,
            }}
            aria-hidden
          />
        ) : null}

        {/* precise score tick */}
        {m.scorePct !== null ? (
          <span
            className="marker marker-score"
            style={{ left: `${m.scorePct}%` }}
            title={`readiness ${m.scorePct.toFixed(1)}`}
          />
        ) : null}

        {/* GHOST/target marker — score-implied band */}
        {m.impliedPct !== null ? (
          <span
            className="marker marker-implied"
            data-pct={m.impliedPct}
            style={{ left: `${m.impliedPct}%` }}
            title={`score implies ${implied ? bandLabel(implied) : ''}`}
          />
        ) : null}

        {/* SOLID marker — effective operating mode */}
        {m.effectivePct !== null ? (
          <span
            className="marker marker-effective"
            data-pct={m.effectivePct}
            style={{ left: `${m.effectivePct}%` }}
            title={`operating ${bandLabel(effectiveMode)}`}
          />
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
            {score?.status === 'INSUFFICIENT' ? 'Insufficient signal - unscored' : 'No data yet'}
          </span>
        )}
        <span className="effective">
          operating: <strong>{effectiveMode}</strong>
        </span>
        {m.gap && implied ? (
          <span className="headroom-note" title="ungoverned headroom: scored higher than it operates">
            ▲ headroom: {bandLabel(effectiveMode)} → {bandLabel(implied)}
          </span>
        ) : null}
      </div>
    </div>
  );
}
