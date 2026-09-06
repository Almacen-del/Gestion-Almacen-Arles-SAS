export const APP_RELEASE: { id: string; revision: string; builtAt: string } =
  typeof __APP_RELEASE__ !== 'undefined' ? __APP_RELEASE__ : { id: 'local-dev', revision: 'local', builtAt: '' };
