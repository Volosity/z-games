#!/usr/bin/env python3
"""playtest.py -- acceptance driver for The Lantern Below.

Runs the compiled story file under dfrotz (the dumb-interface Frotz),
feeds it walkthrough.txt line by line, and writes the full session to
playtest-transcript.txt as evidence. The game is deterministic (fixed
enemy patterns, no random rolls), so a passing walkthrough passes
every time; a failing one fails loudly in the transcript.

Env: DFROTZ=/path/to/dfrotz (default: dfrotz on PATH)
"""
import os
import select
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
DFROTZ = os.environ.get("DFROTZ", "dfrotz")
STORY = os.path.join(HERE, "lantern-below.z5")
SCRIPT = os.path.join(HERE, "walkthrough.txt")
OUT = os.path.join(HERE, "playtest-transcript.txt")


def read_until_quiet(proc, timeout=6.0, quiet=0.45):
    """Read stdout until the interpreter goes quiet (it is waiting)."""
    buf = b""
    start = time.time()
    last = time.time()
    fd = proc.stdout.fileno()
    while time.time() - start < timeout:
        r, _, _ = select.select([fd], [], [], 0.05)
        if r:
            chunk = os.read(fd, 65536)
            if not chunk:
                break
            buf += chunk
            last = time.time()
        elif time.time() - last > quiet and buf:
            break
    return buf.decode("utf-8", "replace")


def main():
    commands = []
    for line in open(SCRIPT, encoding="utf-8"):
        line = line.rstrip("\n")
        if line.strip() and not line.lstrip().startswith("#"):
            commands.append(line.strip())
    proc = subprocess.Popen(
        [DFROTZ, "-w", "100", STORY],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT)
    log = []
    log.append("THE LANTERN BELOW -- headless acceptance playtest")
    log.append(f"interpreter: dfrotz (Frotz 2.55, dumb interface)")
    log.append(f"story file:  lantern-below.z5 (Inform 6.44, library 6.12.8)")
    log.append(f"script:      walkthrough.txt ({len(commands)} commands)")
    log.append("=" * 72)
    log.append(read_until_quiet(proc))
    for cmd in commands:
        log.append(f"\n> {cmd}\n")
        proc.stdin.write((cmd + "\n").encode())
        proc.stdin.flush()
        log.append(read_until_quiet(proc))
        if proc.poll() is not None:
            break
    try:
        proc.stdin.close()
    except BrokenPipeError:
        pass
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()
    text = "".join(log)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(text)
    print(text)
    print(f"\n[playtest] transcript written to {OUT}", file=sys.stderr)


if __name__ == "__main__":
    main()
