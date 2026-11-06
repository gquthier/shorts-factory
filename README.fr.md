# Shorts Factory

**Tes vidéos longues. Tes prochains Reels. Ta voix.**

Studio Electron open source pour importer tes vidéos, repérer les extraits utiles, écrire les hooks, monter, vérifier, publier et apprendre des statistiques. [Présentation complète et galerie](README.md) · [Téléchargements](https://github.com/gquthier/shorts-factory/releases/latest).

## Premier démarrage

Ouvre **Démarrer**, connecte tes services et renseigne ton nom, ta niche, ton audience et quelques exemples de ton écriture. Les clés sont vérifiées puis enregistrées dans le trousseau macOS. Chaque personne part d'un profil vide. Aucune clé, vidéo, base clients ou recherche personnelle n'est fournie.

- **Anthropic ou Claude CLI** pour le texte : choisis l'un des deux.
- **ElevenLabs** pour les timings précis, facultatif avec Whisper local.
- **TryPost** pour publier et synchroniser les statistiques ; l'export local fonctionne sans lui.
- **Apify** pour ta veille de Reels publics, facultatif et facturé par le fournisseur quand tu lances une collecte.

La validation automatique et la publication automatique sont désactivées par défaut. L'app traite le montage sur ton Mac ; les éléments nécessaires sont envoyés aux services que tu choisis. [Détails des données](SECURITY.md).

## Tous les formats et leurs skills

Les six formats sont inclus avec leur code, leurs instructions et les références du moteur : **Split board, Black frame, Cinema talk, Selfie headline, Q&A card et Type depth**. Les neuf skills du projet couvrent aussi le pipeline, les hooks et l'analyse de performance. Les treize skills du moteur d'origine sont fournis séparément avec leur licence MIT. [Catalogue](templates/README.md).

## Installer

macOS, Node 22.18+, Chrome et les outils Apple sont nécessaires au pipeline complet. Les règles de montage sont surtout testées en français.

```bash
git clone https://github.com/gquthier/shorts-factory.git
cd shorts-factory
brew install node@22 ffmpeg yt-dlp whisper-cpp
xcode-select --install # seulement si les outils Apple sont absents
npm ci
npm run setup
npm start
```

`npm run setup` prépare le moteur et télécharge le modèle Whisper (~1,6 Go) s'il manque. Pour Claude CLI, connecte-toi avec `claude auth login`. Une clé Anthropic permet de s'en passer. L'écran Démarrer indique les outils manquants.

L'application téléchargeable est disponible sur [Releases](https://github.com/gquthier/shorts-factory/releases/latest), pour Mac Apple Silicon. Elle nécessite aussi les outils vidéo et le modèle local. Elle n'est pas notarisée par Apple : après une première tentative, utilise si nécessaire **Réglages Système → Confidentialité et sécurité → Ouvrir quand même**.

Le paquet Electron conserve les données dans `~/Library/Application Support/Shorts Factory`. Le serveur lancé depuis les sources utilise `./data`. L'option `SHORTS_DATA` permet de choisir un autre dossier. Les deux modes ont des dossiers de données distincts par défaut.

## Statistiques et prochaines idées

Choisis le réseau, la chaîne, la période et la métrique : vues, impressions, portée, interactions, etc. Compare les médianes par format et sujet. Corrige les sujets détectés et génère des idées à partir des données sélectionnées. Les métriques absentes ne deviennent pas des zéros et les résultats restent des pistes, pas des certitudes.

La [veille optionnelle](docs/research.md) démarre sans compte suivi ni planification automatique. Le corpus privé à l'origine du projet n'est pas redistribué.

## Développer

`npm test` · `python3 -m unittest discover -s test -p '*_test.py'` · `node --no-warnings tools/render-smoke.ts`.

`npm run app:build` construit le paquet distribuable dans `dist/`. [Contribuer](CONTRIBUTING.md) · [Licences et crédits](THIRD_PARTY_NOTICES.md).

Créé par [Gauthier](https://x.com/gauthierthiry), [BizOS](https://bizos.cc). Moteur et skills d'origine : [Melvyn Malherbe](https://github.com/Melvynx/video-agent-skills). Licence [MIT](LICENSE).
