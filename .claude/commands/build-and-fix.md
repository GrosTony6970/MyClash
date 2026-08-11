---
description: Build the project and automatically fix any compilation or build errors
argument-hint: Optional - specific services/packages to build (leave empty for all modified services)
model: inherit
---

You are a build engineer focused on ensuring zero compilation errors and a clean build state.

## Philosophy: #NoMessLeftBehind

We NEVER leave broken builds. Every change must compile cleanly.

## Context

Services modified this session (auto-generated):

!git status --porcelain | awk '{print $2}' | grep -E '^(apps|packages)/' | cut -d/ -f1-2 | sort -u

User-specified services: `$ARGUMENTS`

## Your Task

Build the project and fix all errors:

1. **Detect Build System**
   - Check for TypeScript (tsconfig.json)
   - Check for build scripts in package.json
   - Identify monorepo structure if present

2. **Run Builds**
   - For each service/package that was modified:
     - Run TypeScript compilation (`tsc --noEmit` or equivalent)
     - Run build script if defined (`npm run build` or similar)
     - Capture all errors and warnings

3. **Fix Errors Automatically**
   - Use the Task tool to launch the auto-error-resolver agent with:
     - subagent_type: `auto-error-resolver`
     - description: `fix build errors`
     - prompt: List all services with build errors and ask the agent to:
       - Run the builds and analyze errors
       - Fix errors systematically
       - Verify each fix by re-running the build
       - Continue until achieving zero errors

4. **Verify Clean Build**
   - Re-run builds after fixes
   - Ensure zero errors and zero warnings
   - Report final build status

## Build Commands by Project Type

**Frontend (React/Vite):**

```bash
npm run build
# or
npx tsc --noEmit
```

**Backend (Node.js/Express):**

```bash
npx tsc --noEmit
# or for specific tsconfig
npx tsc --project tsconfig.build.json --noEmit
```

**Monorepo:**

```bash
# Shared packages FIRST, in dependency order — the API and apps typecheck against
# packages/*/dist on disk, so a partial build gives a green that lies.
pnpm turbo run build --filter="@myclash/types" --filter="@myclash/rulesets" \
  --filter="@myclash/db" --filter="@myclash/ui" --filter="@myclash/i18n" --filter="@myclash/api-client"

# Then a single workspace, if you need one
pnpm --filter @myclash/api build
```

The API's own typecheck must go through `nest build`: incremental `tsc` trusts `.tsbuildinfo` and
reports clean on code that does not compile from scratch. The full ordered chain is in the
`myclash-gates` skill.

## Quality Standards

- Must achieve zero compilation errors
- Must achieve zero build errors
- Report all warnings even if they don't fail the build
- Provide clear summary of what was fixed
- Include build time and success confirmation

## Output Format

```
🔨 BUILD REPORT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Services Built: [list]
Initial Errors: X
Errors Fixed: X
Final Status: ✅ CLEAN BUILD

Build Time: Xs

Changes Made:
- [List specific fixes applied]
```
