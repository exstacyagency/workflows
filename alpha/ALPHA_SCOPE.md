# ALPHA SCOPE (LOCKED)

## Objective
Validate end-to-end pipeline reliability, failure modes, and trustworthiness under controlled conditions.
This phase is NOT for UX, features, or user feedback.

---

## Runtime Mode
- MODE: alpha
- All runs must explicitly declare alpha mode
- Alpha runs are invalid if MODE is not logged

---

## In-Scope

### Inputs
- Max products/services tested: 1
- Input format: JSON fixtures only
- Fixture files are immutable once committed

### Data Sources
- [x] TikTok
- [x] Reddit
- [ ] Amazon Reviews
- [ ] Other

### Pipeline Stages Enabled
- [x] Data Collection
- [x] Insight Extraction
- [x] Script Generation
- [x] Storyboard Generation
- [ ] UGC Video Generation

### Output Artifacts
- [x] Research summary
- [x] Creative insights
- [x] Scripts
- [x] Storyboards
- [ ] Video renders

---

## Out of Scope (Explicitly Forbidden)
- UI polish
- Feature requests
- Free-form user inputs
- Prompt experimentation during runs
- Performance optimization
- Scaling or concurrency testing
- Customer onboarding
- Billing, auth, publishing

---

## Determinism Rules
- Fixed model versions
- Fixed temperature
- Fixed token budgets per stage
- No adaptive retries beyond defined limits

---

## Success Criteria
Alpha is considered successful ONLY if:
- Pipeline completes ≥80% of runs without manual intervention
- Failures are classifiable and repeatable
- Costs are predictable within ±20%
- Outputs are directionally useful but not necessarily polished

---

## Failure Classification (Closed Set)
- DATA_EMPTY
- DATA_NOISE
- MODEL_HALLUCINATION
- MODEL_OVERCONFIDENCE
- INTEGRATION_FAILURE
- COST_OVERFLOW
- OUTPUT_UNUSABLE

---

## Change Policy
- Any scope change requires:
  1. Explicit edit to this file
  2. Git commit with message prefix: alpha-scope:
- Silent scope drift invalidates all alpha results

---

## Status
- Scope Locked On: 2026-01-17
- Locked By: Alec Wong
