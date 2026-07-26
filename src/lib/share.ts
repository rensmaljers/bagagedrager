// Dagverslag voor de groepsapp — genereert een WhatsApp-klaar bericht over de
// laatst voltooide etappe. Opener en feitjes worden per aanroep willekeurig
// gekozen uit pools die op live data leunen (spel-data + PCS-scrapes zoals
// gemiddelde snelheid en hoogtemeters), zodat het bericht elke dag anders is.
// WhatsApp-opmaak: *vet*, _cursief_ — geen HTML, dus ook geen escaping.
import { formatGap } from './utils';

export interface ShareData {
  stage: any; // stages-rij van de laatst voltooide etappe (incl. winner_name, distance_km, …)
  picks: any[]; // stage_picks_public-rijen van die etappe
  standings: any[]; // general_classification-rijen van de ronde
  scoringMode: string; // 'grand_tour' | 'classic'
  compName: string;
}

const pickRandom = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const shuffle = <T>(arr: T[]): T[] => [...arr].sort(() => Math.random() - 0.5);
const opsomming = (xs: string[]) =>
  xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} en ${xs[xs.length - 1]}`;

const OPENERS = [
  'De streep is getrokken, de rekening opgemaakt.',
  'Koers geweest — dit is de schade.',
  'Het peloton is binnen, de punten zijn geteld.',
  'De soigneurs wrijven, wij rekenen af.',
  'Weer een dag ouder, weer een klassement overhoop.',
  'De bidons zijn leeg, de stand is vers.',
  'Terwijl de bus naar het hotel rijdt: het dagverslag.',
];

export function buildDagbericht(d: ShareData): string {
  const { stage, picks, standings } = d;
  const isClassic = d.scoringMode === 'classic';
  const stageTitle = isClassic
    ? stage.name || `Koers ${stage.stage_number}`
    : stage.stage_number === 0
      ? `Proloog${stage.name ? ` · ${stage.name}` : ''}`
      : `Etappe ${stage.stage_number}${stage.name ? ` · ${stage.name}` : ''}`;

  const lines: string[] = [pickRandom(OPENERS), '', `🏁 *${stageTitle}*`];

  // --- Etappewinnaar + wie hem had ---
  const winnerPicks = picks.filter((p) => p.finish_position === 1 && !p.dnf);
  if (stage.winner_name) {
    const scorend = winnerPicks.filter((p) => !p.is_late && !p.is_random);
    const suffix = !winnerPicks.length
      ? ` — niemand had 'm 🙈`
      : scorend.length === 1
        ? ` — alleen ${scorend[0].display_name} had 'm 🕵️`
        : scorend.length > 1
          ? ` — ${scorend.length} spelers zagen het aankomen 🎯`
          : ` — alleen het Rad had 'm gegokt 🎡`;
    lines.push(`🏆 ${stage.winner_name} wint${suffix}`);
  }

  // --- Truien van de dag: beste speler per klassement op DEZE etappe ---
  // Punt-truien (groen/berg/spel): hoogste effective_* van de dag. Geel (AK):
  // kleinste tijdverlies van de dag — alleen tonen bij een kleine kopgroep,
  // anders is het op een sprintetappe de halve deelnemerslijst.
  const dagLijn = (emoji: string, label: string, valFn: (p: any) => number) => {
    const best = Math.max(0, ...picks.map(valFn));
    if (best <= 0) return null;
    const w = picks.filter((p) => valFn(p) === best);
    const via = w.length === 1 ? ` — ${w[0].rider_name}` : '';
    return `${emoji} ${label}: ${opsomming(w.map((p) => p.display_name))}${via} (${best} pt)`;
  };
  const truiLijnen: string[] = [];
  if (!isClassic && picks.length) {
    const dayGap = (p: any) => (p.dnf_penalty_gap ?? p.time_gap ?? 0) - (p.bonification ?? 0);
    const minGap = Math.min(...picks.map(dayGap));
    const geel = picks.filter((p) => dayGap(p) === minGap);
    if (geel.length <= 3) truiLijnen.push(`🟡 Beste tijd: ${opsomming(geel.map((p) => p.display_name))}${geel.length === 1 ? ` — ${geel[0].rider_name}` : ''}`);
  }
  const groen = dagLijn('🟢', 'Meeste punten', (p) => p.effective_points || 0);
  const berg = dagLijn('🔴', 'Meeste bergpunten', (p) => p.effective_mountain_points || 0);
  const spel = dagLijn('⚪', 'Meeste spelpunten', (p) => p.effective_game_points || 0);
  for (const l of [groen, berg, spel]) if (l) truiLijnen.push(l);
  if (truiLijnen.length) lines.push('', '*Truien van de dag*', ...truiLijnen);

  // --- Feitjes-pool: alleen kandidaten waarvoor de data er echt is ---
  const feitjes: string[] = [];

  const radVictims = picks.filter((p) => p.is_random);
  if (radVictims.length === 1) {
    feitjes.push(`🎡 Het Rad greep ${radVictims[0].display_name} en deelde ${radVictims[0].rider_name} uit`);
  } else if (radVictims.length > 1) {
    feitjes.push(`🎡 Het Rad draaide overuren: ${opsomming(radVictims.map((p) => p.display_name))}`);
  }

  const teLaat = picks.filter((p) => p.is_late && !p.is_random);
  if (teLaat.length) feitjes.push(`⏰ Te laat met kiezen: ${opsomming(teLaat.map((p) => p.display_name))} — nul punten`);

  const dnfs = picks.filter((p) => p.dnf);
  if (dnfs.length) {
    feitjes.push(`💥 ${opsomming([...new Set(dnfs.map((p) => `${p.rider_name} (${p.display_name})`))])} haalde de streep niet`);
  }

  const maxDeel = Math.max(0, ...picks.filter((p) => !p.is_late && !p.is_random).map((p) => p.num_pickers || 1));
  if (maxDeel >= 2) {
    const kudde = picks.find((p) => !p.is_late && !p.is_random && p.num_pickers === maxDeel);
    if (kudde) feitjes.push(`🤝 ${maxDeel} spelers kozen allemaal ${kudde.rider_name} — de deelfactor doet pijn`);
  }

  if (stage.distance_km && stage.vertical_meters) {
    feitjes.push(`📏 Het parcours vandaag: ${stage.distance_km} km met ${stage.vertical_meters} hoogtemeters`);
  }
  if (stage.avg_speed_winner) {
    feitjes.push(`⚡ De winnaar reed gemiddeld ${stage.avg_speed_winner}`);
  }

  // --- Klassement-spanning (AK, alleen grote ronde) ---
  const gc = isClassic ? [] : [...standings].sort((a, b) => a.total_time - b.total_time);
  if (gc.length >= 2) {
    const kopGap = gc[1].total_time - gc[0].total_time;
    const kopGapText = formatGap(kopGap).replace(/^\+/, '');
    if (kopGap > 0 && kopGap < 60) feitjes.push(`🔥 Nog maar ${kopGapText} tussen ${gc[0].display_name} en ${gc[1].display_name} in het AK`);
    else if (kopGap >= 600) feitjes.push(`🚀 ${gc[0].display_name} rijdt iedereen op ${kopGapText} — soeverein`);
  }

  for (const feit of shuffle(feitjes).slice(0, 2)) lines.push(feit);

  // --- Tussenstand: de vier klassementen bij naam ---
  const top3 = (arr: any[], val: (s: any) => string) => arr.slice(0, 3).map((s) => `${s.display_name} ${val(s)}`).join(' · ');
  lines.push('', `*Tussenstand — ${d.compName}*`);
  if (gc.length) {
    const top = gc.slice(0, 3).map((s, i) => (i === 0 ? s.display_name : `${s.display_name} ${formatGap(s.total_time - gc[0].total_time)}`));
    lines.push(`🟡 AK: ${top.join(' · ')}`);
  }
  if (!isClassic) {
    const pts = [...standings].sort((a, b) => (b.total_points || 0) - (a.total_points || 0));
    if (pts.length && (pts[0].total_points || 0) > 0) lines.push(`🟢 Punten: ${top3(pts, (s) => `${s.total_points || 0}`)}`);
    const mtn = [...standings].sort((a, b) => (b.total_mountain_points || 0) - (a.total_mountain_points || 0));
    if (mtn.length && (mtn[0].total_mountain_points || 0) > 0) lines.push(`🔴 Berg: ${top3(mtn, (s) => `${s.total_mountain_points || 0}`)}`);
  }
  const game = [...standings].sort((a, b) => (b.total_game_points || 0) - (a.total_game_points || 0));
  if (game.length) lines.push(`⚪ Spel: ${top3(game, (s) => `${s.total_game_points || 0}`)}`);

  lines.push('', 'https://bagagedrager.netlify.app');
  return lines.join('\n');
}

// --- Eindronde-verslag: samenvatting van de HELE ronde (truien, podium, superlatieven) ---
export interface RondeData {
  standings: any[]; // general_classification-rijen van de ronde
  allPicks: any[]; // stage_picks_public over alle etappes
  compName: string;
  scoringMode: string;
  stageCount: number; // aantal voltooide etappes
  pot?: {
    totalPot: number;
    rows: { label: string; winners: any[]; amountEach: number }[];
  } | null; // potVM uit Dashboard; null als er geen inleg is
}

const RONDE_OPENERS = [
  'De ronde zit erop — tijd voor de eindafrekening.',
  'De laatste renner is binnen. Dit was de ronde.',
  'Alles bij elkaar opgeteld: dit is er van de ronde geworden.',
  'De truien zijn vergeven. De eindbalans.',
  'Drie weken (of een campagne) later: wie ging ermee vandoor?',
];

export function buildRondeVerslag(d: RondeData): string {
  const { standings, allPicks } = d;
  const isClassic = d.scoringMode === 'classic';
  const lines: string[] = [pickRandom(RONDE_OPENERS), '', `🏆 *${d.compName} — eindverslag*`];

  const gc = [...standings].sort((a, b) => a.total_time - b.total_time);
  const game = [...standings].sort((a, b) => (b.total_game_points || 0) - (a.total_game_points || 0));
  const pts = [...standings].sort((a, b) => (b.total_points || 0) - (a.total_points || 0));
  const mtn = [...standings].sort((a, b) => (b.total_mountain_points || 0) - (a.total_mountain_points || 0));
  const cmb = [...standings].sort((a, b) => (b.total_combativity_points || 0) - (a.total_combativity_points || 0));

  // --- Eindwinnaars per trui ---
  lines.push('', '*De truien*');
  if (!isClassic && gc.length) {
    lines.push(`🟡 Geel — algemeen: *${gc[0].display_name}*`);
    if (pts.length && (pts[0].total_points || 0) > 0) lines.push(`🟢 Groen — punten: *${pts[0].display_name}* (${pts[0].total_points})`);
    if (mtn.length && (mtn[0].total_mountain_points || 0) > 0) lines.push(`🔴 Bolletjes — berg: *${mtn[0].display_name}* (${mtn[0].total_mountain_points})`);
  }
  if (game.length) lines.push(`⚪ Wit — spel: *${game[0].display_name}* (${game[0].total_game_points || 0})`);
  if (cmb.length && (cmb[0].total_combativity_points || 0) > 0) lines.push(`🥊 Strijdlust: *${cmb[0].display_name}* (${cmb[0].total_combativity_points}× etappewinnaar geraden)`);

  // --- Podium hoofdklassement (grote ronde: AK; klassieker: spel) ---
  const podium = isClassic ? game : gc;
  if (podium.length >= 2) {
    lines.push('', `*Podium ${isClassic ? 'spel' : 'algemeen'}*`);
    const medals = ['🥇', '🥈', '🥉'];
    podium.slice(0, 3).forEach((s, i) => {
      const detail = isClassic
        ? `${s.total_game_points || 0} pt`
        : (i === 0 ? 'leider' : formatGap(s.total_time - gc[0].total_time).replace(/^\+/, '') + ' achter');
      lines.push(`${medals[i]} ${s.display_name} — ${detail}`);
    });
  }

  // --- Rode lantaarn: hekkensluiter van het hoofdklassement. Alleen bij 4+
  // deelnemers, anders staat dezelfde speler ook al op het podium. ---
  if (podium.length >= 4) {
    const last = podium[podium.length - 1];
    const detail = isClassic
      ? `${last.total_game_points || 0} pt`
      : `${formatGap(last.total_time - gc[0].total_time).replace(/^\+/, '')} achter`;
    const quip = pickRandom([
      'chapeau voor het uitrijden',
      'iemand moet de bezemwagen gezelschap houden',
      'volgend jaar revanche',
      'de eer van de laatste plaats',
    ]);
    lines.push(`🏮 Rode lantaarn: ${last.display_name} — ${detail} (${quip})`);
  }

  // --- Prijzenpot: wie verdient wat ---
  if (d.pot && d.pot.totalPot > 0) {
    const potLijnen = d.pot.rows
      .filter((r) => r.winners.length && r.amountEach > 0)
      .map((r) => `💰 ${r.label}: ${opsomming(r.winners.map((w) => w.display_name))} — €${r.amountEach}${r.winners.length > 1 ? ' p.p.' : ''}`);
    if (potLijnen.length) lines.push('', `*De prijzenpot — €${d.pot.totalPot}*`, ...potLijnen);
  }

  // --- Superlatieven uit alle picks ---
  const feitjes: string[] = [];

  const scoringPicks = allPicks.filter((p) => !p.is_late && !p.is_random && !p.dnf);
  if (scoringPicks.length) {
    const best = scoringPicks.reduce((a, b) => ((b.effective_game_points || 0) > (a.effective_game_points || 0) ? b : a));
    if ((best.effective_game_points || 0) > 0)
      feitjes.push(`💥 Grootste dagklapper: ${best.display_name} met ${best.rider_name} (${best.effective_game_points} spelpunten in etappe ${best.stage_number})`);
  }

  const tally = (rows: any[], key: (p: any) => string) => {
    const m: Record<string, number> = {};
    for (const p of rows) { const k = key(p); m[k] = (m[k] || 0) + 1; }
    return Object.entries(m).sort((a, b) => b[1] - a[1])[0];
  };

  const radTop = tally(allPicks.filter((p) => p.is_random), (p) => p.display_name);
  if (radTop && radTop[1] >= 2) feitjes.push(`🎡 Vaakst aan het Rad overgeleverd: ${radTop[0]} (${radTop[1]}×)`);

  const lateTop = tally(allPicks.filter((p) => p.is_late), (p) => p.display_name);
  if (lateTop && lateTop[1] >= 2) feitjes.push(`⏰ Meeste te-late keuzes: ${lateTop[0]} (${lateTop[1]}×)`);

  const riderTop = tally(allPicks.filter((p) => !p.is_random), (p) => p.rider_name);
  if (riderTop && riderTop[1] >= 3) feitjes.push(`⭐ Populairste renner: ${riderTop[0]} (${riderTop[1]}× gekozen)`);

  if (feitjes.length) { lines.push('', '*Opvallend*'); for (const f of shuffle(feitjes)) lines.push(f); }

  lines.push('', `${d.stageCount} etappes · ${standings.length} deelnemers`, 'https://bagagedrager.netlify.app');
  return lines.join('\n');
}
