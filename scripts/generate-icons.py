"""Generate the app's geometric bar-chart mark using only the Python standard library."""
import struct
import zlib
from pathlib import Path


def icon(size, name):
    rows = bytearray()
    for y in range(size):
        rows.append(0)
        for x in range(size):
            px, py = x / size, y / size
            color = (13, 17, 23)
            for left, top, right, bottom, fill in [
                (.25, .49, .37, .73, (88, 166, 255)),
                (.44, .37, .56, .73, (88, 166, 255)),
                (.63, .25, .75, .73, (63, 185, 80)),
            ]:
                if left <= px <= right and top <= py <= bottom:
                    color = fill
            rows.extend(color)
    def chunk(kind, data):
        return struct.pack('!I', len(data)) + kind + data + struct.pack('!I', zlib.crc32(kind + data))
    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('!2I5B', size, size, 8, 2, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(bytes(rows))) + chunk(b'IEND', b'')
    Path('public/icons', name).write_bytes(png)

for size, name in [(192, 'icon-192.png'), (512, 'icon-512.png'), (512, 'maskable-512.png'), (180, 'apple-touch-icon.png')]:
    icon(size, name)
