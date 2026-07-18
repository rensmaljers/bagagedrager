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

  // --- Dagwinnaar spelklassement ---
  const best = Math.max(0, ...picks.map((p) => p.effective_game_points || 0));
  if (best > 0) {
    const toppers = picks.filter((p) => (p.effective_game_points || 0) === best);
    lines.push(
      toppers.length === 1
        ? `⭐ Dagwinnaar: *${toppers[0].display_name}* — ${toppers[0].rider_name} (${best} pt)`
        : `⭐ Dagwinnaars: *${opsomming(toppers.map((p) => p.display_name))}* (elk ${best} pt)`
    );
  }

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

  // --- Tussenstand ---
  const game = [...standings].sort((a, b) => (b.total_game_points || 0) - (a.total_game_points || 0));
  lines.push('', `*Tussenstand — ${d.compName}*`);
  if (gc.length) {
    const top = gc.slice(0, 3).map((s, i) => (i === 0 ? s.display_name : `${s.display_name} ${formatGap(s.total_time - gc[0].total_time)}`));
    lines.push(`🟡 ${top.join(' · ')}`);
  }
  if (game.length) {
    lines.push(`⚪ ${game.slice(0, 3).map((s) => `${s.display_name} ${s.total_game_points || 0}`).join(' · ')}`);
  }

  lines.push('', 'bagagedrager.netlify.app');
  return lines.join('\n');
}
