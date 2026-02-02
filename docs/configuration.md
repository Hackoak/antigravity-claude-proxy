# Advanced Configuration

While most users can use the default settings, you can tune the proxy behavior via the **Settings → Server** tab in the WebUI or by creating a `config.json` file.

## Configurable Options

- **API Key Authentication**: Protect `/v1/*` API endpoints with `API_KEY` env var or `apiKey` in config.
- **WebUI Password**: Secure your dashboard with `WEBUI_PASSWORD` env var or in config.
- **Custom Port**: Change the default `8080` port.
- **Retry Logic**: Configure `maxRetries`, `retryBaseMs`, and `retryMaxMs`.
- **Rate Limit Handling**: Comprehensive rate limit detection from headers and error messages with intelligent retry-after parsing.
- **Load Balancing**: Adjust `defaultCooldownMs` and `maxWaitBeforeErrorMs`.
- **Persistence**: Enable `persistTokenCache` to save OAuth sessions across restarts.
- **Max Accounts**: Set `maxAccounts` (1-100) to limit the number of Google accounts. Default: 10.
- **Quota Threshold**: Set `globalQuotaThreshold` (0-0.99) to switch accounts before quota drops below a minimum level. Supports per-account and per-model overrides.
- **Endpoint Fallback**: Automatic 403/404 endpoint fallback for API compatibility.

Refer to `config.example.json` for a complete list of fields and documentation.
