#!/usr/bin/env bash
set -euo pipefail

# Pretendard 가변 폰트 서브셋 — 1MB → ~416KB (Lighthouse 모바일 성능 요건)
# 구성: KS X 1001 완성형 한글 2,350자 + 라틴 + 문장부호/기호, 힌팅 제거.
# 사용법: bash scripts/subset-font.sh <원본 PretendardVariable.woff2 경로>
# 결과물이 app/fonts/PretendardVariable.woff2 를 교체한다.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${1:?원본 PretendardVariable.woff2 경로를 인자로 주세요}"
WORK="$(mktemp -d)"
VENV="$WORK/venv"

python3 -m venv "$VENV"
"$VENV/bin/pip" install -q fonttools brotli

"$VENV/bin/python" - "$WORK/korean.txt" <<'EOF'
import sys
chars = set()
for lead in range(0xB0, 0xC9):
    for trail in range(0xA1, 0xFF):
        try:
            chars.add(bytes([lead, trail]).decode("euc-kr"))
        except UnicodeDecodeError:
            pass
open(sys.argv[1], "w", encoding="utf-8").write("".join(sorted(chars)))
print(f"한글 완성형: {len(chars)}자")
EOF

"$VENV/bin/pyftsubset" "$SRC" \
  --flavor=woff2 \
  --output-file="$WORK/subset.woff2" \
  --text-file="$WORK/korean.txt" \
  --unicodes="U+0020-007E,U+00A0-00FF,U+2010-2027,U+2030-205E,U+20A9,U+2190-2199,U+00B7,U+25A0-25CF,U+2605-2606,U+3000-303F,U+3131-318E,U+FF01-FF60" \
  --layout-features="kern,liga,calt,ccmp" \
  --no-hinting \
  --drop-tables+=DSIG

cp "$WORK/subset.woff2" "$ROOT/app/fonts/PretendardVariable.woff2"
ls -lh "$ROOT/app/fonts/PretendardVariable.woff2"
rm -rf "$WORK"
echo "완료 — next build 후 Lighthouse로 검증하세요."
