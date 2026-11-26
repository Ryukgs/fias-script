#!/usr/bin/env python3
"""
ryuk hub - loader packer

scheme (identisch zum loader.lua decoder):
  plain --xor KEY--> bytes --base64(permutiert)--> chars --reverse--> chunks(120)

  python3 tools/pack.py unpack   # loader.lua  -> src/source.lua
  python3 tools/pack.py pack     # src/source.lua -> loader.lua
  python3 tools/pack.py verify   # roundtrip check, aendert nichts
"""

import hashlib
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOADER = ROOT / "loader.lua"
SOURCE = ROOT / "src" / "source.lua"

KEY = b"RyukHub2026"
MUL = 37
ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
CHUNK = 120

PARTS_OPEN = "local parts = {"
PARTS_CLOSE = "\n}"


def _lookup():
    table = {}
    for i in range(64):
        table[ALPHA[(i * MUL) % 64]] = i
    return table


LOOKUP = _lookup()


def b64_encode(data: bytes) -> str:
    out = []
    buf = 0
    bits = 0
    for byte in data:
        buf = (buf << 8) | byte
        bits += 8
        while bits >= 6:
            bits -= 6
            value = (buf >> bits) & 0x3F
            out.append(ALPHA[(value * MUL) % 64])
    if bits:
        value = (buf << (6 - bits)) & 0x3F
        out.append(ALPHA[(value * MUL) % 64])
    return "".join(out)


def b64_decode(text: str) -> bytes:
    buf = 0
    bits = 0
    out = bytearray()
    for char in text:
        value = LOOKUP.get(char)
        if value is None:
            continue
        buf = (buf << 6) | value
        bits += 6
        if bits >= 8:
            bits -= 8
            out.append((buf >> bits) & 0xFF)
            buf &= (1 << bits) - 1
    return bytes(out)


def xor(data: bytes) -> bytes:
    return bytes(b ^ KEY[i % len(KEY)] for i, b in enumerate(data))


def encode_payload(plain: bytes) -> str:
    return b64_encode(xor(plain))[::-1]


def decode_payload(encoded: str) -> bytes:
    return xor(b64_decode(encoded[::-1]))


def extract_encoded(loader_text: str) -> str:
    try:
        block = loader_text.split(PARTS_OPEN, 1)[1].split(PARTS_CLOSE, 1)[0]
    except IndexError:
        raise SystemExit("loader.lua: 'local parts = {' block nicht gefunden")
    return "".join(re.findall(r'"([^"]*)"', block))


def build_loader(loader_text: str, plain: bytes) -> str:
    encoded = encode_payload(plain)
    chunks = [encoded[i : i + CHUNK] for i in range(0, len(encoded), CHUNK)]
    lines = ",\n".join('    "%s"' % chunk for chunk in chunks) + ","
    head = loader_text.split(PARTS_OPEN, 1)[0]
    tail = loader_text.split(PARTS_OPEN, 1)[1].split(PARTS_CLOSE, 1)[1]
    block = "%s\n%s\n}" % (PARTS_OPEN, lines)
    return head + block + tail


def cmd_unpack() -> None:
    plain = decode_payload(extract_encoded(LOADER.read_text(encoding="utf-8")))
    SOURCE.parent.mkdir(parents=True, exist_ok=True)
    SOURCE.write_text(plain.decode("utf-8"), encoding="utf-8")
    print("unpack  %s -> %s (%d bytes lua)" % (LOADER.name, SOURCE.name, len(plain)))


def cmd_pack() -> None:
    if not SOURCE.exists():
        raise SystemExit("src/source.lua fehlt - erst 'unpack' laufen lassen")
    plain = SOURCE.read_bytes()
    text = build_loader(LOADER.read_text(encoding="utf-8"), plain)
    LOADER.write_text(text, encoding="utf-8")
    print("pack    %s -> %s (%d bytes lua, %d bytes loader)"
          % (SOURCE.name, LOADER.name, len(plain), len(text.encode("utf-8"))))


def cmd_verify() -> None:
    current = LOADER.read_bytes()
    from_loader = decode_payload(extract_encoded(current.decode("utf-8")))
    if SOURCE.exists():
        from_source = SOURCE.read_bytes()
        if from_source != from_loader:
            raise SystemExit("MISMATCH: src/source.lua != payload in loader.lua")
        rebuilt = build_loader(current.decode("utf-8"), from_source).encode("utf-8")
        if rebuilt != current:
            raise SystemExit("MISMATCH: neu gepackter loader != loader.lua (formatierung)")
        print("ok      source == payload, repack byte-identisch")
    else:
        print("ok      payload dekodiert (%d bytes lua)" % len(from_loader))
    print("sha256  source %s" % hashlib.sha256(from_loader).hexdigest()[:16])
    print("sha256  loader %s" % hashlib.sha256(current).hexdigest()[:16])


def main() -> None:
    if len(sys.argv) != 2 or sys.argv[1] not in {"pack", "unpack", "verify"}:
        raise SystemExit(__doc__.strip())
    {"pack": cmd_pack, "unpack": cmd_unpack, "verify": cmd_verify}[sys.argv[1]]()


if __name__ == "__main__":
    main()
