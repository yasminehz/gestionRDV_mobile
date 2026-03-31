import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DateTimePicker from '@react-native-community/datetimepicker';

const URL_API_BASE = 'http://127.0.0.1:8000/api';
const CLE_STOCKAGE_UTILISATEUR = '@gestionRDV_user';
const URL_RACINE_BACKEND = URL_API_BASE.replace(/\/api\/?$/, '');

// Accepte roles sous forme tableau, JSON texte ou chaine simple.
const normaliserRoles = (rolesBruts) => {
  if (Array.isArray(rolesBruts)) {
    return rolesBruts;
  }

  if (typeof rolesBruts === 'string') {
    try {
      const rolesParses = JSON.parse(rolesBruts);
      if (Array.isArray(rolesParses)) {
        return rolesParses;
      }
    } catch (erreur) {
      return [rolesBruts];
    }

    return [rolesBruts];
  }

  return [];
};

// Decode le payload du JWT (partie centrale).
const lirePayloadJwt = (jeton) => {
  if (!jeton || typeof jeton !== 'string') {
    return {};
  }

  try {
    const partiePayload = jeton.split('.')[1];

    if (!partiePayload) {
      return {};
    }

    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
    const base64 = partiePayload.replace(/-/g, '+').replace(/_/g, '/');
    const base64Complete = `${base64}${'='.repeat((4 - (base64.length % 4 || 4)) % 4)}`;

    let index = 0;
    let texteDecode = '';

    while (index < base64Complete.length) {
      const a = alphabet.indexOf(base64Complete.charAt(index++));
      const b = alphabet.indexOf(base64Complete.charAt(index++));
      const c = alphabet.indexOf(base64Complete.charAt(index++));
      const d = alphabet.indexOf(base64Complete.charAt(index++));

      const octet1 = (a << 2) | (b >> 4);
      const octet2 = ((b & 15) << 4) | (c >> 2);
      const octet3 = ((c & 3) << 6) | d;

      texteDecode += String.fromCharCode(octet1);

      if (c !== 64) {
        texteDecode += String.fromCharCode(octet2);
      }

      if (d !== 64) {
        texteDecode += String.fromCharCode(octet3);
      }
    }

    return JSON.parse(texteDecode);
  } catch (erreur) {
    return {};
  }
};

const normaliserUtilisateur = (donnees, emailDeSecours) => {
  const jeton = donnees?.token || donnees?.jwt || donnees?.access_token || donnees?.data?.token || donnees?.data?.jwt || null;
  const payloadJwt = lirePayloadJwt(jeton);
  const contenu = donnees?.user || donnees?.data?.user || donnees?.data || {};
  const roles = normaliserRoles(contenu?.roles || payloadJwt?.roles);

  return {
    id: contenu?.id ?? payloadJwt?.id ?? null,
    nom: contenu?.nom || contenu?.last_name || payloadJwt?.nom || '',
    prenom: contenu?.prenom || contenu?.first_name || payloadJwt?.prenom || '',
    email: contenu?.email || payloadJwt?.username || payloadJwt?.email || emailDeSecours,
    type: String(contenu?.type || payloadJwt?.type || '').toLowerCase() || 'non defini',
    roles,
    jeton,
  };
};

// Regle metier: acces reserve aux comptes ROLE_PATIENT.
const estUtilisateurPatient = (utilisateur) => {
  const roles = normaliserRoles(utilisateur?.roles).map((role) => String(role).toUpperCase());

  return roles.includes('ROLE_PATIENT');
};

const extraireCollection = (donnees) => {
  if (Array.isArray(donnees?.['hydra:member'])) {
    return donnees['hydra:member'];
  }

  if (Array.isArray(donnees?.member)) {
    return donnees.member;
  }

  if (Array.isArray(donnees)) {
    return donnees;
  }

  return [];
};

const extraireListeCreneauxBruts = (donnees) => {
  if (Array.isArray(donnees?.slots)) {
    return donnees.slots;
  }

  if (Array.isArray(donnees?.availableSlots)) {
    return donnees.availableSlots;
  }

  return extraireCollection(donnees);
};

const formatNomMedecin = (medecin) => {
  const nom = medecin?.nom || '';
  const prenom = medecin?.prenom || '';
  const nomComplet = `${prenom} ${nom}`.trim();
  return nomComplet || 'Medecin';
};

const parserIsoDate = (valeur, dateParDefautIso = obtenirDateDuJourIso()) => {
  if (!valeur) {
    return null;
  }

  const texte = String(valeur).trim();

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(texte)) {
    return texte;
  }

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(texte)) {
    return `${texte}:00`;
  }

  if (/^\d{2}:\d{2}$/.test(texte)) {
    return `${dateParDefautIso}T${texte}:00`;
  }

  return null;
};

const calculerFinCreneau = (debutIso) => {
  const dateDebut = new Date(debutIso);

  if (Number.isNaN(dateDebut.getTime())) {
    return debutIso;
  }

  const dateFin = new Date(dateDebut.getTime() + 60 * 60 * 1000);
  return dateFin.toISOString().slice(0, 19);
};

const formaterCreneauAffiche = (debutIso) => {
  const date = new Date(debutIso);

  if (Number.isNaN(date.getTime())) {
    return debutIso;
  }

  const jour = String(date.getDate()).padStart(2, '0');
  const mois = String(date.getMonth() + 1).padStart(2, '0');
  const annee = date.getFullYear();
  const heure = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');

  return `${jour}/${mois}/${annee} - ${heure}:${minute}`;
};

const obtenirDateDuJourIso = () => {
  const dateDuJour = new Date();
  const annee = dateDuJour.getFullYear();
  const mois = String(dateDuJour.getMonth() + 1).padStart(2, '0');
  const jour = String(dateDuJour.getDate()).padStart(2, '0');
  return `${annee}-${mois}-${jour}`;
};

const obtenirDateIsoDepuisObjet = (dateObjet) => {
  const annee = dateObjet.getFullYear();
  const mois = String(dateObjet.getMonth() + 1).padStart(2, '0');
  const jour = String(dateObjet.getDate()).padStart(2, '0');
  return `${annee}-${mois}-${jour}`;
};

const formaterDateAffichee = (dateObjet) => {
  const jour = String(dateObjet.getDate()).padStart(2, '0');
  const mois = String(dateObjet.getMonth() + 1).padStart(2, '0');
  const annee = dateObjet.getFullYear();
  return `${jour}/${mois}/${annee}`;
};

const extraireIdDepuisIri = (valeur) => {
  if (typeof valeur !== 'string') {
    return null;
  }

  const correspondance = valeur.match(/\/(\d+)$/);
  return correspondance ? correspondance[1] : null;
};

const formaterDateHeure = (valeur) => {
  if (!valeur) {
    return '-';
  }

  const date = new Date(valeur);

  if (Number.isNaN(date.getTime())) {
    return String(valeur);
  }

  const jour = String(date.getDate()).padStart(2, '0');
  const mois = String(date.getMonth() + 1).padStart(2, '0');
  const annee = date.getFullYear();
  const heure = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');

  return `${jour}/${mois}/${annee} ${heure}:${minute}`;
};

const normaliserTexte = (valeur) =>
  String(valeur || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

const NOMS_MEDECINS_EXCLUS = ['test test', 'shane hollander'];

const estNomMedecinExclu = (nomMedecin) => {
  const nomNormalise = normaliserTexte(nomMedecin).replace(/\s+/g, ' ').trim();
  return NOMS_MEDECINS_EXCLUS.some((nomExclu) => nomNormalise === normaliserTexte(nomExclu));
};

const estMedecinExclu = (medecin) => estNomMedecinExclu(formatNomMedecin(medecin));

const obtenirLibelleMedecin = (medecinValeur, medecinsParIri = {}) => {
  if (typeof medecinValeur === 'string' && medecinsParIri[medecinValeur]) {
    return medecinsParIri[medecinValeur];
  }

  if (medecinValeur && typeof medecinValeur === 'object') {
    const nomComplet = `${medecinValeur?.prenom || ''} ${medecinValeur?.nom || ''}`.trim();
    if (nomComplet) {
      return nomComplet;
    }
  }

  const idIri = extraireIdDepuisIri(medecinValeur);
  if (idIri) {
    return `Medecin #${idIri}`;
  }

  return 'Medecin';
};

const obtenirLibelleEtat = (etatValeur, etatsParIri = {}) => {
  if (typeof etatValeur === 'string' && etatsParIri[etatValeur]) {
    return etatsParIri[etatValeur];
  }

  if (etatValeur && typeof etatValeur === 'object' && etatValeur?.libelle) {
    return etatValeur.libelle;
  }

  const idIri = extraireIdDepuisIri(etatValeur);
  if (idIri) {
    return `Etat #${idIri}`;
  }

  return 'Non defini';
};

const obtenirCommentaireRdv = (rdv) => {
  const champsPossibles = [
    rdv?.commentaire,
    rdv?.commentaires,
    rdv?.instructions,
    rdv?.note,
    rdv?.notes,
    rdv?.motif,
  ];

  const valeur = champsPossibles.find((champ) => typeof champ === 'string' && champ.trim().length > 0);
  return valeur ? valeur.trim() : '';
};

const obtenirPrioriteEtat = (etatLibelle) => {
  const etatNormalise = normaliserTexte(etatLibelle);

  if (etatNormalise.includes('demande') || etatNormalise.includes('attente')) {
    return 1;
  }

  if (etatNormalise.includes('confirme')) {
    return 2;
  }

  if (etatNormalise.includes('realise')) {
    return 3;
  }

  if (etatNormalise.includes('annule')) {
    return 4;
  }

  if (etatNormalise.includes('refuse')) {
    return 5;
  }

  return 99;
};

const estRdvAnnulable = (rdv) => {
  const etatNormalise = normaliserTexte(rdv?.etatLibelle || '');

  if (!rdv?.id) {
    return false;
  }

  return !etatNormalise.includes('annule') && !etatNormalise.includes('refuse') && !etatNormalise.includes('realise');
};

const estRdvAnnule = (rdv) => normaliserTexte(rdv?.etatLibelle || '').includes('annule');

const obtenirNomAffiche = (utilisateur) => {
  const nomComplet = `${utilisateur?.nom || ''} ${utilisateur?.prenom || ''}`.trim();
  return nomComplet || utilisateur?.email || 'Utilisateur';
};

export default function App() {
  const [courriel, setCourriel] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [ecran, setEcran] = useState('loading');
  const [connexionEnCours, setConnexionEnCours] = useState(false);
  const [utilisateurConnecte, setUtilisateurConnecte] = useState(null);

  const [medecinsDisponibles, setMedecinsDisponibles] = useState([]);
  const [medecinSelectionne, setMedecinSelectionne] = useState(null);
  const [chargementMedecins, setChargementMedecins] = useState(false);
  const [erreurChargementMedecins, setErreurChargementMedecins] = useState('');
  const [dateSelectionnee, setDateSelectionnee] = useState(new Date());
  const [afficherCalendrier, setAfficherCalendrier] = useState(false);
  const [creneauxDisponibles, setCreneauxDisponibles] = useState([]);
  const [chargementPriseRdv, setChargementPriseRdv] = useState(false);
  const [chargementCreneaux, setChargementCreneaux] = useState(false);
  const [creationRdvEnCours, setCreationRdvEnCours] = useState(false);
  const [mesRendezVous, setMesRendezVous] = useState([]);
  const [chargementMesRdv, setChargementMesRdv] = useState(false);
  const [erreurMesRdv, setErreurMesRdv] = useState('');
  const [patientIri, setPatientIri] = useState('');
  const [etatEnAttenteIri, setEtatEnAttenteIri] = useState('/api/etats/1');
  const [etatAnnuleIri, setEtatAnnuleIri] = useState('/api/etats/4');
  const [rdvDetailSelectionneId, setRdvDetailSelectionneId] = useState(null);
  const [annulationRdvIdEnCours, setAnnulationRdvIdEnCours] = useState(null);

  useEffect(() => {
    const restaurerSession = async () => {
      try {
        const utilisateurSauvegarde = await AsyncStorage.getItem(CLE_STOCKAGE_UTILISATEUR);

        if (utilisateurSauvegarde) {
          const utilisateurParse = JSON.parse(utilisateurSauvegarde);

          if (estUtilisateurPatient(utilisateurParse)) {
            setUtilisateurConnecte(utilisateurParse);
            setEcran('menu');
            return;
          }

          await AsyncStorage.removeItem(CLE_STOCKAGE_UTILISATEUR);
        }
      } catch (erreur) {
        console.error('Erreur restauration session:', erreur);
      }

      setEcran('accueil');
    };

    restaurerSession();
  }, []);

  useEffect(() => {
    if (ecran === 'prise_rdv' && utilisateurConnecte?.jeton) {
      initialiserPriseRdv();
    }
  }, [ecran, utilisateurConnecte?.jeton]);

  useEffect(() => {
    if (ecran === 'mes_rdv' && utilisateurConnecte?.jeton) {
      chargerMesRendezVous();
    }
  }, [ecran, utilisateurConnecte?.jeton]);

  useEffect(() => {
    if (ecran === 'annuler_rdv' && utilisateurConnecte?.jeton) {
      chargerMesRendezVous();
    }
  }, [ecran, utilisateurConnecte?.jeton]);

  const parserDonneesReponse = async (reponse) => {
    const texteBrut = await reponse.text();

    if (!texteBrut) {
      return {};
    }

    try {
      return JSON.parse(texteBrut);
    } catch (erreur) {
      return { message: 'Réponse serveur invalide' };
    }
  };

  const obtenirHeadersAuth = (contentType = null) => {
    const headers = {
      Accept: 'application/ld+json',
      Authorization: `Bearer ${utilisateurConnecte?.jeton || ''}`,
    };

    if (contentType) {
      headers['Content-Type'] = contentType;
    }

    return headers;
  };

  const recupererMedecins = async () => {
    setChargementMedecins(true);
    setErreurChargementMedecins('');

    try {
      const reponse = await fetch(`${URL_API_BASE}/medecins`, {
        headers: obtenirHeadersAuth(),
      });

      const donnees = await parserDonneesReponse(reponse);

      if (!reponse.ok) {
        setMedecinsDisponibles([]);
        setErreurChargementMedecins(donnees?.detail || donnees?.message || 'Impossible de charger la liste des medecins.');
        return;
      }

      const medecins = extraireCollection(donnees)
        .map((medecin) => ({
          id: medecin?.id,
          iri: medecin?.['@id'] || `/api/medecins/${medecin?.id}`,
          nomAffiche: formatNomMedecin(medecin),
        }))
        .filter((medecin) => medecin?.id && medecin?.iri && !estNomMedecinExclu(medecin.nomAffiche));

      setMedecinsDisponibles(medecins);
      setMedecinSelectionne((precedent) => {
        if (!medecins.length) {
          return null;
        }

        if (precedent?.id && medecins.some((medecin) => medecin.id === precedent.id)) {
          return precedent;
        }

        return medecins[0];
      });
    } catch (erreur) {
      setMedecinsDisponibles([]);
      setErreurChargementMedecins('Impossible de recuperer les medecins. Verifiez la connexion avec le backend.');
      console.error('Erreur recupererMedecins:', erreur);
    } finally {
      setChargementMedecins(false);
    }
  };

  const initialiserPriseRdv = async () => {
    setChargementPriseRdv(true);

    try {
      await recupererMedecins();

      const [reponsePatients, reponseEtats] = await Promise.all([
        fetch(`${URL_API_BASE}/patients`, {
          headers: obtenirHeadersAuth(),
        }),
        fetch(`${URL_API_BASE}/etats`, {
          headers: obtenirHeadersAuth(),
        }),
      ]);

      const [donneesPatients, donneesEtats] = await Promise.all([
        parserDonneesReponse(reponsePatients),
        parserDonneesReponse(reponseEtats),
      ]);

      if (reponsePatients.ok) {
        const patients = extraireCollection(donneesPatients);
        const patientCourant = patients.find(
          (patient) => String(patient?.email || '').toLowerCase() === String(utilisateurConnecte?.email || '').toLowerCase()
        );

        if (patientCourant) {
          setPatientIri(patientCourant?.['@id'] || `/api/patients/${patientCourant?.id}`);
        } else if (utilisateurConnecte?.id) {
          setPatientIri(`/api/patients/${utilisateurConnecte.id}`);
        }
      }

      if (reponseEtats.ok) {
        const etats = extraireCollection(donneesEtats);
        const etatEnAttente = etats.find((etat) => String(etat?.libelle || '').toLowerCase().includes('attente'));
        const etatAnnule = etats.find((etat) => String(etat?.libelle || '').toLowerCase().includes('annule'));

        if (etatEnAttente) {
          setEtatEnAttenteIri(etatEnAttente?.['@id'] || `/api/etats/${etatEnAttente?.id}`);
        }

        if (etatAnnule) {
          setEtatAnnuleIri(etatAnnule?.['@id'] || `/api/etats/${etatAnnule?.id}`);
        }
      }
    } catch (erreur) {
      Alert.alert('Erreur', 'Initialisation de la prise de RDV impossible.');
      console.error('Erreur initialiserPriseRdv:', erreur);
    } finally {
      setChargementPriseRdv(false);
    }
  };

  const trouverPatientIri = async () => {
    if (patientIri) {
      return patientIri;
    }

    if (utilisateurConnecte?.id) {
      const iriParId = `/api/patients/${utilisateurConnecte.id}`;
      setPatientIri(iriParId);
      return iriParId;
    }

    const reponsePatients = await fetch(`${URL_API_BASE}/patients`, {
      headers: obtenirHeadersAuth(),
    });

    const donneesPatients = await parserDonneesReponse(reponsePatients);

    if (!reponsePatients.ok) {
      return '';
    }

    const patients = extraireCollection(donneesPatients);
    const patientCourant = patients.find(
      (patient) => String(patient?.email || '').toLowerCase() === String(utilisateurConnecte?.email || '').toLowerCase()
    );

    const iri = patientCourant?.['@id'] || (patientCourant?.id ? `/api/patients/${patientCourant.id}` : '');

    if (iri) {
      setPatientIri(iri);
    }

    return iri;
  };

  const chargerMesRendezVous = async () => {
    setChargementMesRdv(true);
    setErreurMesRdv('');

    try {
      const iriPatient = await trouverPatientIri();

      if (!iriPatient) {
        setMesRendezVous([]);
        setErreurMesRdv('Profil patient introuvable. Reconnectez-vous.');
        return;
      }

      const [reponse, reponseMedecins, reponseEtats] = await Promise.all([
        fetch(`${URL_API_BASE}/rendez_vouses?patient=${encodeURIComponent(iriPatient)}&order[debut]=desc`, {
          headers: obtenirHeadersAuth(),
        }),
        fetch(`${URL_API_BASE}/medecins`, {
          headers: obtenirHeadersAuth(),
        }),
        fetch(`${URL_API_BASE}/etats`, {
          headers: obtenirHeadersAuth(),
        }),
      ]);

      const [donnees, donneesMedecins, donneesEtats] = await Promise.all([
        parserDonneesReponse(reponse),
        parserDonneesReponse(reponseMedecins),
        parserDonneesReponse(reponseEtats),
      ]);

      if (!reponse.ok) {
        setMesRendezVous([]);
        setErreurMesRdv(donnees?.detail || donnees?.message || 'Impossible de charger vos rendez-vous.');
        return;
      }

      const medecinsParIri = {};
      const irisMedecinsExclus = new Set();
      if (reponseMedecins.ok) {
        extraireCollection(donneesMedecins).forEach((medecin) => {
          const iri = medecin?.['@id'] || (medecin?.id ? `/api/medecins/${medecin.id}` : '');
          if (estMedecinExclu(medecin)) {
            if (iri) {
              irisMedecinsExclus.add(iri);
            }
            return;
          }

          if (iri) {
            medecinsParIri[iri] = formatNomMedecin(medecin);
          }
        });
      }

      const etatsParIri = {};
      if (reponseEtats.ok) {
        extraireCollection(donneesEtats).forEach((etat) => {
          const iri = etat?.['@id'] || (etat?.id ? `/api/etats/${etat.id}` : '');
          if (iri) {
            etatsParIri[iri] = etat?.libelle || `Etat #${etat?.id}`;
          }
        });

        const etatAnnule = extraireCollection(donneesEtats).find((etat) =>
          String(etat?.libelle || '').toLowerCase().includes('annule')
        );

        if (etatAnnule) {
          setEtatAnnuleIri(etatAnnule?.['@id'] || `/api/etats/${etatAnnule?.id}`);
        }
      }

      const rendezVous = extraireCollection(donnees)
        .map((rdv) => ({
          id: rdv?.id,
          debut: rdv?.debut,
          fin: rdv?.fin,
          medecin: rdv?.medecin,
          etat: rdv?.etat,
          medecinLibelle: obtenirLibelleMedecin(rdv?.medecin, medecinsParIri),
          etatLibelle: obtenirLibelleEtat(rdv?.etat, etatsParIri),
          commentaireAffiche: obtenirCommentaireRdv(rdv),
        }))
        .filter(
          (rdv) =>
            !estNomMedecinExclu(rdv.medecinLibelle) &&
            !(typeof rdv.medecin === 'string' && irisMedecinsExclus.has(rdv.medecin)) &&
            !estRdvAnnule(rdv)
        );

      rendezVous.sort((a, b) => {
        const prioriteA = obtenirPrioriteEtat(a.etatLibelle);
        const prioriteB = obtenirPrioriteEtat(b.etatLibelle);

        if (prioriteA !== prioriteB) {
          return prioriteA - prioriteB;
        }

        return new Date(b.debut || 0).getTime() - new Date(a.debut || 0).getTime();
      });

      setMesRendezVous(rendezVous);
    } catch (erreur) {
      setMesRendezVous([]);
      setErreurMesRdv('Impossible de charger vos rendez-vous.');
      console.error('Erreur chargerMesRendezVous:', erreur);
    } finally {
      setChargementMesRdv(false);
    }
  };

  const chargerCreneauxDisponibles = async () => {
    if (!medecinSelectionne?.id) {
      Alert.alert('Erreur', 'Veuillez selectionner un medecin.');
      return;
    }

    setChargementCreneaux(true);

    try {
      const dateRecherche = obtenirDateIsoDepuisObjet(dateSelectionnee);

      const endpointsDisponibilites = [
        `${URL_RACINE_BACKEND}/medecin/${medecinSelectionne.id}/available-slots?date=${encodeURIComponent(dateRecherche)}`,
        `${URL_API_BASE}/medecin/${medecinSelectionne.id}/available-slots?date=${encodeURIComponent(dateRecherche)}`,
      ];

      let reponse = null;
      let donnees = {};

      for (const endpoint of endpointsDisponibilites) {
        const tentative = await fetch(endpoint, {
          headers: obtenirHeadersAuth(),
        });

        const donneesTentative = await parserDonneesReponse(tentative);

        if (tentative.ok) {
          reponse = tentative;
          donnees = donneesTentative;
          break;
        }

        if (!reponse || tentative.status !== 404) {
          reponse = tentative;
          donnees = donneesTentative;
        }
      }

      if (!reponse.ok) {
        const detailsErreursValidation = Array.isArray(donnees?.violations)
          ? donnees.violations.map((item) => item?.message).filter(Boolean).join('\n')
          : '';

        const messageErreur =
          donnees?.error ||
          donnees?.detail ||
          donnees?.message ||
          detailsErreursValidation ||
          `Impossible de charger les creneaux (HTTP ${reponse.status}).`;

        Alert.alert('Erreur', messageErreur);
        return;
      }

      const creneaux = extraireListeCreneauxBruts(donnees)
        .map((item, index) => {
          if (typeof item === 'string') {
            const debutIsoTexte = parserIsoDate(item, dateRecherche);

            if (!debutIsoTexte) {
              return null;
            }

            return {
              id: `${item}-${index}`,
              debut: debutIsoTexte,
              fin: calculerFinCreneau(debutIsoTexte),
              label: formaterCreneauAffiche(debutIsoTexte),
            };
          }

          const disponible = item?.available ?? true;

          if (!disponible) {
            return null;
          }

          const debutIso = parserIsoDate(item?.start || item?.debut || item?.value || item?.label, dateRecherche);
          const finIso = parserIsoDate(item?.end || item?.fin, dateRecherche) || (debutIso ? calculerFinCreneau(debutIso) : null);

          if (!debutIso || !finIso) {
            return null;
          }

          return {
            id: String(item?.id || item?.value || index),
            debut: debutIso,
            fin: finIso,
            label: formaterCreneauAffiche(debutIso),
          };
        })
        .filter(Boolean);

      setCreneauxDisponibles(creneaux);

      if (creneaux.length === 0) {
        Alert.alert('Information', `Aucun creneau disponible le ${formaterDateAffichee(dateSelectionnee)}.`);
      }
    } catch (erreur) {
      Alert.alert('Erreur', 'Impossible de recuperer les creneaux.');
      console.error('Erreur chargerCreneauxDisponibles:', erreur);
    } finally {
      setChargementCreneaux(false);
    }
  };

  const creerRendezVous = async (creneau) => {
    const patientIriCourant = patientIri || (utilisateurConnecte?.id ? `/api/patients/${utilisateurConnecte.id}` : '');

    if (!patientIriCourant) {
      Alert.alert('Erreur', 'Profil patient introuvable. Reconnectez-vous.');
      return;
    }

    if (!medecinSelectionne?.iri) {
      Alert.alert('Erreur', 'Medecin non selectionne.');
      return;
    }

    setCreationRdvEnCours(true);

    try {
      const debut = creneau?.debut;
      const fin = creneau?.fin;

      if (!debut || !fin) {
        Alert.alert('Erreur', 'Creneau invalide. Rechargez les disponibilites.');
        return;
      }

      const reponse = await fetch(`${URL_API_BASE}/rendez_vouses`, {
        method: 'POST',
        headers: obtenirHeadersAuth('application/ld+json'),
        body: JSON.stringify({
          patient: patientIriCourant,
          medecin: medecinSelectionne.iri,
          debut,
          fin,
          etat: etatEnAttenteIri,
        }),
      });

      const donnees = await parserDonneesReponse(reponse);

      if (reponse.ok || reponse.status === 201) {
        Alert.alert('Succes', 'Votre demande de rendez-vous a bien ete envoyee.');
        setCreneauxDisponibles([]);
        setEcran('menu');
        return;
      }

      Alert.alert('Erreur', donnees?.detail || donnees?.message || 'Creation du rendez-vous impossible.');
    } catch (erreur) {
      Alert.alert('Erreur', 'Erreur reseau lors de la creation du rendez-vous.');
      console.error('Erreur creerRendezVous:', erreur);
    } finally {
      setCreationRdvEnCours(false);
    }
  };

  const basculerDetailsRdv = (rdvId) => {
    setRdvDetailSelectionneId((precedent) => (precedent === rdvId ? null : rdvId));
  };

  const executerAnnulationRendezVous = async (rdv) => {
    setAnnulationRdvIdEnCours(rdv?.id || null);

    try {
      const reponseSuppression = await fetch(`${URL_API_BASE}/rendez_vouses/${rdv?.id}`, {
        method: 'DELETE',
        headers: obtenirHeadersAuth(),
      });

      const donneesSuppression = await parserDonneesReponse(reponseSuppression);
      const suppressionOk = reponseSuppression.ok || reponseSuppression.status === 204;

      if (!suppressionOk) {
        const reponsePatch = await fetch(`${URL_API_BASE}/rendez_vouses/${rdv?.id}`, {
          method: 'PATCH',
          headers: obtenirHeadersAuth('application/merge-patch+json'),
          body: JSON.stringify({
            etat: etatAnnuleIri,
          }),
        });

        const donneesPatch = await parserDonneesReponse(reponsePatch);
        const patchOk = reponsePatch.ok || reponsePatch.status === 200;

        if (!patchOk) {
          Alert.alert('Erreur', donneesPatch?.detail || donneesPatch?.message || donneesSuppression?.detail || 'Annulation impossible.');
          return;
        }
      }

      Alert.alert('Succes', 'Le rendez-vous a ete annule.');
      setRdvDetailSelectionneId(null);
      setMesRendezVous((precedent) => precedent.filter((item) => item?.id !== rdv?.id));
    } catch (erreur) {
      Alert.alert('Erreur', 'Impossible d annuler le rendez-vous pour le moment.');
      console.error('Erreur annulerRendezVous:', erreur);
    } finally {
      setAnnulationRdvIdEnCours(null);
    }
  };

  const annulerRendezVous = (rdv) => {
    Alert.alert('Confirmation', 'Voulez-vous annuler ce rendez-vous ?', [
      {
        text: 'Non',
        style: 'cancel',
      },
      {
        text: 'Oui, annuler',
        style: 'destructive',
        onPress: () => {
          void executerAnnulationRendezVous(rdv);
        },
      },
    ]);
  };

  const validerConnexion = async () => {
    if (!courriel || !motDePasse) {
      Alert.alert('Erreur', 'Veuillez remplir tous les champs');
      return;
    }

    setConnexionEnCours(true);

    try {
      const reponse = await fetch(`${URL_API_BASE}/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: courriel,
          password: motDePasse,
        }),
      });

      const donnees = await parserDonneesReponse(reponse);

      if (reponse.ok) {
        const utilisateurNormalise = normaliserUtilisateur(donnees, courriel);

        if (utilisateurNormalise.roles.length === 0) {
          Alert.alert('Erreur', 'Impossible de verifier le role depuis le JWT.');
          setMotDePasse('');
          return;
        }

        if (!estUtilisateurPatient(utilisateurNormalise)) {
          Alert.alert('Acces refuse', 'Cette application est reservee aux patients.');
          setMotDePasse('');
          setEcran('login');
          return;
        }

        await AsyncStorage.setItem(CLE_STOCKAGE_UTILISATEUR, JSON.stringify(utilisateurNormalise));

        setUtilisateurConnecte(utilisateurNormalise);
        setMotDePasse('');
        setEcran('menu');
      } else {
        Alert.alert('Erreur', donnees.message || 'Email ou mot de passe incorrect');
      }
    } catch (erreur) {
      Alert.alert('Erreur', 'Impossible de se connecter au serveur');
      console.error('Erreur:', erreur);
    } finally {
      setConnexionEnCours(false);
    }
  };

  const seDeconnecter = async () => {
    try {
      await AsyncStorage.removeItem(CLE_STOCKAGE_UTILISATEUR);
      setUtilisateurConnecte(null);
      setCourriel('');
      setMotDePasse('');
      setDateSelectionnee(new Date());
      setAfficherCalendrier(false);
      setCreneauxDisponibles([]);
      setMesRendezVous([]);
      setErreurMesRdv('');
      setMedecinsDisponibles([]);
      setMedecinSelectionne(null);
      setErreurChargementMedecins('');
      setPatientIri('');
      setEtatEnAttenteIri('/api/etats/1');
      setEtatAnnuleIri('/api/etats/4');
      setRdvDetailSelectionneId(null);
      setAnnulationRdvIdEnCours(null);
      setEcran('accueil');
    } catch (erreur) {
      Alert.alert('Erreur', 'Impossible de fermer la session');
    }
  };

  const gererActionMenu = (libelle) => {
    if (libelle === 'Prendre un RDV') {
      setEcran('prise_rdv');
      return;
    }

    if (libelle === 'Mes RDV') {
      setEcran('mes_rdv');
      return;
    }

    if (libelle === 'Annuler un RDV') {
      setEcran('annuler_rdv');
      return;
    }

    if (libelle === 'Afficher un RDV') {
      setEcran('mes_rdv');
      return;
    }

    Alert.alert(libelle, 'Fonctionnalite patient prete a connecter.');
  };

  const gererChangementDate = (evenement, nouvelleDate) => {
    if (Platform.OS === 'android') {
      setAfficherCalendrier(false);
    }

    if (evenement?.type === 'set' && nouvelleDate) {
      setDateSelectionnee(nouvelleDate);
      setCreneauxDisponibles([]);
    }
  };

  const afficherAccueil = () => (
    <View style={styles.card}>
      <Text style={styles.badge}>Espace patient</Text>
      <Text style={styles.title}>Organisez vos rendez-vous sans stress</Text>
      <Text style={styles.subtitle}>
        Connectez-vous pour acceder a votre espace patient, vos rendez-vous et votre profil.
      </Text>

      <Pressable style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed]} onPress={() => setEcran('login')}>
        <Text style={styles.primaryButtonText}>Commencer</Text>
      </Pressable>
    </View>
  );

  const afficherConnexion = () => (
    <View style={styles.card}>
      <Pressable onPress={() => setEcran('accueil')}>
        <Text style={styles.backLink}>Retour a l'accueil</Text>
      </Pressable>

      <Text style={styles.title}>Connexion</Text>
      <Text style={styles.subtitle}>Entrez vos identifiants pour acceder au menu principal.</Text>

      <TextInput
        style={styles.input}
        placeholder="Email"
        placeholderTextColor="#7E8AA0"
        value={courriel}
        onChangeText={setCourriel}
        keyboardType="email-address"
        autoCapitalize="none"
      />

      <TextInput
        style={styles.input}
        placeholder="Mot de passe"
        placeholderTextColor="#7E8AA0"
        value={motDePasse}
        onChangeText={setMotDePasse}
        secureTextEntry
      />

      <Pressable
        style={({ pressed }) => [styles.primaryButton, (pressed || connexionEnCours) && styles.buttonPressed]}
        onPress={validerConnexion}
        disabled={connexionEnCours}
      >
        <Text style={styles.primaryButtonText}>{connexionEnCours ? 'Connexion...' : 'Se connecter'}</Text>
      </Pressable>
    </View>
  );

  const afficherMenu = () => (
    <View style={styles.card}>
      <Text style={styles.badge}>Espace patient</Text>
      <Text style={styles.title}>Bienvenue</Text>
      <Text style={styles.userName}>{obtenirNomAffiche(utilisateurConnecte)}</Text>
      <Text style={styles.userMeta}>Compte patient</Text>

      <View style={styles.menuGrid}>
        <Pressable style={({ pressed }) => [styles.menuButton, pressed && styles.menuButtonPressed]} onPress={() => gererActionMenu('Prendre un RDV')}>
          <Text style={styles.menuButtonText}>Prendre un RDV</Text>
        </Pressable>

        <Pressable style={({ pressed }) => [styles.menuButton, pressed && styles.menuButtonPressed]} onPress={() => gererActionMenu('Mes RDV')}>
          <Text style={styles.menuButtonText}>Mes RDV</Text>
        </Pressable>

        <Pressable style={({ pressed }) => [styles.menuButton, pressed && styles.menuButtonPressed]} onPress={() => gererActionMenu('Annuler un RDV')}>
          <Text style={styles.menuButtonText}>Annuler un RDV</Text>
        </Pressable>

        <Pressable style={({ pressed }) => [styles.menuButton, pressed && styles.menuButtonPressed]} onPress={() => gererActionMenu('Afficher un RDV')}>
          <Text style={styles.menuButtonText}>Afficher un RDV</Text>
        </Pressable>
      </View>

      <Pressable style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]} onPress={seDeconnecter}>
        <Text style={styles.secondaryButtonText}>Deconnexion</Text>
      </Pressable>
    </View>
  );

  const afficherPriseRdv = () => (
    <ScrollView style={styles.card} contentContainerStyle={styles.priseRdvContenu}>
      <Pressable onPress={() => setEcran('menu')}>
        <Text style={styles.backLink}>Retour au menu</Text>
      </Pressable>

      <Text style={styles.title}>Prendre un RDV</Text>
      <Text style={styles.subtitle}>Choisissez une date, un medecin puis un creneau disponible.</Text>

      {chargementPriseRdv ? (
        <ActivityIndicator size="small" color="#1454F0" style={styles.inlineLoader} />
      ) : (
        <>
          <Text style={styles.fieldLabel}>Date du rendez-vous</Text>
          <Pressable
            style={({ pressed }) => [styles.datePickerButton, pressed && styles.buttonPressed]}
            onPress={() => setAfficherCalendrier((precedent) => !precedent)}
          >
            <Text style={styles.datePickerButtonText}>{formaterDateAffichee(dateSelectionnee)}</Text>
          </Pressable>

          {afficherCalendrier && (
            <View style={styles.calendrierContainer}>
              <DateTimePicker
                value={dateSelectionnee}
                mode="date"
                display={Platform.OS === 'ios' ? 'inline' : 'default'}
                minimumDate={new Date()}
                onChange={gererChangementDate}
              />

              {Platform.OS === 'ios' && (
                <Pressable style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]} onPress={() => setAfficherCalendrier(false)}>
                  <Text style={styles.secondaryButtonText}>Fermer le calendrier</Text>
                </Pressable>
              )}
            </View>
          )}

          <Text style={styles.fieldLabel}>Medecin</Text>
          <View style={styles.listeMedecins}>
            {chargementMedecins ? (
              <ActivityIndicator size="small" color="#1454F0" style={styles.inlineLoader} />
            ) : medecinsDisponibles.length === 0 ? (
              <>
                <Text style={styles.infoText}>Aucun medecin disponible.</Text>
                {!!erreurChargementMedecins && <Text style={styles.errorText}>{erreurChargementMedecins}</Text>}
                <Pressable style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]} onPress={recupererMedecins}>
                  <Text style={styles.secondaryButtonText}>Reessayer</Text>
                </Pressable>
              </>
            ) : (
              medecinsDisponibles.map((medecin) => {
                const estSelectionne = medecinSelectionne?.id === medecin.id;

                return (
                  <Pressable
                    key={String(medecin.id)}
                    style={({ pressed }) => [
                      styles.medecinButton,
                      estSelectionne && styles.medecinButtonSelectionne,
                      pressed && styles.buttonPressed,
                    ]}
                    onPress={() => {
                      setMedecinSelectionne(medecin);
                      setCreneauxDisponibles([]);
                    }}
                  >
                    <Text style={[styles.medecinButtonText, estSelectionne && styles.medecinButtonTextSelectionne]}>
                      {medecin.nomAffiche}
                    </Text>
                  </Pressable>
                );
              })
            )}
          </View>

          <Pressable
            style={({ pressed }) => [styles.primaryButton, (pressed || chargementCreneaux) && styles.buttonPressed]}
            onPress={chargerCreneauxDisponibles}
            disabled={chargementCreneaux || creationRdvEnCours || chargementMedecins || medecinsDisponibles.length === 0}
          >
            <Text style={styles.primaryButtonText}>{chargementCreneaux ? 'Chargement...' : 'Voir les disponibilites'}</Text>
          </Pressable>

          {creneauxDisponibles.length > 0 && (
            <>
              <Text style={styles.fieldLabel}>Creneaux disponibles</Text>
              <View style={styles.menuGrid}>
                {creneauxDisponibles.map((creneau) => (
                  <Pressable
                    key={creneau.id}
                    style={({ pressed }) => [styles.menuButton, pressed && styles.menuButtonPressed]}
                    onPress={() => creerRendezVous(creneau)}
                    disabled={creationRdvEnCours}
                  >
                    <Text style={styles.menuButtonText}>{creationRdvEnCours ? 'Envoi...' : creneau.label}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}
        </>
      )}
    </ScrollView>
  );

  const afficherMesRdv = () => (
    <View style={styles.card}>
      <Pressable onPress={() => setEcran('menu')}>
        <Text style={styles.backLink}>Retour au menu</Text>
      </Pressable>

      <Text style={styles.title}>Mes RDV</Text>
      <Text style={styles.subtitle}>Retrouvez la liste de vos rendez-vous planifies.</Text>

      {chargementMesRdv ? (
        <ActivityIndicator size="small" color="#1454F0" style={styles.inlineLoader} />
      ) : (
        <>
          {!!erreurMesRdv && <Text style={styles.errorText}>{erreurMesRdv}</Text>}

          {!erreurMesRdv && mesRendezVous.length === 0 && <Text style={styles.infoText}>Aucun rendez-vous trouve.</Text>}

          {mesRendezVous.length > 0 && (
            <ScrollView style={styles.rdvListe} contentContainerStyle={styles.rdvListeContenu}>
              {mesRendezVous.map((rdv) => (
                <View key={String(rdv.id || `${rdv.debut}-${rdv.fin}`)} style={styles.rdvCard}>
                  <Text style={styles.rdvDate}>{formaterDateHeure(rdv.debut)}</Text>
                  <Text style={styles.rdvMeta}>Fin : {formaterDateHeure(rdv.fin)}</Text>
                  <Text style={styles.rdvMeta}>Medecin : {rdv.medecinLibelle || obtenirLibelleMedecin(rdv.medecin)}</Text>
                  <Text style={styles.rdvMeta}>Etat : {rdv.etatLibelle || obtenirLibelleEtat(rdv.etat)}</Text>

                  <Pressable
                    style={({ pressed }) => [styles.secondaryButtonCompact, pressed && styles.buttonPressed]}
                    onPress={() => basculerDetailsRdv(rdv.id)}
                  >
                    <Text style={styles.secondaryButtonCompactText}>
                      {rdvDetailSelectionneId === rdv.id ? 'Masquer details' : 'Voir details'}
                    </Text>
                  </Pressable>

                  {rdvDetailSelectionneId === rdv.id && (
                    <View style={styles.rdvDetailsBloc}>
                      <Text style={styles.rdvDetailTitre}>Commentaire / directives</Text>
                      <Text style={styles.rdvDetailTexte}>{rdv.commentaireAffiche || 'Aucun commentaire fourni.'}</Text>
                    </View>
                  )}
                </View>
              ))}
            </ScrollView>
          )}

          <Pressable style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]} onPress={chargerMesRendezVous}>
            <Text style={styles.secondaryButtonText}>Actualiser</Text>
          </Pressable>
        </>
      )}
    </View>
  );

  const afficherAnnulerRdv = () => {
    const rendezVousAnnulables = mesRendezVous.filter(estRdvAnnulable);

    return (
      <View style={styles.card}>
        <Pressable onPress={() => setEcran('menu')}>
          <Text style={styles.backLink}>Retour au menu</Text>
        </Pressable>

        <Text style={styles.title}>Annuler un RDV</Text>
        <Text style={styles.subtitle}>Selectionnez un rendez-vous puis confirmez l annulation.</Text>

        {chargementMesRdv ? (
          <ActivityIndicator size="small" color="#1454F0" style={styles.inlineLoader} />
        ) : (
          <>
            {!!erreurMesRdv && <Text style={styles.errorText}>{erreurMesRdv}</Text>}

            {!erreurMesRdv && rendezVousAnnulables.length === 0 && (
              <Text style={styles.infoText}>Aucun rendez-vous annulable pour le moment.</Text>
            )}

            {rendezVousAnnulables.length > 0 && (
              <ScrollView style={styles.rdvListe} contentContainerStyle={styles.rdvListeContenu}>
                {rendezVousAnnulables.map((rdv) => (
                  <View key={String(rdv.id || `${rdv.debut}-${rdv.fin}`)} style={styles.rdvCard}>
                    <Text style={styles.rdvDate}>{formaterDateHeure(rdv.debut)}</Text>
                    <Text style={styles.rdvMeta}>Fin : {formaterDateHeure(rdv.fin)}</Text>
                    <Text style={styles.rdvMeta}>Medecin : {rdv.medecinLibelle || obtenirLibelleMedecin(rdv.medecin)}</Text>
                    <Text style={styles.rdvMeta}>Etat : {rdv.etatLibelle || obtenirLibelleEtat(rdv.etat)}</Text>

                    <Pressable
                      style={({ pressed }) => [styles.secondaryButtonCompact, pressed && styles.buttonPressed]}
                      onPress={() => basculerDetailsRdv(rdv.id)}
                    >
                      <Text style={styles.secondaryButtonCompactText}>
                        {rdvDetailSelectionneId === rdv.id ? 'Masquer details' : 'Voir details'}
                      </Text>
                    </Pressable>

                    {rdvDetailSelectionneId === rdv.id && (
                      <View style={styles.rdvDetailsBloc}>
                        <Text style={styles.rdvDetailTitre}>Commentaire / directives</Text>
                        <Text style={styles.rdvDetailTexte}>{rdv.commentaireAffiche || 'Aucun commentaire fourni.'}</Text>
                      </View>
                    )}

                    <Pressable
                      style={({ pressed }) => [
                        styles.dangerButton,
                        (pressed || annulationRdvIdEnCours === rdv.id) && styles.buttonPressed,
                      ]}
                      onPress={() => annulerRendezVous(rdv)}
                      disabled={annulationRdvIdEnCours === rdv.id}
                    >
                      <Text style={styles.dangerButtonText}>
                        {annulationRdvIdEnCours === rdv.id ? 'Annulation...' : 'Annuler ce RDV'}
                      </Text>
                    </Pressable>
                  </View>
                ))}
              </ScrollView>
            )}

            <Pressable style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]} onPress={chargerMesRendezVous}>
              <Text style={styles.secondaryButtonText}>Actualiser</Text>
            </Pressable>
          </>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />
      <View style={styles.backgroundCircleTop} />
      <View style={styles.backgroundCircleBottom} />

      <View style={styles.content}>
        {ecran === 'loading' && (
          <View style={styles.loadingCard}>
            <ActivityIndicator size="large" color="#1454F0" />
            <Text style={styles.loadingText}>Chargement de votre espace...</Text>
          </View>
        )}

        {ecran === 'accueil' && afficherAccueil()}
        {ecran === 'login' && afficherConnexion()}
        {ecran === 'menu' && afficherMenu()}
        {ecran === 'prise_rdv' && afficherPriseRdv()}
        {ecran === 'mes_rdv' && afficherMesRdv()}
        {ecran === 'annuler_rdv' && afficherAnnulerRdv()}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#EAF0FB',
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    justifyContent: 'center',
  },
  backgroundCircleTop: {
    position: 'absolute',
    width: 260,
    height: 260,
    borderRadius: 130,
    top: -80,
    right: -40,
    backgroundColor: '#C8D8FF',
  },
  backgroundCircleBottom: {
    position: 'absolute',
    width: 300,
    height: 300,
    borderRadius: 150,
    bottom: -120,
    left: -80,
    backgroundColor: '#DCE8FF',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 22,
    shadowColor: '#2D4270',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 6,
  },
  loadingCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    paddingVertical: 34,
    paddingHorizontal: 20,
    alignItems: 'center',
    shadowColor: '#2D4270',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 4,
  },
  loadingText: {
    marginTop: 14,
    color: '#415278',
    fontSize: 16,
    textAlign: 'center',
  },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: '#E9EEFF',
    color: '#2B4B93',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 14,
  },
  title: {
    fontSize: 28,
    lineHeight: 34,
    color: '#17233D',
    fontWeight: '800',
    marginBottom: 10,
  },
  subtitle: {
    color: '#556482',
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 20,
  },
  backLink: {
    color: '#2D4E9A',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 14,
  },
  input: {
    width: '100%',
    height: 52,
    borderWidth: 1,
    borderColor: '#CCD7EE',
    borderRadius: 12,
    backgroundColor: '#F7F9FF',
    paddingHorizontal: 16,
    marginBottom: 16,
    fontSize: 16,
    color: '#122446',
  },
  primaryButton: {
    width: '100%',
    height: 52,
    backgroundColor: '#1454F0',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 4,
  },
  secondaryButton: {
    width: '100%',
    height: 50,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#CAD5ED',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 10,
    backgroundColor: '#F8FAFF',
  },
  buttonPressed: {
    opacity: 0.85,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryButtonText: {
    color: '#23407A',
    fontSize: 15,
    fontWeight: '700',
  },
  userName: {
    color: '#27437A',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
  },
  userMeta: {
    color: '#4E5F84',
    fontSize: 14,
    marginBottom: 4,
  },
  fieldLabel: {
    color: '#2E4679',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  datePickerButton: {
    width: '100%',
    minHeight: 52,
    borderWidth: 1,
    borderColor: '#CCD7EE',
    borderRadius: 12,
    backgroundColor: '#F7F9FF',
    paddingHorizontal: 16,
    justifyContent: 'center',
    marginBottom: 12,
  },
  datePickerButtonText: {
    color: '#122446',
    fontSize: 16,
    fontWeight: '600',
  },
  calendrierContainer: {
    marginBottom: 14,
  },
  inlineLoader: {
    marginVertical: 20,
  },
  infoText: {
    color: '#5B6B8F',
    fontSize: 14,
  },
  errorText: {
    color: '#A52A2A',
    fontSize: 13,
    marginTop: 8,
    marginBottom: 12,
  },
  listeMedecins: {
    marginBottom: 16,
  },
  medecinButton: {
    borderWidth: 1,
    borderColor: '#CAD8F7',
    backgroundColor: '#F3F7FF',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    marginBottom: 8,
  },
  medecinButtonSelectionne: {
    borderColor: '#1454F0',
    backgroundColor: '#E6EEFF',
  },
  medecinButtonText: {
    color: '#2A457C',
    fontSize: 14,
    fontWeight: '600',
  },
  medecinButtonTextSelectionne: {
    color: '#103DAB',
  },
  menuGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginTop: 12,
    marginBottom: 6,
  },
  menuButton: {
    width: '48%',
    backgroundColor: '#EFF4FF',
    borderColor: '#CAD8F7',
    borderWidth: 1,
    borderRadius: 14,
    minHeight: 76,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
    paddingHorizontal: 8,
  },
  menuButtonPressed: {
    backgroundColor: '#DEE8FF',
  },
  menuButtonText: {
    color: '#1E3D78',
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
  },
  priseRdvContenu: {
    paddingBottom: 20,
  },
  rdvListe: {
    maxHeight: 300,
    marginBottom: 12,
  },
  rdvListeContenu: {
    paddingBottom: 6,
  },
  rdvCard: {
    borderWidth: 1,
    borderColor: '#CAD8F7',
    backgroundColor: '#F7FAFF',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginBottom: 10,
  },
  rdvDate: {
    color: '#1A3E81',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 6,
  },
  rdvMeta: {
    color: '#3B4F7D',
    fontSize: 13,
    marginBottom: 4,
  },
  secondaryButtonCompact: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#CAD5ED',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    alignSelf: 'flex-start',
    backgroundColor: '#F8FAFF',
  },
  secondaryButtonCompactText: {
    color: '#23407A',
    fontSize: 13,
    fontWeight: '700',
  },
  rdvDetailsBloc: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#D8E3FA',
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  rdvDetailTitre: {
    color: '#254179',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 4,
  },
  rdvDetailTexte: {
    color: '#3B4F7D',
    fontSize: 13,
    lineHeight: 18,
  },
  dangerButton: {
    width: '100%',
    minHeight: 44,
    marginTop: 10,
    borderRadius: 10,
    backgroundColor: '#B33636',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dangerButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
});
