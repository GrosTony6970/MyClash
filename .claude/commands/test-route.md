---
description: Test a specific API route for functionality and correctness
argument-hint: Route to test (e.g., "POST /api/form/submit" or "GET /api/users/:id")
model: inherit
---

You are a QA engineer specialized in API testing and validation.

## Context

Route to test: `$ARGUMENTS`

## Your Task

Test the specified route thoroughly:

1. **Route Discovery**
   - Find the route definition in the codebase
   - Identify the HTTP method (GET, POST, PUT, DELETE, etc.)
   - Locate the controller and service handlers
   - Understand the expected request/response structure

2. **Authentication Requirements**
   - Determine if route requires authentication
   - Identify required permissions or roles
   - Check for cookie-based auth, JWT, or other auth mechanisms

3. **Create Test Plan**
   - Valid request scenarios
   - Invalid request scenarios (missing fields, wrong types, etc.)
   - Edge cases (empty values, very long strings, etc.)
   - Authentication/authorization failures

4. **Execute Tests** — run them yourself against the local stack. Do not dispatch a subagent.
   - The API serves `/api/v1` on `http://localhost:4000` in dev; Swagger is at `/api/docs`.
   - Auth is **httpOnly cookies**, not a bearer header. Sign in first and reuse the cookie jar
     (`curl -c`/`-b`), or drive the flow through the Playwright suite in `tests/e2e/`.
   - Work through: route exists and is registered → valid auth + valid payload → missing or
     wrong-typed fields → authorization (wrong role, wrong org, anonymous) → the persisted effect →
     status codes and body shape.
   - Remember the global `ValidationPipe` runs with `whitelist` and `forbidNonWhitelisted`, so an
     unexpected property is a 400, not a silent drop.
   - **Every response body of status >= 500 is scrubbed**, so a deliberate 503's message will not
     reach you. Read the API logs for those.
   - If a route needs realistic data, the E2E suite already builds it — see `tests/e2e/README.md`
     rather than hand-rolling fixtures.

5. **Validation Checks**
   - Response status codes match expectations
   - Response body structure is correct
   - Database records created/updated properly
   - Error messages are clear and helpful
   - Security validations work correctly

6. **Report Results**
   - Summary of all test scenarios
   - Pass/fail status for each
   - Any bugs or issues found
   - Recommendations for improvements

## Expected Output Format

```
🧪 ROUTE TEST REPORT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Route: [METHOD] [PATH]
Handler: [file:line]
Authentication: [Required/Optional/None]

TEST SCENARIOS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Valid Request
   Status: ✅ PASS
   Response: [status code + body summary]

2. Missing Required Field
   Status: ✅ PASS
   Response: 400 with validation error

3. Invalid Authentication
   Status: ✅ PASS
   Response: 401 Unauthorized

[... more scenarios ...]

SUMMARY:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Passed: X/Y
Failed: X/Y
Coverage: [list what was tested]

ISSUES FOUND:
- [List any bugs or problems]

RECOMMENDATIONS:
- [List improvements or missing validations]
```

## Testing Best Practices

- Test happy path first to verify basic functionality
- Test authentication before testing business logic
- Test validation in order: required fields → field types → business rules
- Verify database side effects (records created, updated, deleted)
- Check that errors return appropriate status codes
- Ensure sensitive data is not leaked in error messages
