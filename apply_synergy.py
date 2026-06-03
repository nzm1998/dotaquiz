import csv, sys

PATH = 'synergy_matrix.csv'
NAME_MAP = {'美杜沙':'美杜莎','斯拉尔克':'斯拉克','斯拉克斯':'斯拉克','斯拉客':'斯拉克','斯拉克制':'斯拉克','冰魂':'远古冰魄','蝙蝠':'蝙蝠骑士','船长':'昆卡','月骑':'露娜','冰女':'水晶室女','小娜迦':'娜迦海妖','毒龙':'冥界亚龙','白虎':'米拉娜','兔子':'黑暗贤者','食人魔法师':'食人魔魔法师'}
HERO = sys.argv[1]

with open(PATH) as f:
    rows = list(csv.reader(f))
header = rows[0]
h2i = {h:i for i,h in enumerate(header) if h}
t = h2i[HERO]

vals = {}
for line in sys.stdin.read().strip().split('\n'):
    parts = line.split(None, 2)
    if len(parts) < 3: continue
    h = parts[1].strip('.').strip()
    h = NAME_MAP.get(h, h)
    i = h2i.get(h)
    if i and i < t:
        v = float(parts[2])
        vals[i] = f'{v:.1f}' if abs(v - int(v)) > 0.001 else str(int(v))

rows[t] = [HERO] + [vals.get(i, '') for i in range(1, t)]
with open(PATH, 'w', newline='') as f:
    csv.writer(f).writerows(rows)

filled = sum(1 for i in range(1, t) if vals.get(i))
print(f'{HERO}: {filled}/{t-1} filled')
