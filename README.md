<p align="center">
  <h1 align="center">share0</h1>
  <p align="center"><strong>A Dead Simple CLI tool to share files from your machine, without uploading them anywhere.</strong></p>
  <p align="center">One command. A link and a QR code. Any browser can download. No account. No cloud.</p>
</p>
<p align="center">
  <a href="https://github.com/Xeven777/share0/stargazers"><img src="https://img.shields.io/github/stars/Xeven777/share0?style=social" alt="GitHub stars" /></a>
  <a href="https://github.com/Xeven777/share0/network/members"><img src="https://img.shields.io/github/forks/Xeven777/share0?style=social" alt="GitHub forks" /></a>
  <a href="https://github.com/Xeven777/share0/releases"><img src="https://img.shields.io/github/v/release/Xeven777/share0?display_name=tag" alt="Latest release" /></a>
  <a href="https://github.com/Xeven777/share0/issues"><img src="https://img.shields.io/github/issues/Xeven777/share0" alt="Open issues" /></a>
  <a href="https://github.com/Xeven777/share0/blob/main/LICENSE"><img src="https://img.shields.io/github/license/Xeven777/share0" alt="MIT license" /></a>
</p>

<img src="./Share0.webp" alt="share0 pic" width="100%" />

<p align="center">
  <video src="https://github.com/user-attachments/assets/d97056a5-f66b-4efa-a28b-48484ab52d1b" controls width="100%">
    Your browser does not support the video tag.
  </video>
</p>

<p align="center">
  <a href="https://bun.sh"><img src="https://img.shields.io/badge/Bun-%E2%89%A51.1-black?logo=bun" alt="Built with Bun" /></a>
  <img src="https://img.shields.io/badge/platform-linux%20%7C%20macos%20%7C%20windows-blue" alt="Linux, macOS, Windows" />
  <img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs welcome" />
</p>

<p align="center">
  <a href="#-quick-start">Quick start</a> •
  <a href="#-usage">Usage</a> •
  <a href="#-how-it-works">How it works</a> •
  <a href="#-troubleshooting">Troubleshooting</a> •
  <a href="#-contributing">Contributing</a>
</p>

---

```bash
share0 send ./video.mp4
```

```text
Local  http://192.168.1.42:8787/a8Fd
QR     scan with your phone camera
Done   link is in your clipboard
Press Ctrl+C to stop
```

That is the whole flow. If the devices share Wi-Fi, the bytes move over your network and never touch a third party server. Kill the command and the share dies.

If this saves you a WeTransfer upload, please [star the repo](https://github.com/Xeven777/share0). It helps more than you think.

## ✨ Why people like it

- 📂 **Send anything.** Single files, multiple files, full directories. Add `--zip` to serve a directory as one archive.
- ⚡ **Starts at once, resumes on drop.** The server streams from disk with HTTP Range support. A 20 GB video never loads fully into memory.
- 📱 **Phones just work.** The recipient scans a QR code and downloads in the browser. No app, no login.
- 🌍 **Public when you need it.** Add `--public` and share0 opens a free tunnel, checks `/health` through it, and prints only links that answer.
- 🔒 **Private when you need it.** Short passwords like `482-719`, expiry like `30m`, download limits like `--downloads 1`.
- 📥 **Push the other way.** `share0 receive` turns your machine into a drop box someone can upload to.
- 🔤 **Skip the link.** `--to anish` sends to a name instead of a long URL. Optional, and the only part that needs a server.
- 🩺 **Fixes its own network issues.** `share0 doctor` checks ports, firewalls, IPv6, UPnP, and tunnel binaries and prints the exact fix.

## 🚀 Quick start

Install with npm (Node 18+). The package pulls the prebuilt binary for your
platform and verifies its checksum:

```bash
npm i -g share0-cli      # the installed command is still `share0`
```

Or install the standalone binary straight from GitHub Releases:

```bash
curl -fsSL https://raw.githubusercontent.com/Xeven777/share0/main/scripts/install.sh | bash
```

Or download a prebuilt binary from [Releases](https://github.com/Xeven777/share0/releases) and put it on your PATH.

Run from source with [Bun](https://bun.sh) 1.1 or newer:

```bash
bun install
bun run apps/cli/index.ts send ./file.mp4
```

## 📖 Usage

Every command here is one of these. Pick the row that matches your situation.

| Situation | Command | Needs |
|---|---|---|
| Someone is next to you | `share0 send ./file` | nothing |
| Someone is far away, one file | `share0 send ./file --public` | nothing, they scan a QR |
| Someone sends to you | `share0 receive --public` | nothing |
| Someone is far away, often | `share0 send ./file --to <name>` | a hub (below) |

Only the last one needs a server. It is worth the setup if you send to the same
person regularly, and not worth it otherwise.

### Sending to someone nearby

The default. Both devices on the same network, so no account and no internet.

```bash
share0 send ./video.mp4
```

They scan the QR, or open the printed URL. Works for one file, several files,
and whole directories.

```bash
share0 send ./photo.jpg
share0 send file1.jpg file2.jpg
share0 send ./project          # browsable in the browser
share0 send ./project --zip    # one archive instead
```

If it does not work, run `share0 doctor`. It checks the port, the firewall,
and the network and prints the fix. Guest and hotel Wi-Fi usually blocks this.

### Sending to someone far away, one time

Add `--public`. share0 opens a free tunnel to your machine, waits for it to
answer, then prints a link and a QR code. They open it in any browser. No app,
no account, nothing installed on their side.

```bash
share0 send ./video.mp4 --public
```

The file stays on your disk and is served as they download, so you can stop
the command the moment they are done.

Pick a provider with `--tunnel`: `auto`, `ask`, `pinggy`, `localxpose`,
`cloudflare`, `localtunnel`, `localhost.run`, `zrok`. The default is `auto`,
which tries each until a link actually works.

```bash
share0 send ./video.mp4 --public --tunnel pinggy
```

Free tunnels end on their own. Pinggy runs about 60 minutes, zrok allows 5 GB
a day, Cloudflare quick tunnels last as long as the command does.

### Receiving files from someone

`receive` turns your machine into a drop box, so they push to you instead of
you serving.

```bash
share0 receive
```

That gives you a LAN URL. To accept files from another network, add `--public`:

```bash
share0 receive --public
```

They push to the URL you print:

```bash
share0 send ./report.pdf --to http://192.168.1.10:8788
share0 send ./report.pdf --to http://xyz.trycloudflare.com
```

Files land in `./share-inbox`. Directories are archived automatically, so
`--to http://… ./photos` sends a zip.

### Sending to a name instead of a link

The optional one. It suits people you send to often, where pasting a
60-character tunnel URL into a chat app gets old.

The receiver publishes a name, you use it:

```bash
# on their machine
share0 receive --public --as anish
```

```text
Send to this inbox
  share0 send ./file --to anish
```

```bash
# on yours, from then on
share0 send ./holiday.zip --to anish
```

No link to copy. Worth setting up only for a name you will reuse.

If you would rather say something out loud once than tell them a name every
time, use `--code` and share0 prints three characters:

```bash
share0 receive --public --code
```

A name only resolves while the receiver is running. They refresh it every 10
minutes and the hub forgets anything unrefreshed after 30, so a closed terminal
stops resolving on its own and there is nothing to clean up. A push also
checks that the inbox answers before it starts, so a name whose tunnel died
fails with a clear message instead of hanging.

#### Setting up a hub

The hub maps a name to a live URL. It never carries file bytes and knows
nothing about your files.

Run one on any machine that stays switched on, then point both sides at it:

```bash
share0 hub --host 0.0.0.0          # listens on 8790
export SHARE0_HUB=http://that-machine:8790
```

`--host 0.0.0.0` is needed when the sender or receiver is on another machine.
Leave it off to test on one machine.

Or host it free as a Cloudflare Worker, which suits both sides being on
different networks. From the repo root:

```bash
cd hub
npx wrangler kv namespace create SHARE0   # paste the printed id into wrangler.toml
npx wrangler deploy
```

`bun run hub:deploy` does the same thing and handles the directory. Wrangler
refuses to run from the repo root, because the root `package.json` declares
workspaces.

Set `SHARE0_HUB` to the resulting `https://share0-hub.<you>.workers.dev` on
both machines. There are no accounts. To skip the environment variable, pass
`--hub <url>` to `send` or `receive` instead:

```bash
share0 send ./file --to anish --hub https://your-hub.example
```

The free tier allows 1,000 writes a day. A receiver refreshing every 10 minutes
spends 144, so several inboxes fit.

Two things to know. The hub has no authentication, so anyone who knows its
address can claim a name, and a name is not a secret. The in-memory version
loses everything on restart, which is fine because receivers re-announce
within 10 minutes.

### Locking a share down

```bash
share0 send secret.pdf --password        # generates one and prints it
share0 send secret.pdf --password 482719 # or pick your own
share0 send ./video.mp4 --expires 30m    # stop serving after 30 minutes
share0 send ./video.mp4 --downloads 1    # allow one download, then stop
```

### The interactive menu

Bare `share0` opens a menu covering all of the above:

```text
Send files…         share a file or folder
Send to a name…     push to someone's inbox
Receive files…      open an upload inbox
Publish an inbox…   get a name others can send to
Run a hub…          name lookup server
Discover nearby…    find LAN shares
Active shares       list running shares
Doctor              diagnose network + tunnels
```

### Finding and stopping shares

```bash
share0 discover   # shares and inboxes on the LAN
share0 list       # shares you are running
share0 stop a8Fd  # stop one
share0 doctor     # check ports, firewall, and tunnels
```

### Flags you will not often use

```bash
share0 send ./file --port 9000     # if 8787 is taken
share0 send ./file --qr=off        # no QR code
share0 send ./file --no-p2p        # skip the WebRTC attempt
share0 send ./file --upnp          # ask the router for a port mapping
share0 send ./file --detach        # keep serving after you close the terminal
share0 send ./file --quiet         # print URLs only, for scripts
share0 send ./file --json          # same, as JSON
```


## 🔧 How it works

Your machine serves. The browser downloads. There is no database and no
account. Exit the CLI and the share ends.

```text
  YOU                                              THEM
  ┌─────────────────────┐                    ┌──────────┐
  │ share0 send ./f     │                    │          │
  │                     │  ── LAN ──────────▶│ browser  │  same Wi-Fi
  │  serves ./f from     │                    │          │  no internet
  │  disk, streams it    │  ── tunnel ──────▶│ browser  │  far away
  │                     │                    │          │
  └─────────────────────┘                    └──────────┘
        your file never leaves your disk
```

Two shapes cover everything:

**You serve, they download.** `send` starts an HTTP server on your machine
and prints a URL. `receive` does the same but accepts uploads instead. This is
the whole tool.

**A name stands in for the URL.** Only for `--to <name>`. The receiver
publishes `anish -> https://xyz.trycloudflare.com` on a hub, and the sender
looks that up. A lookup, not a transfer; the bytes still move directly.

| Transport | When share0 uses it | How it moves bytes |
|---|---|---|
| LAN | Same Wi-Fi or cable, the default | Direct HTTP to your LAN IP |
| IPv6 | Both sides have direct IPv6 | Direct HTTP to your IPv6 address |
| UPnP | You pass `--upnp` | Short lived router port mapping, removed on exit |
| WebRTC P2P | Offered by default, uses UDP 52000 to 52100 | Browser DataChannel with STUN for NAT traversal |
| Tunnel | You pass `--public` | Free tunnel adapter, link checked with `/health` before display |

share0 picks the first one that works and never reports a link it has not
probed. Tunnel adapters include Pinggy, LocalXpose, Cloudflare quick tunnel,
LocalTunnel, localhost.run, and zrok.

### share0 vs the usual tools

| Task | Cloud upload tools | share0 |
|---|---|---|
| Send a 10 GB video | Wait for upload, then wait for download, pay for storage | Stream it from disk, start at once, pay nothing |
| Share on home Wi-Fi | Still round trips through a data center | Moves over LAN at LAN speed |
| Share with a phone | Ask them to install an app and make an account | They scan a QR code in the camera app |
| End access | Hope the expiry setting worked | Press Ctrl+C, the server stops, the URL dies |

<details>
<summary><strong>"X" is not available right now</strong></summary>

The name did not resolve on the hub, so the receiver is not publishing.

```bash
# on their machine, check it is actually running
share0 receive --public --as anish
```

If that works, the two machines disagree about the hub. Compare
`echo $SHARE0_HUB` on both. It must be the same address and reachable from
both.

</details>

<details>
<summary><strong>The name resolves but the inbox does not answer</strong></summary>

The hub entry is alive but the receiver's tunnel died, which can happen up to
30 minutes after a crash. share0 checks the inbox before pushing and says so
instead of hanging.

Ask them to run `share0 receive --public --as anish` again, or push to the
printed URL while their tunnel is still up.

</details>

<details>
<summary><strong>The hub is not reachable</strong></summary>

`share0 hub` binds to 127.0.0.1 by default, which only works for testing on
one machine. Use `--host 0.0.0.0` when another machine needs it:

```bash
share0 hub --host 0.0.0.0
```

Behind a router you also need the port forwarded, or a tunnel in front of it.

</details>

## ❓ Troubleshooting

<details>
<summary><strong>Phone cannot open the LAN URL on the same Wi-Fi</strong></summary>

Work through this list in order.

1. Confirm the phone uses Wi-Fi, not mobile data, with no VPN active.
2. Skip guest, hotel, and office networks. Many block device to device traffic.
3. Check the laptop firewall. `share0 doctor` flags a blocked port and prints the fix.
4. The CLI prints every LAN IP it finds. Try each one.
5. If you switched networks after starting, restart the share. The CLI warns when your IP changes.

Fix a blocked port 8787:

```bash
sudo ufw allow 8787/tcp
```

```bash
sudo firewall-cmd --add-port=8787/tcp --permanent
sudo firewall-cmd --reload
```

</details>

<details>
<summary><strong>Pinggy shows a warning page</strong></summary>

That is Pinggy free link screening. The recipient taps Enter site once and the download page loads. Curl clients skip it.

</details>

<details>
<summary><strong>Tunnel link returns 404</strong></summary>

Some providers hand out a URL before edge routing exists. share0 requests `/health` through each tunnel and prints only links that answer. Dead links never print.

</details>

<details>
<summary><strong>SSH asks for a password for Pinggy</strong></summary>

Press Enter. Empty input is the documented answer for free tunnels.

</details>

<details>
<summary><strong>The P2P button does nothing</strong></summary>

The browser must reach the signaling URL first. Symmetric NAT often blocks UDP hole punching. Plain download still works. To open the P2P port range on ufw:

```bash
sudo ufw allow 52000:52100/udp
```

</details>

## 🗺️ Roadmap

- [x] LAN sharing with QR codes and clipboard copy
- [x] Streaming with HTTP Range resume
- [x] Passwords, expiry, download limits, ZIP mode
- [x] Free tunnel adapters with verified links
- [x] UPnP port mapping and WebRTC P2P offer
- [x] Receive mode and LAN discovery
- [x] Inbox mode: hub handles, `receive --public`, `send --to <name>`
- [ ] Sender-minted 3-character codes (`send --pair`) for one-off shares
- [ ] PWA receiver and installable share pages
- [ ] Optional end-to-end encryption
- [ ] Native desktop and mobile wrappers

Have an idea? [Open an issue](https://github.com/Xeven777/share0/issues/new) or send a PR.

## 🤝 Contributing

Contributions are welcome. Big feature? Open an issue first so we agree on scope.

```bash
git clone https://github.com/Xeven777/share0.git
cd share0
bun install
bun test
bun run apps/cli/index.ts doctor
```

Please run `bun test` before pushing. Keep transport vendors behind the adapter interface in `packages/transport`, and keep `packages/core` free of vendor imports.

## 🙏 Acknowledgements

Built with [Bun](https://bun.sh). Tunneling via [Pinggy](https://pinggy.io), [LocalXpose](https://localxpose.io), [Cloudflare](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/), [LocalTunnel](https://github.com/localtunnel/localtunnel), [localhost.run](https://localhost.run), and [zrok](https://zrok.io). Inspired by the original `share-cli` idea of a tiny local server plus a tunnel.

## 📄 License

MIT. See [LICENSE](LICENSE).
