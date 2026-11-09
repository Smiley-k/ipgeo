# MeshCentral IP Geo — Installation Guide

This guide covers manual installation, installation through the MeshCentral web interface, configuration, upgrades and troubleshooting.

## Requirements

- MeshCentral 1.1.0 or newer.
- MeshCentral plugins enabled.
- Outbound HTTP/HTTPS access from the MeshCentral server to <code>ip-api.com</code>. Optional fallbacks: <code>ipwho.is</code> and <code>ipinfo.io</code>.
- A full site administrator account for the web UI installation.
- Write access to the plugin directory if you want the lookup cache to survive a server restart.

## What is included

~~~text
ipgeo/
├── config.json
├── ipgeo.js
├── flags/
│   ├── de.svg
│   ├── us.svg
│   └── ...
├── settings.example.json
├── README.md
├── README.ru.md
├── INSTALL.en.md
├── INSTALL.ru.md
├── CHANGELOG.md
└── LICENSE
~~~

## Option A — manual installation

Use this option for a private server or when you do not want to publish the plugin on GitHub.

### 1. Copy the plugin folder

Copy the <code>ipgeo</code> folder to:

~~~text
<meshcentral-data>/plugins/ipgeo/
~~~

The resulting structure must be:

~~~text
meshcentral-data/
└── plugins/
    └── ipgeo/
        ├── config.json
        ├── ipgeo.js
        └── flags/
~~~

Do not create an extra level such as <code>plugins/ipgeo/ipgeo/</code>.

### 2. Enable the plugin loader

Open <code><meshcentral-data>/config.json</code> and add <code>plugins</code> inside the top-level <code>settings</code> object:

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

Important:

- <code>plugins</code> must be inside <code>settings</code>, not at the top level of the file.
- <code>list</code> is manual-load mode. MeshCentral loads only the folders listed there and does not load plugins installed through the web UI/database.
- If you already have database-installed plugins, either add all their short names to <code>list</code> or use Option B instead.
- The JSON must remain valid: no comments, no trailing commas.

### 3. Restart MeshCentral

~~~bash
sudo systemctl restart meshcentral
~~~

For Docker:

~~~bash
docker restart <container>
~~~

### 4. Verify

Open the MeshCentral web UI, hard-refresh with <code>Ctrl+F5</code> and check:

1. <code>My Server → Plugins</code> is visible (with <code>list</code> the table may be empty; this is normal).
2. Device list shows a flag next to public IP addresses.
3. Hovering the flag shows the provider, country, ASN and IP.

Browser console check:

~~~js
pluginHandler
typeof pluginHandler.ipgeo.webShowTip
document.querySelector('.ipgeo-b')?.getAttribute('data-tip')
~~~

Expected: an object, <code>"function"</code>, and a string containing the provider.

## Option B — installation through the web interface

The MeshCentral web UI installs plugins only from a URL. There is no local ZIP upload.

### 1. Publish the plugin files

Put the repository on GitHub (or any web server reachable by MeshCentral). The files must be publicly accessible:

- <code>config.json</code>
- the ZIP archive referenced by <code>downloadUrl</code>
- optionally <code>CHANGELOG.md</code> and the version tags API

Update these fields in <code>config.json</code> to match your repository:

~~~json
{
  "homepage": "https://github.com/Smiley-k/ipgeo",
  "changelogUrl": "https://raw.githubusercontent.com/Smiley-k/ipgeo/main/CHANGELOG.md",
  "configUrl": "https://raw.githubusercontent.com/Smiley-k/ipgeo/main/config.json",
  "downloadUrl": "https://github.com/Smiley-k/ipgeo/archive/refs/heads/main.zip",
  "versionHistoryUrl": "https://api.github.com/repos/Smiley-k/ipgeo/tags"
}
~~~

### 2. Enable plugins without manual list mode

~~~json
{
  "settings": {
    "plugins": {
      "enabled": true
    }
  }
}
~~~

Do not add <code>list</code> for this option. Restart MeshCentral.

### 3. Install from the web UI

1. Sign in as a full site administrator.
2. Open <code>My Server → Plugins</code>.
3. Click <code>Download Plugin</code>.
4. Enter the raw URL of the plugin <code>config.json</code>, for example:

~~~text
https://raw.githubusercontent.com/Smiley-k/ipgeo/main/config.json
~~~

5. MeshCentral reads the config, downloads the ZIP from <code>downloadUrl</code> and installs it.
6. In the plugin table, select <code>Enable</code> or <code>Install</code> in the Actions column if needed.

## Configuration

Create <code>settings.json</code> next to <code>ipgeo.js</code>. Start from <code>settings.example.json</code>.

~~~json
{
  "provider": "auto",
  "cacheHours": 168,
  "requestTimeoutMs": 5000,
  "minIntervalMs": 1400,
  "batchIntervalMs": 4200,
  "batchSize": 100,
  "batchMax": 200,
  "batchTimeoutMs": 15000,
  "debug": false
}
~~~

| Option | Default | Description |
|---|---:|---|
| provider | auto | auto, ip-api, ipwho or ipinfo |
| cacheHours | 168 | Cache lifetime in hours |
| requestTimeoutMs | 5000 | Timeout for a single lookup |
| minIntervalMs | 1400 | Minimum interval between single-IP requests |
| batchIntervalMs | 4200 | Minimum interval between batch requests |
| batchSize | 100 | IPs per ip-api batch request |
| batchMax | 200 | Maximum IPs accepted from one browser request |
| batchTimeoutMs | 15000 | Batch request timeout |
| debug | false | Write debug messages to the MeshCentral log |

Restart MeshCentral after changing <code>settings.json</code>.

## Updating the plugin

The lookup cache lives in <code>cache.json</code> inside the plugin folder. The release archive does not include it, so replacing the folder deletes the cache.

Recommended update procedure:

~~~bash
# stop MeshCentral
sudo systemctl stop meshcentral

# keep the cache
cp <meshcentral-data>/plugins/ipgeo/cache.json /tmp/ipgeo-cache.json

# replace the plugin folder with the new version

# restore the cache
cp /tmp/ipgeo-cache.json <meshcentral-data>/plugins/ipgeo/cache.json

# start MeshCentral
sudo systemctl start meshcentral
~~~

Hard-refresh the browser after the update.

## Load, batch and cache behavior

- Lookups start when the page renders public IP links, not when the user hovers.
- Only visible rows (viewport plus 200 px) are prefetched.
- Visible IPs are sent as a batch; the server uses <code>ip-api.com/batch</code> with up to 100 IPs per request.
- Offscreen rows are loaded on scroll, resize, focus or returning to the tab.
- Successful results are cached for 7 days in <code>cache.json</code>.
- Free ip-api limits: about 45 single requests/minute and 15 batch requests/minute.
- For a 2000-device list this is a small number of batch requests, not 2000 simultaneous requests.
- For a fully local setup without external GeoIP requests, use a local MaxMind/DB-IP database instead of this plugin.

## Troubleshooting

### The Plugins tab is missing

1. In the browser console check <code>pluginHandler</code>. If it is <code>null</code>, MeshCentral did not create the plugin handler.
2. Confirm the config block is inside <code>settings</code>:

~~~json
{
  "settings": {
    "plugins": { "enabled": true }
  }
}
~~~

3. Confirm you edited the config file that MeshCentral actually reads (<code>--configfile</code>, systemd unit or Docker mount).
4. Check the JSON with <code>jq . config.json</code>.
5. Restart MeshCentral fully.

### Plugin is not loading

Check the MeshCentral log for <code>Error loading plugin: ipgeo</code>. Verify:

~~~text
plugins/ipgeo/config.json
plugins/ipgeo/ipgeo.js
plugins/ipgeo/flags/
~~~

The folder name must be exactly <code>ipgeo</code>.

### Flags are missing

- Confirm the device has a public IP, not a private one.
- Confirm <code>flags/</code> exists and contains SVG files.
- Check the browser network tab for <code>/plugin/ipgeo/flags/&lt;cc&gt;.svg</code>.
- Clear the browser cache with <code>Ctrl+F5</code>.

### Tooltip does not appear

- Confirm the installed version is 1.3.0 or newer.
- In the console check <code>typeof pluginHandler.ipgeo.webShowTip</code>; it must be <code>"function"</code>.
- Check <code>document.querySelector('.ipgeo-b')?.getAttribute('data-tip')</code>; it must contain the provider text.
- If the attribute is empty, inspect <code>cache.json</code> or the MeshCentral log for lookup errors.

### Too many requests or HTTP 429

Keep the default batch and cache settings. Do not lower <code>batchIntervalMs</code> or <code>minIntervalMs</code> below the provider limits.

## Uninstall

1. Remove <code>"ipgeo"</code> from <code>plugins.list</code>, or uninstall it in <code>My Server → Plugins</code>.
2. Delete <code>&lt;meshcentral-data&gt;/plugins/ipgeo</code>.
3. Restart MeshCentral.

## Privacy and security

- The plugin sends public IP addresses to the configured GeoIP service.
- Flags are served locally by MeshCentral.
- Plugins run inside the MeshCentral server process with full server privileges. Install only code you trust.
- Review the source before installing on a production server.
