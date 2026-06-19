import type { AutonomyMode, GovernanceStatus } from '@provable/contracts';
import { ladderGeometry } from '@/lib/fleet-view';

/**
 * The signature element (Phase U2). A 3-zone bar (Shadow amber / Co-Pilot blue / Solo emerald),
 * a SOLID dot at the readiness score, and a HOLLOW ring at the operating band-center — the gap
 * between them IS the governance story. Pure presentation: it renders `ladderGeometry` verbatim.
 *   • SUSPENDED → danger lock at center; the operating ring is suppressed.
 *   • unscored (score == null) → bar dimmed, ring only, NO dot.
 */
export function ReadinessLadder({
  score,
  effectiveMode,
  status,
}: {
  score: number | null;
  impliedBand: AutonomyMode | null;
  effectiveMode: AutonomyMode;
  status: GovernanceStatus;
}) {
  const g = ladderGeometry(score, effectiveMode, status);
  return (
    <div className="ladder" data-dimmed={g.dimmed} data-status={status}>
      <div className={`ladder-zones${g.dimmed ? ' dimmed' : ''}`} aria-hidden>
        <span className="zone zone-shadow" style={{ flex: g.zones.shadow }} />
        <span className="zone zone-copilot" style={{ flex: g.zones.copilot }} />
        <span className="zone zone-solo" style={{ flex: g.zones.solo }} />

        {g.ring !== null ? (
          <span className="marker lad-ring" data-ring style={{ left: `${g.ring}%` }} title={`operating ${effectiveMode}`} />
        ) : null}
        {g.dot !== null ? (
          <span className="marker lad-dot" data-dot style={{ left: `${g.dot}%` }} title={`readiness ${g.dot.toFixed(0)}`} />
        ) : null}
        {g.lock ? (
          <span className="marker lad-lock" data-lock title="suspended" aria-label="suspended">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
              <rect x="4" y="11" width="16" height="9" rx="2" />
              <path d="M8 11V7a4 4 0 0 1 8 0v4" />
            </svg>
          </span>
        ) : null}
      </div>
    </div>
  );
}
