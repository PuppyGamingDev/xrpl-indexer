# Security Policy

## Reporting a vulnerability

Please report security issues **privately** — do not open a public issue for
anything exploitable.

- **GitHub:** open a [private security advisory](https://github.com/PuppyGamingDev/xrpl-indexer/security/advisories/new)
  (Security → Report a vulnerability), or
- **Email:** shiffed@puppy.tools

Include what you were doing, the impact, and a proof of concept if you have one.
You'll get an acknowledgement within a few days. Once a fix is available we'll
credit you in the release notes unless you'd rather stay anonymous.

## Scope

This is self-hosted software — each operator runs their own instance, database,
and API keys. Reports that matter most:

- authentication / scope bypass on `apps/api`
- SSRF or request forgery via the metadata fetchers (`packages/sources`) or the
  dashboard's `/api/img` proxy
- SQL injection or unsafe query construction
- secrets or API keys leaking into logs, API responses, or the browser bundle

Out of scope: rate-limiting a public endpoint you deliberately exposed without a
reverse proxy, vulnerabilities in a dependency already patched upstream, and
anything requiring a compromised host or database.

## Supported versions

The `main` branch is the only supported version. There are no backported
security releases.
