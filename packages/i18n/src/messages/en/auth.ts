import type { MessageTree } from '../../message-tree.js';

export const auth = {
  login: {
    eyebrow: 'Organizer console',
    title: 'Run your event, from the first entry to the last medal.',
    subtitle:
      'Entries, pools, brackets, referees and live scoring — for a club evening or a three-day open.',
    formTitle: 'Organizer login',
    formDescription: 'Sign in with your administrator credentials, magic link, or Google.',
    participantPrompt: 'Looking for the participant login?',
    participantLink: 'Go to the participant space',
    tabsLabel: 'Sign in or create an organizer account',
    tabSignIn: 'Sign in',
    tabSignUp: 'Create account',
    // The arrow lives in the string, not in the JSX: web-admin holds the ←
    // glyph to a single owner (BackLink), and this one is a tab switch
    // inside the panel rather than a navigation back to a page.
    backToSignIn: '← Back to sign in',
    or: 'or',
    checkEmail: 'We sent a login link to {email}. It expires in 1 hour.',
    emailAddress: 'Email address',
    emailPlaceholder: 'you@example.com',
    password: 'Password',
    passwordPlaceholder: 'Your password',
    signIn: 'Sign in',
    signingIn: 'Signing in...',
    sendLoginLink: 'Send login link',
    sending: 'Sending...',
    forgotPassword: 'Forgot your password?',
    resetTitle: 'Reset your password',
    resetDescription:
      'Enter your email. If an account exists, we will send a link to set a new password.',
    sendResetLink: 'Send reset link',
    resetSending: 'Sending reset link...',
    resetCheckEmail: 'If this email is registered, a reset link has been sent.',
    errors: {
      magicLinkFailed: 'Could not send a login link.',
      wrongPassword: 'Wrong email or password.',
      // A mailed link that signed nobody in (rulings 360, 362): on both sign-in pages.
      linkExpired: 'This link has expired or was already used. Ask for a new one.',
      linkUnchecked: 'We could not check this link. Open it again in a moment.',
    },
  },
  resetPassword: {
    title: 'Set a new password',
    description: 'Choose a new password for your organizer account.',
    newPassword: 'New password',
    submit: 'Save the new password',
    doneTitle: 'Password updated',
    doneDescription: 'You are signed in. Continue to your workspace.',
    // The door handed no login with the new password (ruling 358).
    doneSignIn: 'Sign in with your new password.',
    continue: 'Go to my dashboard',
    errors: {
      missingToken: 'This link is missing its token. Request a new reset email.',
      expired: 'This reset link has expired. Request a new one.',
      generic: 'Could not update the password. Try again in a moment.',
      network: 'Could not reach the MyClash server. Check your connection and try again.',
    },
  },
  // The page an organiser's sign-up mail opens (ruling "Pre-takeover").
  choosePassword: {
    title: 'Choose your password',
    description:
      'Choose the password of your organizer account. This confirms your address and creates your organization.',
    submit: 'Save my password',
    doneSignIn: 'Password saved and organization created. Sign in with your new password.',
    // The code was spent and the club made, but the password was refused or not judged.
    notSaved:
      'Your organization is created and you are signed in, but your password was not saved. Set one later with "Forgot password?" on the sign-in page.',
    unknown:
      'Your organization is created and you are signed in, but we could not tell if your password was saved. If it was not, use "Forgot password?" on the sign-in page.',
    openClub: 'Open my organization',
    signUpAgain: 'Sign up again',
    errors: {
      missingToken: 'This link is incomplete. Open the link in the mail again.',
      generic: 'Could not save the password. Try again in a moment.',
    },
  },
  oauth: {
    continueWithGoogle: 'Continue with Google',
    completing: 'Completing sign-in',
    wait: 'Please wait while we finish signing you in.',
    errorTitle: 'Sign-in failed',
    backToLogin: 'Back to sign-in',
    detailsToggle: 'Technical details',
    errors: {
      missingCode: 'Google did not return an authorization code.',
      exchangeFailed: 'Could not complete Google sign-in.',
      notAuthorized: 'This Google account is not authorized for this action.',
      personMissing: 'Missing profile claim context.',
      signupContextMissing: 'Missing organization signup details.',
      startFailed: 'Could not start Google sign-in.',
      network: 'Could not reach the MyClash server. Check your connection and try again.',
      timeout: 'The sign-in request timed out. Try again in a moment.',
      serverRejected: 'The MyClash server rejected the sign-in (HTTP {status}).',
      parseFailed: 'The MyClash server returned an unexpected response.',
      navigation: 'Could not redirect after sign-in.',
    },
  },
  signup: {
    signupsOff: 'Sign-ups are switched off for now. Try again later.',
    // The sign-up link was spent and the organization was not written (ruling 363).
    // Her account stands: a second sign-up mails a new link, which makes it.
    orgNotMade:
      'We could not create your organization. Fill in the form again: we will mail you a new link.',
    // A sign-up by an account that owns an organization makes no second one (ruling 369).
    alreadyOwnsOrg: 'You already have an organization. We opened it.',
    title: 'Create your organizer account',
    step1Label: 'Step 1 of 2 — Your account',
    step2Label: 'Step 2 of 2 — Your organization',
    emailLabel: 'Email',
    displayNameLabel: 'Display name',
    displayNamePlaceholder: 'Jean Dupont',
    passwordPlaceholder: 'At least 12 characters',
    passwordConfirmLabel: 'Confirm password',
    passwordConfirmPlaceholder: 'Repeat password',
    continue: 'Continue →',
    sendSignupLink: 'Send signup link',
    orgNameLabel: 'Organization name',
    orgNamePlaceholder: 'Lyon AMHE',
    orgNameHint:
      'This is the public name people will see when browsing your events. You can change it later in settings.',
    slugLabel: 'URL slug',
    slugChecking: 'Checking…',
    slugAvailable: '✓ Available',
    slugReserved: 'Reserved',
    slugTaken: 'Already taken',
    slugPlaceholder: 'lyon-amhe',
    slugHint: 'Lowercase letters, digits, and hyphens only.',
    back: '← Back',
    creating: 'Creating…',
    doneMagicTitle: 'Check your email',
    doneMagicPrefix: 'We sent a signup link to',
    doneMagicSuffix: 'Click it to choose your password and open your organization.',
  },
} as const satisfies MessageTree;
