# Remote assistance

Namespace `/assistance` authenticates the existing expiring calls-session token. Only the authenticated admin role can initiate a single-worker session. Both endpoints are bound by socket ID to a random session ID. Controls are disabled until the worker's native helper and visible `In work` banner are ready. No confirmation dialog is shown; the employee can stop from the banner or Ctrl+Alt+F12. There is no input/desktop blocking or remote keyboard entry.

Primary display only. Normalized coordinates account for letterboxing in the viewer and Windows display scaling in Electron. Supported commands: move, left/right click, wheel, HTTP/HTTPS link. No arbitrary shell command or file scheme is accepted. Session events are audited, commands are rate-limited, authentication is rechecked, and disconnect/timeout/worker stop revokes access. Windows UAC secure desktop and locked sessions are outside this feature.

Tests: `tools/assistance-integration.cjs`; client `tools/assistance-native.test.cjs` and `tools/assistance-helper-check.cjs`. The helper smoke check compiles the Windows API wrapper and sends a harmless probe, never a mouse event.
