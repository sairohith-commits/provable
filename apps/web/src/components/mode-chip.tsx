import type { AutonomyMode, GovernanceStatus } from '@provable/contracts';
import { bandLabel } from '@/lib/fleet-view';

/**
 * The band-colored operating-mode chip (Phase 2) — Solo emerald / Co-Pilot blue / Shadow amber /
 * SUSPENDED danger, off the LOCKED band hexes (via .mode-chip[data-band]). A SUSPENDED task isn't
 * operating in its band, so its status overrides the mode. Pure presentation; reused on the fleet
 * board + readiness rows. Distinct from the governance StatusChip (action/tone-keyed).
 */
export function ModeChip({ mode, status }: { mode: AutonomyMode; status: GovernanceStatus }) {
  const band: AutonomyMode = status === 'SUSPENDED' ? 'SUSPENDED' : mode;
  return (
    <span className="mode-chip" data-band={band} data-mode-chip>
      {bandLabel(band)}
    </span>
  );
}
