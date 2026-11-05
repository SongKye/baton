# Security

Baton can run coding agents on your computer, so access to it matters.

## How access works

- Baton listens on **`127.0.0.1` only**. Nothing on your network can reach it unless you expose it (for example with `tailscale serve`, which keeps it inside your own tailnet).
- Requests made **directly on the same computer** are allowed.
- Remote access uses **Tailscale Serve identity**, without a Baton password or device cookie. Set `BATON_ALLOWED_LOGINS=me@example.com` to restrict access to specific Tailscale logins; when unset, any identity forwarded by the local Tailscale proxy is accepted.
- Identity headers are accepted only from loopback connections. Direct network connections and forwarded requests without a Tailscale identity are rejected. Keep Baton bound to loopback and use a trusted local Tailscale Serve proxy.
- Other development servers opened from Baton have their own access controls.

## Secrets

- API keys you enter in **Get started → Connect** are written to the CLI's own config file (the same place the CLI would keep them), after backing that file up.
- Extra environment variables from **Settings → Company setup** are stored in `data/baton.db` on your computer and are masked in the UI after saving.
- `data/` is git-ignored and never leaves your computer.

## Reporting a vulnerability

Please **don't open a public issue**. Use GitHub's private vulnerability reporting (Security → Report a vulnerability) on this repository. You'll get a reply within a few days.
