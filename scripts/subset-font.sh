#!/usr/bin/env bash
set -euo pipefail

# Pretendard 가변 폰트 서브셋 — 1MB → ~296KB (Lighthouse 모바일 성능 요건)
# 구성: KS X 1001 완성형 한글 2,350자 + 라틴 + 문장부호/기호, 힌팅 제거,
#       가변 축(wght)을 실사용 구간 400~900으로 제한.
#
# 축 제한이 122KB를 줄인다(416→296KB). 원본 축은 45~930인데 사이트가 쓰는 굵기는
# 400(본문)·600·700·800·900뿐이라 나머지 구간의 델타는 전부 낭비다.
# 굵기를 추가로 쓰게 되면 아래 WGHT_RANGE를 함께 넓히고 app/layout.tsx의 weight도 맞출 것.
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

WGHT_RANGE="400:900"

"$VENV/bin/pyftsubset" "$SRC" \
  --flavor=woff2 \
  --output-file="$WORK/subset.woff2" \
  --text-file="$WORK/korean.txt" \
  --unicodes="U+0020-007E,U+00A0-00FF,U+2010-2027,U+2030-205E,U+20A9,U+2190-2199,U+00B7,U+25A0-25CF,U+2605-2606,U+3000-303F,U+3131-318E,U+FF01-FF60" \
  --layout-features="kern,liga,calt,ccmp" \
  --no-hinting \
  --drop-tables+=DSIG

# 가변 축을 실사용 구간으로 잘라낸다. instancer는 woff2를 직접 못 다뤄 ttf로 우회한다.
"$VENV/bin/fonttools" varLib.instancer "$WORK/subset.woff2" "wght=$WGHT_RANGE" \
  -o "$WORK/instanced.ttf" --no-overlap-flag
"$VENV/bin/python" - "$WORK/instanced.ttf" "$WORK/final.woff2" <<'EOF'
import sys
from fontTools.ttLib import TTFont
f = TTFont(sys.argv[1])
f.flavor = "woff2"
f.save(sys.argv[2])
EOF

cp "$WORK/final.woff2" "$ROOT/app/fonts/PretendardVariable.woff2"
ls -lh "$ROOT/app/fonts/PretendardVariable.woff2"
rm -rf "$WORK"
echo "완료 — next build 후 Lighthouse로 검증하세요."
