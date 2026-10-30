# NOTICE

Nemorous Mobile is an independent mobile companion for the desktop project
**Nemorous** — 多仓 Git 协同与代码查阅桌面工具.

## Upstream projects

### Nemorous

- Repository: https://github.com/iwangjie/Nemorous
- Copyright (c) 2026 iwangjie
- License: MIT
- What we take: the product concept (multi-repository Git workspace, unified
  review/commit/merge workflows), the interaction model, and the Git safety
  invariants (no forced pushes, skip dirty repositories, isolated merges).
- What we do not take: no source code from the desktop application is copied
  into this repository. The Go companion service and the TypeScript client are
  independent implementations.

### MyGo

- Repository: https://github.com/egoist/mygo
- License: MIT
- The desktop application renders its UI with MyGo, which only targets macOS,
  Windows and Linux. Nemorous Mobile does not use MyGo; its client is a
  browser-based PWA. MyGo is credited here because the mobile port would not
  exist without the desktop application built on it.

## This project

- License: MIT (see `LICENSE`)
- The mobile client, the companion Go service, and all original code in this
  repository are Copyright (c) 2026 Nemorous Mobile contributors.
