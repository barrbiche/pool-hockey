// Lit un quiz écrit en texte (le format d'Eric) pour remplir le formulaire Admin :
//
//   Question : Qui a marqué le but gagnant ...?
//   A) Paul DiPietro
//   B) Vincent Damphousse
//   C) Kirk Muller
//   Réponse : C) Kirk Muller
//   Il a marqué le but décisif ...            <- l'explication (plusieurs lignes possibles)
//   Pourquoi c'est un piège : Paul DiPietro ...   <- facultatif
//
// Tolérant : gras/italique de markdown, puces, lignes de points « . . . », retours de ligne
// Windows, « Réponse : C » (lettre seule) ou « Réponse : Kirk Muller » (texte seul).
// Retourne { question, choix: [...], bonne (index), explication, piege } ou { erreur }.
// Les limites sont les mêmes que celles du serveur (netlify/functions/quiz.js).
export const LIMITES = { question: 300, choix: 120, explication: 800, piege: 800 }
const NB_CHOIX_MAX = 6

const SEPARATEUR = /^[\s.…_*\-–—=~]*$/
const RE_QUESTION = /^(?:question|q)\s*[:：]\s*(.*)$/i
const RE_CHOIX = /^\(?([A-Fa-f])\s*[).:\-–]\s*(.+)$/
const RE_REPONSE = /^(?:bonne\s+r[ée]ponse|r[ée]ponse|answer)\s*[:：]\s*(.*)$/i
const RE_EXPLICATION = /^explication\s*[:：]\s*(.*)$/i
const RE_PIEGE_LONG = /^pourquoi\s+c['’]est\s+un\s+pi[èe]ge\s*[:：?]?\s*(.*)$/i
const RE_PIEGE_COURT = /^(?:le\s+)?pi[èe]ge\s*[:：]\s*(.*)$/i
const RE_LETTRE_REPONSE = /^\(?([A-Fa-f])\s*(?:[).:\-–]|$)\s*(.*)$/

function nettoyer(ligne) {
  return ligne
    .replace(/ /g, ' ')
    .replace(/[*_`]+/g, '') // gras, italique, code (markdown)
    .replace(/^\s*(?:#+|[-•>])\s+/, '') // titre, puce, citation
    .trim()
}

function normaliser(texte) {
  return String(texte)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

const paragraphes = (lignes) => lignes.join('\n').replace(/\n{3,}/g, '\n\n').trim()

export function lireQuizColle(texte) {
  const lignes = String(texte || '').replace(/\r\n?/g, '\n').split('\n').map(nettoyer)

  let etape = 'question' // question -> choix -> explication -> piege
  const question = []
  const choix = [] // { lettre, texte }
  const explication = []
  const piege = []
  let reponseVue = false
  let lettreReponse = null
  let texteReponse = ''

  for (const ligne of lignes) {
    if (SEPARATEUR.test(ligne)) {
      // ligne vide ou « . . . » : sert juste de saut de ligne dans l'explication / le piège
      if (etape === 'explication') explication.push('')
      else if (etape === 'piege') piege.push('')
      continue
    }

    let m = ligne.match(RE_REPONSE)
    if (m && etape !== 'piege') {
      reponseVue = true
      etape = 'explication'
      const lettre = m[1].match(RE_LETTRE_REPONSE)
      if (lettre) {
        lettreReponse = lettre[1].toUpperCase()
        texteReponse = lettre[2].trim()
      } else {
        texteReponse = m[1].trim()
      }
      continue
    }

    if (reponseVue) {
      m = ligne.match(RE_PIEGE_LONG) || ligne.match(RE_PIEGE_COURT)
      if (m) {
        etape = 'piege'
        if (m[1].trim()) piege.push(m[1].trim())
        continue
      }
    }

    if (etape === 'explication') {
      m = ligne.match(RE_EXPLICATION)
      if (!m) explication.push(ligne)
      else if (m[1].trim()) explication.push(m[1].trim()) // « Explication : texte »
    } else if (etape === 'piege') {
      piege.push(ligne)
    } else if (etape === 'choix') {
      m = ligne.match(RE_CHOIX)
      if (m) choix.push({ lettre: m[1].toUpperCase(), texte: m[2].trim() })
      else if (choix.length > 0) choix[choix.length - 1].texte += ` ${ligne}` // choix écrit sur 2 lignes
    } else {
      m = ligne.match(RE_QUESTION)
      if (m) {
        if (m[1].trim()) question.push(m[1].trim())
        continue
      }
      m = ligne.match(RE_CHOIX)
      if (m && question.length > 0) {
        etape = 'choix'
        choix.push({ lettre: m[1].toUpperCase(), texte: m[2].trim() })
      } else {
        question.push(ligne)
      }
    }
  }

  const q = question.join(' ').trim()
  if (!q) return { erreur: 'Je ne trouve pas la question (écris « Question : … » en premier).' }
  if (choix.length < 2) return { erreur: 'Je trouve moins de 2 choix (écris-les comme « A) … », un par ligne).' }
  if (choix.length > NB_CHOIX_MAX) return { erreur: `Il y a plus de ${NB_CHOIX_MAX} choix (maximum ${NB_CHOIX_MAX}).` }
  if (!reponseVue) return { erreur: 'Je ne trouve pas la ligne « Réponse : C) … » (la bonne réponse).' }

  let bonne = -1
  if (lettreReponse) {
    bonne = choix.findIndex((c) => c.lettre === lettreReponse)
    if (bonne === -1) {
      const position = lettreReponse.charCodeAt(0) - 65
      if (position < choix.length) bonne = position
    }
  }
  if (bonne === -1 && texteReponse) {
    bonne = choix.findIndex((c) => normaliser(c.texte) === normaliser(texteReponse))
  }
  if (bonne === -1) {
    return { erreur: 'Je ne comprends pas quelle est la bonne réponse : écris « Réponse : » suivi de la lettre d’un des choix.' }
  }

  const resultat = {
    question: q,
    choix: choix.map((c) => c.texte),
    bonne,
    explication: paragraphes(explication),
    piege: paragraphes(piege),
  }

  // Trop long pour le serveur : on le dit tout de suite plutôt qu'à la publication
  if (resultat.question.length > LIMITES.question) {
    return { erreur: `La question est trop longue (${resultat.question.length} caractères, ${LIMITES.question} max).` }
  }
  const trop = resultat.choix.findIndex((c) => c.length > LIMITES.choix)
  if (trop !== -1) {
    return { erreur: `Le choix ${String.fromCharCode(65 + trop)} est trop long (${LIMITES.choix} caractères max).` }
  }
  if (resultat.explication.length > LIMITES.explication) {
    return { erreur: `L’explication est trop longue (${resultat.explication.length} caractères, ${LIMITES.explication} max).` }
  }
  if (resultat.piege.length > LIMITES.piege) {
    return { erreur: `Le texte du piège est trop long (${resultat.piege.length} caractères, ${LIMITES.piege} max).` }
  }
  const minuscules = resultat.choix.map((c) => c.toLowerCase())
  if (new Set(minuscules).size !== minuscules.length) return { erreur: 'Deux choix sont identiques.' }
  return resultat
}
