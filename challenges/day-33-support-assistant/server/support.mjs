import { readFile } from 'node:fs/promises';
import { assert } from './provider.mjs';
export const support = JSON.parse(await readFile(new URL('../data/support.json', import.meta.url), 'utf8'));
export function ticketContext(id) {
  const ticket = support.tickets.find(t => t.id === id); assert(ticket, 'Учебный тикет не найден.');
  const user = support.users.find(u => u.id === ticket.userId); assert(user, 'Пользователь тикета не найден.');
  return { ticket, user };
}
