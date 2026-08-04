# Agent Instructions

- The developer is responsible for runtime validation, browser checks, visual QA, interaction testing, and subjective product/design review.
- The coding agent is responsible for keeping TypeScript/type checks and the production build passing for code changes.
- Use `bun run lint && bun test && bun run build` as the default validation unless the developer asks for a different command. `lint` is oxlint plus `tsc --noEmit`; `build` typechecks again and then produces the production bundle.
- Do not run additional validation workflows, browser automation, screenshots, or manual UI checks unless the developer explicitly requests them.
