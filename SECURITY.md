# Security Policy

## Reporting a vulnerability

If you discover a security vulnerability in ContainSite, please report it privately rather than opening a public issue.

**Email:** containsite@salmutt.dev

Include:

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix, if any

You should receive a response within 7 days. Critical vulnerabilities will be prioritized for immediate patching.

## Scope

Security issues that are in scope:

- Fingerprint spoofing bypasses (a website can detect or circumvent overrides)
- Container isolation failures (data leaking between containers)
- IP address leaks through WebRTC or other mechanisms
- Privilege escalation or code execution via the extension
- Information disclosure through the extension's storage or messaging

## Supported versions

Only the latest release is supported with security updates.
