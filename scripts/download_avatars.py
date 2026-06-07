# Download 127 Dota 2 hero avatars from cdn.dota2.com to assets/avatars/
# Builds local-path avatarUrl in heroes_knowledge.json
import json, urllib.request, ssl, time, os, sys

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE
HDRS = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'}

SLUG_MAP = {
    'npc_dota_hero_abaddon': ('abaddon', '_full'),
    'npc_dota_hero_alchemist': ('alchemist', '_full'),
    'npc_dota_hero_ancient_apparition': ('ancient_apparition', '_full'),
    'npc_dota_hero_antimage': ('antimage', '_full'),
    'npc_dota_hero_arc_warden': ('arc_warden', '_full'),
    'npc_dota_hero_axe': ('axe', '_full'),
    'npc_dota_hero_bane': ('bane', '_full'),
    'npc_dota_hero_batrider': ('batrider', '_full'),
    'npc_dota_hero_beastmaster': ('beastmaster', '_full'),
    'npc_dota_hero_bloodseeker': ('bloodseeker', '_full'),
    'npc_dota_hero_brewmaster': ('brewmaster', '_full'),
    'npc_dota_hero_bristleback': ('bristleback', '_full'),
    'npc_dota_hero_broodmother': ('broodmother', '_full'),
    'npc_dota_hero_chaos_knight': ('chaos_knight', '_full'),
    'npc_dota_hero_chen': ('chen', '_full'),
    'npc_dota_hero_clinkz': ('clinkz', '_full'),
    'npc_dota_hero_clockwerk': ('rattletrap', '_full'),
    'npc_dota_hero_crystal_maiden': ('crystal_maiden', '_full'),
    'npc_dota_hero_dark_seer': ('dark_seer', '_full'),
    'npc_dota_hero_dark_willow': ('dark_willow', '_full'),
    'npc_dota_hero_dawnbreaker': ('dawnbreaker', '_lg'),
    'npc_dota_hero_dazzle': ('dazzle', '_full'),
    'npc_dota_hero_death_prophet': ('death_prophet', '_full'),
    'npc_dota_hero_disruptor': ('disruptor', '_full'),
    'npc_dota_hero_doom_bringer': ('doom_bringer', '_full'),
    'npc_dota_hero_dragon_knight': ('dragon_knight', '_full'),
    'npc_dota_hero_drow_ranger': ('drow_ranger', '_full'),
    'npc_dota_hero_earth_spirit': ('earth_spirit', '_full'),
    'npc_dota_hero_earthshaker': ('earthshaker', '_full'),
    'npc_dota_hero_elder_titan': ('elder_titan', '_full'),
    'npc_dota_hero_ember_spirit': ('ember_spirit', '_full'),
    'npc_dota_hero_enchantress': ('enchantress', '_full'),
    'npc_dota_hero_enigma': ('enigma', '_full'),
    'npc_dota_hero_faceless_void': ('faceless_void', '_full'),
    'npc_dota_hero_furion': ('furion', '_full'),
    'npc_dota_hero_grimstroke': ('grimstroke', '_full'),
    'npc_dota_hero_gyrocopter': ('gyrocopter', '_full'),
    'npc_dota_hero_hoodwink': ('hoodwink', '_full'),
    'npc_dota_hero_huskar': ('huskar', '_full'),
    'npc_dota_hero_invoker': ('invoker', '_full'),
    'npc_dota_hero_jakiro': ('jakiro', '_full'),
    'npc_dota_hero_juggernaut': ('juggernaut', '_full'),
    'npc_dota_hero_keeper_of_the_light': ('keeper_of_the_light', '_full'),
    'npc_dota_hero_kez': ('kez', '_full'),
    'npc_dota_hero_kunkka': ('kunkka', '_full'),
    'npc_dota_hero_legion_commander': ('legion_commander', '_full'),
    'npc_dota_hero_leshrac': ('leshrac', '_full'),
    'npc_dota_hero_lich': ('lich', '_full'),
    'npc_dota_hero_lifestealer': ('life_stealer', '_full'),
    'npc_dota_hero_lina': ('lina', '_full'),
    'npc_dota_hero_lion': ('lion', '_full'),
    'npc_dota_hero_lone_druid': ('lone_druid', '_full'),
    'npc_dota_hero_luna': ('luna', '_full'),
    'npc_dota_hero_lycan': ('lycan', '_full'),
    'npc_dota_hero_magnataur': ('magnataur', '_full'),
    'npc_dota_hero_marci': ('marci', '_full'),
    'npc_dota_hero_mars': ('mars', '_full'),
    'npc_dota_hero_medusa': ('medusa', '_full'),
    'npc_dota_hero_meepo': ('meepo', '_full'),
    'npc_dota_hero_mirana': ('mirana', '_full'),
    'npc_dota_hero_monkey_king': ('monkey_king', '_full'),
    'npc_dota_hero_morphling': ('morphling', '_full'),
    'npc_dota_hero_muerta': ('muerta', '_full'),
    'npc_dota_hero_naga_siren': ('naga_siren', '_full'),
    'npc_dota_hero_necrolyte': ('necrolyte', '_lg'),
    'npc_dota_hero_nevermore': ('nevermore', '_full'),
    'npc_dota_hero_night_stalker': ('night_stalker', '_full'),
    'npc_dota_hero_nyx_assassin': ('nyx_assassin', '_full'),
    'npc_dota_hero_obsidian_destroyer': ('obsidian_destroyer', '_full'),
    'npc_dota_hero_ogre_magi': ('ogre_magi', '_full'),
    'npc_dota_hero_omniknight': ('omniknight', '_full'),
    'npc_dota_hero_oracle': ('oracle', '_full'),
    'npc_dota_hero_pangolier': ('pangolier', '_full'),
    'npc_dota_hero_phantom_assassin': ('phantom_assassin', '_full'),
    'npc_dota_hero_phantom_lancer': ('phantom_lancer', '_full'),
    'npc_dota_hero_phoenix': ('phoenix', '_full'),
    'npc_dota_hero_primal_beast': ('primal_beast', '_full'),
    'npc_dota_hero_puck': ('puck', '_full'),
    'npc_dota_hero_pudge': ('pudge', '_full'),
    'npc_dota_hero_pugna': ('pugna', '_full'),
    'npc_dota_hero_queenofpain': ('queenofpain', '_full'),
    'npc_dota_hero_razor': ('razor', '_full'),
    'npc_dota_hero_riki': ('riki', '_full'),
    'npc_dota_hero_ringmaster': ('ringmaster', '_full'),
    'npc_dota_hero_rubick': ('rubick', '_full'),
    'npc_dota_hero_sand_king': ('sand_king', '_full'),
    'npc_dota_hero_shadow_demon': ('shadow_demon', '_full'),
    'npc_dota_hero_shadow_shaman': ('shadow_shaman', '_full'),
    'npc_dota_hero_silencer': ('silencer', '_full'),
    'npc_dota_hero_skeleton_king': ('skeleton_king', '_full'),
    'npc_dota_hero_skywrath_mage': ('skywrath_mage', '_full'),
    'npc_dota_hero_slardar': ('slardar', '_full'),
    'npc_dota_hero_slark': ('slark', '_full'),
    'npc_dota_hero_sniper': ('sniper', '_full'),
    'npc_dota_hero_spectre': ('spectre', '_full'),
    'npc_dota_hero_spirit_breaker': ('spirit_breaker', '_full'),
    'npc_dota_hero_storm_spirit': ('storm_spirit', '_full'),
    'npc_dota_hero_sven': ('sven', '_full'),
    'npc_dota_hero_techies': ('techies', '_full'),
    'npc_dota_hero_templar_assassin': ('templar_assassin', '_full'),
    'npc_dota_hero_terrorblade': ('terrorblade', '_full'),
    'npc_dota_hero_tidehunter': ('tidehunter', '_full'),
    'npc_dota_hero_timbersaw': ('shredder', '_full'),
    'npc_dota_hero_tiny': ('tiny', '_full'),
    'npc_dota_hero_treant': ('treant', '_full'),
    'npc_dota_hero_troll_warlord': ('troll_warlord', '_full'),
    'npc_dota_hero_tusk': ('tusk', '_full'),
    'npc_dota_hero_undying': ('undying', '_full'),
    'npc_dota_hero_ursa': ('ursa', '_lg'),
    'npc_dota_hero_vengefulspirit': ('vengefulspirit', '_full'),
    'npc_dota_hero_venomancer': ('venomancer', '_full'),
    'npc_dota_hero_viper': ('viper', '_full'),
    'npc_dota_hero_visage': ('visage', '_full'),
    'npc_dota_hero_void_spirit': ('void_spirit', '_full'),
    'npc_dota_hero_warlock': ('warlock', '_full'),
    'npc_dota_hero_weaver': ('weaver', '_full'),
    'npc_dota_hero_windranger': ('windrunner', '_full'),
    'npc_dota_hero_winter_wyvern': ('winter_wyvern', '_full'),
    'npc_dota_hero_witch_doctor': ('witch_doctor', '_full'),
    'npc_dota_hero_wisp': ('wisp', '_full'),
    'npc_dota_hero_zuus': ('zuus', '_full'),
    'npc_dota_hero_snapfire': ('snapfire', '_full'),
    'npc_dota_hero_abyssal_underlord': ('abyssal_underlord', '_full'),
    'npc_dota_hero_underlord': ('abyssal_underlord', '_full'),
    'npc_dota_hero_largo': ('largo', '_full'),
    'npc_dota_hero_queen_of_pain': ('queenofpain', '_full'),
    'npc_dota_hero_shadow_fiend': ('nevermore', '_full'),
    'npc_dota_hero_natures_prophet': ('furion', '_full'),
    'npc_dota_hero_wraith_king': ('skeleton_king', '_full'),
    'npc_dota_hero_centaur': ('centaur', '_full'),
    'npc_dota_hero_bounty_hunter': ('bounty_hunter', '_full'),
    'npc_dota_hero_life_stealer': ('life_stealer', '_full'),
    'npc_dota_hero_tinker': ('tinker', '_full'),
}
with open('heroes_knowledge.json') as f:
    d = json.load(f)
heroes = d['heroes']

unique = {}
for h in heroes:
    hid = h['id']
    if hid in SLUG_MAP:
        slug, size = SLUG_MAP[hid]
    else:
        slug = hid.replace('npc_dota_hero_', '')
        size = '_full'
        print(f'FALLBACK for unknown id: {hid} -> {slug}{size}')
    unique.setdefault((slug, size), True)

os.makedirs('assets/avatars', exist_ok=True)
print(f'Downloading {len(unique)} unique avatars...')

ok = 0
fail = []
for (slug, size) in unique:
    rel = f'assets/avatars/{slug}{size}.png'
    if os.path.exists(rel) and os.path.getsize(rel) > 200:
        ok += 1
        continue
    url = f'https://cdn.dota2.com/apps/dota2/images/heroes/{slug}{size}.png'
    try:
        req = urllib.request.Request(url, headers=HDRS)
        with urllib.request.urlopen(req, timeout=12, context=ctx) as r:
            data = r.read()
        if len(data) > 200:
            with open(rel, 'wb') as f:
                f.write(data)
            ok += 1
        else:
            fail.append((slug, size, f'too small: {len(data)}b'))
    except Exception as e:
        fail.append((slug, size, str(e)[:50]))
    time.sleep(0.08)

print(f'Downloaded: {ok}/{len(unique)}')
for f in fail:
    print('  FAIL', f)

rewrite = 0
missing = []
for h in heroes:
    hid = h['id']
    if hid in SLUG_MAP:
        slug, size = SLUG_MAP[hid]
    else:
        slug = hid.replace('npc_dota_hero_', '')
        size = '_full'
    rel = f'assets/avatars/{slug}{size}.png'
    if os.path.exists(rel):
        h['avatarUrl'] = rel
        rewrite += 1
    else:
        missing.append(hid)

with open('heroes_knowledge.json', 'w') as f:
    json.dump(d, f, ensure_ascii=False, indent=2)

print(f'Rewrote avatarUrl for {rewrite}/{len(heroes)} heroes')
if missing:
    print(f'Missing local files: {missing}')
