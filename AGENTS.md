# Agent Instructions

- The developer is responsible for runtime validation, browser checks, visual QA, interaction testing, and subjective product/design review.
- Codex is responsible for keeping TypeScript/type checks and the production build passing for code changes.
- Use `bun run build` as the default validation command unless the developer asks for a different type/build command.
- Do not run additional validation workflows, browser automation, screenshots, or manual UI checks unless the developer explicitly requests them.
