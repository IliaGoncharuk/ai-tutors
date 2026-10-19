import { getUser, listLessons } from './client.mjs';
export function dashboardRequests(userId) { return [getUser(userId), listLessons()]; }
