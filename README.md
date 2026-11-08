# facebook-marketplace-mcp

An MCP (Model Context Protocol) server for querying Facebook Marketplace directly through Facebook's internal GraphQL endpoints. No headless browser / Puppeteer overhead needed at runtime.

This is a cross-platform fork of [jdcodes1/facebook-marketplace-mcp](https://github.com/jdcodes1/facebook-marketplace-mcp) that adds Linux, Windows, and headless support.

---

## Why this fork?

The original repository relies exclusively on macOS Keychain (`security find-generic-password`) to extract Chrome session cookies from local SQLite databases. On Linux and Windows, that fails immediately because Keychain does not exist.

This fork introduces:
- **Environment variable cookie injection (`FB_COOKIES`)**: pass your session cookies directly as a header string or JSON.
- **Cookie file support (`FB_COOKIES_FILE`)**: point to a file containing your exported cookies.
- **Cross-platform**: works on Linux, macOS, WSL, Windows, and containerized MCP clients.
- **macOS fallback preserved**: if you're on macOS and don't provide cookies in the environment, it still automatically reads your Chrome Keychain profile as before.

---

## Prerequisites

- **Node.js** 20+
- An active Facebook account (logged in on any browser)

---

## Installation

```bash
git clone https://github.com/skiingbeast2025/facebook-marketplace-mcp.git
cd facebook-marketplace-mcp
npm install
npm run build
```

The compiled entry point will be generated at `dist/index.js`.

---

## Getting Your Facebook Cookies (Linux / Windows)

You need your Facebook session cookies (at minimum `c_user` and `xs`).

### Option A: From Browser DevTools (Quickest)
1. Open [Facebook Marketplace](https://www.facebook.com/marketplace/) in Chrome, Firefox, or Brave.
2. Press `F12` (or `Ctrl+Shift+I`) to open Developer Tools and go to the **Network** tab.
3. Refresh the page or click any listing.
4. Click any request made to `facebook.com`.
5. Under **Request Headers**, copy the full value of the `cookie` header.

### Option B: Using a Cookie Extension
Use an extension like [Cookie-Editor](https://cookie-editor.com/) or EditThisCookie:
1. Export your cookies for `facebook.com` as **Header String** or **JSON**.
2. Save it or paste it into your configuration.

---

## MCP Client Configuration

### Antigravity / Claude Code / Claude Desktop

Add this server to your MCP configuration file (e.g. `~/.gemini/config/mcp_config.json` for Antigravity, or `claude_desktop_config.json` for Claude):

#### Using `FB_COOKIES` directly:
```json
{
  "mcpServers": {
    "facebook-marketplace": {
      "command": "node",
      "args": [
        "/absolute/path/to/facebook-marketplace-mcp/dist/index.js"
      ],
      "env": {
        "FB_COOKIES": "c_user=1000...; xs=...; datr=...; sb=..."
      }
    }
  }
}
```

#### Using `FB_COOKIES_FILE`:
If your cookie string is long or you prefer not to keep tokens in your config file:
```json
{
  "mcpServers": {
    "facebook-marketplace": {
      "command": "node",
      "args": [
        "/absolute/path/to/facebook-marketplace-mcp/dist/index.js"
      ],
      "env": {
        "FB_COOKIES_FILE": "/home/user/.fb_cookies"
      }
    }
  }
}
```

#### On macOS:
If you are on macOS and already logged into Chrome, you can omit `FB_COOKIES` and let it auto-extract from Chrome:
```json
{
  "mcpServers": {
    "facebook-marketplace": {
      "command": "node",
      "args": [
        "/absolute/path/to/facebook-marketplace-mcp/dist/index.js"
      ],
      "env": {
        "CHROME_PROFILE": "Default"
      }
    }
  }
}
```

---

## Tools

| Tool | Description | Key Arguments |
|---|---|---|
| `search_listings` | Search Marketplace for items with filters. | `query` (required), `latitude` (required), `longitude` (required), `radius_km`, `min_price`, `max_price`, `limit` |
| `get_listing` | Get details, photos, seller info, and description for a specific listing. | `listing_id` (required) |
| `search_location` | Resolve a city / town / zip code into latitude and longitude coordinates. | `query` (required) |
| `monitor_search` | Save a search query to monitor for new listings over time. | `name`, `query`, `latitude`, `longitude`, `radius_km`, `min_price`, `max_price` |
| `check_monitors` | Run saved monitors and return new listings since last check. | `monitor_name` (optional) |
| `list_monitors` | View all active saved monitors. | none |
| `delete_monitor` | Remove a saved search monitor. | `name` (required) |

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `FB_COOKIES` | Linux/Windows | Raw cookie string (`name=val; name2=val`) or exported JSON. |
| `FB_COOKIES_FILE` | Optional | Absolute path to a file containing the cookie string or JSON. |
| `CHROME_PROFILE` | macOS only | Chrome profile name (defaults to `Default`). |

---

## Rate Limits & Safety Note

This server queries Facebook's private GraphQL endpoints directly using your user cookies. It includes an internal rate limiter (3 requests/min by default) to stay within normal browsing patterns.

To prevent account checkpoints or temporary bans:
- Do not make dozens of rapid-fire queries.
- If possible, use a secondary / throwaway Facebook account.

---

## Credits

- Upstream implementation: [@jdcodes1/facebook-marketplace-mcp](https://github.com/jdcodes1/facebook-marketplace-mcp)
