/** Is the app being served from the developer's computer? (the bridge and GitHub are not called there). */
export const isLocalhost = () => location.hostname === 'localhost' || location.hostname === '127.0.0.1';
