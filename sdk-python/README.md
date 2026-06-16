# provable-sdk (Python)

Pydantic models + **sync and async** httpx clients for the Provable ingestion/recompute API.

```python
from provable_sdk import Client, Verdict, VerdictKind, Outcome, Source

with Client("http://localhost:3010", api_key="pvb_...") as c:   # or PROVABLE_API_KEY env
    c.register("billing-agent", "estimate_refund")
    result = c.track(
        agent_key="billing-agent", task_key="estimate_refund", source=Source.SDK,
        action={"amount": 42}, verdict=Verdict(kind=VerdictKind.ACCEPTED),
        outcome=Outcome.SUCCESS, confidence=0.9, external_ref="ticket-1",
    )
    print(result.effective_mode, result.score.status)
    # later, resolve a PENDING decision:
    c.resolve("ticket-1", source=Source.SDK, verdict=Verdict(kind=VerdictKind.OVERRIDDEN, magnitude=0.3))
```

`AsyncClient` mirrors `Client` with `await` + `async with`. Both share one core layer
(payload building, auth, response parsing).

## Isolation

This package depends on the TS side **only** via the committed
`packages/contracts/contract-manifest.json` (no TS import) and on the API **only** over
HTTP (the machine-key contract). It is outside the Turbo pipeline and has its own uv
toolchain.

## Honesty model — how the mirror stays true

This is a **manual** mirror of `@provable/contracts`, kept honest by two guard layers:

- **Closed sets** (verdict kinds, outcomes, sources, autonomy modes, agent-identity
  states, transition direction/trigger/status) are guarded by **drift tests**:
  - TS: `contract-manifest.json` is asserted equal to the const arrays.
  - Python: every Pydantic enum is asserted equal to the manifest.
  Change an array without regenerating the manifest, or add/remove a Python enum
  member, and CI fails. (`pnpm -F @provable/contracts gen:manifest` regenerates it.)
- **Decision/VerdictEvent FIELD shape** is *not* covered by the manifest (it carries
  enums, not field shapes). It is backstopped at runtime by the API's **zod boundary**
  plus the integration test. Pydantic also validates locally before sending (fail fast),
  but the API zod check remains the authoritative gatekeeper.

## Dev

```bash
uv sync
uv run ruff check .
uv run pytest                      # unit + drift (no network; integration auto-skips)
uv build                           # wheel + sdist for the Phase 6 demo agent to pip-install
```

Integration tests run against the live local API:

```bash
PROVABLE_BASE_URL=http://localhost:3010 PROVABLE_API_KEY=pvb_... uv run pytest -m integration
```
