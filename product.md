# share — Product Specification

## 1. Product

**Name:** `share`  
**Type:** Open-source local-first file sharing CLI + browser receiver  
**Tagline:** Share files from your machine, without uploading them anywhere.  
**Primary goal:** Make sending a file from one device to another as simple as:

```bash
share0 send ./video.mp4
```

The sender runs a temporary file server on their own machine. The recipient opens a browser link or scans a QR code. The product automatically chooses the best available transport: local network, direct connectivity, or a free tunnel provider.

The product should feel closer to **AirDrop for the terminal** than to Dropbox or WeTransfer.

---

## 2. Product principles

### Local first

Files stay on the sender's machine whenever possible.

Preferred path:

```text
Sender → LAN/direct P2P → Recipient
```

A third-party relay is a fallback, not the default architecture.

### Zero required infrastructure

The core product must run without:

- Our own server
- S3/object storage
- Database
- User accounts
- Paid APIs
- Required cloud backend

A future optional signaling/coordination service may exist, but it must not carry the file data.

### Free by architecture, not by subsidy

The product should remain useful because the sender provides the storage, CPU and upstream bandwidth.

External free tunnels are optional transport adapters, not a dependency that the product's core depends on.

### Browser-first receiving

The recipient should normally need:

- No account
- No CLI
- No native app
- No installation

A phone should be able to scan a QR code and download directly in its browser.

### Password is optional

Default sharing should be frictionless.

```bash
share0 send photo.jpg
```

No password.

Optional protection:

```bash
share0 send secret.pdf --password
```

Password UI should be short and usable. Generated passwords should look like:

```text
482-719
```

or:

```text
K7F2-X9
```

not long cryptographic strings.

Encryption is explicitly out of scope for the first version and can be added later.

### Stream, don't unnecessarily archive

A single file should normally be streamed directly.

```text
video.mp4
   ↓
HTTP range/stream
   ↓
browser
```

ZIP is an explicit option, particularly for directories:

```bash
share0 send ./project --zip
```

Password-protected ZIP should remain available:

```bash
share0 send ./project --zip --password
```

---

## 3. Core user experience

### Basic share

```bash
share0 send ./video.mp4
```

Terminal:

```text
╭──────────────────────────────────────────────────╮
│ SHARE                                             │
│                                                  │
│ video.mp4                                        │
│ 4.72 GB                                          │
│                                                  │
│ Local                                            │
│ http://192.168.1.42:8787/a8Fd                   │
│                                                  │
│ QR                                               │
│ [ terminal QR ]                                  │
│                                                  │
│ Downloads: 0                                     │
│ Expires: when process exits                      │
│                                                  │
│ Press Ctrl+C to stop                             │
╰──────────────────────────────────────────────────╯
```

The terminal should also display any public endpoint that is available:

```text
Public
https://abc.example-tunnel.com/a8Fd
```

The URL should be copied automatically to the clipboard.

### Recipient experience

The mobile/desktop browser opens:

```text
┌───────────────────────────────────────┐
│                                       │
│             SHARE                     │
│                                       │
│           video.mp4                   │
│           4.72 GB                     │
│                                       │
│          [ Download ]                 │
│                                       │
│       Expires in 42 minutes           │
│                                       │
└───────────────────────────────────────┘
```

The interface must work well on narrow mobile screens.

For supported media:

- Images → image preview
- Video → browser video preview
- Audio → browser audio preview
- Text/Markdown → text preview
- PDF → browser PDF preview

Previews must never be required for downloading.

---

## 4. Commands

### Send a file

```bash
share0 send ./photo.jpg
```

### Send multiple files

```bash
share0 send file1.jpg file2.jpg file3.jpg
```

### Send a directory

```bash
share0 send ./project
```

The browser should show directory contents and provide:

```text
Download all
```

A ZIP should be generated only when explicitly requested.

### Public sharing

```bash
share0 send ./video.mp4 --public
```

### Expiration

```bash
share0 send ./video.mp4 --expires 30m
share0 send ./video.mp4 --expires 2h
```

### Download limit

```bash
share0 send ./file.zip --downloads 1
share0 send ./file.zip --downloads 5
```

### Password protection

```bash
share0 send secret.pdf --password
```

Custom password:

```bash
share0 send secret.pdf --password 482719
```

### ZIP

```bash
share0 send ./project --zip
```

### Password-protected ZIP

```bash
share0 send ./project --zip --password
```

The ZIP password should be short and human-readable.

### Receive mode

```bash
share0 receive
```

Long-term goal: a device can advertise a receive endpoint so another device can send directly to it.

### Active shares

```bash
share0 list
```

Example:

```text
ID      NAME          SIZE       DOWNLOADS    EXPIRES
a8Fd    video.mp4     4.72 GB    1 / ∞        41m
91bc    project/      820 MB     0 / 1        2h
```

### Stop a share

```bash
share0 stop a8Fd
```

### Diagnostics

```bash
share0 doctor
```

Expected checks:

```text
✓ Runtime
✓ Network interface
✓ Local IPv4
✓ IPv6
✓ Port availability
✓ LAN connectivity
✓ UPnP/NAT-PMP
✓ Tailscale
✓ cloudflared
✓ Tunnel providers
```

---

## 5. Transport architecture

The product should have a transport abstraction.

```ts
interface Transport {
  name: string
  priority: number

  detect(): Promise<TransportStatus>
  open(options: OpenOptions): Promise<Endpoint[]>
  close(): Promise<void>
}
```

Potential transports:

```text
LAN
Direct IPv6
UPnP / NAT-PMP
WebRTC direct P2P
Tailscale
Pinggy
LocalXpose
LocalTunnel
zrok
localhost.run
Tunnelmole
Cloudflare Tunnel
```

The transport engine should select based on:

- Reachability
- Expected transfer duration
- Provider limits
- User-selected mode
- Local/private vs public sharing
- Current network conditions

Example:

```text
LAN available?
  → use LAN

No LAN
  ↓
Direct IPv6?
  → use IPv6

No direct path
  ↓
WebRTC direct?
  → use P2P

Otherwise
  ↓
Select tunnel provider based on:
  bandwidth
  timeout
  availability
  file size
  estimated duration
```

The user should not normally need to understand tunnel providers.

---

## 6. Large-file strategy

The product must support files far larger than 1 GB.

The key principle is:

**Do not treat a tunnel provider's free bandwidth quota as the product's fundamental transfer limit.**

Large transfers should prefer paths that don't consume provider relay bandwidth:

1. LAN
2. Direct IPv6
3. UPnP/NAT-PMP direct IPv4 when feasible
4. WebRTC direct P2P
5. Suitable free tunnel
6. Other fallback tunnel

The application must never try to bypass provider quotas through account abuse or artificial traffic splitting.

Instead, it should choose a technically valid transport and support resumption.

### Range requests

The HTTP server must support:

```http
Range: bytes=...
```

and respond with:

```http
206 Partial Content
```

This allows browser/device downloads to resume after an interruption.

### Large-file streaming

Never load an entire file into memory.

Preferred path:

```text
Filesystem
   ↓
Readable stream
   ↓
HTTP response
   ↓
Network
```

### Transfer estimation

For large files, estimate transfer duration.

Example:

```text
File size: 42.8 GB

Estimated at current upstream:
100 Mbps → ~57 min
50 Mbps  → ~1h 54m
20 Mbps  → ~4h 46m
```

Use that when selecting a tunnel.

Example:

```text
Pinggy free session ≈ 60 minutes
Estimated transfer = 48 minutes

→ acceptable candidate
```

If the estimated duration exceeds a provider's practical session limit, prefer another transport.

---

## 7. Tunnel/provider strategy

Tunnel providers are adapters, not product dependencies.

### Pinggy

Current free plan documentation advertises unlimited data transfer, while free tunnels have a 60-minute timeout.

SSH form: `ssh -p 443 -R0:localhost:PORT free.pinggy.io` (public hostnames
like `*.run.pinggy-free.link`). If ssh prompts for a password, the documented
answer is an empty line.

Useful for:

- Temporary public links
- Medium/large transfers when they can finish within the session
- Development/testing

Not sufficient as the only transport for arbitrarily long transfers.

Source:
https://pinggy.io/

### LocalXpose

Current free Starter plan lists free HTTP/HTTPS tunneling and multiple active tunnels. The public pricing page does not clearly publish a free bandwidth quota.

Useful candidate for large transfers, but should be validated through automated compatibility checks and real-world testing.

Source:
https://localxpose.io/pricing

### LocalTunnel

Open-source/free hosted tunnel option.

Useful as a fallback.

Because reliability and performance of public hosted instances can vary, the application should not assume unlimited or stable bandwidth.

Source:
https://github.com/localtunnel/localtunnel

### zrok

Current free plan documents 5 GB/day and multiple environments.

Useful for smaller public shares, but not appropriate as the default path for very large files.

Source:
https://zrok.io/pricing/

### localhost.run

Free tunnel service with publicly documented speed limits on free domains.

Useful as a fallback, especially for smaller transfers.

Source:
https://localhost.run/docs/forever-free/

### Tunnelmole

Free/open-source tunneling client and hosted service.

Worth supporting as an optional adapter after compatibility testing.

Source:
https://tunnelmole.com/docs/

### tunnelto.me

Current free plan is heavily constrained and is not appropriate for the main large-file path.

Source:
https://www.tunnelto.me/

### Localtonet

Current free tier is bandwidth/time constrained and is not appropriate for the main large-file path.

Source:
https://www.localtonet.com/

### ngrok

Current free plan has a 1 GB data-transfer allowance and therefore should not be used for large-file sharing.

Source:
https://ngrok.com/pricing

### Tailscale Funnel

Available on Tailscale plans, including the free Personal plan, but Funnel has non-configurable bandwidth limits and should be treated as a private-network/direct-connectivity option rather than the primary large-file relay.

Source:
https://tailscale.com/docs/features/tailscale-funnel

### Cloudflare Tunnel

Cloudflare Tunnel itself does **not** currently document a simple 1 GB/month bandwidth cap.

However, Cloudflare's current documentation places restrictions/expectations around serving video and large amounts of large-file traffic through its reverse proxy. Quick Tunnels are also positioned primarily for development/testing.

Therefore Cloudflare Tunnel should be supported as a convenient temporary public transport, but **not positioned as our guaranteed unlimited large-file transport**.

Sources:
https://developers.cloudflare.com/tunnel/concepts/routing/
https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/

### Provider adapter requirements

Each provider adapter should expose:

```ts
interface ProviderCapabilities {
  maxSessionDuration?: number
  bandwidthLimit?: number
  dailyTransferLimit?: number
  supportsHttps: boolean
  supportsCustomHost: boolean
  supportsLongLivedSessions: boolean
}
```

Provider data should be treated as configurable metadata because free-tier limits can change.

Provider links must be verified before display: the engine fetches `/health`
through each opened tunnel and only prints links proven to route traffic,
failing over to the next provider otherwise. A URL issued before edge routing
exists (observed with quick tunnels) must never be shown as working.

---

## 8. Direct connectivity

### LAN

First-class default.

Detect local interfaces and expose a reachable IPv4/IPv6 URL.

Example:

```text
http://192.168.1.42:8787/a8Fd
```

### IPv6

Attempt direct public IPv6 connectivity when available.

This can eliminate tunnel dependency completely.

### UPnP / NAT-PMP

Optionally request a temporary port mapping.

The mapping must:

- Be short-lived
- Use a random port
- Be removable on process exit
- Be opt-in or carefully detected
- Never expose unrelated local services

### WebRTC

Long-term transport.

Goal:

```text
Browser A
    │
    │ direct WebRTC DataChannel
    │
Browser B
```

The file bytes should travel peer-to-peer whenever ICE negotiation succeeds.

Initial signaling can use:

- Minimal optional coordination service
- Or manual QR-based offer/answer exchange

The signaling system must never become the file relay.

---

## 9. Mobile receiving

The receiver is a web application bundled with the CLI.

The CLI starts:

```text
HTTP server
   ├── API
   ├── web app
   └── file endpoints
```

The web app should be:

- Responsive
- Touch-friendly
- Fast on low-end mobile devices
- Installable as a PWA later
- Functional without account/login
- Compatible with iOS Safari and Android Chrome

### QR code

The CLI generates a QR containing the share URL.

Primary mobile flow:

```text
Run share
   ↓
QR appears
   ↓
Scan with phone camera
   ↓
Browser opens
   ↓
Preview/metadata
   ↓
Download
```

No app installation should be required.

---

## 10. Browser/API design

Suggested endpoints:

```text
GET  /
GET  /api/share
GET  /api/files
GET  /download/:file
GET  /preview/:file
```

Example metadata:

```json
{
  "id": "a8Fd",
  "name": "video.mp4",
  "size": 5073741824,
  "mime": "video/mp4",
  "createdAt": 1790000000000,
  "expiresAt": 1790001800000,
  "downloads": 1,
  "maxDownloads": null,
  "passwordRequired": false
}
```

The server must implement:

- HTTP Range
- `Content-Length`
- `Content-Type`
- `Content-Disposition`
- Streaming
- HEAD where useful
- CORS only where needed
- Clean 404/410 responses for expired shares

---

## 11. Share sessions

Core in-memory model:

```ts
interface ShareSession {
  id: string
  token: string

  source:
    | { type: "file"; path: string }
    | { type: "directory"; path: string }

  name: string
  size?: number

  createdAt: number
  expiresAt?: number

  downloads: number
  maxDownloads?: number

  password?: {
    enabled: boolean
    hash: string
  }

  zip?: {
    enabled: boolean
    path: string
  }
}
```

No database is required.

Lifecycle:

```text
create share
    ↓
store session in memory
    ↓
serve files
    ↓
expire / max downloads reached
    ↓
remove temporary resources
    ↓
destroy session
```

When the CLI exits, active shares should normally disappear.

---

## 12. Password model

Password is independent from ZIP.

### Normal HTTP share

```bash
share0 send secret.pdf --password
```

The browser presents a small password prompt.

### ZIP password

```bash
share0 send ./project --zip --password
```

The generated ZIP should use a short human-entered/generated password.

### Password UX

Default generated password:

```text
482-719
```

Requirements:

- Easy to read
- Easy to say over the phone
- Avoid ambiguous characters
- Not excessively long
- Never shown in URLs unless explicitly chosen

Do not add encryption in v1.

---

## 13. ZIP behavior

### Single file

Default:

```bash
share0 send movie.mp4
```

Serve directly.

### Multiple files

Default behavior may either:

- show a file list and individual downloads, or
- offer "Download all" which dynamically creates an archive

### Directory

Show directory browser.

Optional:

```bash
--zip
```

creates an archive.

### Password-protected archive

If `--zip --password` is used:

```text
project.zip
Password: 482-719
```

ZIP implementation should use a modern maintained library or system capability appropriate for the target platform.

Avoid reproducing the original project's simplistic `zip -P` implementation as the long-term design.

---

## 14. Security

v1 security goals:

- Random share IDs/tokens
- Optional password protection
- Expiration
- Download limits
- No persistent server-side storage
- Do not expose arbitrary filesystem paths
- Resolve all requested paths against an explicit share root
- Prevent path traversal
- Do not execute uploaded/downloaded files
- Restrict dangerous HTTP methods
- Clear session teardown

Not in v1:

- End-to-end encryption
- Zero-knowledge architecture
- Enterprise identity
- Account system

Encryption can be added in a later major version.

---

## 15. Privacy model

Default product behavior:

```text
File
  ↓
Sender's filesystem
  ↓
Temporary local server
  ↓
Recipient
```

No mandatory upload to a company server.

For tunnel mode:

```text
Sender
  ↓
Third-party tunnel
  ↓
Recipient
```

The third-party transport provider may observe network metadata and, depending on protocol and TLS termination, traffic information. This should be documented clearly.

LAN/direct modes provide the strongest privacy model in the initial product.

---

## 16. Technology stack

### Runtime

**Bun + TypeScript**

Reasons:

- Modern runtime
- Fast startup
- Built-in package manager
- Built-in bundling
- Good filesystem/HTTP primitives
- Simple distribution story

### CLI

Recommended:

- `cac` or Commander
- Ink only if terminal UI complexity justifies it
- Native ANSI output for simple status views

### HTTP

Prefer:

- Bun native `Bun.serve()`

Alternative:

- Hono where shared middleware/routing becomes useful

### Frontend

- React
- Vite
- TypeScript
- Minimal CSS/Tailwind only if useful

The web bundle should ship inside the CLI package.

### QR

- `qrcode-terminal` or equivalent maintained package

### Discovery

- mDNS/Bonjour
- local interface detection

### Archive

- Maintained archive library or safe platform-native implementation
- Direct streaming for unarchived files

### Crypto

Only for:

- Random IDs
- Tokens
- Password hashing where required

Encryption is not part of v1.

---

## 17. Repository architecture

```text
share/
├── apps/
│   ├── cli/
│   │   ├── commands/
│   │   │   ├── send.ts
│   │   │   ├── receive.ts
│   │   │   ├── list.ts
│   │   │   ├── stop.ts
│   │   │   └── doctor.ts
│   │   └── index.ts
│   │
│   └── web/
│       ├── components/
│       ├── pages/
│       ├── styles/
│       └── app.tsx
│
├── packages/
│   ├── core/
│   ├── server/
│   ├── transfer/
│   ├── transport/
│   │   ├── lan/
│   │   ├── ipv6/
│   │   ├── upnp/
│   │   ├── webrtc/
│   │   └── tunnels/
│   │       ├── cloudflare/
│   │       ├── pinggy/
│   │       ├── localxpose/
│   │       ├── localtunnel/
│   │       ├── zrok/
│   │       └── ...
│   ├── protocol/
│   ├── discovery/
│   └── archive/
│
├── tests/
├── package.json
├── bun.lock
└── README.md
```

The core domain layer must not depend directly on any tunnel vendor.

---

## 18. Feature roadmap

### Phase 1 — MVP

Goal: replace the basic `share-cli` concept with a modern usable product.

Features:

- `share0 send`
- Single file sharing
- Multiple file sharing
- Directory sharing
- Local HTTP server
- LAN URL
- QR code
- Clipboard copy
- Browser receiver
- Responsive mobile UI
- HTTP streaming
- HTTP Range/resume
- Automatic expiration on process exit
- Download count
- `share0 list`
- `share0 stop`
- Optional password
- Optional ZIP
- SHA-256 metadata
- Clean terminal UX

### Phase 2 — Practical public sharing

Add:

- Cloudflare Tunnel adapter
- Pinggy adapter
- LocalXpose adapter
- LocalTunnel adapter
- zrok adapter
- Provider capability detection
- Transfer-time estimation
- Automatic transport selection
- `--public`
- Better diagnostics

### Phase 3 — Direct networking

Add:

- IPv6 direct mode
- UPnP/NAT-PMP
- mDNS discovery
- Receive mode
- Device discovery
- Better NAT diagnostics

### Phase 4 — P2P

Add:

- WebRTC data transport
- Direct browser-to-browser transfer
- QR-based signaling
- Optional signaling service
- Automatic P2P fallback

### Phase 5 — Advanced product

Potential features:

- PWA installability
- Native desktop wrapper
- Mobile companion app
- Multiple simultaneous transfers
- Parallel chunking
- Transfer history
- Favorites/recent peers
- File integrity verification
- Optional encryption
- Resumable cross-session transfers

---

## 19. Non-goals

Do not turn the initial product into:

- Cloud storage
- Permanent file hosting
- Social file sharing
- A mandatory account-based SaaS
- A paid storage platform
- A central relay network
- A surveillance/analytics-heavy service

The product should stay focused on temporary device-to-device sharing.

---

## 20. Success criteria

A first public release should achieve:

### Sender

```bash
share0 send ./file.zip
```

and get a usable link in seconds.

### Local recipient

A phone on the same Wi-Fi can:

```text
Scan QR
→ open browser
→ download
```

without installing anything.

### Large file

A multi-gigabyte file can be streamed without loading the whole file into memory.

If a network interruption occurs, the download can resume through HTTP Range.

### Public recipient

A remote device can download through a supported free tunnel without the project operating its own storage server.

### Privacy

Stopping the CLI destroys the active share by default.

### Simplicity

Normal users do not need to know:

- What tunnel provider is being used
- What port is open
- Whether the path is LAN/IPv6/tunnel
- How the file is streamed

They simply share a file.

---

## 21. Example final UX

```text
$ share0 send ./wedding-video.mp4

Preparing share...

  File       wedding-video.mp4
  Size       18.4 GB

Connectivity

  ✓ LAN
  ✓ IPv6
  ✓ Tailscale
  ✓ Pinggy
  ✓ LocalXpose

Selected transport: LAN

Local URL
  http://192.168.1.42:8787/m7K2

Public URL
  https://example-tunnel/...  (optional)

QR
  █████████████████████
  ██ ▄▄▄▄▄ ██ ▄▄▄▄▄ ███
  ██ █   █ ██ █   █ ███
  ...

Downloads: 0
Expires: when stopped

Copied local URL to clipboard.

Press Ctrl+C to stop.
```

Browser:

```text
Share

wedding-video.mp4
18.4 GB

[ Preview ]
[ Download ]

Expires when sender stops sharing.
```

Optional:

```text
Password protected

Password: 482-719
```

The recipient should not need to know anything else.

---

## 22. Product thesis

The original `share-cli` proved that a tiny local file server plus a tunnel can make file sharing extremely simple.

The modern version should keep that idea while removing the assumptions that have aged poorly:

```text
Old:
file → ZIP → local server → one tunnel

New:
file/folder
   ↓
transfer engine
   ↓
choose best transport
   ├── LAN
   ├── IPv6
   ├── UPnP
   ├── WebRTC
   └── free tunnel
   ↓
stream directly
   ↓
browser/mobile
```

The central engineering decision is:

**The file should remain on the sender's machine, and the network path should be replaceable.**

That keeps the product free to operate, privacy-friendly, resilient to changing tunnel providers, and capable of scaling from a 5 MB screenshot to very large files without requiring our own file-hosting infrastructure.
