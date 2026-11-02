#!/usr/bin/env bash
set -euo pipefail

version="${1:?用法: scripts/release.sh 0.4.2}"
repo="${UPDATE_REPO:-}"
if [ -z "$repo" ]; then
  repo="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
fi
out="${OUT_DIR:-/tmp/nemorous-release-${version}}"
rm -rf "$out"
mkdir -p "$out"

for target in darwin/arm64 darwin/amd64 linux/arm64 linux/amd64; do
  goos="${target%/*}"
  goarch="${target#*/}"
  GOOS="$goos" GOARCH="$goarch" CGO_ENABLED=0 go build \
    -trimpath \
    -ldflags "-X main.updateRepo=${repo}" \
    -o "${out}/nemorous-mobile-${goos}-${goarch}" .
done

(cd "$out" && for f in nemorous-mobile-*; do zip -q "${f}.zip" "$f"; done)
go run ./cmd/signrelease -dir "$out" -version "$version"
go run ./cmd/signrelease -verify "$out"

echo "release assets: $out"
echo "update repo: $repo"
echo "upload with: gh release create v${version} --title \"v${version}\" --notes-file <notes> ${out}/*"
