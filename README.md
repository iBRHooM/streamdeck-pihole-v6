# streamdeck-pihole (Pi-hole v6 Fork)

A [Stream Deck](https://www.elgato.com/en/stream-deck) plugin for monitoring & controlling [Pi-hole](https://pi-hole.net) **v6**.

> **This is a fork of [johnholbrook/streamdeck-pihole](https://github.com/johnholbrook/streamdeck-pihole), fixed and updated to work with Pi-hole v6's new session-based API.**  
> The original plugin was updated for Pi-hole v6 but contains several bugs that prevent it from working correctly. This fork fixes those bugs. Neither this fork nor the original supports Pi-hole v5.

---

## What's Different from the Original

The original plugin was updated to target Pi-hole v6's new REST API but was left with several bugs that make it non-functional. Pi-hole v6 uses session-based authentication, different endpoints, and a limited number of concurrent sessions. This fork fixes all of that:

- **Session-based auth** — correctly authenticates via `POST /api/auth` and uses `X-FTL-SID` header on all requests
- **Proper session management** — re-authenticates automatically before the session expires, and correctly ends sessions on disconnect to avoid exhausting Pi-hole's session seats
- **Fixed polling interval** — replaced the broken interval calculation (which could hammer the API and exhaust session seats) with a safe fixed 5-second poll
- **No-password support** — works correctly when Pi-hole has no password set
- **Auto port** — automatically appends `:8080` (Pi-hole v6 default port) if no port is specified in the address
- **Error feedback** — shows authentication and network errors directly in the settings panel instead of silently failing
- **HTTPS warning** — warns when HTTPS is selected that a trusted certificate is required

---

## Requirements

- Pi-hole **v6.0 or later**
- Stream Deck software **6.4 or later**

---

## Installation

Download the latest `.streamDeckPlugin` file from the [Releases](../../releases) page and double-click it. The Stream Deck software will install it automatically.

---

## Configuration

After adding a button to your Stream Deck, open its settings:

| Field | Description |
|---|---|
| **Address** | Your Pi-hole IP address. IP address with optional port. Example: `192.168.1.100:8080`. If no port is specified, `:8080` is added automatically. |
| **App Password** | Generate one in Pi-hole: **Settings → Web Interface → Configure app password → Generate**. Press **Enter** after pasting to save. |
| **Display Info** | Optional stat to show on the button (queries today, blocked count, etc.) |
| **Conn. Type** | HTTP (default). HTTPS only works if you have a trusted certificate installed on Pi-hole — not the default self-signed one. |
| **Time (s)** | *(Temporarily Disable action only)* How many seconds to disable Pi-hole for. |

> **Note:** Pi-hole v6 runs on port **8080** by default, not port 80. If your Pi-hole is on a different port, specify it manually, e.g. `192.168.1.100:9090`. The default is port `8080`.

---

## Actions

| Action | Description |
|---|---|
| **Toggle (v6)** | Toggles Pi-hole blocking on/off |
| **Enable (v6)** | Enables Pi-hole blocking |
| **Disable (v6)** | Disables Pi-hole blocking |
| **Temporarily Disable (v6)** | Disables Pi-hole for a set number of seconds |

---

## Credits

- Original plugin by [John Holbrook](https://github.com/johnholbrook/streamdeck-pihole)
- v6 fixes by [Ibrahim](https://github.com/iBRHooM)
