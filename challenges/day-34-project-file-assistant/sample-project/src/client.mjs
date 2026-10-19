export const API_VERSION = 'v2';
export function getUser(id) { return { method: 'GET', path: '/api/v2/users' + '/' + encodeURIComponent(id) }; }
export function listLessons() { return { method: 'GET', path: '/api/v2/lessons' }; }
