import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// URL de base de votre API backend.
const URL_API_BASE = 'http://127.0.0.1:8000/api';

// Cle utilisee pour sauvegarder la session utilisateur sur le telephone.
const CLE_STOCKAGE_UTILISATEUR = '@gestionRDV_user';

// Harmonise le format des roles.
// Selon le backend, `roles` peut arriver sous plusieurs formes:
// - deja en tableau JavaScript: ['ROLE_PATIENT']
// - en texte JSON: '["ROLE_PATIENT"]'
// - en chaine simple: 'ROLE_PATIENT'
// Le but est d'obtenir toujours un tableau pour simplifier les verifications.
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

// Si le backend renvoie surtout un JWT, on lit simplement son payload.
// Un JWT a souvent la forme: header.payload.signature
// Ici, on decode uniquement la partie `payload` pour lire des infos utiles
// comme les roles, l'email ou l'identifiant utilisateur.
// Cette lecture se fait uniquement cote client pour verifier l'acces a l'app.
const lirePayloadJwt = (jeton) => {
  if (!jeton || typeof jeton !== 'string') {
    return {};
  }

  try {
    // On recupere la partie centrale du JWT, qui contient les donnees utiles.
    const partiePayload = jeton.split('.')[1];

    if (!partiePayload) {
      return {};
    }

    // Le payload JWT utilise souvent le format Base64 URL,
    // on le convertit donc en Base64 classique avant decodage.
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
    const base64 = partiePayload.replace(/-/g, '+').replace(/_/g, '/');
    const base64Complete = `${base64}${'='.repeat((4 - (base64.length % 4 || 4)) % 4)}`;

    let index = 0;
    let texteDecode = '';

    // On reconstruit le texte JSON caractere par caractere.
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

    // Si tout se passe bien, le payload contient un JSON exploitable.
    return JSON.parse(texteDecode);
  } catch (erreur) {
    // En cas d'erreur, on retourne un objet vide pour eviter un crash.
    return {};
  }
};

// Cette fonction construit un objet utilisateur unique pour toute l'application.
// Elle prend les informations soit depuis:
// - la reponse JSON directe (`user`, `data.user`, etc.)
// - le payload du JWT si certaines infos ne sont pas directement presentes
// Cela permet au reste de l'app de toujours manipuler le meme format.
const normaliserUtilisateur = (donnees, emailDeSecours) => {
  // On cherche d'abord un jeton eventuellement renvoye par le backend.
  const jeton = donnees?.token || donnees?.jwt || donnees?.access_token || donnees?.data?.token || donnees?.data?.jwt || null;

  // Si un JWT existe, on lit son payload pour recuperer roles, email, id, etc.
  const payloadJwt = lirePayloadJwt(jeton);

  // Certaines API renvoient l'utilisateur dans `user`, d'autres dans `data.user`
  // ou directement dans `data`. On couvre ici les cas les plus frequents.
  const contenu = donnees?.user || donnees?.data?.user || donnees?.data || {};

  // On priorise les roles presents dans la reponse JSON,
  // puis on tombe sur le JWT si necessaire.
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

// Regle metier principale de l'application.
// On autorise l'acces seulement si le tableau de roles contient ROLE_PATIENT.
// Un medecin, un assistant ou tout autre profil sera donc refuse.
const estUtilisateurPatient = (utilisateur) => {
  const roles = normaliserRoles(utilisateur?.roles).map((role) => String(role).toUpperCase());

  return roles.includes('ROLE_PATIENT');
};

// Construit le nom visible dans l'interface.
// On essaye d'afficher `nom prenom`; si l'un des deux manque,
// on utilise l'email pour ne jamais laisser un titre vide.
const obtenirNomAffiche = (utilisateur) => {
  const nomComplet = `${utilisateur?.nom || ''} ${utilisateur?.prenom || ''}`.trim();
  return nomComplet || utilisateur?.email || 'Utilisateur';
};

export default function App() {
  // Champs saisis par l'utilisateur dans le formulaire de connexion.
  const [courriel, setCourriel] = useState('');
  const [motDePasse, setMotDePasse] = useState('');

  // Petit systeme de navigation local a ce composant.
  // `loading`  : l'app verifie s'il existe deja une session
  // `accueil`  : ecran d'introduction
  // `login`    : formulaire de connexion
  // `menu`     : ecran principal du patient connecte
  const [ecran, setEcran] = useState('loading');

  // Cet etat evite les doubles clics pendant l'appel au backend.
  const [connexionEnCours, setConnexionEnCours] = useState(false);

  // Contient le profil du patient une fois la connexion validee.
  const [utilisateurConnecte, setUtilisateurConnecte] = useState(null);

  useEffect(() => {
    // Au demarrage, on essaie de restaurer la session locale.
    // Si un utilisateur valide est deja stocke dans AsyncStorage,
    // on le renvoie directement vers le menu sans repasser par le login.
    const restaurerSession = async () => {
      try {
        const utilisateurSauvegarde = await AsyncStorage.getItem(CLE_STOCKAGE_UTILISATEUR);

        if (utilisateurSauvegarde) {
          const utilisateurParse = JSON.parse(utilisateurSauvegarde);

          // Par securite, on reverifie le role avant de rouvrir la session.
          if (estUtilisateurPatient(utilisateurParse)) {
            setUtilisateurConnecte(utilisateurParse);
            setEcran('menu');
            return;
          }

          // Si le stockage contient un utilisateur non autorise,
          // on supprime la session locale pour repartir proprement.
          await AsyncStorage.removeItem(CLE_STOCKAGE_UTILISATEUR);
        }
      } catch (erreur) {
        console.error('Erreur restauration session:', erreur);
      }

      // Si aucune session exploitable n'existe, on affiche l'accueil.
      setEcran('accueil');
    };

    restaurerSession();
  }, []);

  // Cette fonction lit la reponse HTTP de maniere defensive.
  // Pourquoi ne pas faire directement `response.json()` ?
  // Parce que si le backend renvoie une reponse vide ou invalide,
  // `response.json()` peut lever une erreur. Ici on garde le controle.
  const parserDonneesReponse = async (reponse) => {
    const texteBrut = await reponse.text();

    if (!texteBrut) {
      return {};
    }

    try {
      return JSON.parse(texteBrut);
    } catch (erreur) {
      // On renvoie un message standard pour pouvoir afficher une alerte propre.
      return { message: 'Réponse serveur invalide' };
    }
  };

  // Fonction principale de connexion.
  // Etapes:
  // 1. verifier que les champs sont remplis
  // 2. appeler l'API `/login`
  // 3. reconstruire l'utilisateur a partir de la reponse/JWT
  // 4. verifier le role ROLE_PATIENT
  // 5. sauvegarder la session locale puis ouvrir le menu
  const validerConnexion = async () => {
    if (!courriel || !motDePasse) {
      Alert.alert('Erreur', 'Veuillez remplir tous les champs');
      return;
    }

    setConnexionEnCours(true);

    try {
      // Appel du backend avec les identifiants saisis par l'utilisateur.
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

      // On parse la reponse pour en extraire les donnees utiles.
      const donnees = await parserDonneesReponse(reponse);

      if (reponse.ok) {
        // On harmonise les infos utilisateur pour les utiliser dans toute l'app.
        const utilisateurNormalise = normaliserUtilisateur(donnees, courriel);

        // Si on ne trouve aucun role, on ne peut pas appliquer la regle metier.
        // On prefere donc bloquer proprement avec un message explicite.
        if (utilisateurNormalise.roles.length === 0) {
          Alert.alert('Erreur', 'Impossible de verifier le role depuis le JWT.');
          setMotDePasse('');
          return;
        }

        // Le compte existe mais n'est pas un patient autorise dans cette application.
        if (!estUtilisateurPatient(utilisateurNormalise)) {
          Alert.alert('Acces refuse', 'Cette application est reservee aux patients.');
          setMotDePasse('');
          setEcran('login');
          return;
        }

        // On sauvegarde la session pour eviter de redemander le login a chaque ouverture.
        await AsyncStorage.setItem(CLE_STOCKAGE_UTILISATEUR, JSON.stringify(utilisateurNormalise));

        // Mise a jour de l'etat React puis navigation vers le menu patient.
        setUtilisateurConnecte(utilisateurNormalise);
        setMotDePasse('');
        setEcran('menu');
      } else {
        // Ici on gere le cas classique: email ou mot de passe incorrect.
        Alert.alert('Erreur', donnees.message || 'Email ou mot de passe incorrect');
      }
    } catch (erreur) {
      // Erreur reseau, serveur indisponible, CORS, etc.
      Alert.alert('Erreur', 'Impossible de se connecter au serveur');
      console.error('Erreur:', erreur);
    } finally {
      // Quoi qu'il arrive, on reactive le bouton de connexion.
      setConnexionEnCours(false);
    }
  };

  // Deconnexion locale.
  // On efface la session stockee sur l'appareil puis on remet l'interface a zero.
  const seDeconnecter = async () => {
    try {
      await AsyncStorage.removeItem(CLE_STOCKAGE_UTILISATEUR);
      setUtilisateurConnecte(null);
      setCourriel('');
      setMotDePasse('');
      setEcran('accueil');
    } catch (erreur) {
      Alert.alert('Erreur', 'Impossible de fermer la session');
    }
  };

  // Pour l'instant, chaque bouton du menu ouvre juste une alerte.
  // Plus tard, cette fonction pourra etre remplacee par de la vraie navigation.
  const gererActionMenu = (libelle) => {
    Alert.alert(libelle, 'Fonctionnalite patient prete a connecter.');
  };

  // Ecran d'accueil avant connexion.
  // Il presente l'application et redirige vers le formulaire de login.
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

  // Formulaire de connexion du patient.
  // Les champs sont lies a l'etat React, donc chaque saisie met a jour l'interface.
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

  // Menu principal visible uniquement apres une connexion valide.
  // Le nom affiche provient du profil normalise stocke dans l'etat.
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

        <Pressable style={({ pressed }) => [styles.menuButton, pressed && styles.menuButtonPressed]} onPress={() => gererActionMenu('Mon profil')}>
          <Text style={styles.menuButtonText}>Mon profil</Text>
        </Pressable>
      </View>

      <Pressable style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]} onPress={seDeconnecter}>
        <Text style={styles.secondaryButtonText}>Deconnexion</Text>
      </Pressable>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* Effets decoratifs de fond pour donner plus de profondeur a l'ecran. */}
      <StatusBar style="light" />
      <View style={styles.backgroundCircleTop} />
      <View style={styles.backgroundCircleBottom} />

      <View style={styles.content}>
        {/* Pendant le chargement initial, on attend la verification de session. */}
        {ecran === 'loading' && (
          <View style={styles.loadingCard}>
            <ActivityIndicator size="large" color="#1454F0" />
            <Text style={styles.loadingText}>Chargement de votre espace...</Text>
          </View>
        )}

        {/* Affichage conditionnel des ecrans selon l'etat courant. */}
        {ecran === 'accueil' && afficherAccueil()}
        {ecran === 'login' && afficherConnexion()}
        {ecran === 'menu' && afficherMenu()}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  // Structure globale de la page.
  container: {
    flex: 1,
    backgroundColor: '#EAF0FB',
  },
  // Zone centrale qui contient la carte active.
  content: {
    flex: 1,
    paddingHorizontal: 20,
    justifyContent: 'center',
  },
  // Decorations d'arriere-plan.
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
  // Carte blanche reutilisee pour accueil, connexion et menu.
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
  // Carte dediee a l'etat de chargement.
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
  // Textes principaux de l'interface.
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
  // Champs du formulaire de connexion.
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
  // Bouton d'action principal.
  primaryButton: {
    width: '100%',
    height: 52,
    backgroundColor: '#1454F0',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 4,
  },
  // Bouton secondaire utilise ici pour la deconnexion.
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
  // Etat visuel quand l'utilisateur appuie sur un bouton.
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
  // Grille des actions du menu patient.
  menuGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginTop: 12,
    marginBottom: 6,
  },
  // Carte individuelle d'une action du menu.
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
  // Texte affiche dans chaque bouton de menu.
  menuButtonText: {
    color: '#1E3D78',
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
  },
});
