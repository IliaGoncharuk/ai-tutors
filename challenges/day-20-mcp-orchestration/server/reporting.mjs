import {randomUUID} from 'node:crypto';
import {searchIssues} from './tracker.mjs';
import {analyze,PublicError,numericMetrics} from './domain.mjs';

const idPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function readArtifact(store,prefix,id){
 if(!idPattern.test(id))throw new PublicError('Неверный идентификатор результата.');
 const value=store.read(`${prefix}-${id}.json`);if(!value)throw new PublicError('Результат предыдущего шага не найден.');return value;
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
 const m=numericMetrics(summary.metrics);
 const comparison=summary.comparison ? (summary.comparison.available ? `Изменения относительно ${summary.comparison.previousDate}: просроченных ${summary.comparison.deltas.overdue}, на сегодня ${summary.comparison.deltas.today}, всего ${summary.comparison.deltas.total}.` : "Предыдущего отчёта нет; сравнение пока недоступно.") : "";
 return [`# Сводка задач · ${summary.date}`,'',`Источник: ${summary.source==='live'?'Яндекс Трекер':'вымышленные учебные данные'}. Только назначенные мне незавершённые задачи.`,`Снимок получен: ${summary.collectedAt}. Часовой пояс: Asia/Yekaterinburg.`,'',`Всего: ${m.total}. Просрочено: ${m.overdue}. Срок сегодня: ${m.today}. Будущие: ${m.upcoming}. Без срока: ${m.noDeadline}. Неверная дата: ${m.invalidDeadline}. Максимальная просрочка: ${m.maxOverdueDays} дн.`,'',comparison,'','| Задача | Название | Срок | Категория |','| --- | --- | --- |',...summary.issues.map(i=>`| ${escape(i.key)} | ${escape(i.summary)} | ${escape(i.dueDate??'не задан')} | ${escape(i.bucket)} |`),'','Сводка отражает время сбора. Отсутствие резолюции используется как признак незавершённой задачи.',''].join('\n');
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

export function comparePrevious(store,summaryId){
 const current=readArtifact(store,'summary',summaryId);
 const previous=store.read(`latest-report-${current.source}.json`);
 let comparison={available:false,deltas:null};
 if(previous){
  const before=numericMetrics(previous.metrics),after=numericMetrics(current.metrics);
  comparison={available:true,previousReportId:previous.reportId,previousDate:previous.date,deltas:Object.fromEntries(Object.keys(after).map(key=>[key,after[key]-before[key]]))};
 }
 store.write(`summary-${summaryId}.json`,{...current,comparison});
 return comparison;
}
export function latestReport(store,source){
 const latest=store.read(`latest-report-${source}.json`);
 return latest?{available:true,report:latest,result:readArtifact(store,'report',latest.reportId)}:{available:false,report:null,result:null};
}
