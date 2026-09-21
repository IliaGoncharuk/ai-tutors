import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';

export type Profile = {
  id: string;
  name: string;
  level: string;
  style: string;
  format: string;
  restrictions: string;
};

type Props = {
  profile: Profile;
  profiles: Profile[];
  disabled: boolean;
  canCompare: boolean;
  mode: 'live' | 'demo';
  onAction: (action: Record<string, unknown> & { type: string }) => Promise<void>;
  onCompare: () => void;
};

const badges: Record<string, { initials: string; description: string }> = {
  novice: { initials: 'Н', description: 'Понятно и с объяснениями' },
  expert: { initials: 'Э', description: 'Точно и по существу' },
  manager: { initials: 'Р', description: 'Решения и приоритеты' },
};

export default function ProfilePanel({ profile, profiles, disabled, canCompare, mode, onAction, onCompare }: Props) {
  const [draft, setDraft] = useState(profile);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    setDraft(profile);
  }, [profile.id, profile.name, profile.level, profile.style, profile.format, profile.restrictions]);

  const changed = (['name', 'level', 'style', 'format', 'restrictions'] as const).some(field => draft[field] !== profile[field]);
  const valid = Boolean(draft.name.trim() && draft.level.trim() && draft.style.trim() && draft.format.trim());

  async function save(event: FormEvent) {
    event.preventDefault();
    if (disabled || !changed || !valid) return;
    const { name, level, style, format, restrictions } = draft;
    await onAction({ type: 'update-profile', profile: { name: name.trim(), level: level.trim(), style: style.trim(), format: format.trim(), restrictions: restrictions.trim() } });
  }

  return <section className="panel profile-panel" id="profile" aria-labelledby="profile-heading">
    <div className="profile-topline">
      <div><span className="eyebrow teal-text">КОМУ ОТВЕЧАЕТ АГЕНТ</span><h2 id="profile-heading">Профиль пользователя</h2></div>
      <span className="profile-always"><span />В каждом запросе</span>
    </div>
    <div className="profile-choices" aria-label="Выбор пользователя">
      {profiles.map(item => <button type="button" key={item.id} disabled={disabled} className={`profile-choice ${item.id === profile.id ? 'profile-selected' : ''}`} aria-pressed={item.id === profile.id} onClick={() => { if (item.id !== profile.id) void onAction({ type: 'switch-profile', profileId: item.id }); }}>
        <span className={`profile-avatar profile-avatar-${item.id}`}>{badges[item.id]?.initials ?? item.name.slice(0, 1)}</span>
        <span className="profile-choice-text"><strong>{item.name}</strong><small>{item.level || badges[item.id]?.description}</small></span>
        <span className="profile-choice-indicator" aria-hidden="true">{item.id === profile.id ? '✓' : ''}</span>
      </button>)}
    </div>
    <div className="profile-preferences">
      <div><span>Уровень</span><strong>{profile.level}</strong></div>
      <div><span>Стиль ответа</span><strong>{profile.style}</strong></div>
      <div><span>Формат</span><strong>{profile.format}</strong></div>
      <div><span>Ограничения</span><strong>{profile.restrictions || 'Не заданы'}</strong></div>
    </div>
    <div className="profile-toolbar">
      <div className="profile-tools"><button type="button" className="button button-quiet" disabled={disabled} aria-expanded={editing} aria-controls="profile-editor" onClick={() => setEditing(current => !current)}>{editing ? 'Свернуть редактор' : 'Изменить профиль'}<span aria-hidden="true">{editing ? '⌃' : '⌄'}</span></button><button type="button" className="button button-secondary" disabled={!canCompare} onClick={onCompare}>Сравнить профили<span aria-hidden="true">↗</span></button></div>
      <p>{mode === 'live' ? '3 платных запроса' : '3 симуляции без API'} · вопрос из поля диалога</p>
    </div>
    <p className="profile-explanation">При сравнении меняется только профиль: вопрос и память текущей задачи одинаковы, история диалога не используется. Память других пользователей не загружается.</p>
    {editing && <form id="profile-editor" className="profile-editor" onSubmit={event => void save(event)}>
      <div className="profile-edit-grid">
        <label>Имя профиля<input value={draft.name} maxLength={100} required disabled={disabled} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} /></label>
        <label>Уровень подготовки<input value={draft.level} maxLength={300} required disabled={disabled} placeholder="Например: начинающий" onChange={event => setDraft(current => ({ ...current, level: event.target.value }))} /></label>
        <label>Стиль ответа<input value={draft.style} maxLength={500} required disabled={disabled} placeholder="Например: подробно, простыми словами" onChange={event => setDraft(current => ({ ...current, style: event.target.value }))} /></label>
        <label>Предпочитаемый формат<input value={draft.format} maxLength={500} required disabled={disabled} placeholder="Например: короткий список с примерами" onChange={event => setDraft(current => ({ ...current, format: event.target.value }))} /></label>
        <label className="profile-restrictions">Ограничения<textarea value={draft.restrictions} maxLength={2000} disabled={disabled} rows={2} placeholder="Например: объяснять специальные термины" onChange={event => setDraft(current => ({ ...current, restrictions: event.target.value }))} /></label>
      </div>
      <div className="profile-editor-footer"><span>{changed ? 'Изменения ещё не сохранены' : 'Показан сохранённый профиль'}</span><button type="submit" className="button button-primary" disabled={disabled || !changed || !valid}>Сохранить профиль</button></div>
    </form>}
  </section>;
}
