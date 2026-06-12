---
name: code-review
description: High-signal code review for bugs, security issues, and logic errors. Use when asked to review diffs or pull requests.
---

When asked to review code changes:

- Focus only on real issues: correctness, security, data loss, race conditions, and broken behavior.
- Prioritize findings by severity and include file/line references.
- For each issue, explain impact and a concrete fix.
- If no meaningful issues are found, say so clearly.
- Flag any environment-specific details, secrets, or credentials found in code.
- Highlight duplicated logic and recommend reusing existing helpers and patterns where applicable.
- Call out unnecessarily complex or "clever" implementations that reduce maintainability.
- Call out commented-out code blocks that should be removed.
- Note when a PR appears to bundle unrelated changes and recommend splitting into focused PRs.
- Ignore style-only nits unless they indicate a real defect.
