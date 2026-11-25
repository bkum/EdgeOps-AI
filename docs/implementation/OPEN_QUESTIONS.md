# Open questions and decision gates

| Question | Required by | Safe interim assumption |
| --- | --- | --- |
| Where does each TrustPlate service execute? | Live adapter work | Fixture-backed adapter; no Workers assumption for API |
| Which health paths are safe and meaningful? | Live probes | Approved `https://api.trustplate.in/health`; scheduling remains off until configured |
| Which Cloudflare query APIs/permissions are available? | B08 | Unsupported telemetry shown explicitly |
| Which GitHub deployment source maps to runtime releases? | B09 | Synthetic immutable revisions |
| Can Supabase expose restricted aggregate health? | B21 | No database/service-role credentials |
| Which SDK/model versions work together with tool calling? | B02 | Pinned versions; real Workflow summary and native tool-selection chat verified on Nov 24 and 25 |
| Who can access live operations and confirm causes? | B03/B19 | Single trusted operator; no public live access |
| What daily AI budget, retention and rate caps are acceptable? | Live release | Bounded demo; proposed defaults in design docs |
| Is cf_ai_ repository naming mandated by the assignment? | Submission | Keep EdgeOps-AI; no rename presumed |
| Which domain and Cloudflare account host EdgeOps? | Deployment | edgeops.nyotec.com remains proposal |
| What is the actual submission deadline and rubric? | Delivery | Roadmap is an estimate, not a promised date |

Record decisions in ADRs or integration documentation with verification dates. Do not put private identifiers or credentials here.
