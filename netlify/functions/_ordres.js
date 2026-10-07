// Applique à la base l'ordre de choix de tous les matchs de la saison qui n'ont
// pas encore de choix (voir recalculerOrdres dans _participants.js).
import { recalculerOrdres, saisonEnCours } from './_participants.js'

export async function reorganiserOrdres(supabase, maintenant = new Date()) {
  const debut = saisonEnCours(maintenant).debutSaison.toISOString()
  const { data: matchs, error } = await supabase
    .from('matchs')
    .select('id, date_match, statut, ordre_choix')
    .gte('date_match', debut)
    .order('date_match', { ascending: true })
  if (error) throw error
  if (!matchs || matchs.length === 0) return []

  const { data: choix, error: erreurChoix } = await supabase
    .from('choix')
    .select('match_id')
    .in(
      'match_id',
      matchs.map((m) => m.id)
    )
  if (erreurChoix) throw erreurChoix
  const idsAvecChoix = new Set((choix || []).map((c) => String(c.match_id)))

  const changements = recalculerOrdres(matchs, idsAvecChoix, maintenant)
  for (const c of changements) {
    const { error: erreurMaj } = await supabase
      .from('matchs')
      .update({ ordre_choix: c.ordre })
      .eq('id', c.id)
    if (erreurMaj) throw erreurMaj
  }
  return changements
}
