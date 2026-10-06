<!--
  Spelregels — één bron voor de Account-pagina én de inschrijf-popup
  ("Ik doe mee"). Wijzig je de regels inhoudelijk, verhoog dan RULES_VERSION
  in src/lib/config.ts: die versie wordt per deelnemer vastgelegd bij akkoord.
-->
<p class="mb-2"><strong>Basis</strong></p>
<ul class="ps-3 mb-3">
  <li><strong>Inschrijven per ronde</strong> — met de knop "Ik doe mee", vóór de start van de eerste etappe. Daarna kun je niet meer instappen. Uitschrijven kan tot de start.</li>
  <li><strong>Kies 1 renner per etappe</strong> — voor de starttijd van die etappe.</li>
  <li><strong>Elke renner mag maar 1x</strong> gebruikt worden per ronde.</li>
  <li><strong>Te laat?</strong> Je keuze telt, maar je krijgt de straftijd (zie DNF) + 0 punten.</li>
  <li><strong>Geen keuze?</strong> Het Rad van Fortuin wijst je een willekeurige renner toe.</li>
  <li><strong>3 etappes op rij geen keuze = DNS.</strong> Krijg je drie keer achter elkaar een renner van het Rad, dan lig je definitief uit de koers voor die ronde: je staat onderaan elk klassement met "DNS", kunt niet meer kiezen en dingt niet meer mee naar de prijzen.</li>
  <li><strong>DNF, DNS of te laat?</strong> Als straftijd krijg je het <strong>slechtste tijdverschil van een door spelers gekozen renner die finishte</strong> — het Rad telt daarbij niet mee. Plus 0 punten in de andere klassementen.</li>
  <li><strong>Renner valt uit ná punten pakken?</strong> Alleen wie de etappe <strong>uitrijdt</strong> levert punten op. Pakt je renner bijvoorbeeld het bergpunt op de eerste klim maar valt hij daarna uit, dan vervallen die punten toch — je krijgt 0 punten (sprint, berg én spel) plus de straftijd.</li>
  <li><strong>Rit geannuleerd of gestaakt zonder uitslag?</strong> De rit telt in <strong>geen enkel klassement</strong> mee — geen punten, maar ook geen straftijd. Je pick blijft wél staan: de gekozen renner is <strong>verbruikt</strong> en kan niet opnieuw worden ingezet.</li>
</ul>
<p class="mb-2"><strong>Grote rondes</strong> <span class="badge bg-secondary" style="font-size:0.65rem;">Tour, Giro, Vuelta</span></p>
<ul class="ps-3 mb-3">
  <li>Je krijgt de <strong>werkelijke rijtijd</strong>, <strong>sprintpunten</strong> en <strong>bergpunten</strong> van je gekozen renner.</li>
  <li><strong>Bonificatie:</strong> 1e = −10s, 2e = −6s, 3e = −4s (wordt verrekend in totaaltijd).</li>
  <li><strong>🟡 Gele trui:</strong> laagste totaaltijd wint.</li>
  <li><strong>🟢 Groene trui:</strong> meeste sprintpunten.</li>
  <li><strong>🔴 Bolletjestrui:</strong> meeste bergpunten.</li>
</ul>
<p class="mb-2"><strong>Klassiekers</strong> <span class="badge bg-secondary" style="font-size:0.65rem;">Monumenten, etc.</span></p>
<ul class="ps-3 mb-2">
  <li>Punten op basis van <strong>finishpositie</strong>:</li>
</ul>
<table class="table table-sm mb-2" style="font-size:0.78rem; max-width:340px; margin-left:1rem;">
  <thead><tr><th>Positie</th><th>Punten</th><th>Positie</th><th>Punten</th></tr></thead>
  <tbody>
    <tr><td>1e</td><td>100</td><td>7e</td><td>35</td></tr>
    <tr><td>2e</td><td>80</td><td>8e</td><td>30</td></tr>
    <tr><td>3e</td><td>70</td><td>9e</td><td>25</td></tr>
    <tr><td>4e</td><td>60</td><td>10e</td><td>20</td></tr>
    <tr><td>5e</td><td>50</td><td>11e–13e</td><td>15</td></tr>
    <tr><td>6e</td><td>40</td><td>14e–15e</td><td>10</td></tr>
    <tr><td colspan="2"></td><td>16e–20e</td><td>5</td></tr>
  </tbody>
</table>
<ul class="ps-3 mb-2">
  <li><strong>Deelpenalty:</strong> als meerdere spelers dezelfde renner kiezen worden de punten verminderd:</li>
</ul>
<table class="table table-sm mb-3" style="font-size:0.78rem; max-width:280px; margin-left:1rem;">
  <thead><tr><th>Spelers</th><th>Je krijgt</th></tr></thead>
  <tbody>
    <tr><td>1 (uniek)</td><td>100%</td></tr>
    <tr><td>2</td><td>80%</td></tr>
    <tr><td>3</td><td>60%</td></tr>
    <tr><td>4</td><td>40%</td></tr>
    <tr><td>5+</td><td>20%</td></tr>
  </tbody>
</table>
<ul class="ps-3 mb-0">
  <li><strong>🎯 Spelklassement:</strong> hoogste totaal spelpunten wint.</li>
</ul>
