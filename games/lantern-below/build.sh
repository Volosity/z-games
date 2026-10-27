#!/bin/sh
# Build The Lantern Below: Inform 6 source -> .z5 story file.
# Needs an Inform 6 compiler (6.44 used during the event) and its standard
# library include directory. Override with INFORM6 / INFORM6_LIB.
set -e
cd "$(dirname "$0")"
INFORM6="${INFORM6:-inform6}"
INFORM6_LIB="${INFORM6_LIB:-/usr/local/share/inform6/lib}"
"$INFORM6" "+$INFORM6_LIB" lantern.inf lantern-below.z5
echo "built: lantern-below.z5"
