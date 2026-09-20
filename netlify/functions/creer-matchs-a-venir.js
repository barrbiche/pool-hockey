import { createClient } from '@supabase/supabase-js'
import { ordreChoixPourMatch, matchTermine } from './_participants.js'

export const config = {
  schedule: '0 */6 * * *', // vérifie toutes les 6 heures
}

// La LNH marque ainsi un match qui n'aura pas lieu comme prévu :
// PPD = reporté à une date ultérieure, CNCL = annulé, SUSP = suspendu.
const ETATS_ANNULES = ['PPD', 'CNCL', 'SUSP']

// Cron indépendant de l'app : s'assure que tous les matchs à venir du CH
// (les 30 prochains jours) existent déjà dans notre base avec leur ordre
// de choix, sans dépendre du fait que quelqu'un ouvre le site ou non.
//
// Il fait aussi deux travaux d'entretien que rien d'autre ne fait :
//   1. Si la LNH déplace un match, la nouvelle heure est recopiée en base
//      (sinon le rappel de 2h et l'auto-assignement partent sur une heure
//      qui n'existe plus).
//   2. Si un match est reporté ou annulé, il est sorti du circuit, sinon
//      calculer-points interroge son boxscore aux 15 minutes pour le reste
//      de la saison, sans jamais le voir se terminer.
export async function handler() {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)

  try {
    const res = await fetch('https://api-web.nhle.com/v1/club-schedule-season/MTL/now')
    const data = await res.json()
    const maintenant = new Date()
    const dansTrenteJours = new Date(maintenant.getTime() + 30 * 24 * 60 * 60 * 1000)

    const tousLesMatchsNhl = data.games || []

    // Index de tout le calendrier par identifiant, pour pouvoir vérifier
    // l'état réel d'un match déjà en base, peu importe sa date.
    const parIdNhl = new Map(tousLesMatchsNhl.map((m) => [m.id, m]))

    // ───────── Entretien : matchs déjà en base ─────────
    const { data: matchsEnBase } = await supabase
      .from('matchs')
      .select('id, nhl_game_id, date_match, statut')
      .eq('statut', 'a_venir')

    const datesCorrigees = []
    const matchsReportes = []

    for (const ligne of matchsEnBase || []) {
      const matchNhl = parIdNhl.get(ligne.nhl_game_id)

      // Le match n'est plus au calendrier du tout : la LNH l'a retiré.
      if (!matchNhl) {
        // On ne le sort du circuit que si son heure est passée depuis un
        // bon moment. Avant ça, une absence est plus probablement un
        // hoquet de l'API qu'une vraie annulation.
        const passeDepuisLongtemps =
          new Date(ligne.date_match).getTime() < maintenant.getTime() - 24 * 60 * 60 * 1000
        if (passeDepuisLongtemps) {
          await supabase.from('matchs').update({ statut: 'reporte' }).eq('id', ligne.id)
          matchsReportes.push(ligne.nhl_game_id)
        }
        continue
      }

      // Reporté, annulé ou suspendu : on le sort du circuit. Son numéro
      // reste consommé — la rotation continue simplement au suivant.
      if (ETATS_ANNULES.includes(matchNhl.gameState)) {
        await supabase.from('matchs').update({ statut: 'reporte' }).eq('id', ligne.id)
        matchsReportes.push(ligne.nhl_game_id)
        continue
      }

      // Même match, nouvelle heure : on recopie la date et on réarme le
      // rappel de 2h, qui doit repartir sur la nouvelle heure.
      const dateNhl = new Date(matchNhl.startTimeUTC).toISOString()
      if (dateNhl !== new Date(ligne.date_match).toISOString()) {
        await supabase
          .from('matchs')
          .update({ date_match: dateNhl, rappel_envoye: null })
          .eq('id', ligne.id)
        datesCorrigees.push({ nhl_game_id: ligne.nhl_game_id, nouvelle_date: dateNhl })
      }
    }

    // ───────── Création des nouveaux matchs ─────────
    const matchsAVenir = tousLesMatchsNhl
      .filter((m) => {
        const dateMatch = new Date(m.startTimeUTC)
        return (
          !matchTermine(m.gameState) &&
          !ETATS_ANNULES.includes(m.gameState) &&
          (m.gameType === 2 || m.gameType === 3) &&
          dateMatch >= maintenant &&
          dateMatch <= dansTrenteJours
        )
      })
      .sort((a, b) => new Date(a.startTimeUTC) - new Date(b.startTimeUTC))

    // Numéro du dernier match déjà créé. On le lit dans la colonne
    // numero_match plutôt que de compter les lignes : un match effacé
    // (test, reprise, match reporté) ferait reculer le compte et
    // décalerait la rotation 3-2-1 pour tout le reste de la saison, en
    // silence. Un numéro écrit explicitement ne bouge jamais.
    const { data: dernier } = await supabase
      .from('matchs')
      .select('numero_match')
      .order('numero_match', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle()

    let compteur = dernier?.numero_match ?? 0

    // Filet pour la toute première exécution après l'ajout de la colonne :
    // si des matchs existent déjà sans numéro, on repart du compte total
    // pour ne pas réattribuer des numéros déjà utilisés.
    if (compteur === 0) {
      const { count: totalExistants } = await supabase
        .from('matchs')
        .select('*', { count: 'exact', head: true })
      compteur = totalExistants || 0
    }

    const matchsCrees = []

    for (const m of matchsAVenir) {
      const { data: existant } = await supabase
        .from('matchs')
        .select('id')
        .eq('nhl_game_id', m.id)
        .maybeSingle()

      if (existant) continue

      const adversaireEstDom = m.homeTeam.abbrev === 'MTL'
      const adversaire = adversaireEstDom ? m.awayTeam.abbrev : m.homeTeam.abbrev

      compteur += 1
      const ordre = ordreChoixPourMatch(compteur)

      await supabase.from('matchs').insert({
        nhl_game_id: m.id,
        date_match: m.startTimeUTC,
        adversaire,
        statut: 'a_venir',
        ordre_choix: ordre,
        numero_match: compteur,
      })

      matchsCrees.push(m.id)
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchsCrees, datesCorrigees, matchsReportes }),
    }
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) }
  }
}
