# Security and data

The Electron renderer is sandboxed with context isolation and no Node integration. The local API binds to `127.0.0.1`, validates its Host header and rejects cross-origin writes. It is a single-user local service, not a multi-user or internet-facing server. Do not expose its port through a public proxy.

Keys entered in Démarrer are verified against fixed provider endpoints before being saved to the macOS Keychain under the account `shorts-factory-open-source`. API responses contain connection state, never stored credentials. Environment variables named `SHORTS_FACTORY_ANTHROPIC`, `SHORTS_FACTORY_ELEVENLABS`, `SHORTS_FACTORY_TRYPOST` and `SHORTS_FACTORY_APIFY` are supported for managed environments; no `.env` file is loaded automatically. Removing an environment-supplied key requires changing the environment and restarting.

Media, transcripts, profiles, analytics and logs stay in the active data directory. During use, text/profile information goes to the selected text provider, audio goes to ElevenLabs if enabled, approved media goes to TryPost when publishing, and selected public handles go to Apify when collecting. Local rendering does not mean all optional processing is offline.

The public repository and build use source allowlists and exclude the working data directory. Before sharing a fork, stage only intended source and run `npm run check:public` plus `gitleaks dir --redact .`. Do not attach logs, databases, user profiles, token values or original media to public issues. Use GitHub private vulnerability reporting for sensitive findings.
