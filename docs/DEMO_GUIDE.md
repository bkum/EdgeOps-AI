# Assignment demo guide

Status: the private local application and all five fixture scenarios are implemented and tested. Public evaluator sessions, private deployment and final narrated submission remain delivery gates.

Run `npm run test:demo` to build and capture the working browser flow in disposable state. Install Playwright ffmpeg first. The output is `test-results/demo/edgeops-functional-demo.webm`; screenshots also cover desktop/mobile. This automated fixture recording demonstrates UI/runtime behavior. Run `npm run verify:ai` separately to verify real Workers AI; the fixture recording must not be presented as real inference. Re-running the command creates fresh demo state without deleting normal local or deployed records.

Use a separate demo deployment with synthetic telemetry, real Workers AI inference, real Workflows and persistent state. Never connect public evaluator sessions to TrustPlate. Fixture mode must remain visibly labeled; a real LLM over synthetic telemetry does not make telemetry live.

| Scenario | Fixture evidence | Expected behavior |
| --- | --- | --- |
| Deployment regression | Deployment precedes error-rate increase; logs reference changed behavior | Candidate deployment correlation with evidence and alternative explanations |
| Database slowdown | Latency increase plus synthetic restricted connection/query aggregates | Rank DB hypothesis; avoid claiming proof solely from time coincidence |
| Recurring API failure | Prior operator-confirmed connection exhaustion incident plus current similar symptoms | Recall scoped prior lesson, compare current evidence and verify instead of assuming |

## Demonstration sequence

1. Open demo session; explain scope and synthetic inputs.
2. Ask for health; inspect time-windowed evidence.
3. Start a scenario; show deterministic detection, one incident and durable workflow.
4. Inspect model findings, evidence links and missing data.
5. Close/reopen browser mid-run; show the same persisted run.
6. Simulate recovery in fixtures; request checks and explicitly confirm the cause.
7. Open a new conversation and run recurrence; show historical recall.
8. Show bounded budgets, prompt history and reproducible setup instructions.

## Submission checklist

- [ ] Document verified install, local run, deploy, fixture seed and reset commands.
- [ ] Prove all four assignment requirements with actual runtime behavior.
- [ ] Include complete actual AI coding prompts; disclose any missing earlier transcript.
- [ ] Pass security, replay, evaluation and environment isolation checks.
- [ ] Ensure public repository contains no private telemetry or secrets.
- [ ] Confirm repository naming/deadline/rubric and evaluator access.
- [ ] Record concise walkthrough and known limitations.

Offline fixture tests may mock inference for determinism, but the final assignment demo must disclose any mock and demonstrate the real model path.
