# Credits

## This project's own work (MIT)

Galileo / Z-Games — the accessible shell, interpreter core, services,
and tooling in this repository — was built during the Meta Global AI
Developer Hackathon (Oct 27 – Nov 4, 2026). See `LICENSE`.

**The Lantern Below** (`games/lantern-below/`) — the bundled showcase
game — is an original work written for this event in Inform 6: seven
rooms, telegraphed souls-like combat, death-and-recovery. Source,
build script, and a machine-checked acceptance walkthrough included.

## Licensed components (not our work)

### Figaro — bundled starter game

- **Title:** Figaro — "a co-authored revenge"
- **Author:** Victor Gijsbers
- **Version:** Release 2 / Serial number 100911 (Inform 7 build 6E72)
- **License:** GNU General Public License, version 3 (full text at
  `games/figaro/GPL-3.0.txt`)
- **Form in this repo:** the original, unmodified `Figaro.zblorb` as
  published on the IF Archive, plus its published Inform 7 source
  (`Figaro-source.zip`, unmodified), under `games/figaro/`.
- **Source:** IF Archive — `games/zcode/Figaro.zblorb` and
  `games/source/inform/Figaro-source.zip`
  (https://www.ifarchive.org/if-archive/games/zcode/Figaro.zblorb).
- Figaro is a separate work, merely aggregated here as the shell's
  starter game; the shell plays it as data and does not incorporate its
  code. It is never presented as the entrant's own work — in the repo,
  on the page, or in the demo.

## Standards

The interpreter core was written against the **Z-Machine Standards
Document** (v1.0/1.1, inform-fiction.org / IF Archive), the public
specification of the Z-machine virtual machine. Save files follow the
**Quetzal** save-format specification (v1.4).

## Testing references (not shipped, not part of the product)

**Frotz 2.55** (GPL v3; David Griffith and contributors) was built
from its pristine source release solely as a test oracle: the
cross-interpreter proof (`test/quetzal-frotz.mjs`) shows save files
written by this project's core restore in Frotz and vice versa.
No Frotz code is included in this repository or the product.
