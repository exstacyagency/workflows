# Internal Test Endpoints

This directory contains test-only endpoints for CI and beta environments.

- Do NOT import NextAuth, auth(), getServerSession, or any shared API wrapper that enforces auth.
- Guard all endpoints with `MODE !== 'beta'` (throw or return 403).
- These endpoints are not available in production or non-beta environments.
