# Privacy and Redaction

Termyte performs redaction in the MCP bridge before data is sent to the cloud runtime.

## What Gets Redacted

- Common secret formats such as API keys and bearer tokens.
- Private key blocks.
- Sensitive JSON fields such as `password`, `token`, `secret`, `key`, and `credential`.

## Why It Exists

The cloud runtime should receive sanitized summaries, not raw secrets or full terminal dumps.

## Operational Rule

Redaction happens before:

- network transmission
- ledger persistence
- failure memory storage
- judge input
- logs and retrieval queries

That is the boundary that keeps the system usable.
