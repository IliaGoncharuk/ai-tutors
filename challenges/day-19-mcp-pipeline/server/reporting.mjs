import {randomUUID} from 'node:crypto';
import {searchIssues} from './tracker.mjs';
import {analyze,PublicError,numericMetrics,anonymizeResult} from './domain.mjs';

const idPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function readArtifact(store,prefix,id){
 if(!idPattern.test(id))throw new PublicError('Неверный идентификатор результата.');
 const value=store.read(`${prefix}-${id}.json`);if(!value)throw new PublicError('Результат предыдущего шага не найден.');return anonymizeResult(value);
}
export async function collectSnapshot(store,source,period='all'){
 const result=await searchIssues({source,period});
 const snapshot={snapshotId:randomUUID(),source,date:result.date,collectedAt:new Date().toISOString(),issues:result.issues};
 store.write(`snapshot-${snapshot.snapshotId}.json`,snapshot);
 return {snapshotId:snapshot.snapshotId,source,date:snapshot.date,count:snapshot.issues.length};
}
export function summarizeSnapshot(store,snapshotId){
 const snapshot=readArtifact(store,'snapshot',snapshotId);
 const summary={summaryId:randomUUID(),snapshotId,source:snapshot.source,collectedAt:snapshot.collectedAt,...analyze(snapshot.issues,snapshot.date)};
 store.write(`summary-${summary.summaryId}.json`,summary);
 return summary;
}
const escape=text=>String(text).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('|','\\|').replace(/[\r\n]+/g,' ');
export function reportMarkdown(summary){
 summary=anonymizeResult(summary);
 const m=numericMetrics(summary.metrics);
 return [`# Сводка задач · ${summary.date}`,'',`Источник: ${summary.source==='live'?'Яндекс Трекер':'вымышленные учебные данные'}. Только назначенные мне незавершённые задачи.`,`Снимок получен: ${summary.collectedAt}. Часовой пояс: Asia/Yekaterinburg.`,'',`Всего: ${m.total}. Просрочено: ${m.overdue}. Срок сегодня: ${m.today}. Будущие: ${m.upcoming}. Без срока: ${m.noDeadline}. Неверная дата: ${m.invalidDeadline}. Максимальная просрочка: ${m.maxOverdueDays} дн.`,'','| Задача | Срок | Категория |','| --- | --- | --- |',...summary.issues.map(i=>`| ${escape(i.label)} | ${escape(i.dueDate??'не задан')} | ${escape(i.bucket)} |`),'','Сводка отражает время сбора. Отсутствие резолюции используется как признак незавершённой задачи.',''].join('\n');
}
export function saveReport(store,summaryId){
 const summary=readArtifact(store,'summary',summaryId);
 const reportId=summaryId;
 store.write(`report-${reportId}.json`,summary);
 store.text(`report-${reportId}.md`,reportMarkdown(summary));
 const result={reportId,source:summary.source,date:summary.date,metrics:numericMetrics(summary.metrics),jsonFile:`report-${reportId}.json`,markdownFile:`report-${reportId}.md`,saved:true};
 store.write(`latest-report-${summary.source}.json`,result);
 return result;
}
