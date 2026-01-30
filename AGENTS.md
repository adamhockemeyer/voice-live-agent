## Core Rules for Every Change
- ALWAYS perform a full impact analysis before writing any code:
  1. Identify ALL places where the modified code is used (callers, consumers, serializers, DB mappings, API contracts, tests, docs).
  2. Check for downstream dependencies: search the codebase for usages of changed symbols/classes/methods/fields.
  3. Update every affected file/module accordingly (e.g., add new imports, update DTOs, adjust service calls, fix tests).
- If a change affects data models, contracts, or shared types → update ALL related consumers immediately in the same PR.
- Never leave a change "half-done" — if you add/remove a field/property, you MUST update every place it is read/written/validated/serialized.
- Do NOT say "I didn't add X" or leave TODOs — fix it now or explain why it's out of scope (and ask for clarification).