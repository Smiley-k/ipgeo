# MeshCentral IP Geo

A MeshCentral plugin that shows a **local country flag** next to public device IP addresses and reveals the **ISP/provider, country, ASN and IP** in an instant tooltip.

## Features

- Local SVG flags for ISO 3166-1 alpha-2 country codes. No external image requests.
- Instant custom tooltip: provider first, then country, ASN and IP.
- Batch prefetch of visible rows through ip-api.com/batch (up to 100 IPs per request, 15 requests/minute).
- Offscreen rows are loaded lazily on scroll, resize, focus or tab return.
- Server-side cache for 7 days (<code>cache.json</code>).
- Private ranges are skipped: RFC1918, CGNAT, loopback, link-local, IPv6 ULA.
- Works when MeshCentral is hosted at the root or in a subpath such as <code>/meshcentral/</code>.
- Fallback GeoIP providers: ipwho.is and ipinfo.io.

## Preview

In the device list:

~~~text
WAN 203.0.113.45 [flag]
~~~

On hover:

~~~text
Deutsche Telekom AG
Germany
AS3320 Deutsche Telekom AG
IP: 203.0.113.45
~~~

## Requirements

- MeshCentral 1.1.0 or newer.
- MeshCentral plugins enabled.
- Outbound HTTP/HTTPS access from the MeshCentral server to <code>ip-api.com</code> (and optional fallbacks).
- For web UI installation: a full site administrator account.

## Installation

Detailed instructions:

- [INSTALL.en.md](INSTALL.en.md) English
- [INSTALL.ru.md](INSTALL.ru.md) Russian

Quick manual install:

1. Copy the <code>ipgeo</code> folder into <code>&lt;meshcentral-data&gt;/plugins/ipgeo</code>.
2. Add the plugin loader inside <code>settings</code> in <code>&lt;meshcentral-data&gt;/config.json</code>:

~~~json
{
  "settings": {
    "plugins": {
      "enabled": true,
      "list": ["ipgeo"]
    }
  },
  "domains": { }
}
~~~

3. Restart MeshCentral and hard-refresh the browser.

The <code>plugins</code> block must be inside <code>settings</code>, not at the top level of <code>config.json</code>.

## Configuration

Copy <code>settings.example.json</code> to <code>settings.json</code> next to <code>ipgeo.js</code> and edit it.

| Option | Default | Description |
|---|---:|---|
| provider | auto | auto, ip-api, ipwho or ipinfo |
| cacheHours | 168 | Cache lifetime in hours |
| requestTimeoutMs | 5000 | Single request timeout |
| minIntervalMs | 1400 | Minimum interval for single-IP requests |
| batchIntervalMs | 4200 | Minimum interval between batch requests |
| batchSize | 100 | IPs per ip-api batch request |
| batchMax | 200 | Maximum IPs accepted from one browser batch |
| batchTimeoutMs | 15000 | Batch request timeout |
| debug | false | Write debug messages to the MeshCentral log |

## How it works

The server plugin exposes a <code>serveraction</code> handler for single and batch lookups and serves the bundled flags through <code>hook_setupHttpHandlers</code>. The browser part decorates MeshCentral's public-IP links, batches visible IPs and draws the custom tooltip. Results are cached server-side and stored in <code>cache.json</code>.

## Privacy

Only public IP addresses are sent to the configured GeoIP provider. Country flags are served locally by MeshCentral. Do not install the plugin if sending public IPs to a third-party GeoIP service is not acceptable.

## Limitations

- GeoIP data can be wrong for VPNs, mobile carriers and anycast addresses.
- Provider logos are not included. The flag represents the country, not the ISP brand.
- IPv6 addresses in <code>lastaddr</code> with a port are parsed heuristically.
- The plugin is not supported by the MeshCentral core developers.

## Repository layout

~~~text
.
├── config.json
├── ipgeo.js
├── settings.example.json
├── flags/
├── README.md
├── README.ru.md
├── INSTALL.en.md
├── INSTALL.ru.md
├── CHANGELOG.md
└── LICENSE
~~~

## Development

~~~bash
node --check ipgeo.js
node -e "const p=require('./ipgeo.js').ipgeo({}); p.lookupBatch(['8.8.8.8','1.1.1.1'],(e,r)=>console.log(e||r));"
~~~

## License

Plugin code: MIT. See [LICENSE](LICENSE).

Country flags: [flag-icons](https://github.com/lipis/flag-icons), MIT. See <code>flags/LICENSE</code>.
