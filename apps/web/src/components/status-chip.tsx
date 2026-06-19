import type { TaskGovernanceView } from '@provable/contracts';
import type { ChipIcon } from '@/lib/fleet-view';
import { CHIP_SPEC, chipLabel } from '@/lib/fleet-view';

// One status chip per task. Spec is the closed CHIP_SPEC Record (compile-time exhaustive over
// GovernanceStatus); the label comes from the exhaustive chipLabel switch. No free strings.
function Icon({ icon }: { icon: ChipIcon }) {
  const common = { width: 12, height: 12, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
  switch (icon) {
    case 'arrow-up':
      return (<svg {...common}><path d="M12 19V5M5 12l7-7 7 7" /></svg>);
    case 'hand-stop':
      return (<svg {...common}><path d="M18 11V6a2 2 0 0 0-4 0M14 6V4a2 2 0 0 0-4 0v2M10 6V5a2 2 0 0 0-4 0v9" /><path d="M18 11a6 6 0 0 1-6 6H9a6 6 0 0 1-3-2" /></svg>);
    case 'check':
      return (<svg {...common}><path d="M20 6 9 17l-5-5" /></svg>);
    case 'alert-triangle':
      return (<svg {...common}><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4M12 17h.01" /></svg>);
    case 'ban':
      return (<svg {...common}><circle cx="12" cy="12" r="9" /><path d="M5.6 5.6 18.4 18.4" /></svg>);
  }
}

export function StatusChip({ task }: { task: TaskGovernanceView }) {
  const spec = CHIP_SPEC[task.status];
  return (
    <span className="status-chip" data-status={task.status} data-tone={spec.tone}>
      <Icon icon={spec.icon} />
      <span className="status-chip-label">{chipLabel(task)}</span>
    </span>
  );
}
