export type Locale = 'en' | 'fr';

type MessageLeaf = string;
export type MessageTree = {
  readonly [key: string]: MessageLeaf | MessageTree;
};

export const defaultLocale: Locale = 'en';

export const en = {
  app: {
    name: 'MyClash',
  },
  metadata: {
    publicTitle: 'MyClash',
    publicDescription: 'Free, open-source platform for HEMA event management.',
    adminTitle: 'MyClash Admin',
    adminDescription: 'MyClash organizer admin and super admin.',
    scoringTitle: 'MyClash Scoring',
    scoringDescription: 'Scorekeeper PWA - offline-first match exchange recording.',
  },
  actions: {
    add: 'Add',
    apply: 'Apply',
    approve: 'Approve',
    back: 'Back',
    cancel: 'Cancel',
    clear: 'Clear',
    close: 'Close',
    confirm: 'Confirm',
    continue: 'Continue',
    delete: 'Delete',
    edit: 'Edit',
    export: 'Export',
    import: 'Import',
    next: 'Next',
    previous: 'Previous',
    reject: 'Reject',
    remove: 'Remove',
    reset: 'Reset',
    revert: 'Revert',
    save: 'Save',
    search: 'Search',
    submit: 'Submit',
    sync: 'Sync',
    view: 'View',
  },
  common: {
    all: 'All',
    loading: 'Loading...',
    none: 'None',
    optional: 'Optional',
    required: 'Required',
    unknown: 'Unknown',
    yes: 'Yes',
    no: 'No',
  },
  navigation: {
    skipToMainContent: 'Skip to main content',
  },
  offline: {
    title: "You're offline",
    description:
      'No internet connection. Exchanges entered while offline will sync automatically when you reconnect.',
    tryAgain: 'Try again',
  },
  auth: {
    oauth: {
      google: 'Google',
      continueWithGoogle: 'Continue with Google',
      completing: 'Completing sign-in',
      wait: 'Please wait while we finish signing you in.',
      errorTitle: 'Sign-in failed',
      errors: {
        missingCode: 'Google did not return an authorization code.',
        exchangeFailed: 'Could not complete Google sign-in.',
        notAuthorized: 'This Google account is not authorized for this action.',
        personMissing: 'Missing profile claim context.',
        signupContextMissing: 'Missing organization signup details.',
        startFailed: 'Could not start Google sign-in.',
      },
    },
  },
  admin: {
    dashboard: {
      title: 'Super Admin',
      description: 'Platform moderation, operational controls, and recovery tools.',
      systemVersionsTitle: 'System Versions',
      systemVersionsDescription: 'Inspect app, framework, container, and infrastructure versions.',
      backupsTitle: 'Backups',
      backupsDescription: 'Manage server and Scaleway S3 backups.',
    },
    backups: {
      backToAdmin: 'Back to admin',
      title: 'Backup Management',
      description: 'Inspect, download, upload, run, and restore platform backups.',
      loading: 'Loading backups...',
      accessDenied: 'Access denied. Super admin required.',
      loadError: 'Failed to load backups.',
      operationLoadError: 'Failed to refresh backup operation.',
      runBackup: 'Run backup',
      runStarted: 'Backup operation started.',
      runError: 'Could not start backup.',
      restoreStarted: 'Restore operation started.',
      restoreError: 'Could not start restore.',
      uploadTitle: 'Restore from desktop upload',
      uploadFile: 'Backup file',
      stageUpload: 'Stage upload',
      uploadMissing: 'Select a backup file first.',
      uploadStaged: 'Backup upload staged.',
      uploadError: 'Could not upload backup.',
      lastBackup: 'Last backup',
      cloud: 'Scaleway S3',
      configured: 'Configured',
      notConfigured: 'Not configured',
      operation: 'Operation',
      currentOperation: 'Current operation',
      operationBackup: 'Manual backup',
      operationRestore: 'Restore',
      available: 'Available backups',
      empty: 'No backups found.',
      timestamp: 'Timestamp',
      locations: 'Locations',
      artifacts: 'Artifacts',
      actions: 'Actions',
      downloadDb: 'Download DB',
      restoreFrom: 'Restore from {location}',
      restoreConfirmation: 'Restore confirmation phrase',
      encrypted: 'encrypted',
      locationsMap: {
        local: 'server',
        s3: 'Scaleway S3',
        upload: 'upload',
      },
      statuses: {
        success: 'successful',
        failed: 'failed',
        unknown: 'unknown',
      },
      operationStatuses: {
        queued: 'queued',
        running: 'running',
        success: 'successful',
        failed: 'failed',
      },
      artifactKinds: {
        db: 'DB',
        storage: 'storage',
      },
    },
    systemVersions: {
      backToAdmin: 'Back to admin',
      title: 'System Versions',
      description:
        'Installed app, framework, container, and infrastructure versions visible to super admins.',
      loading: 'Loading system versions...',
      accessDenied: 'Access denied. Super admin required.',
      loadError: 'Failed to load system versions.',
      generatedAt: 'Generated at',
      source: 'Source',
      version: 'Version',
      component: 'Component',
      status: 'Status',
      noComponents: 'No components reported.',
      unknown: 'unknown',
      statuses: {
        ok: 'ok',
        unknown: 'unknown',
      },
      groups: {
        app: 'Application',
        deploy: 'Deploy',
        workspaces: 'Workspaces',
        framework: 'Framework and runtime',
        infrastructure: 'Infrastructure',
        containers: 'App containers',
      },
      components: {
        myclash: 'MyClash app',
        deployedCommit: 'Deployed commit',
        deployedAt: 'Deployed at',
        deployedBy: 'Deployed by',
        backupFile: 'Backup file',
        '@myclash/api': 'API workspace',
        '@myclash/web-admin': 'Admin app workspace',
        '@myclash/web-public': 'Public app workspace',
        '@myclash/web-scoring': 'Scoring app workspace',
        '@myclash/web-marketing': 'Marketing site workspace',
        react: 'React',
        reactDom: 'React DOM',
        next: 'Next.js',
        nestjs: 'NestJS',
        node: 'Node.js',
        pnpm: 'pnpm',
        typescript: 'TypeScript',
        traefik: 'Traefik',
        postgres: 'Supabase Postgres',
        redis: 'Redis',
        supabaseAuth: 'Supabase Auth',
        supabaseRealtime: 'Supabase Realtime',
        supabaseStorage: 'Supabase Storage',
        kong: 'Kong',
        postgrest: 'PostgREST',
        api: 'API container',
        worker: 'Worker container',
        'web-admin': 'Admin container',
        'web-public': 'Public app container',
        'web-scoring': 'Scoring app container',
        'web-marketing': 'Marketing container',
      },
    },
  },
  test: {
    greeting: 'Hello, {name}',
  },
} as const satisfies MessageTree;

export const fr = {
  app: {
    name: 'MyClash',
  },
  metadata: {
    publicTitle: 'MyClash',
    publicDescription: "Plateforme libre et open-source pour la gestion d'événements d'AMHE.",
    adminTitle: 'MyClash Admin',
    adminDescription: 'Administration MyClash pour les organisateurs et super-administrateurs.',
    scoringTitle: 'MyClash',
    scoringDescription: 'Tableau de saisie des scores',
  },
  actions: {
    add: 'Ajouter',
    apply: 'Appliquer',
    approve: 'Approuver',
    back: 'Retour',
    cancel: 'Annuler',
    clear: 'Effacer',
    close: 'Fermer',
    confirm: 'Confirmer',
    continue: 'Continuer',
    delete: 'Supprimer',
    edit: 'Modifier',
    export: 'Exporter',
    import: 'Importer',
    next: 'Suivant',
    previous: 'Précédent',
    reject: 'Rejeter',
    remove: 'Retirer',
    reset: 'Réinitialiser',
    revert: 'Rétablir',
    save: 'Enregistrer',
    search: 'Rechercher',
    submit: 'Soumettre',
    sync: 'Synchroniser',
    view: 'Voir',
  },
  common: {
    all: 'Tout',
    loading: 'Chargement...',
    none: 'Aucun',
    optional: 'Facultatif',
    required: 'Obligatoire',
    unknown: 'Inconnu',
    yes: 'Oui',
    no: 'Non',
  },
  navigation: {
    skipToMainContent: 'Passer au contenu principal',
  },
  offline: {
    title: 'Vous êtes hors ligne',
    description:
      'Pas de connexion internet. Les échanges saisis hors ligne seront synchronisés automatiquement au retour de la connexion.',
    tryAgain: 'Réessayer',
  },
  auth: {
    oauth: {
      google: 'Google',
      continueWithGoogle: 'Continuer avec Google',
      completing: 'Connexion en cours',
      wait: 'Veuillez patienter pendant la finalisation de la connexion.',
      errorTitle: 'Connexion impossible',
      errors: {
        missingCode: "Google n'a pas renvoyé de code d'autorisation.",
        exchangeFailed: 'Impossible de terminer la connexion Google.',
        notAuthorized: "Ce compte Google n'est pas autorisé pour cette action.",
        personMissing: 'Contexte de profil à confirmer manquant.',
        signupContextMissing: "Détails d'inscription de l'organisation manquants.",
        startFailed: 'Impossible de démarrer la connexion Google.',
      },
    },
  },
  admin: {
    dashboard: {
      title: 'Super Admin',
      description: 'ModÃ©ration, contrÃ´les opÃ©rationnels et outils de reprise de la plateforme.',
      systemVersionsTitle: 'Versions systÃ¨me',
      systemVersionsDescription:
        "Consulter les versions de l'app, des frameworks, des conteneurs et de l'infrastructure.",
      backupsTitle: 'Sauvegardes',
      backupsDescription: 'GÃ©rer les sauvegardes serveur et Scaleway S3.',
    },
    backups: {
      backToAdmin: "Retour Ã  l'administration",
      title: 'Gestion des sauvegardes',
      description:
        'Consulter, tÃ©lÃ©charger, envoyer, lancer et restaurer les sauvegardes de la plateforme.',
      loading: 'Chargement des sauvegardes...',
      accessDenied: 'AccÃ¨s refusÃ©. Super-administrateur requis.',
      loadError: 'Impossible de charger les sauvegardes.',
      operationLoadError: "Impossible d'actualiser l'opÃ©ration de sauvegarde.",
      runBackup: 'Lancer une sauvegarde',
      runStarted: 'OpÃ©ration de sauvegarde lancÃ©e.',
      runError: 'Impossible de lancer la sauvegarde.',
      restoreStarted: 'OpÃ©ration de restauration lancÃ©e.',
      restoreError: 'Impossible de lancer la restauration.',
      uploadTitle: 'Restaurer depuis un fichier local',
      uploadFile: 'Fichier de sauvegarde',
      stageUpload: "PrÃ©parer l'envoi",
      uploadMissing: "SÃ©lectionnez d'abord un fichier de sauvegarde.",
      uploadStaged: 'Sauvegarde envoyÃ©e et prÃªte.',
      uploadError: "Impossible d'envoyer la sauvegarde.",
      lastBackup: 'DerniÃ¨re sauvegarde',
      cloud: 'Scaleway S3',
      configured: 'ConfigurÃ©',
      notConfigured: 'Non configurÃ©',
      operation: 'OpÃ©ration',
      currentOperation: 'OpÃ©ration en cours',
      operationBackup: 'Sauvegarde manuelle',
      operationRestore: 'Restauration',
      available: 'Sauvegardes disponibles',
      empty: 'Aucune sauvegarde trouvÃ©e.',
      timestamp: 'Horodatage',
      locations: 'Emplacements',
      artifacts: 'Fichiers',
      actions: 'Actions',
      downloadDb: 'TÃ©lÃ©charger DB',
      restoreFrom: 'Restaurer depuis {location}',
      restoreConfirmation: 'Phrase de confirmation de restauration',
      encrypted: 'chiffrÃ©',
      locationsMap: {
        local: 'serveur',
        s3: 'Scaleway S3',
        upload: 'fichier envoyÃ©',
      },
      statuses: {
        success: 'rÃ©ussie',
        failed: 'Ã©chec',
        unknown: 'inconnu',
      },
      operationStatuses: {
        queued: 'en attente',
        running: 'en cours',
        success: 'rÃ©ussie',
        failed: 'Ã©chec',
      },
      artifactKinds: {
        db: 'DB',
        storage: 'stockage',
      },
    },
    systemVersions: {
      backToAdmin: "Retour Ã  l'administration",
      title: 'Versions systÃ¨me',
      description:
        "Versions de l'app, des frameworks, des conteneurs et de l'infrastructure visibles par les super-administrateurs.",
      loading: 'Chargement des versions systÃ¨me...',
      accessDenied: 'AccÃ¨s refusÃ©. Super-administrateur requis.',
      loadError: 'Impossible de charger les versions systÃ¨me.',
      generatedAt: 'GÃ©nÃ©rÃ© le',
      source: 'Source',
      version: 'Version',
      component: 'Composant',
      status: 'Statut',
      noComponents: 'Aucun composant remontÃ©.',
      unknown: 'inconnu',
      statuses: {
        ok: 'ok',
        unknown: 'inconnu',
      },
      groups: {
        app: 'Application',
        deploy: 'DÃ©ploiement',
        workspaces: 'Workspaces',
        framework: 'Frameworks et runtime',
        infrastructure: 'Infrastructure',
        containers: "Conteneurs de l'app",
      },
      components: {
        myclash: 'App MyClash',
        deployedCommit: 'Commit dÃ©ployÃ©',
        deployedAt: 'DÃ©ployÃ© le',
        deployedBy: 'DÃ©ployÃ© par',
        backupFile: 'Fichier de sauvegarde',
        '@myclash/api': 'Workspace API',
        '@myclash/web-admin': 'Workspace admin',
        '@myclash/web-public': 'Workspace app publique',
        '@myclash/web-scoring': 'Workspace scoring',
        '@myclash/web-marketing': 'Workspace marketing',
        react: 'React',
        reactDom: 'React DOM',
        next: 'Next.js',
        nestjs: 'NestJS',
        node: 'Node.js',
        pnpm: 'pnpm',
        typescript: 'TypeScript',
        traefik: 'Traefik',
        postgres: 'Supabase Postgres',
        redis: 'Redis',
        supabaseAuth: 'Supabase Auth',
        supabaseRealtime: 'Supabase Realtime',
        supabaseStorage: 'Supabase Storage',
        kong: 'Kong',
        postgrest: 'PostgREST',
        api: 'Conteneur API',
        worker: 'Conteneur worker',
        'web-admin': 'Conteneur admin',
        'web-public': 'Conteneur app publique',
        'web-scoring': 'Conteneur scoring',
        'web-marketing': 'Conteneur marketing',
      },
    },
  },
  test: {
    greeting: 'Bonjour, {name}',
  },
} as const satisfies Messages;

export const messages = {
  en,
  fr,
} as const;

type DeepString<T> = T extends string ? string : { readonly [K in keyof T]: DeepString<T[K]> };
export type Messages = DeepString<typeof en>;
export type TranslationKey = string;
export type TranslationValues = Record<string, string | number | boolean | null | undefined>;

export function getMessages(locale: Locale | string = defaultLocale): Messages {
  return messages[locale as Locale] ?? messages[defaultLocale];
}

export function createTranslator(source: MessageTree) {
  return (key: TranslationKey, values?: TranslationValues): string => {
    const template = readMessage(source, key);
    if (template === undefined) {
      return `[${key}]`;
    }

    if (!values) {
      return template;
    }

    return template.replace(/\{([A-Za-z0-9_.-]+)\}/g, (match, name: string) => {
      const value = values[name];
      return value === undefined || value === null ? match : String(value);
    });
  };
}

export const t = createTranslator(getMessages(defaultLocale));

function readMessage(source: MessageTree, key: string): string | undefined {
  let cursor: MessageTree | MessageLeaf | undefined = source;
  for (const part of key.split('.')) {
    if (typeof cursor !== 'object' || cursor === null || !(part in cursor)) {
      return undefined;
    }
    cursor = cursor[part];
  }

  return typeof cursor === 'string' ? cursor : undefined;
}
