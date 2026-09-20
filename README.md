# share0

Share files from your machine, without uploading them anywhere.

```bash
share0 send ./video.mp4
```

Scan the QR code or open the link on any device. No account, no app, no upload.

## Install

### Binary (recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/Xeven777/share0/main/scripts/install.sh | bash
```

Or download manually from [Releases](https://github.com/Xeven777/share0/releases).

### From source

Requires [Bun](https://bun.sh) >= 1.1.

```bash
bun install
# run directly
bun run apps/cli/index.ts send ./file.mp4
# or link globally
bun link
```

## Usage

### Send files

```bash
share0 send ./photo.jpg                      # single file
share0 send file1.jpg file2.jpg              # multiple files
share0 send ./project                        # directory
share0 send ./project --zip                  # compress to archive
share0 send secret.pdf --password            # auto-generate password
share0 send secret.pdf --password 482719     # custom password
share0 send ./video.mp4 --expires 30m        # auto-expire after 30 min
share0 send ./video.mp4 --downloads 1        # limit to 1 download
share0 send ./video.mp4 --upnp               # enable UPnP port mapping
share0 send ./video.mp4 --public             # expose via tunnel
share0 send ./video.mp4 --public --tunnel pinggy
share0 send ./video.mp4 --no-p2p             # disable WebRTC P2P
share0 send ./video.mp4 --detach             # run in background
```

### Receive files

```bash
share0 receive                               # start upload endpoint
share0 receive --dir ./share-inbox           # specify save directory
share0 receive --port 9000                   # custom port
share0 receive --password                    # protect with password
```

### Discover nearby shares

```bash
share0 discover                              # find shares on LAN
```

### Manage active shares

```bash
share0 list                                  # list running shares
share0 stop <id>                             # stop a share
share0 doctor                                # run diagnostics
```

## How it works

```
file/folder -> transfer engine -> best transport -> browser
   |-- LAN (default)           |-- UPnP/NAT-PMP direct (--upnp)
   |-- free tunnel (--public)  |-- WebRTC DataChannel (auto offer)
   |-- IPv6 direct             |-- receive push (--to)
```

- **Local-first:** files stay on your machine; tunnels are fallback transports.
- **Streaming:** files are streamed, never fully buffered; range requests and resume work.
- **No infrastructure:** no server, database, accounts, or cloud storage. Exiting the CLI kills the share.

## Transports

share0 automatically selects the best available transport.

| Transport | When | How |
|---|---|---|
| LAN | Same network (default) | Direct HTTP to sender's IP |
| IPv6 | Direct connectivity | Native IPv6 address |
| UPnP/NAT-PMP | Router supports it | Temporary port mapping (`--upnp`) |
| WebRTC P2P | Auto offer included | DataChannel, ICE via STUN |
| Tunnel | Public access needed | Free tunnel providers (`--public`) |

### Tunnel providers

| Provider | Notes |
|---|---|
| Pinggy | ~60 min free session; default choice |
| LocalXpose | Long-lived candidate (`loclx` binary) |
| Cloudflare | Quick tunnel (`cloudflared`), dev/test oriented |
| LocalTunnel | Fallback (`npx localtunnel`) |
| localhost.run | SSH fallback, speed-limited |
| zrok | 5 GB/day -- small shares only |

## Troubleshooting

**Phone can't open the LAN URL (same Wi-Fi)?**

Check in order:

1. Phone is on Wi-Fi (not mobile data) with no VPN active.
2. Not a guest/hotel/office network (AP isolation blocks phone <-> laptop).
3. Laptop firewall -- the usual suspect. `share0 doctor` flags it and prints the fix:
   - ufw: `sudo ufw allow 8787/tcp`
   - firewalld: `sudo firewall-cmd --add-port=8787/tcp --permanent && sudo firewall-cmd --reload`
4. Multiple networks? The CLI prints all LAN IPs -- try each one.
5. Switched networks after starting? The CLI warns if your IP changes.

**Pinggy shows a warning page?**

That's Pinggy's one-time "Caution" screening on free links. The recipient just has to tap **Enter site**. Programmatic clients (curl) skip it automatically.

**Tunnel link gives 404?**

Some providers issue a URL before edge routing exists. share0 verifies every public link before printing -- dead links are skipped and the next provider is tried.

**SSH asks for a password (Pinggy)?**

Press Enter -- empty password is the documented answer for free tunnels.

**P2P button does nothing?**

It needs to reach the signaling URL first. If ICE can't punch through (symmetric NAT), plain download remains. P2P uses UDP ports 52000-52100 -- with ufw: `sudo ufw allow 52000:52100/udp`.

## Project structure

```
apps/cli/commands/{send,receive,list,stop,doctor}.ts
packages/{core,server,transfer,transport,protocol,discovery,archive}/
scripts/{build.ts,install.sh}
tests/
```

## License

MIT — see [LICENSE](LICENSE).
