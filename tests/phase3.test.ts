import { describe, expect, test } from "bun:test";
import {
  buildSoapEnvelope,
  buildSsdpSearch,
  natPmpMapRequest,
  natpmpResultName,
  parseNatPmpMapResponse,
  parseSsdpLocation,
  randomExternalPort,
} from "@share/transport/upnp";
import { sanitizeFilename } from "@share/server";

describe("upnp helpers", () => {
  test("ssdp search + location parse", () => {
    const req = buildSsdpSearch("urn:schemas-upnp-org:device:InternetGatewayDevice:1");
    expect(req).toContain("M-SEARCH");
    expect(req).toContain("239.255.255.250:1900");
    const resp = 'HTTP/1.1 200 OK\r\nCACHE-CONTROL: max-age=1800\r\nLOCATION: http://192.168.1.1:5431/dyndev/uuid:1234\r\n\r\n';
    expect(parseSsdpLocation(resp)).toBe("http://192.168.1.1:5431/dyndev/uuid:1234");
    expect(parseSsdpLocation("HTTP/1.1 200 OK\r\n\r\n")).toBeNull();
  });

  test("soap envelope", () => {
    const xml = buildSoapEnvelope("urn:schemas-upnp-org:service:WANIPConnection:1", "AddPortMapping", {
      NewExternalPort: 51234,
      NewProtocol: "TCP",
    });
    expect(xml).toContain("AddPortMapping");
    expect(xml).toContain("<NewExternalPort>51234</NewExternalPort>");
  });

  test("nat-pmp map request layout (RFC 6886)", () => {
    const b = natPmpMapRequest(8787, 51234, 3600);
    expect(b.length).toBe(12);
    expect(b[0]).toBe(0); // version
    expect(b[1]).toBe(2); // MAP opcode
    expect(b.readUInt16BE(4)).toBe(8787);
    expect(b.readUInt16BE(6)).toBe(51234);
    expect(b.readUInt32BE(8)).toBe(3600);
  });

  test("random external port in ephemeral range", () => {
    for (let i = 0; i < 100; i++) {
      const p = randomExternalPort();
      expect(p).toBeGreaterThanOrEqual(49152);
      expect(p).toBeLessThanOrEqual(65535);
    }
  });

  test("nat-pmp map response: success parses, refusal is surfaced (RFC 6886 §3.5)", () => {
    const ok = Buffer.alloc(16);
    ok[0] = 0; ok[1] = 130; // MAP-TCP response
    ok.writeUInt16BE(0, 2); // result: success
    ok.writeUInt32BE(1234, 4);
    ok.writeUInt16BE(8787, 8);
    ok.writeUInt16BE(51234, 10);
    ok.writeUInt32BE(3600, 12);
    expect(parseNatPmpMapResponse(ok)).toEqual({
      resultCode: 0, epoch: 1234, internalPort: 8787, externalPort: 51234, lifetime: 3600,
    });
    // Refused (code 2) must NOT look like a mapping to port 0.
    const refused = Buffer.from(ok);
    refused.writeUInt16BE(2, 2);
    refused.writeUInt16BE(0, 10);
    refused.writeUInt32BE(0, 12);
    expect(parseNatPmpMapResponse(refused)?.resultCode).toBe(2);
    expect(natpmpResultName(2)).toMatch(/Refused/);
    expect(natpmpResultName(99)).toMatch(/Unknown/);
    // Garbage is rejected, never treated as success.
    expect(parseNatPmpMapResponse(Buffer.alloc(4))).toBeNull();
    const wrongOp = Buffer.from(ok);
    wrongOp[1] = 129;
    expect(parseNatPmpMapResponse(wrongOp)).toBeNull();
  });
});

describe("receive filename sanitization", () => {
  test("confines to basename, rejects junk", () => {
    expect(sanitizeFilename("photo.jpg")).toBe("photo.jpg");
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("")).toBeNull();
    expect(sanitizeFilename("..")).toBeNull();
    expect(sanitizeFilename("a/b")).toBe("b");
  });
});
