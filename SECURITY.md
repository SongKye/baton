# Security

Baton can run coding agents on your computer, so access to it matters.

## How access works

- Baton listens on **`127.0.0.1` only**. Nothing on your network can reach it unless you expose it (for example with `tailscale serve`, which keeps it inside your own tailnet).
- Requests made **directly on the same computer** are allowed.
- **Every other device** must enter the password once. It then gets an HttpOnly cookie and stays trusted while it keeps coming back within the trust window (default 30 days). Devices can be signed out in **Settings → Security**.
- The default password is **`0000`** — Baton shows a warning until you change it.
- Wrong passwords are rate-limited per IP (lockout after 5 tries, backing off) and globally.
- When Baton is behind `tailscale serve`, you can additionally restrict access to specific Tailscale logins with `BATON_ALLOWED_LOGINS=me@example.com`.

## Secrets

- API keys you enter in **Get started → Connect** are written to the CLI's own config file (the same place the CLI would keep them), after backing that file up.
- Extra environment variables from **Settings → Company setup** are stored in `data/baton.db` on your computer and are masked in the UI after saving.
- `data/` is git-ignored and never leaves your computer.

## Reporting a vulnerability

Please **don't open a public issue**. Use GitHub's private vulnerability reporting (Security → Report a vulnerability) on this repository. You'll get a reply within a few days.
