"""Rebuild per100g / micro100g / source in data/foods.json from the CSVs in data/raw.

Selection rules (Phase 1, approved):
  - raw_foods_utf8.csv first, integrated_foods_utf8.csv for processed foods (tofu, Greek yogurt).
  - Same state as `basis` (raw = 생것, cooked = 찐것/삶은것/밥).
  - Label priority: "대표_평균" > "_평균" > others; for vegetables the generic entry
    (e.g. "케일_생것") plays the role of 대표. Several varieties -> 2~3 common varieties averaged.
  - Blank per100g fields are filled from another entry of the same food and flagged "보충".
  - Micronutrient blanks stay blank.

Usage (from the repo root):
  python3 scripts/curate_foods.py            # dry run: print fields that would change
  python3 scripts/curate_foods.py --write    # rewrite data/foods.json

id, name, category, group, basis, portion, unit, cookingHint are kept from the current file.
"""

import csv
import json
import re
import sys
from collections import OrderedDict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FOODS_PATH = ROOT / 'data' / 'foods.json'
RAWF, INTF = 'raw_foods_utf8.csv', 'integrated_foods_utf8.csv'
USDA = 'USDA FoodData Central'


def load(fn):
    with open(ROOT / 'data' / 'raw' / fn, encoding='utf-8') as f:
        return {r['식품코드']: r for r in csv.DictReader(f)}


DB = {RAWF: load(RAWF), INTF: load(INTF)}

MACRO = OrderedDict(kcal='에너지(kcal)', protein='단백질(g)', carbs='탄수화물(g)', fiber='식이섬유(g)', fat='지방(g)',
                    satFat='포화지방산(g)', sodium='나트륨(mg)', cholesterol='콜레스테롤(mg)')
MICRO = OrderedDict(potassium='칼륨(mg)', calcium='칼슘(mg)', iron='철(mg)', vitaminA='비타민 A(μg RAE)', vitaminC='비타민 C(mg)',
                    vitaminD='비타민 D(μg)')
DECIMALS = dict(kcal=0, protein=1, carbs=1, fiber=1, fat=1, satFat=1, sodium=0, cholesterol=0, vitaminD=1, potassium=0, calcium=0, iron=1, vitaminA=0, vitaminC=1)


def rnd(k, v):
    r = round(v + 1e-9, DECIMALS[k])
    return int(r) if DECIMALS[k] == 0 else r


def num(s):
    s = (s or '').strip()
    return float(s) if s else None


def R(*codes):
    return [(RAWF, c) for c in codes]


def I(*codes):
    return [(INTF, c) for c in codes]


def regex_codes(fn, pattern):
    return [(fn, c) for c, r in DB[fn].items() if re.search(pattern, r['식품명'])]


# ---- selection specs ------------------------------------------------------
# codes:  entries averaged for every field
# fill:   {field: codes} used when a per100g field is blank in `codes` (flag 보충)
# animal: blank fiber/carbs -> 0
# method: Korean description shown to reviewers (default: "단일 항목" / "N개 항목 평균")
SPEC = {
    'chicken-breast': dict(codes=R('R209-008000501-0000'), animal=True),
    'chicken-thigh': dict(usda=True),
    'chicken-tenderloin': dict(codes=R('R209-008000501-0000'), animal=True, flags=['가슴살 기준값'],
                               method='원재료성에 닭안심 항목 없음 → 닭가슴살(껍질 제거) 생것 값 사용'),
    'duck': dict(codes=R('R209-040008601-0000'), animal=True),
    'pork-tenderloin': dict(codes=R('R209-014008701-0000'), animal=True),
    'pork-shoulder': dict(codes=R('R209-014008801-0000'), animal=True),
    'pork-loin': dict(codes=R('R209-014006501-0000'), animal=True),
    'pork-ham': dict(codes=R(*[f'R209-0140{n}01-0000' for n in ('027', '026', '025', '024', '023', '022')]), animal=True,
                     method='뒷다리 세부 부위 6개 평균'),
    'beef-eye-round': dict(codes=R('R209-027061701-0000', 'R209-027081701-0000'), animal=True, method='한우 1등급·2등급 평균'),
    'beef-round': dict(codes=R('R209-027066201-0000', 'R209-027086201-0000'), animal=True, method='한우 1등급·2등급 평균'),
    'beef-shank': dict(codes=R('R209-027068501-0000', 'R209-027088501-0000'), animal=True, method='한우 1등급·2등급 평균'),
    'beef-tenderloin': dict(codes=R('R209-027068701-0000', 'R209-027088701-0000'), animal=True, method='한우 1등급·2등급 평균'),
    'mackerel': dict(codes=R('R211-021014001-0441', 'R211-021014001-1208'), animal=True,
                     micro_usda={'vitaminD': (9.1, 'FDC 173672', 'Fish, mackerel, Pacific and jack, mixed species, raw')},
                     fill={'sodium': R('R211-021014001-0438', 'R211-021014001-0010'),
                           'cholesterol': R('R211-021014001-0010')},
                     sat_ratio_from=R('R211-021014001-0010'),
                     method="'대표_평균' 없음 → 국내 '고등어_육_생것_*_평균' 2개(제주·부산) 평균, 수입 제외"),
    'salmon': dict(codes=R('R211-201094001-7014', 'R211-201094001-5350', 'R211-201094001-5311'), animal=True,
                   method="'대표_평균' 없음 → '연어_육_생것_수입(영국/뉴질랜드/노르웨이)_평균' 3개 평균"),
    'shrimp': dict(codes=R('R211-717414001-0000', 'R211-717134001-0402'), animal=True,
                   fill={'cholesterol': R('R211-717417401-0000')},
                   method='일반 품종 2개(흰다리새우 대표_평균, 대하 인천_평균) 평균'),
    'squid': dict(codes=R('R211-667114001-0000'), animal=True, fill={'cholesterol': R('R211-667094801-1201')}),
    'tuna': dict(codes=R('R211-059094001-7079'), animal=True, method="'대표_평균' 없음 → '수입_평균' 사용"),
    'cod': dict(codes=R('R211-065034001-5519'), animal=True, method="'대표_평균' 없음 → 유일한 '평균' 항목(수입_평균) 사용",
                micro_fill={'vitaminD': R('R211-065032801-0000', 'R211-065031601-0000')}),
    'pollack': dict(codes=R('R211-107034001-5519', 'R211-107034001-1273'), animal=True,
                    micro_usda={'vitaminD': (0.0, 'FDC 2768188', 'Alaska Pollock, raw (Foundation)')},
                    method="'대표_평균' 없음 → '평균' 항목 2개(수입·강릉) 평균"),
    'spanish-mackerel': dict(codes=R('R211-171014001-0000'), animal=True, fill={'cholesterol': R('R211-171014001-0757')}),
    'flatfish': dict(codes=R('R211-043014001-0000'), animal=True, fill={'cholesterol': R('R211-043011601-1040')}),
    'egg': dict(codes=R('R210-003000001-0000'), animal=True),
    'tofu': dict(codes=I('P106-001000100-0205', 'P106-001000100-0039', 'P106-001000100-0545', 'P106-001000100-0902', 'P106-001000100-0870'),
                 method="통합 파일 일반 '국산콩 두부' 5개 제품 평균(순두부·연두부·양념 제품 제외)"),
    'greek-yogurt': dict(micro_fill={'vitaminD': I('P119-202040200-1573')},
                         codes=I('P119-202040200-1783', 'P119-202040200-0574', 'P119-202040200-1354', 'P119-202040200-1355', 'P119-202040200-1511'),
                         animal=True,
                         method="통합 파일의 무가당·플레인 그릭요거트 중 단백질 9g 이상(꾸덕한 정통 제품) 5개 평균, 락토프리·두유 제품 제외"),
    'black-soybean': dict(codes=R('R104-012050046-0000')),
    'chickpea': dict(codes=R('R104-021010083-0000')),
    'lentil': dict(codes=R('R104-020018183-0000')),
    'white-rice': dict(codes=R('R101-013000300-0000')),
    'brown-rice': dict(codes=R('R101-013000500-0000')),
    'multigrain-rice': dict(multigrain=True),
    'oat-rice': dict(oatrice=True),
    'oats': dict(codes=R('R101-001020101-0000', 'R101-001010101-0000'), method='일반 품종 2개(쌀귀리·겉귀리 도정 생것) 평균'),
    'sweet-potato': dict(codes=R('R102-006000049-0000')),
    'kabocha': dict(codes=R('R106-198040049-0000')),
    'potato': dict(codes=R('R102-001140049-0000', 'R102-001060049-0000'), method='일반 품종 2개(수미·대지 찐것) 평균'),
    'cabbage': dict(codes=R('R106-129000001-0000')),
    'lettuce': dict(codes=R('R106-101173701-0000', 'R106-101163701-0000', 'R106-101163601-0000'),
                    method='일반 품종 3개(잎상추 적상추, 치마상추 적·청) 생것 평균'),
    'perilla-leaf': dict(codes=R('R106-207007801-0000')),
    'spinach': dict(codes=R('R106-115000001-0000')),
    'broccoli': dict(codes=R('R106-092000001-0000')),
    'asparagus': dict(codes=R('R106-122000001-0000')),
    'paprika': dict(codes=R('R106-194008101-0000', 'R106-194008001-0000', 'R106-194008201-0000'), method='빨강·노랑·주황 생것 평균'),
    'tomato': dict(codes=R('R106-186000001-0000')),
    'cucumber': dict(codes=R('R106-148010001-0000', 'R106-148050001-0000'), method='일반 품종 2개(개량종·취청) 생것 평균'),
    'zucchini': dict(codes=R('R106-198050001-0000')),
    'onion': dict(codes=R('R106-132000001-0000')),
    'king-oyster-mushroom': dict(codes=R('R107-023000001-0000')),
    'bean-sprouts': dict(codes=R('R106-182000001-0000')),
    'kale': dict(codes=R('R106-180000001-0000'), method="품종별 항목 대신 일반 항목 '케일_생것' 사용"),
    'water-parsley': dict(codes=R('R106-077030001-0000'), method="부위별(잎·줄기) 대신 전체 항목 '미나리_물미나리_생것' 사용"),
}
for fid, code in [('bok-choy', 'R106-175000001-0000'), ('napa-cabbage', 'R106-087060001-0000'), ('young-cabbage', 'R106-136000001-0000'),
                  ('iceberg', 'R106-101143601-0000'), ('chives', 'R106-091060001-0000'), ('mallow', 'R106-123000001-0000'),
                  ('eggplant', 'R106-003000001-0000'), ('green-pepper', 'R106-196008301-0000'), ('cauliflower', 'R106-030000001-0000'),
                  ('red-cabbage', 'R106-129010001-0000'), ('radish', 'R106-065027601-0000'), ('carrot', 'R106-041007601-0000'),
                  ('celery', 'R106-107000001-0000'), ('oyster-mushroom', 'R107-004000001-0000'), ('shiitake', 'R107-027007101-0000'),
                  ('enoki', 'R107-025000001-0000'), ('mung-bean-sprouts', 'R106-112000001-0000'), ('bracken', 'R106-016000047-0000')]:
    SPEC[fid] = dict(codes=R(code))

# Fat sources (Phase 2, approved): unsalted, unseasoned entries only — 생것, 말린것 (= unroasted raw nut) or 볶은것.
for fid, code in [('almond', 'R105-020000058-0000'), ('walnut', 'R105-035000002-0000'), ('pine-nut', 'R105-023000001-0000'),
                  ('pistachio', 'R105-032000058-0000'), ('pecan', 'R105-033000002-0000'), ('peanut', 'R105-007000058-0000'),
                  ('pumpkin-seed', 'R105-036000002-0000'), ('sunflower-seed', 'R105-034000058-0000'),
                  ('perilla-seed', 'R105-005000058-0000'), ('sesame', 'R105-026020058-0000'), ('flaxseed', 'R105-037000058-0000'),
                  ('chia', 'R105-038000002-0000'), ('avocado', 'R108-064000001-0000')]:
    SPEC[fid] = dict(codes=R(code))
SPEC['chia']['micro_zero'] = {'vitaminD': '원자료 빈칸, 식물성 씨앗이라 0으로 처리'}

NOTES = {
    'mackerel': '오메가3 지방산이 많은 등푸른 생선',
    'salmon': '오메가3 지방산이 많은 생선',
    'spanish-mackerel': '등푸른 생선이지만 고등어보다 지방이 적은 편',
    'tuna': '붉은살 생선, 회·스테이크용 냉동 제품이 흔함',
    'egg': '노른자에 콜레스테롤이 많은 편',
    'shrimp': '콜레스테롤이 많은 편',
    'squid': '콜레스테롤이 많은 편',
    'tofu': '제품마다 수치 차이가 있음(국산콩 두부 5개 제품 평균)',
    'greek-yogurt': '제품마다 열량·지방 차이가 큼, 무가당 제품 기준',
    'oats': '수용성 식이섬유(베타글루칸)가 들어 있음',
    'tomato': '붉은 색소 라이코펜이 들어 있고 익히면 흡수가 잘 됨',
    'spinach': '수산(옥살산)이 있어 데쳐 먹는 경우가 많음',
    'perilla-leaf': '향이 강해 쌈이나 향채로 쓰기 좋음',
    'duck': '훈제오리는 나트륨이 많아 생오리 기준',
    'walnut': '오메가3 지방산(알파리놀렌산)이 들어 있는 견과',
    'peanut': '견과처럼 먹지만 콩과 식물, 알레르기가 흔한 편',
    'flaxseed': '통째로는 소화가 잘 안 돼 갈아서 먹는 경우가 많음',
    'chia': '물에 불리면 젤처럼 부풀어 오름',
}


def avg_fields(codes, fields):
    """Average each field over entries that have a value. Returns (values, fields with some blanks)."""
    out, partial = {}, []
    for k, col in fields.items():
        vals = [num(DB[f][c][col]) for f, c in codes]
        got = [v for v in vals if v is not None]
        out[k] = sum(got) / len(got) if got else None
        if got and len(got) < len(vals):
            partial.append(k)
    return out, partial


def items_of(codes):
    return [dict(file=f, code=c, name=DB[f][c]['식품명']) for f, c in codes]


def build_usda_thigh():
    # USDA FDC 173627 (SR Legacy NDB 05096), fetched 2026-11-21. carbs/fiber/vitamin C are USDA "assumed zero".
    # Saturated fat (606) = 1.097 g, cholesterol (601) = 94 mg, vitamin D (328) = 0 μg, fetched 2026-11-21 from the FDC API.
    per = dict(kcal=121, protein=19.7, carbs=0, fiber=0, fat=4.12, satFat=1.097, sodium=95, cholesterol=94)
    micro = dict(potassium=242, calcium=7, iron=0.81, vitaminA=7, vitaminD=0)
    src = dict(items=[dict(file=USDA, code='FDC 173627 (SR Legacy NDB 05096)', name='Chicken, broilers or fryers, dark meat, thigh, meat only, raw')],
               method='국내 원자료에 껍질 제거 닭다리살 없음 → USDA SR Legacy 값(탄수·식이섬유·비타민C는 USDA 가정값 0, 비타민C는 비워둠, 포화지방 1.097g·콜레스테롤 94mg·비타민D 0은 USDA 값)')
    return per, micro, src, []


def build_multigrain():
    cooked, raw = DB[RAWF]['R101-013000500-0000'], DB[RAWF]['R101-008000501-0000']
    ratio = num(cooked['에너지(kcal)']) / num(raw['에너지(kcal)'])
    codes = R('R101-047002001-0000')
    per, _ = avg_fields(codes, MACRO)
    micro, _ = avg_fields(codes, MICRO)
    per = {k: v * ratio for k, v in per.items()}
    micro = {k: (v * ratio if v is not None else None) for k, v in micro.items()}
    src = dict(items=items_of(codes + R('R101-013000500-0000', 'R101-008000501-0000')),
               method=f'잡곡 생것 × 조리 비율 {ratio:.3f} (멥쌀밥_현미 {cooked["에너지(kcal)"]}kcal ÷ 멥쌀_현미_생것 {raw["에너지(kcal)"]}kcal)')
    return per, micro, src, ['추정']


def build_oat_rice():
    codes = R('R101-049000100-0000')
    per, _ = avg_fields(codes, MACRO)
    micro, _ = avg_fields(codes, MICRO)
    raw_codes = R('R101-001040101-0000', 'R101-001030101-0000')  # same cultivars (조양·대양) as 귀리밥_도정
    rf, _ = avg_fields(raw_codes, dict(fiber='식이섬유(g)', kcal='에너지(kcal)'))
    per['fiber'] = rf['fiber'] * per['kcal'] / rf['kcal']
    src = dict(items=items_of(codes + raw_codes),
               method=f"식이섬유 빈칸 → 귀리 생것(쌀귀리 조양·대양 평균, 귀리밥_도정과 같은 품종) 식이섬유 {rf['fiber']:.2f}g × (귀리밥 {per['kcal']:.0f}kcal ÷ 귀리 생것 {rf['kcal']:.0f}kcal)")
    return per, micro, src, ['추정']


def build(fid, spec):
    if spec.get('usda'):
        return build_usda_thigh()
    if spec.get('multigrain'):
        return build_multigrain()
    if spec.get('oatrice'):
        return build_oat_rice()

    flags, notes = list(spec.get('flags', [])), []
    codes = spec['codes']
    per, partial = avg_fields(codes, MACRO)
    micro, _ = avg_fields(codes, MICRO)
    extra_items = []
    # Micronutrient blanks: from other entries of the same food, else from USDA FoodData Central (flag 보충).
    usda_items = []
    for k, fill_codes in spec.get('micro_fill', {}).items():
        if micro[k] is None:
            micro[k] = avg_fields(fill_codes, {k: MICRO[k]})[0][k]
            extra_items += fill_codes
            flags.append('보충')
            notes.append(f'{k}는 같은 식품의 다른 항목({len(fill_codes)}개)에서 보충')
    for k, reason in spec.get('micro_zero', {}).items():
        if micro[k] is None:
            micro[k] = 0.0
            notes.append(f'{k}: {reason}')
    for k, (value, fdc, desc) in spec.get('micro_usda', {}).items():
        if micro[k] is None:
            micro[k] = value
            usda_items.append(dict(file=USDA, code=fdc, name=desc))
            flags.append('보충')
            notes.append(f'{k}는 원자료에 없어 USDA {fdc} 값 {value}으로 보충')
    for k, fill_codes in spec.get('fill', {}).items():
        if per[k] is None:
            per[k] = avg_fields(fill_codes, {k: MACRO[k]})[0][k]
            extra_items += fill_codes
            flags.append('보충')
            notes.append(f'{k}는 같은 식품의 다른 항목({len(fill_codes)}개)에서 보충')
    ratio_codes = spec.get('sat_ratio_from')
    if per['satFat'] is None and ratio_codes:
        r = avg_fields(ratio_codes, dict(fat=MACRO['fat'], satFat=MACRO['satFat']))[0]
        per['satFat'] = per['fat'] * r['satFat'] / r['fat']
        extra_items += ratio_codes
        flags.append('추정')
        notes.append(f"포화지방은 빈칸 → 같은 식품 다른 항목의 포화지방/지방 비율 {r['satFat'] / r['fat']:.3f} × 지방")
    for k in MACRO:
        if per[k] is None:
            if k in ('fiber', 'carbs') and spec.get('animal'):
                per[k] = 0.0
                notes.append(f'{k} 빈칸=0(동물성)')
            elif k == 'cholesterol' and not spec.get('animal'):
                per[k] = 0.0  # plants contain no cholesterol
            else:
                raise SystemExit(f'{fid}: blank {k} needs a fill entry')
    for k in partial:
        if k == 'fiber' and fid == 'tofu':
            flags.append('보충')
            notes.append('식이섬유는 5개 중 값이 있는 1개 제품(풀무원) 값')
        elif not (k == 'fiber' and spec.get('animal')):
            notes.append(f'{k}는 {len(codes)}개 중 값이 있는 항목만 평균')
    method = spec.get('method') or ('단일 항목' if len(codes) == 1 else f'{len(codes)}개 항목 평균')
    if notes:
        method += ' / ' + ', '.join(notes)
    items = items_of(list(dict.fromkeys(codes + extra_items))) + usda_items
    return per, micro, dict(items=items, method=method), flags


def format_json(data):
    # One food per block, nested objects on one line.
    lines = ['{', f'  "_note": {json.dumps(data["_note"], ensure_ascii=False)},', f'  "version": {json.dumps(data["version"])},', '  "foods": [']
    blocks = []
    for f in data['foods']:
        parts = [f'"{k}": {json.dumps(v, ensure_ascii=False)}' for k, v in f.items()]
        blocks.append('    {\n      ' + ',\n      '.join(parts) + '\n    }')
    lines.append(',\n'.join(blocks))
    lines += ['  ]', '}', '']
    return '\n'.join(lines)


def main():
    data = json.loads(FOODS_PATH.read_text(encoding='utf-8'))
    missing = [f['id'] for f in data['foods'] if f['id'] not in SPEC]
    if missing:
        raise SystemExit(f'no SPEC for: {missing}')
    out_foods = []
    for f in data['foods']:
        fid = f['id']
        per, micro, src, flags = build(fid, SPEC[fid])
        new_per = {k: rnd(k, per[k]) for k in MACRO}
        new_micro = {k: rnd(k, v) for k, v in micro.items() if v is not None}
        if f['per100g'] != new_per:
            changed = ' '.join(f'{k}:{f["per100g"].get(k)}→{new_per[k]}' for k in MACRO if f['per100g'].get(k) != new_per[k])
            print(f'{fid} ({f["name"]}): {changed}')
        nf = OrderedDict((key, f[key]) for key in ('id', 'name', 'category', 'group', 'basis'))
        nf['per100g'] = new_per
        nf['micro100g'] = new_micro
        if fid in NOTES:
            nf['note'] = NOTES[fid]
        if flags:
            src['flags'] = list(dict.fromkeys(flags))
        nf['source'] = src
        nf['portion'] = f['portion']
        if 'unit' in f:
            nf['unit'] = f['unit']
        nf['cookingHint'] = f['cookingHint']
        out_foods.append(nf)
    data['foods'] = out_foods
    if '--write' in sys.argv:
        FOODS_PATH.write_text(format_json(data), encoding='utf-8')
        print(f'wrote {FOODS_PATH}')


if __name__ == '__main__':
    main()
