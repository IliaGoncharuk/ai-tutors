export function words(text) {
  return text.toLowerCase().match(/[\p{L}\p{N}]+(?:[:’'−-][\p{L}\p{N}]+)*/gu) ?? [];
}

export function assessText(text, scenarioId) {
  const wordCount = words(text).length;
  const checks = scenarioId === 'dreams' ? [
    { label: 'Название «Тихий вторник»', ok: /тихий\s+вторник/iu.test(text) },
    { label: 'Время 19:00', ok: /\b19:00\b/u.test(text) },
    { label: 'Упоминание бесплатного ремонта', ok: /бесплатн/iu.test(text) },
    { label: '80–120 слов', ok: wordCount >= 80 && wordCount <= 120 },
  ] : [
    { label: 'Вычисление 12 + 8 − 5 = 15', ok: /12\s*\+\s*8\s*[-−]\s*5\s*=\s*15/u.test(text) },
    { label: 'Три пункта с названиями', ok: [1, 2, 3].every(n => new RegExp(`^${n}[.)]\\s`, 'm').test(text)) },
    { label: 'Упоминание девиза', ok: /девиз/iu.test(text) },
  ];
  return { wordCount, checks };
}

// Jaccard distance of word sets, averaged over pairs. No semantic inference.
export function lexicalDifference(texts) {
  if (texts.length < 2) return null;
  const sets = texts.map(text => new Set(words(text)));
  let sum = 0;
  let pairs = 0;
  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      const union = new Set([...sets[i], ...sets[j]]).size;
      const intersection = [...sets[i]].filter(word => sets[j].has(word)).length;
      sum += union ? 1 - intersection / union : 0;
      pairs++;
    }
  }
  return Math.round(100 * sum / pairs);
}
