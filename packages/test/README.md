# @nla/test

Small test harness helpers for NLA adapters and runtimes.

This package provides:

- a persistent in-memory test host around an adapter runtime
- convenience helpers for `invoke` and `session` messages
- message filtering helpers for assertions

It is intentionally lightweight. It does not provide a full fake transport or a
snapshot/assertion DSL.
